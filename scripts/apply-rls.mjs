import './load-env.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { getDatabaseUrl } from './db-urls.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const urlString = getDatabaseUrl()

const sqlPath = path.join(__dirname, '..', 'src', 'lib', 'server', 'db', 'enable_rls.sql')
const body = fs.readFileSync(sqlPath, 'utf8')

const sql = postgres(urlString, { max: 1 })
try {
  await sql.unsafe(body)
  console.log('[eigen] RLS applied successfully.')
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[eigen] apply-rls failed: ${message}`)
  console.error(
    '[eigen] Check that DATABASE_URL is correct, the database is accessible, and migrations have been applied.',
  )
  process.exit(1)
} finally {
  await sql.end()
}
