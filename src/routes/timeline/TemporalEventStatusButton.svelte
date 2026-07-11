<script lang="ts">
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { isTemporalEventCompleted } from './temporal-events-utils';
	import { m } from '$lib/paraglide/messages.js';

	type Props = {
		item: TemporalEventListItem;
		updatingEventId?: string | null;
		compact?: boolean;
		onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void;
	};

	let { item, updatingEventId = null, compact = false, onQuickAction }: Props = $props();

	const completed = $derived(isTemporalEventCompleted(item));
	const busy = $derived(updatingEventId === item.id);
	const actionLabel = $derived(completed ? m.graph_temporal_reopen() : m.graph_temporal_mark_done());

	function handleClick(event: MouseEvent) {
		event.stopPropagation();
		event.preventDefault();
		if (busy) return;
		onQuickAction(item.id, completed ? 'reopen' : 'mark_done');
	}
</script>

{#if compact}
	<button
		type="button"
		class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50 {completed
			? 'border-[#111] bg-[#111] text-white dark:border-foreground dark:bg-foreground dark:text-background'
			: 'border-[#111]/70 bg-transparent text-transparent hover:border-[#111] hover:bg-white/40 dark:border-foreground/70 dark:hover:border-foreground dark:hover:bg-white/10'}"
		title={actionLabel}
		aria-label={actionLabel}
		disabled={busy}
		onclick={handleClick}
	>
		{#if busy}
			<LoaderCircleIcon class="text-foreground size-3 animate-spin" aria-hidden="true" />
		{:else if completed}
			<CheckIcon class="size-3" strokeWidth={2.5} aria-hidden="true" />
		{:else}
			<span class="sr-only">{actionLabel}</span>
		{/if}
	</button>
{:else}
	<button
		type="button"
		class="h-8 shrink-0 rounded-full border border-black px-3 text-xs font-medium transition-colors disabled:opacity-50 dark:border-foreground {completed
			? 'bg-muted/30 text-foreground hover:bg-muted/50'
			: 'bg-black text-white hover:bg-black/90 dark:bg-foreground dark:text-background dark:hover:bg-foreground/90'}"
		disabled={busy}
		onclick={handleClick}
	>
		{#if busy}
			<LoaderCircleIcon class="mr-1 inline size-3.5 animate-spin" aria-hidden="true" />
		{/if}
		{actionLabel}
	</button>
{/if}
