<script lang="ts">
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Drawer from '$lib/components/ui/drawer';
	import MemorySurfaceDrawer from '$lib/components/memory-surface-drawer.svelte';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import {
		completedEventSummaryClass,
		formatWhen,
		formatCreatedDate,
		isTemporalEventCompleted
	} from './temporal-events-utils';
	import { graphKindLabel } from '$lib/graph/graph-i18n';
	import { m } from '$lib/paraglide/messages.js';
	import TemporalEventStatusButton from './TemporalEventStatusButton.svelte';

	type Props = {
		item: TemporalEventListItem | null;
		timeZone?: string;
		updatingEventId?: string | null;
		actionBusy?: boolean;
		lastActionSummary?: string | null;
		eventNotificationsEnabled?: boolean;
		eventReminderLeadMinutes?: number;
		eventReminderKinds?: string[];
		onQuickAction: (eventId: string, action: 'mark_done' | 'reopen' | 'cancel' | 'dismiss') => void;
		onInstruction: (eventId: string, instruction: string) => void;
		onDelete: (eventId: string) => void;
		onAssignAgent?: () => void;
		showAssignAgent?: boolean;
		onClose?: () => void;
	};

	let {
		item,
		timeZone,
		updatingEventId = null,
		actionBusy = false,
		lastActionSummary = null,
		eventNotificationsEnabled = false,
		eventReminderLeadMinutes = 10,
		eventReminderKinds = [],
		onQuickAction,
		onInstruction,
		onDelete,
		onAssignAgent,
		showAssignAgent = false,
		onClose
	}: Props = $props();

	let drawerOpen = $state(false);
	let instruction = $state('');

	const completed = $derived(item ? isTemporalEventCompleted(item) : false);
	const busy = $derived(actionBusy || (item !== null && updatingEventId === item.id));
	const pushReminderScheduled = $derived(
		item !== null &&
			eventNotificationsEnabled &&
			!completed &&
			!!item.startAt &&
			eventReminderKinds.includes(item.kind)
	);

	$effect(() => {
		drawerOpen = item !== null;
	});

	function onDrawerOpenChange(open: boolean) {
		if (!open) onClose?.();
	}

	function submitInstruction() {
		if (!item) return;
		const text = instruction.trim();
		if (!text || busy) return;
		onInstruction(item.id, text);
		instruction = '';
	}
</script>

<MemorySurfaceDrawer bind:open={drawerOpen} onOpenChange={onDrawerOpenChange}>
	{#if item}
		<Drawer.Description class="sr-only">{m.graph_temporal_detail_aria()}</Drawer.Description>
		<div
			class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-10"
			data-vaul-no-drag
		>
			<div class="mb-3 flex flex-wrap items-start justify-between gap-2">
				<Drawer.Header class="min-w-0 flex-1 space-y-1 p-0 text-left">
					<p class="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
						{m.graph_temporal_kind()}
					</p>
					<Drawer.Title
						class="text-foreground text-sm font-semibold {completedEventSummaryClass(completed)}"
					>
						{item.semanticSummary}
					</Drawer.Title>
					<p class="text-muted-foreground font-mono text-[11px]">{item.startAt ? 'Due: ' + formatWhen(item, timeZone) + ' · ' : ''}created {formatCreatedDate(item)}</p>
				</Drawer.Header>
				<Drawer.Close
					class="text-destructive hover:text-destructive/80 shrink-0 rounded-md p-1.5 transition-colors focus-visible:ring-ring/50 focus-visible:ring-1 focus-visible:outline-none"
					aria-label={m.graph_close()}
				>
					<XIcon class="size-4" aria-hidden="true" />
				</Drawer.Close>
			</div>

			<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div class="flex flex-wrap items-center gap-2">
					{#if completed}
						<span
							class="text-muted-foreground rounded-sm border border-border px-2 py-0.5 font-mono text-[10px] uppercase"
						>
							{m.graph_temporal_done()}
						</span>
					{:else}
						<span class="text-muted-foreground font-mono text-[10px] uppercase"
							>{m.graph_temporal_status_open()}</span
						>
					{/if}
				</div>
				<div class="flex flex-wrap items-center gap-2">
					{#if showAssignAgent && onAssignAgent}
						<Button
							type="button"
							variant="outline"
							size="sm"
							class="h-8 text-xs"
							disabled={busy}
							onclick={() => onAssignAgent()}
						>
							Assign to agent
						</Button>
					{/if}
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
							{m.graph_temporal_cancel()}
						</Button>
					{/if}
					<Button
						type="button"
						variant="outline"
						size="icon"
						class="size-8"
						disabled={busy}
						title={m.graph_temporal_remove_event()}
						onclick={() => onDelete(item.id)}
					>
						<Trash2Icon class="size-3.5" aria-hidden="true" />
						<span class="sr-only">{m.graph_temporal_remove_event()}</span>
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
					placeholder={m.graph_temporal_instruction_placeholder()}
					class="h-8 flex-1 text-sm"
					disabled={busy}
				/>
				<Button type="submit" size="sm" class="h-8 shrink-0 text-xs" disabled={busy || !instruction.trim()}>
					{#if busy}
						<LoaderCircleIcon class="size-3.5 animate-spin" aria-hidden="true" />
					{/if}
					{m.graph_temporal_apply()}
				</Button>
			</form>

			{#if lastActionSummary}
				<p class="text-muted-foreground mb-3 font-sans text-xs">{lastActionSummary}</p>
			{/if}

			<dl class="grid gap-x-4 gap-y-2 font-mono text-[11px] sm:grid-cols-2">
				<div>
					<dt class="text-muted-foreground text-[10px] uppercase">{m.graph_temporal_kind()}</dt>
					<dd class="text-foreground">{graphKindLabel(item.kind)}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground text-[10px] uppercase">{m.graph_temporal_precision()}</dt>
					<dd class="text-foreground">{item.timePrecision}</dd>
				</div>
				{#if pushReminderScheduled}
					<div class="sm:col-span-2">
						<dt class="text-muted-foreground text-[10px] uppercase">{m.graph_timeline_push_notify()}</dt>
						<dd class="text-foreground">
							{m.graph_timeline_push_reminder({ minutes: eventReminderLeadMinutes })}
						</dd>
					</div>
				{:else if eventNotificationsEnabled && item.startAt && !completed}
					<div class="sm:col-span-2">
						<dt class="text-muted-foreground text-[10px] uppercase">{m.graph_timeline_push_notify()}</dt>
						<dd class="text-muted-foreground">{m.graph_timeline_push_kind_excluded()}</dd>
					</div>
				{/if}
				{#if item.sourceTextSpan}
					<div>
						<dt class="text-muted-foreground text-[10px] uppercase">{m.graph_temporal_phrase()}</dt>
						<dd class="text-foreground">"{item.sourceTextSpan}"</dd>
					</div>
				{/if}
				<div>
					<dt class="text-muted-foreground text-[10px] uppercase">{m.graph_temporal_graph()}</dt>
					<dd class="text-foreground">{item.graphSyncStatus}</dd>
				</div>
				{#if item.snoozedUntil}
					<div>
						<dt class="text-muted-foreground text-[10px] uppercase">{m.graph_timeline_snooze_until()}</dt>
						<dd class="text-foreground">{formatWhen({ ...item, startAt: item.snoozedUntil }, timeZone)}</dd>
					</div>
				{/if}
				{#if item.recurrenceRule}
					<div class="sm:col-span-2">
						<dt class="text-muted-foreground text-[10px] uppercase">{m.graph_timeline_recurrence()}</dt>
						<dd class="text-foreground break-all font-sans text-xs">{item.recurrenceRule}</dd>
					</div>
				{/if}
				{#if item.energyLevel}
					<div>
						<dt class="text-muted-foreground text-[10px] uppercase">{m.graph_timeline_energy()}</dt>
						<dd class="text-foreground">{item.energyLevel}</dd>
					</div>
				{/if}
				{#if item.durationMinutes}
					<div>
						<dt class="text-muted-foreground text-[10px] uppercase">{m.graph_timeline_duration()}</dt>
						<dd class="text-foreground">{m.graph_timeline_duration_min({ minutes: item.durationMinutes })}</dd>
					</div>
				{/if}
				{#if item.contextTags?.length}
					<div class="sm:col-span-2">
						<dt class="text-muted-foreground text-[10px] uppercase">{m.graph_timeline_contexts()}</dt>
						<dd class="text-foreground">{item.contextTags.join(', ')}</dd>
					</div>
				{/if}
				{#if item.recurrenceRule && item.kind === 'reminder'}
					<div>
						<dt class="text-muted-foreground text-[10px] uppercase">{m.graph_timeline_habit()}</dt>
						<dd class="text-foreground">{m.graph_timeline_habit()}</dd>
					</div>
				{/if}
				<div class="sm:col-span-2">
					<dt class="text-muted-foreground text-[10px] uppercase">{m.graph_temporal_source_thought()}</dt>
					<dd class="text-foreground font-sans text-xs leading-relaxed">{item.thoughtText}</dd>
				</div>
			</dl>
		</div>
	{/if}
</MemorySurfaceDrawer>
