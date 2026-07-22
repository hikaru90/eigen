import { describe, expect, it } from 'vitest'
import {
  CAPTURE_PRIMARY_HEADING,
  CUES_FROM_CAPTURE_RULE,
  capturePrimaryPromptBlock,
  groundingSupplementaryPromptBlock,
} from './enrichment-prompt-sections'

describe('enrichment-prompt-sections', () => {
  it('puts capture text first with primary heading', () => {
    const block = capturePrimaryPromptBlock({
      normalizedText: 'MCP bearer key labels agent authorship',
    })
    expect(block.startsWith(CAPTURE_PRIMARY_HEADING)).toBe(true)
    expect(block).toContain('MCP bearer key labels agent authorship')
  })

  it('includes raw text when it differs from normalized', () => {
    const block = capturePrimaryPromptBlock({
      normalizedText: 'normalized',
      rawText: 'raw input',
    })
    expect(block).toContain('Original raw text:')
    expect(block).toContain('raw input')
  })

  it('labels grounding as supplementary', () => {
    const block = groundingSupplementaryPromptBlock({
      narrativeSummary: 'Engineer in Hamburg.',
      facets: { work: 'AI dev' },
    })
    expect(block).toContain('supplementary background only')
    expect(block).toContain('Engineer in Hamburg.')
    expect(block).toContain('work: AI dev')
  })

  it('exports cues-from-capture rule for metadata prompts', () => {
    expect(CUES_FROM_CAPTURE_RULE).toContain('capture text only')
  })
})
