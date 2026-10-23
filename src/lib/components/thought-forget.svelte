<script lang="ts">
  /**
   * Forget — plain text, the lowest action level (DESIGN.md "Buttons, three levels";
   * ei app.js:1473-1483, styles.css:1169-1170). The first tap arms it ("Forget for
   * good?", in the warn colour) for a few seconds; a second tap confirms. The arm state
   * lives with the caller (a runes store, src/routes/thought/[id]/forget-arm.svelte.ts)
   * so this stays a dumb, prop-driven control.
   */
  import { m } from '$lib/paraglide/messages.js'

  let {
    armed = false,
    busy = false,
    ontap,
  }: {
    armed?: boolean
    /** The delete call is in flight. */
    busy?: boolean
    ontap: () => void
  } = $props()
</script>

<button
  class={["border-0 p-0 bg-transparent font-mesh text-sm transition-colors duration-300 cursor-pointer", armed ? 'text-warn pointer-fine:hover:enabled:text-warn' : 'text-ink-3 pointer-fine:hover:enabled:text-ink', 'disabled:text-ink-4']}
  type="button"
  data-testid="thought-forget"
  aria-live="polite"
  disabled={busy}
  onclick={() => ontap()}
>
  {armed ? m.thought_forget_confirm() : m.thought_forget()}
</button>

