<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/state';
	import TemporalEvents from '../../timeline/TemporalEvents.svelte';

	let { data }: { data: PageData } = $props();

	const initialEventId = $derived(page.url.searchParams.get('event'));
</script>

<div class="-mb-28 flex h-dvh flex-col overflow-hidden overscroll-none">
	<TemporalEvents
		initialEventId={initialEventId}
		prefetchedEvents={data.prefetchedTemporalEvents}
		prefetchedNextCursor={data.prefetchedNextCursor}
		userTimeZone={data.preferredTimezone}
		userName={data.user.name}
		eventNotificationsEnabled={data.eventNotificationsEnabled}
		eventReminderLeadMinutes={data.eventReminderLeadMinutes}
		initialSegment={page.url.searchParams.get('segment') === 'overdue' ? 'overdue' : null}
	/>
</div>
