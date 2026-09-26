---
name: nodeforge-review
description: Review the current Node.js or TypeScript changes for correctness, maintainability, unnecessary complexity, and missing tests.
agent: NodeForge Engineer
---

Inspect the current Git diff and relevant project context first.

Review only the changed scope. Identify:
- correctness and type-safety risks;
- error-handling, cancellation, and resource-lifecycle issues;
- unnecessary abstractions or duplication;
- compatibility problems with the project's actual Node.js and TypeScript versions;
- missing or weak tests.

Do not rewrite unrelated code. Distinguish verified findings from suggestions.
