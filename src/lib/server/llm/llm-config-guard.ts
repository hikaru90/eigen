/** Values baked into Dockerfile `build` stage only — must never be used at runtime. */
export const DOCKER_PLACEHOLDER_LLM_BASE_URL = 'https://example.com/v1'
export const DOCKER_PLACEHOLDER_RULE_CHAT = '00000000-0000-0000-0000-000000000001'
export const DOCKER_PLACEHOLDER_RULE_EMBEDDING = '00000000-0000-0000-0000-000000000002'

export function isDockerPlaceholderLlmBaseUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.trim()
  if (!trimmed) return false
  try {
    const host = new URL(trimmed).hostname.toLowerCase()
    return host === 'example.com' || host === 'www.example.com'
  } catch {
    return /example\.com/i.test(trimmed)
  }
}

export function isDockerPlaceholderRuleId(ruleId: string): boolean {
  const id = ruleId.trim().toLowerCase()
  return id === DOCKER_PLACEHOLDER_RULE_CHAT || id === DOCKER_PLACEHOLDER_RULE_EMBEDDING
}

function placeholderRuleDetail(ruleId: string | null | undefined): string | null {
  if (!ruleId?.trim()) return null
  if (!isDockerPlaceholderRuleId(ruleId)) return null
  return ruleId.trim()
}

/**
 * Rejects Docker build-time placeholder gateway config before any HTTP call to example.com.
 */
export function assertEurouterGatewayConfigured(opts: {
  baseUrl: string
  ruleChat?: string | null
  ruleEmbedding?: string | null
  /** Shapes the error hint (platform env vs BYOK env/UI). */
  context: 'platform' | 'byok'
}): void {
  const baseUrl = opts.baseUrl.trim()
  if (isDockerPlaceholderLlmBaseUrl(baseUrl)) {
    const hint =
      opts.context === 'platform'
        ? 'Set LLM_BASE_URL (e.g. https://api.eurouter.ai/v1), SERVICE_API_KEY_EUROUTER, LLM_RULE_CHAT, and LLM_RULE_EMBEDDING in the deployment environment.'
        : 'Set LLM_BASE_URL and EUrouter rule UUIDs in the deployment environment, or save credentials under Settings → LLM → BYOK.'
    throw new Error(
      `EUrouter is not configured for production: LLM_BASE_URL is the Docker placeholder (${DOCKER_PLACEHOLDER_LLM_BASE_URL}). ${hint}`,
    )
  }

  const badChat = placeholderRuleDetail(opts.ruleChat)
  const badEmbed = placeholderRuleDetail(opts.ruleEmbedding)
  if (badChat || badEmbed) {
    const parts = [
      badChat ? `LLM_RULE_CHAT=${badChat}` : null,
      badEmbed ? `LLM_RULE_EMBEDDING=${badEmbed}` : null,
    ].filter(Boolean)
    const hint =
      opts.context === 'platform'
        ? 'Replace Docker placeholder rule UUIDs with your EUrouter routing rule IDs in the deployment environment.'
        : 'Use your real EUrouter routing rule IDs in environment variables or Settings → LLM → BYOK.'
    throw new Error(
      `EUrouter routing rules are not configured for production (${parts.join(', ')} are Docker placeholders). ${hint}`,
    )
  }
}

export function routingRuleLookupErrorMessage(opts: {
  ruleId: string
  baseUrl: string
  status: number
  bodyPreview: string
}): string {
  if (isDockerPlaceholderLlmBaseUrl(opts.baseUrl) || /Example Domain/i.test(opts.bodyPreview)) {
    return (
      'EUrouter routing rule lookup failed because LLM_BASE_URL still points at example.com ' +
      '(Docker build placeholder). Set LLM_BASE_URL to your EUrouter API origin, plus SERVICE_API_KEY_EUROUTER ' +
      'and LLM_RULE_CHAT / LLM_RULE_EMBEDDING, in the server environment.'
    )
  }
  return `Routing rule lookup failed (${opts.ruleId}) HTTP ${opts.status}: ${opts.bodyPreview.slice(0, 500)}`
}
