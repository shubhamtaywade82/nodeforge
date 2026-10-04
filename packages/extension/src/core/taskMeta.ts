/**
 * Pure classification of package.json scripts into VS Code task metadata.
 * No `vscode` import — see `NodeForgeTaskProvider` for the wiring.
 */

export type PackageManager = "npm" | "pnpm" | "yarn";
export type TaskGroupKind = "build" | "test" | "clean";

export interface ScriptTaskMeta {
  /** Built-in VS Code problem matcher references, e.g. `$tsc`. */
  readonly problemMatchers: string[];
  readonly group?: TaskGroupKind;
  /** Long-running watcher/server: the task never "finishes" on its own. */
  readonly isBackground: boolean;
}

const WATCH_FLAG = /(?:^|\s)(?:--watch|-w)(?:\s|=|$)/;
const BACKGROUND_NAME = /^(?:dev|start|serve|watch)(?::|$)/;

export function classifyScript(name: string, command: string): ScriptTaskMeta {
  const watching = WATCH_FLAG.test(command);
  const problemMatchers: string[] = [];

  if (/(?:^|[\s&;|])tsc(?:\s|$)/.test(command)) {
    problemMatchers.push(watching ? "$tsc-watch" : "$tsc");
  }
  if (/(?:^|[\s&;|])eslint(?:\s|$)/.test(command)) {
    problemMatchers.push("$eslint-stylish");
  }

  let group: TaskGroupKind | undefined;
  if (/^(?:build|compile)(?::|$)/.test(name)) group = "build";
  else if (/^test(?::|$)/.test(name)) group = "test";
  else if (/^clean(?::|$)/.test(name)) group = "clean";

  return {
    problemMatchers,
    ...(group ? { group } : {}),
    isBackground: watching || BACKGROUND_NAME.test(name)
  };
}

export interface ScriptInvocation {
  readonly command: PackageManager;
  readonly args: string[];
}

export function scriptInvocation(pm: PackageManager, script: string): ScriptInvocation {
  return { command: pm, args: pm === "yarn" ? [script] : ["run", script] };
}
