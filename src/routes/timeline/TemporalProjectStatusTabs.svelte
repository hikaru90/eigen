<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { ProjectStatusFilter } from './temporal-events-utils';

	type Props = {
		filter: ProjectStatusFilter;
		onFilterChange: (filter: ProjectStatusFilter) => void;
	};

	let { filter, onFilterChange }: Props = $props();

	const tabs = [
		{ id: 'all' as const, label: m.graph_timeline_project_filter_all() },
		{ id: 'active' as const, label: m.graph_timeline_project_status_active() },
		{ id: 'someday' as const, label: m.graph_timeline_project_status_someday() }
	];
</script>

<div
	class="border-border inline-flex w-full rounded-md border p-0.5"
	role="tablist"
	aria-label={m.graph_timeline_project_filter_aria()}
>
	{#each tabs as tab (tab.id)}
		<button
			type="button"
			role="tab"
			aria-selected={filter === tab.id}
			class="flex-1 rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors {filter ===
			tab.id
				? 'bg-foreground text-background'
				: 'text-black hover:bg-muted/40 dark:text-foreground'}"
			onclick={() => onFilterChange(tab.id)}
		>
			{tab.label}
		</button>
	{/each}
</div>
