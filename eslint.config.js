import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import-x';
import tailwindCanonicalClasses from 'eslint-plugin-tailwind-canonical-classes';
import clickUiPlugin from 'eslint-plugin-click-ui';
import requireButtonHtmlType from './tools/eslint-plugin-click-ui/rules/require-button-html-type.js';

/** Loads rules from the in-repo plugin source so a stale installed copy cannot hide new rules. */
const clickUi = {
  ...clickUiPlugin,
  rules: { ...clickUiPlugin.rules, 'require-button-html-type': requireButtonHtmlType },
};

export default [
  {
    ignores: ['src/routeTree.gen.ts'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'import-x': importPlugin,
      'tailwind-canonical-classes': tailwindCanonicalClasses,
      'click-ui': clickUi,
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': false }],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tanstack/start-server-core',
              message: 'Use @tanstack/react-start/server instead.',
            },
          ],
        },
      ],
      semi: ['error', 'always'],
      'no-nested-ternary': 'warn',
      'no-constant-binary-expression': 'warn',
      'import-x/no-duplicates': ['error', { 'prefer-inline': false }],
      'import-x/no-cycle': 'error',
      'import-x/no-self-import': 'error',
      'tailwind-canonical-classes/tailwind-canonical-classes': [
        'warn',
        { cssPath: './src/styles.css' },
      ],
      ...clickUiPlugin.configs.recommended.rules,
      'click-ui/require-provider': 'off',
      'click-ui/select-requires-options': 'off',
      'click-ui/require-button-html-type': 'error',
    },
  },
];
