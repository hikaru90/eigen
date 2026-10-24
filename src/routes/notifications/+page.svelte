<script lang="ts">
  import type { PageData } from './$types'
  import { onMount } from 'svelte'
  import { invalidateAll } from '$app/navigation'
  import { base, resolve } from '$app/paths'
  import { m } from '$lib/paraglide/messages.js'
  import { getLocale } from '$lib/paraglide/runtime'

  /**
   * Notifications — what the app has to tell you (an idea you shared shipped, …).
   * Load lists them; once seen, one POST marks them read and the layout's unread
   * count refreshes. Unread rows keep their dot for this visit.
   */
  let { data }: { data: PageData } = $props()

  const dateFmt = new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  onMount(() => {
    if (!data.notifications.some((n) => n.readAt === null)) return
    void (async () => {
      const res = await fetch(`${base}/api/notifications/read`, { method: 'POST', credentials: 'include' })
      if (!res.ok) {
        console.error('[notifications] mark read failed', res.status, await res.text())
        return
      }
      await invalidateAll()
    })()
  })
</script>

<svelte:head>
  <title>{m.nav_notifications()} — Eigenmesh</title>
</svelte:head>

<div
  class="mx-auto max-w-[700px] pt-[calc(var(--head,68px)+12px)] px-8 pb-[calc(var(--bottom-nav)+48px)] max-[640px]:px-[22px] animate-[fade_0.7s_var(--ease)_0.1s_both]"
>
  <h1 class="m-0 font-you text-[29px] font-normal leading-[1.16] text-ink">{m.nav_notifications()}</h1>

  {#if data.notifications.length === 0}
    <p class="mt-6 text-base text-ink-3" data-testid="notifications-empty">{m.notifications_empty()}</p>
  {:else}
    <ul class="mt-6 list-none p-0 border-t border-line">
      {#each data.notifications as note (note.id)}
        <li class="border-b border-line" data-testid="notification-row">
          {#snippet content()}
            <span
              class={['mt-[9px] size-1.5 shrink-0 rounded-full', note.readAt === null ? 'bg-clay' : 'bg-transparent']}
              aria-hidden="true"
            ></span>
            <span class="min-w-0 flex-1">
              <strong class="block font-medium text-ink-2">{note.title}</strong>
              <span class="mt-1 block text-sm leading-[1.5] text-ink-2 [overflow-wrap:anywhere]">{note.body}</span>
              <time class="mt-1.5 block text-xs text-ink-3" datetime={note.createdAt}>{dateFmt.format(new Date(note.createdAt))}</time>
            </span>
          {/snippet}
          <!-- where a notification leads is decided by its kind — typed routes only -->
          {#if note.kind === 'idea_shipped'}
            <a class="flex gap-3 py-5 text-inherit no-underline pointer-fine:hover:[&_strong]:text-ink" href={resolve('/feedback')}>
              {@render content()}
            </a>
          {:else}
            <div class="flex gap-3 py-5">{@render content()}</div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
