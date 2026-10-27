import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/', 'public/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/worker.js', 'src/seg/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // `const { gen, ...rest } = x` is how a field is left out.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Workers have no window or document, so lint catches them.
    files: ['src/worker.js', 'src/seg/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.worker },
  },
  {
    files: ['scripts/**/*.mjs', 'test/**/*.js', '*.config.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
  },
  {
    // Playwright scripts pass functions to page.evaluate, which run in the page.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
