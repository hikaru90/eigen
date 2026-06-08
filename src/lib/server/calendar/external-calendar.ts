/**
 * External calendar integration (Phase 6 scaffold).
 * Google/Apple OAuth sync is not wired yet — returns empty overlays.
 */

export type ExternalBusyBlock = {
	id: string;
	title: string;
	startAt: string;
	endAt: string;
	source: 'google' | 'apple' | 'unknown';
	readOnly: true;
};

export type ExternalCalendarOverlayQuery = {
	userId: string;
	rangeStart: Date;
	rangeEnd: Date;
};

export async function listExternalBusyBlocks(
	_query: ExternalCalendarOverlayQuery
): Promise<ExternalBusyBlock[]> {
	return [];
}
