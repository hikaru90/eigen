<script lang="ts">
	import { renderDocMarkdownToHtml } from '$lib/docs/render-doc-markdown';

	type Props = {
		source: string;
		baseFile: string;
		class?: string;
	};

	let { source, baseFile, class: className = '' }: Props = $props();

	const html = $derived(renderDocMarkdownToHtml(source, { baseFile }));
</script>

{#if html}
	<article class="doc-markdown max-w-none text-sm leading-relaxed {className}">
		{@html html}
	</article>
{/if}

<style>
	.doc-markdown :global(h1) {
		margin: 0 0 0.75rem;
		font-size: 1.5rem;
		font-weight: 600;
		line-height: 1.25;
	}
	.doc-markdown :global(h2) {
		margin: 1.75rem 0 0.5rem;
		font-size: 1.125rem;
		font-weight: 600;
		line-height: 1.3;
	}
	.doc-markdown :global(h3) {
		margin: 1.25rem 0 0.35rem;
		font-size: 1rem;
		font-weight: 600;
	}
	.doc-markdown :global(p) {
		margin: 0.5em 0;
		color: var(--muted-foreground);
	}
	.doc-markdown :global(ul),
	.doc-markdown :global(ol) {
		margin: 0.5em 0;
		padding-left: 1.35rem;
		color: var(--muted-foreground);
	}
	.doc-markdown :global(li + li) {
		margin-top: 0.2em;
	}
	.doc-markdown :global(blockquote) {
		margin: 0.75em 0;
		padding-left: 0.85rem;
		border-left: 2px solid var(--border);
		color: var(--muted-foreground);
	}
	.doc-markdown :global(code) {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.88em;
		border-radius: 0.2rem;
		padding: 0.1em 0.35em;
		background: color-mix(in srgb, var(--foreground) 8%, transparent);
		color: var(--foreground);
	}
	.doc-markdown :global(pre) {
		margin: 0.75em 0;
		overflow-x: auto;
		border-radius: 0.25rem;
		padding: 0.75rem 0.85rem;
		border: 1px solid var(--border);
		background: color-mix(in srgb, var(--foreground) 6%, transparent);
	}
	.doc-markdown :global(pre code) {
		padding: 0;
		background: transparent;
		color: var(--foreground);
	}
	.doc-markdown :global(a) {
		color: var(--foreground);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.doc-markdown :global(table) {
		margin: 0.75em 0;
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}
	.doc-markdown :global(th),
	.doc-markdown :global(td) {
		border: 1px solid var(--border);
		padding: 0.4rem 0.55rem;
		text-align: left;
		vertical-align: top;
	}
	.doc-markdown :global(th) {
		font-weight: 600;
		color: var(--foreground);
		background: color-mix(in srgb, var(--foreground) 5%, transparent);
	}
	.doc-markdown :global(td) {
		color: var(--muted-foreground);
	}
	.doc-markdown :global(hr) {
		margin: 1.5rem 0;
		border-color: var(--border);
	}
</style>
