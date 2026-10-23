<script lang="ts">
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'
  import { categoryLabel } from '$lib/capture/reading-state'
  import { loadMemoryCardDetails, type MemoryCardDetails } from '$lib/chat/memory-card-details'
  import { relativeDayLabel } from '$lib/chat/relative-day'
  import MeshSpinner from '$lib/components/brand/mesh-spinner.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import { getLocale } from '$lib/paraglide/runtime'

  /**
   * One thought used to answer, on one line — type pill, the thought, a caret — and the
   * whole line unfolds it in place — full text, its type, and linked thoughts under
   * the yarn line. Ask never shows thought ids and never navigates to the thought page.
   * Details load on the first expand click (GET /api/thoughts/[id] + echo retrieval).
   */
  type Props = {
    id?: string
    text: string
    category?: string
    /** Position in its list; staggers the row's settle (ei `--i`). */
    index?: number
  }

  let { id, text, category, index = 0 }: Props = $props()

  const uid = $props.id()
  const regionId = `memory-card-${uid}`

  let expanded = $state(false)
  let details = $state<MemoryCardDetails | null>(null)
  let loadingDetails = $state(false)
  let loadFailed = $state(false)

  const typeKey = $derived(details?.category ?? category ?? '')
  const typeLabel = $derived(typeKey ? categoryLabel(typeKey) : '')
  const fullText = $derived(details?.text ?? text)
  const locale = $derived(getLocale())

  async function toggle(): Promise<void> {
    expanded = !expanded
    if (!expanded || !id || details || loadingDetails) return
    loadingDetails = true
    loadFailed = false
    try {
      details = await loadMemoryCardDetails(id, text)
    } catch {
      loadFailed = true
    } finally {
      loadingDetails = false
    }
  }
</script>

<li
  class="list-none min-w-0 animate-[rise_0.7s_var(--ease)_both] [animation-delay:calc(var(--i,0)*70ms+0.05s)]"
  style:--i={index}
  data-testid="chat-memory-card"
>
  <!-- One line, the whole row is the toggle: type, the thought, the caret. -->
  <button
    type="button"
    class="flex items-center gap-2 w-full min-w-0 py-1 border-0 bg-transparent text-left cursor-pointer text-ink-3 transition-colors duration-300 ease-settle pointer-fine:hover:text-ink"
    aria-expanded={expanded}
    aria-controls={regionId}
    aria-label={expanded ? m.ask_source_collapse() : m.ask_source_expand()}
    data-testid="chat-memory-toggle"
    onclick={() => void toggle()}
  >
    {#if typeLabel}
      <span
        class="inline-flex shrink-0 items-center h-[18px] px-[7px] rounded-full bg-signal-2 text-signal font-mesh text-xs font-medium tracking-[0.02em] leading-none whitespace-nowrap"
        data-testid="chat-memory-type"
      >{typeLabel}</span>
    {/if}
    <span
      class={[
        'min-w-0 flex-1 font-you text-sm leading-[1.45] text-ink-2',
        expanded ? '[overflow-wrap:anywhere]' : 'truncate',
      ]}
      data-testid="chat-memory-text"
    >{fullText}</span>
    <ChevronDownIcon
      size={16}
      strokeWidth={1.5}
      aria-hidden="true"
      class={['shrink-0 transition-transform duration-500 ease-settle motion-reduce:transition-none', expanded && 'rotate-180']}
    />
  </button>

  <div
    id={regionId}
    class={[
      'grid transition-[grid-template-rows,opacity] duration-500 ease-settle motion-reduce:transition-none',
      expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
    ]}
    inert={!expanded}
    data-testid="chat-memory-details"
  >
    <div class="min-h-0 overflow-hidden">
      <div class="pt-1 pb-2">
        <div class="h-1 w-full bg-ink-4 [mask:var(--yarn-wave)_repeat-x_0_0/6px_4px]" aria-hidden="true"></div>
        {#if typeLabel}
          <p class="m-0 mt-2.5 font-mesh text-sm text-ink-3">
            {m.ask_source_type()}: <span class="text-ink-2">{typeLabel}</span>
          </p>
        {/if}
        {#if loadingDetails}
          <p class="flex items-center gap-2 m-0 mt-2.5 font-mesh text-sm text-ink-3" aria-live="polite">
            <MeshSpinner working size={16} />{m.ask_source_loading()}
          </p>
        {:else if loadFailed}
          <p class="m-0 mt-2.5 font-mesh text-sm text-warn" role="alert">{m.ask_source_load_failed()}</p>
        {:else if details && details.linked.length > 0}
          <section class="mt-3" aria-label={m.thought_echoes()}>
            <div class="font-mesh text-sm text-ink-3">{m.thought_echoes()}</div>
            <ul class="m-0 mt-1 p-0 list-none">
              {#each details.linked as echo (echo.id)}
                <li class="py-2 pl-3 border-l border-line">
                  <span class="block font-you text-sm leading-[1.4] text-ink-2 [overflow-wrap:anywhere]">{echo.text}</span>
                  {#if echo.createdAtIso}
                    <small class="block mt-0.5 font-mesh text-xs text-ink-3">{relativeDayLabel(echo.createdAtIso, new Date(), locale)}</small>
                  {/if}
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      </div>
    </div>
  </div>
</li>
