<script lang="ts">
	import DocMarkdown from '$lib/components/docs/doc-markdown.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>{data.title} — Developer docs · Eigen Mesh</title>
	<meta name="description" content={data.label} />
</svelte:head>

<DocMarkdown source={data.source} baseFile={data.file} />
