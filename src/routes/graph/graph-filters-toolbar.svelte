<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Popover from '$lib/components/ui/popover';
	import * as Select from '$lib/components/ui/select';
	import { COMMUNITY_LEAF_LEVEL } from '$lib/graph/community-levels';
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
	let edgePopoverOpen = $state(false);
	let levelPopoverOpen = $state(false);

	const searchFilterActive = $derived(search.trim().length > 0);
	const edgeFilterActive = $derived(edgeKind !== 'all');
	const levelFilterActive = $derived(communityLevel !== String(COMMUNITY_LEAF_LEVEL));
</script>

<div class="flex shrink-0 items-center gap-1">
	<Popover.Root
		bind:open={searchPopoverOpen}
		onOpenChange={(open) => {
			if (!open) search = '';
		}}
	>
		<Popover.Trigger
			class="border-border bg-background text-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex size-8 shrink-0 items-center justify-center rounded-none border shadow-none transition-colors focus-visible:ring-1 focus-visible:outline-none {searchFilterActive
				? 'ring-primary/40 bg-muted/40 ring-1'
				: ''}"
			aria-label={m.graph_search_nodes()}
			aria-expanded={searchPopoverOpen}
		>
			<SearchIcon class="size-4 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden="true" />
		</Popover.Trigger>
		<Popover.Content
			align="end"
			side="top"
			sideOffset={6}
			class="w-[min(calc(100vw-2rem),22rem)] gap-2 p-3"
		>
			<Label for="graph-search" class="text-xs">{m.graph_search_nodes()}</Label>
			<Input
				id="graph-search"
				class="font-mono text-xs"
				placeholder={m.graph_search_placeholder()}
				bind:value={search}
			/>
		</Popover.Content>
	</Popover.Root>
	<Popover.Root bind:open={edgePopoverOpen}>
		<Popover.Trigger
			class="border-border bg-background text-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex size-8 shrink-0 items-center justify-center rounded-none border shadow-none transition-colors focus-visible:ring-1 focus-visible:outline-none {edgeFilterActive
				? 'ring-primary/40 bg-muted/40 ring-1'
				: ''}"
			aria-label={m.graph_aria_edge_filter()}
			aria-expanded={edgePopoverOpen}
		>
			<Link2 class="size-4 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden="true" />
		</Popover.Trigger>
		<Popover.Content align="end" side="top" sideOffset={6} class="w-64 gap-2 p-3">
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
			class="border-border bg-background text-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex size-8 shrink-0 items-center justify-center rounded-none border shadow-none transition-colors focus-visible:ring-1 focus-visible:outline-none {levelFilterActive
				? 'ring-primary/40 bg-muted/40 ring-1'
				: ''}"
			aria-label={m.graph_aria_community_level()}
			aria-expanded={levelPopoverOpen}
		>
			<span class="text-[10px] font-semibold">L</span>
		</Popover.Trigger>
		<Popover.Content align="end" side="top" sideOffset={6} class="w-64 gap-2 p-3">
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
