import path from 'node:path'
import { includeIgnoreFile } from '@eslint/compat'
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import svelte from 'eslint-plugin-svelte'
import perfectionist from 'eslint-plugin-perfectionist'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import ts from 'typescript-eslint'
import svelteConfig from './svelte.config.js'

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore')

/** Ban `$effect` / `$effect.pre` for control flow (see AGENTS.md / no-svelte-effect). */
const noEffectRestrictedSyntax = [
  {
    selector: "CallExpression[callee.name='$effect']",
    message:
      'Do not use $effect for control flow. Prefer onMount, event handlers, store.subscribe in onMount, or $derived. See AGENTS.md § Svelte: no $effect for control flow.',
  },
  {
    selector: "CallExpression[callee.object.name='$effect'][callee.property.name='pre']",
    message:
      'Do not use $effect.pre for control flow. Prefer onMount, event handlers, or $derived. See AGENTS.md § Svelte: no $effect for control flow.',
  },
]

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: {
      perfectionist,
    },
    rules: {
      // typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
      // see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
      'no-undef': 'off',
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'perfectionist/sort-imports': [
        'warn',
        {
          type: 'natural',
          order: 'asc',
          groups: [
            'type-import',
            'value-builtin',
            'value-external',
            'svelte-app',
            'value-internal',
            ['value-parent', 'value-sibling', 'value-index'],
            'unknown',
          ],
          customGroups: [
            {
              groupName: 'svelte-app',
              elementNamePattern: ['^\\$app/', '^\\$env/', '^\\$service-worker'],
            },
            {
              groupName: 'value-internal',
              elementNamePattern: ['^\\$lib/'],
            },
          ],
          newlinesBetween: 'ignore',
        },
      ],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig,
      },
    },
    rules: {
      'svelte/no-target-blank': 'error',
      // Ban $effect for control flow — Phase 6 migrates remaining call sites.
      // Kept as error so new $effect cannot land; existing sites are fixed in Phase 6.
      'no-restricted-syntax': ['error', ...noEffectRestrictedSyntax],
    },
  },
  {
    files: ['src/lib/server/**/*.{ts,js}', 'scripts/**/*.{ts,js,mjs}', 'evals/**/*.{ts,js}'],
    rules: {
      // Server/scripts may log for observability.
      'no-console': 'off',
    },
  },
  {
    // Ambient / generated declaration files often require `interface` for merging.
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/consistent-type-definitions': 'off',
    },
  },
)
