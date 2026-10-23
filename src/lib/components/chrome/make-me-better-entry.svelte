<script lang="ts">
  import { onMount } from 'svelte'
  import { base, resolve } from '$app/paths'
  import { page } from '$app/state'
  import { m } from '$lib/paraglide/messages.js'
  import { feedbackNews } from './feedback-news.svelte'
  import { GLIMPSE_HOLD_MS, GLIMPSE_INTERVAL_MS, shouldGlimpse } from './glimpse'

  const active = $derived.by(() => {
    let p: string = page.url.pathname
    if (base && p.startsWith(base)) p = p.slice(base.length) || '/'
    return p === '/feedback' || p.startsWith('/feedback/')
  })

  let glimpseOn = $state(false)
  let holdTimer: ReturnType<typeof setTimeout> | null = null

  /** The loop lights up on the page, or for the once-every-30s glimpse. */
  const lit = $derived(active || glimpseOn)

  onMount(() => {
    // The glimpse: every 30 s the loop turns to clay yarn and turns once — never
    // while you're on the page, typing, away from the tab, or asking for less
    // motion (guards ported from the ei prototype and unit-tested in glimpse.ts).
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const interval = setInterval(() => {
      if (
        !shouldGlimpse(
          { onEntryPage: active, tabHidden: document.hidden, reducedMotion: reducedMotion.matches },
          document.activeElement,
        )
      ) {
        return
      }
      glimpseOn = true
      holdTimer = setTimeout(() => {
        glimpseOn = false
        holdTimer = null
      }, GLIMPSE_HOLD_MS)
    }, GLIMPSE_INTERVAL_MS)
    return () => {
      clearInterval(interval)
      if (holdTimer) clearTimeout(holdTimer)
    }
  })
</script>

<!-- Make me better: the app asking for ideas and bugs. A loop of yarn, round so it
     can't be mistaken for the mark's squares; every 30 s it gives a glimpse of its
     yarn self. The clay dot means the app has a note for you on /feedback. -->
<a
  class="relative flex h-8 items-center gap-[7px] pr-1 text-ink no-underline before:absolute before:inset-[-6px] before:content-['']"
  href={resolve('/feedback')}
  aria-label={m.nav_make_me_better()}
>
  <span
    class="whitespace-nowrap text-sm text-ink-2 transition-colors duration-[400ms] ease-settle pointer-fine:hover:text-ink"
    class:text-clay={lit}
    aria-hidden="true">{m.nav_make_me_better()}</span
  >
  <svg
    class={[
      'size-6 overflow-visible transition-opacity duration-500 ease-settle pointer-fine:hover:opacity-85',
      lit ? 'opacity-100' : 'opacity-60',
      glimpseOn && 'animate-[ring-turn_1.8s_var(--ease-io)_0.2s_both]',
    ]}
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      class={[
        'fill-none stroke-current [stroke-width:1.2] [stroke-linejoin:round] transition-[stroke,stroke-width] duration-500 ease-settle',
        lit && 'stroke-clay [stroke-width:2]',
      ]}
      d="M12 4.8L12.56 4.47L13.16 4.28L13.76 4.3L14.3 4.54L14.76 4.97L15.12 5.51L15.42 6.07L15.71 6.55L16.05 6.92L16.48 7.17L17.02 7.34L17.63 7.51L18.24 7.75L18.76 8.1L19.12 8.57L19.27 9.15L19.21 9.77L19.02 10.4L18.77 10.98L18.58 11.51L18.5 12L18.58 12.49L18.77 13.02L19.02 13.6L19.21 14.23L19.27 14.85L19.12 15.43L18.76 15.9L18.24 16.25L17.63 16.49L17.02 16.66L16.48 16.83L16.05 17.08L15.71 17.45L15.42 17.93L15.12 18.49L14.76 19.03L14.3 19.46L13.76 19.7L13.16 19.72L12.56 19.53L12 19.2L11.49 18.83L11.02 18.52L10.55 18.34L10.06 18.3L9.5 18.38L8.88 18.49L8.22 18.54L7.6 18.45L7.07 18.18L6.69 17.72L6.47 17.14L6.37 16.49L6.34 15.86L6.29 15.3L6.14 14.82L5.86 14.41L5.45 14.02L4.98 13.6L4.53 13.13L4.22 12.58L4.1 12L4.22 11.42L4.53 10.87L4.98 10.4L5.45 9.98L5.86 9.59L6.14 9.18L6.29 8.7L6.34 8.14L6.37 7.51L6.47 6.86L6.69 6.28L7.07 5.82L7.6 5.55L8.22 5.46L8.88 5.51L9.5 5.62L10.06 5.7L10.55 5.66L11.02 5.48L11.49 5.17Z"
    />
    <path
      class={[
        'fill-none stroke-raised [stroke-opacity:0.6] [stroke-linejoin:round] [stroke-width:0] [stroke-dasharray:1.1_1.3] transition-[stroke-width] duration-500 ease-settle',
        lit && '[stroke-width:0.9]',
      ]}
      d="M12 4.8L12.56 4.47L13.16 4.28L13.76 4.3L14.3 4.54L14.76 4.97L15.12 5.51L15.42 6.07L15.71 6.55L16.05 6.92L16.48 7.17L17.02 7.34L17.63 7.51L18.24 7.75L18.76 8.1L19.12 8.57L19.27 9.15L19.21 9.77L19.02 10.4L18.77 10.98L18.58 11.51L18.5 12L18.58 12.49L18.77 13.02L19.02 13.6L19.21 14.23L19.27 14.85L19.12 15.43L18.76 15.9L18.24 16.25L17.63 16.49L17.02 16.66L16.48 16.83L16.05 17.08L15.71 17.45L15.42 17.93L15.12 18.49L14.76 19.03L14.3 19.46L13.76 19.7L13.16 19.72L12.56 19.53L12 19.2L11.49 18.83L11.02 18.52L10.55 18.34L10.06 18.3L9.5 18.38L8.88 18.49L8.22 18.54L7.6 18.45L7.07 18.18L6.69 17.72L6.47 17.14L6.37 16.49L6.34 15.86L6.29 15.3L6.14 14.82L5.86 14.41L5.45 14.02L4.98 13.6L4.53 13.13L4.22 12.58L4.1 12L4.22 11.42L4.53 10.87L4.98 10.4L5.45 9.98L5.86 9.59L6.14 9.18L6.29 8.7L6.34 8.14L6.37 7.51L6.47 6.86L6.69 6.28L7.07 5.82L7.6 5.55L8.22 5.46L8.88 5.51L9.5 5.62L10.06 5.7L10.55 5.66L11.02 5.48L11.49 5.17Z"
    />
  </svg>
  <span
    class="absolute top-[5px] right-1 size-1.5 rounded-full bg-clay shadow-[0_0_0_2px_var(--paper)] [transition:opacity_0.4s_var(--ease),transform_0.6s_var(--ease)]"
    class:opacity-0={!feedbackNews.hasNote}
    class:opacity-100={feedbackNews.hasNote}
    class:scale-40={!feedbackNews.hasNote}
    class:scale-100={feedbackNews.hasNote}
    aria-hidden="true"
  ></span>
</a>
