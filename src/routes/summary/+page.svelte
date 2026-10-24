<script lang="ts">
  import type { PageData } from './$types'
  import { resolve } from '$app/paths'
  import { thoughtHref } from '$lib/chat/thought-href'
  import { m } from '$lib/paraglide/messages.js'

  /**
   * The daily summary in full (the push and email are its headline): projects and
   * their next action, open threads that stalled, open tasks that still need a
   * thread, and what each agent captured in the last day. Yesterday's numbers close
   * it, as information. Read-only: rows link to the thread or thought.
   */
  let { data }: { data: PageData } = $props()
  const digest = $derived(data.digest)

  function stalledReason(reason: string): string {
    if (reason === 'deadline_overdue') return m.summary_stalled_overdue_deadline()
    if (reason === 'milestone_overdue') return m.summary_stalled_overdue_milestone()
    return m.summary_stalled_no_next_action()
  }

  const section = 'mt-10'
  const heading = 'm-0 mb-3 text-sm font-normal text-ink-3'
  const row = 'block border-b border-line py-3.5 text-inherit no-underline pointer-fine:hover:[&_.words]:text-ink'
  const words = 'words block font-you text-[18px] leading-[1.35] text-ink-2 line-clamp-3 [overflow-wrap:anywhere]'
</script>

<svelte:head>
  <title>{m.summary_title()} — Eigenmesh</title>
</svelte:head>

<div
  class="mx-auto max-w-[700px] pt-[calc(var(--head,68px)+12px)] px-8 pb-[calc(var(--bottom-nav)+48px)] max-[640px]:px-[22px] animate-[fade_0.7s_var(--ease)_0.1s_both]"
>
  <h1 class="m-0 font-you text-[29px] font-normal leading-[1.16] text-ink">{m.summary_title()}</h1>

  <section class={section} data-testid="summary-projects">
    <h2 class={heading}>{m.summary_projects()} · {digest.projects.length}</h2>
    {#if digest.projects.length === 0}
      <p class="m-0 text-base text-ink-3">{m.summary_projects_none()}</p>
    {:else}
      {#each digest.projects as project (project.entityId)}
        <a class={row} href={resolve('/mesh/threads/[id]', { id: project.entityId })}>
          <span class={words}>{project.label}</span>
          <span class="mt-1 block text-sm text-ink-3 [overflow-wrap:anywhere]">{project.nextAction ?? m.summary_no_next()}</span>
        </a>
      {/each}
    {/if}
  </section>

  <section class={section} data-testid="summary-stalled">
    <h2 class={heading}>{m.summary_stalled()} · {digest.stalled.length}</h2>
    {#if digest.stalled.length === 0}
      <p class="m-0 text-base text-ink-3">{m.summary_stalled_none()}</p>
    {:else}
      {#each digest.stalled as project (project.entityId)}
        <a class={row} href={resolve('/mesh/threads/[id]', { id: project.entityId })}>
          <span class={words}>{project.label}</span>
          <span class="mt-1 block text-sm text-clay">{stalledReason(project.reason)}</span>
        </a>
      {/each}
    {/if}
  </section>

  <section class={section} data-testid="summary-unthreaded">
    <h2 class={heading}>{m.summary_unthreaded()} · {digest.unthreaded.count}</h2>
    {#if digest.unthreaded.count === 0}
      <p class="m-0 text-base text-ink-3">{m.summary_unthreaded_none()}</p>
    {:else}
      {#each digest.unthreaded.recent as item (item.thoughtId)}
        <a class={row} href={thoughtHref(item.thoughtId)}><span class={words}>{item.snippet}</span></a>
      {/each}
      {#if digest.unthreaded.count > digest.unthreaded.recent.length}
        <a class="mt-3 inline-block text-sm text-ink-3 no-underline pointer-fine:hover:text-ink" href={resolve('/mesh/threads/loose')}
          >{m.summary_unthreaded_more({ count: digest.unthreaded.count })} →</a
        >
      {/if}
    {/if}
  </section>

  <section class={section} data-testid="summary-agents">
    <h2 class={heading}>{m.summary_agents()}</h2>
    {#if digest.agents.length === 0}
      <p class="m-0 text-base text-ink-3">{m.summary_agents_none()}</p>
    {:else}
      {#each digest.agents as agent (agent.key)}
        <div class="mt-5 first:mt-0">
          <div class="flex items-baseline justify-between gap-3 border-b border-line pb-2 text-sm">
            <span class="text-ink">{agent.label}</span>
            <span class="text-ink-3 [font-variant-numeric:tabular-nums]">{agent.count}</span>
          </div>
          {#each agent.recent as item (item.thoughtId)}
            <a class={row} href={thoughtHref(item.thoughtId)}><span class={words}>{item.snippet}</span></a>
          {/each}
        </div>
      {/each}
    {/if}
  </section>

  <section class={section} data-testid="summary-yesterday">
    <h2 class={heading}>{m.summary_yesterday()}</h2>
    <p class="m-0 text-sm text-ink-2">
      {m.summary_yesterday_line({
        completed: digest.yesterday.completed,
        overdue: digest.yesterday.overdue,
        dueToday: digest.yesterday.dueToday,
      })}
    </p>
  </section>
</div>
