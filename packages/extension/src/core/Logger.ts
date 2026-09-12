/**
 * Logger — single output channel for all NodeForge log messages.
 *
 * Replaces the ~15 `console.error` / `console.log` calls scattered across
 * the extension with a visible "NodeForge" Output channel that users can
 * actually open (`View → Output → NodeForge`).
 *
 * Usage:
 *   import { logger } from "./Logger.js";
 *   logger.info("message");
 *   logger.error("message", err);
 */

import * as vscode from "vscode";

class Logger {
  private channel: vscode.OutputChannel | undefined;

  /** Lazily create the output channel on first use. */
  private getChannel(): vscode.OutputChannel {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel("NodeForge");
    }
    return this.channel;
  }

  info(message: string): void {
    this.getChannel().appendLine(`[INFO] ${message}`);
  }

  warn(message: string): void {
    this.getChannel().appendLine(`[WARN] ${message}`);
  }

  error(message: string, err?: unknown): void {
    const detail = err instanceof Error
      ? `${err.name}: ${err.message}`
      : err !== undefined
        ? String(err)
        : "";
    this.getChannel().appendLine(`[ERROR] ${message}${detail ? ` — ${detail}` : ""}`);
  }

  /** Show the output channel in the panel. */
  show(): void {
    this.getChannel().show(true);
  }

  dispose(): void {
    this.channel?.dispose();
  }
}

/** Singleton logger instance. */
export const logger = new Logger();
