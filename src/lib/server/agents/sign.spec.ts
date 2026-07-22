import { describe, expect, it } from 'vitest'
import {
  buildWebhookSignature,
  buildSignatureHeaderValue,
  buildWebhookHeaders,
  validateWebhookSignature,
} from './sign'

describe('buildWebhookSignature', () => {
  it('produces deterministic HMAC for fixed inputs', () => {
    const sig = buildWebhookSignature({
      secret: 'test-secret',
      rawBody: '{"event":"thought.created"}',
    })
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
    expect(
      buildWebhookSignature({
        secret: 'test-secret',
        rawBody: '{"event":"thought.created"}',
      }),
    ).toBe(sig)
  })

  it('changes with different bodies', () => {
    const sig1 = buildWebhookSignature({ secret: 'test-secret', rawBody: '{"a":1}' })
    const sig2 = buildWebhookSignature({ secret: 'test-secret', rawBody: '{"b":2}' })
    expect(sig1).not.toBe(sig2)
  })

  it('matches GitHub HMAC format (body only, no timestamp)', () => {
    // GitHub signs: HMAC-SHA256(secret, body)
    // Our format matches — no timestamp prefix, just the body
    const sig = buildWebhookSignature({ secret: 'test-secret', rawBody: 'hello' })
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('buildSignatureHeaderValue', () => {
  const secret = 'test-secret'
  const rawBody = '{"test":true}'

  it('returns raw hex for generic mode', () => {
    const hex = buildWebhookSignature({ secret, rawBody })
    const value = buildSignatureHeaderValue({ mode: 'generic', secret, rawBody })
    expect(value).toBe(hex)
  })

  it('returns sha256= prefix for github mode', () => {
    const hex = buildWebhookSignature({ secret, rawBody })
    const value = buildSignatureHeaderValue({ mode: 'github', secret, rawBody })
    expect(value).toBe(`sha256=${hex}`)
  })

  it('returns plain secret for gitlab mode', () => {
    const value = buildSignatureHeaderValue({ mode: 'gitlab', secret, rawBody })
    expect(value).toBe(secret)
  })
})

describe('buildWebhookHeaders', () => {
  const eventType = 'thought.created'
  const deliveryId = 'd1'
  const signature = 'abc123'

  it('includes GitHub-style headers', () => {
    const headers = buildWebhookHeaders({
      mode: 'github',
      eventType,
      deliveryId,
      signature,
    })
    expect(headers['X-Hub-Signature-256']).toBe('sha256=abc123')
    expect(headers['X-GitHub-Event']).toBe('thought.created')
    expect(headers['X-GitHub-Delivery']).toBe('d1')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('includes GitLab-style headers', () => {
    const headers = buildWebhookHeaders({
      mode: 'gitlab',
      eventType,
      deliveryId,
      signature,
    })
    expect(headers['X-Gitlab-Token']).toBe('abc123')
    expect(headers['X-Gitlab-Event']).toBe('thought.created')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('includes generic-style headers', () => {
    const headers = buildWebhookHeaders({
      mode: 'generic',
      eventType,
      deliveryId,
      signature,
    })
    expect(headers['X-Webhook-Signature']).toBe('abc123')
    expect(headers['X-Event-Type']).toBe('thought.created')
    expect(headers['X-Request-ID']).toBe('d1')
    expect(headers['Content-Type']).toBe('application/json')
  })
})

describe('validateWebhookSignature', () => {
  const secret = 'my-webhook-secret'
  const rawBody = '{"event":"test"}'

  it('validates generic mode signatures', () => {
    const hex = buildWebhookSignature({ secret, rawBody })
    expect(
      validateWebhookSignature({
        mode: 'generic',
        secret,
        rawBody,
        receivedSignature: hex,
      }),
    ).toBe(true)
  })

  it('rejects invalid generic signatures', () => {
    expect(
      validateWebhookSignature({
        mode: 'generic',
        secret,
        rawBody,
        receivedSignature: '0000000000000000000000000000000000000000000000000000000000000000',
      }),
    ).toBe(false)
  })

  it('validates github mode signatures', () => {
    const hex = buildWebhookSignature({ secret, rawBody })
    expect(
      validateWebhookSignature({
        mode: 'github',
        secret,
        rawBody,
        receivedSignature: `sha256=${hex}`,
      }),
    ).toBe(true)
  })

  it('rejects github signature without sha256= prefix', () => {
    const hex = buildWebhookSignature({ secret, rawBody })
    expect(
      validateWebhookSignature({
        mode: 'github',
        secret,
        rawBody,
        receivedSignature: hex,
      }),
    ).toBe(false)
  })

  it('validates gitlab mode with plain token', () => {
    expect(
      validateWebhookSignature({
        mode: 'gitlab',
        secret,
        rawBody,
        receivedSignature: secret,
      }),
    ).toBe(true)
  })

  it('rejects gitlab mode with wrong token', () => {
    expect(
      validateWebhookSignature({
        mode: 'gitlab',
        secret,
        rawBody,
        receivedSignature: 'wrong-token',
      }),
    ).toBe(false)
  })

  it('does not use timestamp in signing (GitHub compatibility)', () => {
    // Verify that signing the same body produces the same result
    // regardless of timestamp — GitHub doesn't include timestamp in HMAC
    const hex1 = buildWebhookSignature({ secret, rawBody })
    const hex2 = buildWebhookSignature({ secret, rawBody })
    expect(hex1).toBe(hex2)
  })
})
