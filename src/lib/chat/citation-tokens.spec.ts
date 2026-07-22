import { describe, expect, it } from 'vitest'
import {
  canonicalCitationToken,
  extractCitationIds,
  normalizeCitationTokens,
  stripCitationTokens,
} from './citation-tokens'

describe('canonicalCitationToken', () => {
  it('uses [id=uuid] shape', () => {
    expect(canonicalCitationToken('d428954a-aae1-4565-a162-9f38b5536d2e')).toBe(
      '[id=d428954a-aae1-4565-a162-9f38b5536d2e]',
    )
  })
})

describe('normalizeCitationTokens', () => {
  it('rewrites bare [uuid] citations to [id=uuid]', () => {
    expect(normalizeCitationTokens('Fact [t1] here.')).toBe('Fact [id=t1] here.')
  })

  it('rewrites [<id=uuid>] citations to [id=uuid]', () => {
    expect(
      normalizeCitationTokens('You are home. [<id=d2af9064-8fbe-490a-856a-ccaee8410516>]'),
    ).toBe('You are home. [id=d2af9064-8fbe-490a-856a-ccaee8410516]')
  })

  it('leaves canonical [id=uuid] citations unchanged', () => {
    const text = 'Respond tonight [id=d428954a-aae1-4565-a162-9f38b5536d2e]'
    expect(normalizeCitationTokens(text)).toBe(text)
  })
})

describe('stripCitationTokens', () => {
  it('strips [<id=uuid>] citations', () => {
    expect(
      stripCitationTokens(
        'You are working from home today. [<id=d2af9064-8fbe-490a-856a-ccaee8410516>]',
      ),
    ).toBe('You are working from home today.')
  })

  it('strips plain [uuid] and [id=uuid] citations', () => {
    expect(stripCitationTokens('Fact [t1] and [id=t2] here.')).toBe('Fact and here.')
  })

  it('extracts ids from [<id=uuid>] citations', () => {
    expect(extractCitationIds('home office [<id=d2af9064-8fbe-490a-856a-ccaee8410516>]')).toEqual([
      'd2af9064-8fbe-490a-856a-ccaee8410516',
    ])
  })

  it('extracts ids from [id=uuid] citations', () => {
    expect(extractCitationIds('Respond tonight [id=d428954a-aae1-4565-a162-9f38b5536d2e]')).toEqual(
      ['d428954a-aae1-4565-a162-9f38b5536d2e'],
    )
  })
})
