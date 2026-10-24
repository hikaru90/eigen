<script lang="ts">
  import type { PageData } from './$types'
  import History from '@lucide/svelte/icons/history'
  import Plus from '@lucide/svelte/icons/plus'
  import Redo2 from '@lucide/svelte/icons/redo-2'
  import XIcon from '@lucide/svelte/icons/x'
  import { onMount, untrack } from 'svelte'
  import { fade } from 'svelte/transition'
  import { browser } from '$app/environment'
  import { afterNavigate, replaceState } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import { insufficientCreditsTopUpHint } from '$lib/billing/insufficient-credits'
  import { appendVoiceTranscript } from '$lib/capture/transcribe-audio'
  import { ASK_PHASE_INITIAL, askPhaseAfterEvent, type AskPhase } from '$lib/chat/ask-phase'
  import type { AskSuggestion } from '$lib/chat/ask-suggestions'
  import { sanitizeFinalAnswerText, toolLabel } from '$lib/chat/chat-stream-types'
  import {
    consumeChatNdjsonStream,
    type ChatProgressEvent,
    isInsufficientCreditsChatError,
  } from '$lib/chat/consume-chat-ndjson'
  import {
    normalizeChatDisplay,
    sessionMessagesToChatEntries,
    type ChatDisplayEntry,
  } from '$lib/chat/normalize-messages'
  import { relativeDayLabel } from '$lib/chat/relative-day'
  import { canScrollInput, wheelDeltaPixels } from '$lib/chat/scroll-overlay'
  import WorkingDots from '$lib/components/brand/working-dots.svelte'
  import ChatErrorMessage from '$lib/components/chat-error-message.svelte'
  import ChatMarkdown from '$lib/components/chat-markdown.svelte'
  import ChatTimelineStep from '$lib/components/chat-timeline-step.svelte'
  import { portal } from '$lib/components/chrome/portal'
  import GlassWriter from '$lib/components/writer/glass-writer.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import { getLocale } from '$lib/paraglide/runtime'
  import { startLogoWork, stopLogoWork } from '$lib/stores/brand-pulse.svelte'
  import { chatSidebar } from '$lib/stores/chat-sidebar.svelte'
  import { pageInputDrafts } from '$lib/stores/page-input-drafts.svelte'
  import {
    bumpInputEpoch,
    createInputEpoch,
    isFreshTranscript,
    type InputEpoch,
  } from './chat-input-epoch'
  import {
    shouldApplyLoadedSessionMessages,
  } from './chat-session-lifecycle'

  type ChatEntry = ChatDisplayEntry & { _key?: string }

  type TimelineEntry = Extract<ChatDisplayEntry, { variant: 'timeline' }>

  let { data }: { data: PageData } = $props()

  const isBriefingMode = $derived(page.url.searchParams.get('mode') === 'briefing')
  const briefingPeriod = $derived(page.url.searchParams.get('period') ?? 'morning')
  let briefingBootstrapped = $state(false)

  type SessionListItem = {
    id: string
    title: string
    mode?: string
    createdAt: string
    updatedAt: string
    messageCount: number
  }

  /* Server-rendered: the list, the open conversation (`?session=`) and the pills arrive in
     the HTML. Later changes come from explicit handlers, never from re-reading props. */
  let sessions = $state<SessionListItem[]>(untrack(() => data.sessions) as unknown as SessionListItem[])
  let activeSessionId = $state<string | null>(untrack(() => data.activeSessionId))
  let messages = $state<ChatEntry[]>(untrack(() => keyedEntries(data.activeSessionId, data.messages)))
  let displayMessages = $derived(normalizeChatDisplay(messages))
  let input = $state(pageInputDrafts.chat)
  let loading = $state(false)
  let loadingSession = $state(false)
  let abortController = $state<AbortController | null>(null)
  let streamAbortReason = $state<'user' | 'timeout' | null>(null)
  let pendingSelectSessionId = $state<string | null>(null)
  /** Bumped on New chat / new stream turn / selectSession so stale fetches cannot apply. */
  let messagesLoadEpoch = 0
  let inputEl = $state<HTMLTextAreaElement | null>(null)
  let writerEl = $state<HTMLFormElement | null>(null)
  let messagesEl: HTMLDivElement | undefined
  const STREAM_IDLE_MS = 120_000
  let streamIdleTimeoutId: ReturnType<typeof setTimeout> | null = null

  const conversationStarted = $derived(messages.length > 0 || loading || loadingSession)
  const conversationShown = $derived(isBriefingMode || conversationStarted)
  const hasText = $derived(input.trim().length > 0)

  /** "Try asking": up to three questions enrichment stored for your recent thoughts. */
  let suggestions = $state<AskSuggestion[]>(untrack(() => data.suggestions))

  function keyedEntries(sessionId: string | null, entries: ChatDisplayEntry[]): ChatEntry[] {
    return entries.map((entry, idx) => ({ ...entry, _key: `loaded-${sessionId}-${idx}` }))
  }

  /** The open conversation is the URL: shallow, so the next full load renders it on the server. */
  function setSessionUrl(sessionId: string | null) {
    const path = sessionId ? `/chat?session=${encodeURIComponent(sessionId)}` : '/chat'
    replaceState(resolve(path as '/chat'), page.state)
  }

  /* A real navigation to /chat (nav link, back/forward) reruns the server load; take its data. */
  afterNavigate(({ type }) => {
    if (type === 'enter') return
    messagesLoadEpoch += 1
    sessions = data.sessions as unknown as SessionListItem[]
    activeSessionId = data.activeSessionId
    messages = keyedEntries(data.activeSessionId, data.messages)
    suggestions = data.suggestions
    scrollToBottom()
  })
  const locale = getLocale()

  /** Reduced motion snaps between states (ei DESIGN.md "Motion"): Svelte fades go to 0. */
  const reducedMotion = browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  function motionMs(ms: number): number {
    return reducedMotion ? 0 : ms
  }

  /** A turn leaving on Clear: opacity and blur out (ei `.turn.is-leaving`). */
  function blurOut(_node: Element) {
    return {
      duration: motionMs(400),
      css: (t: number) => `opacity: ${t}; filter: blur(${(1 - t) * 6}px)`,
    }
  }

  /* ——— the status walk: recalling → following the threads → writing ——— */

  const PHASE_SWAP_MS = 200 // ei WaitText: the word blurs out before the next arrives
  let phase = $state<AskPhase>(ASK_PHASE_INITIAL)
  let phaseSwapping = $state(false)
  let phaseTarget: AskPhase = ASK_PHASE_INITIAL
  let phaseTimer: ReturnType<typeof setTimeout> | null = null

  /** Phase ids resolve to paraglide messages here, in one place. */
  function phaseLabel(p: AskPhase): string {
    switch (p) {
      case 'recalling':
        return m.ask_phase_recalling()
      case 'threads':
        return m.ask_phase_threads()
      case 'writing':
        return m.ask_phase_writing()
    }
  }

  function advancePhase(next: AskPhase) {
    if (next === phaseTarget) return
    phaseTarget = next
    if (phaseLabel(next) === phaseLabel(phase)) {
      if (phaseTimer) clearTimeout(phaseTimer)
      phase = next
      phaseSwapping = false
      return
    }
    phaseSwapping = true
    if (phaseTimer) clearTimeout(phaseTimer)
    phaseTimer = setTimeout(() => {
      phase = phaseTarget
      phaseSwapping = false
      phaseTimer = null
    }, PHASE_SWAP_MS)
  }

  function resetPhase() {
    if (phaseTimer) clearTimeout(phaseTimer)
    phaseTimer = null
    phaseTarget = ASK_PHASE_INITIAL
    phase = ASK_PHASE_INITIAL
    phaseSwapping = false
  }

  function resetStreamIdleTimeout(ac: AbortController) {
    if (streamIdleTimeoutId) clearTimeout(streamIdleTimeoutId)
    streamIdleTimeoutId = setTimeout(() => {
      streamAbortReason = 'timeout'
      ac.abort()
    }, STREAM_IDLE_MS)
  }

  function clearStreamIdleTimeout() {
    if (streamIdleTimeoutId) {
      clearTimeout(streamIdleTimeoutId)
      streamIdleTimeoutId = null
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight
    })
  }

  function handleAskWheel(event: WheelEvent) {
    if (event.ctrlKey || !messagesEl) return
    const delta = wheelDeltaPixels(event.deltaY, event.deltaMode, messagesEl.clientHeight)
    if (event.target === inputEl && inputEl && canScrollInput(inputEl, delta)) return
    event.preventDefault()
    messagesEl.scrollTop += delta
  }

  let touchY: number | null = null
  function handleAskTouchMove(event: TouchEvent) {
    const nextY = event.touches[0]?.clientY
    if (nextY == null || touchY == null || !messagesEl) return
    const delta = touchY - nextY
    touchY = nextY
    if (event.target === inputEl && inputEl && canScrollInput(inputEl, delta)) return
    event.preventDefault()
    messagesEl.scrollTop += delta
  }

  // Wheel/touch over the docked writer scroll the conversation (unless the field itself
  // can scroll). Native listeners explicitly opt out of passive wheel/touch handling.
  function forwardWriterScroll(node: HTMLElement): () => void {
    const startTouch = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? null
    }
    const endTouch = () => {
      touchY = null
    }
    node.addEventListener('wheel', handleAskWheel, { passive: false })
    node.addEventListener('touchstart', startTouch, { passive: true })
    node.addEventListener('touchmove', handleAskTouchMove, { passive: false })
    node.addEventListener('touchend', endTouch)
    node.addEventListener('touchcancel', endTouch)
    return () => {
      node.removeEventListener('wheel', handleAskWheel)
      node.removeEventListener('touchstart', startTouch)
      node.removeEventListener('touchmove', handleAskTouchMove)
      node.removeEventListener('touchend', endTouch)
      node.removeEventListener('touchcancel', endTouch)
    }
  }

  let messageSeq = 0
  function appendMessage(entry: ChatDisplayEntry) {
    messageSeq += 1
    messages.push({ ...entry, _key: `m-${messageSeq}` })
    scrollToBottom()
  }

  function appendUserMessage(text: string) {
    messageSeq += 1
    messages.push({ role: 'user', content: text, _key: `m-${messageSeq}` })
    scrollToBottom()
  }

  function upsertToolTimeline(entry: TimelineEntry) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m0 = messages[i]
      if (m0.role === 'assistant' && m0.variant === 'timeline' && m0.tool === entry.tool) {
        if (m0.kind === 'tool_result' && entry.kind !== 'tool_result') {
          break
        }
        // Keep every progress label the tool reported: the row shows the latest one while
        // running and the earlier ones as finished steps beneath it.
        const steps =
          m0.kind === 'tool_progress' && m0.label.trim() && m0.label !== entry.label
            ? [...(m0.steps ?? []), m0.label]
            : m0.steps
        messages[i] = { ...m0, ...entry, steps, _key: m0._key }
        scrollToBottom()
        return
      }
    }
    appendMessage(entry)
  }

  async function loadSessions() {
    try {
      const res = await fetch('/api/chat/sessions')
      if (!res.ok) return
      const json = await res.json()
      sessions = json.sessions ?? []
    } catch {
      // ignore
    }
  }

  async function loadSessionMessages(sessionId: string, loadEpoch: number) {
    if (
      !shouldApplyLoadedSessionMessages({
        loadEpoch,
        currentEpoch: messagesLoadEpoch,
        streaming: loading,
      })
    ) {
      return
    }
    loadingSession = true
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`)
      if (!res.ok) throw new Error('Failed to load session')
      const json = await res.json()
      if (
        !shouldApplyLoadedSessionMessages({
          loadEpoch,
          currentEpoch: messagesLoadEpoch,
          streaming: loading,
        })
      ) {
        return
      }
      messages = sessionMessagesToChatEntries(json.messages ?? []).map((entry, idx) => ({
        ...entry,
        _key: `loaded-${sessionId}-${idx}`,
      }))
      scrollToBottom()
    } catch {
      if (loadEpoch === messagesLoadEpoch) messages = []
    } finally {
      if (loadEpoch === messagesLoadEpoch) loadingSession = false
    }
  }

  async function selectSession(sessionId: string, opts?: { force?: boolean }) {
    if (sessionId === activeSessionId) {
      chatSidebar.open = false
      return
    }
    if (loading && !opts?.force) {
      streamAbortReason = 'user'
      abortController?.abort()
      pendingSelectSessionId = sessionId
      chatSidebar.open = false
      return
    }
    const loadEpoch = ++messagesLoadEpoch
    activeSessionId = sessionId
    setSessionUrl(sessionId)
    await loadSessionMessages(sessionId, loadEpoch)
    chatSidebar.open = false
  }

  async function newSession() {
    messagesLoadEpoch += 1
    activeSessionId = null
    messages = []
    loadingSession = false
    setSessionUrl(null)
    chatSidebar.open = false
    scrollToBottom()
  }

  /** Clear, the ei way: the turns blur out (out:blurOut). Confirm-less — nothing here
   *  needs a dialog. */
  async function clearConversation() {
    if (loading) stop()
    resetPhase()
    syncChatDraft('')
    await newSession()
    inputEl?.focus({ preventScroll: true })
  }

  function syncChatDraft(value: string) {
    input = value
    pageInputDrafts.chat = value
  }

  async function deleteSession(sessionId: string, e: MouseEvent) {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' })
      if (!res.ok) return
      sessions = sessions.filter((s) => s.id !== sessionId)
      if (sessionId === activeSessionId) {
        activeSessionId = null
        messages = []
        setSessionUrl(null)
      }
    } catch {
      // ignore
    }
  }

  function streamEventLabel(event: ChatProgressEvent, fallback: string): string {
    const label = 'label' in event ? event.label : undefined
    return typeof label === 'string' && label.trim() ? label : fallback
  }

  function pushStreamEvent(
    event: ChatProgressEvent,
    ctx: {
      lastAnswerQuestionPreview: { current: string | undefined }
    },
  ) {
    advancePhase(askPhaseAfterEvent(phaseTarget, event))

    if (event.type === 'thinking') {
      appendMessage({ role: 'assistant', variant: 'thinking', content: event.content })
      return
    }
    // agent_progress only moves the phase line beside the spinner (advanced above);
    // it is not a step of its own in the timeline.
    if (event.type === 'agent_progress') return
    if (event.type === 'tool_call') {
      upsertToolTimeline({
        role: 'assistant',
        variant: 'timeline',
        kind: 'tool_call',
        tool: event.tool,
        label: streamEventLabel(event, toolLabel(event.tool)),
        arguments: event.arguments ?? {},
      })
      return
    }
    if (event.type === 'tool_executing') {
      upsertToolTimeline({
        role: 'assistant',
        variant: 'timeline',
        kind: 'tool_executing',
        tool: event.tool,
        label: streamEventLabel(event, toolLabel(event.tool)),
      })
      return
    }
    if (event.type === 'tool_progress') {
      upsertToolTimeline({
        role: 'assistant',
        variant: 'timeline',
        kind: 'tool_progress',
        tool: event.tool,
        label: event.label,
      })
      return
    }
    if (event.type === 'tool_result') {
      const preview = event.preview ?? ''
      if (event.tool === 'answer_question') {
        ctx.lastAnswerQuestionPreview.current = preview
      }
      upsertToolTimeline({
        role: 'assistant',
        variant: 'timeline',
        kind: 'tool_result',
        tool: event.tool,
        label: streamEventLabel(event, toolLabel(event.tool)),
        content: preview,
        failed: event.failed === true,
      })
    }
  }

  async function sendStreaming(text: string, options?: { bootstrap?: boolean }) {
    messagesLoadEpoch += 1
    loading = true
    resetPhase()
    scrollToBottom()
    streamAbortReason = null

    const body: Record<string, unknown> = options?.bootstrap
      ? { bootstrap: true, briefingPeriod }
      : { message: text }
    if (isBriefingMode && options?.bootstrap) body.briefingPeriod = briefingPeriod
    if (activeSessionId) body.sessionId = activeSessionId

    const ac = new AbortController()
    abortController = ac
    resetStreamIdleTimeout(ac)

    try {
      const res = await fetch('/api/chat', {
        signal: ac.signal,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => null)
        throw new Error(errBody?.message ?? `HTTP ${res.status}`)
      }

      const streamCtx = {
        lastAnswerQuestionPreview: { current: undefined as string | undefined },
      }
      const done = await consumeChatNdjsonStream(
        res,
        (event) => {
          resetStreamIdleTimeout(ac)
          pushStreamEvent(event, streamCtx)
        },
        ac.signal,
      )
      const responseText = sanitizeFinalAnswerText(
        done.response ?? '',
        streamCtx.lastAnswerQuestionPreview.current,
      ).trim()
      if (!responseText) {
        throw new Error('The assistant returned an empty response.')
      }
      if (done.sessionId) {
        activeSessionId = done.sessionId
        if (!isBriefingMode) setSessionUrl(done.sessionId)
      }
      if (responseText) {
        appendMessage({ role: 'assistant', variant: 'text', content: responseText })
      }
      loadSessions()
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        if (streamAbortReason === 'timeout') {
          appendMessage({
            role: 'assistant',
            variant: 'text',
            content: 'Error: Request timed out after 2 minutes.',
          })
        } else {
          appendMessage({ role: 'assistant', variant: 'text', content: 'Stopped.' })
        }
      } else if (isInsufficientCreditsChatError(err)) {
        appendMessage({
          role: 'assistant',
          variant: 'text',
          content: `Error: ${insufficientCreditsTopUpHint(err)}`,
        })
      } else {
        appendMessage({
          role: 'assistant',
          variant: 'text',
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    } finally {
      clearStreamIdleTimeout()
      loading = false
      abortController = null
      streamAbortReason = null
      resetPhase()
      scrollToBottom()
    }

    const pending = pendingSelectSessionId
    if (pending) {
      pendingSelectSessionId = null
      const loadEpoch = ++messagesLoadEpoch
      activeSessionId = pending
      setSessionUrl(pending)
      await loadSessionMessages(pending, loadEpoch)
      chatSidebar.open = false
    }
  }

  function resend(text: string) {
    if (loading) return
    voiceStopFn?.()
    bumpInputEpoch(inputEpoch)
    appendUserMessage(text)
    sendStreaming(text)
  }

  let voiceStopFn = $state<(() => void) | undefined>(undefined)

  /**
   * Monotonic epoch used to drop stale voice transcripts after a submit. Bumped on
   * every submit (send / resend) and on every new recording start.
   * `recordEpoch` captures the epoch at the start of the current recording; a late
   * partial/final transcript is applied only while it still matches `inputEpoch`.
   */
  const inputEpoch: InputEpoch = createInputEpoch()
  let recordEpoch = 0
  /** Draft text present when the current recording started; transcripts append to it. */
  let voiceBaseText = ''

  async function send() {
    const text = input.trim()
    if (!text || loading) return

    voiceStopFn?.()
    bumpInputEpoch(inputEpoch)
    syncChatDraft('')
    appendUserMessage(text)
    startLogoWork()

    try {
      await sendStreaming(text)
    } finally {
      stopLogoWork()
    }
  }

  function stop() {
    if (!abortController) return
    streamAbortReason = 'user'
    abortController.abort()
  }

  function handleInput() {
    pageInputDrafts.chat = input
  }

  onMount(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    const releaseWriterScroll = writerEl ? forwardWriterScroll(writerEl) : () => {}

    if (isBriefingMode) {
      activeSessionId = null
      messages = []
      if (!briefingBootstrapped) {
        briefingBootstrapped = true
        void sendStreaming('', { bootstrap: true })
      }
    } else if (messages.length > 0) {
      scrollToBottom()
    }

    return () => {
      releaseWriterScroll()
      clearStreamIdleTimeout()
      if (phaseTimer) clearTimeout(phaseTimer)
    }
  })
</script>

<!-- every page names itself: Svelte sets document.title but never restores it on leave -->
<svelte:head>
  <title>{m.nav_ask()} — Eigenmesh</title>
</svelte:head>

<!-- The thread owns scrolling; the shared writer is docked (portaled) above the page mask. -->
<div
  bind:this={messagesEl}
  class="fixed inset-0 overflow-y-auto overscroll-contain px-[22px] max-[640px]:px-[18px] pb-[calc(var(--glass-writer-height,64px)+var(--bottom-nav)+40px)] [scroll-padding-bottom:calc(var(--glass-writer-height,64px)+var(--bottom-nav)+24px)]"
  role="log"
  aria-label="Chat messages"
>
  {#if !conversationShown && !loadingSession}
    <!-- at rest Ask mirrors Capture: the question as a heading in the same place and
         voice (capture/+page.svelte h1), the suggestions right beneath it -->
    <div class="mx-auto max-w-[720px] pt-[calc(var(--head)+23vh)] px-7 max-[640px]:pt-[calc(var(--head)+12vh)] max-[640px]:px-1">
      <h1
        class="m-0 font-you font-normal text-[clamp(32px,4.4vw,46px)] leading-[1.16] tracking-[-0.014em] text-ink max-[640px]:text-[29px]"
        data-testid="ask-heading"
      >
        {m.ask_placeholder()}
      </h1>
      {#if suggestions.length > 0}
        <div class="mt-8 animate-[rise_0.9s_var(--ease)_0.15s_backwards] motion-reduce:[animation:none]" out:fade={{ duration: motionMs(300) }}>
          <div class="mb-2 font-mesh text-sm text-ink-3">{m.ask_try()}</div>
          <div class="flex flex-col items-start gap-2">
            {#each suggestions as s (s.thoughtId)}
              <button
                type="button"
                class="block max-w-full h-9 px-4 rounded-full border-0 bg-transparent shadow-[inset_0_0_0_1px_var(--ink-4)] font-you text-[15px] leading-9 text-left text-ink-2 truncate transition-[color,box-shadow] duration-[350ms] ease-settle cursor-pointer hover:text-ink hover:shadow-[inset_0_0_0_1px_var(--ink-3)]"
                data-testid="ask-suggestion"
                title={s.question}
                onclick={() => resend(s.question)}>{s.question}</button
              >
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
  <div class="mx-auto max-w-[760px] pt-[calc(var(--head,68px)+28px)] pb-4">
    {#if isBriefingMode}
      <div class="pb-1.5" role="region" aria-label="Timeline briefing">
        <p class="m-0 font-you text-base tracking-[-0.01em] text-ink-2 animate-[rise_0.8s_var(--ease)_both]">
          {briefingPeriod === 'evening'
            ? 'Evening review'
            : briefingPeriod === 'weekly'
              ? 'Weekly review'
              : 'Morning briefing'}
        </p>
      </div>
    {/if}

    {#if loadingSession}
      <div class="grid place-items-center min-h-[140px] text-ink-3 animate-[fade_0.6s_var(--ease)_both]">
        <WorkingDots label={m.ask_loading_session()} />
      </div>
    {/if}

    {#each displayMessages as msg, i (`chat-msg-${i}`)}
      {#if msg.role === 'user'}
        <section
          class="relative flex flex-col items-end pt-[30px] pb-2 text-right animate-[rise_0.8s_var(--ease)_both] [&:not(:first-child)]:mt-[26px] [&:not(:first-child)]:border-t [&:not(:first-child)]:border-line"
          data-testid="ask-user-turn"
          out:blurOut
        >
          <h3
            class="m-0 max-w-[85%] font-you font-normal text-[clamp(19px,4.6vw,30px)] leading-[1.24] tracking-[-0.01em] text-balance max-[640px]:max-w-full"
          >
            <ChatMarkdown content={msg.content} tone="user" />
          </h3>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 h-9 mt-0.5 -mr-1 px-1 border-0 rounded-full bg-transparent font-mesh text-[12.5px] text-ink-2 transition-colors duration-300 ease-settle cursor-pointer pointer-fine:hover:text-ink"
            onclick={() => resend(msg.content)}
          >
            <Redo2 size={13} strokeWidth={1.5} aria-hidden="true" />
            {m.ask_send_again()}
          </button>
        </section>
      {:else if msg.variant === 'thinking'}
        <details
          class="mt-5 pb-0.5 font-mesh text-sm text-ink-3 [&_summary]:flex [&_summary]:items-center [&_summary]:gap-2 [&_summary]:list-none [&_summary]:cursor-pointer [&_summary::-webkit-details-marker]:hidden"
          out:blurOut
        >
          <summary>
            <span class="size-[5px] shrink-0 rounded-full bg-ink-4" aria-hidden="true"></span>
            <span>{m.ask_thinking()}</span>
          </summary>
          {#if msg.content}
            <div class="mt-2 mb-0.5 ml-[13px] py-0.5 pl-3 border-l border-line">
              <ChatMarkdown content={msg.content} tone="muted" />
            </div>
          {/if}
        </details>
      {:else if msg.variant === 'timeline'}
        <div
          class="mt-5 animate-[fade_0.6s_var(--ease)_both]"
          out:blurOut
        >
          <ChatTimelineStep
            kind={msg.kind}
            label={msg.label}
            tool={msg.tool}
            arguments={msg.arguments}
            content={msg.content}
            failed={msg.failed}
            hideProse={msg.hideProse}
            steps={msg.steps}
            running={loading && i === displayMessages.length - 1 && msg.variant === 'timeline'}
          />
        </div>
      {:else if msg.variant === 'text'}
        <section
          class="relative mt-6 pb-2 animate-[rise_0.8s_var(--ease)_both]"
          data-testid="ask-answer"
          out:blurOut
        >
          {#if msg.content.startsWith('Error:')}
            <ChatErrorMessage message={msg.content.replace(/^Error:\s*/, '')} />
          {:else}
            <ChatMarkdown content={msg.content} />
          {/if}
        </section>
      {/if}
    {/each}

    {#if loading}
      <div class="flex items-center h-6 mt-[22px] font-mesh text-sm text-ink-3" out:fade={{ duration: motionMs(500) }}>
        <WorkingDots label={phaseLabel(phase)} hidden={phaseSwapping} />
      </div>
    {/if}
  </div>


</div>


<GlassWriter
  bind:value={input}
  bind:input={inputEl}
  bind:root={writerEl}
  bind:voiceStop={voiceStopFn}
  placeholder={conversationShown ? m.ask_followup_placeholder() : m.ask_writer_placeholder()}
  label={m.nav_ask()}
  submitLabel={m.nav_ask()}
  inputTestId="ask-input"
  submitTestId="ask-submit"
  disabled={loading || loadingSession}
  busy={loading}
  onstop={stop}
  onsubmit={() => void send()}
  oninput={handleInput}
  language={(page.data as { preferredLanguage?: string }).preferredLanguage ?? 'en'}
  onvoicestart={() => {
    voiceBaseText = input
    recordEpoch = bumpInputEpoch(inputEpoch)
  }}
  ontranscript={(text) => {
    if (isFreshTranscript(inputEpoch, recordEpoch))
      syncChatDraft(appendVoiceTranscript(voiceBaseText, text))
  }}
  onpartialtranscript={(text) => {
    if (isFreshTranscript(inputEpoch, recordEpoch))
      syncChatDraft(appendVoiceTranscript(voiceBaseText, text))
  }}
  onvoiceerror={(message) => {
    console.error('voice input failed', message)
  }}
>
  {#snippet above()}
    {#if sessions.length > 0 || conversationStarted || hasText}
      <!-- labelled actions, sitting right on the field: an icon alone never said what these do -->
      <div class="flex items-center justify-between gap-2 -mb-1.5 -mx-2.5">
        {#if sessions.length > 0}
          <button type="button" class="inline-flex items-center gap-1.5 h-8 px-2.5 border-0 rounded-full bg-transparent font-mesh text-sm text-ink-3 cursor-pointer transition-colors duration-300 hover:text-ink" onclick={() => (chatSidebar.open = true)}>
            <History size={16} strokeWidth={1.5} aria-hidden="true" />
            {m.ask_past()}
          </button>
        {:else}
          <span></span>
        {/if}
        {#if conversationStarted || hasText}
          <button type="button" class="inline-flex items-center gap-1.5 h-8 px-2.5 border-0 rounded-full bg-transparent font-mesh text-sm text-ink-3 cursor-pointer transition-colors duration-300 hover:text-ink" onclick={clearConversation}>
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            {m.ask_new_chat()}
          </button>
        {/if}
      </div>
    {/if}
  {/snippet}
</GlassWriter>

<!-- earlier conversations: a quiet sheet of paper, reachable by text link -->
{#if chatSidebar.open}
  <button
    type="button"
    class="fixed inset-0 z-[39] border-0 bg-transparent cursor-default"
    aria-label="Close sessions"
    use:portal
    transition:fade={{ duration: motionMs(200) }}
    onclick={() => (chatSidebar.open = false)}
  ></button>
  <div
    class="fixed top-0 bottom-0 left-0 z-40 flex flex-col w-[min(300px,86vw)] pt-[calc(env(safe-area-inset-top,0px)+14px)] pr-2.5 pb-[calc(env(safe-area-inset-bottom,0px)+14px)] pl-3.5 bg-[color-mix(in_srgb,var(--paper)_88%,transparent)] backdrop-blur-[18px] shadow-[inset_-1px_0_0_var(--line)] overflow-y-auto [scrollbar-width:none] animate-[rise_0.7s_var(--ease)_both]"
    role="dialog"
    aria-label="Chat sessions"
    use:portal
    transition:fade={{ duration: motionMs(250) }}
  >
    <div class="flex items-center justify-between pt-0.5 pr-1 pb-2.5 pl-0.5">
      <button
        type="button"
        class="border-0 bg-transparent px-0.5 py-1.5 font-mesh text-sm leading-none text-ink-3 transition-[color,opacity] duration-300 cursor-pointer pointer-fine:hover:text-ink"
        onclick={clearConversation}>{m.ask_new_chat()}</button
      >
      <button
        type="button"
        class="inline-grid place-items-center size-8 my-auto shrink-0 border-0 rounded-full bg-transparent text-ink-2 transition-colors duration-300 ease-settle cursor-pointer pointer-fine:hover:text-ink"
        onclick={() => (chatSidebar.open = false)}
        aria-label="Close sessions"
      >
        <XIcon size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
    <div class="flex flex-col">
      {#each sessions as s (s.id)}
        <div
          class={["flex items-stretch rounded-[10px]", s.id === activeSessionId ? 'bg-paper-2' : 'pointer-fine:hover:bg-paper-2']}
        >
          <button
            type="button"
            class="flex-1 min-w-0 flex flex-col gap-0.5 px-2 py-[9px] border-0 bg-transparent rounded-[10px] text-left text-ink cursor-pointer"
            onclick={() => selectSession(s.id)}
          >
            {#if s.title?.trim()}
              <span class="font-you text-sm leading-[1.4] text-ink-2 overflow-hidden text-ellipsis whitespace-nowrap">{s.title.trim()}</span>
            {/if}
            <span class="font-mesh text-sm leading-[1.3] text-ink-3">{relativeDayLabel(s.updatedAt, new Date(), locale)}</span>
          </button>
          <button
            type="button"
            class="inline-grid place-items-center size-8 my-auto shrink-0 border-0 rounded-full bg-transparent text-ink-2 transition-colors duration-300 ease-settle cursor-pointer pointer-fine:hover:text-ink"
            onclick={(e) => deleteSession(s.id, e)}
            aria-label="Delete session"
          >
            <XIcon size={12} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      {/each}
    </div>
  </div>
{/if}

