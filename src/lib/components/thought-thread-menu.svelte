<script lang="ts">
  /**
   * A thought's thread (ei app.js:1331, 1451-1465 `.chip` + the project picker): an
   * outline pill — the secondary action level (DESIGN.md "Actions") — showing the
   * thread's name in your voice, or "no project". Tapping opens the same thread
   * picker Capture uses: the existing threads and a field for a new one. The caller
   * owns the pick (it goes to the existing project-assign endpoint) and loads the
   * options when the menu first opens. No `$effect`.
   */
  import { pillThreadButton } from '$lib/components/mesh/pill-classes'
  import * as Popover from '$lib/components/ui/popover'
  import { m } from '$lib/paraglide/messages.js'

  type ThreadRef = { entityId: string; label: string }
  type ThreadPick = { entityId: string } | { label: string }

  let {
    thread = null,
    options = [],
    loading = false,
    open = false,
    busy = false,
    newThreadLabel = '',
    onOpenChange,
    onPick,
    onNewThreadLabel,
    onUnassign,
    pill = false,
  }: {
    thread?: ThreadRef | null
    options?: ThreadRef[]
    loading?: boolean
    open?: boolean
    busy?: boolean
    newThreadLabel?: string
    onOpenChange?: (open: boolean) => void
    onPick?: (pick: ThreadPick) => void
    onNewThreadLabel?: (label: string) => void
    onUnassign?: () => void
    /** Render the trigger as a pill (the thought row's info line). */
    pill?: boolean
  } = $props()

  function pickNew() {
    const label = newThreadLabel.trim()
    if (!label) return
    onPick?.({ label })
  }
</script>

<Popover.Root {open} onOpenChange={(o) => onOpenChange?.(o)}>
  <Popover.Trigger
    class={pill
      ? pillThreadButton
      : `inline-flex items-center gap-2 h-[34px] pl-3.5 pr-4 border-0 rounded-full bg-transparent whitespace-nowrap font-mesh text-sm shadow-[inset_0_0_0_1px_var(--ink-4)] [transition:box-shadow_0.4s_var(--ease),color_0.4s_var(--ease)] disabled:text-ink-3 cursor-pointer pointer-fine:hover:enabled:text-ink pointer-fine:hover:enabled:shadow-[inset_0_0_0_1px_var(--ink-3)] ${thread ? 'text-ink' : 'text-ink-2'}`}
    data-testid="thought-thread"
    aria-haspopup="menu"
    aria-expanded={open}
    disabled={busy}
  >
    {#if pill}
      {thread ? thread.label : m.capture_reading_loose()}
    {:else}
      <span
        class="before:content-['#'] before:font-you before:text-base before:leading-none"
        aria-hidden="true"
      ></span>
      <span
        class={[
          'font-mesh text-sm',
          thread ? 'font-you text-base tracking-[-0.01em] translate-y-[0.5px]' : '',
        ]}>{thread ? thread.label : m.capture_reading_loose()}</span
      >
    {/if}
  </Popover.Trigger>
  <Popover.Content
    class="gap-0 w-auto min-w-[240px] max-w-[300px] p-1.5 font-mesh text-ink"
    align="start"
    role="menu"
    aria-label={m.capture_reading_loose()}
  >
    {#if thread}
      <button
        type="button"
        role="menuitemradio"
        aria-checked={false}
        data-testid="thought-thread-unassign"
        class="flex items-center gap-3 w-full px-3 py-2 border-0 rounded-[10px] bg-transparent [font:inherit] text-left text-ink-2 cursor-pointer transition-[background,color] duration-200 pointer-fine:hover:bg-paper-2 pointer-fine:hover:text-ink"
        onclick={() => onUnassign?.()}
      >
        <span
          class="shrink-0 size-1.5 rounded-full shadow-[inset_0_0_0_1px_var(--ink-3)]"
          aria-hidden="true"
        ></span>
        <span class="font-mesh text-sm">{m.capture_reading_loose()}</span>
      </button>
      <div class="border-t border-line mt-1 mb-0.5" aria-hidden="true"></div>
    {/if}
    {#if loading}
      <p class="px-3 py-2 text-sm text-ink-3">{m.graph_loading()}</p>
    {/if}
    {#each options as option (option.entityId)}
      <button
        type="button"
        role="menuitemradio"
        aria-checked={thread?.entityId === option.entityId}
        class={[
          'flex items-center gap-3 w-full px-3 py-2 border-0 rounded-[10px] bg-transparent [font:inherit] text-left text-ink-2 cursor-pointer transition-[background,color] duration-200 pointer-fine:hover:bg-paper-2 pointer-fine:hover:text-ink',
          thread?.entityId === option.entityId && 'text-ink',
        ]}
        onclick={() => onPick?.({ entityId: option.entityId })}
      >
        <span
          class="shrink-0 size-1.5 rounded-full shadow-[inset_0_0_0_1px_var(--ink-3)]"
          class:bg-ink={thread?.entityId === option.entityId}
          class:shadow-none={thread?.entityId === option.entityId}
          aria-hidden="true"
        ></span>
        <span class="font-you text-base tracking-[-0.01em]">{option.label}</span>
      </button>
    {/each}
    <div
      class={[
        'flex items-center gap-1.5 border-t border-line px-2 pt-1.5 mt-1',
        !loading && options.length === 0 && 'mt-0 pt-0.5 border-t-0',
      ]}
    >
      <input
        class="min-w-0 flex-1 px-0.5 py-1 border-0 border-b border-ink-4 outline-none bg-transparent font-you text-base text-ink caret-signal placeholder:text-ink-3"
        type="text"
        placeholder={m.capture_reading_new_thread()}
        aria-label={m.capture_reading_new_thread()}
        value={newThreadLabel}
        oninput={(e) => onNewThreadLabel?.(e.currentTarget.value)}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            pickNew()
          }
        }}
      />
      <button
        type="button"
        class="w-auto flex-none flex items-center gap-1.5 px-2 pt-1.5 pb-0 border-0 rounded-[10px] bg-transparent [font:inherit] text-left text-ink-2 cursor-pointer transition-[background,color] duration-200 pointer-fine:hover:bg-paper-2 pointer-fine:hover:text-ink"
        onclick={pickNew}
      >
        <span class="text-sm tracking-[-0.01em]">{m.capture_reading_new_thread()}</span>
      </button>
    </div>
  </Popover.Content>
</Popover.Root>
