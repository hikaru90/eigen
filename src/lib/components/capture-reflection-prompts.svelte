<script lang="ts">
  import { m } from '$lib/paraglide/messages.js'

  /**
   * Today's reflection prompts under the Capture heading
   * (docs/planning/feature-capture-reflection-prompts.md). Tapping one hands it to the
   * writer; "Not today" hides them until tomorrow. A failure is said, not hidden.
   */
  let {
    prompts,
    error,
    onpick,
    ondismiss,
  }: {
    prompts: string[]
    error: string | null
    onpick: (prompt: string) => void
    ondismiss: () => void
  } = $props()
</script>

<div class="mt-7 max-w-[540px]" data-testid="capture-reflection-prompts">
  {#if error}
    <p class="m-0 font-mesh text-sm leading-[1.5] text-clay" role="status">
      {m.capture_reflect_error({ error })}
    </p>
  {:else}
    <span class="font-mesh text-sm text-ink-3">{m.capture_reflect_label()}</span>
    <ul class="m-0 mt-2 flex list-none flex-col gap-1 p-0">
      {#each prompts as prompt (prompt)}
        <li>
          <button
            type="button"
            class="w-full rounded-xl border-0 bg-transparent px-3 py-2 text-left font-you text-[17px] leading-[1.4] text-ink-2 transition-colors duration-300 ease-settle pointer-fine:hover:bg-paper-2 pointer-fine:hover:text-ink"
            data-testid="capture-reflection-prompt"
            onclick={() => onpick(prompt)}
          >
            {prompt}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <button
    type="button"
    class="mt-1 border-0 bg-transparent px-3 py-1 font-mesh text-sm text-ink-3 pointer-fine:hover:text-ink"
    data-testid="capture-reflection-dismiss"
    onclick={ondismiss}
  >
    {m.capture_reflect_dismiss()}
  </button>
</div>
