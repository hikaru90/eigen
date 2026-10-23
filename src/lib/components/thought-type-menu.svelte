<script lang="ts">
  /**
   * The type control on a thought's meta line (ei app.js:1328 `.kd-tog`, 1404-1418):
   * a dashed-underlined word that opens the same type menu Capture uses
   * (capture-reading.svelte) — each option with its one-line definition (ei
   * KIND_ITEMS, app.js:265-271). The options are the user's active thought_category
   * kinds; the caller owns what a pick does (it goes to the real edit endpoint).
   * Prop-driven, no `$effect`; the menu is a shadcn Popover (translucent paper).
   */
  import { categoryLabel } from '$lib/capture/reading-state'
  import * as Popover from '$lib/components/ui/popover'
  import { m } from '$lib/paraglide/messages.js'

  type Kind = { key: string; name: string; definition: string }

  let {
    kinds,
    current,
    open = false,
    busy = false,
    onOpenChange,
    onPick,
  }: {
    kinds: Kind[]
    /** The thought's persisted category key. */
    current: string
    open?: boolean
    /** A save is in flight — the word waits. */
    busy?: boolean
    onOpenChange?: (open: boolean) => void
    onPick?: (key: string) => void
  } = $props()

  /** The kind's name; a key outside the active catalog still reads as a word. */
  const currentLabel = $derived(
    kinds.find((kind) => kind.key === current)?.name ?? categoryLabel(current),
  )
</script>

<Popover.Root {open} onOpenChange={(o) => onOpenChange?.(o)}>
  <Popover.Trigger
    class="border-0 p-0 bg-transparent [font:inherit] text-ink-2 underline decoration-dashed decoration-ink-4 underline-offset-[3px] [transition:color_0.3s,text-decoration-color_0.3s] disabled:text-ink-3 cursor-pointer pointer-fine:hover:enabled:text-ink pointer-fine:hover:enabled:decoration-signal"
    data-testid="thought-type"
    aria-haspopup="menu"
    aria-expanded={open}
    disabled={busy}
  >
    {currentLabel}
  </Popover.Trigger>
  <Popover.Content
    class="gap-0 w-auto min-w-[240px] max-w-[300px] p-1.5 font-mesh text-ink"
    align="start"
    role="menu"
    aria-label={m.capture_reading_sounds_like()}
  >
    {#each kinds as kind (kind.key)}
      <button
        type="button"
        role="menuitemradio"
        aria-checked={kind.key === current}
        class={[
          "flex items-start gap-3 w-full px-3 py-2 border-0 rounded-[10px] bg-transparent [font:inherit] text-left text-ink-2 cursor-pointer transition-[background,color] duration-200 pointer-fine:hover:bg-paper-2 pointer-fine:hover:text-ink",
          kind.key === current && 'text-ink',
        ]}
        data-testid={'thought-type-' + kind.key}
        onclick={() => onPick?.(kind.key)}
      >
        <span
          class="shrink-0 size-1.5 mt-1.5 rounded-full shadow-[inset_0_0_0_1px_var(--ink-3)]"
          class:bg-ink={kind.key === current}
          class:shadow-none={kind.key === current}
          aria-hidden="true"
        ></span>
        <span class="flex flex-col gap-0.5">
          <span class="text-sm tracking-[-0.01em]">{kind.name}</span>
          {#if kind.definition}<small class="text-sm text-ink-3">{kind.definition}</small>{/if}
        </span>
      </button>
    {/each}
  </Popover.Content>
</Popover.Root>

