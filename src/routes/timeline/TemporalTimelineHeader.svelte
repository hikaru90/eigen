<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { NowSegment } from './temporal-events-utils';
	import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
	import { Button } from '$lib/components/ui/button';
	import type { Snippet } from 'svelte';

	type Props = {
		projectsMode: boolean;
		nowSegment: NowSegment;
		onToggleProjectsMode: () => void;
		titleActions?: Snippet;
		children?: Snippet;
	};

	let {
		projectsMode,
		nowSegment,
		onToggleProjectsMode,
		titleActions,
		children
	}: Props = $props();

	const title = $derived(
		projectsMode ? m.graph_timeline_projects() : m.graph_timeline_tasks()
	);
</script>

<header class="border-border shrink-0 border-b px-3 py-1.5">
	<div class="flex items-center justify-between gap-2">
		<div class="flex min-w-0 items-center gap-2">
			<h2 class="text-foreground shrink-0 text-sm font-semibold leading-tight">{title}</h2>
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-sm"
				onclick={onToggleProjectsMode}
			>
				<ArrowLeftRightIcon class="size-3" aria-hidden="true" />
				{projectsMode ? m.graph_timeline_tasks() : m.graph_timeline_projects()}
			</Button>
		</div>
		<div class="flex shrink-0 items-center gap-1">
			{#if titleActions}
				{@render titleActions()}
			{/if}
		</div>
	</div>

	{#if children}
		<div class="mt-1 w-full">{@render children()}</div>
	{/if}
</header>
