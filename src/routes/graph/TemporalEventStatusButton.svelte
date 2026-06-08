<script lang="ts">
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import { Button } from '$lib/components/ui/button';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { isTemporalEventCompleted } from './temporal-events-utils';

	type Props = {
		item: TemporalEventListItem;
		updatingEventId?: string | null;
		compact?: boolean;
		onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void;
	};

	let { item, updatingEventId = null, compact = false, onQuickAction }: Props = $props();

	const completed = $derived(isTemporalEventCompleted(item));
	const busy = $derived(updatingEventId === item.id);

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
		class="text-muted-foreground hover:text-foreground hover:bg-muted/60 flex size-7 shrink-0 items-center justify-center rounded-md border border-border transition-colors disabled:opacity-50 {completed
			? 'bg-muted/40 text-green-600 dark:text-green-500'
			: ''}"
		title={completed ? 'Reopen' : 'Mark done'}
		aria-label={completed ? 'Reopen' : 'Mark done'}
		disabled={busy}
		onclick={handleClick}
	>
		{#if busy}
			<LoaderCircleIcon class="size-3.5 animate-spin" aria-hidden="true" />
		{:else}
			<CheckIcon class="size-3.5" aria-hidden="true" />
		{/if}
	</button>
{:else}
	<Button
		type="button"
		variant={completed ? 'outline' : 'default'}
		size="sm"
		class="h-8 text-xs"
		disabled={busy}
		onclick={handleClick}
	>
		{#if busy}
			<LoaderCircleIcon class="size-3.5 animate-spin" aria-hidden="true" />
		{/if}
		{completed ? 'Reopen' : 'Mark done'}
	</Button>
{/if}
