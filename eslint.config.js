import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Reported, but not an error. The remaining `any` annotations sit at
      // boundaries with untyped third-party code — the RDKit WebAssembly
      // bindings, Chart.js callback contexts, and 3Dmol.js — none of which ship
      // type definitions. Asserting a hand-written interface at those
      // boundaries would claim a guarantee the library does not give, so `any`
      // is the honest annotation there rather than technical debt to repay.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Conventional opt-out marker for deliberately unused bindings, e.g. the
      // error parameter of a catch that intentionally swallows.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // The three rules below report on architecture rather than correctness:
      // render-performance hints from the React Compiler, and a dev-server
      // ergonomics rule about which files may export non-components. Each
      // points at a real design question worth revisiting, but none describes a
      // defect, and restructuring effects and module boundaries to satisfy them
      // would risk behavioural regressions for no functional gain. Reported so
      // they stay visible; not gating.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/incompatible-library': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    // Playwright test files. The react-hooks plugin reads Playwright's `use()`
    // fixture callback as a React hook and reports rules-of-hooks violations
    // that have nothing to do with React; none of these rules apply here.
    files: ['e2e/**/*.{ts,tsx}', 'playwright.config.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
])
