import { describe, expect, it } from 'vitest'
import {
  assertEurouterGatewayConfigured,
  DOCKER_PLACEHOLDER_LLM_BASE_URL,
  isDockerPlaceholderLlmBaseUrl,
  isDockerPlaceholderRuleId,
  routingRuleLookupErrorMessage,
} from './llm-config-guard'

describe('llm-config-guard', () => {
  it('detects example.com base URLs', () => {
    expect(isDockerPlaceholderLlmBaseUrl(DOCKER_PLACEHOLDER_LLM_BASE_URL)).toBe(true)
    expect(isDockerPlaceholderLlmBaseUrl('https://api.eurouter.ai/v1')).toBe(false)
  })

  it('detects Docker placeholder rule UUIDs', () => {
    expect(isDockerPlaceholderRuleId('00000000-0000-0000-0000-000000000001')).toBe(true)
    expect(isDockerPlaceholderRuleId('11111111-1111-1111-1111-111111111111')).toBe(false)
  })

  it('throws for placeholder base URL before HTTP', () => {
    expect(() =>
      assertEurouterGatewayConfigured({
        baseUrl: DOCKER_PLACEHOLDER_LLM_BASE_URL,
        context: 'platform',
      }),
    ).toThrow(/Docker placeholder/)
  })

  it('throws for placeholder rule IDs', () => {
    expect(() =>
      assertEurouterGatewayConfigured({
        baseUrl: 'https://api.eurouter.ai/v1',
        ruleChat: '00000000-0000-0000-0000-000000000001',
        context: 'platform',
      }),
    ).toThrow(/Docker placeholders/)
  })

  it('returns a clear message when lookup body is Example Domain HTML', () => {
    const msg = routingRuleLookupErrorMessage({
      ruleId: '00000000-0000-0000-0000-000000000001',
      baseUrl: DOCKER_PLACEHOLDER_LLM_BASE_URL,
      status: 404,
      bodyPreview: '<title>Example Domain</title>',
    })
    expect(msg).toMatch(/example\.com/)
    expect(msg).not.toMatch(/<!doctype/i)
  })
})
