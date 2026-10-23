import type { ChatProgressEvent } from './consume-chat-ndjson'
import { describe, expect, it } from 'vitest'
import {
  ASK_PHASE_INITIAL,
  ASK_PHASES,
  askPhaseAfterEvent,
  laterAskPhase,
  type AskPhase,
} from './ask-phase'

const toolCall = (tool: string): ChatProgressEvent => ({ type: 'tool_call', tool, arguments: {} })
const toolExecuting = (tool: string): ChatProgressEvent => ({ type: 'tool_executing', tool })
const toolProgress = (tool: string): ChatProgressEvent => ({
  type: 'tool_progress',
  tool,
  phase: 'searching',
  label: 'Searching your memories…',
})
const toolResult = (tool: string): ChatProgressEvent => ({
  type: 'tool_result',
  tool,
  preview: '{}',
})

describe('ask phases — recalling → following the threads → writing', () => {
  it('is ordered and starts at recalling', () => {
    expect(ASK_PHASES).toEqual(['recalling', 'threads', 'writing'])
    expect(ASK_PHASE_INITIAL).toBe('recalling')
  })

  it('laterAskPhase keeps the further phase (never regresses)', () => {
    expect(laterAskPhase('recalling', 'threads')).toBe('threads')
    expect(laterAskPhase('writing', 'threads')).toBe('writing')
    expect(laterAskPhase('threads', 'threads')).toBe('threads')
  })

  it('stays on recalling while the mesh is only thinking', () => {
    expect(askPhaseAfterEvent('recalling', { type: 'thinking', content: '…' })).toBe('recalling')
  })

  it('moves to following the threads when the agent plans or walks a memory tool', () => {
    expect(askPhaseAfterEvent('recalling', { type: 'agent_progress', label: 'Planning' })).toBe(
      'threads',
    )
    expect(askPhaseAfterEvent('recalling', toolCall('retrieve_thoughts'))).toBe('threads')
    expect(askPhaseAfterEvent('recalling', toolExecuting('list_projects'))).toBe('threads')
    expect(askPhaseAfterEvent('recalling', toolProgress('retrieve_thoughts'))).toBe('threads')
    expect(askPhaseAfterEvent('recalling', toolResult('retrieve_thoughts'))).toBe('threads')
  })

  it('moves to writing as soon as the composing tool runs', () => {
    expect(askPhaseAfterEvent('recalling', toolCall('answer_question'))).toBe('writing')
    expect(askPhaseAfterEvent('threads', toolExecuting('answer_question'))).toBe('writing')
    expect(askPhaseAfterEvent('threads', toolProgress('answer_question'))).toBe('writing')
    expect(askPhaseAfterEvent('threads', toolResult('answer_question'))).toBe('writing')
  })

  it('never falls back from writing to an earlier phase', () => {
    const later: ChatProgressEvent[] = [
      toolCall('retrieve_thoughts'),
      { type: 'agent_progress', label: 'Planning next step' },
      { type: 'thinking', content: 'hm' },
      toolResult('list_text_files'),
    ]
    for (const ev of later) {
      expect(askPhaseAfterEvent('writing', ev)).toBe('writing')
    }
  })

  it('walks the real stream order of one Q&A turn', () => {
    const events: ChatProgressEvent[] = [
      { type: 'agent_progress', label: 'Planning next step' },
      toolCall('retrieve_thoughts'),
      toolExecuting('retrieve_thoughts'),
      toolProgress('retrieve_thoughts'),
      toolResult('retrieve_thoughts'),
      toolCall('answer_question'),
      toolExecuting('answer_question'),
      toolResult('answer_question'),
    ]
    const walk: AskPhase[] = []
    let phase: AskPhase = ASK_PHASE_INITIAL
    for (const ev of events) {
      phase = askPhaseAfterEvent(phase, ev)
      walk.push(phase)
    }
    expect(walk).toEqual([
      'threads',
      'threads',
      'threads',
      'threads',
      'threads',
      'writing',
      'writing',
      'writing',
    ])
  })
})
