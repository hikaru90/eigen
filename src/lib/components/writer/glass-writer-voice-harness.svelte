<script lang="ts">
  import { untrack } from 'svelte'
  import { appendVoiceTranscript } from '$lib/capture/transcribe-audio'
  import GlassWriter from './glass-writer.svelte'

  /**
   * A page the way Capture / Ask / Contribute use the writer: the page owns the text,
   * appends each transcript to it, and sends through the writer's own submit.
   */
  let {
    initial = '',
    submitDisabled = false,
    onsubmitted,
    onvoicestart,
    onvoiceerror,
  }: {
    initial?: string
    submitDisabled?: boolean
    /** Called with the text exactly as it stands when the page's send runs. */
    onsubmitted: (text: string) => void
    onvoicestart?: () => void
    onvoiceerror?: (message: string) => void
  } = $props()

  let value = $state(untrack(() => initial))
  let voiceStop = $state<(() => void) | undefined>(undefined)

  export function stopVoice(): void {
    voiceStop?.()
  }
  export function hasVoiceStop(): boolean {
    return voiceStop !== undefined
  }
</script>

<GlassWriter
  bind:value
  bind:voiceStop
  placeholder="Write it down"
  submitLabel="Capture"
  inputTestId="writer-input"
  submitTestId="writer-send"
  {submitDisabled}
  onsubmit={() => onsubmitted(value)}
  {onvoicestart}
  ontranscript={(text) => {
    value = appendVoiceTranscript(value, text)
  }}
  {onvoiceerror}
/>
