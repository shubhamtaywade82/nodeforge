/**
 * esbuild bundling for the NodeForge VS Code extension.
 *
 * Output: dist/extension.cjs (CommonJS so the VS Code extension host can load it)
 *
 * Why CommonJS when the source is ESM: VS Code's stable extension host still
 * loads extensions via require(), which is CommonJS. We bundle into a single
 * .cjs file with esbuild so the source can use ESM + workspace:* packages
 * without shipping multiple .js files.
 */

import { build } from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: "dist/extension.cjs",
  external: ["vscode"],
  sourcemap: production ? false : "inline",
  minify: production,
  legalComments: "none",
  logLevel: "info"
};

if (watch) {
  const ctx = await build({ ...options, watch: true });
  // Keep the process alive.
  process.stdin.pipe(process.stdin);
  // esbuild context never resolves — the await above returns once watch is set up.
  // The pipe is just to keep the script running.
  void ctx;
} else {
  await build(options);
}
