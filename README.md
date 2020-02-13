# VSCode vale

Thanks to all the work previous work from [lunaryorn](https://github.com/testthedocs/vscode-vale/commits?author=lunaryorn), this is a new maintained fork, with more features to come soon.

Lint documents with [Vale][vale] in [Visual Studio Code][code].

[vale]: https://errata-ai.github.io/vale/

[code]: https://code.visualstudio.com

## Prerequisites

[Install vale][1] **0.7.2 or newer**.

If Vale is too old the extension fails to activate.
In this case please update Vale; the error message tells you the required version.

> By default the extension will use the global installed binary `vale`. In case you have the binary installed on a local project you can configure the extension to use the local path. See [configuration options](#configuration) below.

[1]: https://errata-ai.github.io/vale/#installation

[issue]: https://github.com/testthedocs/vscode-vale/issues/new

## Usage

Vale automatically checks a document when you open or save it.  Use the `Vale: Lint workspace` command to check the entire workspace.

Vale always runs from the workspace directory in either case, so if you put a [Vale configuration][config] in the workspace directory it will automatically pick it up.

This extension supports the following file extensions by default, but you can change them with the `vscode-vale.fileExtensions` config item (see below):

-   **Asciidoc**: _.adoc_ and _.asciidoc_
-   **Markdown**: _.md_ and _.markdown_
-   **reStructuredText**: _.rst_
-   **LaTeX**: _.tex_
-   **plain text**: _.txt_

[config]: https://errata-ai.github.io/vale/config/

## Configuration

-   `vscode-vale.configPath`: Absolute path to Vale config file. If not specified, uses normal Vale config scoping rules.
-   `vscode-vale.path`: (default `vale`). Absolute path to the `vale` binary, useful if you don't want to use the global binary.

**Example**

```js
{
  // You can use ${workspaceFolder} it will be replaced by workspace folder path
  "vscode-vale.path": "${workspaceFolder}/node_modules/.bin/vale"

  // or use some absolute path
  "vscode-vale.path": "/some/path/to/vale"
}
```

-   `vscode-vale.fileExtensions`: (default `md, markdown, txt, rst, tex, adoc, asciidoc`).

File extensions to lint.

> **Note**, these also need to be in your Vale config file.
