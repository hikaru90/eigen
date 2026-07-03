import {
	GROUNDING_QUESTION_CAPTURE_INTERVAL
} from '$lib/server/grounding/constants';
import { generateGroundingQuestion } from '$lib/server/grounding/next-question';
import { isGroundingQuestionDue } from '$lib/server/grounding/question-due';
import { sendPushToUser } from '$lib/server/push/send';
import { listPushSubscriptionsForUser } from '$lib/server/push/subscription';

const GROUNDING_CAPTURE_URL = '/capture?grounding=1';
const NOTIFY_TITLE = 'Improve capture quality';

function truncateBody(text: string, max = 140): string {
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 1)}…`;
}

/**
 * After a capture milestone, nudge the user with an optional grounding question push.
 * Skips silently when not due, no push subscription, or delivery fails.
 */
export async function maybeNotifyGroundingQuestionPush(
	userId: string,
	thoughtCountAfterInsert: number
): Promise<void> {
	if (thoughtCountAfterInsert <= 0) return;
	if (thoughtCountAfterInsert % GROUNDING_QUESTION_CAPTURE_INTERVAL !== 0) return;

	const due = await isGroundingQuestionDue(userId, thoughtCountAfterInsert);
	if (!due) return;

	const subs = await listPushSubscriptionsForUser(userId);
	if (subs.length === 0) return;

	try {
		const generated = await generateGroundingQuestion(userId);
		const body =
			generated?.question.trim() ||
			'Answer a quick question on Capture to improve classification.';

		await sendPushToUser(userId, {
			title: NOTIFY_TITLE,
			body: truncateBody(body),
			url: GROUNDING_CAPTURE_URL,
			tag: `grounding-question-${thoughtCountAfterInsert}`
		});
	} catch (err) {
		console.error('[grounding-notify] push failed', {
			userId,
			thoughtCountAfterInsert,
			message: err instanceof Error ? err.message : String(err)
		});
	}
}
