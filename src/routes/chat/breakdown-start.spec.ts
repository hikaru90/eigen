import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { startBreakdown, type BreakdownStartDeps } from './breakdown-start'

function makeDeps() {
  const order: string[] = []
  const deps = {
    message: vi.fn((task: string) => `Help me break this down into a few small first steps: ${task}`),
    startNewConversation: vi.fn(() => order.push('new')),
    clearUrl: vi.fn(() => order.push('clear')),
    appendUserMessage: vi.fn(() => order.push('append')),
    send: vi.fn(async () => {
      order.push('send')
    }),
  } satisfies BreakdownStartDeps
  return { deps, order }
}

describe('startBreakdown (NOW-9, AC5)', () => {
  it('starts a new conversation and sends exactly one ordinary message with the task', async () => {
    const { deps } = makeDeps()

    await expect(startBreakdown('Send the form', deps)).resolves.toBe(true)

    expect(deps.send).toHaveBeenCalledTimes(1)
    expect(deps.send).toHaveBeenCalledWith(
      'Help me break this down into a few small first steps: Send the form',
    )
    expect(deps.appendUserMessage).toHaveBeenCalledWith(
      'Help me break this down into a few small first steps: Send the form',
    )
    expect(deps.startNewConversation).toHaveBeenCalledTimes(1)
  })

  it('takes breakdown out of the URL before the send, so a reload never sends it twice', async () => {
    const { deps, order } = makeDeps()
    await startBreakdown('Send the form', deps)
    expect(order).toEqual(['new', 'clear', 'append', 'send'])
  })

  it('does nothing without a task', async () => {
    const { deps } = makeDeps()
    await expect(startBreakdown(null, deps)).resolves.toBe(false)
    expect(deps.send).not.toHaveBeenCalled()
    expect(deps.clearUrl).not.toHaveBeenCalled()
    expect(deps.startNewConversation).not.toHaveBeenCalled()
  })
})

describe('Ask page wiring (source contract)', () => {
  const source = readFileSync('src/routes/chat/+page.svelte', 'utf8')
  const onMountBody = source.slice(source.indexOf('onMount(() => {'))

  it('starts the breakdown in onMount from data.breakdownTask, with the plain message send', () => {
    expect(onMountBody).toContain('startBreakdown(data.breakdownTask')
    expect(source).toContain("m.ask_breakdown_message({ task })")
    expect(source).toContain('clearUrl: () => setSessionUrl(null)')
    expect(source).toContain('await sendStreaming(text)')
  })

  it('uses no $effect for it (AGENTS.md)', () => {
    expect(source).not.toContain('$effect')
  })
})
