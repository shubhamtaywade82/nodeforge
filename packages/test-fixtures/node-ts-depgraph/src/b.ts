import { helperC } from "./c.js";

export function helperB(): string {
  return `B calls ${helperC()}`;
}
