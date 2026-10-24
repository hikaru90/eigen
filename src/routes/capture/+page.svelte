<script lang="ts">
  import type { PageData } from './$types'
  import { onMount } from 'svelte'
  import { trackInsufficientCredits } from '$lib/analytics/billing-events'
  import { capture as captureEvent } from '$lib/analytics/posthog-client'
  import { fetchEchoThought, ECHO_DELAY_MS, type EchoPick } from '$lib/capture/capture-echo'
  import { fetchCaptureResult } from '$lib/capture/capture-result-api'
  import type { CaptureSubmitResult } from '$lib/capture/capture-result-types'
  import {
    consumeCaptureNdjsonStream,
    type ProgressEvent,
  } from '$lib/capture/consume-capture-ndjson'
  import { isFirstCaptureNudgeDismissed } from '$lib/capture/first-capture-nudge'
  import { keepOutcomeFromResponse } from '$lib/capture/keep-outcome'
  import {
    KEPT_LINKED_FADE_MS,
    KEPT_POLL_MAX_TRIES,
    KEPT_POLL_MS,
    keptStage,
    type KeptStage,
  } from '$lib/capture/kept-progress'
  import {
    cancelCaptureQueueItem,
    enqueueCapture,
    getCaptureQueueSnapshot,
    subscribeCaptureQueue,
    type CaptureQueueItem,
  } from '$lib/capture/queue'
  import { captureQueueItemPreview } from '$lib/capture/queue/snapshot'
  import {
    applyCaptureQueueActive,
    applyCaptureQueueSnapshot,
    CAPTURE_QUEUE_ACTIVATION_GUARD_MS,
    initialCaptureQueueUiState,
    shouldAcceptCaptureProgress,
    type CaptureQueueUiState,
  } from '$lib/capture/queue/ui-state'
  import {
    categoryLabel,
    hashQueryAt,
    readingFromPreview,
    readingStatusFor,
    stripHashAt,
    stripTrailingHash,
    withAcceptedType,
    type ReadingDraft,
    type ThreadChoice,
  } from '$lib/capture/reading-state'
  import { planCaptureSubmit } from '$lib/capture/submit-plan'
  import { appendVoiceTranscript } from '$lib/capture/transcribe-audio'
  import { thoughtHref } from '$lib/chat/thought-href'
  import { logErrorToServer } from '$lib/client-log'
  import MeshSpinner from '$lib/components/brand/mesh-spinner.svelte'
  import CaptureKept from '$lib/components/capture-kept.svelte'
  import CaptureOnboardingOverlay from '$lib/components/capture-onboarding-overlay.svelte'
  import CaptureReading from '$lib/components/capture-reading.svelte'
  import CreditsTopUpPanel from '$lib/components/credits-top-up-panel.svelte'
  import FirstCaptureNudge from '$lib/components/first-capture-nudge.svelte'
  import GlassWriter from '$lib/components/writer/glass-writer.svelte'
  import { fetchEnrichPendingSnapshot } from '$lib/graph/poll-graph-enrich-refresh'
  import { flyThought, releaseGhostWords } from '$lib/motion/settle'
  import { m } from '$lib/paraglide/messages.js'
  import { pulseBrand } from '$lib/stores/brand-pulse.svelte'
  import { pageInputDrafts } from '$lib/stores/page-input-drafts.svelte'
  import { showWhisper } from '$lib/stores/whisper.svelte'

  let { data }: { data: PageData } = $props()

  const showOnboarding = $derived(!data.onboardingCompleted)
  const captureBlocked = $derived(!data.captureAllowed)

  function trackCaptureGateInsufficientCredits() {
    if (captureBlocked && data.captureGateReason === 'insufficient_credits') {
      trackInsufficientCredits({
        surface: 'capture_gate',
        phase: 'precheck',
        required_credits: data.minCaptureCredits,
        available_credits: data.walletAvailableCredits,
      })
    }
  }

  /** True when this page load started with zero stored thoughts (first-capture nudge). */
  let startedWithNoThoughts = $state((() => data.recentThoughts.length === 0)())
  let firstCaptureNudgeDismissed = $state(false)
  let firstCaptureNudgeHydrated = $state(false)

  onMount(() => {
    trackCaptureGateInsufficientCredits()
    firstCaptureNudgeDismissed = isFirstCaptureNudgeDismissed(data.user.id)
    firstCaptureNudgeHydrated = true
  })

  let localWalletCredits = $derived(data.walletAvailableCredits)

  /* ————— the writer ————— */

  let raw = $state(pageInputDrafts.capture)
  let fieldEl = $state<HTMLTextAreaElement | null>(null)
  let voiceStopFn = $state<(() => void) | undefined>(undefined)
  /** Draft text present when the current recording started; transcripts append to it. */
  let voiceBaseText = ''

  /* ————— the reading (read as you type, decision #3 — nothing is stored until Capture) ————— */

  let reading = $state<ReadingDraft | null>(null)
  let readingWaiting = $state(false)
  let readingError = $state<string | null>(null)
  const readingShown = $derived(readingWaiting || !!reading || !!readingError)
  /** Monotonic token: only the newest read call may paint the reading. */
  let interpretToken = 0
  let interpretTimer: ReturnType<typeof setTimeout> | null = null

  let typeMenuOpen = $state(false)
  let threadChoice = $state<ThreadChoice>({ kind: 'loose' })
  let threadMenuOpen = $state(false)
  let newThreadLabel = $state('')
  let threadProjects = $state<Array<{ entityId: string; label: string }>>([])
  let threadProjectsLoaded = $state(false)
  let hashQuery = $state<string | null>(null)

  /* ————— after Capture ————— */

  /** How the last capture was kept, and where its background pass is (the heading's place). */
  type Kept = {
    typeLabel: string
    threadLabel: string
    stage: KeptStage
    entityCount: number
    linkedCount: number
    slow: boolean
    failureReason: string | null
  }
  let kept = $state<Kept | null>(null)
  /** Monotonic token: a newer capture (or new typing) stops an older poll. */
  let keptToken = 0

  /** Follows the kept thought's background pass until it is linked or failed (explicit loop from submit). */
  async function followKept(thoughtId: string, token: number): Promise<void> {
    for (let attempt = 0; attempt < KEPT_POLL_MAX_TRIES; attempt += 1) {
      if (token !== keptToken || !kept) return
      let result: CaptureSubmitResult
      try {
        result = await fetchCaptureResult(thoughtId)
      } catch (e) {
        err = e instanceof Error && e.message ? e.message : failureText(null)
        return
      }
      if (token !== keptToken || !kept) return
      const stage = keptStage(result)
      kept = {
        ...kept,
        stage,
        entityCount: result.entities.length,
        linkedCount: result.linkedThoughts.length,
        failureReason: result.queueError ?? null,
      }
      if (stage === 'linked' || stage === 'failed') {
        handleCapturedThought(result, 'keep')
        if (stage === 'linked') {
          // done says itself for a moment, then the heading's place is free again
          setTimeout(() => {
            if (token === keptToken && kept?.stage === 'linked') kept = null
          }, KEPT_LINKED_FADE_MS)
        }
        return
      }
      await new Promise((resolve) => setTimeout(resolve, KEPT_POLL_MS))
    }
    if (token === keptToken && kept) kept = { ...kept, slow: true }
  }

  /* Capture never shows the kept thought again — editing it lives in Mesh. */
  let capturedThisVisit = $state(false)
  let submitting = $state(false)
  let err = $state<string | null>(null)
  let echo = $state<EchoPick | null>(null)
  let echoTimer: ReturnType<typeof setTimeout> | null = null
  /** The pencil's words, applied as a natural-language edit once the thought is stored. */
  let pendingSay = $state<string | null>(null)

  const showFirstCaptureNudge = $derived(
    firstCaptureNudgeHydrated &&
      startedWithNoThoughts &&
      capturedThisVisit &&
      !firstCaptureNudgeDismissed &&
      !showOnboarding,
  )

  /* ————— the mesh's thread options (existing projects endpoint) ————— */

  async function loadThreadProjects() {
    if (threadProjectsLoaded) return
    threadProjectsLoaded = true
    try {
      const res = await fetch('/api/timeline/projects', { credentials: 'same-origin' })
      if (!res.ok) return
      const body = (await res.json()) as { projects?: unknown }
      if (!body || typeof body !== 'object' || !Array.isArray(body.projects)) return
      const options: Array<{ entityId: string; label: string }> = []
      for (const p of body.projects) {
        if (!p || typeof p !== 'object') continue
        const entityId = (p as { entityId?: unknown }).entityId
        const label = (p as { label?: unknown }).label
        if (typeof entityId === 'string' && entityId && typeof label === 'string' && label.trim()) {
          options.push({ entityId, label })
        }
      }
      threadProjects = options
    } catch {
      // the picker still works with Keep it loose / New thread — list is best-effort
    }
  }

  /* ————— the reading is a preview: /api/capture/read persists nothing ————— */

  function clearReading() {
    if (interpretTimer !== null) {
      clearTimeout(interpretTimer)
      interpretTimer = null
    }
    interpretToken += 1
    reading = null
    readingWaiting = false
    readingError = null
    typeMenuOpen = false
    hashQuery = null
  }

  async function runRead(requestedRaw: string) {
    const token = ++interpretToken
    try {
      const res = await fetch('/api/capture/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw: requestedRaw }),
        credentials: 'same-origin',
      })
      // the writer moved on while this pass ran — nothing was stored, nothing to clean up
      if (token !== interpretToken) return
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        throw new Error(failureText(payload.message ?? payload.error ?? null, res.status))
      }
      const body = (await res.json()) as unknown
      const draft = readingFromPreview(body, requestedRaw)
      if (!draft) throw new Error(failureText(null))
      reading = draft
      readingWaiting = false
      readingError = null
    } catch (e) {
      if (token !== interpretToken) return
      readingWaiting = false
      reading = null
      readingError = e instanceof Error && e.message ? e.message : failureText(null)
    }
  }

  function onFieldInput() {
    pageInputDrafts.capture = raw
    // the kept card stays: the capture's process is not re-hidden by the next words
    // inline `#` thread gesture (ei checkHash): a trailing #token at the caret opens the picker
    hashQuery = hashQueryAt(raw, fieldEl?.selectionStart ?? raw.length)

    const status = readingStatusFor(raw)
    if (status === 'idle') {
      clearReading()
      return
    }
    // the typing itself announces the reading; the words arrive after the pause
    readingWaiting = true
    readingError = null
    if (interpretTimer !== null) clearTimeout(interpretTimer)
    interpretTimer = setTimeout(() => {
      interpretTimer = null
      void runRead(raw)
    }, 600)
  }

  function onFieldKeydown(e: KeyboardEvent) {
    if (e.key === 'Tab' && hashQuery !== null) {
      // tab picks the first matching thread in the inline picker (ei: tab accepts the suggestion)
      const match = threadProjects.find((p) =>
        p.label.toLowerCase().includes((hashQuery ?? '').trim().toLowerCase()),
      )
      if (match) {
        e.preventDefault()
        pickThread({ kind: 'thread', entityId: match.entityId, label: match.label })
      }
    }
  }

  function pickType(key: string) {
    // the type menu edits the client copy of the accepted reading (LLM's own options only)
    if (reading) reading = withAcceptedType(reading, key)
    typeMenuOpen = false
    fieldEl?.focus()
  }

  function pickThread(choice: ThreadChoice) {
    if (hashQuery !== null && fieldEl) {
      const stripped = stripHashAt(raw, fieldEl.selectionStart ?? raw.length)
      raw = stripped.value
      pageInputDrafts.capture = raw
      const set = () => {
        fieldEl?.setSelectionRange(stripped.caret, stripped.caret)
        fieldEl?.focus()
      }
      queueMicrotask(set)
    }
    hashQuery = null
    threadMenuOpen = false
    threadChoice = choice
    newThreadLabel = ''
    fieldEl?.focus()
  }

  function onSay(text: string) {
    // The pencil's words are the user's own natural-language instruction; they are
    // applied through the existing edit endpoint once this thought is stored.
    pendingSay = text
    fieldEl?.focus()
  }

  /* ————— the queue (kept: cancel, offline, Background Sync) ————— */

  let queueUi = $state<CaptureQueueUiState>(initialCaptureQueueUiState())
  let processingCaptureId = $state<string | null>(null)
  let pendingCount = $derived(queueUi.pendingCount)
  let queueActive = $derived(pendingCount > 0 || processingCaptureId !== null)

  let queueItems = $state<CaptureQueueItem[]>([])
  let progressEvents = $state<Array<{ event: ProgressEvent; arrivedAt: number }>>([])

  const visibleQueueItems = $derived(
    queueItems.filter(
      (i) => i.status === 'pending' || i.status === 'processing' || i.status === 'failed',
    ),
  )

  function applyQueueSnapshot(
    snapshot: {
      items: CaptureQueueItem[]
      pending: number
      processingId: string | null
    },
    opts?: { respectProcessingSuppress?: boolean },
  ) {
    queueItems = snapshot.items
    queueUi = applyCaptureQueueSnapshot(queueUi, {
      pending: snapshot.pending,
      processingId: snapshot.processingId,
    })
    const mayResync = !opts?.respectProcessingSuppress || Date.now() >= suppressProcessingResyncUntil
    if (mayResync) {
      if (snapshot.processingId && snapshot.processingId !== processingCaptureId) {
        progressEvents = []
      }
      processingCaptureId = snapshot.processingId
    }
  }

  async function reconcileQueueState(
    clearProgressWhenIdle = true,
    opts?: { respectProcessingSuppress?: boolean },
  ) {
    const snap = await getCaptureQueueSnapshot()
    applyQueueSnapshot(snap, opts)
    if (clearProgressWhenIdle && !snap.processingId) {
      progressEvents = []
    }
  }

  async function cancelQueuedItem(id: string) {
    err = null
    if (processingCaptureId === id) {
      progressEvents = []
    }
    try {
      await cancelCaptureQueueItem(id)
      await reconcileQueueState(false)
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    }
  }

  /** Ignore stale snapshot processing ids briefly after done/failed (SW/tab race). */
  let suppressProcessingResyncUntil = $state(0)

  /* ————— capture: the words condense into a dot and fly into Mesh ————— */

  function meshSlotElement(): Element | null {
    if (typeof document === 'undefined') return null
    return document.querySelector('.nav a[href$="/mesh"] .mark-slot')
  }

  function whisperKept(typeKey: string | null) {
    const kept = m.whisper_kept()
    const third =
      typeKey !== null ? `${categoryLabel(typeKey)} · ${kept}` : kept
    pulseBrand(1300)
    showWhisper([
      { text: m.whisper_settling(), durationMs: 800 },
      { text: m.whisper_knitting(), durationMs: 1100 },
      { text: third, durationMs: 2000 },
    ])
  }

  function scheduleEcho(thought: CaptureSubmitResult) {
    if (echoTimer !== null) clearTimeout(echoTimer)
    echoTimer = setTimeout(() => {
      echoTimer = null
      void fetchEchoThought(thought.normalizedText, thought.id)
        .then((pick) => {
          if (pick && !raw.trim()) echo = pick
        })
        .catch(() => {
          // an echo may surface — absence is honest, never a substitute
        })
    }, ECHO_DELAY_MS)
  }

  function playMeshArrival() {
    // Mesh's mark leans in as the thought arrives (ei menu icons play); the chrome
    // owns that animation, so a pulse on the slot is enough from here.
    const slot = meshSlotElement()
    if (!slot) return
    slot.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.18)' },
        { transform: 'scale(1)' },
      ],
      { duration: 620, easing: 'cubic-bezier(.22,1,.36,1)' },
    )
  }

  async function submitCapture() {
    if (submitting) return
    const text = stripTrailingHash(raw)
    const offlineNow = typeof navigator !== 'undefined' && !navigator.onLine
    // freshness is judged on the words that will be kept (an unpicked trailing #token is not words)
    const plan = planCaptureSubmit({
      raw: text,
      draft: reading,
      blocked: captureBlocked,
      offline: offlineNow,
    })
    if (plan.kind === 'none') {
      fieldEl?.focus()
      return
    }
    err = null
    voiceStopFn?.()
    typeMenuOpen = false
    threadMenuOpen = false
    // the whisper names the accepted type (taken before the field empties)
    const chosenType = plan.kind === 'keep' ? plan.reading.category.key : null
    captureEvent('capture_submitted', { text_length: text.length })

    // 1 · the words condense into a single point and fly into Mesh, pulling yarn
    const field = fieldEl
    const center = field ? releaseGhostWords(field, text) : null
    const slot = meshSlotElement()
    const from =
      center ??
      (field
        ? (() => {
            const r = field.getBoundingClientRect()
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
          })()
        : null)
    if (from && slot) {
      flyThought(from, slot, { onArrive: playMeshArrival })
    }

    // 2 · the field empties; the accepted reading stays as "Kept as …" with the
    //     background pass's progress (the words themselves are never shown again)
    if (plan.kind === 'keep') {
      keptToken += 1
      kept = {
        typeLabel: categoryLabel(plan.reading.category.key),
        threadLabel: threadChoice.kind === 'thread' ? threadChoice.label : m.capture_reading_loose(),
        stage: 'saving',
        entityCount: 0,
        linkedCount: 0,
        slow: false,
        failureReason: null,
      }
    }
    raw = ''
    pageInputDrafts.capture = ''
    echo = null
    clearReading()
    threadMenuOpen = false

    // 3 · the mesh quietly takes it in
    whisperKept(chosenType)

    if (plan.kind === 'keep') {
      // ONE call persists: raw as typed + the accepted reading → row, normalized_text, enrich.
      // The picked thread rides along: the server writes the membership link now, not after
      // the background pass — the mesh lists the thread with the thought, not later.
      submitting = true
      let res: Response
      try {
        res = await fetch('/api/capture/keep', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            raw: text,
            reading: plan.reading,
            ...(threadChoice.kind === 'thread'
              ? { thread: threadChoice.entityId ? { entityId: threadChoice.entityId } : { label: threadChoice.label } }
              : {}),
          }),
          credentials: 'same-origin',
        })
      } catch (e) {
        // no answer at all — nothing is known to be kept; the words go back
        kept = null
        submitting = false
        err = e instanceof Error && e.message ? e.message : failureText(null)
        restoreWords(text)
        return
      }
      const outcome = keepOutcomeFromResponse(
        res.ok,
        res.status,
        await res.json().catch(() => null),
      )
      if (outcome.kind === 'not-kept') {
        kept = null
        submitting = false
        err = failureText(outcome.message, outcome.status)
        restoreWords(text)
        return
      }
      // From here on the row IS kept (2xx): never restore the words — a second press
      // would keep a second row. Follow-ups may fail loudly, but they stay follow-ups.
      submitting = false
      if (!outcome.thoughtId) {
        kept = null
        err = failureText(null)
        return
      }
      captureEvent('capture_confirmed', { thought_id: outcome.thoughtId })
      if (kept) kept = { ...kept, stage: 'indexing' }
      await followKept(outcome.thoughtId, keptToken)
      return
    }

    // enqueue: the client capture queue (offline-safe, Background Sync, payload {raw})
    submitting = true
    try {
      await enqueueCapture(text)
    } catch (e) {
      err = e instanceof Error && e.message ? e.message : failureText(null)
      restoreWords(text)
    } finally {
      submitting = false
    }
  }

  /** Put the words back into the field — only when nothing was kept. */
  function restoreWords(text: string) {
    raw = text
    pageInputDrafts.capture = text
    queueMicrotask(() => {
      fieldEl?.focus()
    })
  }

  /**
   * Failure copy: the server's own message when it gave one; otherwise the existing
   * generic failure key (a capture-specific key is reported under missingKeys).
   */
  function failureText(serverMessage: string | null, status?: number): string {
    if (serverMessage) return serverMessage
    return status ? `${m.desk_error_action()} (${status})` : m.desk_error_action()
  }

  function handleCapturedThought(thought: CaptureSubmitResult, from: 'keep' | 'queue') {
    capturedThisVisit = true
    submitting = false
    err = null
    captureEvent('capture_completed', {
      thought_id: thought.id,
      enrichment_complete: thought.enrichmentComplete,
    })
    // 'keep' already linked the picked thread on the server at keep time — assigning
    // again here would only re-post it. The queue path never sent a thread: assign now.
    if (from === 'queue' && threadChoice.kind === 'thread') void assignThread(thought.id)
    if (pendingSay) {
      const said = pendingSay
      pendingSay = null
      void applyNaturalLanguageEdit(thought.id, said)
    }
    scheduleEcho(thought)
  }

  /* ————— the chosen thread (existing project assign endpoint) ————— */

  async function assignThread(thoughtId: string) {
    const choice = threadChoice
    if (choice.kind !== 'thread') return
    try {
      const res = await fetch('/api/timeline/projects/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          choice.entityId
            ? { thoughtId, projectEntityId: choice.entityId }
            : { thoughtId, projectLabel: choice.label },
        ),
        credentials: 'same-origin',
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: unknown }
        throw new Error(
          failureText(typeof payload.error === 'string' ? payload.error : null, res.status),
        )
      }
    } catch (e) {
      err = e instanceof Error && e.message ? e.message : failureText(null)
    }
  }

  /* ————— natural-language edits after storing (existing edit endpoint) ————— */

  async function applyNaturalLanguageEdit(thoughtId: string, editRequest: string) {
    err = null
    progressEvents = []
    try {
      const res = await fetch('/api/capture/edit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson, application/json',
        },
        body: JSON.stringify({ thoughtId, editRequest }),
        credentials: 'same-origin',
      })
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('application/x-ndjson')) {
        await consumeCaptureNdjsonStream<CaptureSubmitResult>(
          res,
          (event) => {
            progressEvents = [...progressEvents, { event, arrivedAt: Date.now() }]
          },
          undefined,
        )
        return
      }
      if (!res.ok) throw new Error(await res.text())
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
      logErrorToServer(err, 'capture_edit', e)
    } finally {
      progressEvents = []
    }
  }

  /* ————— mount: queue subscription + shortcuts (kept) ————— */

  onMount(() => {
    void reconcileQueueState(false)
    void fetchEnrichPendingSnapshot().catch(() => {
      // Best-effort: kick tier-2 worker for pending/stale rows after reload.
    })

    const unsub = subscribeCaptureQueue((message) => {
      if (message.type === 'snapshot') {
        applyQueueSnapshot(message)
        return
      }
      if (message.type === 'active') {
        suppressProcessingResyncUntil = 0
        processingCaptureId = message.id
        queueUi = applyCaptureQueueActive(queueUi, message.id)
        err = null
        return
      }
      if (
        message.type === 'progress' &&
        shouldAcceptCaptureProgress(
          {
            ...queueUi,
            activeCaptureId: processingCaptureId ?? queueUi.activeCaptureId,
          },
          message.id,
        )
      ) {
        if (processingCaptureId !== message.id) {
          processingCaptureId = message.id
        }
        progressEvents = [...progressEvents, { event: message.event, arrivedAt: Date.now() }]
        return
      }
      if (message.type === 'done') {
        progressEvents = []
        processingCaptureId = null
        suppressProcessingResyncUntil = Date.now() + CAPTURE_QUEUE_ACTIVATION_GUARD_MS
        queueUi = {
          ...queueUi,
          activeCaptureId: null,
          recentlyActivatedId: null,
        }
        handleCapturedThought(message.thought as CaptureSubmitResult, 'queue')
        void reconcileQueueState(false, { respectProcessingSuppress: true })
        return
      }
      if (message.type === 'failed') {
        captureEvent('capture_failed', { error_message: message.error })
        logErrorToServer(message.error, 'capture_ndjson')
        err = message.error
        progressEvents = []
        processingCaptureId = null
        suppressProcessingResyncUntil = Date.now() + CAPTURE_QUEUE_ACTIVATION_GUARD_MS
        queueUi = {
          ...queueUi,
          activeCaptureId: null,
          recentlyActivatedId: null,
        }
        void reconcileQueueState(false, { respectProcessingSuppress: true })
        return
      }
      if (message.type === 'idle') {
        void reconcileQueueState()
      }
    })

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (raw.trim()) void submitCapture()
        return
      }
      // start typing anywhere and you're capturing: a printable key focuses the writer
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
      ) {
        return
      }
      if (e.key.length === 1 && e.key !== ' ') fieldEl?.focus()
    }
    window.addEventListener('keydown', onKey)

    return () => {
      unsub()
      window.removeEventListener('keydown', onKey)
      if (echoTimer !== null) clearTimeout(echoTimer)
      clearReading()
    }
  })
</script>


<div
  class="mx-auto max-w-[720px] pt-[calc(var(--head)+23svh)] px-7 pb-[calc(var(--bottom-nav)+var(--glass-writer-height,64px)+40px)] max-[640px]:pt-[calc(var(--head)+12svh)] max-[640px]:px-[22px]"
>
  {#if captureBlocked}
    <div class="m-0 mb-7 rounded-[10px] bg-paper-2 p-4">
      <p class="m-0 mb-2 font-mesh text-sm text-ink">{m.capture_action()}</p>
      <CreditsTopUpPanel
        compact
        surface="capture_gate"
        availableCredits={localWalletCredits}
        paypalConfigured={data.paypalConfigured}
        paypalClientId={data.paypalClientId}
        paypalSdkUrl={data.paypalSdkUrl}
        onBalanceUpdated={(credits) => {
          localWalletCredits = credits
        }}
      />
    </div>
  {/if}

  <!-- Capture: one question, one gesture. Once a thought is in, the mesh answers in the
       question's place — the reading replaces the heading, so the app talks back. -->
  {#if readingShown}
    <CaptureReading
      waiting={readingWaiting && !reading}
      draft={reading}
      error={readingError}
      threadChoice={threadChoice}
      typeMenuOpen={typeMenuOpen}
      threadMenuOpen={threadMenuOpen || hashQuery !== null}
      newThreadLabel={newThreadLabel}
      projects={threadProjects}
      hashQuery={hashQuery}
      onTypeMenuChange={(open) => {
        typeMenuOpen = open
        if (open) void loadThreadProjects()
      }}
      onThreadMenuChange={(open) => {
        threadMenuOpen = open
        if (open) {
          void loadThreadProjects()
        } else if (hashQuery !== null) {
          hashQuery = null
        }
      }}
      onPickType={pickType}
      onPickThread={pickThread}
      onNewThreadLabel={(label) => {
        newThreadLabel = label
      }}
      onSay={onSay}
    />
  {:else}
    <h1
      class="m-0 font-you font-normal text-[clamp(32px,4.4vw,46px)] leading-[1.16] tracking-[-0.014em] text-ink max-[640px]:text-[29px]"
      data-testid="capture-heading"
    >
      {m.capture_placeholder()}
    </h1>
  {/if}

  {#if kept}
    <!-- the capture's process, as its own strip: it survives the next reading and the
         next words, and only the linked state fades (a failure stays until the next
         capture). Categorization, saving and indexing stay visible — never a flash. -->
    <div class="mt-8 max-w-[540px]" data-testid="capture-kept-strip">
      <CaptureKept {...kept} />
    </div>
  {/if}

  <div>
    {#if echo}
      <!-- an older thought this one rhymes with; it opens the thought page -->
      <a
        class="group block max-w-[540px] mt-[72px] text-left no-underline animate-[echo-settle_0.9s_var(--ease)_both] motion-reduce:[animation:none]"
        data-testid="capture-echo"
        href={thoughtHref(echo.thoughtId)}
      >
        <span
          class="flex items-center gap-2 font-mesh text-sm text-ink-3 before:content-[''] before:size-[5px] before:rounded-full before:bg-signal"
          >{m.capture_echo_label()}</span
        >
        <span
          class="block mt-2 pl-3.5 font-you text-[18px] leading-[1.45] text-ink-3 transition-colors duration-[400ms] ease-settle pointer-fine:group-hover:text-ink"
          >“{echo.text}”</span
        >
      </a>
    {/if}
  </div>


  <!-- the queue, as plain words: settling… / knitting it in… -->
  {#if queueActive || err}
    <div class="mt-12 flex flex-col gap-2">
      {#if pendingCount > 0 && !processingCaptureId}
        <span class="inline-flex items-center gap-2 font-mesh text-sm text-ink-3">
          <span class="inline-block animate-[breathe_2.2s_var(--ease-io)_infinite] motion-reduce:[animation:none]">{pendingCount} · {m.whisper_settling()}</span>
        </span>
      {/if}
      {#if processingCaptureId}
        <span class="inline-flex items-center gap-2 font-mesh text-sm text-ink-3 [&_.spinner]:size-4 [&_.spinner]:shrink-0">
          <MeshSpinner working size={16} />
          <span class="inline-block animate-[breathe_2.2s_var(--ease-io)_infinite] motion-reduce:[animation:none]">{m.whisper_knitting()}</span>
        </span>
      {/if}
      {#each visibleQueueItems as item (item.id)}
        <div class="flex items-center justify-between gap-3 py-1.5 border-b border-dashed border-ink-4">
          <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-you text-sm text-ink-2">{captureQueueItemPreview(item.raw)}</span>
          <button
            type="button"
            class="shrink-0 grid place-items-center size-7 border-0 rounded-full bg-transparent text-ink-3 pointer-fine:hover:text-ink pointer-fine:hover:bg-paper-2"
            aria-label={m.thought_forget()}
            onclick={() => void cancelQueuedItem(item.id)}
          >
            <svg
              class="size-3 fill-none stroke-current [stroke-width:1.3] [stroke-linecap:round]"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
            </svg>
          </button>
        </div>
        {#if item.status === 'failed' && item.lastError}
          <p class="m-0 font-mesh text-sm leading-[1.5] text-clay">{item.lastError}</p>
        {/if}
      {/each}
      {#if err}
        <p class="m-0 font-mesh text-sm leading-[1.5] text-clay" role="status">{err}</p>
      {/if}
    </div>
  {/if}
</div>

<GlassWriter
  bind:value={raw}
  bind:input={fieldEl}
  bind:voiceStop={voiceStopFn}
  placeholder={m.capture_writer_placeholder()}
  label={m.capture_placeholder()}
  submitLabel={m.capture_action()}
  submitDisabled={captureBlocked || submitting}
  spellcheck={false}
  inputTestId="capture-input"
  submitTestId="capture-submit"
  onsubmit={() => void submitCapture()}
  oninput={onFieldInput}
  onkeydown={onFieldKeydown}
  onvoicestart={() => {
    voiceBaseText = raw
  }}
  ontranscript={(text) => {
    raw = appendVoiceTranscript(voiceBaseText, text)
    onFieldInput()
  }}
  onpartialtranscript={(text) => {
    raw = appendVoiceTranscript(voiceBaseText, text)
    onFieldInput()
  }}
  onvoiceerror={(message) => {
    err = message
  }}
>
</GlassWriter>

{#if showFirstCaptureNudge}
  <FirstCaptureNudge
    open={true}
    userId={data.user.id}
    onDismiss={() => {
      firstCaptureNudgeDismissed = true
    }}
  />
{/if}

{#if showOnboarding}
  <CaptureOnboardingOverlay
    open={true}
    walletAvailableCredits={localWalletCredits}
    minCaptureCredits={data.minCaptureCredits}
    creditsGatePassed={data.creditsGatePassed || localWalletCredits >= data.minCaptureCredits}
    startingFreeCredits={data.startingFreeCredits}
  />
{/if}


