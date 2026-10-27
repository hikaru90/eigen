<script lang="ts">
  import ThumbsDownIcon from '@lucide/svelte/icons/thumbs-down'
  import ThumbsUpIcon from '@lucide/svelte/icons/thumbs-up'
  import type { CaptureSubmitResult } from '$lib/capture/capture-result-types'
  import {
    postCaptureVote,
    type CaptureVotePlace,
    type CaptureVoteVerdict,
  } from '$lib/capture/capture-vote-client'
  import { Button } from '$lib/components/ui/button'
  import { Textarea } from '$lib/components/ui/textarea'
  import { m } from '$lib/paraglide/messages.js'

  /**
   * 👍 / 👎 on a stored thought (docs/planning/capture-feedback.md §6) — the one vote component,
   * shown in exactly two places: the kept strip right after Capture and the unfolded Mesh row.
   * Two small icon buttons and nothing else: no headline, no question, no prompt; Eigen never
   * asks. 👍 stores the vote at once. 👎 opens a box ("What was wrong?"); sending it with text
   * applies that text as an edit (the host takes the edited thought through `onedited`), sending
   * it empty stores the vote alone. Re-voting replaces the vote.
   *
   * Every state change happens in an event handler, after the server answered: the pressed state
   * is the stored vote (the open box counts as a 👎 in the making), never a guess. A refusal or a
   * failed edit says why in place and keeps the typed text. The root is `display: contents` so the
   * buttons sit in the host's line and the box takes its own full-width line under it.
   */
  let {
    thoughtId,
    initialVerdict,
    place,
    onedited,
    onopenchange,
  }: {
    thoughtId: string
    /** The vote already stored for this thought; null when there is none. */
    initialVerdict: CaptureVoteVerdict | null
    place: CaptureVotePlace
    /** The reason was applied as an edit: the thought as the server now has it. */
    onedited?: (thought: CaptureSubmitResult) => void
    /** The reason box opened or closed — a host that fades on its own keeps itself up while open. */
    onopenchange?: (open: boolean) => void
  } = $props()

  /** What this instance stored since it mounted; until then, the vote the thought came with. */
  let stored = $state<CaptureVoteVerdict | null>(null)
  const current = $derived(stored ?? initialVerdict)

  let open = $state(false)
  let reason = $state('')
  let busy = $state(false)
  let error = $state<string | null>(null)

  const pressedUp = $derived(current === 'up' && !open)
  const pressedDown = $derived(open || current === 'down')

  function setOpen(next: boolean): void {
    if (open === next) return
    open = next
    onopenchange?.(next)
  }

  function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
  }

  async function voteUp(): Promise<void> {
    if (busy) return
    busy = true
    error = null
    try {
      await postCaptureVote({ thoughtId, verdict: 'up', place })
      stored = 'up'
      reason = ''
      setOpen(false)
    } catch (e) {
      error = messageOf(e)
    } finally {
      busy = false
    }
  }

  function toggleBox(): void {
    if (busy) return
    error = null
    if (open) reason = ''
    setOpen(!open)
  }

  async function sendDown(): Promise<void> {
    if (busy) return
    busy = true
    error = null
    try {
      const text = reason.trim()
      const answer = await postCaptureVote({
        thoughtId,
        verdict: 'down',
        place,
        ...(text === '' ? {} : { reason: text }),
      })
      stored = answer.verdict
      if (answer.editError !== null) {
        // the vote and its label are stored; the edit is not — say why, keep the text
        error = answer.editError
        return
      }
      reason = ''
      setOpen(false)
      if (answer.editApplied && answer.thought) onedited?.(answer.thought)
    } catch (e) {
      error = messageOf(e)
    } finally {
      busy = false
    }
  }

  function onFieldKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      toggleBox()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void sendDown()
    }
  }

  const iconButton = 'text-ink-3 aria-pressed:bg-paper-2 aria-pressed:text-ink'
</script>

<div class="contents" data-testid="capture-vote">
  <span class="inline-flex items-center gap-0.5">
    <Button
      variant="ghost"
      size="icon-xs"
      class={iconButton}
      aria-label={m.capture_vote_up()}
      aria-pressed={pressedUp}
      title={m.capture_vote_up()}
      data-testid="capture-vote-up"
      disabled={busy}
      onclick={() => void voteUp()}
    >
      <ThumbsUpIcon class={pressedUp ? 'fill-current' : ''} aria-hidden="true" />
    </Button>
    <Button
      variant="ghost"
      size="icon-xs"
      class={iconButton}
      aria-label={m.capture_vote_down()}
      aria-pressed={pressedDown}
      title={m.capture_vote_down()}
      data-testid="capture-vote-down"
      disabled={busy}
      onclick={toggleBox}
    >
      <ThumbsDownIcon class={pressedDown ? 'fill-current' : ''} aria-hidden="true" />
    </Button>
  </span>
  {#if open}
    <!-- the reason box takes its own full-width line under the buttons -->
    <div
      class="order-last flex basis-full flex-col items-start gap-2.5 pt-1"
      data-testid="capture-vote-reason"
    >
      <Textarea
        bind:value={reason}
        class="min-h-16 font-you text-base leading-[1.35]"
        placeholder={m.capture_vote_reason_placeholder()}
        aria-label={m.capture_vote_reason_placeholder()}
        data-testid="capture-vote-field"
        disabled={busy}
        onkeydown={onFieldKey}
      />
      <Button
        size="sm"
        data-testid="capture-vote-send"
        disabled={busy}
        onclick={() => void sendDown()}>{m.capture_vote_send()}</Button
      >
    </div>
  {/if}
  {#if error}
    <p
      class="order-last m-0 basis-full font-mesh text-sm text-clay"
      role="alert"
      data-testid="capture-vote-error"
    >
      {error}
    </p>
  {/if}
</div>
