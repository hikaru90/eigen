import { describe, expect, it, vi, beforeEach } from 'vitest'

const { captureMock, captureExceptionMock, PostHogMock } = vi.hoisted(() => {
  const captureMock = vi.fn()
  const captureExceptionMock = vi.fn()
  const PostHogMock = vi.fn(function PostHog(this: unknown) {
    return {
      capture: captureMock,
      captureException: captureExceptionMock,
    }
  })
  return { captureMock, captureExceptionMock, PostHogMock }
})

vi.mock('posthog-node', () => ({
  PostHog: PostHogMock,
}))

vi.mock('$lib/server/env/private-env', () => ({
  env: {
    POSTHOG_API_KEY: '',
    PUBLIC_POSTHOG_HOST: '',
  },
}))

describe('posthog-server', () => {
  beforeEach(() => {
    vi.resetModules()
    captureMock.mockClear()
    captureExceptionMock.mockClear()
    PostHogMock.mockClear()
  })

  it('captureServerEvent is a no-op when POSTHOG_API_KEY is unset', async () => {
    const { captureServerEvent } = await import('./posthog-server')
    captureServerEvent({
      distinctId: 'user-1',
      event: 'billing_order_created',
      properties: { amount_credits: 1000 },
    })
    expect(PostHogMock).not.toHaveBeenCalled()
    expect(captureMock).not.toHaveBeenCalled()
  })

  it('captureServerEvent sends events when POSTHOG_API_KEY is set', async () => {
    const envModule = await import('$lib/server/env/private-env')
    ;(envModule.env as unknown as { POSTHOG_API_KEY: string }).POSTHOG_API_KEY = 'phc_server_key'
    const { captureServerEvent } = await import('./posthog-server')
    captureServerEvent({
      distinctId: 'user-1',
      event: 'billing_order_created',
      properties: { amount_credits: 5000 },
    })
    expect(PostHogMock).toHaveBeenCalledWith('phc_server_key', {
      host: 'https://eu.i.posthog.com',
    })
    expect(captureMock).toHaveBeenCalledWith({
      distinctId: 'user-1',
      event: 'billing_order_created',
      properties: { amount_credits: 5000 },
    })
  })

  it('captureServerException skips Vite module-runner noise', async () => {
    const envModule = await import('$lib/server/env/private-env')
    ;(envModule.env as unknown as { POSTHOG_API_KEY: string }).POSTHOG_API_KEY = 'phc_server_key'
    const { captureServerException } = await import('./posthog-server')
    captureServerException(new Error('transport was disconnected, cannot call "fetchModule"'), 'u1')
    expect(captureExceptionMock).not.toHaveBeenCalled()
  })
})
