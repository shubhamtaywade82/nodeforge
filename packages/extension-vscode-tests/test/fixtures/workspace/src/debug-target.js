// Launched under the debugger by the integration tests; reports env injected by NodeForge.
const fs = require("node:fs");
fs.writeFileSync(process.env.NF_OUT, `${process.env.NF_FIXTURE_VAR ?? "missing"}`);
