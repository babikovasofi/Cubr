import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  {
    // Tailwind config is CommonJS (module.exports) despite the package "type":"module".
    files: ["tailwind.config.js"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      // TS parser so `type` imports / annotations parse (espree chokes on them).
      parser: tseslint.parser,
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // TS handles these via the compiler; the base rules false-positive on TS
      // types + DOM/lib globals (DOMHighResTimeStamp, MediaStream, …).
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  },
];
