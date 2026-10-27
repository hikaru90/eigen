import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { finalResponseText } from './final-response'

const page = readFileSync('src/routes/chat/+page.svelte', 'utf8')

/** What the server streams in `done.response` when answer_question ran and thoughts were proposed. */
const answerWithProposal = [
  'You started the garden plan in March and the tomatoes went in last week.',
  "I'd store these in your mesh:\n\n1. Tomatoes went into the raised bed last week.\n2. Garden plan started in March.\n\nSay yes to store them, or tell me what to change.",
].join('\n\n')

describe('finalResponseText', () => {
  it('shows the server answer as it is, appendix included: the server already sanitised it', () => {
    expect(finalResponseText(answerWithProposal)).toBe(answerWithProposal)
  })

  it('trims surrounding whitespace only', () => {
    expect(finalResponseText(`\n  ${answerWithProposal}  \n`)).toBe(answerWithProposal)
  })

  it('does not re-read the text: section-looking lines stay where the server put them', () => {
    const text = 'Answer: forty-two\n\nEvidence: the notebook\n\nNote: stored 1 thought.'
    expect(finalResponseText(text)).toBe(text)
  })

  it('refuses an empty response out loud', () => {
    expect(() => finalResponseText('')).toThrow('The assistant returned an empty response.')
    expect(() => finalResponseText('  \n ')).toThrow('The assistant returned an empty response.')
    expect(() => finalResponseText(undefined)).toThrow('The assistant returned an empty response.')
  })
})

describe('the Ask page takes the final text from the server', () => {
  it('uses done.response as it is and keeps no client-side replacement by the answer_question preview', () => {
    expect(page).toContain('finalResponseText(done.response)')
    expect(page).not.toContain('sanitizeFinalAnswerText')
    expect(page).not.toContain('lastAnswerQuestionPreview')
  })
})
