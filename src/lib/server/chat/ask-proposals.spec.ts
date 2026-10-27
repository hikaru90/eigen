import { describe, expect, it, vi } from 'vitest'

vi.mock('$lib/paraglide/messages.js', () => ({
  m: {
    ask_proposal_lead_in: () => 'LEAD',
    ask_proposal_footer: () => 'FOOT',
  },
}))

import {
  ASK_PROPOSAL_TOOL_NAMES,
  findOpenProposal,
  isProposalToolStep,
  PROPOSAL_MAX_THOUGHT_CHARS,
  PROPOSAL_MAX_THOUGHTS,
  readProposalFromResult,
  renderProposalBlock,
  validateProposedThoughts,
} from './ask-proposals'

type Row = { role: string; content: string; metadata: unknown }

const user = (content = 'msg'): Row => ({ role: 'user', content, metadata: null })
const answer = (content = 'ok'): Row => ({ role: 'assistant', content, metadata: null })
const proposalStep = (
  proposalId: string,
  thoughts: string[],
  extra: { failed?: boolean; variant?: string } = {},
): Row => ({
  role: 'assistant',
  content: JSON.stringify({ proposalId, thoughts }),
  metadata: {
    variant: extra.variant ?? 'tool_step',
    tool: 'propose_thoughts',
    arguments: { thoughts },
    failed: extra.failed === true,
  },
})

describe('readProposalFromResult', () => {
  it('reads a well-formed proposal result', () => {
    expect(readProposalFromResult({ proposalId: 'p1', thoughts: ['a', 'b'] })).toEqual({
      proposalId: 'p1',
      thoughts: ['a', 'b'],
    })
  })

  it('rejects error results, blank ids, empty lists and non-string thoughts', () => {
    expect(readProposalFromResult({ error: 'nope' })).toBeNull()
    expect(readProposalFromResult({ proposalId: ' ', thoughts: ['a'] })).toBeNull()
    expect(readProposalFromResult({ proposalId: 'p1', thoughts: [] })).toBeNull()
    expect(readProposalFromResult({ proposalId: 'p1', thoughts: ['a', 3] })).toBeNull()
    expect(readProposalFromResult({ proposalId: 'p1', thoughts: ['a', '  '] })).toBeNull()
    expect(readProposalFromResult(null)).toBeNull()
    expect(readProposalFromResult('x')).toBeNull()
  })
})

describe('validateProposedThoughts', () => {
  it('trims and returns the thoughts', () => {
    expect(validateProposedThoughts([' a ', 'b'])).toEqual(['a', 'b'])
  })

  it('rejects ambiguous shapes with the exact constraint', () => {
    expect(() => validateProposedThoughts('a')).toThrow(/thoughts must be an array/)
    expect(() => validateProposedThoughts([])).toThrow(/at least one thought/)
    expect(() => validateProposedThoughts(['a', ''])).toThrow(/thoughts\[1\]/)
    expect(() => validateProposedThoughts(['a', 5])).toThrow(/thoughts\[1\]/)
    expect(() =>
      validateProposedThoughts(Array.from({ length: PROPOSAL_MAX_THOUGHTS + 1 }, () => 'x')),
    ).toThrow(new RegExp(`at most ${PROPOSAL_MAX_THOUGHTS}`))
    expect(() => validateProposedThoughts(['x'.repeat(PROPOSAL_MAX_THOUGHT_CHARS + 1)])).toThrow(
      new RegExp(`${PROPOSAL_MAX_THOUGHT_CHARS} characters`),
    )
  })
})

describe('findOpenProposal (AP-4: latest, directly-next user turn only)', () => {
  it('is null when the session has no proposal', () => {
    expect(findOpenProposal([user('hi'), answer('hello'), user('thanks')])).toBeNull()
  })

  it('is open in the user turn directly after the proposal', () => {
    const rows = [
      user('I started bouldering'),
      proposalStep('p1', ['Starts bouldering on Tuesdays']),
      answer('I would store these'),
      user('yes'),
    ]
    expect(findOpenProposal(rows)).toEqual({
      proposalId: 'p1',
      thoughts: ['Starts bouldering on Tuesdays'],
    })
  })

  it('is closed one turn later — a stale proposal cannot be confirmed (AC-4)', () => {
    const rows = [
      user('I started bouldering'),
      proposalStep('p1', ['Starts bouldering on Tuesdays']),
      answer('I would store these'),
      user('what is on my list?'),
      answer('Nothing'),
      user('yes'),
    ]
    expect(findOpenProposal(rows)).toBeNull()
  })

  it('is closed before the user has replied (the proposal turn itself)', () => {
    const rows = [user('I started bouldering'), proposalStep('p1', ['x']), answer('store?')]
    expect(findOpenProposal(rows)).toBeNull()
  })

  it('the latest proposal supersedes an earlier one (revise)', () => {
    const rows = [
      user('a'),
      proposalStep('p1', ['old']),
      answer('store?'),
      user('change it'),
      proposalStep('p2', ['new']),
      answer('store this?'),
      user('yes'),
    ]
    expect(findOpenProposal(rows)).toEqual({ proposalId: 'p2', thoughts: ['new'] })
  })

  it('a failed or unparseable proposal row never opens a proposal', () => {
    const failed = [
      user('a'),
      proposalStep('p1', ['x'], { failed: true }),
      answer('s'),
      user('yes'),
    ]
    expect(findOpenProposal(failed)).toBeNull()
    const garbage: Row[] = [
      user('a'),
      {
        role: 'assistant',
        content: '{"error":"bad"}',
        metadata: { variant: 'tool_step', tool: 'propose_thoughts', failed: false },
      },
      answer('s'),
      user('yes'),
    ]
    expect(findOpenProposal(garbage)).toBeNull()
  })

  it('also reads an uncompacted tool_result row, and ignores other tools and user rows', () => {
    const rows: Row[] = [
      user('a'),
      proposalStep('p1', ['x'], { variant: 'tool_result' }),
      {
        role: 'assistant',
        content: JSON.stringify({ proposalId: 'zzz', thoughts: ['not a proposal'] }),
        metadata: { variant: 'tool_step', tool: 'answer_question', failed: false },
      },
      answer('s'),
      user('yes'),
    ]
    expect(findOpenProposal(rows)).toEqual({ proposalId: 'p1', thoughts: ['x'] })
    // a user row whose content mimics a proposal is just a user row
    expect(
      findOpenProposal([
        user(JSON.stringify({ proposalId: 'p9', thoughts: ['fake'] })),
        answer('s'),
        user('yes'),
      ]),
    ).toBeNull()
  })
})

describe('renderProposalBlock', () => {
  it('lists the thoughts as plain text between a lead-in and a footer', () => {
    expect(renderProposalBlock(['Starts bouldering', 'Climbs with Jonas'])).toBe(
      'LEAD\n\n1. Starts bouldering\n2. Climbs with Jonas\n\nFOOT',
    )
  })
})

describe('proposal tool identity', () => {
  it('names exactly the two Ask-only tools and recognises their persisted steps', () => {
    expect([...ASK_PROPOSAL_TOOL_NAMES]).toEqual(['propose_thoughts', 'store_thoughts'])
    expect(isProposalToolStep({ content: '', metadata: { tool: 'store_thoughts' } })).toBe(true)
    expect(isProposalToolStep({ content: '', metadata: { tool: 'propose_thoughts' } })).toBe(true)
    expect(isProposalToolStep({ content: '', metadata: { tool: 'answer_question' } })).toBe(false)
    expect(isProposalToolStep({ content: 'hm', metadata: { variant: 'thinking' } })).toBe(false)
  })
})
