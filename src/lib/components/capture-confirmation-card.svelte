<script lang="ts">
  import type { CapturePreviewBundle } from '$lib/capture/confirmation-types'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Label } from '$lib/components/ui/label'
  import { Textarea } from '$lib/components/ui/textarea'

  interface Props {
    thoughtId: string
    rawText: string
    preview: CapturePreviewBundle
    loading?: boolean
    error?: string | null
    onConfirm: () => void
    onCorrect: (correction: string) => void
    onDismiss?: () => void
  }

  let {
    thoughtId,
    rawText,
    preview,
    loading = false,
    error = null,
    onConfirm,
    onCorrect,
    onDismiss,
  }: Props = $props()

  let correction = $state('')

  const categoryPercent = $derived(Math.round(preview.category.confidence * 100))
  const truncatedRaw = $derived(
    rawText.length > 160 ? `${rawText.slice(0, 157).trimEnd()}…` : rawText,
  )
  const canSubmitCorrection = $derived(correction.trim().length > 0 && !loading)

  function submitCorrection() {
    const trimmed = correction.trim()
    if (!trimmed || loading) return
    onCorrect(trimmed)
    correction = ''
  }

  function confirm() {
    if (loading) return
    onConfirm()
  }

  function dismiss() {
    if (loading || !onDismiss) return
    onDismiss()
  }
</script>

<Card.Root
  data-testid="capture-confirmation-card"
  data-thought-id={thoughtId}
  class="bg-white dark:bg-card border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none p-4 gap-3 items-start overflow-visible"
>
  <Card.Header class="p-0 w-full space-y-1">
    <Card.Title class="text-sm">Does this look right?</Card.Title>
  </Card.Header>

  <Card.Content class="p-0 w-full space-y-3 text-sm">
    <p class="text-card-foreground whitespace-pre-wrap">{preview.interpretedText}</p>

    <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>
        Category:
        <span class="font-medium text-foreground">{preview.category.key}</span>
        <span class="ml-1">({categoryPercent}%)</span>
      </span>
      {#if preview.memoryType}
        <span>
          Memory type:
          <span class="font-medium text-foreground">{preview.memoryType}</span>
        </span>
      {/if}
    </div>

    {#if preview.entities.length > 0}
      <ul class="flex flex-wrap gap-1.5 text-xs">
        {#each preview.entities as entity, i (`${entity.surface}-${entity.entityType}-${i}`)}
          <li class="rounded-sm border border-border px-1.5 py-0.5 text-muted-foreground">
            <span class="font-medium text-foreground">{entity.surface}</span>
            <span class="opacity-70">({entity.entityType})</span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if truncatedRaw}
      <p class="text-muted-foreground text-xs truncate" title={rawText}>
        You said: {truncatedRaw}
      </p>
    {/if}

    <div class="space-y-2">
      <Label for="capture-correction" class="text-xs text-muted-foreground">
        Describe what to change
      </Label>
      <Textarea
        id="capture-correction"
        bind:value={correction}
        placeholder="Example: Change the city to Porto"
        class="min-h-[72px] resize-none rounded-md border border-border bg-[#FAFAFA] p-3 text-sm leading-relaxed dark:bg-muted/40"
        disabled={loading}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="rounded-[4px] text-xs"
        disabled={!canSubmitCorrection}
        onclick={submitCorrection}
      >
        Update preview
      </Button>
    </div>

    {#if error}
      <p class="text-destructive text-sm">{error}</p>
    {/if}
  </Card.Content>

  <Card.Footer class="p-0 w-full flex flex-wrap items-center gap-2">
    <Button
      type="button"
      size="sm"
      class="rounded-[4px] text-xs"
      disabled={loading}
      onclick={confirm}
    >
      {loading ? 'Working…' : 'Confirm'}
    </Button>
    {#if onDismiss}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="rounded-[4px] text-xs text-muted-foreground"
        disabled={loading}
        onclick={dismiss}
      >
        Dismiss
      </Button>
    {/if}
  </Card.Footer>
</Card.Root>
