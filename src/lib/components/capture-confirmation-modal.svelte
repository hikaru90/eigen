<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog'
  import { Button } from '$lib/components/ui/button'
  import type { CapturePreviewBundle } from '$lib/capture/confirmation-types'

  interface Props {
    open: boolean
    thoughtId: string
    rawText: string
    preview: CapturePreviewBundle
    countdownSeconds: number
    loading?: boolean
    error?: string | null
    onConfirm: () => void
    onDismiss: () => void
  }

  let {
    open,
    thoughtId,
    rawText,
    preview,
    countdownSeconds,
    loading = false,
    error = null,
    onConfirm,
    onDismiss,
  }: Props = $props()

  const categoryPercent = $derived(Math.round(preview.category.confidence * 100))

  const countdownLabel = $derived(
    countdownSeconds > 0 ? `Auto-accepting in ${countdownSeconds}s…` : 'Auto-accepting…',
  )

  let settled = false

  function handleOpenChange(next: boolean) {
    if (next) return
    if (loading || settled) return
    settled = true
    onDismiss()
  }

  function confirm() {
    if (loading || settled) return
    settled = true
    onConfirm()
  }

  function dismiss() {
    if (loading || settled) return
    settled = true
    onDismiss()
  }
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
  <Dialog.Content
    data-testid="capture-confirmation-modal"
    data-thought-id={thoughtId}
    class="rounded-none border-2 border-black dark:border-border max-w-lg"
  >
    <Dialog.Header>
      <Dialog.Title>Confirm how this is stored</Dialog.Title>
    </Dialog.Header>

    <div class="space-y-3 text-sm">
      <div class="space-y-1">
        <p class="text-xs text-muted-foreground">You said:</p>
        <p class="whitespace-pre-wrap text-muted-foreground">{rawText}</p>
      </div>

      <div class="space-y-1">
        <p class="text-xs text-muted-foreground">Will store as:</p>
        <p class="whitespace-pre-wrap text-foreground">{preview.interpretedText}</p>
      </div>

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

      <p class="text-xs text-muted-foreground" data-testid="capture-confirmation-countdown">
        {countdownLabel}
      </p>

      {#if error}
        <p class="text-destructive text-sm">{error}</p>
      {/if}
    </div>

    <Dialog.Footer class="flex flex-wrap items-center gap-2 sm:justify-start">
      <Button type="button" class="rounded-none" disabled={loading} onclick={confirm}>
        {loading ? 'Working…' : 'Confirm'}
      </Button>
      <Button
        type="button"
        variant="outline"
        class="rounded-none"
        disabled={loading}
        onclick={dismiss}
      >
        Dismiss
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
