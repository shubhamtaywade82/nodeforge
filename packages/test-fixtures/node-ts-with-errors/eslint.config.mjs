// Flat ESLint config fixture with TypeScript support.
// Triggers `no-unused-vars` (TS-aware) and `no-empty` on broken.ts.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node
      }
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "no-undef": "off",
      "no-empty": "warn"
    }
  },
  {
    ignores: ["dist/**", "node_modules/**"]
  }
);
