/**
 * NodeForgeDebugConfigurationProvider — auto-generates debug launch configs
 * based on the detected workspace profile.
 *
 * When the user presses F5 in a Node.js/TypeScript project without any
 * launch.json, VS Code calls this provider to generate initial configs.
 *
 * The provider inspects package.json scripts and creates:
 *   - "Debug: npm run dev" (if a dev script exists)
 *   - "Debug: npm run start" (if a start script exists)
 *   - "Debug: Current TS File" (runs the active .ts file with tsx)
 *   - "Debug: Current JS File" (runs the active .js file with node)
 *
 * For each config, the provider sets:
 *   - type: "node"
 *   - request: "launch"
 *   - program / runtimeArgs based on the script
 *   - skipFiles for stepping into node_modules
 *   - env from .env if present
 */

import * as vscode from "vscode";
import * as path from "node:path";
import { logger } from "./Logger.js";

interface PackageJson {
  scripts?: Record<string, string>;
  type?: string;
}

export class NodeForgeDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  constructor(
    private readonly workspaceRoot: string,
    private readonly packageManager: "npm" | "pnpm" | "yarn"
  ) {}

  /**
   * Called by VS Code when the user presses F5 without a launch.json.
   * Returns an array of debug configurations that VS Code will show in
   * the debug configuration dropdown.
   */
  async provideDebugConfigurations?(
    _folder: vscode.WorkspaceFolder | undefined,
    _token?: vscode.CancellationToken
  ): Promise<vscode.DebugConfiguration[]> {
    const configs: vscode.DebugConfiguration[] = [];

    try {
      const pkg = await this.readPackageJson();

      // If there's a "dev" or "start" script, create a "Debug via npm" config.
      const devScript = pkg.scripts?.["dev"];
      const startScript = pkg.scripts?.["start"];

      if (devScript) {
        configs.push(this.createScriptConfig("Debug: dev", "dev"));
      }
      if (startScript) {
        configs.push(this.createScriptConfig("Debug: start", "start"));
      }

      // Always offer "Debug current TS file" (uses tsx)
      configs.push({
        name: "Debug: Current TS File",
        type: "node",
        request: "launch",
        runtimeExecutable: this.packageManager === "pnpm" ? "pnpm" : "npx",
        runtimeArgs: ["tsx", "${file}"],
        cwd: "${workspaceFolder}",
        console: "integratedTerminal",
        skipFiles: ["<node_internals>/**", "${workspaceFolder}/node_modules/**"],
        env: {}
      });

      // Always offer "Debug current JS file"
      configs.push({
        name: "Debug: Current JS File",
        type: "node",
        request: "launch",
        program: "${file}",
        cwd: "${workspaceFolder}",
        console: "integratedTerminal",
        skipFiles: ["<node_internals>/**"],
        env: {}
      });

      // Attach to process config
      configs.push({
        name: "Attach: Node Process",
        type: "node",
        request: "attach",
        processId: "${command:PickProcess}",
        skipFiles: ["<node_internals>/**"]
      });
    } catch (err) {
      logger.error("Failed to provide debug configurations", err);
    }

    return configs;
  }

  /**
   * Called by VS Code to resolve a debug configuration before launching.
   * Allows us to inject env vars from .env, set the correct Node binary, etc.
   */
  resolveDebugConfiguration?(
    _folder: vscode.WorkspaceFolder | undefined,
    debugConfiguration: vscode.DebugConfiguration,
    _token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    // Load .env vars into the debug environment if the file exists.
    // We don't block the launch — best-effort only.
    void this.loadEnvFile().then((env) => {
      if (Object.keys(env).length > 0) {
        debugConfiguration.env = { ...env, ...debugConfiguration.env };
        logger.info(`Loaded ${Object.keys(env).length} env vars from .env for debug session`);
      }
    });

    return debugConfiguration;
  }

  /**
   * Called by VS Code when the user has a launch.json and needs additional
   * dynamically-computed configurations.
   */
  resolveDebugConfigurationWithSubstitutedVariables?(
    _folder: vscode.WorkspaceFolder | undefined,
    debugConfiguration: vscode.DebugConfiguration,
    _token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    return debugConfiguration;
  }

  /** Create a "Debug via npm script" configuration. */
  private createScriptConfig(name: string, script: string): vscode.DebugConfiguration {
    const pm = this.packageManager;
    // For npm/pnpm: `npm run <script>` via runtimeExecutable.
    // For yarn: `yarn <script>`.
    const runtimeArgs = pm === "yarn" ? [script] : ["run", script];

    return {
      name,
      type: "node",
      request: "launch",
      runtimeExecutable: pm,
      runtimeArgs,
      cwd: "${workspaceFolder}",
      console: "integratedTerminal",
      skipFiles: ["<node_internals>/**", "${workspaceFolder}/node_modules/**"],
      env: {},
      // For ESM projects, pass --inspect-brk
      autoAttachChildProcesses: true
    };
  }

  private async readPackageJson(): Promise<PackageJson> {
    const fs = await import("node:fs/promises");
    const pkgPath = path.join(this.workspaceRoot, "package.json");
    const raw = await fs.readFile(pkgPath, "utf8");
    return JSON.parse(raw) as PackageJson;
  }

  /** Best-effort .env file loader. Returns an env var map. */
  private async loadEnvFile(): Promise<Record<string, string>> {
    try {
      const fs = await import("node:fs/promises");
      const envPath = path.join(this.workspaceRoot, ".env");
      const content = await fs.readFile(envPath, "utf8");
      const env: Record<string, string> = {};
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        env[key] = value;
      }
      return env;
    } catch {
      return {};
    }
  }
}
