<script lang="ts">
  import Check from '@lucide/svelte/icons/check'
  import MessageSquare from '@lucide/svelte/icons/message-square'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Label } from '$lib/components/ui/label'
  import { Textarea } from '$lib/components/ui/textarea'
  import { FEEDBACK_MAX_LENGTH } from '$lib/feedback/feedback-max-length'

  let { data } = $props()

  let message = $state('')
  let busy = $state(false)
  let errorMessage = $state<string | null>(null)
  let submittedId = $state<string | null>(null)

  const remaining = $derived(FEEDBACK_MAX_LENGTH - message.length)
  const canSubmit = $derived(message.trim().length > 0 && !busy)

  async function submit() {
    if (!canSubmit) return
    busy = true
    errorMessage = null
    submittedId = null
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(
          typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`,
        )
      }
      submittedId = typeof body?.id === 'string' ? body.id : null
      message = ''
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  function resetToForm() {
    submittedId = null
    errorMessage = null
  }
</script>

<svelte:head>
  <title>Feedback — Eigen</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-5 pb-10 pt-16">
  <header class="flex items-start gap-3">
    <div
      class="bg-muted text-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg"
    >
      <MessageSquare class="size-4" strokeWidth={1.75} aria-hidden="true" />
    </div>
    <div>
      <p class="text-muted-foreground text-xs">Feedback</p>
      <h1 class="text-sm font-semibold">Help shape Eigen Mesh</h1>
      <p class="text-muted-foreground mt-0.5 text-xs">
        Eigen Mesh is in beta, and your feedback is invaluable. Tell us what works, what's broken,
        or what you wish existed.
      </p>
    </div>
  </header>

  <Card.Root class="mt-4">
    <Card.Header class="pb-3">
      <Card.Title class="text-sm">Your message</Card.Title>
      <Card.Description>
        Saved to your account ({data.user.email}). We read every note.
      </Card.Description>
    </Card.Header>
    <Card.Content class="space-y-3 pt-0">
      {#if submittedId}
        <div
          class="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 flex items-center gap-2 rounded-[4px] border px-3 py-2 text-xs"
          role="status"
        >
          <Check class="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span>Got it — thank you. This helps more than you know.</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="rounded-[4px]"
          onclick={resetToForm}
        >
          Send another note
        </Button>
      {:else}
        <form
          onsubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          class="space-y-2"
        >
          <div class="space-y-1">
            <Label for="feedback-message">Message</Label>
            <Textarea
              id="feedback-message"
              bind:value={message}
              maxlength={FEEDBACK_MAX_LENGTH}
              placeholder="What works, what's broken, what you wish existed…"
              class="min-h-32"
              disabled={busy}
            />
            <p class="text-muted-foreground text-[11px]">
              {remaining} characters remaining
            </p>
          </div>
          <div class="flex items-center gap-2">
            <Button
              type="submit"
              variant="outline"
              size="sm"
              class="rounded-[4px]"
              disabled={!canSubmit}
            >
              {busy ? 'Sending…' : 'Send feedback'}
            </Button>
            {#if errorMessage}
              <p class="text-destructive text-xs">{errorMessage}</p>
            {/if}
          </div>
        </form>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
