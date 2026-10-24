<script lang="ts">
  import type { CheckInQuestion } from '$lib/grounding/check-in'
  import { m } from '$lib/paraglide/messages.js'

  /**
   * A check-in question, in Notifications: the question in your voice, then plain
   * pill actions — keep / archive for a relevance check, a written answer for a
   * grounding question, or "Not now". Every POST checks its answer; a failure is
   * said, never swallowed. `onDone` fires once the server took the answer.
   */
  let { question, onDone }: { question: CheckInQuestion; onDone: () => void } = $props()

  let answer = $state('')
  let busy = $state(false)
  let err = $state<string | null>(null)
  let saved = $state<string | null>(null)

  async function post(body: Record<string, unknown>, savedLabel: string | null): Promise<void> {
    if (busy) return
    busy = true
    err = null
    try {
      const res = await fetch('/api/grounding/question', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
        throw new Error(payload.message ?? payload.error ?? `${res.status}`)
      }
      if (savedLabel) {
        saved = savedLabel
        await new Promise((resolve) => setTimeout(resolve, 1200))
      }
      onDone()
    } catch (e) {
      err = m.check_in_failed({ reason: e instanceof Error ? e.message : String(e) })
    } finally {
      busy = false
    }
  }

  const pill =
    'h-9 rounded-full border-0 px-4 text-sm cursor-pointer transition-colors duration-300 ease-settle disabled:cursor-default disabled:opacity-40'
  const quiet = `${pill} bg-transparent text-ink-3 pointer-fine:hover:text-ink`
  const soft = `${pill} bg-paper-2 text-ink-2 pointer-fine:hover:text-ink`
  const strong = `${pill} bg-ink text-paper`
</script>

<div class="border-b border-line py-5" data-testid="check-in-question">
  <div class="flex items-center gap-2 text-sm text-ink-3 before:size-[5px] before:rounded-full before:bg-signal before:content-['']">
    {question.kind === 'relevance' ? m.check_in_relevance_label() : m.check_in_grounding_label()}
  </div>
  <p class="mt-2 mb-0 font-you text-[20px] leading-[1.35] text-ink [overflow-wrap:anywhere]">{question.question}</p>

  {#if saved}
    <p class="mt-4 mb-0 text-sm text-ink-3" role="status">{saved}</p>
  {:else}
    {#if question.kind === 'grounding'}
      <textarea
        class="mt-4 block w-full min-h-[84px] resize-none rounded-[14px] border-0 bg-paper-2 p-3.5 font-mesh text-base leading-[1.5] text-ink caret-signal outline-none placeholder:text-ink-3"
        bind:value={answer}
        placeholder={m.check_in_answer_placeholder()}
        aria-label={question.question}
        disabled={busy}
      ></textarea>
    {/if}
    {#if err}
      <p class="mt-3 mb-0 text-sm text-clay" role="alert">{err}</p>
    {/if}
    <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
      <button type="button" class={quiet} disabled={busy} onclick={() => void post({ dismiss: true }, null)}>
        {m.check_in_not_now()}
      </button>
      {#if question.kind === 'relevance'}
        {@const thoughtId = question.thoughtId}
        <button
          type="button"
          class={soft}
          disabled={busy}
          onclick={() => void post({ kind: 'relevance', thoughtId, action: 'archive' }, m.check_in_archived())}
        >
          {m.check_in_archive()}
        </button>
        <button
          type="button"
          class={strong}
          disabled={busy}
          onclick={() => void post({ kind: 'relevance', thoughtId, action: 'keep' }, m.check_in_kept())}
        >
          {m.check_in_keep()}
        </button>
      {:else}
        {@const facetKey = question.facetKey}
        <button
          type="button"
          class={strong}
          disabled={busy || !answer.trim()}
          onclick={() => void post({ kind: 'grounding', facetKey, answer: answer.trim() }, m.check_in_saved())}
        >
          {m.check_in_save()}
        </button>
      {/if}
    </div>
  {/if}
</div>
