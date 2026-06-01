<script lang="ts">
	import DocMarkdown from '$lib/components/docs/doc-markdown.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>{data.title} — Developer docs · Eigen Mesh</title>
	<meta name="description" content={data.label} />
</svelte:head>

<div class="rounded-md border-2 border-black bg-card p-6 shadow-[4px_4px_0px_0px_#000] dark:border-border dark:shadow-none md:p-8">
	<DocMarkdown source={data.source} baseFile={data.file} />
</div>
