import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mockCallArg } from '$lib/test/vitest-mock-call'

const { initMock, captureMock, identifyMock, resetMock, captureExceptionMock, publicEnv } =
  vi.hoisted(() => ({
    initMock: vi.fn(),
    captureMock: vi.fn(),
    identifyMock: vi.fn(),
    resetMock: vi.fn(),
    captureExceptionMock: vi.fn(),
    publicEnv: {
      PUBLIC_POSTHOG_KEY: '',
      PUBLIC_POSTHOG_HOST: '',
    },
  }))

vi.mock('$env/static/public', () => publicEnv)

vi.mock('posthog-js', () => ({
  default: {
    init: initMock,
    capture: captureMock,
    identify: identifyMock,
    reset: resetMock,
    captureException: captureExceptionMock,
  },
}))

vi.mock('$app/environment', () => ({
  browser: true,
}))

describe('posthog-client', () => {
  beforeEach(() => {
    vi.resetModules()
    publicEnv.PUBLIC_POSTHOG_KEY = ''
    publicEnv.PUBLIC_POSTHOG_HOST = ''
    initMock.mockClear()
    captureMock.mockClear()
    identifyMock.mockClear()
    resetMock.mockClear()
    captureExceptionMock.mockClear()
  })

  it('isPostHogEnabled is false when PUBLIC_POSTHOG_KEY is unset', async () => {
    const { isPostHogEnabled } = await import('./posthog-client')
    expect(isPostHogEnabled()).toBe(false)
  })

  it('initPostHog initializes with EU host default when key is set', async () => {
    publicEnv.PUBLIC_POSTHOG_KEY = 'phc_test_key'
    const { initPostHog, capture } = await import('./posthog-client')
    initPostHog()
    expect(initMock).toHaveBeenCalledWith('phc_test_key', {
      api_host: '/ingest',
      ui_host: 'https://eu.posthog.com',
      defaults: '2026-01-30',
      person_profiles: 'identified_only',
      capture_pageview: false,
      capture_exceptions: true,
      before_send: expect.any(Function),
    })
    capture('test_event', { foo: 'bar' })
    expect(captureMock).toHaveBeenCalledWith('test_event', { foo: 'bar' })
  })

  it('capture lazy-inits when initPostHog was not called first', async () => {
    publicEnv.PUBLIC_POSTHOG_KEY = 'phc_test_key'
    const { capture } = await import('./posthog-client')
    capture('lazy_event')
    expect(initMock).toHaveBeenCalled()
    expect(captureMock).toHaveBeenCalledWith('lazy_event', undefined)
  })

  it('capture is a no-op when PUBLIC_POSTHOG_KEY is unset', async () => {
    const { capture } = await import('./posthog-client')
    capture('ignored_event')
    expect(initMock).not.toHaveBeenCalled()
    expect(captureMock).not.toHaveBeenCalled()
  })

  it('captureClientException skips ResizeObserver / Vite noise', async () => {
    publicEnv.PUBLIC_POSTHOG_KEY = 'phc_test_key'
    const { captureClientException } = await import('./posthog-client')
    captureClientException(
      new Error('ResizeObserver loop completed with undelivered notifications.'),
    )
    captureClientException(new Error('Vite module runner has been closed.'))
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })

  it('before_send drops autocaptured noise exceptions', async () => {
    publicEnv.PUBLIC_POSTHOG_KEY = 'phc_test_key'
    const { initPostHog } = await import('./posthog-client')
    initPostHog()
    const initOpts = mockCallArg<{
      before_send: (event: {
        event: string
        properties?: { $exception_list?: Array<{ type?: string; value?: string }> }
      }) => unknown
    }>(initMock, 0, 1)
    const dropped = initOpts.before_send({
      event: '$exception',
      properties: {
        $exception_list: [{ type: 'Error', value: 'Failed to fetch' }],
      },
    })
    expect(dropped).toBeNull()
    const kept = initOpts.before_send({
      event: '$exception',
      properties: {
        $exception_list: [{ type: 'Error', value: 'Enrichment step(s) failed' }],
      },
    })
    expect(kept).not.toBeNull()
  })
})
