import { describe, expect, it, vi, afterEach } from 'vitest'

describe('validateAgentWebhookUrl production', () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('$lib/server/env/private-env')
  })

  it('accepts https public URLs', async () => {
    vi.doMock('$lib/server/env/private-env', () => ({ env: { NODE_ENV: 'production' } }))
    const { validateAgentWebhookUrl } = await import('./validate-url')
    expect(validateAgentWebhookUrl('https://hooks.example.com/eigen').ok).toBe(true)
  })

  it('rejects http in production', async () => {
    vi.doMock('$lib/server/env/private-env', () => ({ env: { NODE_ENV: 'production' } }))
    const { validateAgentWebhookUrl } = await import('./validate-url')
    expect(validateAgentWebhookUrl('http://hooks.example.com/eigen').ok).toBe(false)
  })

  it('rejects private IPs in production', async () => {
    vi.doMock('$lib/server/env/private-env', () => ({ env: { NODE_ENV: 'production' } }))
    const { validateAgentWebhookUrl } = await import('./validate-url')
    expect(validateAgentWebhookUrl('https://192.168.1.10/hook').ok).toBe(false)
  })

  it('allows localhost http in development', async () => {
    vi.doMock('$lib/server/env/private-env', () => ({ env: { NODE_ENV: 'development' } }))
    const { validateAgentWebhookUrl } = await import('./validate-url')
    expect(validateAgentWebhookUrl('http://localhost:3456/hook').ok).toBe(true)
  })
})
