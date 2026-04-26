import tseslint from 'typescript-eslint';

export default [
  {
    files: ['src/core/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/store',
                '**/store/**',
                '**/input',
                '**/input/**',
                '**/animation',
                '**/animation/**',
                '**/renderer',
                '**/renderer/**',
                '**/assets',
                '**/assets/**',
              ],
              message:
                'src/core/** is the pure layer and must not import from sibling layers (store, input, animation, renderer, assets).',
            },
          ],
        },
      ],
    },
  },
];
