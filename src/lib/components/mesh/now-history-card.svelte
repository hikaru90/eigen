<script lang="ts">
  import { base, resolve } from '$app/paths'
  import { m } from '$lib/paraglide/messages.js'
  import { getLocale } from '$lib/paraglide/runtime'

  /** Read-only list of answered Now cards (docs/planning/feature-mesh-now.md, NOW-14). */

  type Item = {
    cardId: string
    kind: 'do' | 'sort' | 'file' | 'unblock'
    text: string
    answer: string
    projectLabel: string | null
    answeredAt: string
    thoughtId: string | null
  }

  let { count: initialCount, timezone }: { count: number; timezone: string } = $props()

  // svelte-ignore state_referenced_locally (one-time server seed; the card's handlers keep it current)
  let count = $state(initialCount)
  let open = $state(false)
  let loaded = $state(false)
  let loading = $state(false)
  let failed = $state(false)
  let items = $state<Item[]>([])
  let nextCursor = $state<string | null>(null)

  /** Fetches one page; `append` adds to the list, otherwise it replaces it. */
  async function fetchPage(before: string | null, append: boolean): Promise<void> {
    loading = true
    failed = false
    try {
      const query = before ? `?before=${encodeURIComponent(before)}` : ''
      const res = await fetch(`${base}/api/mesh/now/history${query}`, { credentials: 'include' })
      if (!res.ok) throw new Error(`now history failed: ${res.status}`)
      const body = (await res.json()) as { items: Item[]; nextCursor: string | null }
      items = append ? [...items, ...body.items] : body.items
      nextCursor = body.nextCursor
      loaded = true
      if (!append && body.nextCursor === null) count = body.items.length
    } catch (error) {
      console.error('[now] history load failed', error)
      failed = true
    } finally {
      loading = false
    }
  }

  function toggle(): void {
    open = !open
    if (open && !loaded && !loading) void fetchPage(null, false)
  }

  /** The card saved an answer: the count follows, and an already loaded list is read again. */
  export function noteAnswered(): void {
    count += 1
    if (loaded) void fetchPage(null, false)
  }

  /** The card saved an Undo. */
  export function noteUndone(): void {
    count = Math.max(0, count - 1)
    if (loaded) void fetchPage(null, false)
  }

  function answerPhrase(item: Item): string {
    const project = item.projectLabel ?? ''
    switch (item.answer) {
      case 'done':
        return m.now_did_done()
      case 'drop':
        return m.now_did_drop()
      case 'keep':
        return m.now_history_keep()
      case 'not_now':
        return m.now_history_not_now()
      case 'too_big':
        return m.now_history_too_big()
      case 'not_a_task':
        return m.now_did_not_a_task()
      case 'other_project':
        return m.now_did_moved({ project })
      case 'yes':
        return item.kind === 'unblock'
          ? m.now_history_unblock_yes({ project })
          : m.now_did_moved({ project })
      case 'something_else':
        return m.now_history_something_else({ project })
      case 'someday':
        return m.now_history_someday({ project })
      case 'finished':
        return m.now_history_finished({ project })
      default:
        throw new Error(`Unknown Now answer key: ${item.answer}`)
    }
  }

  function dayKey(iso: string): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso))
  }

  function dayLabel(iso: string): string {
    const key = dayKey(iso)
    const now = Date.now()
    const locale = getLocale()
    for (const days of [0, 1]) {
      if (dayKey(new Date(now - days * 86_400_000).toISOString()) === key) {
        return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-days, 'day')
      }
    }
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    }).format(new Date(iso))
  }

  function timeLabel(iso: string): string {
    return new Intl.DateTimeFormat(getLocale(), {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  }

  const groups = $derived.by(() => {
    const out: Array<{ key: string; label: string; items: Item[] }> = []
    for (const item of items) {
      const key = dayKey(item.answeredAt)
      const last = out.at(-1)
      if (last && last.key === key) last.items.push(item)
      else out.push({ key, label: dayLabel(item.answeredAt), items: [item] })
    }
    return out
  })
</script>

{#if count > 0}
  <div class="mx-auto max-w-[700px] px-8 pt-3 max-[640px]:px-[22px]" data-testid="now-history">
    <button
      type="button"
      class="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent py-0 px-[21px] text-left font-mesh text-xs text-ink-3 transition-colors duration-300 ease-settle pointer-fine:hover:text-ink-2"
      aria-expanded={open}
      onclick={toggle}
    >
      <span>{m.now_history_label()}</span>
      <span class="flex items-center gap-1.5">
        {count}
        <svg
          class={[
            'size-3.5 fill-none stroke-current [stroke-width:1.4] [stroke-linecap:round] [stroke-linejoin:round] transition-transform duration-200 ease-settle',
            open && 'rotate-180',
          ]}
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </span>
    </button>

    {#if open}
      <div class="mt-2 animate-[fade_0.2s_var(--ease)_both] px-[21px] font-mesh">
        {#each groups as group (group.key)}
          <p class="m-0 mt-3 text-xs text-ink-3" data-testid="now-history-day">{group.label}</p>
          <ul class="m-0 mt-1 list-none p-0">
            {#each group.items as item (item.cardId)}
              <li class="border-b border-line py-2.5 first:border-t" data-testid="now-history-row">
                {#if item.thoughtId}
                  <a
                    class="text-sm leading-[1.45] text-ink-2 no-underline pointer-fine:hover:text-ink"
                    href={resolve('/thought/[id]', { id: item.thoughtId })}
                  >
                    {item.text}
                  </a>
                {:else}
                  <p class="m-0 text-sm leading-[1.45] text-ink-2">{item.text}</p>
                {/if}
                <p class="mt-0.5 mb-0 text-xs text-ink-3">{answerPhrase(item)} · {timeLabel(item.answeredAt)}</p>
              </li>
            {/each}
          </ul>
        {/each}
        {#if loading}
          <p class="mt-2.5 mb-0 text-xs text-ink-3" role="status">{m.now_history_loading()}</p>
        {:else if failed}
          <p class="mt-2.5 mb-0 text-xs text-ink-3" role="alert">{m.now_history_failed()}</p>
        {:else if nextCursor}
          <button
            type="button"
            class="mt-2.5 cursor-pointer border-0 bg-transparent p-0 text-xs text-ink-3 underline underline-offset-2 pointer-fine:hover:text-ink"
            onclick={() => void fetchPage(nextCursor, true)}
          >
            {m.now_history_more()}
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/if}
