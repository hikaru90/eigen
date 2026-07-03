<script lang="ts">
	let {
		author = 'user',
		authorLabel
	}: {
		author?: 'user' | 'agent';
		authorLabel?: string | null;
	} = $props();
</script>

{#if author === 'agent'}
	<span
		class="inline-flex items-center rounded-sm bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800 dark:bg-violet-950/50 dark:text-violet-200"
		title={authorLabel ? `Written by ${authorLabel}` : 'Written by an agent'}
	>
		AI{authorLabel ? ` · ${authorLabel}` : ''}
	</span>
{/if}
