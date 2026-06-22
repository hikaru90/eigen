import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

function memoryPath(url: URL): string {
	const params = url.searchParams;
	const tab = params.get('tab');
	if (tab === 'temporal') {
		const eventId = params.get('event');
		return eventId
			? `/memory/timeline?event=${encodeURIComponent(eventId)}`
			: '/memory/timeline';
	}
	const thought = params.get('thought');
	if (thought) {
		const next = new URLSearchParams(params);
		next.delete('tab');
		const qs = next.toString();
		return qs ? `/memory?${qs}` : `/memory?thought=${encodeURIComponent(thought)}`;
	}
	const qs = params.toString();
	return qs ? `/memory?${qs}` : '/memory';
}

export const load: PageServerLoad = async (event) => {
	throw redirect(302, memoryPath(event.url));
};
