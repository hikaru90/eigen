<script lang="ts">
	import AuthorLayerIcon from '$lib/components/author-layer-icon.svelte';
	import { authorAgentChipClass } from '$lib/memory/author-layer-chrome';

	let {
		author = 'user',
		authorLabel
	}: {
		author?: 'user' | 'agent';
		authorLabel?: string | null;
	} = $props();

	const title = $derived(
		authorLabel ? `Captured by agent · ${authorLabel}` : 'Captured by an agent'
	);
	const label = $derived(authorLabel?.trim() || 'Agent');
</script>

{#if author === 'agent'}
	<span class={authorAgentChipClass} {title}>
		<AuthorLayerIcon kind="agent" />
		<span class="truncate">{label}</span>
	</span>
{/if}
