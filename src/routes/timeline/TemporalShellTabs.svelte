<script lang="ts">
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ListTodoIcon from '@lucide/svelte/icons/list-todo';
	import FolderKanbanIcon from '@lucide/svelte/icons/folder-kanban';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages.js';
	import type { TimelineShellView } from './temporal-events-utils';

	type Props = {
		shellView: TimelineShellView;
		refreshBusy?: boolean;
		onShellChange: (view: TimelineShellView) => void;
		onRefresh?: () => void;
	};

	let { shellView, refreshBusy = false, onShellChange, onRefresh }: Props = $props();

	const tabs = [
		{ id: 'tasks' as const, label: m.graph_timeline_tasks(), icon: ListTodoIcon },
		{ id: 'projects' as const, label: m.graph_timeline_projects(), icon: FolderKanbanIcon }
	];
</script>

<nav
	class="border-border bg-background flex shrink-0 items-center gap-2 border-b px-3 pt-3 pb-2"
	aria-label={m.graph_timeline_bottom_nav()}
>
	<div class="border-border grid min-w-0 flex-1 grid-cols-2 border" role="tablist">
		{#each tabs as tab, index (tab.id)}
			<button
				type="button"
				role="tab"
				aria-selected={shellView === tab.id}
				class="flex items-center justify-center gap-1 px-1.5 py-1.5 font-mono text-[10px] sm:text-[11px] {index <
				tabs.length - 1
					? 'border-border border-r'
					: ''} {shellView === tab.id
					? 'bg-black text-white dark:bg-foreground dark:text-background'
					: 'bg-muted/20 text-black hover:bg-muted/40 dark:text-foreground'}"
				onclick={() => onShellChange(tab.id)}
			>
				<tab.icon
					class="size-3 shrink-0 {shellView === tab.id
						? 'text-white dark:text-background'
						: 'text-black dark:text-foreground'}"
					aria-hidden="true"
				/>
				<span class="truncate">{tab.label}</span>
			</button>
		{/each}
	</div>
	{#if onRefresh}
		<Button
			type="button"
			variant="outline"
			size="icon"
			class="size-7 shrink-0 border-black text-black hover:bg-black/5 dark:border-foreground dark:text-foreground dark:hover:bg-white/10"
			title={m.graph_temporal_refresh()}
			disabled={refreshBusy}
			onclick={() => onRefresh()}
		>
			<RefreshCwIcon class="size-3.5 {refreshBusy ? 'animate-spin' : ''}" aria-hidden="true" />
			<span class="sr-only">{m.graph_temporal_refresh()}</span>
		</Button>
	{/if}
</nav>
