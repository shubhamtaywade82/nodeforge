/**
 * RuntimeTerminalManager — manages real interactive VS Code terminals for
 * dev/watch processes started via ProcessManager.
 *
 * Instead of showing the last 5 lines of stdout in tree nodes (which can't
 * scroll, can't render ANSI colors, and can't accept stdin), this manager
 * creates a real `vscode.Terminal` for each started process. The terminal:
 *   - Shows live stdout/stderr with ANSI colors
 *   - Accepts stdin (user can type into it)
 *   - Can be killed via the terminal's close button or the stopProcess command
 *   - Tracks process lifecycle (started → running → exited)
 *
 * Usage from extension.ts:
 *   const terminalMgr = new RuntimeTerminalManager();
 *   context.subscriptions.push(terminalMgr);
 *   // Then wire the "start dev server" command to call terminalMgr.start()
 */

import * as vscode from "vscode";
import { logger } from "./Logger.js";

export interface StartTerminalOptions {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export class RuntimeTerminalManager implements vscode.Disposable {
  private readonly terminals = new Map<string, vscode.Terminal>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    // Track terminal close events to clean up.
    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        for (const [id, t] of this.terminals) {
          if (t === terminal) {
            this.terminals.delete(id);
            logger.info(`Terminal closed: ${id}`);
            break;
          }
        }
      })
    );
  }

  /**
   * Start a process in a new VS Code terminal. The terminal shows live output
   * and accepts stdin.
   */
  start(options: StartTerminalOptions): vscode.Terminal {
    // Close any existing terminal with the same name.
    for (const [id, terminal] of this.terminals) {
      if (id.startsWith(options.name)) {
        terminal.dispose();
        this.terminals.delete(id);
      }
    }

    const terminalId = `${options.name}:${Date.now()}`;
    const terminal = vscode.window.createTerminal({
      name: options.name,
      cwd: options.cwd,
      env: options.env
    } as vscode.TerminalOptions);

    this.terminals.set(terminalId, terminal);
    terminal.show(true);

    // Send the command to the terminal.
    const fullCommand = [options.command, ...options.args].join(" ");
    terminal.sendText(fullCommand, true);

    logger.info(`Started terminal: ${options.name} (${terminalId}) — ${fullCommand}`);
    return terminal;
  }

  /**
   * Send text to an existing terminal (e.g., for "restart" or "stop" commands).
   */
  sendText(name: string, text: string): boolean {
    for (const [id, terminal] of this.terminals) {
      if (id.startsWith(name)) {
        terminal.sendText(text, true);
        return true;
      }
    }
    return false;
  }

  /**
   * Stop a terminal by name. Sends Ctrl+C then disposes.
   */
  stop(name: string): boolean {
    for (const [id, terminal] of this.terminals) {
      if (id.startsWith(name)) {
        // Send Ctrl+C to stop the process.
        terminal.sendText("\x03", false);
        setTimeout(() => terminal.dispose(), 500);
        this.terminals.delete(id);
        logger.info(`Stopped terminal: ${name}`);
        return true;
      }
    }
    return false;
  }

  /**
   * List all active terminals.
   */
  list(): Array<{ id: string; name: string }> {
    return Array.from(this.terminals.entries()).map(([id, terminal]) => ({
      id,
      name: terminal.name
    }));
  }

  dispose(): void {
    for (const terminal of this.terminals.values()) {
      terminal.dispose();
    }
    this.terminals.clear();
    this.disposables.forEach((d) => d.dispose());
  }
}
