<script lang="ts">
  import type { CreateProjectResponse } from '../../api/timeline/projects/+server'
  import type { PageData } from './$types'
  import { invalidateAll } from '$app/navigation'
  import { resolve } from '$app/paths'
  import { thoughtHref } from '$lib/chat/thought-href'
  import MeshSpinner from '$lib/components/brand/mesh-spinner.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import { clusterSketchLayout } from '$lib/patterns/cluster-sketch'
  import type { PatternsOkResult } from '$lib/server/patterns/patterns-service'
  import { pulseBrand } from '$lib/stores/brand-pulse.svelte'
  import { showWhisper } from '$lib/stores/whisper.svelte'

  /*
    Patterns: what the mesh notices (ei DESIGN.md "Mesh → Patterns"; prototype
    index.html .lens-threads, app.js renderInsight/renderThreadPanel/adopt).
    This pass: the insight sentence, pattern cards with a cheap cluster sketch,
    and "Make it a thread". The full living map is a later pass.
  */

  let { data }: { data: PageData } = $props()

  /** Pattern titles adopted as threads this visit → the thread's entity id. */
  let adopted = $state<Record<string, string>>({})
  let adoptingTitle = $state<string | null>(null)
  let adoptError = $state<string | null>(null)

  function previewsById(result: PatternsOkResult): Map<string, string> {
    return new Map(result.thoughtPreviews.map((preview) => [preview.id, preview.summary]))
  }

  /** The one main action on a card: the existing project-create endpoint the
      /memory/projects dialog uses (src/routes/api/timeline/projects/+server.ts). */
  async function makeItAThread(title: string) {
    if (adoptingTitle) return
    adoptingTitle = title
    adoptError = null
    try {
      const res = await fetch('/api/timeline/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: title, status: 'active' }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Request failed (${res.status})`)
      }
      const body = (await res.json()) as CreateProjectResponse
      adopted = { ...adopted, [title]: body.entityId }
      pulseBrand(900)
      showWhisper([
        { text: m.whisper_knitting(), durationMs: 900 },
        { text: m.whisper_kept(), durationMs: 1600 },
      ])
    } catch (err) {
      adoptError = err instanceof Error ? err.message : String(err)
    } finally {
      adoptingTitle = null
    }
  }

  /** The stream itself failed (network): SvelteKit hands over an App.Error-shaped object, not an Error. */
  function streamFailureMessage(err: unknown): string {
    if (err instanceof Error) return err.message
    if (typeof err === 'object' && err !== null && 'message' in err && typeof err.message === 'string') {
      return err.message
    }
    return m.patterns_load_failed()
  }

  function retry() {
    void invalidateAll()
  }
</script>

<section
  class="box-border w-full max-w-[680px] mx-auto pt-6 px-5 pb-[calc(var(--bottom-nav,62px)+48px)] min-[720px]:px-8 font-mesh text-ink"
  aria-label={m.mesh_tabs_patterns()}
>
  {#await data.patterns}
    <!-- The spinner at the front of the line, plain words beside it, softly breathing. -->
    <div class="flex items-center gap-2.5 pt-1.5 text-sm text-ink-3 animate-[fade_0.6s_var(--ease)_both]" role="status" aria-live="polite">
      <MeshSpinner working size={22} />
      <span class="animate-[breathe_2.6s_ease-in-out_infinite] motion-reduce:[animation:none]">{m.patterns_forming()}</span>
    </div>
  {:then outcome}
    {#if outcome.kind === 'failed'}
      <!-- Not the quiet state: the judge or the gateway failed. Say so plainly. -->
      {#if outcome.reason === 'insufficient_credits'}
        <p class="mt-[18px] mb-0 text-sm leading-[1.5] text-ink-3 animate-[fade_0.8s_var(--ease)_both]" role="alert">
          {m.patterns_out_of_credits()}
          <a
            class="text-ink-2 underline underline-offset-2 transition-colors duration-300 pointer-fine:hover:text-ink"
            href={resolve('/settings/llm')}
            data-testid="patterns-credits-link"
          >
            {m.patterns_out_of_credits_link()}
          </a>
        </p>
      {:else}
        <p class="mt-[18px] mb-0 text-sm leading-[1.5] text-ink-3 animate-[fade_0.8s_var(--ease)_both]" role="alert">{outcome.message}</p>
        <button
          type="button"
          class="mt-2.5 py-1 px-0 border-0 bg-transparent [font:inherit] text-sm text-ink-2 transition-colors duration-300 cursor-pointer pointer-fine:hover:text-ink"
          onclick={retry}
        >
          {m.ask_try()}
        </button>
      {/if}
    {:else if outcome.result.status === 'empty'}
      <p class="mt-2 mb-0 text-base leading-[1.5] text-ink-3 animate-[fade_0.8s_var(--ease)_both]">{m.patterns_empty()}</p>
    {:else}
      {@const result = outcome.result}
      {@const previews = previewsById(result)}
      <p
        class="m-0 max-w-[24ch] text-[26px] leading-[1.18] tracking-[-0.028em] animate-[rise_1s_var(--ease)_0.25s_both] min-[720px]:text-[30px]"
      >
        {result.insight}
      </p>

      {#if result.patterns.length > 0}
        <ul class="list-none mt-[34px] mb-0 p-0 border-t border-line">
          {#each result.patterns as pattern, i (pattern.title)}
            {@const sketch = clusterSketchLayout(pattern.graph)}
            {@const isAdopted = pattern.title in adopted}
            <li
              class="grid grid-cols-[56px_minmax(0,1fr)] gap-4 pt-[22px] pb-6 border-b border-line animate-[rise_0.8s_var(--ease)_both] [animation-delay:calc(var(--i,0)*70ms+0.25s)] min-[720px]:grid-cols-[72px_minmax(0,1fr)] min-[720px]:gap-[22px]"
              style="--i: {i}"
            >
              <!-- The pattern's slice of the graph: one soft square per entity, its real relations as the fine links. -->
              <svg
                class="size-14 overflow-visible text-ink min-[720px]:size-[72px]"
                viewBox="{-sketch.bounds.width / 2} {-sketch.bounds.height / 2} {sketch.bounds.width} {sketch.bounds.height}"
                aria-hidden="true"
              >
                {#each sketch.links as link, j (j)}
                  <path
                    class="fill-none stroke-current [stroke-opacity:0.5] [stroke-width:0.6] [stroke-linecap:round]"
                    d="M{sketch.nodes[link.a].x} {sketch.nodes[link.a].y}L{sketch.nodes[link.b].x} {sketch.nodes[link.b].y}"
                  />
                {/each}
                {#each sketch.nodes as node, j (j)}
                  <rect
                    class="fill-current animate-[fade_0.9s_var(--ease)_both] [animation-delay:calc(var(--i,0)*70ms+var(--j,0)*45ms+0.4s)]"
                    x={node.x - node.size / 2}
                    y={node.y - node.size / 2}
                    width={node.size}
                    height={node.size}
                    rx={node.corner}
                    style="--j: {j}"
                  />
                {/each}
              </svg>

              <div class="min-w-0">
                <!-- Two voices: the mesh names it in Inter; once adopted it is yours, in Geist Mono. -->
                <h2 class="grid m-0 font-normal">
                  <span
                    class={["col-start-1 row-start-1 text-base font-medium tracking-[-0.014em] leading-[1.3] [transition:opacity_0.8s_var(--ease),filter_0.8s_var(--ease),transform_1s_var(--ease)]", isAdopted && 'opacity-0 blur-[8px] -translate-y-2']}
                    aria-hidden={isAdopted}>{pattern.title}</span
                  >
                  <span
                    class={["col-start-1 row-start-1 font-you text-[17px] tracking-[-0.005em] leading-[1.3] [transition:opacity_0.8s_var(--ease),filter_0.8s_var(--ease),transform_1s_var(--ease)]", isAdopted ? 'opacity-100 blur-none translate-y-0' : 'opacity-0 blur-[8px] translate-y-2']}
                    aria-hidden={!isAdopted}>{pattern.title}</span
                  >
                </h2>
                <p class="mt-1.5 mb-0 text-sm leading-[1.5] text-ink-2">{pattern.distillation}</p>
                {#if pattern.graph.nodes.length > 0}
                  <ul class="mt-2.5 mb-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={m.patterns_graph_nodes()}>
                    {#each pattern.graph.nodes as node (node.id)}
                      <li class="rounded-full bg-paper-2 px-2.5 py-0.5 text-[12.5px] leading-[1.5] text-ink-2">{node.label}</li>
                    {/each}
                  </ul>
                {/if}
                <p class="mt-2 mb-0 text-sm text-ink-3">{pattern.thoughtIds.length} {m.threads_thoughts()}</p>

                <!-- Lists are for reading: rows never open on tap; the open control does. -->
                <ul class="list-none mt-3.5 mb-0 p-0">
                  {#each pattern.thoughtIds as id (id)}
                    {@const summary = previews.get(id)}
                    {#if summary}
                      <li class="flex items-start justify-between gap-3.5 py-2.5 border-t border-line">
                        <span class="block font-you text-sm leading-[1.45] text-ink">{summary}</span>
                        <a
                          class="relative shrink-0 grid size-6 place-items-center -mt-0.5 -mr-1 rounded-full text-ink-3 transition-colors duration-300 ease-settle before:absolute before:-inset-2 before:content-[''] pointer-fine:hover:text-ink"
                          href={thoughtHref(id)}
                          aria-label={summary}
                        >
                          <svg
                            class="size-[13px] fill-none stroke-current [stroke-width:1.3] [stroke-linecap:round] [stroke-linejoin:round]"
                            viewBox="0 0 16 16"
                            aria-hidden="true"
                          >
                            <path d="M9.5 3.5h3v3M6.5 12.5h-3v-3M12.5 3.5 9.2 6.8M3.5 12.5l3.3-3.3" />
                          </svg>
                        </a>
                      </li>
                    {/if}
                  {/each}
                </ul>

                {#if !isAdopted}
                  <div class="flex flex-wrap items-center gap-[18px] mt-[18px]">
                    <button
                      type="button"
                      class="shrink-0 h-[34px] px-[17px] border-0 rounded-full bg-ink text-paper [font:inherit] text-sm whitespace-nowrap cursor-pointer [transition:transform_0.4s_var(--ease),background_0.5s_var(--ease),color_0.5s_var(--ease),box-shadow_0.5s] disabled:bg-transparent disabled:text-ink-3 disabled:shadow-[inset_0_0_0_1px_var(--line)] disabled:cursor-not-allowed pointer-fine:enabled:hover:-translate-y-px"
                      disabled={adoptingTitle !== null}
                      onclick={() => makeItAThread(pattern.title)}
                    >
                      {m.threads_make_it_a_thread()}
                    </button>
                  </div>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}

      {#if adoptError}
        <p class="mt-[18px] mb-0 text-sm leading-[1.5] text-ink-3 animate-[fade_0.8s_var(--ease)_both]" role="alert">{adoptError}</p>
      {/if}
    {/if}
  {:catch err}
    <!-- Not the quiet state: the judge or the gateway failed. Say so plainly. -->
    <p class="mt-[18px] mb-0 text-sm leading-[1.5] text-ink-3 animate-[fade_0.8s_var(--ease)_both]" role="alert">{streamFailureMessage(err)}</p>
    <button
      type="button"
      class="mt-2.5 py-1 px-0 border-0 bg-transparent [font:inherit] text-sm text-ink-2 transition-colors duration-300 cursor-pointer pointer-fine:hover:text-ink"
      onclick={retry}
    >
      {m.ask_try()}
    </button>
  {/await}
</section>

