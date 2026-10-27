import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const script = readFileSync(new URL('./apply-rls.mjs', import.meta.url), 'utf8')
const rls = readFileSync(new URL('../src/lib/server/db/enable_rls.sql', import.meta.url), 'utf8')

describe('apply-rls', () => {
  it('pins search_path to public before running enable_rls.sql (like migrate.mjs)', () => {
    const pin = script.indexOf("SET search_path TO public")
    const run = script.indexOf('sql.unsafe(body)')
    expect(pin).toBeGreaterThan(-1)
    expect(pin).toBeLessThan(run)
  })

  it('removes the ag_catalog strays of every function enable_rls.sql defines', () => {
    for (const fn of [
      'ag_catalog.resolve_user_api_key(text)',
      'ag_catalog.touch_user_api_key(uuid)',
      'ag_catalog.resolve_agent_callback_token(text)',
      'ag_catalog.board_scores()',
      'ag_catalog.board_admin_update(uuid, text, boolean, text, boolean, boolean)',
      'ag_catalog.board_idea_guard_protected_columns()',
    ]) {
      expect(rls).toContain(`DROP FUNCTION IF EXISTS ${fn};`)
    }
  })
})
