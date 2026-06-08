import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client';
import { extractChatContent } from '$lib/server/ontology/llm-json';
import type { TemporalEventLifecycleStatus } from '$lib/server/db/brain.schema';
import { temporalEventKindEnum } from '$lib/server/db/brain.schema';

export type TemporalEventQuickAction = 'mark_done' | 'reopen' | 'cancel' | 'dismiss';

export type AppliedTemporalEventAction = {
	action: TemporalEventQuickAction | 'reschedule' | 'snooze' | 'update';
	lifecycleStatus?: TemporalEventLifecycleStatus;
	startAt?: string | null;
	endAt?: string | null;
	snoozedUntil?: string | null;
	thoughtTextPatch?: string | null;
	summary: string;
};

const ALLOWED_LIFECYCLE = new Set<TemporalEventLifecycleStatus>([
	'open',
	'completed',
	'cancelled',
	'dismissed'
]);

function parseAppliedTemporalActionJson(text: string): AppliedTemporalEventAction {
	let trimmed = text.trim();
	const fence = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)```\s*$/);
	if (fence) trimmed = fence[1].trim();

	const parsed = JSON.parse(trimmed) as Record<string, unknown>;
	const actionRaw = typeof parsed.action === 'string' ? parsed.action.trim() : '';
	const allowedActions = new Set([
		'mark_done',
		'reopen',
		'cancel',
		'dismiss',
		'reschedule',
		'snooze',
		'update'
	]);
	if (!allowedActions.has(actionRaw)) {
		throw new Error(`Invalid temporal event action: ${actionRaw || '(missing)'}`);
	}

	let lifecycleStatus: TemporalEventLifecycleStatus | undefined;
	if (typeof parsed.lifecycleStatus === 'string' && ALLOWED_LIFECYCLE.has(parsed.lifecycleStatus as TemporalEventLifecycleStatus)) {
		lifecycleStatus = parsed.lifecycleStatus as TemporalEventLifecycleStatus;
	}

	const startAt =
		parsed.startAt === null
			? null
			: typeof parsed.startAt === 'string' && parsed.startAt.trim()
				? parsed.startAt.trim()
				: undefined;
	const endAt =
		parsed.endAt === null
			? null
			: typeof parsed.endAt === 'string' && parsed.endAt.trim()
				? parsed.endAt.trim()
				: undefined;
	const snoozedUntil =
		parsed.snoozedUntil === null
			? null
			: typeof parsed.snoozedUntil === 'string' && parsed.snoozedUntil.trim()
				? parsed.snoozedUntil.trim()
				: undefined;

	const thoughtTextPatch =
		parsed.thoughtTextPatch === null
			? null
			: typeof parsed.thoughtTextPatch === 'string' && parsed.thoughtTextPatch.trim()
				? parsed.thoughtTextPatch.trim()
				: undefined;

	const summary =
		typeof parsed.summary === 'string' && parsed.summary.trim()
			? parsed.summary.trim()
			: 'Event updated.';

	return {
		action: actionRaw as AppliedTemporalEventAction['action'],
		lifecycleStatus,
		startAt,
		endAt,
		snoozedUntil,
		thoughtTextPatch,
		summary
	};
}

/**
 * Resolve a natural-language instruction against a temporal event.
 */
export async function applyTemporalEventActionRequest(input: {
	userId: string;
	instruction: string;
	event: {
		id: string;
		kind: string;
		semanticSummary: string;
		startAt: string | null;
		endAt: string | null;
		timezone: string;
		lifecycleStatus: TemporalEventLifecycleStatus;
		thoughtText: string;
	};
	nowIso: string;
	userTimezone: string;
}): Promise<AppliedTemporalEventAction> {
	const instruction = input.instruction.trim();
	if (!instruction) {
		throw new Error('instruction is required');
	}

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content: [
				'You apply a natural-language instruction to a personal calendar/temporal event.',
				'Return JSON only:',
				'{',
				'  "action": "mark_done" | "reopen" | "cancel" | "dismiss" | "reschedule" | "snooze" | "update",',
				'  "lifecycleStatus": "open" | "completed" | "cancelled" | "dismissed" | null,',
				'  "startAt": "<ISO-8601 or null>",',
				'  "endAt": "<ISO-8601 or null>",',
				'  "snoozedUntil": "<ISO-8601 or null>",',
				'  "thoughtTextPatch": "<full updated source thought text or null>",',
				'  "summary": "<one sentence describing what changed>"',
				'}',
				'Rules:',
				`- Allowed event kinds: ${temporalEventKindEnum.join(', ')}.`,
				'- Use user timezone for relative dates ("tomorrow", "next Monday").',
				'- For reschedule/snooze, set startAt/endAt or snoozedUntil as ISO instants.',
				'- When dates change, provide thoughtTextPatch with the full updated thought reflecting the new schedule.',
				'- For mark done/cancel/dismiss, set lifecycleStatus accordingly; omit date fields unless also rescheduling.',
				'- Do not invent facts beyond the instruction.',
				'- summary must name the concrete change.'
			].join('\n')
		},
		{
			role: 'user',
			content: [
				`Current time (UTC): ${input.nowIso}`,
				`User timezone: ${input.userTimezone}`,
				`Event id: ${input.event.id}`,
				`Kind: ${input.event.kind}`,
				`Summary: ${input.event.semanticSummary}`,
				`Lifecycle: ${input.event.lifecycleStatus}`,
				`Start: ${input.event.startAt ?? '(none)'}`,
				`End: ${input.event.endAt ?? '(none)'}`,
				`Event timezone: ${input.event.timezone}`,
				`Source thought:\n${input.event.thoughtText}`,
				`Instruction: ${instruction}`
			].join('\n\n')
		}
	];

	const response = await llmChatCompletion({
		userId: input.userId,
		messages,
		temperature: 0,
		logContext: 'apply_temporal_event_action'
	});

	const content = extractChatContent(response);
	try {
		return parseAppliedTemporalActionJson(content);
	} catch (err) {
		throw new Error(
			`Failed to parse temporal event action LLM response: ${err instanceof Error ? err.message : String(err)}`
		);
	}
}

export function quickActionToLifecycle(
	action: TemporalEventQuickAction
): TemporalEventLifecycleStatus {
	switch (action) {
		case 'mark_done':
			return 'completed';
		case 'reopen':
			return 'open';
		case 'cancel':
			return 'cancelled';
		case 'dismiss':
			return 'dismissed';
	}
}
