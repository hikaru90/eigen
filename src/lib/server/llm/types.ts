export type LlmProviderKind = 'eurouter' | 'openrouter';

export type ResolvedLlmConfig = {
	provider: LlmProviderKind;
	baseUrl: string;
	apiKey: string;
	ruleChat: string | null;
	ruleEmbedding: string | null;
	modelChat: string | null;
	modelEmbedding: string | null;
};
