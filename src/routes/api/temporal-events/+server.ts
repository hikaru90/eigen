import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	listTemporalEventsForUser,
	type TemporalEventListItem
} from '$lib/server/memory/temporal-event-list';

export type { TemporalEventListItem };

export type TemporalEventsResponse = {
	items: TemporalEventListItem[];
	nextCursor: { startAt: string; id: string } | null;
};

function parseKinds(raw: string | null): string[] | undefined {
	if (!raw?.trim()) return undefined;
	return raw
		.split(',')
		.map((k) => k.trim())
		.filter(Boolean);
}

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const url = event.url;
	const range = url.searchParams.get('range') as
		| 'relevant'
		| 'upcoming'
		| 'past'
		| 'all'
		| null;
	const status = url.searchParams.get('status') as 'open' | 'all' | null;
	const kinds = parseKinds(url.searchParams.get('kinds'));
	const limitRaw = url.searchParams.get('limit');
	const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
	const cursorStartAt = url.searchParams.get('cursorStartAt');
	const cursorId = url.searchParams.get('cursorId');
	const includeOpenLoops = url.searchParams.get('includeOpenLoops') !== 'false';

	const { items, nextCursor } = await listTemporalEventsForUser({
		userId: user.id,
		range: range ?? 'relevant',
		status: status ?? 'open',
		kinds,
		includeOpenLoops,
		limit: Number.isFinite(limit) ? limit : undefined,
		cursorStartAt,
		cursorId
	});

	return json({ items, nextCursor } satisfies TemporalEventsResponse);
};
