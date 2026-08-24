<script lang="ts">
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import SparklesIcon from '@lucide/svelte/icons/sparkles'
  import { Button } from '$lib/components/ui/button'
  import { Checkbox } from '$lib/components/ui/checkbox'
  import * as Dialog from '$lib/components/ui/dialog'
  import type {
    ApplyProjectReviewResponse,
    ProjectReviewSuggestion,
    ReviewProjectResponse,
  } from '$lib/memory/project-review-types'
  import { m } from '$lib/paraglide/messages.js'

  type Props = {
    open: boolean
    projectEntityId: string
    review: ReviewProjectResponse | null
    onClose: () => void
    onApplied: (result: ApplyProjectReviewResponse) => void
  }

  let {
    open = $bindable(false),
    projectEntityId,
    review,
    onClose,
    onApplied,
  }: Props = $props()

  let busy = $state(false)
  let error = $state<string | null>(null)
  let deadlineChecked = $state(true)
  // Parent remounts this dialog per open; missing keys default to checked via `!== false`.
  let taskChecked = $state<Record<string, boolean>>({})
  let newTaskChecked = $state<boolean[]>([])

  function suggestionLabel(suggestion: ProjectReviewSuggestion): string {
    if (suggestion === 'mark_done') return m.graph_timeline_project_review_suggestion_mark_done()
    if (suggestion === 'archive') return m.graph_timeline_project_review_suggestion_archive()
    return m.graph_timeline_project_review_suggestion_keep()
  }

  function taskSummary(thoughtId: string): string {
    const task = review?.tasks.find((t) => t.thoughtId === thoughtId)
    return task?.summary ?? thoughtId
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString()
  }

  function isEmptyReview(payload: ReviewProjectResponse): boolean {
    const r = payload.review
    const hasNonKeep = r.taskReviews.some((t) => t.suggestion !== 'keep')
    const hasNew = r.newTaskSuggestions.length > 0
    const hasDeadline = r.projectDeadline != null
    const currentOrder = payload.tasks.map((t) => t.thoughtId)
    const orderMatches =
      r.order.length === currentOrder.length && r.order.every((id, i) => id === currentOrder[i])
    return !hasNonKeep && !hasNew && !hasDeadline && orderMatches
  }

  function nextActionLabel(): string | null {
    if (!review) return null
    const r = review.review
    if (r.nextActionThoughtId) {
      return taskSummary(r.nextActionThoughtId)
    }
    if (r.nextActionIsNewTaskIndex != null) {
      const suggestion = r.newTaskSuggestions[r.nextActionIsNewTaskIndex]
      return suggestion?.summary ?? null
    }
    return null
  }

  async function applySelected() {
    if (!review || busy) return
    busy = true
    error = null
    try {
      const markDone: string[] = []
      const archive: string[] = []
      const deadlines: Array<{ thoughtId: string; targetDate: string }> = []

      for (const tr of review.review.taskReviews) {
        const checked = taskChecked[tr.thoughtId] !== false
        if (!checked) continue
        if (tr.suggestion === 'mark_done') markDone.push(tr.thoughtId)
        if (tr.suggestion === 'archive') archive.push(tr.thoughtId)
        if (tr.deadline) {
          deadlines.push({ thoughtId: tr.thoughtId, targetDate: tr.deadline })
        }
      }

      const removed = new Set([...markDone, ...archive])
      const order = review.review.order.filter((id) => !removed.has(id))

      const newTasks = review.review.newTaskSuggestions
        .filter((_, i) => newTaskChecked[i] !== false)
        .map((t) => ({
          summary: t.summary,
          kind: t.kind,
          suggestedStartAt: t.suggestedStartAt,
          suggestedEndAt: t.suggestedEndAt,
        }))

      let nextActionThoughtId: string | null = null
      let nextActionNewTaskIndex: number | null = null
      if (review.review.nextActionThoughtId) {
        if (!removed.has(review.review.nextActionThoughtId)) {
          nextActionThoughtId = review.review.nextActionThoughtId
        }
      } else if (review.review.nextActionIsNewTaskIndex != null) {
        const originalIndex = review.review.nextActionIsNewTaskIndex
        if (newTaskChecked[originalIndex] !== false) {
          let acceptedIndex = 0
          for (let i = 0; i < originalIndex; i++) {
            if (newTaskChecked[i] !== false) acceptedIndex++
          }
          nextActionNewTaskIndex = acceptedIndex
        }
      }

      const body: Record<string, unknown> = {
        markDone,
        archive,
        deadlines,
        order,
        newTasks,
        nextActionThoughtId,
        nextActionNewTaskIndex,
        allowedThoughtIds: review.allowedThoughtIds,
      }
      if (review.review.projectDeadline != null && deadlineChecked) {
        body.projectDeadline = review.review.projectDeadline
      }

      const res = await fetch(`/api/timeline/projects/${projectEntityId}/review/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Request failed (${res.status})`)
      }
      const result = (await res.json()) as ApplyProjectReviewResponse
      onApplied(result)
      open = false
      onClose()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  function onDialogOpenChange(next: boolean) {
    open = next
    if (!next) onClose()
  }

  const nextActionText = $derived.by(() => nextActionLabel())
  const showEmpty = $derived(review ? isEmptyReview(review) : false)
</script>

<Dialog.Root {open} onOpenChange={onDialogOpenChange}>
  <Dialog.Content
    data-testid="project-review-dialog"
    class="fixed inset-x-0 bottom-0 top-auto flex max-h-[min(85vh,36rem)] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-xl border p-0 shadow-lg sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[min(90vh,40rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-0"
  >
    <div class="border-border shrink-0 border-b px-4 py-3">
      <Dialog.Title class="flex items-center gap-2 text-base font-semibold">
        <SparklesIcon class="text-muted-foreground size-4" aria-hidden="true" />
        {m.graph_timeline_project_review_title()}
      </Dialog.Title>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      {#if review}
        {#if showEmpty}
          <p class="text-muted-foreground text-xs">{m.graph_timeline_project_review_empty()}</p>
        {:else}
          {#if review.review.projectDeadline}
            <section class="space-y-2">
              <h3 class="text-xs font-semibold">
                {m.graph_timeline_project_review_section_deadline()}
              </h3>
              <label class="flex items-start gap-2 text-xs">
                <Checkbox
                  checked={deadlineChecked}
                  onCheckedChange={(v) => {
                    deadlineChecked = v === true
                  }}
                  disabled={busy}
                  class="mt-0.5"
                />
                <span>{formatDate(review.review.projectDeadline)}</span>
              </label>
            </section>
          {/if}

          {#if review.review.taskReviews.length > 0}
            <section class="space-y-2">
              <h3 class="text-xs font-semibold">
                {m.graph_timeline_project_review_section_tasks()}
              </h3>
              <ul class="space-y-3">
                {#each review.review.taskReviews as tr (tr.thoughtId)}
                  <li class="flex items-start gap-2 text-xs">
                    <Checkbox
                      checked={taskChecked[tr.thoughtId] !== false}
                      onCheckedChange={(v) => {
                        taskChecked = { ...taskChecked, [tr.thoughtId]: v === true }
                      }}
                      disabled={busy}
                      class="mt-0.5"
                    />
                    <div class="min-w-0 flex-1 space-y-0.5">
                      <p class="font-medium">{taskSummary(tr.thoughtId)}</p>
                      <p class="text-muted-foreground">{suggestionLabel(tr.suggestion)}</p>
                      {#if tr.deadline}
                        <p class="text-muted-foreground">
                          {m.graph_timeline_project_review_suggested_deadline()}: {formatDate(
                            tr.deadline,
                          )}
                        </p>
                      {/if}
                      {#if tr.reason}
                        <p class="text-muted-foreground">{tr.reason}</p>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}

          {#if review.review.newTaskSuggestions.length > 0}
            <section class="space-y-2">
              <h3 class="text-xs font-semibold">
                {m.graph_timeline_project_review_section_new_tasks()}
              </h3>
              <ul class="space-y-3">
                {#each review.review.newTaskSuggestions as suggestion, index (index)}
                  <li
                    class="flex items-start gap-2 text-xs"
                    data-testid="project-review-new-task-{index}"
                  >
                    <Checkbox
                      checked={newTaskChecked[index] !== false}
                      onCheckedChange={(v) => {
                        const next = [...newTaskChecked]
                        next[index] = v === true
                        newTaskChecked = next
                      }}
                      disabled={busy}
                      class="mt-0.5"
                    />
                    <div class="min-w-0 flex-1 space-y-0.5">
                      <p class="font-medium">{suggestion.summary}</p>
                      {#if suggestion.reason}
                        <p class="text-muted-foreground">{suggestion.reason}</p>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}
        {/if}

        {#if nextActionText}
          <section class="space-y-1">
            <h3 class="text-xs font-semibold">
              {m.graph_timeline_project_review_section_next_action()}
            </h3>
            <p class="text-xs">{nextActionText}</p>
          </section>
        {/if}
      {/if}

      {#if error}
        <p class="text-destructive text-xs">{error}</p>
      {/if}

      <div class="mt-auto flex gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          class="h-9 flex-1 text-xs"
          disabled={busy}
          onclick={() => onDialogOpenChange(false)}
        >
          {m.graph_timeline_project_review_cancel()}
        </Button>
        <Button
          type="button"
          class="h-9 flex-1 text-xs"
          disabled={busy || !review}
          onclick={() => void applySelected()}
        >
          {#if busy}
            <LoaderCircleIcon class="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
            {m.graph_timeline_project_review_applying()}
          {:else}
            {m.graph_timeline_project_review_apply()}
          {/if}
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
