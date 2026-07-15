import { CHECK_IN_QUESTION_CAPTURE_INTERVAL } from '$lib/server/grounding/constants';
import { generateCheckInQuestion } from '$lib/server/grounding/next-check-in';
import { isCheckInQuestionDue } from '$lib/server/grounding/question-due';
import { sendPushToUser } from '$lib/server/push/send';
import { listPushSubscriptionsForUser } from '$lib/server/push/subscription';

const CHECK_IN_CAPTURE_URL = '/capture?checkin=1';
const GROUNDING_NOTIFY_TITLE = 'Improve capture quality';
const RELEVANCE_NOTIFY_TITLE = 'Quick memory check';

function truncateBody(text: string, max = 140): string {
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 1)}…`;
}

/**
 * After a capture milestone, nudge the user with an optional check-in push
 * (grounding blank or thought relevance). Skips silently when not due, no
 * push subscription, or delivery fails.
 */
export async function maybeNotifyGroundingQuestionPush(
	userId: string,
	thoughtCountAfterInsert: number
): Promise<void> {
	if (thoughtCountAfterInsert <= 0) return;
	if (thoughtCountAfterInsert % CHECK_IN_QUESTION_CAPTURE_INTERVAL !== 0) return;

	const due = await isCheckInQuestionDue(userId, thoughtCountAfterInsert);
	if (!due) return;

	const subs = await listPushSubscriptionsForUser(userId);
	if (subs.length === 0) return;

	try {
		const generated = await generateCheckInQuestion(userId);
		const isRelevance = generated?.kind === 'relevance';
		const body =
			generated?.question.trim() ||
			(isRelevance
				? 'A quick check on Capture about whether an older memory still matters.'
				: 'Answer a quick question on Capture to improve classification.');

		await sendPushToUser(userId, {
			title: isRelevance ? RELEVANCE_NOTIFY_TITLE : GROUNDING_NOTIFY_TITLE,
			body: truncateBody(body),
			url: CHECK_IN_CAPTURE_URL,
			tag: `check-in-question-${thoughtCountAfterInsert}`
		});
	} catch (err) {
		console.error('[check-in-notify] push failed', {
			userId,
			thoughtCountAfterInsert,
			message: err instanceof Error ? err.message : String(err)
		});
	}
}

/** Preferred name for the shared check-in push path. */
export const maybeNotifyCheckInQuestionPush = maybeNotifyGroundingQuestionPush;
