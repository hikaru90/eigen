<script lang="ts">
  import XIcon from '@lucide/svelte/icons/x'
  import { Button } from '$lib/components/ui/button'
  import { Textarea } from '$lib/components/ui/textarea'

  let {
    kind = 'grounding',
    facetKey,
    question,
    thoughtId,
    snippet: _snippet,
    cardId = 'grounding-question',
    onDismiss,
    onSaved,
  }: {
    kind?: 'grounding' | 'relevance'
    facetKey?: string
    question: string
    thoughtId?: string
    snippet?: string
    cardId?: string
    onDismiss?: () => void
    onSaved?: () => void
  } = $props()

  let answer = $state('')
  let loading = $state(false)
  let saved = $state(false)
  let savedLabel = $state('Saved — thanks.')
  let err = $state<string | null>(null)

  const isRelevance = $derived(kind === 'relevance')

  async function submitGroundingAnswer() {
    const trimmed = answer.trim()
    if (!trimmed || loading || saved) return
    loading = true
    err = null
    try {
      const res = await fetch('/api/grounding/question', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'grounding', facetKey, answer: trimmed }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
        throw new Error(payload.message ?? payload.error ?? 'Failed to save answer')
      }
      saved = true
      savedLabel = 'Saved — thanks.'
      await new Promise((resolve) => setTimeout(resolve, 1200))
      onSaved?.()
    } catch (e) {
      err = e instanceof Error ? e.message : 'Failed to save answer'
    } finally {
      loading = false
    }
  }

  async function submitRelevanceAction(action: 'keep' | 'archive') {
    if (!thoughtId || loading || saved) return
    loading = true
    err = null
    try {
      const res = await fetch('/api/grounding/question', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'relevance', thoughtId, action }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
        throw new Error(payload.message ?? payload.error ?? 'Failed to save answer')
      }
      saved = true
      savedLabel =
        action === 'keep'
          ? 'Kept — we’ll treat it as still important.'
          : 'Archived — hidden from search and the graph.'
      await new Promise((resolve) => setTimeout(resolve, 1200))
      onSaved?.()
    } catch (e) {
      err = e instanceof Error ? e.message : 'Failed to save answer'
    } finally {
      loading = false
    }
  }

  async function dismiss() {
    if (loading) return
    loading = true
    err = null
    try {
      await fetch('/api/grounding/question', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dismiss: true }),
      })
      onDismiss?.()
    } catch (e) {
      err = e instanceof Error ? e.message : 'Failed to dismiss'
    } finally {
      loading = false
    }
  }
</script>

<div
  id={cardId}
  class="flex shrink-0 flex-col gap-3 overflow-visible bg-white p-4 brightness-105 dark:bg-card"
>
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0 space-y-2">
      <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {isRelevance ? 'Memory check-in' : 'Improve capture and answer quality'}
      </p>
      <p class="text-base leading-relaxed text-foreground">{question}</p>
    </div>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      class="size-8 shrink-0 text-black hover:text-black/70 dark:text-foreground dark:hover:text-foreground/70"
      disabled={loading}
      onclick={dismiss}
      aria-label="Dismiss question"
    >
      <XIcon class="size-4" />
    </Button>
  </div>

  {#if saved}
    <p class="text-muted-foreground text-sm">{savedLabel}</p>
  {:else if isRelevance}
    {#if err}
      <p class="text-destructive text-sm">{err}</p>
    {/if}
    <div class="flex flex-wrap justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="text-sm"
        disabled={loading}
        onclick={dismiss}
      >
        Not now
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="text-sm"
        disabled={loading}
        onclick={() => submitRelevanceAction('archive')}
      >
        {loading ? 'Saving…' : 'Not anymore'}
      </Button>
      <Button
        type="button"
        size="sm"
        class="text-sm"
        disabled={loading}
        onclick={() => submitRelevanceAction('keep')}
      >
        {loading ? 'Saving…' : 'Still relevant'}
      </Button>
    </div>
  {:else}
    <Textarea
      bind:value={answer}
      placeholder="Your answer…"
      class="min-h-[80px] resize-none rounded-md border border-border bg-[#FAFAFA] p-3 text-base leading-relaxed dark:bg-muted/40"
      disabled={loading}
    />
    {#if err}
      <p class="text-destructive text-sm">{err}</p>
    {/if}
    <div class="flex justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="text-sm"
        disabled={loading}
        onclick={dismiss}
      >
        Not now
      </Button>
      <Button
        type="button"
        size="sm"
        class="text-sm"
        disabled={!answer.trim() || loading}
        onclick={submitGroundingAnswer}
      >
        {loading ? 'Saving…' : 'Save'}
      </Button>
    </div>
  {/if}
</div>
