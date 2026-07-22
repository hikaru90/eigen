import { describe, expect, it, vi, beforeEach } from 'vitest'

const gotoMock = vi.fn()

vi.mock('$app/navigation', () => ({
  goto: gotoMock,
}))

describe('startPushNavigationFromServiceWorker', () => {
  beforeEach(() => {
    gotoMock.mockReset()
  })

  it('navigates when the service worker posts PUSH_NAVIGATE', async () => {
    const listeners = new Map<string, Set<EventListener>>()
    const serviceWorker = {
      addEventListener: (type: string, listener: EventListener) => {
        const set = listeners.get(type) ?? new Set()
        set.add(listener)
        listeners.set(type, set)
      },
      removeEventListener: (type: string, listener: EventListener) => {
        listeners.get(type)?.delete(listener)
      },
    }
    vi.stubGlobal('navigator', { serviceWorker })

    const { startPushNavigationFromServiceWorker } = await import('./navigation-from-sw')
    const stop = startPushNavigationFromServiceWorker()

    const messageListeners = [...(listeners.get('message') ?? [])]
    expect(messageListeners).toHaveLength(1)

    messageListeners[0]({
      data: { type: 'PUSH_NAVIGATE', url: '/memory/timeline?segment=overdue' },
    } as MessageEvent)

    expect(gotoMock).toHaveBeenCalledWith('/memory/timeline?segment=overdue')

    stop()
    expect(listeners.get('message')?.size).toBe(0)
  })

  it('ignores unrelated service worker messages', async () => {
    const listeners = new Map<string, Set<EventListener>>()
    const serviceWorker = {
      addEventListener: (type: string, listener: EventListener) => {
        const set = listeners.get(type) ?? new Set()
        set.add(listener)
        listeners.set(type, set)
      },
      removeEventListener: () => {},
    }
    vi.stubGlobal('navigator', { serviceWorker })

    const { startPushNavigationFromServiceWorker } = await import('./navigation-from-sw')
    startPushNavigationFromServiceWorker()

    const messageListeners = [...(listeners.get('message') ?? [])]
    messageListeners[0]({ data: { type: 'DRAIN_CAPTURE_QUEUE' } } as MessageEvent)

    expect(gotoMock).not.toHaveBeenCalled()
  })
})
