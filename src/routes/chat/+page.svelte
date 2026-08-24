<script lang="ts">
  import type { PageData } from './$types'
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import PanelLeftClose from '@lucide/svelte/icons/panel-left-close'
  import PanelRightClose from '@lucide/svelte/icons/panel-right-close'
  import Plus from '@lucide/svelte/icons/plus'
  import Redo2 from '@lucide/svelte/icons/redo-2'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import SendHorizontal from '@lucide/svelte/icons/send-horizontal'
  import Square from '@lucide/svelte/icons/square'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import { onMount } from 'svelte'
  import { fade, fly } from 'svelte/transition'
  import { browser } from '$app/environment'
  import { resolve } from '$app/paths'
  import { page } from '$app/state'
  import type { Pathname } from '$app/types'
  import { insufficientCreditsTopUpHint } from '$lib/billing/insufficient-credits'
  import { appendVoiceTranscript } from '$lib/capture/transcribe-audio'
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
  import ChatErrorMessage from '$lib/components/chat-error-message.svelte'
  import ChatMarkdown from '$lib/components/chat-markdown.svelte'
  import ChatTimelineStep from '$lib/components/chat-timeline-step.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Textarea } from '$lib/components/ui/textarea'
  import VoiceInputButton from '$lib/components/voice-input-button.svelte'
  import { GRAPH_FILTER_GLASS_ROW, graphFilterTriggerClass } from '$lib/graph/graph-filter-chrome'
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
  let streamEventsReceived = $state(false)
  let streamAbortReason = $state<'user' | 'timeout' | null>(null)
  let pendingSelectSessionId = $state<string | null>(null)
  /** Bumped on New chat / new stream turn / selectSession so stale fetches cannot apply. */
  let messagesLoadEpoch = 0
  let agentStatus = $state<string | null>(null)
  let messagesEl: HTMLDivElement | undefined
  let chatPanelEl: HTMLDivElement | undefined
  const STREAM_IDLE_MS = 120_000
  let streamIdleTimeoutId: ReturnType<typeof setTimeout> | null = null

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
      const m = messages[i]
      if (m.role === 'assistant' && m.variant === 'timeline' && m.tool === entry.tool) {
        if (m.kind === 'tool_result' && entry.kind !== 'tool_result') {
          break
        }
        messages[i] = { ...m, ...entry, _key: m._key }
        scrollToBottom()
        return
      }
    }
    appendMessage(entry)
  }

  let streamingStatus = $derived.by(() => {
    if (!loading) return null
    if (!streamEventsReceived) return 'Connecting…'
    if (agentStatus) return agentStatus
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'assistant' && m.variant === 'timeline' && (m.label?.trim() ?? '')) {
        return m.label
      }
    }
    return 'Working…'
  })

  function handleChatPanelWheel(e: WheelEvent) {
    const el = messagesEl
    if (!el) return

    const target = e.target
    if (target instanceof HTMLElement) {
      const textarea = target.closest('textarea')
      if (
        textarea instanceof HTMLTextAreaElement &&
        textarea.scrollHeight > textarea.clientHeight
      ) {
        const { scrollTop, clientHeight, scrollHeight } = textarea
        if (e.deltaY < 0 && scrollTop > 0) return
        if (e.deltaY > 0 && scrollTop + clientHeight < scrollHeight) return
      }
    }

    const maxScroll = el.scrollHeight - el.clientHeight
    if (maxScroll <= 0) return

    if (target instanceof Node && el.contains(target)) {
      const atTop = el.scrollTop <= 0
      const atBottom = el.scrollTop >= maxScroll - 1
      if (e.deltaY > 0 && !atBottom) return
      if (e.deltaY < 0 && !atTop) return
    }

    const next = Math.max(0, Math.min(maxScroll, el.scrollTop + e.deltaY))
    if (next === el.scrollTop) return
    el.scrollTop = next
    e.preventDefault()
  }

  function scrollToBottom() {
    const el = messagesEl
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })
    })
  }

  function formatDate(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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
    streamEventsReceived = true

    if (event.type === 'thinking') {
      agentStatus = null
      appendMessage({ role: 'assistant', variant: 'thinking', content: event.content })
      return
    }
    if (event.type === 'agent_progress') {
      agentStatus = event.label
      appendMessage({
        role: 'assistant',
        variant: 'timeline',
        kind: 'llm_progress',
        label: event.label,
      })
      return
    }
    if (event.type === 'tool_call') {
      agentStatus = null
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
      agentStatus = null
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
      agentStatus = event.label
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
      agentStatus = 'Preparing your reply…'
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
    scrollToBottom()
    streamEventsReceived = false
    streamAbortReason = null
    agentStatus = null

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
      agentStatus = null
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

    await sendStreaming(text)
  }

  function stop() {
    if (!abortController) return
    streamAbortReason = 'user'
    abortController.abort()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  onMount(() => {
    const origHtmlOverflow = document.documentElement.style.overflow
    const origBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
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

    const panel = chatPanelEl
    panel?.addEventListener('wheel', handleChatPanelWheel, { passive: false })

    return () => {
      panel?.removeEventListener('wheel', handleChatPanelWheel)
      document.documentElement.style.overflow = origHtmlOverflow
      document.body.style.overflow = origBodyOverflow
    }
  })
</script>

{#if isBriefingMode}
  <div
    class="fixed inset-x-0 top-20 z-30 border-b border-border bg-background/95 px-4 py-3 backdrop-blur-sm"
    role="region"
    aria-label="Timeline briefing"
  >
    <div class="mx-auto w-full max-w-2xl">
      <h1 class="text-sm font-medium text-foreground">
        {briefingPeriod === 'evening'
          ? 'Evening review'
          : briefingPeriod === 'weekly'
            ? 'Weekly review'
            : 'Morning briefing'}
      </h1>
      <p class="text-muted-foreground mt-0.5 text-xs leading-relaxed">
        Your assistant summarizes agenda, priorities, and open loops from your timeline.
      </p>
    </div>
  </div>
{/if}

<!-- sidebar: only in DOM while open (no invisible overlay stealing clicks) -->
{#if chatSidebar.open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 cursor-pointer bg-black/20"
    transition:fade={{ duration: 200 }}
    onclick={() => (chatSidebar.open = false)}
  ></div>
  <div
    class="fixed left-0 top-0 z-50 flex h-full w-64 flex-col border-r border-border bg-white pt-safe dark:bg-card"
    role="dialog"
    aria-label="Chat sessions"
    transition:fly={{ x: -256, duration: 280 }}
  >
    <div class="px-5 pb-3">
      <button
        class="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        onclick={() => (chatSidebar.open = false)}
        aria-label="Close sidebar"
      >
        <PanelLeftClose class="size-4" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>

    <div class="px-5 pb-3">
      <Button variant="outline" size="sm" class="w-full rounded-[4px]" onclick={newSession}>
        <Plus strokeWidth={1.75} />
        New chat
      </Button>
    </div>

    <div class="mx-3 h-px bg-border"></div>

    <div class="flex-1 overflow-y-auto px-2 py-2">
      {#if sessions.length === 0}
        <p class="text-muted-foreground px-2 py-8 text-center text-xs leading-relaxed">
          No conversations yet. Capture a thought first, then ask Eigen Mesh about it.
          <a href={resolve('/capture' as Pathname)} class="mt-2 block underline">Go to Capture</a>
        </p>
      {/if}
      {#each sessions as s (s.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="group flex w-full cursor-pointer items-start gap-2 rounded px-2.5 py-2 text-left transition-colors {s.id ===
          activeSessionId
            ? 'bg-muted'
            : 'hover:bg-muted/50'}"
          onclick={() => selectSession(s.id)}
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs leading-snug text-foreground">
              {s.title?.trim() || 'Untitled'}
            </p>
            <p class="text-muted-foreground mt-0.5 text-[10px]">{formatDate(s.updatedAt)}</p>
          </div>
          <button
            class="invisible shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive group-hover:visible"
            onclick={(e) => deleteSession(s.id, e)}
            aria-label="Delete session"
          >
            <Trash2 class="size-3" strokeWidth={1.5} />
          </button>
        </div>
      {/each}
    </div>
  </div>
{/if}

<div
  bind:this={chatPanelEl}
  class="fixed inset-x-0 bottom-20 z-30 overflow-hidden {isBriefingMode
    ? 'top-[10.25rem]'
    : 'top-0'}"
>
  <div
    class="pointer-events-none absolute top-14 left-3 z-50 md:top-16"
    aria-label="Chat session list"
  >
    <div class="pointer-events-auto">
      <div class={GRAPH_FILTER_GLASS_ROW}>
        <button
          type="button"
          class={graphFilterTriggerClass(false, 'label')}
          onclick={() => (chatSidebar.open = !chatSidebar.open)}
          aria-label="Toggle session list"
          aria-pressed={chatSidebar.open}
        >
          <PanelRightClose
            class="size-3.5 shrink-0 opacity-90"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span class="truncate">Chats</span>
        </button>
      </div>
    </div>
  </div>
  <div
    bind:this={messagesEl}
    class="absolute inset-0 overflow-y-auto overflow-x-clip"
    role="log"
    aria-label="Chat messages"
  >
    <div class="mx-auto flex min-h-full w-full min-w-0 max-w-2xl flex-col px-4 pb-52 pt-20">
      <div class="flex flex-1 flex-col gap-1 px-1 py-3">
        {#if loadingSession}
          <div class="flex flex-1 items-center justify-center">
            <LoaderCircleIcon class="text-muted-foreground size-4 animate-spin" />
          </div>
        {:else if messages.length === 0 && !loading}
          <div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p class="text-muted-foreground max-w-xs text-sm tracking-wide">
              Ask about your memories, manage thoughts, or save something new when you want to.
            </p>
          </div>
        {/if}

        {#each displayMessages as msg, i (`chat-msg-${i}`)}
          {#if msg.role === 'user'}
            <!-- User message: right-aligned, Klein Blue bg, clean pill -->
            <div class="group flex min-w-0 w-full flex-row-reverse items-end gap-3 py-0.5">
              <div class="flex min-w-0 max-w-[72%] flex-col items-end gap-1 overflow-visible">
                <div
                  class="relative min-w-0 overflow-visible rounded-none bg-foreground px-3.5 py-2 text-background"
                >
                  <span
                    class="pointer-events-none absolute top-0 right-0 h-0 w-0 translate-x-full border-t-8 border-t-foreground border-r-6 border-r-transparent"
                    aria-hidden="true"
                  ></span>
                  <ChatMarkdown content={msg.content} tone="user" />
                </div>
                <button
                  class="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                  onclick={() => resend(msg.content)}
                  aria-label="Send again"
                >
                  <Redo2 class="size-3" strokeWidth={1.5} />
                </button>
              </div>
            </div>
          {:else if msg.variant === 'thinking'}
            <div class="min-w-0 w-full py-0.5">
              <details class="group/think min-w-0 max-w-full">
                <summary
                  class="cursor-pointer select-none list-none max-w-full rounded-md px-3 py-2 text-sm text-muted-foreground italic leading-normal flex flex-wrap items-center gap-1.5"
                >
                  <span class="inline-block size-1 bg-accent shrink-0"></span>
                  Thinking
                  {#if msg.content}
                    <span class="text-xs not-italic opacity-50 group-open/think:hidden"
                      >(expand)</span
                    >
                  {/if}
                </summary>
                {#if msg.content}
                  <div class="mt-2 ml-3 min-w-0 border-l border-border pl-3 py-0.5">
                    <ChatMarkdown content={msg.content} tone="muted" />
                  </div>
                {/if}
              </details>
            </div>
          {:else if msg.variant === 'timeline'}
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
          {:else if msg.variant === 'text'}
            <div class="group flex min-w-0 w-full flex-row items-start gap-0 py-1">
              <div
                class="flex min-w-0 max-w-full flex-col items-start gap-1 rounded-md px-3.5 py-2 sm:max-w-[82%]"
              >
                {#if msg.content.startsWith('Error:')}
                  <ChatErrorMessage
                    message={msg.content.replace(/^Error:\s*/, '')}
                    class="w-full"
                  />
                {:else}
                  <ChatMarkdown content={msg.content} />
                  <button
                    class="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                    onclick={() => regenerate(i)}
                    aria-label="Regenerate answer"
                  >
                    <RefreshCw class="size-3" strokeWidth={1.5} />
                  </button>
                {/if}
              </div>
            </div>
          {/if}
        {/each}

        {#if loading && streamingStatus}
          <div class="min-w-0 py-1">
            <div
              class="flex min-w-0 items-start gap-1.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm leading-normal text-muted-foreground"
            >
              <LoaderCircleIcon class="mt-0.5 size-3.5 shrink-0 animate-spin" />
              <span class="min-w-0 wrap-break-word">{streamingStatus}</span>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- input area (pinned, outside scroll flow — see .cursor/rules/chat-scroll-layout.mdc) -->
  <div class="pointer-events-none absolute inset-x-0 bottom-0 z-10">
    <div class="pointer-events-auto mx-auto min-w-0 w-full max-w-2xl bg-background px-4 pb-2 pt-2">
      <Card.Root
        class="bg-white dark:bg-card min-w-0 w-full overflow-visible border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none p-0 gap-0 items-start overflow-x-clip"
      >
        <Card.Content class="min-w-0 p-0 w-full">
          <Textarea
            bind:value={input}
            oninput={() => {
              pageInputDrafts.chat = input
            }}
            onkeydown={handleKeydown}
            onfocus={() => voiceStopFn?.()}
            placeholder="Ask a question about your memories..."
            class="min-w-0 w-full break-all border-0 bg-transparent shadow-none focus-visible:ring-0 p-4 text-base md:text-base min-h-[72px] max-h-[min(40dvh,280px)] overflow-y-auto resize-none text-foreground placeholder:text-muted-foreground"
            disabled={loading || loadingSession}
          />
        </Card.Content>
        <Card.Footer class="bg-muted/50 p-4 flex flex-row items-center justify-end gap-2 w-full">
          <VoiceInputButton
            language={(page.data as { preferredLanguage?: string }).preferredLanguage ?? 'en'}
            disabled={loading || loadingSession}
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
          <Button
            onclick={loading ? stop : send}
            disabled={!loading && (loadingSession || !input.trim())}
            class="bg-black text-white dark:bg-white dark:text-black rounded-none px-[22px] py-[12px] text-base font-medium leading-6 h-auto border-0 hover:bg-black/90 dark:hover:bg-white/90"
          >
            {#if loading}
              <Square class="size-4 shrink-0" strokeWidth={1.75} />
            {:else}
              <SendHorizontal class="size-4 shrink-0" strokeWidth={1.75} />
            {/if}
          </Button>
        </Card.Footer>
      </Card.Root>
    </div>
  </div>
</div>
