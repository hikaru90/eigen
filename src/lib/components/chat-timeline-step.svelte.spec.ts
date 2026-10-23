import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import { page } from 'vitest/browser'
import ChatTimelineStep from './chat-timeline-step.svelte'

const ANSWER_PAYLOAD = JSON.stringify({
  answer: 'Answer: You are home. [id=0ddf2a07-ea77-45f8-83ab-3753ff89e1b6]',
  citations: ['0ddf2a07-ea77-45f8-83ab-3753ff89e1b6'],
  retrieved: [{ id: '0ddf2a07-ea77-45f8-83ab-3753ff89e1b6', category: 'observation', snippet: 'I am home.' }],
})

describe('chat-timeline-step.svelte', () => {
  it('renders the task in plain words — no pill, no check — and each tool call as a pill', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(ChatTimelineStep, {
      target: host,
      props: {
        kind: 'tool_result',
        label: 'Answering your question',
        tool: 'answer_question',
        content: ANSWER_PAYLOAD,
        steps: ['Embedding your question…', 'Searching your memories…', 'Composing answer from matches…'],
      },
    })
    const task = host.querySelector('[data-testid="chat-task"]') as HTMLElement
    expect(task.textContent).toContain('Answering your question')
    expect(task.className).not.toContain('rounded-full')
    expect(task.querySelector('svg')).toBeNull()
    const pills = [...host.querySelectorAll('[data-testid="chat-tool-pill"]')] as HTMLElement[]
    expect(pills.map((p) => p.textContent?.trim())).toEqual([
      'Embedding your question…',
      'Searching your memories…',
      'Composing answer from matches…',
    ])
    for (const pill of pills) {
      expect(pill.className).toContain('rounded-full')
      expect(pill.className).toContain('bg-paper-2')
      expect(pill.querySelector('svg')).not.toBeNull()
    }
    expect(host.textContent).not.toContain('0ddf2a07')
    host.remove()
  })

  it('shows the spinner only on the last pill while running', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(ChatTimelineStep, {
      target: host,
      props: {
        kind: 'tool_progress',
        label: 'Answering your question',
        tool: 'answer_question',
        running: true,
        steps: ['Embedding your question…', 'Searching your memories…'],
      },
    })
    const pills = [...host.querySelectorAll('[data-testid="chat-tool-pill"]')] as HTMLElement[]
    expect(pills).toHaveLength(2)
    expect(pills[0].querySelector('.spinner')).toBeNull()
    expect(pills[1].querySelector('.spinner')).not.toBeNull()
    host.remove()
  })
})
