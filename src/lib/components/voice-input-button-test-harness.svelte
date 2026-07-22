<script lang="ts">
  import VoiceInputButton from './voice-input-button.svelte'

  let {
    onstart,
    onstop,
    ontranscript,
    onpartialtranscript,
    onerror,
  }: {
    onstart?: () => void
    onstop?: () => void
    ontranscript: (text: string) => void
    onpartialtranscript?: (text: string) => void
    onerror?: (message: string) => void
  } = $props()

  let stopRef: (() => void) | undefined = $state()
  export { stopRef }
</script>

<VoiceInputButton bind:stopRef {onstart} {onstop} {ontranscript} {onpartialtranscript} {onerror} />
