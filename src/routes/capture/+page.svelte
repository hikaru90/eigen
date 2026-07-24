<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import type { PageData } from './$types'
  import GroundingQuestionCard from '$lib/components/grounding-question-card.svelte'
  import CaptureOnboardingOverlay from '$lib/components/capture-onboarding-overlay.svelte'
  import FirstCaptureNudge from '$lib/components/first-capture-nudge.svelte'
  import CaptureConfirmationModal from '$lib/components/capture-confirmation-modal.svelte'
  import CreditsTopUpPanel from '$lib/components/credits-top-up-panel.svelte'
  import type { CapturePreviewBundle } from '$lib/capture/confirmation-types'
  import { isFirstCaptureNudgeDismissed } from '$lib/capture/first-capture-nudge'
  import { appendVoiceTranscript } from '$lib/capture/transcribe-audio'
  import { enhance } from '$app/forms'
  import CaptureQueueList from '$lib/components/capture-queue-list.svelte'
  import CaptureRecentThoughts from '$lib/components/capture-recent-thoughts.svelte'
  import CaptureAttachFileDialog from '$lib/components/capture-attach-file-dialog.svelte'
  import VoiceInputButton from '$lib/components/voice-input-button.svelte'
  import type { CaptureRecentThoughtSnippet } from '$lib/capture/capture-result-types'
  import {
    deleteCaptureThought,
    fetchCaptureResult,
    retryCaptureEnrich,
  } from '$lib/capture/capture-result-api'
  import { upsertRecentThoughtList } from '$lib/capture/upsert-recent-thought-list'
  import * as AlertDialog from '$lib/components/ui/alert-dialog'
  import * as Card from '$lib/components/ui/card'
  import { Button } from '$lib/components/ui/button'
  import { hapticConfirm } from '$lib/haptics'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Label } from '$lib/components/ui/label'
  import { CAPTURE_FAST_PIPELINE, CAPTURE_PIPELINE } from '$lib/capture/ingest-phases'
  import {
    consumeCaptureNdjsonStream,
    type ProgressEvent,
  } from '$lib/capture/consume-capture-ndjson'
  import {
    cancelCaptureQueueItem,
    getCaptureQueueSnapshot,
    subscribeCaptureQueue,
    type CaptureQueueItem,
    type CaptureSubmitResult,
  } from '$lib/capture/queue'
  import {
    applyCaptureQueueActive,
    applyCaptureQueueSnapshot,
    CAPTURE_QUEUE_ACTIVATION_GUARD_MS,
    initialCaptureQueueUiState,
    shouldAcceptCaptureProgress,
    type CaptureQueueUiState,
  } from '$lib/capture/queue/ui-state'
  import { pollUntilEnrichmentComplete } from '$lib/capture/poll-enrichment'
  import {
    pollCaptureRecentSync,
    fetchRecentCaptureMerge,
  } from '$lib/capture/poll-capture-recent-sync'
  import type { RecentCaptureMergeResult } from '$lib/capture/poll-capture-recent-sync'
  import { shouldRejectDestructiveRecentSync } from '$lib/capture/reject-destructive-recent-sync'
  import { fetchEnrichPendingSnapshot } from '$lib/graph/poll-graph-enrich-refresh'
  import { unlinkTextFileFromThought } from '$lib/text-files/api'
  import { pageInputDrafts } from '$lib/stores/page-input-drafts.svelte'
  import {
    getCurrentUserView,
    subscribeCurrentUserView,
  } from '$lib/stores/current-user-view.svelte'
  import {
    appendViewToSearchParams,
    viewToListApiParams,
    type CurrentUserView,
  } from '$lib/memory/current-user-view'
  import { shouldRefetchRecentForViewChange } from '$lib/capture/recent-view-sync'
  import { trackInsufficientCredits } from '$lib/analytics/billing-events'
  import { capture as captureEvent } from '$lib/analytics/posthog-client'
  import { logErrorToServer } from '$lib/client-log'

  let { data }: { data: PageData } = $props()

  const showOnboarding = $derived(!data.onboardingCompleted)
  const captureBlocked = $derived(!data.captureAllowed)

  function trackCaptureGateInsufficientCredits() {
    if (
      captureBlocked &&
      data.captureGateReason === 'insufficient_credits' &&
      data.billingMode === 'platform_credits'
    ) {
      trackInsufficientCredits({
        surface: 'capture_gate',
        phase: 'precheck',
        required_credits: data.minCaptureCredits,
        available_credits: data.walletAvailableCredits,
      })
    }
  }

  type CheckInQuestionPayload =
    | { kind: 'grounding'; facetKey: string; question: string }
    | {
        kind: 'relevance'
        thoughtId: string
        snippet: string
        question: string
      }
    | null
  let groundingQuestion = $state<CheckInQuestionPayload>(null)
  let groundingQuestionDismissed = $state(false)
  let groundingQuestionLoading = $state(false)
  /** True when this page load started with zero recent thoughts (first-capture nudge). */
  let startedWithEmptyRecent = $state(data.recentThoughts.length === 0)
  let firstCaptureNudgeDismissed = $state(false)
  let firstCaptureNudgeHydrated = $state(false)

  function shouldScrollToCheckIn(): boolean {
    const params = page.url.searchParams
    return (
      params.get('checkin') === '1' ||
      params.get('grounding') === '1' ||
      params.get('welcome') === '1'
    )
  }

  function shouldFetchCheckInQuestion(): boolean {
    return data.groundingQuestionEligible || shouldScrollToCheckIn()
  }

  async function fetchGroundingQuestion() {
    if (!shouldFetchCheckInQuestion() || groundingQuestionDismissed || groundingQuestionLoading) {
      return
    }
    groundingQuestionLoading = true
    try {
      const res = await fetch('/api/grounding/question', { cache: 'no-store' })
      if (!res.ok) return
      const payload = (await res.json()) as {
        question?: {
          kind?: 'grounding' | 'relevance'
          facetKey?: string
          thoughtId?: string
          snippet?: string
          question?: string
        } | null
      }
      const q = payload.question
      if (!q?.question) {
        groundingQuestion = null
        return
      }
      if (q.kind === 'relevance' && q.thoughtId && q.snippet) {
        groundingQuestion = {
          kind: 'relevance',
          thoughtId: q.thoughtId,
          snippet: q.snippet,
          question: q.question,
        }
      } else if (q.facetKey) {
        groundingQuestion = {
          kind: 'grounding',
          facetKey: q.facetKey,
          question: q.question,
        }
      } else {
        groundingQuestion = null
      }
      if (groundingQuestion && shouldScrollToCheckIn()) {
        queueMicrotask(() => {
          document.getElementById('grounding-question')?.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
          })
        })
      }
    } catch {
      // optional card — ignore fetch errors
    } finally {
      groundingQuestionLoading = false
    }
  }

  onMount(() => {
    trackCaptureGateInsufficientCredits()
    firstCaptureNudgeDismissed = isFirstCaptureNudgeDismissed(data.user.id)
    firstCaptureNudgeHydrated = true
    if (shouldFetchCheckInQuestion() && !groundingQuestionDismissed) {
      groundingQuestion = null
      void fetchGroundingQuestion()
    }
  })

  let localWalletCredits = $derived(data.walletAvailableCredits)

  const RECENT_THOUGHTS_LIMIT = 8

  let raw = $state(pageInputDrafts.capture)
  let editRequest = $state('')
  let voiceStopFn = $state<(() => void) | undefined>(undefined)
  /** Draft text present when the current recording started; transcripts append to it. */
  let voiceBaseText = ''
  let recentThoughts = $state<CaptureRecentThoughtSnippet[]>(data.recentThoughts)
  let thoughtDetails = $state<Record<string, CaptureSubmitResult>>(
    Object.fromEntries(data.recentThoughtDetails.map((thought) => [thought.id, thought])),
  )
  let recentFilter = $state<{ category?: string; memoryType?: string }>({})
  let dataView = $state<CurrentUserView>(getCurrentUserView())
  let hasAgentCaptures = $derived(
    Object.values(thoughtDetails).some((d) => d.author === 'agent') ||
      data.recentThoughtDetails.some((d) => d.author === 'agent'),
  )

  const showFirstCaptureNudge = $derived(
    firstCaptureNudgeHydrated &&
      startedWithEmptyRecent &&
      recentThoughts.length > 0 &&
      !firstCaptureNudgeDismissed &&
      !showOnboarding,
  )

  async function reloadRecentThoughts() {
    try {
      const params = new URLSearchParams()
      params.set('limit', String(RECENT_THOUGHTS_LIMIT))
      appendViewToSearchParams(params, dataView)
      if (recentFilter.category) params.set('category', recentFilter.category)
      if (recentFilter.memoryType) params.set('memoryType', recentFilter.memoryType)
      const res = await fetch(`/api/capture/recent?${params.toString()}`)
      if (!res.ok) return
      const payload = (await res.json()) as {
        recentThoughts: CaptureRecentThoughtSnippet[]
        recentThoughtDetails: CaptureSubmitResult[]
      }
      recentThoughts = payload.recentThoughts
      thoughtDetails = Object.fromEntries(
        payload.recentThoughtDetails.map((thought) => [thought.id, thought]),
      )
    } catch {
      // Transient errors — poll will retry.
    }
  }

  async function handleRecentFilterChange(filter: { category?: string; memoryType?: string }) {
    recentFilter = filter
    await reloadRecentThoughts()
  }

  let expandedThoughtId = $state<string | null>(null)
  let editingThoughtId = $state<string | null>(null)
  let err = $state<string | null>(null)

  const CAPTURE_CONFIRM_AUTO_ACCEPT_MS = 5_000

  type PendingConfirmation = {
    thoughtId: string
    rawText: string
    preview: CapturePreviewBundle
    deadlineMs: number
  }
  let pendingConfirmation = $state<PendingConfirmation | null>(null)
  let confirmationLoading = $state(false)
  let confirmationError = $state<string | null>(null)
  let confirmationCountdown = $state(5)
  let confirmCountdownTimer: ReturnType<typeof setInterval> | null = null
  let confirmAutoAcceptFired = false

  function clearConfirmCountdown() {
    if (confirmCountdownTimer !== null) {
      clearInterval(confirmCountdownTimer)
      confirmCountdownTimer = null
    }
  }

  function startConfirmCountdown() {
    clearConfirmCountdown()
    confirmAutoAcceptFired = false
    const deadlineMs = Date.now() + CAPTURE_CONFIRM_AUTO_ACCEPT_MS
    if (pendingConfirmation) {
      pendingConfirmation = { ...pendingConfirmation, deadlineMs }
    }
    confirmationCountdown = Math.ceil(CAPTURE_CONFIRM_AUTO_ACCEPT_MS / 1000)
    confirmCountdownTimer = setInterval(() => {
      const pending = pendingConfirmation
      if (!pending) {
        clearConfirmCountdown()
        return
      }
      const now = Date.now()
      confirmationCountdown = Math.max(0, Math.ceil((pending.deadlineMs - now) / 1000))
      if (now >= pending.deadlineMs && !confirmAutoAcceptFired) {
        confirmAutoAcceptFired = true
        clearConfirmCountdown()
        void confirmPendingCapture()
      }
    }, 250)
  }

  let queueUi = $state<CaptureQueueUiState>(initialCaptureQueueUiState())
  /** Mirrors in-flight capture id for progress matching (updated synchronously in queue handlers). */
  let processingCaptureId = $state<string | null>(null)
  let pendingCount = $derived(queueUi.pendingCount)
  let loading = $derived(processingCaptureId !== null || confirmationLoading)
  const queueActive = $derived(pendingCount > 0 || processingCaptureId !== null)
  const offline = $derived(typeof navigator !== 'undefined' && !navigator.onLine)

  let queueItems = $state<CaptureQueueItem[]>([])
  let progressEvents = $state<Array<{ event: ProgressEvent; arrivedAt: number }>>([])
  let captureStartMs = $state(0)
  /** Ignore stale snapshot processing ids briefly after done/failed (SW/tab race). */
  let suppressProcessingResyncUntil = $state(0)

  let editAbortController = $state<AbortController | null>(null)
  let editLoading = $state(false)
  let deletingThoughtId = $state<string | null>(null)
  let deleteDialogOpen = $state(false)
  let deleteTargetId = $state<string | null>(null)
  let retryingThoughtId = $state<string | null>(null)
  let loadingDetailId = $state<string | null>(null)
  let attachDialogOpen = $state(false)
  let attachTargetThoughtId = $state<string | null>(null)
  const enrichPollCancelByThoughtId = new Map<string, () => void>()
  let backgroundEnrichingIds = $state<string[]>([])
  const enrichingThoughtIds = $derived(new Set(backgroundEnrichingIds))

  function startBackgroundEnrichPoll(thoughtId: string) {
    enrichPollCancelByThoughtId.get(thoughtId)?.()
    backgroundEnrichingIds = [...new Set([...backgroundEnrichingIds, thoughtId])]
    const cancel = pollUntilEnrichmentComplete({
      thoughtId,
      onUpdate: (thought) => {
        upsertRecentThought(thought)
        if (thought.enrichmentComplete) {
          cancelEnrichPoll(thoughtId)
          // Do not invalidateAll() here: it remounts Capture and clears the composer
          // mid-typing / mid-e2e fill (pageInputDrafts is empty after the last submit).
          // Recent rows are already updated via upsertRecentThought; timeline loads fresh on navigate.
        }
      },
      onTimeout: () => {
        cancelEnrichPoll(thoughtId)
      },
    })
    enrichPollCancelByThoughtId.set(thoughtId, cancel)
  }

  function upsertRecentThought(thought: CaptureSubmitResult, options?: { pinToTop?: boolean }) {
    thoughtDetails = { ...thoughtDetails, [thought.id]: thought }
    recentThoughts = upsertRecentThoughtList(recentThoughts, thought, {
      pinToTop: options?.pinToTop,
      limit: RECENT_THOUGHTS_LIMIT,
    })
  }

  function cancelEnrichPoll(thoughtId: string) {
    enrichPollCancelByThoughtId.get(thoughtId)?.()
    enrichPollCancelByThoughtId.delete(thoughtId)
    backgroundEnrichingIds = backgroundEnrichingIds.filter((id) => id !== thoughtId)
  }

  function applyRecentCaptureSync(merged: RecentCaptureMergeResult) {
    if (shouldRejectDestructiveRecentSync(recentThoughts, thoughtDetails, merged.snippets)) {
      return
    }
    const expandedId = expandedThoughtId
    recentThoughts = merged.snippets
    thoughtDetails = merged.details
    if (expandedId && !merged.snippets.some((row) => row.id === expandedId)) {
      expandedThoughtId = null
    }
    for (const thoughtId of merged.newThoughtIds) {
      const thought = merged.details[thoughtId]
      if (thought && !thought.enrichmentComplete) {
        startBackgroundEnrichPoll(thoughtId)
      }
    }
  }

  async function refreshRecentCaptureFromServer() {
    try {
      const merged = await fetchRecentCaptureMerge({
        limit: RECENT_THOUGHTS_LIMIT,
        filter: { ...recentFilter, ...viewToListApiParams(dataView) },
        getState: () => ({ snippets: recentThoughts, details: thoughtDetails }),
      })
      applyRecentCaptureSync(merged)
    } catch {
      // Transient errors — poll will retry.
    }
  }

  function removeRecentThought(thoughtId: string) {
    cancelEnrichPoll(thoughtId)
    recentThoughts = recentThoughts.filter((row) => row.id !== thoughtId)
    const { [thoughtId]: _removed, ...rest } = thoughtDetails
    thoughtDetails = rest
    if (expandedThoughtId === thoughtId) expandedThoughtId = null
    if (editingThoughtId === thoughtId) {
      editingThoughtId = null
      editRequest = ''
    }
  }

  async function ensureThoughtDetail(thoughtId: string) {
    if (thoughtDetails[thoughtId]) return thoughtDetails[thoughtId]
    loadingDetailId = thoughtId
    try {
      const thought = await fetchCaptureResult(thoughtId)
      thoughtDetails = { ...thoughtDetails, [thoughtId]: thought }
      return thought
    } finally {
      if (loadingDetailId === thoughtId) loadingDetailId = null
    }
  }

  async function expandThought(thoughtId: string) {
    err = null
    expandedThoughtId = thoughtId
    try {
      await ensureThoughtDetail(thoughtId)
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
      logErrorToServer(err, 'capture_expand', e)
      if (expandedThoughtId === thoughtId) expandedThoughtId = null
    }
  }

  function collapseThought(thoughtId: string) {
    if (expandedThoughtId === thoughtId) expandedThoughtId = null
    if (editingThoughtId === thoughtId) {
      editingThoughtId = null
      editRequest = ''
    }
  }

  async function toggleThoughtEdit(thoughtId: string) {
    err = null
    if (editingThoughtId === thoughtId) {
      editingThoughtId = null
      editRequest = ''
      return
    }
    try {
      await ensureThoughtDetail(thoughtId)
      expandedThoughtId = thoughtId
      editingThoughtId = thoughtId
      editRequest = ''
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    }
  }

  function openDeleteDialog(thoughtId: string) {
    err = null
    deleteTargetId = thoughtId
    deleteDialogOpen = true
  }

  async function confirmDeleteThought() {
    if (!deleteTargetId) return
    const thoughtId = deleteTargetId
    err = null
    deletingThoughtId = thoughtId
    try {
      await deleteCaptureThought(thoughtId)
      captureEvent('thought_deleted', { thought_id: thoughtId })
      removeRecentThought(thoughtId)
      deleteDialogOpen = false
      deleteTargetId = null
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    } finally {
      if (deletingThoughtId === thoughtId) deletingThoughtId = null
    }
  }

  async function refreshThoughtDetail(thoughtId: string) {
    const thought = await fetchCaptureResult(thoughtId)
    thoughtDetails = { ...thoughtDetails, [thoughtId]: thought }
    return thought
  }

  function openAttachDialog(thoughtId: string) {
    err = null
    attachTargetThoughtId = thoughtId
    attachDialogOpen = true
  }

  async function unlinkAttachedFile(thoughtId: string, fileId: string) {
    err = null
    try {
      await unlinkTextFileFromThought(thoughtId, fileId)
      await refreshThoughtDetail(thoughtId)
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    }
  }

  async function retryEnrichThought(thoughtId: string) {
    err = null
    retryingThoughtId = thoughtId
    try {
      await retryCaptureEnrich(thoughtId)
      startBackgroundEnrichPoll(thoughtId)
      const thought = await fetchCaptureResult(thoughtId)
      upsertRecentThought(thought)
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    } finally {
      if (retryingThoughtId === thoughtId) retryingThoughtId = null
    }
  }

  function appendTranscript(current: string, transcript: string): string {
    const next = transcript.trim()
    if (!next) return current
    const base = current.trim()
    return base ? `${base} ${next}` : next
  }

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
    const mayResyncProcessing =
      !opts?.respectProcessingSuppress || Date.now() >= suppressProcessingResyncUntil
    if (mayResyncProcessing) {
      if (snapshot.processingId && snapshot.processingId !== processingCaptureId) {
        progressEvents = []
        captureStartMs = Date.now()
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

  function pushEvent(event: ProgressEvent) {
    progressEvents = [...progressEvents, { event, arrivedAt: Date.now() }]
  }

  onMount(() => {
    // Apply the active current-user view filter to the prefetched recent list.
    // Server load cannot read the client-side view selection (localStorage),
    // so prefetched data is unfiltered; this reload makes the displayed list
    // the single source of truth and prevents later invalidations from
    // clobbering a client-filtered list with unfiltered server defaults.
    void reloadRecentThoughts()
    void reconcileQueueState(false)
    void fetchEnrichPendingSnapshot().catch(() => {
      // Best-effort: kick tier-2 worker for pending/stale rows after reload.
    })
    for (const thought of Object.values(thoughtDetails)) {
      if (!thought.enrichmentComplete) {
        startBackgroundEnrichPoll(thought.id)
      }
    }

    const cancelRecentSync = pollCaptureRecentSync({
      limit: RECENT_THOUGHTS_LIMIT,
      getFilter: () => ({ ...recentFilter, ...viewToListApiParams(dataView) }),
      getState: () => ({ snippets: recentThoughts, details: thoughtDetails }),
      onSync: applyRecentCaptureSync,
    })

    const unsub = subscribeCaptureQueue((message) => {
      if (message.type === 'snapshot') {
        applyQueueSnapshot(message)
        return
      }
      if (message.type === 'active') {
        suppressProcessingResyncUntil = 0
        if (processingCaptureId !== message.id) {
          progressEvents = []
          captureStartMs = Date.now()
        }
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
        pushEvent(message.event)
        return
      }
      if (message.type === 'done') {
        captureEvent('capture_completed', {
          thought_id: message.thought.id,
          enrichment_complete: message.thought.enrichmentComplete,
        })
        upsertRecentThought(message.thought, { pinToTop: true })
        expandedThoughtId = message.thought.id
        editingThoughtId = null
        editRequest = ''
        progressEvents = []
        processingCaptureId = null
        suppressProcessingResyncUntil = Date.now() + CAPTURE_QUEUE_ACTIVATION_GUARD_MS
        queueUi = {
          ...queueUi,
          activeCaptureId: null,
          recentlyActivatedId: null,
        }
        if (!message.thought.enrichmentComplete) {
          startBackgroundEnrichPoll(message.thought.id)
        }
        if (shouldFetchCheckInQuestion() && !groundingQuestionDismissed && !groundingQuestion) {
          void fetchGroundingQuestion()
        }
        void refreshRecentCaptureFromServer()
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
        void refreshRecentCaptureFromServer()
        void reconcileQueueState()
      }
    })

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (raw.trim()) void capture()
      }
    }
    window.addEventListener('keydown', onKey)

    // Reload recent thoughts when the global current-user view changes.
    // The initial subscribe echo is skipped because mount already reloaded
    // with the active filter above.
    let previousView: CurrentUserView | null = null
    const unsubscribeView = subscribeCurrentUserView((view) => {
      const refetch = shouldRefetchRecentForViewChange(previousView, view)
      previousView = view
      dataView = view
      if (refetch) void reloadRecentThoughts()
    })

    return () => {
      cancelRecentSync()
      unsub()
      unsubscribeView()
      window.removeEventListener('keydown', onKey)
      clearConfirmCountdown()
      for (const cancel of enrichPollCancelByThoughtId.values()) cancel()
      enrichPollCancelByThoughtId.clear()
    }
  })

  function syncCaptureDraft(value: string) {
    raw = value
    pageInputDrafts.capture = value
  }

  async function capture() {
    if (!raw.trim() || confirmationLoading) return
    err = null
    confirmationError = null
    // Stop voice recording if active before submitting
    voiceStopFn?.()
    const text = raw
    syncCaptureDraft('')
    confirmationLoading = true
    captureEvent('capture_submitted', { text_length: text.length })
    try {
      const res = await fetch('/api/capture/interpret', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw: text }),
        credentials: 'same-origin',
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        throw new Error(payload.message ?? payload.error ?? `Interpret failed (${res.status})`)
      }
      const body = (await res.json()) as {
        thoughtId: string
        rawText: string
        preview: CapturePreviewBundle
        queueStatus: string
        status: 'ingested' | 'awaiting_confirmation'
      }
      captureEvent('capture_interpret_ready', { thought_id: body.thoughtId })

      const awaiting =
        body.status === 'awaiting_confirmation' || body.queueStatus === 'awaiting_confirmation'
      if (!awaiting) {
        const thought = await fetchCaptureResult(body.thoughtId)
        upsertRecentThought(thought, { pinToTop: true })
        expandedThoughtId = thought.id
        startBackgroundEnrichPoll(thought.id)
        void refreshRecentCaptureFromServer()
        return
      }

      pendingConfirmation = {
        thoughtId: body.thoughtId,
        rawText: body.rawText ?? text,
        preview: body.preview,
        deadlineMs: Date.now() + CAPTURE_CONFIRM_AUTO_ACCEPT_MS,
      }
      startConfirmCountdown()
    } catch (e) {
      syncCaptureDraft(text)
      err = e instanceof Error ? e.message : String(e)
    } finally {
      confirmationLoading = false
    }
  }

  async function confirmPendingCapture() {
    if (!pendingConfirmation || confirmationLoading) return
    clearConfirmCountdown()
    const current = pendingConfirmation
    confirmationLoading = true
    confirmationError = null
    err = null
    try {
      const res = await fetch('/api/capture/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ thoughtId: current.thoughtId }),
        credentials: 'same-origin',
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        throw new Error(payload.message ?? payload.error ?? `Confirm failed (${res.status})`)
      }
      pendingConfirmation = null
      captureEvent('capture_confirmed', { thought_id: current.thoughtId })
      const thought = await fetchCaptureResult(current.thoughtId)
      upsertRecentThought(thought, { pinToTop: true })
      expandedThoughtId = thought.id
      startBackgroundEnrichPoll(thought.id)
      void refreshRecentCaptureFromServer()
    } catch (e) {
      confirmationError = e instanceof Error ? e.message : String(e)
    } finally {
      confirmationLoading = false
    }
  }

  async function dismissPendingCaptureVerbatim() {
    if (!pendingConfirmation || confirmationLoading) return
    clearConfirmCountdown()
    const current = pendingConfirmation
    confirmationLoading = true
    confirmationError = null
    err = null
    try {
      const res = await fetch('/api/capture/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ thoughtId: current.thoughtId, verbatim: true }),
        credentials: 'same-origin',
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        throw new Error(payload.message ?? payload.error ?? `Confirm failed (${res.status})`)
      }
      pendingConfirmation = null
      captureEvent('capture_dismissed_verbatim', { thought_id: current.thoughtId })
      const thought = await fetchCaptureResult(current.thoughtId)
      upsertRecentThought(thought, { pinToTop: true })
      expandedThoughtId = thought.id
      startBackgroundEnrichPoll(thought.id)
      void refreshRecentCaptureFromServer()
    } catch (e) {
      confirmationError = e instanceof Error ? e.message : String(e)
    } finally {
      confirmationLoading = false
    }
  }

  async function submitEditRequest() {
    if (!editingThoughtId) return
    const thoughtId = editingThoughtId
    captureEvent('thought_edit_submitted', {
      thought_id: thoughtId,
      request_length: editRequest.length,
    })
    err = null
    progressEvents = []
    editLoading = true
    const ac = new AbortController()
    editAbortController = ac
    try {
      const res = await fetch('/api/capture/edit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson, application/json',
        },
        body: JSON.stringify({ thoughtId, editRequest }),
        signal: ac.signal,
      })
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('application/x-ndjson')) {
        const thought = await consumeCaptureNdjsonStream<CaptureSubmitResult>(
          res,
          pushEvent,
          ac.signal,
        )
        upsertRecentThought(thought)
        editingThoughtId = null
        editRequest = ''
        return
      }
      if (!res.ok) throw new Error(await res.text())
      const j = (await res.json()) as { thought: CaptureSubmitResult }
      upsertRecentThought(j.thought)
      editingThoughtId = null
      editRequest = ''
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      err = e instanceof Error ? e.message : String(e)
      logErrorToServer(err, 'capture_edit', e)
    } finally {
      editLoading = false
      progressEvents = []
      editAbortController = null
    }
  }
</script>

<div class="fixed inset-x-0 top-20 bottom-0 z-0 mx-auto flex max-w-xl flex-col overflow-hidden">
  <div class="relative z-10 shrink-0 space-y-4 bg-background px-5">
    {#if groundingQuestion && !groundingQuestionDismissed}
      {#if groundingQuestion.kind === 'relevance'}
        <GroundingQuestionCard
          kind="relevance"
          thoughtId={groundingQuestion.thoughtId}
          snippet={groundingQuestion.snippet}
          question={groundingQuestion.question}
          onDismiss={() => {
            groundingQuestionDismissed = true
            groundingQuestion = null
          }}
          onSaved={() => {
            groundingQuestionDismissed = true
            groundingQuestion = null
          }}
        />
      {:else}
        <GroundingQuestionCard
          kind="grounding"
          facetKey={groundingQuestion.facetKey}
          question={groundingQuestion.question}
          onDismiss={() => {
            groundingQuestionDismissed = true
            groundingQuestion = null
          }}
          onSaved={() => {
            groundingQuestionDismissed = true
            groundingQuestion = null
          }}
        />
      {/if}
    {/if}
    {#if captureBlocked}
      <Card.Root class="shrink-0 border-2 border-black dark:border-border">
        <Card.Header>
          <Card.Title class="text-sm">Before your first capture</Card.Title>
        </Card.Header>
        <Card.Content class="space-y-3 text-xs">
          {#if data.captureGateReason === 'insufficient_credits' && data.billingMode === 'platform_credits'}
            <p class="text-muted-foreground leading-relaxed">
              Your free credits are used up. Add Eigen credits to run capture and enrichment
              (minimum
              {data.minCaptureCredits.toLocaleString()} credits per capture).
            </p>
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
          {/if}
        </Card.Content>
      </Card.Root>
    {/if}

    <Card.Root
      class="shrink-0 bg-white dark:bg-card border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none p-0 gap-0 items-start overflow-visible"
    >
      <Card.Content class="p-0 w-full">
        <Label for="thought" class="sr-only">Thought</Label>
        <Textarea
          id="thought"
          bind:value={raw}
          oninput={() => {
            pageInputDrafts.capture = raw
          }}
          placeholder="Enter your thought…"
          class="min-h-[128px] max-h-[min(45dvh,360px)] overflow-y-auto p-6 text-base md:text-base placeholder:text-muted-foreground border-0 bg-transparent dark:bg-transparent shadow-none focus-visible:ring-0 resize-none text-foreground"
          onfocus={() => voiceStopFn?.()}
        />
      </Card.Content>
      <Card.Footer
        class="bg-[#FAFAFA] dark:bg-muted border-t-2 border-black dark:border-border p-4 flex flex-row items-center justify-between w-full"
      >
        <span class="text-[#737373] text-xs leading-4">⌘ / Ctrl + Enter to capture</span>
        <div class="flex items-center gap-2">
          <VoiceInputButton
            language={data.preferredLanguage}
            disabled={loading}
            bind:stopRef={voiceStopFn}
            onstart={() => {
              voiceBaseText = raw
            }}
            ontranscript={(text) => {
              syncCaptureDraft(appendVoiceTranscript(voiceBaseText, text))
            }}
            onpartialtranscript={(text) => {
              syncCaptureDraft(appendVoiceTranscript(voiceBaseText, text))
            }}
            onerror={(message) => {
              err = message
            }}
          />
          <Button
            type="button"
            class="bg-black text-white rounded-none px-[22px] py-[7.5px] text-base font-medium leading-6 h-auto border-0 hover:bg-black/90"
            disabled={!raw.trim() || captureBlocked || loading}
            onclick={() => {
              hapticConfirm()
              void capture()
            }}
          >
            Capture
          </Button>
        </div>
      </Card.Footer>
    </Card.Root>

    {#if pendingConfirmation}
      <CaptureConfirmationModal
        open={true}
        thoughtId={pendingConfirmation.thoughtId}
        rawText={pendingConfirmation.rawText}
        preview={pendingConfirmation.preview}
        countdownSeconds={confirmationCountdown}
        loading={confirmationLoading}
        error={confirmationError}
        onConfirm={() => void confirmPendingCapture()}
        onDismiss={() => void dismissPendingCaptureVerbatim()}
      />
    {/if}

    {#if showFirstCaptureNudge}
      <FirstCaptureNudge
        open={true}
        userId={data.user.id}
        onDismiss={() => {
          firstCaptureNudgeDismissed = true
        }}
      />
    {/if}
  </div>

  <div class="relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden px-5 pt-6 pb-20">
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CaptureRecentThoughts
        thoughts={recentThoughts}
        {thoughtDetails}
        {enrichingThoughtIds}
        expandedId={expandedThoughtId}
        editingId={editingThoughtId}
        {editRequest}
        {editLoading}
        deletingId={deletingThoughtId}
        retryingId={retryingThoughtId}
        {loadingDetailId}
        editProgressEvents={progressEvents.map((row) => row.event)}
        pipeline={CAPTURE_PIPELINE}
        onExpand={expandThought}
        onCollapse={collapseThought}
        onEdit={(id) => void toggleThoughtEdit(id)}
        onDelete={openDeleteDialog}
        onAttach={openAttachDialog}
        onUnlinkFile={(thoughtId, fileId) => void unlinkAttachedFile(thoughtId, fileId)}
        onNoteUpdated={(thoughtId) => refreshThoughtDetail(thoughtId)}
        onRetry={(id) => void retryEnrichThought(id)}
        onEditRequestChange={(value) => {
          editRequest = value
        }}
        onSubmitEdit={submitEditRequest}
        onCancelEdit={() => editAbortController?.abort()}
        onFilterChange={handleRecentFilterChange}
        {hasAgentCaptures}
      />
    </div>

    {#if queueActive}
      <div class="shrink-0 space-y-2">
        <CaptureQueueList
          items={queueItems}
          processingId={processingCaptureId}
          events={progressEvents}
          pipeline={CAPTURE_FAST_PIPELINE}
          startMs={captureStartMs}
          oncancel={(id) => void cancelQueuedItem(id)}
        />
        {#if offline && pendingCount > 0 && !loading}
          <p class="text-xs text-muted-foreground">Offline — queue will resume when connected</p>
        {/if}
      </div>
    {/if}

    {#if err}
      <p class="shrink-0 text-destructive text-sm">{err}</p>
    {/if}
  </div>
</div>

{#if showOnboarding}
  <CaptureOnboardingOverlay
    open={true}
    walletAvailableCredits={localWalletCredits}
    minCaptureCredits={data.minCaptureCredits}
    creditsGatePassed={data.creditsGatePassed || localWalletCredits >= data.minCaptureCredits}
    startingFreeCredits={data.startingFreeCredits}
  />
{/if}

<AlertDialog.Root
  bind:open={deleteDialogOpen}
  onOpenChange={(open) => {
    if (!open && !deletingThoughtId) deleteTargetId = null
  }}
>
  <AlertDialog.Content class="max-w-sm rounded-none border-2 border-black dark:border-border">
    <AlertDialog.Header>
      <AlertDialog.Title>Delete this thought?</AlertDialog.Title>
      <AlertDialog.Description>
        It will be removed from search and the graph permanently. This cannot be undone.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel class="rounded-none" disabled={deletingThoughtId !== null}>
        Cancel
      </AlertDialog.Cancel>
      <Button
        type="button"
        variant="destructive"
        class="rounded-none"
        disabled={deletingThoughtId !== null}
        onclick={() => void confirmDeleteThought()}
      >
        {deletingThoughtId ? 'Deleting…' : 'Delete'}
      </Button>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

{#if attachDialogOpen && attachTargetThoughtId}
  <CaptureAttachFileDialog
    thoughtId={attachTargetThoughtId}
    onClose={() => {
      attachDialogOpen = false
    }}
    onLinked={async () => {
      if (!attachTargetThoughtId) return
      await refreshThoughtDetail(attachTargetThoughtId)
    }}
  />
{/if}
