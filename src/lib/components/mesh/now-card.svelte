<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { base } from '$app/paths'
  import { resolve } from '$app/paths'
  import { offlineStatus } from '$lib/offline/offline-status.svelte'
  import { m } from '$lib/paraglide/messages.js'

  /** The Lightning questions card (docs/planning/feature-mesh-now.md, NOW-11). */

  type Kind = 'do' | 'sort' | 'file' | 'unblock'
  type Project = { id: string; label: string }
  type CardView = {
    id: string
    kind: Kind
    text: string
    why: string
    suggestedStep?: string
    project: Project | null
    answers: string[]
    otherProjects?: Project[]
  }
  type NowResponse =
    | { state: 'card'; card: CardView; remaining: number; candidatesOmitted: number }
    | { state: 'clear' }
    | { state: 'limit' }
    | { state: 'error'; error: string }
  type Phase =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; response: NowResponse }
    | { kind: 'error'; message: string }
    | { kind: 'credits' }

  let {
    onanswered,
    onundone,
  }: {
    /** Called after an answer was saved, so History can follow (no effect involved). */
    onanswered?: () => void
    /** Called after an Undo was saved. */
    onundone?: () => void
  } = $props()

  const UNDO_MS = 6000

  let phase = $state<Phase>({ kind: 'idle' })
  let note = $state<{ text: string; undoCardId: string } | null>(null)
  let inlineError = $state<string | null>(null)
  let busy = $state(false)
  let picker = $state<'project' | 'else' | null>(null)
  let elseText = $state('')
  let timer: ReturnType<typeof setTimeout> | undefined

  const offline = $derived(!offlineStatus.online)

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  onDestroy(clearTimer)

  async function errorMessage(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { error?: unknown }
      if (typeof body.error === 'string' && body.error !== '') return body.error
    } catch {
      // not JSON: the generic line below
    }
    return m.now_answer_failed()
  }

  /** Reads a GET/POST response that carries a card state and renders it. */
  async function show(res: Response): Promise<void> {
    if (res.status === 402) {
      phase = { kind: 'credits' }
      return
    }
    if (!res.ok) {
      phase = { kind: 'error', message: await errorMessage(res) }
      return
    }
    const body = (await res.json()) as NowResponse
    if (body.state === 'error') {
      phase = { kind: 'error', message: body.error }
      return
    }
    phase = { kind: 'ready', response: body }
  }

  async function load(): Promise<void> {
    phase = { kind: 'loading' }
    try {
      await show(await fetch(`${base}/api/mesh/now`, { credentials: 'include' }))
    } catch (error) {
      console.error('[now] load failed', error)
      phase = { kind: 'error', message: m.now_error() }
    }
  }

  function resetInteraction() {
    picker = null
    elseText = ''
    inlineError = null
  }

  onMount(() => {
    if (offlineStatus.online) void load()
  })

  function tryAgain() {
    clearTimer()
    note = null
    resetInteraction()
    void load()
  }

  async function post(path: string, body?: unknown): Promise<Response> {
    return fetch(`${base}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  function pastTense(answer: string, projectLabel: string | null): string | null {
    switch (answer) {
      case 'done':
        return m.now_did_done()
      case 'drop':
        return m.now_did_drop()
      case 'not_a_task':
        return m.now_did_not_a_task()
      case 'yes':
      case 'other_project':
        return projectLabel ? m.now_did_moved({ project: projectLabel }) : null
      default:
        return null
    }
  }

  async function send(
    card: CardView,
    answer: string,
    extra: { projectEntityId?: string; text?: string } = {},
    projectLabel: string | null = card.project?.label ?? null,
  ): Promise<void> {
    if (busy) return
    busy = true
    clearTimer()
    note = null
    inlineError = null
    try {
      const res = await post(`/api/mesh/now/cards/${encodeURIComponent(card.id)}/answer`, {
        answer,
        ...extra,
      })
      if (res.status === 409) {
        resetInteraction()
        await load()
        return
      }
      if (res.status === 400) {
        inlineError = await errorMessage(res)
        return
      }
      if (res.status === 402 || res.ok) {
        const body = res.ok
          ? ((await res.clone().json()) as { undo?: { cardId: string } | null })
          : null
        await show(res)
        if (res.ok) {
          resetInteraction()
          onanswered?.()
          const text = body?.undo ? pastTense(answer, projectLabel) : null
          if (body?.undo && text) {
            note = { text, undoCardId: body.undo.cardId }
            // the timer starts here, in the click handler
            timer = setTimeout(() => {
              note = null
              timer = undefined
            }, UNDO_MS)
          }
          // Too big (NOW-9): Ask opens with this card's task, sent once. The card was just saved.
          if (answer === 'too_big') {
            await goto(resolve(`/chat?breakdown=${encodeURIComponent(card.id)}` as '/chat'))
          }
        }
        return
      }
      inlineError = await errorMessage(res)
    } catch (error) {
      console.error('[now] answer failed', error)
      inlineError = m.now_answer_failed()
    } finally {
      busy = false
    }
  }

  async function undo(): Promise<void> {
    if (!note || busy) return
    const cardId = note.undoCardId
    busy = true
    clearTimer()
    note = null
    try {
      const res = await post(`/api/mesh/now/cards/${encodeURIComponent(cardId)}/undo`)
      if (res.status === 409) {
        await load()
        return
      }
      await show(res)
      if (res.ok) {
        resetInteraction()
        onundone?.()
      }
    } catch (error) {
      console.error('[now] undo failed', error)
      inlineError = m.now_answer_failed()
    } finally {
      busy = false
    }
  }

  function choose(card: CardView, answer: string) {
    if (answer === 'other_project') {
      inlineError = null
      picker = 'project'
      return
    }
    if (answer === 'something_else') {
      inlineError = null
      picker = 'else'
      return
    }
    void send(card, answer)
  }

  function answerLabel(key: string): string {
    switch (key) {
      case 'done':
        return m.now_answer_done()
      case 'not_now':
        return m.now_answer_not_now()
      case 'too_big':
        return m.now_answer_too_big()
      case 'drop':
        return m.now_answer_drop()
      case 'keep':
        return m.now_answer_keep()
      case 'yes':
        return m.now_answer_yes()
      case 'other_project':
        return m.now_answer_other_project()
      case 'not_a_task':
        return m.now_answer_not_a_task()
      case 'something_else':
        return m.now_answer_something_else()
      case 'someday':
        return m.now_answer_someday()
      case 'finished':
        return m.now_answer_finished()
      default:
        throw new Error(`Unknown Now answer key: ${key}`)
    }
  }

  const pill =
    'border-0 bg-transparent p-0 font-mesh text-sm underline underline-offset-4 transition-colors duration-300 ease-settle cursor-pointer rounded-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
  const pillPrimary = `${pill} text-ink pointer-fine:hover:text-ink-3`
  const pillQuiet = `${pill} text-ink-2 pointer-fine:hover:text-ink`
  const linkClass =
    'border-0 bg-transparent p-0 text-sm text-ink-3 underline underline-offset-2 cursor-pointer pointer-fine:hover:text-ink'
</script>

<div class="mx-auto max-w-[700px] px-8 pt-[22px] max-[640px]:px-[22px] font-mesh text-ink" data-testid="now-card">
  {#if offline}
    <p class="m-0 text-sm text-ink-3" role="status" data-testid="now-offline">{m.now_offline()}</p>
  {:else if phase.kind === 'idle' || phase.kind === 'loading'}
    {#if phase.kind === 'loading'}
      <p class="m-0 text-sm text-ink-3" role="status" data-testid="now-loading">{m.now_loading()}</p>
    {:else}
      <p class="m-0 flex items-center gap-3 text-sm text-ink-3" role="status">
        <button type="button" class={linkClass} onclick={tryAgain}>{m.now_try_again()}</button>
      </p>
    {/if}
  {:else if phase.kind === 'error'}
    <p class="m-0 flex items-center gap-3 text-sm text-ink-3" role="alert" data-testid="now-error">
      <span>{phase.message}</span>
      <button type="button" class={linkClass} onclick={tryAgain}>{m.now_try_again()}</button>
    </p>
  {:else if phase.kind === 'credits'}
    <p class="m-0 text-sm text-ink-3" role="alert" data-testid="now-credits">
      {m.now_out_of_credits()}
      <a
        class="text-ink-2 underline underline-offset-2 transition-colors duration-300 pointer-fine:hover:text-ink"
        href={resolve('/settings/llm')}
      >
        {m.now_out_of_credits_link()}
      </a>
    </p>
  {:else if phase.response.state === 'card'}
    {@const card = phase.response.card}
    <section class="mt-6 mb-0 rounded-[12px] border border-ink dark:border-[#D2FF03] p-5" aria-label={m.now_label()}>
      <p class="m-0 inline-flex items-center gap-1.5 font-mesh text-sm text-ink-3">
        <span class="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[#D2FF03]">
          <svg
            class="size-3.5 fill-none stroke-[#000000] [stroke-width:1.4] [stroke-linecap:round] [stroke-linejoin:round]"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z" />
          </svg>
        </span>
        {m.now_label()}
      </p>

      <div class="mt-5">
        {#if note}
          <p class="m-0 mb-3 flex items-center gap-3 text-sm text-ink-3" role="status" data-testid="now-note">
            <span>{note.text}</span>
            <button
              type="button"
              class="border-0 bg-transparent p-0 text-sm text-ink-2 underline underline-offset-2 cursor-pointer rounded-[2px] pointer-fine:hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              onclick={undo}
            >
              {m.now_undo()}
            </button>
          </p>
        {/if}

        {#key card.id}
          <div class="animate-[rise_0.2s_var(--ease)_both]">
            {#if card.project}
              <span class="mb-2 inline-block rounded-full border border-line px-2.5 py-0.5 text-[12.5px] text-ink-2">
                {card.project.label}
              </span>
            {/if}
            <h2 class="m-0 font-you font-normal text-[22px] leading-[1.25] tracking-[-0.01em] text-ink">
              {card.text}
            </h2>
            <p class="mt-2 mb-0 text-sm leading-[1.5] text-ink-3">{card.why}</p>

            <div class="mt-4 flex flex-wrap gap-x-5 gap-y-2">
              {#each card.answers as key, i (key)}
                <button
                  type="button"
                  class={i === 0 ? pillPrimary : pillQuiet}
                  disabled={busy}
                  onclick={() => choose(card, key)}
                >
                  {answerLabel(key)}
                </button>
              {/each}
            </div>

            {#if picker === 'project'}
              <div class="mt-3 flex flex-wrap gap-x-5 gap-y-2" role="group" aria-label={m.now_choose_project()}>
                {#each card.otherProjects ?? [] as project (project.id)}
                  <button
                    type="button"
                    class={pillQuiet}
                    disabled={busy}
                    onclick={() => send(card, 'other_project', { projectEntityId: project.id }, project.label)}
                  >
                    {project.label}
                  </button>
                {/each}
              </div>
            {:else if picker === 'else'}
              <form
                class="mt-3 flex items-center gap-2"
                onsubmit={(e) => {
                  e.preventDefault()
                  void send(card, 'something_else', { text: elseText })
                }}
              >
                <input
                  class="min-w-0 flex-1 rounded-full border border-line bg-transparent px-4 py-2 font-you text-[16px] text-ink caret-ink outline-none placeholder:text-ink-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  type="text"
                  placeholder={m.now_next_step_placeholder()}
                  aria-label={m.now_next_step_label()}
                  autocomplete="off"
                  bind:value={elseText}
                />
                <button type="submit" class={pillPrimary} disabled={busy}>{m.now_save()}</button>
              </form>
            {/if}

            {#if inlineError}
              <p class="mt-3 mb-0 text-sm text-ink-3" role="alert" data-testid="now-inline-error">{inlineError}</p>
            {/if}
          </div>
        {/key}
      </div>
    </section>
  {:else}
    <div>
      {#if note}
        <p class="m-0 mb-2 flex items-center gap-3 text-sm text-ink-3" role="status" data-testid="now-note">
          <span>{note.text}</span>
          <button type="button" class={linkClass} onclick={undo}>{m.now_undo()}</button>
        </p>
      {/if}
      <p class="m-0 text-sm text-ink-3" role="status" data-testid="now-quiet">
        {phase.response.state === 'clear' ? m.now_clear() : m.now_limit()}
      </p>
    </div>
  {/if}
</div>
