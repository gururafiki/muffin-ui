// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");
const globals = require("globals");

module.exports = defineConfig([
  expoConfig,
  {
    // `dist/` is the exported web bundle. `.expo/` is Expo's generated cache —
    // its `types/router.d.ts` ships an eslint-disable directive that this config
    // makes redundant, so linting it reports an "unused disable directive"
    // warning about a file nobody here wrote and every `expo start` rewrites.
    ignores: ["dist/*", ".expo/*"],
  },
  {
    // The verification scripts (`scripts/*.mjs`, `scripts/*.ts`) are Node
    // programs, not app code: they run a static server, drive puppeteer and read
    // the filesystem. Without Node globals declared, `Buffer` and friends read as
    // undefined and every one of them reports `no-undef`.
    //
    // Note that `npm run lint` (= `expo lint`) only walks /src, /app and
    // /components, so these files are invisible to it either way — use
    // `npx eslint .` to lint them. This block is what makes that run meaningful
    // rather than a wall of false positives.
    files: ["scripts/**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // False positive for puppeteer-core: its DEFAULT export legitimately has a
      // `.launch` method, and `puppeteer.launch(...)` is the documented usage.
      "import/no-named-as-default-member": "off",
    },
  },
]);
