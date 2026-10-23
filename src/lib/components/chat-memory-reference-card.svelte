<script lang="ts">
  import { citationDisplayLabel } from '$lib/chat/citation-tokens'
  import { thoughtHref } from '$lib/chat/thought-href'

  /**
   * One source row under an answer (ei `.source`): the signal cite chip, the thought in
   * your voice, its kind in a whisper, and the explicit open control that leads to the
   * thought page. Rows never open on tap — only the chip and the open control do.
   */
  type Props = {
    id?: string
    text: string
    category?: string
    /** Position in its list; staggers the row's settle (ei `--i`). */
    index?: number
  }

  let { id, text, category, index = 0 }: Props = $props()
</script>

<li
  class="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 items-baseline w-[calc(100%+20px)] -mx-2.5 px-2.5 py-[9px] rounded-[10px] list-none animate-[rise_0.7s_var(--ease)_both] [animation-delay:calc(var(--i,0)*70ms+0.05s)] transition-colors duration-300 ease-settle max-[640px]:w-full max-[640px]:mx-0 max-[640px]:px-0.5 pointer-fine:hover:bg-paper-2"
  style:--i={index}
>
  {#if id}
    <a
    class="inline-flex items-center self-center h-[18px] px-[7px] rounded-full bg-signal-2 text-signal font-you text-sm font-medium tracking-[0.02em] leading-none no-underline whitespace-nowrap [transition:background_0.3s_var(--ease),color_0.3s_var(--ease)] pointer-fine:hover:bg-signal pointer-fine:hover:text-raised"
    href={thoughtHref(id)}
    title="Source {id}"
  >{citationDisplayLabel(id)}</a>
  {:else}
    <span
    class="inline-flex items-center self-center w-[18px] p-0 rounded-full bg-line pointer-fine:hover:bg-line"
    aria-hidden="true"
  ></span>
  {/if}
  <span class="font-you text-sm leading-[1.45] text-ink-2 [overflow-wrap:anywhere]">{text}</span>
  {#if category}
    <span class="col-start-2 font-mesh text-sm leading-[1.3] text-ink-3 capitalize">{category}</span>
  {/if}
  {#if id}
    <!-- the open control: two small corner arrows, named after the thought it opens -->
    <a
      class="col-start-3 row-start-1 row-span-2 self-center grid place-items-center size-9 my-[-9px] mr-[-9px] ml-0 rounded-full text-ink-3 transition-colors duration-300 ease-settle pointer-fine:hover:text-ink"
      href={thoughtHref(id)}
      aria-label={text}
    >
      <svg
        class="size-4 fill-none stroke-current [stroke-width:1.3] [stroke-linecap:round] [stroke-linejoin:round]"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <path d="M9.5 3.5h3v3M12.5 3.5l-4 4M6.5 12.5h-3v-3M3.5 12.5l4-4" />
      </svg>
    </a>
  {/if}
</li>

