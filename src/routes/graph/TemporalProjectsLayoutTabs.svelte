<script lang="ts">
	import LayoutListIcon from '@lucide/svelte/icons/layout-list';
	import Columns3Icon from '@lucide/svelte/icons/columns-3';
	import FolderKanbanIcon from '@lucide/svelte/icons/folder-kanban';
	import { m } from '$lib/paraglide/messages.js';
	import type { ProjectsLayout } from './temporal-events-utils';

	type Props = {
		layout: ProjectsLayout;
		onLayoutChange: (layout: ProjectsLayout) => void;
	};

	let { layout, onLayoutChange }: Props = $props();

	const items = [
		{ id: 'list' as const, label: m.graph_timeline_layout_list(), icon: FolderKanbanIcon },
		{ id: 'agenda' as const, label: m.graph_temporal_agenda(), icon: LayoutListIcon },
		{ id: 'matrix' as const, label: m.graph_timeline_matrix(), icon: Columns3Icon }
	];
</script>

<div
	class="border-border bg-muted/30 inline-flex max-w-full rounded-md border p-0.5"
	role="group"
	aria-label={m.graph_timeline_projects_layouts_aria()}
>
	{#each items as item (item.id)}
		<button
			type="button"
			class="rounded-sm px-2 py-1 font-mono text-[11px] transition-colors sm:px-2.5 {layout === item.id
				? 'bg-background text-black shadow-sm dark:text-foreground'
				: 'text-black hover:text-black/80 dark:text-foreground dark:hover:text-foreground/80'}"
			aria-pressed={layout === item.id}
			onclick={() => onLayoutChange(item.id)}
		>
			<item.icon class="mr-1 inline size-3 opacity-80" aria-hidden="true" />
			{item.label}
		</button>
	{/each}
</div>
