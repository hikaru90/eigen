<script lang="ts">
  import { onMount } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { capture } from '$lib/analytics/posthog-client'
  import { firstCaptureNudgeDismissKey } from '$lib/capture/first-capture-nudge'

  let {
    open,
    userId,
    onDismiss,
  }: {
    open: boolean
    userId: string
    onDismiss: () => void
  } = $props()

  let trackedShown = $state(false)

  function trackShownIfOpen() {
    if (!open || trackedShown) return
    trackedShown = true
    capture('first_capture_nudge_shown', {})
  }

  onMount(() => {
    trackShownIfOpen()
  })

  function dismiss() {
    try {
      localStorage.setItem(firstCaptureNudgeDismissKey(userId), '1')
    } catch {
      /* ignore quota / private mode */
    }
    capture('first_capture_nudge_dismissed', {})
    onDismiss()
  }

  function trackChat() {
    capture('first_capture_nudge_clicked_chat', {})
  }

  function trackMemory() {
    capture('first_capture_nudge_clicked_memory', {})
  }
</script>

{#if open}
  <Card.Root class="shrink-0 border border-black/15 bg-card dark:border-border">
    <Card.Header class="space-y-1 pb-2">
      <Card.Title class="text-sm">Thought saved</Card.Title>
      <Card.Description class="text-muted-foreground text-xs leading-relaxed">
        Ask Eigen Mesh about it in Chat, or see how it connects in Memory.
      </Card.Description>
    </Card.Header>
    <Card.Footer class="flex flex-wrap items-center gap-2 border-t-0 pt-0">
      <Button href="/chat" class="rounded-[4px] text-xs" onclick={trackChat}>
        Ask about it in Chat
      </Button>
      <Button href="/memory" variant="outline" class="rounded-[4px] text-xs" onclick={trackMemory}>
        See it in Memory
      </Button>
      <Button
        type="button"
        variant="ghost"
        class="rounded-[4px] text-xs text-muted-foreground"
        onclick={dismiss}
      >
        Dismiss
      </Button>
    </Card.Footer>
  </Card.Root>
{/if}
