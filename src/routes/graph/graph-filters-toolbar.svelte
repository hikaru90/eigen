<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Popover from '$lib/components/ui/popover';
	import * as Select from '$lib/components/ui/select';
	import { COMMUNITY_LEAF_LEVEL } from '$lib/graph/community-levels';
	import {
		GRAPH_FILTER_GLASS_POPOVER,
		GRAPH_FILTER_GLASS_ROW,
		GRAPH_FILTER_POPOVER_WIDTH,
		graphFilterTriggerClass
	} from '$lib/graph/graph-filter-chrome';
	import { graphCommunityLevelLabel, graphEdgeKindLabel } from '$lib/graph/graph-i18n';
	import { m } from '$lib/paraglide/messages.js';
	import Link2 from '@lucide/svelte/icons/link-2';
	import SearchIcon from '@lucide/svelte/icons/search';

	let {
		search = $bindable(''),
		edgeKind = $bindable('all'),
		communityLevel = $bindable(String(COMMUNITY_LEAF_LEVEL)),
		availableCommunityLevels
	}: {
		search?: string;
		edgeKind?: string;
		communityLevel?: string;
		availableCommunityLevels: number[];
	} = $props();

	let searchPopoverOpen = $state(false);
	let searchInputEl = $state<HTMLInputElement | null>(null);
	let edgePopoverOpen = $state(false);
	let levelPopoverOpen = $state(false);

	const searchFilterActive = $derived(search.trim().length > 0);
	const edgeFilterActive = $derived(edgeKind !== 'all');
	const levelFilterActive = $derived(communityLevel !== String(COMMUNITY_LEAF_LEVEL));

	const popoverContentClass = `${GRAPH_FILTER_GLASS_POPOVER} ${GRAPH_FILTER_POPOVER_WIDTH} gap-2 p-3`;

	$effect(() => {
		if (searchPopoverOpen) {
			queueMicrotask(() => searchInputEl?.focus());
		}
	});

	function onSearchOpenChange(open: boolean) {
		if (!open) search = '';
	}
</script>

<div class={GRAPH_FILTER_GLASS_ROW}>
	<Popover.Root bind:open={searchPopoverOpen} onOpenChange={onSearchOpenChange}>
		<Popover.Trigger
			class={graphFilterTriggerClass(searchFilterActive)}
			aria-label={m.graph_search_nodes()}
			aria-expanded={searchPopoverOpen}
		>
			<SearchIcon class="size-3 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden="true" />
		</Popover.Trigger>
		<Popover.Content
			align="end"
			side="bottom"
			sideOffset={6}
			collisionPadding={12}
			class={popoverContentClass}
		>
			<Label for="graph-search" class="text-xs">{m.graph_search_nodes()}</Label>
			<Input
				bind:ref={searchInputEl}
				id="graph-search"
				class="font-mono text-xs"
				placeholder={m.graph_search_placeholder()}
				bind:value={search}
			/>
		</Popover.Content>
	</Popover.Root>
	<Popover.Root bind:open={edgePopoverOpen}>
		<Popover.Trigger
			class={graphFilterTriggerClass(edgeFilterActive)}
			aria-label={m.graph_aria_edge_filter()}
			aria-expanded={edgePopoverOpen}
		>
			<Link2 class="size-3 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden="true" />
		</Popover.Trigger>
		<Popover.Content
			align="end"
			side="bottom"
			sideOffset={6}
			collisionPadding={12}
			class={popoverContentClass}
		>
			<Label class="text-xs">{m.graph_edge_type()}</Label>
			<Select.Root type="single" bind:value={edgeKind}>
				<Select.Trigger class="w-full font-mono text-xs">
					{graphEdgeKindLabel(edgeKind)}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">{m.graph_edge_all()}</Select.Item>
					<Select.Item value="co_mention">{m.graph_edge_co_mention()}</Select.Item>
					<Select.Item value="entity_relation">{m.graph_edge_relations()}</Select.Item>
				</Select.Content>
			</Select.Root>
		</Popover.Content>
	</Popover.Root>
	<Popover.Root bind:open={levelPopoverOpen}>
		<Popover.Trigger
			class={graphFilterTriggerClass(levelFilterActive)}
			aria-label={m.graph_aria_community_level()}
			aria-expanded={levelPopoverOpen}
		>
			<span class="text-[10px] font-semibold leading-none">L</span>
		</Popover.Trigger>
		<Popover.Content
			align="end"
			side="bottom"
			sideOffset={6}
			collisionPadding={12}
			class={popoverContentClass}
		>
			<Label class="text-xs">{m.graph_community_level()}</Label>
			<Select.Root type="single" bind:value={communityLevel}>
				<Select.Trigger class="w-full font-mono text-xs">
					{graphCommunityLevelLabel(Number.parseInt(communityLevel, 10))}
				</Select.Trigger>
				<Select.Content>
					{#each availableCommunityLevels as level (level)}
						<Select.Item value={String(level)}>{graphCommunityLevelLabel(level)}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</Popover.Content>
	</Popover.Root>
</div>
