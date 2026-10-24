export type LlmProviderKind = 'eurouter' | 'openrouter'

export type ResolvedLlmConfig = {
  provider: LlmProviderKind
  baseUrl: string
  apiKey: string
  modelChat: string | null
  modelEmbedding: string | null
}
