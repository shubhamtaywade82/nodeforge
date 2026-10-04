/**
 * Risk classification for package.json scripts, used to give the user an honest confirmation
 * before `runScript` executes project-controlled commands. Pure: no I/O.
 *
 * This informs the human; it is not a sandbox. Scripts are arbitrary shell.
 */

export type ScriptRiskLevel = "low" | "medium" | "high";

export type ScriptCategory =
  | "verification"
  | "build"
  | "dev-server"
  | "mutates-files"
  | "mutates-data"
  | "network"
  | "external-effect"
  | "unknown";

export interface ScriptRiskReason {
  readonly category: ScriptCategory;
  readonly detail: string;
}

export interface ScriptRisk {
  readonly script: string;
  readonly level: ScriptRiskLevel;
  readonly categories: ScriptCategory[];
  readonly reasons: ScriptRiskReason[];
  /** The commands that will run: the script itself, scripts it calls, and implicit pre/post hooks. */
  readonly commands: Array<{ readonly name: string; readonly command: string; readonly hook?: "pre" | "post" }>;
}

interface Rule {
  readonly category: ScriptCategory;
  readonly pattern: RegExp;
  readonly detail: string;
}

/** Matched against the script *command*. Order does not matter; every match is reported. */
const COMMAND_RULES: readonly Rule[] = [
  { category: "external-effect", pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:publish|deprecate|unpublish|dist-tag)\b/, detail: "publishes to a package registry" },
  { category: "external-effect", pattern: /\bdocker\s+(?:push|login)\b|\bkubectl\b|\bhelm\s+(?:install|upgrade|uninstall|rollback)\b|\bterraform\s+(?:apply|destroy)\b|\bpulumi\s+(?:up|destroy)\b/, detail: "changes remote infrastructure" },
  { category: "external-effect", pattern: /\bgit\s+push\b|\bgh\s+(?:release|pr\s+merge|repo\s+delete)\b/, detail: "pushes to or changes a remote repository" },
  { category: "external-effect", pattern: /\b(?:vercel|netlify|wrangler|firebase|serverless|sls|cdk|flyctl|fly|heroku|railway|amplify)\s+(?:deploy|publish|up|release)\b|\baws\s+\S+\s+(?:deploy|put|sync|cp|rm|delete)\b|\bgcloud\b.*\b(?:deploy|delete)\b|\baz\s+\S+\s+(?:deploy|create|delete)\b/, detail: "deploys to or changes a cloud service" },
  { category: "mutates-data", pattern: /\bprisma\s+(?:migrate\s+(?:deploy|dev|reset)|db\s+(?:push|execute))\b|\bdrizzle-kit\s+(?:push|migrate|drop)\b|\bknex\s+(?:migrate|seed)\b|\btypeorm\b.*\bmigration:(?:run|revert)\b|\bsequelize(?:-cli)?\s+db:(?:migrate|seed)\b|\bmikro-orm\s+migration:up\b|\b(?:psql|mysql|mongosh|redis-cli)\b/, detail: "changes a database" },
  { category: "mutates-files", pattern: /\brm\s+-[a-z]*[rf]|\brimraf\b|\bdel(?:ete)?\s+\/|\bgit\s+(?:clean|reset|checkout\s+--|rebase|commit|stash\s+drop)\b|\bsed\s+-i\b|\bchmod\b|\bchown\b/, detail: "deletes or rewrites files" },
  { category: "mutates-files", pattern: /--(?:write|fix)\b|\bformat\b.*--write|\beslint\b.*--fix|\bprettier\b.*(?:--write|-w)\b|\bbiome\b.*--(?:write|apply)/, detail: "rewrites source files" },
  { category: "network", pattern: /\b(?:curl|wget|http|nc|ssh|scp|rsync)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|update|up|ci|dlx|exec)\b|\bnpx\b/, detail: "uses the network or installs/runs downloaded packages" },
  { category: "dev-server", pattern: /\b(?:vite|next\s+dev|nodemon|ts-node-dev|tsx\s+watch|webpack\s+serve|nuxt\s+dev|astro\s+dev|serve|http-server)\b|--watch\b|\bnode\b.*\b(?:server|index|app)\b/, detail: "starts a long-running process" },
  { category: "build", pattern: /\b(?:tsc|esbuild|rollup|webpack|vite\s+build|next\s+build|swc|tsup|turbo|nx)\b/, detail: "builds the project" },
  { category: "verification", pattern: /\b(?:vitest|jest|mocha|ava|playwright|cypress|eslint|biome\s+(?:lint|check|ci)|prettier\s+--check|tsc\b.*--noEmit)\b|\bnode\s+--test\b/, detail: "runs checks or tests" }
];

/** Matched against the script *name* when the command alone says little. */
const NAME_RULES: readonly Rule[] = [
  { category: "external-effect", pattern: /^(?:deploy|publish|release|ship|promote|rollback|destroy|teardown|provision|prod)\b/i, detail: "script name suggests a deployment or release" },
  { category: "mutates-data", pattern: /^(?:migrate|migration|seed|db:|reset-db|drop)\b/i, detail: "script name suggests a database change" },
  { category: "mutates-files", pattern: /^(?:clean|reset|fix|format|codegen|generate)\b/i, detail: "script name suggests it rewrites files" },
  { category: "dev-server", pattern: /^(?:dev|start|serve|watch)\b/i, detail: "script name suggests a long-running process" },
  { category: "verification", pattern: /^(?:test|lint|typecheck|check|coverage|e2e|verify)\b/i, detail: "script name suggests checks or tests" },
  { category: "build", pattern: /^(?:build|compile|bundle|package)\b/i, detail: "script name suggests a build" }
];

const HIGH_RISK: ReadonlySet<ScriptCategory> = new Set(["external-effect", "mutates-data", "mutates-files"]);
const MEDIUM_RISK: ReadonlySet<ScriptCategory> = new Set(["network", "dev-server", "unknown"]);

const MAX_CHAIN_DEPTH = 4;
const SCRIPT_CALL = /\b(?:npm|pnpm|yarn|bun)\s+(?:run(?:-script)?\s+)?([\w:.-]+)/g;

function hookNames(name: string): string[] {
  return [`pre${name}`, `post${name}`];
}

/** Scripts reachable from `name`: itself, its pre/post hooks, and scripts it invokes. */
type ChainEntry = { name: string; command: string; hook?: "pre" | "post" };

function collectChain(
  name: string,
  scripts: Readonly<Record<string, string>>,
  seen: Set<string>,
  depth: number,
  hook?: "pre" | "post"
): ChainEntry[] {
  if (seen.has(name) || depth > MAX_CHAIN_DEPTH) return [];
  const command = scripts[name];
  if (command === undefined) return [];
  seen.add(name);

  const chain: ChainEntry[] = [];
  const [preName, postName] = hookNames(name) as [string, string];
  chain.push(...collectChain(preName, scripts, seen, depth + 1, "pre"));
  chain.push(hook ? { name, command, hook } : { name, command });
  for (const match of command.matchAll(SCRIPT_CALL)) {
    const called = match[1];
    if (called && called !== name && scripts[called] !== undefined) {
      chain.push(...collectChain(called, scripts, seen, depth + 1));
    }
  }
  chain.push(...collectChain(postName, scripts, seen, depth + 1, "post"));
  return chain;
}

export function classifyPackageScript(script: string, scripts: Readonly<Record<string, string>>): ScriptRisk {
  const chain = collectChain(script, scripts, new Set(), 0);
  const reasons: ScriptRiskReason[] = [];
  const add = (category: ScriptCategory, detail: string): void => {
    if (!reasons.some((r) => r.category === category && r.detail === detail)) reasons.push({ category, detail });
  };

  for (const entry of chain) {
    for (const rule of COMMAND_RULES) {
      if (rule.pattern.test(entry.command)) {
        add(rule.category, entry.name === script ? rule.detail : `${rule.detail} (via "${entry.name}")`);
      }
    }
    // Shell redirection writes files too.
    if (/(?:^|[^>])>{1,2}\s*[^\s&|]/.test(entry.command) && !/2>&1|>\s*\/dev\/null/.test(entry.command)) {
      add("mutates-files", entry.name === script ? "redirects output into a file" : `redirects output into a file (via "${entry.name}")`);
    }
  }

  // The script's own name is a weak signal; use it when commands were not conclusive, and always
  // let a dangerous name (deploy/migrate/...) raise the level even if the command looks harmless.
  for (const rule of NAME_RULES) {
    if (rule.pattern.test(script) && (HIGH_RISK.has(rule.category) || reasons.length === 0)) add(rule.category, rule.detail);
  }

  if (chain.length === 0) add("unknown", "the script is not defined in package.json");
  else if (reasons.length === 0) add("unknown", "the command is not recognized, so its effects cannot be predicted");

  const categories = [...new Set(reasons.map((r) => r.category))];
  const level: ScriptRiskLevel = categories.some((c) => HIGH_RISK.has(c))
    ? "high"
    : categories.some((c) => MEDIUM_RISK.has(c))
      ? "medium"
      : "low";

  return { script, level, categories, reasons, commands: chain };
}

/** Markdown for the confirmation dialog. */
export function describeScriptRisk(risk: ScriptRisk, packageManager: string): string {
  const label = { low: "Low", medium: "Medium", high: "High" }[risk.level];
  const lines = [`Run \`${packageManager} run ${risk.script}\`?`, "", `**Risk: ${label}.** Package scripts run arbitrary shell commands.`, ""];
  if (risk.commands.length > 0) {
    lines.push("Commands involved:");
    for (const c of risk.commands.slice(0, 6)) {
      const note = c.hook ? ` _(${c.hook} hook — run implicitly by npm and Yarn Classic)_` : "";
      lines.push(`- \`${c.name}\`: \`${c.command.replace(/`/g, "'").slice(0, 200)}\`${note}`);
    }
    if (risk.commands.length > 6) lines.push(`- …and ${risk.commands.length - 6} more`);
    lines.push("");
  }
  if (risk.reasons.length > 0) {
    lines.push("Why:");
    for (const r of risk.reasons.slice(0, 8)) lines.push(`- ${r.detail}`);
  }
  if (risk.level === "high") {
    lines.push("", "This may modify files or data, or affect systems outside this workspace.");
  }
  return lines.join("\n");
}
