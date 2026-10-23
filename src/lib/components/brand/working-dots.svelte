<script lang="ts">
  /**
   * The mesh at work: three small squares hopping in turn and a word pulsing in opacity only.
   * Shared by Capture (interpreting) and Ask (the answer's phase line).
   */
  let { label, hidden = false }: { label: string; hidden?: boolean } = $props()
</script>

<span class="inline-flex items-baseline gap-[0.4em]" data-testid="working-dots">
  <span class="inline-flex gap-[0.12em]" aria-hidden="true">
    {#each [0, 1, 2] as i (i)}
      <span
        class="inline-block size-[0.16em] min-w-[3px] min-h-[3px] bg-current animate-[dot-jump_1.1s_var(--ease-io)_infinite] motion-reduce:animate-none"
        style:animation-delay="{i * 140}ms"
      ></span>
    {/each}
  </span>
  <span
    class={[
      'text-ink-2 animate-[breathe_2.2s_var(--ease-io)_infinite] transition-opacity duration-200 ease-settle motion-reduce:[animation:none]',
      hidden && 'opacity-0 !animate-none',
    ]}
    aria-live="polite">{label}</span
  >
</span>
