<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/state';
	import TemporalEvents from './TemporalEvents.svelte';

	let { data }: { data: PageData } = $props();

	const initialEventId = $derived(page.url.searchParams.get('event'));
</script>

<div class="-mb-28 h-dvh overflow-hidden overscroll-none">
	<TemporalEvents
		visible={true}
		initialEventId={initialEventId}
		userTimeZone={data.preferredTimezone}
		userName={data.user.name}
		eventNotificationsEnabled={data.eventNotificationsEnabled}
		eventReminderLeadMinutes={data.eventReminderLeadMinutes}
		eventReminderKinds={data.eventReminderKinds}
	/>
</div>
