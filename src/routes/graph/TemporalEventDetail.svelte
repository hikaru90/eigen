<script lang="ts">
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import {
		completedEventSummaryClass,
		formatWhen,
		isTemporalEventCompleted,
		kindLabel
	} from './temporal-events-utils';
	import TemporalEventStatusButton from './TemporalEventStatusButton.svelte';

	type Props = {
		item: TemporalEventListItem;
		updatingEventId?: string | null;
		actionBusy?: boolean;
		lastActionSummary?: string | null;
		onQuickAction: (eventId: string, action: 'mark_done' | 'reopen' | 'cancel' | 'dismiss') => void;
		onInstruction: (eventId: string, instruction: string) => void;
		onDelete: (eventId: string) => void;
	};

	let {
		item,
		updatingEventId = null,
		actionBusy = false,
		lastActionSummary = null,
		onQuickAction,
		onInstruction,
		onDelete
	}: Props = $props();

	let instruction = $state('');

	const completed = $derived(isTemporalEventCompleted(item));
	const busy = $derived(actionBusy || updatingEventId === item.id);

	function submitInstruction() {
		const text = instruction.trim();
		if (!text || busy) return;
		onInstruction(item.id, text);
		instruction = '';
	}
</script>

<div
	class="border-border bg-muted/20 shrink-0 border-t px-4 py-3"
	role="region"
	aria-label="Selected event details"
>
	<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
		{#if completed}
			<span
				class="text-muted-foreground rounded-sm border border-border px-2 py-0.5 font-mono text-[10px] uppercase"
			>
				Done
			</span>
		{:else}
			<span class="text-muted-foreground font-mono text-[10px] uppercase">Open</span>
		{/if}
		<div class="flex flex-wrap items-center gap-2">
			<TemporalEventStatusButton
				{item}
				{updatingEventId}
				onQuickAction={(id, action) => onQuickAction(id, action)}
			/>
			{#if !completed}
				<Button
					type="button"
					variant="outline"
					size="sm"
					class="h-8 text-xs"
					disabled={busy}
					onclick={() => onQuickAction(item.id, 'cancel')}
				>
					Cancel
				</Button>
			{/if}
			<Button
				type="button"
				variant="outline"
				size="icon"
				class="size-8"
				disabled={busy}
				title="Remove event"
				onclick={() => onDelete(item.id)}
			>
				<Trash2Icon class="size-3.5" aria-hidden="true" />
				<span class="sr-only">Remove event</span>
			</Button>
		</div>
	</div>

	<form
		class="mb-3 flex gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			submitInstruction();
		}}
	>
		<Input
			bind:value={instruction}
			placeholder="Tell the assistant… move to tomorrow, snooze, reschedule"
			class="h-8 flex-1 text-sm"
			disabled={busy}
		/>
		<Button type="submit" size="sm" class="h-8 shrink-0 text-xs" disabled={busy || !instruction.trim()}>
			{#if busy}
				<LoaderCircleIcon class="size-3.5 animate-spin" aria-hidden="true" />
			{/if}
			Apply
		</Button>
	</form>

	{#if lastActionSummary}
		<p class="text-muted-foreground mb-3 font-sans text-xs">{lastActionSummary}</p>
	{/if}

	<dl class="grid gap-x-4 gap-y-2 font-mono text-[11px] sm:grid-cols-2">
		<div class="sm:col-span-2">
			<dt class="text-muted-foreground text-[10px] uppercase">Summary</dt>
			<dd
				class="text-foreground text-sm font-sans font-medium {completedEventSummaryClass(completed)}"
			>
				{item.semanticSummary}
			</dd>
		</div>
		<div>
			<dt class="text-muted-foreground text-[10px] uppercase">When</dt>
			<dd class="text-foreground">{formatWhen(item)}</dd>
		</div>
		<div>
			<dt class="text-muted-foreground text-[10px] uppercase">Kind</dt>
			<dd class="text-foreground">{kindLabel(item.kind)}</dd>
		</div>
		{#if item.sourceTextSpan}
			<div>
				<dt class="text-muted-foreground text-[10px] uppercase">Phrase</dt>
				<dd class="text-foreground">"{item.sourceTextSpan}"</dd>
			</div>
		{/if}
		<div>
			<dt class="text-muted-foreground text-[10px] uppercase">Precision</dt>
			<dd class="text-foreground">{item.timePrecision}</dd>
		</div>
		<div>
			<dt class="text-muted-foreground text-[10px] uppercase">Graph</dt>
			<dd class="text-foreground">{item.graphSyncStatus}</dd>
		</div>
		<div class="sm:col-span-2">
			<dt class="text-muted-foreground text-[10px] uppercase">Source thought</dt>
			<dd class="text-foreground font-sans text-xs leading-relaxed">{item.thoughtText}</dd>
		</div>
	</dl>
</div>
