<script lang="ts">
  import { renderMarkdownToHtml } from '$lib/chat/render-markdown'

  type Tone = 'default' | 'user' | 'muted'

  type Props = {
    content: string
    tone?: Tone
    class?: string
  }

  let { content, tone = 'default', class: className = '' }: Props = $props()

  const html = $derived(renderMarkdownToHtml(content))
</script>

{#if html}
  <div
    class="chat-markdown chat-markdown--{tone} min-w-0 max-w-full wrap-break-word text-sm leading-relaxed {className}"
  >
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- HTML from renderMarkdownToHtml (sanitized) -->
    {@html html}
  </div>
{/if}

<style>
  .chat-markdown :global(p) {
    margin: 0.35em 0;
  }
  .chat-markdown :global(p:first-child) {
    margin-top: 0;
  }
  .chat-markdown :global(p:last-child) {
    margin-bottom: 0;
  }
  .chat-markdown :global(ul),
  .chat-markdown :global(ol) {
    margin: 0.35em 0;
    padding-left: 1.25rem;
  }
  .chat-markdown :global(li + li) {
    margin-top: 0.15em;
  }
  .chat-markdown :global(blockquote) {
    margin: 0.35em 0;
    padding-left: 0.75rem;
    border-left: 2px solid var(--border);
    color: var(--muted-foreground);
  }
  .chat-markdown :global(code) {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.9em;
    border-radius: 0.2rem;
    padding: 0.1em 0.3em;
    background: color-mix(in srgb, var(--foreground) 8%, transparent);
  }
  .chat-markdown :global(pre) {
    margin: 0.5em 0;
    overflow-x: auto;
    border-radius: 0.25rem;
    padding: 0.65rem 0.75rem;
    background: color-mix(in srgb, var(--foreground) 8%, transparent);
  }
  .chat-markdown :global(pre code) {
    padding: 0;
    background: transparent;
  }
  .chat-markdown :global(a) {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .chat-markdown :global(h1),
  .chat-markdown :global(h2),
  .chat-markdown :global(h3) {
    margin: 0.5em 0 0.25em;
    font-weight: 600;
    line-height: 1.3;
  }
  .chat-markdown--user :global(a) {
    color: inherit;
  }
  .chat-markdown--user :global(code),
  .chat-markdown--user :global(pre) {
    background: color-mix(in srgb, var(--background) 18%, transparent);
  }
  .chat-markdown--user :global(blockquote) {
    border-left-color: color-mix(in srgb, var(--background) 40%, transparent);
    color: color-mix(in srgb, var(--background) 75%, transparent);
  }
  .chat-markdown--muted {
    font-size: 0.75rem;
    line-height: 1.5;
  }
  .chat-markdown--user :global(.chat-citation) {
    border-color: color-mix(in srgb, var(--background) 35%, transparent);
    background: color-mix(in srgb, var(--background) 14%, transparent);
    color: color-mix(in srgb, var(--background) 72%, transparent);
  }
  .chat-markdown--muted :global(.chat-citation) {
    font-size: 0.62em;
  }
</style>
