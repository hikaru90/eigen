<script lang="ts">
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import Mic from '@lucide/svelte/icons/mic'
  import { browser } from '$app/environment'
  import { isVoiceRecordingSupported } from '$lib/capture/voice-message'
  import { Button } from '$lib/components/ui/button'
  import { m } from '$lib/paraglide/messages.js'

  /**
   * The mic: one tap hands over to the caller, which starts the voice message
   * (`$lib/capture/voice-message`) from inside this click. While the browser's permission
   * prompt is open (`starting`) it shows a working spinner and cannot be tapped twice.
   */
  let {
    disabled = false,
    starting = false,
    onclick,
    class: className = '',
  }: {
    disabled?: boolean
    starting?: boolean
    onclick: () => void
    class?: string
  } = $props()

  const micSupported = $derived(browser && isVoiceRecordingSupported())
</script>

<Button
  type="button"
  variant="ghost"
  size="icon"
  class="relative size-8 overflow-hidden text-ink-3 pointer-fine:hover:bg-transparent pointer-fine:hover:text-ink {className}"
  disabled={disabled || starting || !micSupported}
  {onclick}
  aria-label={m.voice_start()}
  aria-busy={starting}
  data-testid="voice-mic"
>
  {#if starting}
    <LoaderCircle class="size-4 shrink-0 animate-spin" strokeWidth={1.75} />
  {:else}
    <Mic class="size-4 shrink-0" strokeWidth={1.75} />
  {/if}
</Button>
