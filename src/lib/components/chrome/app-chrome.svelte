<script lang="ts">
  import { onMount } from 'svelte'
  import { resolve } from '$app/paths'
  import { LogoMark } from '$lib/components/brand/logo-engine'
  import { pulseBrand, registerLogo } from '$lib/stores/brand-pulse.svelte'
  import { whisper } from '$lib/stores/whisper.svelte'
  import MakeMeBetterEntry from './make-me-better-entry.svelte'
  import ViewSelect from './view-select.svelte'
  import YouMenu from './you-menu.svelte'

  /* The approved ei logo engine, mounted one-for-one: hover on the brand runs one of its
     three reversible effects and reverses on leave; work events pulse it via the store. */
  let logoEl: SVGSVGElement | null = $state(null)

  onMount(() => {
    if (!logoEl) return
    const mark = new LogoMark(logoEl)
    registerLogo(mark)
    return () => {
      registerLogo(null)
      mark.destroy()
    }
  })
</script>

<header
  class="fixed inset-x-0 top-0 z-[35] flex h-head items-center justify-between px-[26px] pt-[env(safe-area-inset-top,0px)] max-[640px]:px-[14px] animate-[enter_1.1s_var(--ease)_backwards]"
>
  <div class="flex items-center gap-2">
    <a
      class="group flex items-center gap-[11px] rounded-[10px] py-1.5 pr-2 pl-1 text-ink no-underline"
      href={resolve('/capture')}
      onclick={() => pulseBrand(400)}
      aria-label="Eigenmesh"
    >
      <svg
        bind:this={logoEl}
        class="block size-[30px] shrink-0 overflow-visible text-ink [&_.logo-node_image]:[image-rendering:pixelated]"
        aria-hidden="true"
      ></svg>
      <span
        class="translate-y-px font-you text-[20px] leading-none tracking-[-0.01em] max-[640px]:hidden"
        aria-hidden="true">Eigenmesh</span
      >
    </a>
    <ViewSelect />
  </div>

  <div class="flex items-center gap-5.5">
    <!-- the whisper: the only status line; it fades out and back, never pops -->
    <span
      class={[
        'max-[640px]:hidden text-sm text-ink-3 [transition:opacity_0.22s_var(--ease),transform_0.3s_var(--ease)]',
        whisper.swapping && 'opacity-0 -translate-y-[3px]',
      ]}
      aria-live="polite">{whisper.text}</span
    >
    <MakeMeBetterEntry />
    <YouMenu />
  </div>
</header>
