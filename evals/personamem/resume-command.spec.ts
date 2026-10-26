import { describe, expect, it } from 'vitest'
import { buildResumeCommand } from './resume-command'

describe('buildResumeCommand', () => {
  it('is the same invocation with --resume added', () => {
    expect(buildResumeCommand(['--split', 'val', '--run-id', 'rehearsal-1', '--all'])).toBe(
      'caffeinate -i npm run eval:personamem -- --split val --run-id rehearsal-1 --all --resume',
    )
  })

  it('drops --fresh (resume never deletes anything) and --dry-run', () => {
    expect(buildResumeCommand(['--run-id', 'r1', '--fresh', '--dry-run'])).toBe(
      'caffeinate -i npm run eval:personamem -- --run-id r1 --resume',
    )
  })

  it('does not add --resume twice', () => {
    expect(buildResumeCommand(['--run-id', 'r1', '--resume'])).toBe(
      'caffeinate -i npm run eval:personamem -- --run-id r1 --resume',
    )
  })

  it('quotes arguments the shell would split', () => {
    expect(buildResumeCommand(['--run-id', 'r1', '--seed', "it's a seed"])).toBe(
      "caffeinate -i npm run eval:personamem -- --run-id r1 --seed 'it'\\''s a seed' --resume",
    )
  })

  it('refuses an invocation without --run-id (a resume must be one known command)', () => {
    expect(() => buildResumeCommand(['--all'])).toThrow(/--run-id/)
  })
})
