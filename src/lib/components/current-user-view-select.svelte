<script lang="ts">
	import { get } from 'svelte/store';
	import { page } from '$app/state';
	import * as Popover from '$lib/components/ui/popover';
	import AuthorLayerIcon from '$lib/components/author-layer-icon.svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import type { AuthorLayerMeta } from '$lib/graph/graph-author-layers';
	import {
		viewKind,
		viewLabel,
		type CurrentUserView
	} from '$lib/memory/current-user-view';
	import { currentUserView } from '$lib/stores/current-user-view';
	import { GRAPH_FILTER_GLASS_POPOVER } from '$lib/graph/graph-filter-chrome';
	import { m } from '$lib/paraglide/messages.js';
	import {
		authorAgentLegendIconFrameClass,
		authorLegendItemClassForLayer,
		authorLegendItemStateClass
	} from '$lib/memory/author-layer-chrome';

	let open = $state(false);

	const authorLayers = $derived(
		(page.data as { authorLayers?: AuthorLayerMeta[] }).authorLayers ?? []
	);
	const agentLayers = $derived(authorLayers.filter((layer) => layer.kind === 'agent'));
	let view = $state<CurrentUserView>(get(currentUserView));

	$effect(() => {
		return currentUserView.subscribe((v) => {
			view = v;
		});
	});

	function select(next: CurrentUserView) {
		currentUserView.set(next);
		open = false;
	}

	function optionClass(layerKey: string): string {
		const layer = authorLayers.find((l) => l.key === layerKey);
		const kind = layer?.kind ?? (layerKey === 'all' ? 'user' : 'user');
		const isSelected = view === layerKey;
		return `${authorLegendItemClassForLayer(kind)} ${authorLegendItemStateClass({
			filterActive: true,
			isSelected
		})} w-full cursor-pointer text-left`;
	}

	const triggerIconKind = $derived(viewKind(view, authorLayers));

	const triggerIconFrameClass = $derived(
		triggerIconKind === 'agent'
			? authorAgentLegendIconFrameClass
			: 'inline-flex shrink-0 items-center justify-center rounded-full bg-[#111] p-0.5 dark:bg-white'
	);

	const triggerLabel = $derived(
		view === 'all' ? m.memory_view_all_users() : viewLabel(view, authorLayers)
	);
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="flex h-9 items-center gap-1.5 bg-transparent px-1 text-xs font-medium text-[#111] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 dark:text-white"
		aria-label="Data view"
	>
		<div class={triggerIconFrameClass}>
			<AuthorLayerIcon
				kind={triggerIconKind}
				size="sm"
				class={triggerIconKind === 'user' ? 'text-white dark:text-black' : ''}
			/>
		</div>
		<span
			class="inline-block min-w-0 max-w-[30px] shrink overflow-hidden whitespace-nowrap"
			style="-webkit-mask-image: linear-gradient(to right, black calc(100% - 20px), transparent); mask-image: linear-gradient(to right, black calc(100% - 20px), transparent);"
			title={triggerLabel}
		>{triggerLabel}</span>
		<ChevronDown class="size-3 shrink-0 text-[#111] dark:text-white" strokeWidth={2} aria-hidden="true" />
	</Popover.Trigger>
	<Popover.Content
		align="start"
		side="bottom"
		sideOffset={8}
		class="{GRAPH_FILTER_GLASS_POPOVER} w-52 gap-1 p-1 shadow-xl shadow-black/5"
	>
		<button type="button" class={optionClass('user')} onclick={() => select('user')}>
			<AuthorLayerIcon kind="user" size="sm" />
			<span class="truncate">You</span>
			{#if view === 'user'}
				<span class="ml-auto text-foreground">✓</span>
			{:else}
				<span class="ml-auto w-4"></span>
			{/if}
		</button>
		{#each agentLayers as layer (layer.key)}
			<button type="button" class={optionClass(layer.key)} onclick={() => select(layer.key)}>
				<span class="text-[#28F97F]"><AuthorLayerIcon kind="agent" size="sm" /></span>
				<span class="truncate">{layer.label}</span>
				{#if view === layer.key}
					<span class="ml-auto text-foreground">✓</span>
				{:else}
					<span class="ml-auto w-4"></span>
				{/if}
			</button>
		{/each}
		<div class="my-1 border-t border-white/40 dark:border-white/20" role="separator"></div>
		<button type="button" class={optionClass('all')} onclick={() => select('all')}>
			<span class="truncate">{m.memory_view_all_users()}</span>
			{#if view === 'all'}
				<span class="ml-auto text-foreground">✓</span>
			{:else}
				<span class="ml-auto w-4"></span>
			{/if}
		</button>
	</Popover.Content>
</Popover.Root>
