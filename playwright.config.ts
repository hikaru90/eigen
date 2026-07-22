import path from 'node:path'
import dotenv from 'dotenv'
import { defineConfig } from '@playwright/test'

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true, override: true })

const slowMo = process.env.PW_SLOW_MO ? Number(process.env.PW_SLOW_MO) : undefined
const isCi = Boolean(process.env.CI)

/** webServer readiness poll uses Node fetch — keep 127.0.0.1 because localhost resolves to ::1, which Vite often does not bind. */
const devUrl = 'http://127.0.0.1:5173'
/** Browser baseURL must match ORIGIN (localhost) so Better Auth serves /api/auth/* (e.g. email verification links) on the same host it signs cookies for. */
const devBrowserUrl = 'http://localhost:5173'
const previewUrl = 'http://127.0.0.1:4173'

export default defineConfig({
  webServer: isCi
    ? {
        command: 'npm run build && npm run preview',
        url: previewUrl,
        timeout: 300_000,
        reuseExistingServer: false,
      }
    : {
        url: devUrl,
        command: 'vite dev --host',
        timeout: 120_000,
        reuseExistingServer: true,
      },
  testMatch: '**/*.e2e.{ts,js}',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: isCi ? previewUrl : devBrowserUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      args: ['--disable-popup-blocking'],
      ...(slowMo ? { slowMo } : {}),
    },
  },
})
