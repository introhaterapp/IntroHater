import globals from "globals";
import pluginJs from "@eslint/js";


/** @type {import('eslint').Linter.Config[]} */
export default [
  { languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.jest, API_BASE_URL: "readonly", bootstrap: "readonly" } } },
  pluginJs.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "no-empty": ["error", { "allowEmptyCatch": true }]
    }
  }
];