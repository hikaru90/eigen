<script lang="ts">
  import { m } from '$lib/paraglide/messages.js'

  /**
   * The Contribute board's empty state: `board` when nobody has suggested anything
   * yet, `tab` when only the current tab is empty. Quiet, one action: open the writer.
   */
  let {
    variant,
    onsuggest,
  }: {
    variant: 'board' | 'tab'
    onsuggest: () => void
  } = $props()
</script>

<div
  class="mt-[46px] flex flex-col items-start gap-2 motion-safe:animate-[rise_0.7s_var(--ease)_both] motion-reduce:animate-none"
  data-testid="feedback-empty"
>
  <p class="m-0 font-mesh text-[24px] leading-[1.2] tracking-[-0.02em] text-ink-2">
    {variant === 'board' ? m.better_empty_board_title() : m.better_empty_tab_title()}
  </p>
  <p class="m-0 max-w-[46ch] text-sm leading-[1.55] text-ink-3">
    {variant === 'board' ? m.better_empty_board_body() : m.better_empty_tab_body()}
  </p>
  <button
    class="mt-1 border-0 bg-transparent p-0 text-sm text-ink-2 underline decoration-ink-3/40 underline-offset-4 transition-colors duration-300 ease-settle pointer-fine:hover:text-ink"
    type="button"
    data-testid="feedback-empty-action"
    onclick={onsuggest}
  >
    {m.better_empty_action()}
  </button>
</div>
