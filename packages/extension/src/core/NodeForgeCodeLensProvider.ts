/**
 * NodeForgeCodeLensProvider — shows actionable CodeLenses above test functions
 * and package.json dependency blocks.
 *
 * For test files (.ts/.js containing it()/test()):
 *   it("should add numbers", () => { ... })
 *   ^— [Run Test] [Debug Test]
 *
 * For package.json:
 *   "dependencies": {
 *     "lodash": "^4.17.20"      ^— [3 vulnerabilities]
 *   }
 *
 * The provider uses regex to find test function calls and dependency entries,
 * then creates CodeLenses with commands that trigger NodeForge actions.
 */

import * as vscode from "vscode";
import { logger } from "./Logger.js";

const TEST_FUNCTION_REGEX = /^\s*(?:it|test|it\.only|test\.only|it\.skip|test\.skip)\s*\(\s*["'`]([^"'`]+)["'`]/;
const DESCRIBE_REGEX = /^\s*(?:describe|describe\.only|describe\.skip)\s*\(\s*["'`]([^"'`]+)["'`]/;

export class NodeForgeCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const lenses: vscode.CodeLens[] = [];
    const fileName = vscode.workspace.asRelativePath(document.uri);

    // Test files: show "Run Test" / "Debug Test" above it() and describe()
    if (this.isTestFile(fileName, document)) {
      for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const text = line.text;

        if (TEST_FUNCTION_REGEX.test(text)) {
          lenses.push(this.createTestCodeLens(document, i, "Run Test", "nodeforge.runTestFromFile"));
          lenses.push(this.createTestCodeLens(document, i, "Debug Test", "nodeforge.debugTestFromFile"));
        } else if (DESCRIBE_REGEX.test(text)) {
          lenses.push(this.createTestCodeLens(document, i, "Run Suite", "nodeforge.runTestFromFile"));
        }
      }
    }

    // package.json: show vulnerability count above dependency declarations
    if (fileName === "package.json") {
      this.addDependencyLenses(document, lenses);
    }

    return lenses;
  }

  private isTestFile(fileName: string, document: vscode.TextDocument): boolean {
    return (
      fileName.includes(".test.") ||
      fileName.includes(".spec.") ||
      fileName.includes("/test/") ||
      fileName.includes("/tests/") ||
      fileName.includes("__tests__")
    );
  }

  private createTestCodeLens(
    document: vscode.TextDocument,
    line: number,
    title: string,
    command: string
  ): vscode.CodeLens {
    const range = new vscode.Range(line, 0, line, 0);
    return new vscode.CodeLens(range, {
      command,
      title,
      arguments: [document.uri.fsPath, line + 1]
    });
  }

  private addDependencyLenses(
    document: vscode.TextDocument,
    lenses: vscode.CodeLens[]
  ): void {
    // Look for "dependencies" or "devDependencies" blocks and add a
    // "Run Audit" lens above them.
    for (let i = 0; i < document.lineCount; i++) {
      const text = document.lineAt(i).text;
      if (/^\s*"(devDependencies|dependencies|optionalDependencies|peerDependencies)"\s*:/.test(text)) {
        const range = new vscode.Range(i, 0, i, 0);
        lenses.push(new vscode.CodeLens(range, {
          command: "nodeforge.auditDependencies",
          title: "$(shield) Audit Dependencies"
        }));
        break; // Only add once, above the first dependencies block
      }
    }
  }
}
