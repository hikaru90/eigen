<script lang="ts">
	import Bot from '@lucide/svelte/icons/bot';
	import User from '@lucide/svelte/icons/user';
	import { authorAgentIconClass } from '$lib/memory/author-layer-chrome';

	let {
		kind = 'user',
		size = 'sm',
		class: className = ''
	}: {
		kind?: 'user' | 'agent';
		size?: 'sm' | 'md';
		class?: string;
	} = $props();

	const sizeClass = $derived(size === 'md' ? 'size-3.5' : 'size-3');
	const toneClass = $derived(kind === 'agent' ? authorAgentIconClass : 'text-current');
</script>

{#if kind === 'agent'}
	<Bot class="{sizeClass} shrink-0 {toneClass} {className}" strokeWidth={2} aria-hidden="true" />
{:else}
	<User class="{sizeClass} shrink-0 {toneClass} {className}" strokeWidth={2} aria-hidden="true" />
{/if}
