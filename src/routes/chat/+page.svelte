<script lang="ts">
  import type { PageData } from './$types'
  import History from '@lucide/svelte/icons/history'
  import Redo2 from '@lucide/svelte/icons/redo-2'
  import Square from '@lucide/svelte/icons/square'
  import XIcon from '@lucide/svelte/icons/x'
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { browser } from '$app/environment'
  import { page } from '$app/state'
  import { insufficientCreditsTopUpHint } from '$lib/billing/insufficient-credits'
  import { appendVoiceTranscript } from '$lib/capture/transcribe-audio'
  import { ASK_PHASE_INITIAL, askPhaseAfterEvent, type AskPhase } from '$lib/chat/ask-phase'
  import {
    ASK_SUGGESTION_COUNT,
    suggestionsFromRecentThoughts,
    type AskSuggestion,
  } from '$lib/chat/ask-suggestions'
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
  import MeshSpinner from '$lib/components/brand/mesh-spinner.svelte'
  import ChatErrorMessage from '$lib/components/chat-error-message.svelte'
  import ChatMarkdown from '$lib/components/chat-markdown.svelte'
  import ChatTimelineStep from '$lib/components/chat-timeline-step.svelte'
  import { portal } from '$lib/components/chrome/portal'
  import VoiceInputButton from '$lib/components/voice-input-button.svelte'
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
    CHAT_ACTIVE_SESSION_STORAGE_KEY,
    clearChatPreferBlank,
    readChatPreferBlank,
    resolveChatBootstrapSelection,
    setChatPreferBlank,
    shouldApplyLoadedSessionMessages,
    shouldReplaceMessagesWithSessionLoad,
  } from './chat-session-lifecycle'

  type ChatEntry = ChatDisplayEntry & { _key?: string }

  type TimelineEntry = Extract<ChatDisplayEntry, { variant: 'timeline' }>

  let { data: _data }: { data: PageData } = $props()

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

  let sessions = $state<SessionListItem[]>([])
  let activeSessionId = $state<string | null>(null)
  let messages = $state<ChatEntry[]>([])
  let displayMessages = $derived(normalizeChatDisplay(messages))
  let input = $state(pageInputDrafts.chat)
  let loading = $state(false)
  let loadingSession = $state(false)
  let abortController = $state<AbortController | null>(null)
  let streamAbortReason = $state<'user' | 'timeout' | null>(null)
  let pendingSelectSessionId = $state<string | null>(null)
  /** Bumped on New chat / new stream turn / selectSession so stale fetches cannot apply. */
  let messagesLoadEpoch = 0
  let inputEl: HTMLTextAreaElement | undefined
  let messagesEl: HTMLDivElement | undefined
  let writerHeight = $state(180)
  const STREAM_IDLE_MS = 120_000
  let streamIdleTimeoutId: ReturnType<typeof setTimeout> | null = null

  // The writer starts below the header and docks above navigation after the first turn.
  const conversationStarted = $derived(messages.length > 0 || loading || loadingSession)
  const writerDocked = $derived(isBriefingMode || conversationStarted)
  const hasText = $derived(input.trim().length > 0)

  /** "Try asking": three pills in your own words, from the existing recent-thoughts endpoint. */
  let suggestions = $state<AskSuggestion[]>([])
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

  // A measured runway keeps the final reply above even a multiline composer.
  // Native listeners explicitly opt out of passive wheel/touch handling.
  function observeWriter(node: HTMLElement) {
    const observer = new ResizeObserver(([entry]) => {
      writerHeight = entry.target.getBoundingClientRect().height
    })
    observer.observe(node)
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
    return {
      destroy() {
        observer.disconnect()
        node.removeEventListener('wheel', handleAskWheel)
        node.removeEventListener('touchstart', startTouch)
        node.removeEventListener('touchmove', handleAskTouchMove)
        node.removeEventListener('touchend', endTouch)
        node.removeEventListener('touchcancel', endTouch)
      },
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
        messages[i] = { ...m0, ...entry, _key: m0._key }
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

  async function loadRecentSuggestions() {
    try {
      const res = await fetch('/api/capture/recent?limit=8&author=user')
      if (!res.ok) return
      const json = (await res.json()) as {
        recentThoughts?: Array<{ id: string; normalizedText: string }>
      }
      suggestions = suggestionsFromRecentThoughts(json.recentThoughts ?? [], {
        count: ASK_SUGGESTION_COUNT,
      })
    } catch {
      // at rest the field alone is enough; no pills then
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
    if (browser) clearChatPreferBlank(localStorage)
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
    if (browser) localStorage.setItem(CHAT_ACTIVE_SESSION_STORAGE_KEY, sessionId)
    await loadSessionMessages(sessionId, loadEpoch)
    chatSidebar.open = false
  }

  async function newSession() {
    messagesLoadEpoch += 1
    activeSessionId = null
    messages = []
    loadingSession = false
    if (browser) {
      localStorage.removeItem(CHAT_ACTIVE_SESSION_STORAGE_KEY)
      setChatPreferBlank(localStorage)
    }
    chatSidebar.open = false
    scrollToBottom()
  }

  /** Clear, the ei way: the turns blur out (out:blurOut), then the writer glides back
   *  to the middle. Confirm-less — nothing here needs a dialog. */
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
        if (browser) localStorage.removeItem(CHAT_ACTIVE_SESSION_STORAGE_KEY)
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
      if (done.sessionId) activeSessionId = done.sessionId
      if (done.sessionId && browser) {
        localStorage.setItem(CHAT_ACTIVE_SESSION_STORAGE_KEY, done.sessionId)
        clearChatPreferBlank(localStorage)
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
      if (browser) localStorage.setItem(CHAT_ACTIVE_SESSION_STORAGE_KEY, pending)
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

  function messagesForDisplayPrefix(displayCount: number): ChatEntry[] {
    for (let rawLen = 0; rawLen <= messages.length; rawLen++) {
      if (normalizeChatDisplay(messages.slice(0, rawLen)).length === displayCount) {
        return messages.slice(0, rawLen)
      }
    }
    return messages
  }

  function regenerate(displayIndex: number) {
    if (loading) return
    voiceStopFn?.()
    bumpInputEpoch(inputEpoch)
    const prefix = normalizeChatDisplay(messages).slice(0, displayIndex)
    let userIdx = prefix.length - 1
    while (userIdx >= 0 && prefix[userIdx].role !== 'user') {
      userIdx--
    }
    if (userIdx < 0) return
    const prior = prefix[userIdx]
    if (prior.role !== 'user') return
    const text = prior.content
    messages = messagesForDisplayPrefix(displayIndex)
    scrollToBottom()
    sendStreaming(text)
  }

  let voiceStopFn = $state<(() => void) | undefined>(undefined)

  /**
   * Monotonic epoch used to drop stale voice transcripts after a submit. Bumped on
   * every submit (send / resend / regenerate) and on every new recording start.
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

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      send()
    }
  }

  function handleInput() {
    pageInputDrafts.chat = input
  }

  onMount(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })

    void (async () => {
      if (isBriefingMode) {
        activeSessionId = null
        messages = []
        if (!briefingBootstrapped) {
          briefingBootstrapped = true
          await sendStreaming('', { bootstrap: true })
        }
        return
      }
      await loadSessions()
      void loadRecentSuggestions()
      const preferBlank = browser ? readChatPreferBlank(localStorage) : false
      const storedId = browser ? localStorage.getItem(CHAT_ACTIVE_SESSION_STORAGE_KEY) : null
      const selection = resolveChatBootstrapSelection({ storedId, sessions, preferBlank })
      if (storedId && !sessions.some((s) => s.id === storedId) && browser) {
        localStorage.removeItem(CHAT_ACTIVE_SESSION_STORAGE_KEY)
      }
      if (selection.type === 'session') {
        if (shouldReplaceMessagesWithSessionLoad({ streaming: loading })) {
          await selectSession(selection.sessionId)
        }
      }
    })()

    return () => {
      clearStreamIdleTimeout()
      if (phaseTimer) clearTimeout(phaseTimer)
    }
  })
</script>

<!-- The thread owns scrolling; the portaled writer stays above the page mask. -->
<div
  bind:this={messagesEl}
  class="fixed inset-0 overflow-y-auto overscroll-contain px-[22px] max-[640px]:px-[18px] pb-[calc(var(--writer-height)+var(--bottom-nav)+52px)] [scroll-padding-bottom:calc(var(--writer-height)+var(--bottom-nav)+32px)]"
  class:has-conversation={writerDocked}
  style={`--writer-height: ${writerHeight}px`}
  role="log"
  aria-label="Chat messages"
>
  <div
    class={["pt-[calc(var(--head,68px)+28px)] pb-4", !writerDocked && '!p-0']}
  >
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
        <MeshSpinner working size={24} />
      </div>
    {/if}

    {#each displayMessages as msg, i (`chat-msg-${i}`)}
      {#if msg.role === 'user'}
        <section
          class="relative pt-[30px] pb-2 animate-[rise_0.8s_var(--ease)_both] [&:not(:first-child)]:mt-[26px] [&:not(:first-child)]:border-t [&:not(:first-child)]:border-line"
          out:blurOut
        >
          <h3
            class="m-0 font-you font-normal text-[clamp(19px,4.6vw,30px)] leading-[1.24] tracking-[-0.01em] text-balance"
          >
            <ChatMarkdown content={msg.content} tone="user" />
          </h3>
          <button
            type="button"
            class="inline-grid place-items-center size-9 mt-0.5 -ml-2.5 border-0 rounded-full bg-transparent text-ink-2 transition-colors duration-300 ease-settle cursor-pointer pointer-fine:hover:text-ink"
            onclick={() => resend(msg.content)}
            aria-label="Send again"
          >
            <Redo2 size={13} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </section>
      {:else if msg.variant === 'thinking'}
        <details
          class="pt-2.5 pb-0.5 font-mesh text-sm text-ink-3 [&_summary]:flex [&_summary]:items-center [&_summary]:gap-2 [&_summary]:list-none [&_summary]:cursor-pointer [&_summary::-webkit-details-marker]:hidden [&:not(:first-child)]:mt-[26px] [&:not(:first-child)]:border-t [&:not(:first-child)]:border-line"
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
          class="py-1.5 animate-[fade_0.6s_var(--ease)_both] [&:not(:first-child)]:mt-[26px] [&:not(:first-child)]:border-t [&:not(:first-child)]:border-line"
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
            running={loading && i === displayMessages.length - 1 && msg.variant === 'timeline'}
          />
        </div>
      {:else if msg.variant === 'text'}
        <section
          class="relative pt-[30px] pb-2 animate-[rise_0.8s_var(--ease)_both] [&_.chat-markdown]:mt-3.5 [&:not(:first-child)]:mt-[26px] [&:not(:first-child)]:border-t [&:not(:first-child)]:border-line"
          out:blurOut
        >
          {#if msg.content.startsWith('Error:')}
            <ChatErrorMessage message={msg.content.replace(/^Error:\s*/, '')} />
          {:else}
            <ChatMarkdown content={msg.content} />
            <button
              type="button"
              class="inline-grid place-items-center size-9 mt-0.5 -ml-2.5 border-0 rounded-full bg-transparent text-ink-2 transition-colors duration-300 ease-settle cursor-pointer pointer-fine:hover:text-ink"
              onclick={() => regenerate(i)}
              aria-label="Regenerate answer"
            >
              <Redo2 size={13} strokeWidth={1.5} aria-hidden="true" />
            </button>
          {/if}
        </section>
      {/if}
    {/each}

    {#if loading}
      <div class="flex items-center gap-[11px] h-6 mt-[22px] font-mesh text-sm text-ink-3" out:fade={{ duration: motionMs(500) }}>
        <MeshSpinner working size={24} />
        <span
          class={["inline-block animate-[wait_2.2s_var(--ease-io)_infinite] transition-opacity duration-200 ease-settle motion-reduce:[animation:none]", phaseSwapping && 'opacity-0 !animate-none']}
          aria-live="polite"
          >{phaseLabel(phase)}</span
        >
      </div>
    {/if}
  </div>

  <form
    use:portal
    use:observeWriter
    class={[
      'fixed left-1/2 z-[34] flex flex-col gap-2.5 w-[min(700px,calc(100vw-64px))] -translate-x-1/2 max-[640px]:w-[calc(100vw-44px)]',
      writerDocked ? 'bottom-[calc(var(--bottom-nav)+22px)]' : 'top-[calc(var(--head)+23vh)]',
    ]}
    autocomplete="off"
    onsubmit={(e) => {
      e.preventDefault()
      void send()
    }}
  >
    <textarea
      bind:this={inputEl}
      bind:value={input}
      class="w-full [field-sizing:content] max-h-40 pt-[3px] pb-1 border-0 outline-none resize-none bg-transparent font-you text-[21px] leading-[1.3] text-ink caret-signal overflow-y-auto [scrollbar-width:none] placeholder:text-ink-3 disabled:opacity-55"
      rows="1"
      placeholder={m.ask_placeholder()}
      aria-label={m.nav_ask()}
      oninput={handleInput}
      onkeydown={handleKeydown}
      onfocus={() => voiceStopFn?.()}
      disabled={loading || loadingSession}></textarea>
    <div class="flex items-center gap-2">
      {#if sessions.length > 0}
        <button
          type="button"
          class="size-[34px]"
          onclick={() => (chatSidebar.open = true)}
          aria-label={m.ask_past()}
          title={m.ask_past()}
        >
          <History size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      {/if}
      {#if conversationStarted || hasText}
        <button
          type="button"
          class="size-[34px]"
          onclick={clearConversation}
          aria-label={m.ask_clear()}
          title={m.ask_clear()}
        >
          <XIcon size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      {/if}
      <VoiceInputButton
        language={(page.data as { preferredLanguage?: string }).preferredLanguage ?? 'en'}
        disabled={loading || loadingSession}
        class="size-[34px]"
        bind:stopRef={voiceStopFn}
        onstart={() => {
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
        onerror={(message) => {
          console.error('voice input failed', message)
        }}
      />
      {#if loading}
        <button
          type="button"
          class="flex-none ml-auto inline-flex items-center gap-2.5 h-[34px] w-[34px] p-0 justify-center border-0 rounded-full bg-ink text-paper font-mesh text-sm leading-none [transition:opacity_0.4s_var(--ease),background_0.4s_var(--ease),transform_0.5s_var(--ease)] pointer-fine:hover:bg-[color-mix(in_srgb,var(--ink)_88%,var(--paper))]"
          onclick={stop}
          aria-label="Stop"
        >
          <Square size={11} strokeWidth={2} aria-hidden="true" />
        </button>
      {:else}
        <button
          type="submit"
          class={["flex-none ml-auto inline-flex items-center gap-2.5 h-[34px] pl-[17px] pr-2.5 border-0 rounded-full bg-ink text-paper font-mesh text-sm leading-none [transition:opacity_0.4s_var(--ease),background_0.4s_var(--ease),transform_0.5s_var(--ease)] hover-none:[&_kbd]:hidden max-[640px]:pr-[17px]", hasText ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 -translate-x-1.5 pointer-events-none']}
          disabled={!hasText}
        >
          {m.nav_ask()}
          <kbd
            class="inline-grid place-items-center min-w-5 h-[18px] px-[5px] rounded-[5px] shadow-[inset_0_0_0_1px_currentColor] font-mesh text-sm leading-none opacity-70"
            aria-hidden="true">↵</kbd
          >
        </button>
      {/if}
    </div>
    {#if suggestions.length > 0 && !writerDocked}
      <div class="animate-[rise_0.9s_var(--ease)_0.15s_backwards] motion-reduce:[animation:none]" out:fade={{ duration: motionMs(300) }}>
        <div class="mt-[30px] mb-2.5 font-mesh text-sm text-ink-3">{m.ask_try()}</div>
        <div class="flex flex-col items-start gap-2">
          {#each suggestions as s (s.id)}
            <button
              type="button"
              class="inline-flex items-center max-w-full min-h-9 px-4 py-1.5 rounded-[18px] border-0 bg-transparent shadow-[inset_0_0_0_1px_var(--ink-4)] font-you text-[15px] leading-[1.35] text-left text-ink-2 [overflow-wrap:anywhere] transition-[color,box-shadow] duration-[350ms] ease-settle cursor-pointer pointer-fine:hover:text-ink pointer-fine:hover:shadow-[inset_0_0_0_1px_var(--ink-3)]"
              onclick={() => resend(s.text)}>{s.text}</button
            >
          {/each}
        </div>
      </div>
    {/if}
  </form>

</div>

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
        onclick={clearConversation}>{m.ask_clear()}</button
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

