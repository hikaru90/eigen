<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { TimelineShellView, NowSegment, ProjectsLayout } from './temporal-events-utils';

	import type { Snippet } from 'svelte';

	type Props = {
		shellView: TimelineShellView;
		nowSegment: NowSegment;
		projectsLayout?: ProjectsLayout;
		titleActions?: Snippet;
		children?: Snippet;
		projectsChrome?: Snippet;
	};

	let {
		shellView,
		nowSegment,
		projectsLayout = 'list',
		titleActions,
		children,
		projectsChrome
	}: Props = $props();

	const title = $derived(
		shellView === 'tasks'
			? nowSegment === 'done'
				? m.graph_timeline_today_done_title()
				: nowSegment === 'overdue'
					? m.graph_timeline_today_overdue_title()
					: m.graph_timeline_tasks()
			: projectsLayout === 'agenda'
				? m.graph_temporal_agenda()
				: projectsLayout === 'matrix'
					? m.graph_timeline_matrix()
					: m.graph_timeline_projects()
	);
</script>

<header class="border-border shrink-0 border-b px-3 py-1.5">
	<div class="flex items-center justify-between gap-2">
		{#if shellView === 'tasks'}
			<div class="flex min-w-0 items-baseline gap-2">
				<h2 class="text-foreground shrink-0 text-sm font-semibold leading-tight">{title}</h2>
				<p
					class="text-muted-foreground truncate text-[11px] leading-tight {nowSegment !== 'todo'
						? 'invisible'
						: ''}"
					aria-hidden={nowSegment !== 'todo'}
				>
					{m.graph_timeline_tasks_subtitle()}
				</p>
			</div>
		{:else}
			<h2 class="text-foreground min-w-0 truncate text-sm font-semibold leading-tight">{title}</h2>
		{/if}
		{#if titleActions}
			<div class="flex shrink-0 items-center gap-1">{@render titleActions()}</div>
		{/if}
	</div>

	{#if children}
		<div class="mt-1 w-full">{@render children()}</div>
	{/if}

	{#if projectsChrome}
		<div class="mt-1 w-full space-y-1">{@render projectsChrome()}</div>
	{/if}
</header>
