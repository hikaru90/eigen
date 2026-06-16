<script lang="ts">
	import type { TemporalEventListItem } from '../api/temporal-events/+server';
	import {
		AGENDA_SECTION_ORDER,
		completedEventSummaryClass,
		formatWhen,
		groupByAgendaSection,
		isTemporalEventCompleted,
		kindColor
	} from './temporal-events-utils';
	import { graphAgendaSectionLabel, graphKindLabel } from '$lib/graph/graph-i18n';
	import { m } from '$lib/paraglide/messages.js';
	import TemporalEventStatusButton from './TemporalEventStatusButton.svelte';

	type Props = {
		items: TemporalEventListItem[];
		selectedItemId: string | null;
		updatingEventId?: string | null;
		timeZone: string;
		onSelect: (item: TemporalEventListItem) => void;
		onQuickAction: (eventId: string, action: 'mark_done' | 'reopen') => void;
	};

	let {
		items,
		selectedItemId,
		updatingEventId = null,
		timeZone,
		onSelect,
		onQuickAction
	}: Props = $props();

	const grouped = $derived(groupByAgendaSection(items, timeZone));
	const visibleSections = $derived(
		AGENDA_SECTION_ORDER.filter((s) => (grouped.get(s)?.length ?? 0) > 0)
	);
</script>

<div class="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label={m.graph_temporal_aria_agenda()}>
	{#each visibleSections as section (section)}
		{@const sectionItems = grouped.get(section) ?? []}
		<section class="border-border border-b last:border-b-0">
			<h3
				class="text-muted-foreground bg-muted/30 sticky top-0 z-10 border-b border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide"
			>
				{graphAgendaSectionLabel(section)}
				<span class="text-muted-foreground/70 ml-1">({sectionItems.length})</span>
			</h3>
			<ul>
				{#each sectionItems as item (item.id)}
					<li
						role="option"
						aria-selected={selectedItemId === item.id}
						class="border-border flex w-full items-center gap-2 border-b px-3 py-2.5 last:border-b-0 transition-colors {selectedItemId ===
						item.id
							? 'bg-muted/50'
							: 'hover:bg-muted/40'}"
					>
						<button
							type="button"
							class="flex min-w-0 flex-1 gap-3 text-left"
							onclick={() => onSelect(item)}
						>
							<span
								class="mt-1 size-2.5 shrink-0 rounded-full ring-1 ring-border/60"
								style="background-color: {kindColor(item.kind)}"
								aria-hidden="true"
							></span>
							<div class="min-w-0 flex-1 space-y-0.5">
								<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
									<span
										class="text-foreground text-sm font-medium leading-snug {completedEventSummaryClass(
											isTemporalEventCompleted(item)
										)}"
									>
										{item.semanticSummary}
									</span>
									<span
										class="text-muted-foreground shrink-0 font-mono text-[10px] uppercase tracking-wide"
									>
										{graphKindLabel(item.kind)}
									</span>
									{#if isTemporalEventCompleted(item)}
										<span
											class="text-muted-foreground shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase"
										>
											Done
										</span>
									{/if}
								</div>
								<p class="text-muted-foreground font-mono text-[11px]">{formatWhen(item, timeZone)}</p>
								<p class="text-muted-foreground/80 line-clamp-1 text-[11px]">{item.thoughtText}</p>
							</div>
						</button>
						<TemporalEventStatusButton
							{item}
							{updatingEventId}
							compact
							onQuickAction={onQuickAction}
						/>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</div>
