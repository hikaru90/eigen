<script lang="ts">
  import type { PageData } from './$types'
  import { page } from '$app/state'
  import TimelineShell from '../../timeline/timeline-shell.svelte'

  let { data }: { data: PageData } = $props()

  const initialEventId = $derived(page.url.searchParams.get('event'))
</script>

<div class="-mb-28 flex h-dvh flex-col overflow-hidden overscroll-none">
  <TimelineShell
    mode="projects"
    {initialEventId}
    prefetchedSource={data.prefetchedTimeline}
    userTimeZone={data.preferredTimezone}
    userName={data.user.name}
    eventNotificationsEnabled={data.eventNotificationsEnabled}
    eventReminderLeadMinutes={data.eventReminderLeadMinutes}
  />
</div>
