import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list';
import { sortByFocusRank } from '$lib/server/memory/compute-focus-rank';
import { isOpenTodoToday } from '$lib/server/memory/timeline-today-server';

const SUMMARY_PREVIEW_MAX = 3;

export type DailySummaryPush = {
	title: string;
	body: string;
};

export function buildDailySummaryPush(
	items: TemporalEventListItem[],
	timeZone: string,
	now = new Date()
): DailySummaryPush {
	const todo = items.filter((item) => isOpenTodoToday(item, now, timeZone));
	const estimatedMinutes = todo.reduce((sum, item) => sum + (item.durationMinutes ?? 30), 0);
	const hours = Math.round((estimatedMinutes / 60) * 10) / 10;
	const preview = sortByFocusRank(todo, timeZone, now)
		.slice(0, SUMMARY_PREVIEW_MAX)
		.map((item) => item.semanticSummary);

	if (todo.length === 0) {
		return {
			title: 'Today',
			body: 'Nothing on your plate today — open the timeline or capture a thought.'
		};
	}

	const headline = `${todo.length} task${todo.length === 1 ? '' : 's'} · ~${hours}h`;
	const bullets = preview.map((line) => `• ${line}`).join('\n');
	return {
		title: 'Good morning',
		body: bullets ? `${headline}\n${bullets}` : headline
	};
}
