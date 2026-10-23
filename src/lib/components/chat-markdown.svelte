<script lang="ts">
  import { goto } from '$app/navigation'
  import { renderMarkdownToHtml } from '$lib/chat/render-markdown'
  import { thoughtHref } from '$lib/chat/thought-href'
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

  /** render-markdown stamps each chip with `title="Source <id>"`; read our own prefix back. */
  const CITATION_TITLE_PREFIX = 'Source '

  /** A citation chip is a small, deliberate target: it opens the thought directly. */
  function openCitation(e: MouseEvent) {
    const target = e.target
    if (!(target instanceof Element)) return
    const chip = target.closest('.chat-citation')
    if (!(chip instanceof HTMLElement)) return
    const title = chip.getAttribute('title') ?? ''
    if (!title.startsWith(CITATION_TITLE_PREFIX)) return
    const id = title.slice(CITATION_TITLE_PREFIX.length).trim()
    if (!id) return
    e.preventDefault()
    void goto(thoughtHref(id))
  }
</script>

{#if html}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
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
  onclick={openCitation}
>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- HTML from renderMarkdownToHtml (sanitized) -->
    {@html html}
  </div>
{/if}

