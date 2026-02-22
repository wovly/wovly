const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');

module.exports = [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // Disable overly strict rules for now
      '@typescript-eslint/explicit-function-return-type': 'off',
      'complexity': 'off',
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': ['warn', { allow: ['error', 'warn', 'log'] }],
      'no-undef': 'off', // TypeScript handles this
    },
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.test.json',
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      'complexity': 'off',
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
    },
  },
];
