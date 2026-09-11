let customConfig = [];
let hasIgnoresFile = false;
try {
  require.resolve('./eslint.ignores.cjs');
  hasIgnoresFile = true;
} catch {
  // eslint.ignores.cjs doesn't exist
}

if (hasIgnoresFile) {
  const ignores = require('./eslint.ignores.cjs');
  customConfig = [{ignores}];
}

module.exports = [
  ...customConfig,
  ...require('gts'),
  {
    // Tests and the vitest config live outside the build tsconfig (which emits
    // from src only), so point the type-aware rules at a lint-only project
    // that covers them.
    files: ['test/**/*.ts', '*.mts'],
    languageOptions: {
      parserOptions: {project: './tsconfig.test.json'},
    },
  },
];
