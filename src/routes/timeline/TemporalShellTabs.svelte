<script lang="ts">
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SunIcon from '@lucide/svelte/icons/sun';
	import FolderKanbanIcon from '@lucide/svelte/icons/folder-kanban';
	import ClipboardCheckIcon from '@lucide/svelte/icons/clipboard-check';
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
		{ id: 'now' as const, label: m.graph_timeline_now(), icon: SunIcon },
		{ id: 'projects' as const, label: m.graph_timeline_projects(), icon: FolderKanbanIcon },
		{ id: 'review' as const, label: m.graph_timeline_review(), icon: ClipboardCheckIcon }
	];
</script>

<nav
	class="border-border bg-background/95 flex shrink-0 items-center gap-2 border-b px-3 py-1 backdrop-blur-sm"
	aria-label={m.graph_timeline_bottom_nav()}
>
	<div
		class="border-border bg-muted/30 grid min-w-0 flex-1 grid-cols-3 rounded-md border p-0.5"
		role="tablist"
	>
		{#each tabs as tab (tab.id)}
			<button
				type="button"
				role="tab"
				aria-selected={shellView === tab.id}
				class="flex items-center justify-center gap-1 rounded-sm px-1.5 py-1 font-mono text-[10px] transition-colors sm:text-[11px] {shellView ===
				tab.id
					? 'bg-background text-black shadow-sm dark:text-foreground'
					: 'text-black hover:text-black/80 dark:text-foreground dark:hover:text-foreground/80'}"
				onclick={() => onShellChange(tab.id)}
			>
				<tab.icon class="size-3 shrink-0 opacity-80" aria-hidden="true" />
				<span class="truncate">{tab.label}</span>
			</button>
		{/each}
	</div>
	{#if onRefresh}
		<Button
			type="button"
			variant="outline"
			size="icon"
			class="size-7 shrink-0"
			title={m.graph_temporal_refresh()}
			disabled={refreshBusy}
			onclick={() => onRefresh()}
		>
			<RefreshCwIcon class="size-3.5 {refreshBusy ? 'animate-spin' : ''}" aria-hidden="true" />
			<span class="sr-only">{m.graph_temporal_refresh()}</span>
		</Button>
	{/if}
</nav>
