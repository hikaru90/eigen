/**
 * Standalone Vite config for the eval harness.
 *
 * The main `vite.config.ts` loads the SvelteKit plugin, which throws when
 * executed outside the SvelteKit dev/build lifecycle (notably under `vite-node`).
 * The eval harness only needs:
 *   - the `$lib` alias mapped to `src/lib`
 *   - a stub for `$env/dynamic/private` that exposes `process.env`
 *   - a stub for `$app/environment` (eval scripts are never the dev server)
 *
 * Anything beyond that should remain in the main config.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const STUB_ENV_ID = '\0eigen-eval/env-dynamic-private'
const STUB_APP_ENVIRONMENT_ID = '\0eigen-eval/app-environment'

function envDynamicPrivateStub(): Plugin {
  return {
    name: 'eigen-eval-env-dynamic-private-stub',
    resolveId(source) {
      if (source === '$env/dynamic/private') return STUB_ENV_ID
      if (source === '$app/environment') return STUB_APP_ENVIRONMENT_ID
      return null
    },
    load(id) {
      if (id === STUB_ENV_ID) return `export const env = process.env;`
      if (id === STUB_APP_ENVIRONMENT_ID) {
        return `export const dev = false; export const browser = false; export const building = false; export const version = '';`
      }
      return null
    },
  }
}

export default defineConfig({
  plugins: [envDynamicPrivateStub()],
  resolve: {
    alias: {
      $lib: resolve(__dirname, '../src/lib'),
    },
  },
})
