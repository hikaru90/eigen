<script lang="ts">
  import { renderMarkdownToHtml } from '$lib/chat/render-markdown'
  import { cn } from '$lib/utils.js'

  /**
   * Two voices (ei DESIGN.md): `user` is you — Geist Mono, inheriting the size of the
   * heading it sits in; `default` is the mesh — Inter, the answer's reading size;
   * `muted` is a whisper-grade aside.
   */
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
  class={cn(
    'chat-markdown min-w-0 max-w-full [overflow-wrap:anywhere]',
    tone === 'default' &&
      'font-mesh text-base leading-[1.66] tracking-[-0.009em] text-ink min-[640px]:text-[17px] min-[640px]:leading-[1.68]',
    tone === 'user' &&
      'font-you text-[inherit] leading-[inherit] tracking-[inherit] text-inherit',
    tone === 'muted' && 'font-mesh text-sm leading-[1.55] text-ink-3',
    className,
  )}
>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- HTML from renderMarkdownToHtml (sanitized) -->
    {@html html}
  </div>
{/if}

