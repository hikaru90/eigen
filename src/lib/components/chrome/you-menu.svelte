<script lang="ts">
  import { goto } from '$app/navigation'
  import { base, resolve } from '$app/paths'
  import { page } from '$app/state'
  import { resetPostHog } from '$lib/analytics/posthog-client'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import { m } from '$lib/paraglide/messages.js'

  // — Look: the existing theme system (see settings/+page.svelte). Persistence is
  //   localStorage 'theme-preference'; applying happens in +layout.svelte via the
  //   'theme-preference-change' window event. The repo's "Auto" value is 'system'.
  type LookPreference = 'light' | 'dark' | 'system'
  const LOOK_STORAGE_KEY = 'theme-preference'

  let look = $state<LookPreference>('system')
  let open = $state(false)

  function readLook(): LookPreference {
    const stored = localStorage.getItem(LOOK_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  }

  function pickLook(next: LookPreference) {
    look = next
    localStorage.setItem(LOOK_STORAGE_KEY, next)
    window.dispatchEvent(
      new CustomEvent('theme-preference-change', { detail: { preference: next } }),
    )
  }

  // — Data view lives in the header now (view-select.svelte); this menu keeps the rest.
  const userEmail = $derived(
    (page.data as { user?: { email?: string | null } | null }).user?.email ?? null,
  )

  // — Sign out: the old app-header flow, unchanged.
  async function signOut() {
    const res = await fetch(`${base}/api/session/sign-out`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) {
      console.error('Sign out failed', res.status, await res.text().catch(() => ''))
      return
    }
    resetPostHog()
    await goto(resolve('/login'), { invalidateAll: true })
  }

  // You: two equal lines, the menu icons' fine links. Open, they turn to clay yarn,
  // exactly like an active menu icon (ei .me / .me-burger).
  const burgerLink =
    'fill-none stroke-current [stroke-width:1.2] [stroke-linecap:round] transition-opacity duration-[400ms] ease-settle group-data-[state=open]:opacity-0'
  const burgerYarn =
    'fill-none stroke-clay [stroke-width:2] [stroke-linecap:round] opacity-0 transition-opacity duration-500 ease-settle group-data-[state=open]:opacity-100'
  const burgerPly =
    'fill-none stroke-raised [stroke-opacity:0.6] [stroke-width:0.9] [stroke-linecap:round] [stroke-dasharray:1.1_1.3]'
  // The weave marks: you (clay) and mesh (signal) yarn, gap paths drawing in paper.
  const weaveYarn = (stroke: string) => `fill-none ${stroke} [stroke-width:1.6] [stroke-linecap:round]`
  const weaveGap = 'fill-none stroke-paper [stroke-width:3.4] [stroke-linecap:round]'
  // Items: quiet rows on the paper — every registry item/radio-item carries meItem.
  const lookOptions: { value: LookPreference; label: () => string }[] = [
    { value: 'light', label: m.you_light },
    { value: 'dark', label: m.you_dark },
    { value: 'system', label: m.you_auto },
  ]
  const lookSeg =
    'rounded-full px-[9px] py-[3px] text-sm text-ink-3 cursor-pointer transition-[color,background,box-shadow] duration-[400ms] ease-settle focus:bg-transparent data-highlighted:text-ink-2 aria-checked:bg-raised aria-checked:text-ink aria-checked:shadow-(--pill-ring) [&>[data-slot=dropdown-menu-radio-item-indicator]]:hidden'
  const meItem =
    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-ink-2 cursor-pointer transition-colors duration-[250ms] pointer-fine:hover:bg-paper-2 pointer-fine:hover:text-ink'
</script>

<DropdownMenu.Root
  bind:open
  onOpenChange={(next) => {
    if (next) look = readLook()
  }}
>
  <DropdownMenu.Trigger
    class="group grid size-8 place-items-center border-0 bg-transparent p-0 text-ink cursor-pointer pointer-fine:hover:[&>svg]:opacity-70"
    aria-label="{m.you_profile()} · {m.you_settings()}"
  >
    <svg
      class="block size-6 overflow-visible opacity-60 transition-opacity duration-500 ease-settle group-data-[state=open]:opacity-100"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path class={burgerLink} d="M4 9L20 9" />
      <g class={burgerYarn}>
        <path
          d="M4 9L4.89 9.25L5.78 9.49L6.67 9L7.56 8.35L8.44 8.35L9.33 9L10.22 9.65L11.11 9.65L12 9L12.89 8.35L13.78 8.35L14.67 9L15.56 9.65L16.44 9.65L17.33 9L18.22 8.51L19.11 8.75L20 9"
        />
        <path
          class={burgerPly}
          d="M4 9L4.89 9.25L5.78 9.49L6.67 9L7.56 8.35L8.44 8.35L9.33 9L10.22 9.65L11.11 9.65L12 9L12.89 8.35L13.78 8.35L14.67 9L15.56 9.65L16.44 9.65L17.33 9L18.22 8.51L19.11 8.75L20 9"
        />
      </g>
      <path class={burgerLink} d="M4 15L20 15" />
      <g class={burgerYarn}>
        <path
          d="M4 15L4.89 15.25L5.78 15.49L6.67 15L7.56 14.35L8.44 14.35L9.33 15L10.22 15.65L11.11 15.65L12 15L12.89 14.35L13.78 14.35L14.67 15L15.56 15.65L16.44 15.65L17.33 15L18.22 14.51L19.11 14.75L20 15"
        />
        <path
          class={burgerPly}
          d="M4 15L4.89 15.25L5.78 15.49L6.67 15L7.56 14.35L8.44 14.35L9.33 15L10.22 15.65L11.11 15.65L12 15L12.89 14.35L13.78 14.35L14.67 15L15.56 15.65L16.44 15.65L17.33 15L18.22 14.51L19.11 14.75L20 15"
        />
      </g>
    </svg>
  </DropdownMenu.Trigger>

  <!-- The menu: a sheet of paper laid on the page, not a card. The content is portaled
       by the dropdown primitive; the classes travel with the element. -->
  <DropdownMenu.Content
    class="w-[244px] px-1 pt-1.5 pb-2 overflow-visible"
    aria-label="{m.you_profile()} · {m.you_settings()}"
    align="end"
    sideOffset={8}
  >
    <div class="flex items-center gap-[11px] px-2.5 pt-2 pb-3">
      <svg class="size-[30px] shrink-0 overflow-visible" viewBox="0 0 30 30" aria-hidden="true">
        <defs>
          <clipPath id="you-weave-clip">
            <circle cx="10.5" cy="10.5" r="3" />
            <circle cx="19.5" cy="19.5" r="3" />
          </clipPath>
        </defs>
        <path class={weaveYarn('stroke-clay')}
          d="M3.5 10.5L4.38 10.66L5.27 10.87L6.15 10.64L7.04 10L7.92 9.76L8.81 10.15L9.69 10.85L10.58 11.24L11.46 11L12.35 10.32L13.23 9.8L14.12 9.88L15 10.5L15.88 11.12L16.77 11.2L17.65 10.68L18.54 10L19.42 9.76L20.31 10.15L21.19 10.85L22.08 11.24L22.96 11L23.85 10.36L24.73 10.13L25.62 10.34L26.5 10.5"
        />
        <path class={weaveYarn('stroke-clay')}
          d="M3.5 19.5L4.38 19.66L5.27 19.87L6.15 19.64L7.04 19L7.92 18.76L8.81 19.15L9.69 19.85L10.58 20.24L11.46 20L12.35 19.32L13.23 18.8L14.12 18.88L15 19.5L15.88 20.12L16.77 20.2L17.65 19.68L18.54 19L19.42 18.76L20.31 19.15L21.19 19.85L22.08 20.24L22.96 20L23.85 19.36L24.73 19.13L25.62 19.34L26.5 19.5"
        />
        <path class={weaveGap}
          d="M10.5 3.5L10.34 4.38L10.13 5.27L10.36 6.15L11 7.04L11.24 7.92L10.85 8.81L10.15 9.69L9.76 10.58L10 11.46L10.68 12.35L11.2 13.23L11.12 14.12L10.5 15L9.88 15.88L9.8 16.77L10.32 17.65L11 18.54L11.24 19.42L10.85 20.31L10.15 21.19L9.76 22.08L10 22.96L10.64 23.85L10.87 24.73L10.66 25.62L10.5 26.5"
        />
        <path class={weaveYarn('stroke-signal')}
          d="M10.5 3.5L10.34 4.38L10.13 5.27L10.36 6.15L11 7.04L11.24 7.92L10.85 8.81L10.15 9.69L9.76 10.58L10 11.46L10.68 12.35L11.2 13.23L11.12 14.12L10.5 15L9.88 15.88L9.8 16.77L10.32 17.65L11 18.54L11.24 19.42L10.85 20.31L10.15 21.19L9.76 22.08L10 22.96L10.64 23.85L10.87 24.73L10.66 25.62L10.5 26.5"
        />
        <path class={weaveGap}
          d="M19.5 3.5L19.34 4.38L19.13 5.27L19.36 6.15L20 7.04L20.24 7.92L19.85 8.81L19.15 9.69L18.76 10.58L19 11.46L19.68 12.35L20.2 13.23L20.12 14.12L19.5 15L18.88 15.88L18.8 16.77L19.32 17.65L20 18.54L20.24 19.42L19.85 20.31L19.15 21.19L18.76 22.08L19 22.96L19.64 23.85L19.87 24.73L19.66 25.62L19.5 26.5"
        />
        <path class={weaveYarn('stroke-signal')}
          d="M19.5 3.5L19.34 4.38L19.13 5.27L19.36 6.15L20 7.04L20.24 7.92L19.85 8.81L19.15 9.69L18.76 10.58L19 11.46L19.68 12.35L20.2 13.23L20.12 14.12L19.5 15L18.88 15.88L18.8 16.77L19.32 17.65L20 18.54L20.24 19.42L19.85 20.31L19.15 21.19L18.76 22.08L19 22.96L19.64 23.85L19.87 24.73L19.66 25.62L19.5 26.5"
        />
        <g clip-path="url(#you-weave-clip)">
          <path class={weaveGap}
            d="M3.5 10.5L4.38 10.66L5.27 10.87L6.15 10.64L7.04 10L7.92 9.76L8.81 10.15L9.69 10.85L10.58 11.24L11.46 11L12.35 10.32L13.23 9.8L14.12 9.88L15 10.5L15.88 11.12L16.77 11.2L17.65 10.68L18.54 10L19.42 9.76L20.31 10.15L21.19 10.85L22.08 11.24L22.96 11L23.85 10.36L24.73 10.13L25.62 10.34L26.5 10.5"
          />
          <path class={weaveYarn('stroke-clay')}
            d="M3.5 10.5L4.38 10.66L5.27 10.87L6.15 10.64L7.04 10L7.92 9.76L8.81 10.15L9.69 10.85L10.58 11.24L11.46 11L12.35 10.32L13.23 9.8L14.12 9.88L15 10.5L15.88 11.12L16.77 11.2L17.65 10.68L18.54 10L19.42 9.76L20.31 10.15L21.19 10.85L22.08 11.24L22.96 11L23.85 10.36L24.73 10.13L25.62 10.34L26.5 10.5"
          />
          <path class={weaveGap}
            d="M3.5 19.5L4.38 19.66L5.27 19.87L6.15 19.64L7.04 19L7.92 18.76L8.81 19.15L9.69 19.85L10.58 20.24L11.46 20L12.35 19.32L13.23 18.8L14.12 18.88L15 19.5L15.88 20.12L16.77 20.2L17.65 19.68L18.54 19L19.42 18.76L20.31 19.15L21.19 19.85L22.08 20.24L22.96 20L23.85 19.36L24.73 19.13L25.62 19.34L26.5 19.5"
          />
          <path class={weaveYarn('stroke-clay')}
            d="M3.5 19.5L4.38 19.66L5.27 19.87L6.15 19.64L7.04 19L7.92 18.76L8.81 19.15L9.69 19.85L10.58 20.24L11.46 20L12.35 19.32L13.23 18.8L14.12 18.88L15 19.5L15.88 20.12L16.77 20.2L17.65 19.68L18.54 19L19.42 18.76L20.31 19.15L21.19 19.85L22.08 20.24L22.96 20L23.85 19.36L24.73 19.13L25.62 19.34L26.5 19.5"
          />
        </g>
        <rect class="fill-ink" x="1.3" y="8.3" width="4.4" height="4.4" rx="0.55" />
        <rect class="fill-ink" x="24.3" y="8.3" width="4.4" height="4.4" rx="0.55" />
        <rect class="fill-ink" x="1.3" y="17.3" width="4.4" height="4.4" rx="0.55" />
        <rect class="fill-ink" x="24.3" y="17.3" width="4.4" height="4.4" rx="0.55" />
        <rect class="fill-ink" x="8.3" y="1.3" width="4.4" height="4.4" rx="0.55" />
        <rect class="fill-ink" x="8.3" y="24.3" width="4.4" height="4.4" rx="0.55" />
        <rect class="fill-ink" x="17.3" y="1.3" width="4.4" height="4.4" rx="0.55" />
        <rect class="fill-ink" x="17.3" y="24.3" width="4.4" height="4.4" rx="0.55" />
      </svg>
      <span class="min-w-0">
        <span class="block font-you text-[18px] leading-[1.1]">Eigenmesh</span>
        {#if userEmail}
          <small
            class="mt-px block max-w-[184px] overflow-hidden text-ellipsis whitespace-nowrap text-sm text-ink-3"
            >{userEmail}</small
          >
        {/if}
      </span>
    </div>

    <!-- Look: the same tab group as the pages' tabs, in miniature (ei .me-look) -->
    <div class="flex items-center justify-between gap-2.5 px-2.5 py-1.5">
      <span class="text-sm text-ink-2" aria-hidden="true">{m.you_look()}</span>
      <DropdownMenu.RadioGroup
        value={look}
        onValueChange={(v) => pickLook(v as LookPreference)}
        class="flex rounded-full bg-paper-2 p-0.5"
        aria-label={m.you_look()}
      >
        {#each lookOptions as option (option.value)}
          <DropdownMenu.RadioItem
            value={option.value}
            closeOnSelect={false}
            class={lookSeg}
          >
            {option.label()}
          </DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
    </div>

    <DropdownMenu.Group>
      <DropdownMenu.Item class={meItem} onclick={() => void goto(resolve('/settings'))}>
        {m.you_profile()}
      </DropdownMenu.Item>
      <DropdownMenu.Item class={meItem} onclick={() => void goto(resolve('/api-keys'))}>
        {m.you_api_keys()}
      </DropdownMenu.Item>
      <DropdownMenu.Item class={meItem} onclick={() => void goto(resolve('/activity'))}>
        {m.you_usage()}
      </DropdownMenu.Item>
    </DropdownMenu.Group>

    <DropdownMenu.Group>
      <DropdownMenu.Item class={`${meItem} text-ink-3`} onclick={() => void signOut()}>
        {m.you_sign_out()}
      </DropdownMenu.Item>
    </DropdownMenu.Group>
  </DropdownMenu.Content>
</DropdownMenu.Root>
