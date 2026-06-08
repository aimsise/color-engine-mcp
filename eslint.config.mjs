import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        // tsconfig.json excludes test files (so they are not emitted to dist),
        // which means the typed-linting project service cannot resolve them.
        // Use a dedicated lint tsconfig that includes every src file (tests
        // included) so all linted files resolve to a typed program.
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  }
);
