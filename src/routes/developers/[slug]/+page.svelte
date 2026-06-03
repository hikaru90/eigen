<script lang="ts">
	import DeveloperDocArticleFooter from '$lib/components/docs/developer-doc-article-footer.svelte';
	import DocMarkdown from '$lib/components/docs/doc-markdown.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>{data.title} — Developer docs · Eigen Mesh</title>
	<meta name="description" content={data.label} />
</svelte:head>

<DocMarkdown source={data.source} baseFile={data.file} />
<DeveloperDocArticleFooter prev={data.prev} next={data.next} />
