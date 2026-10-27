<script lang="ts">
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'
  import {
    categoryLabel,
    readingTypeKeys,
    type ReadingDraft,
    type ThreadChoice,
  } from '$lib/capture/reading-state'
  import GlyphScramble from '$lib/components/brand/glyph-scramble.svelte'
  import * as Popover from '$lib/components/ui/popover'
  import { m } from '$lib/paraglide/messages.js'

  type ThreadOption = { entityId: string; label: string }

  let {
    waiting = false,
    draft = null,
    error = null,
    threadChoice = { kind: 'loose' },
    typeMenuOpen = false,
    threadMenuOpen = false,
    newThreadLabel = '',
    projects = [],
    hashQuery = null,
    onTypeMenuChange,
    onThreadMenuChange,
    onPickType,
    onPickThread,
    onNewThreadLabel,
    onSay,
  }: {
    /** The mesh is interpreting — hopping dots and a pulsing word. */
    waiting?: boolean
    /** The accepted reading (client copy of the preview; nothing stored yet). */
    draft?: ReadingDraft | null
    error?: string | null
    threadChoice?: ThreadChoice
    typeMenuOpen?: boolean
    threadMenuOpen?: boolean
    newThreadLabel?: string
    projects?: ThreadOption[]
    /** Non-null while an inline `#` gesture drives the thread picker. */
    hashQuery?: string | null
    onTypeMenuChange?: (open: boolean) => void
    onThreadMenuChange?: (open: boolean) => void
    /** Pick a type among the LLM's own options — mutates the accepted copy (page-owned). */
    onPickType?: (key: string) => void
    onPickThread?: (choice: ThreadChoice) => void
    onNewThreadLabel?: (label: string) => void
    /** The pencil: say how to keep it, in your own words (applied as a natural-language edit after storing). */
    onSay?: (text: string) => void
  } = $props()

  const showWords = $derived(!!draft && !waiting)
  const typeKeys = $derived(draft ? readingTypeKeys(draft) : [])
  const shownType = $derived(draft ? draft.reading.category.key : null)
  const filteredProjects = $derived.by(() => {
    if (hashQuery === null) return projects
    const q = hashQuery.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((p) => p.label.toLowerCase().includes(q))
  })
  const threadWord = $derived(
    threadChoice.kind === 'thread' ? threadChoice.label : m.capture_reading_loose(),
  )

  let saying = $state(false)
  let saidText = $state('')

  function submitSaid() {
    const text = saidText.trim()
    if (!text) {
      saying = false
      saidText = ''
      return
    }
    saying = false
    saidText = ''
    onSay?.(text)
  }

  function pickNewThread() {
    const label = newThreadLabel.trim()
    if (!label) return
    onPickThread?.({ kind: 'thread', label })
  }
</script>

<div
  class={["grid grid-rows-[0fr] mt-0 opacity-0 [transition:grid-template-rows_0.75s_var(--ease),margin_0.75s_var(--ease),opacity_0.5s_var(--ease)]", waiting || showWords || !!error ? 'grid-rows-[1fr] opacity-100' : '']}
  data-testid="capture-reading"
>
  <div class="min-h-0 overflow-hidden pb-[0.12em] font-mesh text-[clamp(28px,3.9vw,42px)] leading-[1.22] tracking-[-0.034em] text-ink-3">
    {#if waiting}
      <span class="font-you text-ink" data-testid="capture-reading-interpreting">
        <GlyphScramble text={m.capture_reading_interpreting()} />
      </span>
    {:else if showWords && draft}
      <span class="animate-[fade_0.5s_var(--ease)_both] motion-reduce:[animation:none]">
        {m.capture_reading_sounds_like()}
        <Popover.Root open={typeMenuOpen} onOpenChange={(o) => onTypeMenuChange?.(o)}>
          <Popover.Trigger
            class="border-0 px-[0.05em] bg-transparent [font:inherit] tracking-[inherit] text-ink leading-[inherit] no-underline decoration-dashed decoration-ink-4 [text-decoration-thickness:1.5px] [text-underline-offset:0.17em] [transition:text-decoration-color_0.3s,color_0.3s] cursor-pointer pointer-fine:hover:decoration-signal"
            data-testid="capture-reading-type"
            aria-haspopup="menu"
            aria-expanded={typeMenuOpen}
          >
            {categoryLabel(shownType ?? '')}<ChevronDownIcon class="inline-block size-[0.5em] ml-[0.12em] align-middle text-ink-3" strokeWidth={2} aria-hidden="true" />
          </Popover.Trigger>
          <Popover.Content
            class="paper-menu max-h-[min(60svh,var(--bits-popover-content-available-height))] overflow-y-auto overscroll-contain"
            align="start"
            role="menu"
            aria-label={m.capture_reading_sounds_like()}
          >
            {#each typeKeys as key (key)}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={key === shownType}
                class="flex items-baseline justify-between gap-3.5 w-full px-2.5 py-2 border-0 rounded-md bg-transparent text-base tracking-[-0.01em] text-ink-2 text-left cursor-pointer transition-[background,color] duration-300 ease-settle pointer-fine:hover:bg-paper-2 pointer-fine:hover:text-ink"
                class:is-current={key === shownType}
                onclick={() => onPickType?.(key)}
              >
                <span class="text-base tracking-[-0.01em]">{categoryLabel(key)}</span>
              </button>
            {/each}
          </Popover.Content>
        </Popover.Root>

        <span class="mx-[0.22em] opacity-70" aria-hidden="true">·</span>
        <span class="whitespace-nowrap">
          <Popover.Root
            open={threadMenuOpen || hashQuery !== null}
            onOpenChange={(o) => onThreadMenuChange?.(o)}
          >
          <Popover.Trigger
            class={["border-0 px-[0.05em] bg-transparent [font:inherit] tracking-[inherit] text-ink leading-[inherit] no-underline decoration-dashed decoration-ink-4 [text-decoration-thickness:1.5px] [text-underline-offset:0.17em] [transition:text-decoration-color_0.3s,color_0.3s] cursor-pointer pointer-fine:hover:decoration-signal", threadChoice.kind === 'thread' && 'font-you text-[0.82em] tracking-[-0.01em]']}
            data-testid="capture-reading-thread"
            aria-haspopup="menu"
            aria-expanded={threadMenuOpen || hashQuery !== null}
          >
              {threadWord}<ChevronDownIcon class="inline-block size-[0.5em] ml-[0.12em] align-middle text-ink-3" strokeWidth={2} aria-hidden="true" />
            </Popover.Trigger>
            <Popover.Content
              class="gap-0 p-1.5 font-mesh max-h-[min(60svh,var(--bits-popover-content-available-height))] overflow-y-auto overscroll-contain"
              align="start"
              role="menu"
              aria-label={m.capture_reading_loose()}
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={threadChoice.kind === 'loose'}
                class="flex items-baseline justify-between gap-3.5 w-full px-2.5 py-2 border-0 rounded-md bg-transparent text-base tracking-[-0.01em] text-ink-2 text-left cursor-pointer transition-[background,color] duration-300 ease-settle pointer-fine:hover:bg-paper-2 pointer-fine:hover:text-ink"
                class:is-current={threadChoice.kind === 'loose'}
                data-testid="capture-thread-loose"
                onclick={() => onPickThread?.({ kind: 'loose' })}
              >
                <span class="text-base tracking-[-0.01em]">{m.capture_reading_loose()}</span>
              </button>
              {#each filteredProjects as project (project.entityId)}
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={threadChoice.kind === 'thread' && threadChoice.entityId === project.entityId}
                  class="flex items-baseline justify-between gap-3.5 w-full px-2.5 py-2 border-0 rounded-md bg-transparent text-base tracking-[-0.01em] text-ink-2 text-left cursor-pointer transition-[background,color] duration-300 ease-settle pointer-fine:hover:bg-paper-2 pointer-fine:hover:text-ink"
                  class:is-current={threadChoice.kind === 'thread' && threadChoice.entityId === project.entityId}
                  onclick={() => onPickThread?.({ kind: 'thread', entityId: project.entityId, label: project.label })}
                >
                  <span class="font-you text-[0.82em] tracking-[-0.01em]">{project.label}</span>
                </button>
              {/each}
              {#if hashQuery !== null && filteredProjects.length === 0}
                <p class="px-2.5 py-2 text-sm text-ink-3">{m.yarn_no_matches()}</p>
              {/if}
              <div class="flex items-center gap-1.5 mt-1 pt-1.5 border-t border-line">
                <input
                  class="min-w-0 flex-1 px-0.5 py-1 border-0 border-b border-ink-4 outline-none bg-transparent font-you text-sm text-ink caret-signal placeholder:text-ink-3"
                  type="text"
                  placeholder={m.capture_reading_new_thread()}
                  aria-label={m.capture_reading_new_thread()}
                  value={newThreadLabel}
                  oninput={(e) => onNewThreadLabel?.(e.currentTarget.value)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      pickNewThread()
                    }
                  }}
                />
                <button type="button" class="flex items-baseline justify-between gap-3.5 w-full px-2.5 py-2 border-0 rounded-md bg-transparent text-base tracking-[-0.01em] text-ink-2 text-left cursor-pointer transition-[background,color] duration-300 ease-settle pointer-fine:hover:bg-paper-2 pointer-fine:hover:text-ink w-auto shrink-0" onclick={pickNewThread}>
                  <span class="text-base tracking-[-0.01em]">{m.capture_reading_new_thread()}</span>
                </button>
              </div>
            </Popover.Content>
          </Popover.Root>
          <button
            type="button"
            class="pencil"
            aria-label={m.thought_edit()}
            data-testid="capture-reading-pencil"
            onclick={() => {
              saying = true
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10.6 2.9l2.5 2.5M3 13l.6-3.1 7.6-7.6a1.2 1.2 0 011.7 0l.8.8a1.2 1.2 0 010 1.7l-7.6 7.6z" />
            </svg>
          </button>
        </span>
      </span>
    {/if}

    {#if saying}
      <input
        class="said-input"
        type="text"
        data-testid="capture-reading-said"
        bind:value={saidText}
        aria-label={m.thought_edit()}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submitSaid()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            saying = false
            saidText = ''
          }
        }}
      />
    {:else if error}
      <span class="reading-error" role="status">{error}</span>
    {/if}
  </div>
</div>

