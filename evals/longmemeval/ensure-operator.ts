import { insertEvalUserRow } from '$lib/eval/store';
import { assertByokConfigured } from '$lib/server/billing/preferences';
import {
	llmActiveProvider,
	llmProviderConfig,
	userPreference
} from '$lib/server/db/schema';
import { withEvalDb } from '../harness/eval-context';
import { resolveLongMemEvalRoot } from './paths';
import { buildJudgeEnv } from './scoring';

export const LONGMEMEVAL_OPERATOR_USER_ID = 'longmemeval-runner';

const DEFAULT_CHAT_MODEL = 'openai/gpt-4o-mini';
const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small';

function resolveOpenRouterConfig(): { apiKey: string; baseUrl: string } {
	const env = buildJudgeEnv(resolveLongMemEvalRoot());
	const apiKey = env.OPENROUTER_API_KEY?.trim() ?? '';
	const baseUrl =
		env.OPENROUTER_BASE_URL?.trim()?.replace(/\/$/, '') || 'https://openrouter.ai/api/v1';
	if (!apiKey) {
		throw new Error(
			'OPENROUTER_API_KEY is required for LongMemEval × Eigen. Set it in longmemeval/.env, eigen/.env, or export it before running.'
		);
	}
	return { apiKey, baseUrl };
}

/**
 * Ensure the LongMemEval operator exists and bills all LLM work via OpenRouter BYOK
 * (never Eigen platform credits).
 */
export async function ensureLongMemEvalOperatorReady(): Promise<void> {
	const { apiKey, baseUrl } = resolveOpenRouterConfig();
	const modelChat = process.env.LLM_MODEL_CHAT?.trim() || DEFAULT_CHAT_MODEL;
	const modelEmbedding = process.env.LLM_MODEL_EMBEDDING?.trim() || DEFAULT_EMBEDDING_MODEL;

	process.env.OPENROUTER_API_KEY = apiKey;
	process.env.OPENROUTER_BASE_URL = baseUrl;
	if (!process.env.LLM_MODEL_CHAT?.trim()) {
		process.env.LLM_MODEL_CHAT = modelChat;
	}
	if (!process.env.LLM_MODEL_EMBEDDING?.trim()) {
		process.env.LLM_MODEL_EMBEDDING = modelEmbedding;
	}

	await insertEvalUserRow(LONGMEMEVAL_OPERATOR_USER_ID, 'LongMemEval Runner');

	await withEvalDb(LONGMEMEVAL_OPERATOR_USER_ID, async (db) => {
		await db
			.insert(llmProviderConfig)
			.values({
				userId: LONGMEMEVAL_OPERATOR_USER_ID,
				provider: 'openrouter',
				baseUrl,
				apiKey,
				modelChat,
				modelEmbedding
			})
			.onConflictDoUpdate({
				target: [llmProviderConfig.userId, llmProviderConfig.provider],
				set: {
					baseUrl,
					apiKey,
					apiKeyEncrypted: null,
					modelChat,
					modelEmbedding,
					updatedAt: new Date()
				}
			});

		await db
			.insert(llmActiveProvider)
			.values({ userId: LONGMEMEVAL_OPERATOR_USER_ID, provider: 'openrouter' })
			.onConflictDoUpdate({
				target: llmActiveProvider.userId,
				set: { provider: 'openrouter', updatedAt: new Date() }
			});

		await db
			.insert(userPreference)
			.values({ userId: LONGMEMEVAL_OPERATOR_USER_ID, billingMode: 'byok' })
			.onConflictDoUpdate({
				target: userPreference.userId,
				set: { billingMode: 'byok', updatedAt: new Date() }
			});
	});

	await withEvalDb(LONGMEMEVAL_OPERATOR_USER_ID, () =>
		assertByokConfigured(LONGMEMEVAL_OPERATOR_USER_ID)
	);

	console.info(
		`[longmemeval] operator BYOK ready (OpenRouter, chat=${modelChat}, embed=${modelEmbedding})`
	);
}
