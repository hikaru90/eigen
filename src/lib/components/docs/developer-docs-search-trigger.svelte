<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import Search from '@lucide/svelte/icons/search';
	import { cn } from '$lib/utils';

	let {
		onclick,
		class: className = ''
	}: {
		onclick: () => void;
		class?: string;
	} = $props();

	let isMac = $state(false);

	onMount(() => {
		if (!browser) return;
		isMac = /Mac|iPhone|iPad/i.test(navigator.platform);
	});
</script>

<button
	type="button"
	class={cn(
		'flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-[6px] border-2 border-black bg-white pl-2.5 pr-1 py-1 text-left shadow-[2px_2px_0_0_#000] transition-colors hover:bg-[#f0f3f0]',
		className
	)}
	aria-label="Search documentation"
	{onclick}
>
	<Search class="text-foreground size-3.5 shrink-0" strokeWidth={1.75} />
	<span class="text-foreground/70 min-w-0 flex-1 truncate text-xs">Search docs…</span>
	<kbd
		class="text-foreground hidden shrink-0 items-center gap-0.5 rounded-[4px] border-2 border-black bg-[#f0f3f0] px-1 py-0.5 font-mono text-[10px] sm:inline-flex"
	>
		{#if isMac}
			<span>⌘</span><span>K</span>
		{:else}
			<span>Ctrl</span><span>K</span>
		{/if}
	</kbd>
</button>
