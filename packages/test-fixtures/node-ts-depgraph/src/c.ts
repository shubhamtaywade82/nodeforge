import { createApp } from "./a.js";

export function helperC(): string {
  // This creates a circular dependency: c → a → b → c
  const app = createApp();
  return `C got app: ${typeof app}`;
}
