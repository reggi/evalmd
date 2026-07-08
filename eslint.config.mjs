import base from '@ljharb/eslint-config';
import ljharbConfig from '@ljharb/eslint-config/flat/node/4';
import stylistic from '@stylistic/eslint-plugin';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

const deprecatedParens = /** @type {const} */ ([
  'enforceForArrowConditionals',
  'enforceForNewInMemberExpressions',
]);
const [, ...noExtraParensOptions] = base.rules['no-extra-parens'].map((opt) => (
  opt && typeof opt === 'object'
    ? Object.fromEntries(Object.entries(opt).filter(([key]) => !deprecatedParens.includes(key)))
    : opt
));

/** @type {Record<string, unknown>} */
const overrides = {
  'func-style': 'off',
  'id-length': 'off',
  indent: [
    'error',
    2,
    { SwitchCase: 1 },
  ],
  'max-len': 'off',
  'max-lines': 'off',
  'max-nested-callbacks': 'off',
  'max-params': 'off',
  'no-extra-parens': 'off', // strips JSDoc `/** @type */ (cast)` parens on --fix
  'sort-keys': 'off',
};

// core rules the TypeScript compiler already enforces (`no-undef`, `no-redeclare`, `no-dupe-keys`, ...)
const redundant = tsPlugin.configs['eslint-recommended'].overrides?.[0]?.rules ?? {};

/** @type {Record<string, unknown>} */
const extensionSwaps = {};
Object.entries(tsPlugin.rules).forEach(([name, rule]) => {
  const docs = rule.meta && rule.meta.docs;
  if (!docs || !docs.extendsBaseRule || docs.requiresTypeChecking) { return; }
  const core = typeof docs.extendsBaseRule === 'string' ? docs.extendsBaseRule : name;
  if (core in base.rules && overrides[core] !== 'off') {
    extensionSwaps[core] = 'off';
    extensionSwaps[`@typescript-eslint/${name}`] = base.rules[core];
  }
});

export default [
  {
    ignores: ['dist/'],
  },

  ...ljharbConfig,

  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'max-statements-per-line': ['error', { max: 2 }],
    },
  },

  {
    rules: overrides,
  },

  {
    files: ['./src/eval-markdown.js'],
    rules: {
      'max-lines-per-function': 'off',
      'max-statements-per-line': ['error', { max: 2 }],
      'no-param-reassign': 'warn',
      'no-shadow': 'warn',
    },
  },

  {
    files: [
      '**/*.ts',
      '**/*.mts',
      '**/*.cts',
      '**/*.tsx',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@stylistic': stylistic,
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...redundant,
      ...extensionSwaps,
      ...overrides,
      '@stylistic/indent': [
        'error',
        2,
        { SwitchCase: 1 },
      ],
      '@stylistic/no-extra-parens': ['error', ...noExtraParensOptions],
      '@stylistic/no-mixed-spaces-and-tabs': 'error',
      'comma-dangle': ['error', 'always-multiline'],
      indent: 'off',
      'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
      'no-extra-parens': 'off',
      'no-mixed-spaces-and-tabs': 'off',
      'object-shorthand': ['error', 'always'],
      'prefer-const': 'error',
      'quote-props': [
        'error',
        'as-needed',
        { keywords: false },
      ],
    },
  },

  {
    files: ['./src/script.ts'],
    rules: {
      'array-bracket-newline': 'off',
      'dot-notation': ['error', { allowKeywords: true }],
      'no-process-exit': 'off',
    },
  },

  {
    files: ['./src/acorn-umd/acorn-umd.ts'],
    rules: {
      'consistent-return': 'warn',
      'no-param-reassign': 'warn',
      'no-restricted-syntax': 'warn',
    },
  },
];
