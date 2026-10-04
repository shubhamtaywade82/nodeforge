/**
 * Extension-host test configurations (see https://code.visualstudio.com/api/working-with-extensions/testing-extension).
 *
 *   host       the original smoke tests against the node-ts-eslint fixture
 *   trusted    NodeForge features in a trusted workspace
 *   untrusted  Restricted Mode: nothing may execute project code
 */
import { defineConfig } from "@vscode/test-cli";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const version = process.env.VSCODE_TEST_VERSION ?? "stable";
const extensionDevelopmentPath = "../extension";
const workspaceFolder = "./test/fixtures/workspace";
const mocha = { ui: "tdd", timeout: 60000 };
// Electron refuses to start as root without --no-sandbox (containers, some CI images).
const sandbox = process.getuid?.() === 0 ? ["--no-sandbox"] : [];

/**
 * @vscode/test-electron always appends --disable-workspace-trust, so Restricted Mode cannot be
 * reached through `launchArgs`. The untrusted run launches VS Code through a tiny wrapper that
 * drops that flag. POSIX only; Windows runs the other configurations.
 */
async function restrictedModeLauncher() {
  const real = await downloadAndUnzipVSCode(version);
  const dir = path.join(here, ".vscode-test");
  mkdirSync(dir, { recursive: true });
  const wrapper = path.join(dir, "code-restricted.sh");
  writeFileSync(
    wrapper,
    [
      "#!/bin/sh",
      `real='${real.replaceAll("'", "'\\''")}'`,
      'for arg in "$@"; do',
      "  shift",
      '  [ "$arg" = "--disable-workspace-trust" ] || set -- "$@" "$arg"',
      "done",
      'exec "$real" "$@"',
      ""
    ].join("\n")
  );
  chmodSync(wrapper, 0o755);
  return wrapper;
}

const host = {
  label: "host",
  files: "test/*.test.js",
  version,
  extensionDevelopmentPath,
  workspaceFolder: "../test-fixtures/node-ts-eslint",
  launchArgs: ["--disable-extensions"],
  mocha
};

const trusted = {
  label: "trusted",
  files: ["test/suites/shared/*.test.js", "test/suites/trusted/*.test.js"],
  version,
  extensionDevelopmentPath,
  workspaceFolder,
  // The debug test needs VS Code's built-in JavaScript debugger, so built-ins stay enabled.
  launchArgs: ["--disable-gpu", ...sandbox],
  mocha
};

const untrusted =
  process.platform === "win32"
    ? undefined
    : {
        label: "untrusted",
        files: ["test/suites/shared/*.test.js", "test/suites/untrusted/*.test.js"],
        version,
        extensionDevelopmentPath,
        workspaceFolder,
        useInstallation: { fromPath: await restrictedModeLauncher() },
        // A fresh user-data dir has no trust decision recorded, so the folder opens in Restricted Mode.
        launchArgs: ["--user-data-dir", path.join(here, ".vscode-test", "user-data-untrusted"), "--disable-gpu", ...sandbox],
        mocha
      };

export default defineConfig(untrusted ? [host, trusted, untrusted] : [host, trusted]);
