import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "cli/dist", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // omit-pattern destructuring ({ key: _drop, ...rest }) is used for overrides
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    // ANSI escape parsing is the point of these modules; ESC in a regex is intentional
    files: [
      "src/engine/exports.ts",
      "src/engine/exports.test.ts",
      "cli/src/terminal.ts",
      "cli/src/terminal.test.ts",
    ],
    rules: { "no-control-regex": "off" },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": "warn",
    },
  },
  {
    // capture.js is served by tools/capture/index.html and runs in the browser;
    // collect.mjs runs under Node
    files: ["tools/capture/capture.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["tools/capture/collect.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
