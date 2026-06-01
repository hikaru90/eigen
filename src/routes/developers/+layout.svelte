<script lang="ts">
	import DeveloperDocsShell from '$lib/components/docs/developer-docs-shell.svelte';

	let { children } = $props();
</script>

<DeveloperDocsShell>{@render children()}</DeveloperDocsShell>
