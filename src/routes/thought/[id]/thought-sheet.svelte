<script lang="ts">
  /**
   * A thought, up close (DESIGN.md "A thought, up close" + "Pages, never modals"; ei
   * index.html:199-203, app.js:1320-1502, styles.css:1116-1170). A full page inside
   * the app's one container: it fades in while its content settles from scale 1.1 → 1,
   * blur to sharp. Leave with the ✕, esc, or a swipe down from the top (the yarn handle
   * shows that on touch). Every mutation is an explicit call to an existing endpoint
   * from an event boundary, and the page re-reads the thought afterwards — never a
   * `$effect`, never an invented state.
   *
   *   words        → POST /api/capture/edit  { thoughtId, editRequest }
   *   type         → POST /api/capture/edit  (the same endpoint; see notes in the result)
   *   thread       → POST /api/timeline/projects/assign
   *   echoes       → POST /api/retrieval/search (as Capture's echo does)
   *   forget       → DELETE /api/thoughts/[id]
   *   re-read      → GET /api/thoughts/[id]
   */
  import type { ThoughtPageThought } from './+page.server'
  import { onMount, tick } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { consumeCaptureNdjsonStream } from '$lib/capture/consume-capture-ndjson'
  import { relativeDayLabel } from '$lib/chat/relative-day'
  import MeshSpinner from '$lib/components/brand/mesh-spinner.svelte'
  import ThoughtForget from '$lib/components/thought-forget.svelte'
  import ThoughtThreadMenu from '$lib/components/thought-thread-menu.svelte'
  import ThoughtTypeMenu from '$lib/components/thought-type-menu.svelte'
  import { fetchEchoRows, type EchoRow } from '$lib/memory/echo-list'
  import { prefersReducedMotion } from '$lib/motion/settle'
  import { m } from '$lib/paraglide/messages.js'
  import { getLocale } from '$lib/paraglide/runtime'
  import { pageInputDrafts } from '$lib/stores/page-input-drafts.svelte'
  import { showWhisper } from '$lib/stores/whisper.svelte'
  import type { ThoughtKindOption } from '$lib/thought/kind-option'
  import {
    assignThoughtThread,
    fetchThreadOptions,
    setThoughtType,
    unassignThoughtThread,
    type ThreadPick,
    type ThreadRef,
  } from '$lib/thought/type-thread-client'
  import { echoHref, inAppHref } from './app-href'
  import { askDraftFor, askHrefFor } from './ask-handoff'
  import { replaceTextEditRequest, textChange } from './edit-request'
  import { createForgetArm } from './forget-arm.svelte'
  import { leaveTarget } from './leave-target'
  import { pullToLeave } from './pull-to-leave'
  import { longDateLabel } from './thought-meta'


  let {
    thought,
    kinds,
    preferredTimezone,
  }: {
    thought: ThoughtPageThought
    kinds: ThoughtKindOption[]
    preferredTimezone: string
  } = $props()

  /* ————— what the page shows: the server's thought, with confirmed updates folded in ————— */

  let textOverride = $state<string | null>(null)
  let categoryOverride = $state<string | null>(null)
  let threadOverride = $state<ThreadRef | null | undefined>(undefined)

  const text = $derived(textOverride ?? thought.text)
  const category = $derived(categoryOverride ?? thought.category)
  const thread = $derived(threadOverride === undefined ? thought.thread : threadOverride)

  const locale = $derived(getLocale())
  const dateLabel = $derived(
    longDateLabel(thought.createdAtIso, { locale, timeZone: preferredTimezone }),
  )

  /** Render-time instant for the echoes' "ago" words, like Yarn's fresh dot. */
  const now = new Date()

  let err = $state<string | null>(null)

  /* ————— leaving: ✕, esc, swipe down (the `from` param says where to) ————— */

  const leaveTo = $derived(leaveTarget(page.url.searchParams.get('from')))
  let leaving = $state(false)

  async function leave(): Promise<void> {
    if (leaving) return
    leaving = true
    // ei styles.css:1130 — the page fades out before the one beneath shows
    if (!prefersReducedMotion()) await new Promise((r) => setTimeout(r, 320))
    await goto(inAppHref(leaveTo))
  }

  function onWindowKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return
    // the field and the menus handle their own esc (capture phase: they are still open here)
    if (editing || typeMenuOpen || threadMenuOpen) return
    e.preventDefault()
    void leave()
  }

  /* ————— re-read after a mutation: the page never guesses what the server kept ————— */

  async function refreshThought(): Promise<void> {
    const res = await fetch(`/api/thoughts/${encodeURIComponent(thought.id)}`, {
      credentials: 'same-origin',
    })
    if (!res.ok) throw new Error(`Thought re-read failed (${res.status})`)
    const body = (await res.json()) as { normalizedText?: unknown; category?: unknown }
    if (typeof body.normalizedText === 'string' && body.normalizedText.trim()) {
      textOverride = body.normalizedText
    }
    if (typeof body.category === 'string' && body.category) {
      categoryOverride = body.category
    }
  }

  /* ————— the existing edit endpoint: words and type ————— */

  let saving = $state(false)

  /** True when the server kept the edit and the page re-read it. */
  async function applyEdit(editRequest: string): Promise<boolean> {
    saving = true
    err = null
    try {
      const res = await fetch('/api/capture/edit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson, application/json',
        },
        body: JSON.stringify({ thoughtId: thought.id, editRequest }),
        credentials: 'same-origin',
      })
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('application/x-ndjson')) {
        await consumeCaptureNdjsonStream<unknown>(res, () => {})
      } else if (!res.ok) {
        throw new Error((await res.text()) || `Edit failed (${res.status})`)
      }
      await refreshThought()
      // ei app.js:1437 — knitting it back in
      showWhisper([
        { text: m.whisper_knitting(), durationMs: 900 },
        { text: m.whisper_kept(), durationMs: 1300 },
      ])
      return true
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      saving = false
    }
  }

  /* the pencil: the words, edited in place (ei app.js:1419-1450) */

  let editing = $state(false)
  let draft = $state('')
  let editEl = $state<HTMLTextAreaElement | null>(null)

  async function startEdit(): Promise<void> {
    if (editing || saving) return
    draft = text
    editing = true
    await tick()
    const el = editEl
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }

  /** Enter saves, then the blur that follows must not save again (ei app.js:1429). */
  function finishEdit(save: boolean): void {
    if (!editing) return
    const next = save ? textChange(text, draft) : null
    editing = false
    draft = ''
    if (next === null) return
    void saveWords(next)
  }

  async function saveWords(next: string): Promise<void> {
    // the user's words show at once, blurred, until the server has kept them
    const prior = textOverride
    textOverride = next
    const kept = await applyEdit(replaceTextEditRequest(next))
    // a failed save never leaves unsaved words on the page
    if (!kept) textOverride = prior
  }

  function onEditKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      finishEdit(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      finishEdit(false)
    }
  }

  /* the type: the same menu as Capture (ei app.js:1404-1418) */

  let typeMenuOpen = $state(false)

  /** The type is the user's pick: set directly (PATCH category), never re-read from the words. */
  async function pickType(key: string): Promise<void> {
    typeMenuOpen = false
    if (key === category || saving) return
    saving = true
    err = null
    try {
      await setThoughtType(thought.id, key)
      await refreshThought()
      showWhisper([{ text: m.whisper_kept(), durationMs: 1300 }])
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    } finally {
      saving = false
    }
  }

  /* ————— the thread: existing project-assign endpoint (ei app.js:1451-1465) ————— */
  let threadMenuOpen = $state(false)
  let threadOptions = $state<ThreadRef[]>([])
  let threadOptionsLoaded = $state(false)
  let threadOptionsLoading = $state(false)
  let newThreadLabel = $state('')
  let assigning = $state(false)

  function onThreadMenuChange(open: boolean): void {
    threadMenuOpen = open
    if (open && !threadOptionsLoaded) void loadThreadOptions()
  }

  async function loadThreadOptions(): Promise<void> {
    threadOptionsLoaded = true
    threadOptionsLoading = true
    try {
      threadOptions = await fetchThreadOptions()
    } catch {
      // the picker still offers a new thread — the list is best-effort
    } finally {
      threadOptionsLoading = false
    }
  }

  /** The user's pick: the thought leaves its thread (the same assign endpoint, DELETE). */
  async function unassignThread(): Promise<void> {
    threadMenuOpen = false
    if (assigning) return
    assigning = true
    err = null
    try {
      await unassignThoughtThread(thought.id)
      threadOverride = null
      showWhisper([{ text: m.whisper_kept(), durationMs: 1400 }])
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    } finally {
      assigning = false
    }
  }

  async function pickThread(pick: ThreadPick): Promise<void> {
    threadMenuOpen = false
    if (assigning) return
    if ('entityId' in pick && thread?.entityId === pick.entityId) return
    assigning = true
    err = null
    try {
      const landed = await assignThoughtThread(thought.id, pick)
      threadOverride = landed
      if (!threadOptions.some((o) => o.entityId === landed.entityId)) {
        threadOptions = [...threadOptions, landed]
      }
      newThreadLabel = ''
      showWhisper([{ text: m.whisper_kept(), durationMs: 1400 }])
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    } finally {
      assigning = false
    }
  }

  /* ————— echoes: the close thoughts, fetched once on open (ei app.js:1334) ————— */

  let echoes = $state<EchoRow[]>([])
  let echoError = $state<string | null>(null)
  const forgetArm = createForgetArm()

  onMount(() => {
    const controller = new AbortController()
    void fetchEchoRows(thought.text, thought.id, controller.signal)
      .then((rows) => {
        echoes = rows
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        echoError = err instanceof Error ? err.message : String(err)
      })
    return () => {
      controller.abort()
      forgetArm.dispose()
    }
  })

  /* ————— actions: Ask what connects to this · Forget (ei app.js:1472-1483) ————— */

  function askConnects(): void {
    pageInputDrafts.chat = askDraftFor(text)
    void goto(inAppHref(askHrefFor(thought.id)))
  }

  let forgetting = $state(false)

  async function tapForget(): Promise<void> {
    if (forgetting) return
    if (forgetArm.tap() !== 'confirmed') return
    forgetting = true
    err = null
    try {
      const res = await fetch(`/api/thoughts/${encodeURIComponent(thought.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error((await res.text()) || `Forget failed (${res.status})`)
      showWhisper([{ text: m.whisper_forgotten(), durationMs: 1500 }])
      await leave()
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
      forgetting = false
    }
  }
</script>

<svelte:window onkeydowncapture={onWindowKey} />

<div
  class="relative flex flex-col animate-[sheet-in_0.7s_var(--ease)_backwards] transition-opacity duration-300 ease-settle"
  class:opacity-0={leaving}
  data-testid="thought-page"
  data-thought-id={thought.id}
  use:pullToLeave={{ onLeave: () => void leave(), enabled: () => !editing && !leaving }}
>
  <button
    class="sticky top-[calc(var(--head,68px)+10px)] z-[2] self-end mt-[calc(var(--head,68px)+10px)] mr-[18px] mb-2 grid size-8 place-items-center rounded-full p-0 border-0 bg-transparent text-ink-2 transition-colors duration-300 before:absolute before:-inset-2 before:content-[''] pointer-fine:hover:text-ink"
    type="button"
    aria-label={m.graph_close()}
    onclick={() => void leave()}
  >
    <svg
      class="size-3.5 fill-none stroke-current [stroke-width:1.4] [stroke-linecap:round]"
      viewBox="0 0 16 16"
      aria-hidden="true"
      ><path d="M4 4l8 8M12 4l-8 8" /></svg
    >
  </button>

  <article
    class="mx-auto w-[min(640px,calc(100vw-48px))] max-[640px]:w-[calc(100vw-44px)] pt-2 pb-[calc(var(--bottom-nav,calc(62px+env(safe-area-inset-bottom,0px)))+120px)] [transform-origin:50%_30%] [translate:0_var(--pull,0px)] animate-[card-in_1.1s_var(--ease)_0.08s_backwards] [transition:translate_0.5s_var(--ease),opacity_0.4s_var(--ease),filter_0.4s_var(--ease),scale_0.4s_var(--ease)] [.is-pulling_&]:transition-none [.is-pulling_&]:opacity-[calc(1-var(--pull,0px)/400px)]"
    class:opacity-0={leaving}
    class:scale-105={leaving}
    class:blur-[6px]={leaving}
  >
    <!-- the yarn handle: swipe down to leave, shown only where a finger can pull -->
    <span
      class="hidden hover-none:pointer-coarse:block w-9 h-1 mx-auto mb-[18px] bg-ink-4 [mask:var(--yarn-wave)_repeat-x_0_0/6px_4px]"
      aria-hidden="true"
    ></span>

    <div class="flex items-center gap-[0.4em] min-h-4 pr-11 font-mesh text-sm text-ink-3 [&_.meta-spinner]:shrink-0">
      {#if saving}
        <MeshSpinner working size={14} class="meta-spinner" />
      {/if}
      <time datetime={thought.createdAtIso}>{dateLabel}</time>
      <span class="opacity-80" aria-hidden="true">·</span>
      <ThoughtTypeMenu
        {kinds}
        current={category}
        open={typeMenuOpen}
        busy={saving}
        onOpenChange={(o) => (typeMenuOpen = o)}
        onPick={(key) => void pickType(key)}
      />
    </div>

    {#if editing}
      <textarea
        bind:this={editEl}
        bind:value={draft}
        class="block w-full mt-[18px] [field-sizing:content] p-0 border-0 outline-none resize-none overflow-y-auto bg-transparent caret-signal font-you text-[clamp(28px,4vw,38px)] leading-[1.14] tracking-[-0.014em] text-ink"
        rows="1"
        aria-label={m.thought_edit()}
        data-testid="thought-edit-field"
        onkeydown={onEditKey}
        onblur={() => finishEdit(true)}
      ></textarea>
    {:else}
      <p
        class={[
          'mt-[18px] font-you text-[clamp(28px,4vw,38px)] leading-[1.14] tracking-[-0.014em] text-pretty text-ink [transition:color_0.5s_var(--ease),filter_0.5s_var(--ease)]',
          saving && 'text-ink-2 blur-[0.8px]',
          thought.status === 'completed' && 'text-ink-3 line-through decoration-ink-4 decoration-1',
        ]}
        data-testid="thought-text"
      >
        {text}<button
          class="relative inline-grid place-items-center w-[0.8em] h-[0.8em] ml-[0.25em] align-[-0.04em] rounded-full p-0 border-0 bg-transparent text-ink-3 [transition:color_0.3s,background_0.3s] before:absolute before:-inset-2 before:content-[''] disabled:text-ink-4 pointer-fine:hover:text-ink pointer-fine:hover:enabled:bg-paper-2"
          type="button"
          aria-label={m.thought_edit()}
          data-testid="thought-edit"
          disabled={saving}
          onclick={() => void startEdit()}
        >
          <svg
            class="size-[0.42em] fill-none stroke-current [stroke-width:1.5] [stroke-linecap:round] [stroke-linejoin:round]"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path d="M10.6 2.9l2.5 2.5M3 13l.6-3.1 7.6-7.6a1.2 1.2 0 011.7 0l.8.8a1.2 1.2 0 010 1.7l-7.6 7.6z" />
          </svg>
        </button>
      </p>
    {/if}

    <div class="flex flex-wrap items-center gap-4 mt-[26px]">
      <ThoughtThreadMenu
        {thread}
        options={threadOptions}
        loading={threadOptionsLoading}
        open={threadMenuOpen}
        busy={assigning}
        {newThreadLabel}
        onOpenChange={onThreadMenuChange}
        onPick={(pick) => void pickThread(pick)}
        onNewThreadLabel={(label) => (newThreadLabel = label)}
        onUnassign={() => void unassignThread()}
      />
    </div>

    {#if echoes.length > 0}
      <section class="mt-[38px]" aria-label={m.thought_echoes()}>
        <div class="mb-3 font-mesh text-sm text-ink-3 animate-[fade_0.6s_var(--ease)_both]">{m.thought_echoes()}</div>
        {#each echoes as echo, i (echo.id)}
          <div
            class="flex items-start justify-between gap-3.5 py-[13px] border-t border-line animate-[rise_0.8s_var(--ease)_both] [animation-delay:calc(var(--i,0)*28ms)]"
            style:--i={i}
          >
            <span>
              <span class="block font-you text-[19px] leading-[1.28] text-ink-2">{echo.text}</span>
              {#if echo.createdAtIso}
                <small class="block mt-[3px] font-mesh text-sm text-ink-3">{relativeDayLabel(echo.createdAtIso, now, locale)}</small>
              {/if}
            </span>
            <a
              class="relative shrink-0 grid size-6 place-items-center -mt-px -mr-1 rounded-full text-ink-3 transition-colors duration-300 ease-settle before:absolute before:-inset-2 before:content-[''] pointer-fine:hover:text-ink"
              href={echoHref(echo.id, leaveTo)}
              aria-label={m.desk_action_open_task()}
              data-testid={'thought-echo-open-' + echo.id}
            >
              <svg
                class="size-[13px] fill-none stroke-current [stroke-width:1.3] [stroke-linecap:round] [stroke-linejoin:round]"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path d="M9.5 3.5h3v3M6.5 12.5h-3v-3M12.5 3.5 9.2 6.8M3.5 12.5l3.3-3.3" />
              </svg>
            </a>
          </div>
        {/each}
      </section>
    {/if}
    {#if echoError}
      <p class="mt-[38px] font-mesh text-sm text-warn" role="alert">{echoError}</p>
    {/if}

    {#if err}
      <p class="mt-[18px] font-mesh text-sm leading-[1.5] text-warn" role="alert">{err}</p>
    {/if}

    <div class="flex justify-between mt-[30px] pt-[18px] border-t border-line">
      <button
        class="border-0 p-0 bg-transparent font-mesh text-sm text-ink-2 transition-colors duration-300 cursor-pointer pointer-fine:hover:text-ink"
        type="button"
        data-testid="thought-ask"
        onclick={askConnects}
      >
        {m.nav_ask()}
      </button>
      <ThoughtForget armed={forgetArm.armed} busy={forgetting} ontap={() => void tapForget()} />
    </div>
  </article>
</div>

