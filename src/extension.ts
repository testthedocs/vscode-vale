// Copyright (c) 2017 Sebastian Wiesner <swiesner@lunaryorn.com>

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import * as path from 'path'
import { execFile } from "child_process";
import * as semver from "semver";
import {
    commands,
    Diagnostic,
    DiagnosticCollection,
    DiagnosticSeverity,
    ExtensionContext,
    languages,
    ProgressLocation,
    Range,
    TextDocument,
    Uri,
    window,
    workspace,
    WorkspaceFolder,
} from "vscode";

/**
 * Whether a given document is elligible for linting.
 *
 * A document is elligible if it's in a supported format and saved to disk.
 *
 * @param document The document to check
 * @return Whether the document is elligible
 */
const isElligibleDocument = (document: TextDocument): boolean =>
    !document.isDirty && 0 < languages.match({
        scheme: "file",
    }, document);

/**
 * Run a command in a given workspace folder and get its standard output.
 *
 * If the workspace folder is undefined run the command in the working directory
 * of the current vscode instance.
 *
 * @param folder The workspace
 * @param command The command array
 * @return The standard output of the program
 */
const runInWorkspace = (
    folder: WorkspaceFolder | undefined, command: ReadonlyArray<string>,
): Promise<string> =>
    new Promise((resolve, reject) => {
        const cwd = folder ? folder.uri.fsPath : process.cwd();
        const maxBuffer = 10 * 1024 * 1024; // 10MB buffer for large results
        execFile(command[0], command.slice(1), { cwd, maxBuffer },
            (error, stdout) => {
                if (error) {
                    // Throw system errors, but do not fail if the command
                    // fails with a non-zero exit code.
                    console.error("Command error", command, error);
                    reject(error);
                } else {
                    resolve(stdout);
                }
            });
    });

/**
 * A severity from vale.
 */
type ValeSeverity = "suggestion" | "warning" | "error";

interface IValeErrorJSON {
    readonly Check: string;
    readonly Context: string;
    readonly Description: string;
    readonly Line: number;
    readonly Link: string;
    readonly Message: string;
    readonly Span: [number, number];
    readonly Severity: ValeSeverity;
}

/**
 * The type of Vale’s JSON output.
 */
interface IValeJSON {
    readonly [propName: string]: ReadonlyArray<IValeErrorJSON>;
}

/**
 * The result of a vale run, mapping file names to a list of errors in the file.
 */
type ValeDiagnostics = Map<string, ReadonlyArray<Diagnostic>>;

/**
 * Convert a Vale severity string to a code diagnostic severity.
 *
 * @param severity The severity to convert
 */
const toSeverity = (severity: ValeSeverity): DiagnosticSeverity => {
    switch (severity) {
        case "suggestion":
            return DiagnosticSeverity.Information;
        case "warning":
            return DiagnosticSeverity.Warning;
        case "error":
            return DiagnosticSeverity.Error;
    }
};

/**
 * Convert a Vale error to a code diagnostic.
 *
 * @param message The message to convert
 */
const toDiagnostic = (error: IValeErrorJSON): Diagnostic => {
    // vale prints one-based locations but code wants zero-based, so adjust
    // accordingly
    const range = new Range(error.Line - 1, error.Span[0] - 1,
        error.Line - 1, error.Span[1]);
    const message = error.Link ?
        `${error.Message} (${error.Check}, see ${error.Link})` :
        `${error.Message} (${error.Check})`;
    const diagnostic = new Diagnostic(
        range, message, toSeverity(error.Severity));
    diagnostic.source = "vale";
    diagnostic.code = error.Check;
    return diagnostic;
};

const readBinaryLocation = () => {
    const configuration = workspace.getConfiguration();
    const binaryPathRelativeToWorkspace =  configuration.get<string>('vscode-vale.path', 'vale');
    return path.join(workspace.rootPath || '', binaryPathRelativeToWorkspace);
}

/**
 * Lint a path, which is either a file or a directory.
 *
 * @param path The path to lint
 * @return A promise with the results of linting the path
 */
const runVale = (
    folder: WorkspaceFolder | undefined,
    args: string | ReadonlyArray<string>,
): Promise<ValeDiagnostics> => {
    const binaryLocation = readBinaryLocation()
    const command: ReadonlyArray<string> = [
        binaryLocation,
        "--no-exit",
        "--output",
        "JSON",
        ...(typeof args === "string" ? [args] : args),
    ];
    console.info("Run vale as", command);
    return runInWorkspace(folder, command).then((stdout) => {
        const result = JSON.parse(stdout) as IValeJSON;
        const diagnostics: ValeDiagnostics = new Map();
        for (const fileName of Object.getOwnPropertyNames(result)) {
            diagnostics.set(fileName, result[fileName].map(toDiagnostic));
        }
        return diagnostics;
    });
};

/**
 * Lint a single document and put the results into a diagnostic collection.
 *
 * @param diagnostics The diagnostic collection to put results in
 * @param document The document to lint
 */
const lintDocumentToDiagnostics = (diagnostics: DiagnosticCollection) =>
    (document: TextDocument) => {
        console.log("Linting", document.fileName);
        if (!isElligibleDocument(document)) {
            return Promise.resolve();
        }
        const folder = workspace.getWorkspaceFolder(document.uri);
        return runVale(folder, document.fileName)
            .catch((error): ValeDiagnostics => {
                window.showErrorMessage(error.toString());
                diagnostics.delete(document.uri);
                return new Map();
            })
            .then((result) => {
                // Delete old diagnostics for the document, in case we
                // don't receive new diagnostics, because the document
                // has no errors.
                diagnostics.delete(document.uri);
                result.forEach((fileDiagnostics, fileName) =>
                    diagnostics.set(Uri.file(fileName),
                        // tslint:disable-next-line:readonly-array
                        fileDiagnostics as Diagnostic[]));
            });
    };

/**
 * Start linting vale documents.
 *
 * @param context The extension context
 */
const startLinting =
    (context: ExtensionContext, diagnostics: DiagnosticCollection): void => {
        workspace.onDidSaveTextDocument(lintDocumentToDiagnostics(diagnostics),
            null, context.subscriptions);
        workspace.onDidOpenTextDocument(lintDocumentToDiagnostics(diagnostics),
            null, context.subscriptions);
        workspace.textDocuments.forEach(lintDocumentToDiagnostics(diagnostics));

        workspace.onDidCloseTextDocument(
            (d) => diagnostics.delete(d.uri), null, context.subscriptions);
    };

/**
 * A workspace folder with URIs.
 */
interface IWorkspaceFolderFiles {
    readonly folder: WorkspaceFolder;
    readonly filePaths: ReadonlyArray<string>;
}

/**
 * Group a list of URIs by their workspace folders.
 *
 * Yield an object containing the folder and the corresponding file paths for
 * every group.
 *
 * @param uris The URIs to group by their workspace folder.
 */
function* groupByWorkspace(
    uris: ReadonlyArray<Uri>,
): IterableIterator<IWorkspaceFolderFiles> {
    const byFolder = new Map<number, ReadonlyArray<string>>();
    for (const uri of uris) {
        const folder = workspace.getWorkspaceFolder(uri);
        if (folder) {
            const paths = byFolder.get(folder.index) || [];
            byFolder.set(folder.index, [...paths, uri.fsPath]);
        }
    }

    const folders = workspace.workspaceFolders;
    if (folders) {
        for (const [index, folderUris] of byFolder) {
            const folder = folders[index];
            yield { folder, filePaths: folderUris };
        }
    }
}

/**
 * Run value on the entire workspace.
 *
 * @return A promise with the results
 */
const runValeOnWorkspace = async (): Promise<ValeDiagnostics> => {
    // Explicitly find all elligible files ourselves so that we respect
    // "files.exclude", ie, only look at files that are included in the
    // workspace.
    const extensions: ReadonlyArray<string> = ["md", "mdx", "markdown", "txt", "rst", "tex", "adoc", "asciidoc"];
    const pattern = `**/*.{${extensions.join(",")}}`;
    const uris = await workspace.findFiles(pattern);
    const results: ValeDiagnostics = new Map();
    for (const urisInFolder of groupByWorkspace(uris)) {
        const folderResults = await runVale(
            urisInFolder.folder, urisInFolder.filePaths);
        for (const [path, errors] of folderResults) {
            results.set(path, errors);
        }
    }
    return results;
};

/**
 * Register commands for this extensions.
 *
 * @param context The extension context
 * @param diagnostics The diagnostic collection to put diagnostics in
 */
const registerCommands =
    (context: ExtensionContext, diagnostics: DiagnosticCollection): void => {
        const lintProgressOptions = {
            location: ProgressLocation.Window,
            title: "vale running on workspace",
        };
        const lintWorkspaceCommand = commands.registerCommand(
            "vale.lintWorkspace",
            () => window.withProgress(
                lintProgressOptions,
                () => runValeOnWorkspace()
                    .then((result) => {
                        diagnostics.clear();
                        result.forEach((errors, fileName) =>
                            diagnostics.set(Uri.file(fileName),
                                // tslint:disable-next-line:readonly-array
                                errors as Diagnostic[]));
                    })));

        context.subscriptions.push(lintWorkspaceCommand);
    };

/**
 * Get the version of vale.
 *
 * @return A promise with the vale version string as single element.  If vale
 * doesn't exist or if the version wasn't found the promise is rejected.
 */
const getValeVersion = (): Promise<string> => {
    const binaryLocation = readBinaryLocation()
    // Run in an arbitrary directory, since "--version" doesn't depend on any
    // folder
    return runInWorkspace(undefined, [binaryLocation, "--version"])
        .then((stdout) => {
            const matches = stdout.match(/^vale version (.+)$/m);
            if (matches && matches.length === 2) {
                return matches[1];
            } else {
                throw new Error(
                    `Failed to extract vale version from: ${stdout}`);
            }
        });
}

/**
 * The version requirements for vale.
 *
 * We need at least 0.7.2 in this extension because earlier releases do not
 * process all command line arguments, which we need to lint the entire
 * workspace.
 *
 * See https://github.com/ValeLint/vale/issues/46 for details.
 */
const VERSION_REQUIREMENTS = ">= 0.7.2";

/**
 * Activate this extension.
 *
 * Start linting elligible files with vale.
 *
 * Initialization fails if vale is not installed or does not meet the version
 * requirements.
 *
 * @param context The context for this extension
 * @return A promise for the initialization
 */
export const activate = async (context: ExtensionContext): Promise<any> => {
    const version = await getValeVersion();
    if (semver.satisfies(version, VERSION_REQUIREMENTS) || version === 'master') {
        console.log("Found vale version", version,
            "satisfying", VERSION_REQUIREMENTS);
    } else {
        // tslint:disable-next-line:max-line-length
        throw new Error(`Vale version ${version} does not satisfy ${VERSION_REQUIREMENTS}`);
    }
    // Create and register a collection for our diagnostics
    const diagnostics = languages.createDiagnosticCollection("vale");
    context.subscriptions.push(diagnostics);

    startLinting(context, diagnostics);
    registerCommands(context, diagnostics);
};
