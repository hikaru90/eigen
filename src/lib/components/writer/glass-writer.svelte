<script lang="ts">
  import type { Snippet } from 'svelte'
  import CornerDownLeft from '@lucide/svelte/icons/corner-down-left'
  import Square from '@lucide/svelte/icons/square'
  import MeshSpinner from '$lib/components/brand/mesh-spinner.svelte'
  import { portal } from '$lib/components/chrome/portal'
  import VoiceInputButton from '$lib/components/voice-input-button.svelte'
  import { hapticPress } from '$lib/haptics'

  /**
   * The one writer (Ask, Capture, Contribute): a wide glass pill docked above the bottom
   * nav, outside the page mask. One right-hand slot holds the mic while the field is empty
   * (or while recording) and the send action once there are words; while `busy` with an
   * `onstop`, it holds Stop. Small page controls go in `above`, a quiet row over the field.
   * On a keyboard Enter submits and Shift+Enter is a newline; on touch (coarse pointer) Enter
   * is always a newline and the send button sends. With `busyLabel`, `busy` lays a veil with
   * that label over the field and locks it, so nothing is sent twice. The send action sits
   * centred on one line and drops to the last line once the text wraps. The docked height is published as
   * `--glass-writer-height` on <html> so pages can pad their content clear of it.
   */
  type Props = {
    value?: string
    placeholder: string
    /** Accessible name for the field (defaults to the placeholder). */
    label?: string
    /** Accessible name for the send action. */
    submitLabel: string
    disabled?: boolean
    /** Disables sending (field stays editable unless `disabled`). */
    submitDisabled?: boolean
    busy?: boolean
    /** While `busy`, cover the field with this label and lock it (no edits, no resend). */
    busyLabel?: string
    maxLength?: number
    onsubmit: () => void
    /** With `busy`, the slot becomes Stop. */
    onstop?: () => void
    oninput?: (event: Event) => void
    /** Runs before the writer's own Enter handling; `preventDefault()` claims the key. */
    onkeydown?: (event: KeyboardEvent) => void
    onfocus?: () => void
    /** Voice: present when `ontranscript` is given. */
    onvoicestart?: () => void
    ontranscript?: (text: string) => void
    onpartialtranscript?: (text: string) => void
    onvoiceerror?: (message: string) => void
    voiceStop?: (() => void) | undefined
    /** The textarea, for focus / caret / the capture fly. */
    input?: HTMLTextAreaElement | null
    /** The docked root, for pages that forward wheel/touch to their own scroller. */
    root?: HTMLFormElement | null
    inputTestId?: string
    submitTestId?: string
    spellcheck?: boolean
    above?: Snippet
  }

  let {
    value = $bindable(''),
    placeholder,
    label,
    submitLabel,
    disabled = false,
    submitDisabled = false,
    busy = false,
    busyLabel,
    maxLength,
    onsubmit,
    onstop,
    oninput,
    onkeydown,
    onfocus,
    onvoicestart,
    ontranscript,
    onpartialtranscript,
    onvoiceerror,
    voiceStop = $bindable(),
    input = $bindable(null),
    root = $bindable(null),
    inputTestId,
    submitTestId,
    spellcheck,
    above,
  }: Props = $props()

  const hasText = $derived(value.trim().length > 0)
  const hasVoice = $derived(ontranscript !== undefined)
  const recording = $derived(voiceStop !== undefined)
  /** The one slot: stop while busy, mic while empty or recording, send otherwise. */
  const slot = $derived<'stop' | 'mic' | 'send'>(
    busy && onstop ? 'stop' : hasVoice && (!hasText || recording) ? 'mic' : 'send',
  )
  const canSend = $derived(hasText && !disabled && !busy && !submitDisabled)
  const veiled = $derived(busy && !!busyLabel)
  /** The text wraps past one line: the action drops to the bottom. Set by `trackLines`. */
  let multiline = $state(false)

  export function focus(): void {
    input?.focus()
  }

  function submit(): void {
    if (!canSend) return
    hapticPress() // in the gesture, before any await: both haptic channels need that
    onsubmit()
  }

  function handleKeydown(e: KeyboardEvent): void {
    onkeydown?.(e)
    if (e.defaultPrevented) return
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
    // a phone keyboard's return key writes a line break; the send button sends
    if (window.matchMedia('(pointer: coarse)').matches) return
    e.preventDefault()
    submit()
  }

  /** Line count from the field's own size: on resize (field-sizing) and on every input. */
  function trackLines(node: HTMLTextAreaElement) {
    const measure = () => {
      const style = getComputedStyle(node)
      const lineHeight = parseFloat(style.lineHeight)
      const content =
        node.scrollHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      multiline = content > lineHeight * 1.5
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    node.addEventListener('input', measure)
    return {
      destroy() {
        observer.disconnect()
        node.removeEventListener('input', measure)
      },
    }
  }

  /** Publishes the docked height for page padding; set from the observer, not reactively. */
  function publishHeight(node: HTMLElement) {
    const doc = document.documentElement
    const observer = new ResizeObserver(() => {
      doc.style.setProperty('--glass-writer-height', `${node.getBoundingClientRect().height}px`)
    })
    observer.observe(node)
    return {
      destroy() {
        observer.disconnect()
        doc.style.removeProperty('--glass-writer-height')
      },
    }
  }

  const slotButton =
    'grid place-items-center shrink-0 size-9 p-0 border-0 rounded-full bg-ink text-paper cursor-pointer [transition:opacity_0.3s_var(--ease),transform_0.4s_var(--ease)] disabled:cursor-default disabled:opacity-40 hover:enabled:-translate-y-px'
</script>

<form
  bind:this={root}
  use:portal
  use:publishHeight
  class="fixed left-1/2 z-[34] flex flex-col gap-2 w-[calc(100vw-32px)] max-w-[760px] -translate-x-1/2 bottom-[calc(var(--bottom-nav)+12px)] [view-transition-name:glass-writer]"
  data-testid="glass-writer"
  autocomplete="off"
  onsubmit={(e) => {
    e.preventDefault()
    submit()
  }}
>
  {#if above}
    <div class="flex flex-col gap-2 px-1" data-testid="glass-writer-above">
      {@render above()}
    </div>
  {/if}
  <div
    class="glass-field relative flex items-center justify-between gap-2 min-h-[52px] rounded-[26px] py-2 pl-5 pr-2"
    data-testid="glass-writer-field"
  >
    <textarea
      bind:this={input}
      use:trackLines
      bind:value
      class="block flex-1 min-w-0 [field-sizing:content] max-h-[min(40svh,240px)] py-1.5 border-0 outline-none resize-none overflow-y-auto [scrollbar-width:none] bg-transparent font-mesh text-[17px] leading-6 text-ink caret-signal placeholder:text-ink-2 disabled:opacity-55"
      rows="1"
      {placeholder}
      aria-label={label ?? placeholder}
      maxlength={maxLength}
      {spellcheck}
      disabled={disabled || veiled}
      data-testid={inputTestId}
      {oninput}
      onkeydown={handleKeydown}
      onfocus={() => {
        voiceStop?.()
        onfocus?.()
      }}></textarea>
    <!-- the one action slot: centred with one line of text, on the last line once it wraps -->
    <div
      class={['flex shrink-0', multiline && 'self-end']}
      data-testid="glass-writer-slot"
      data-multiline={multiline}
    >
      {#if slot === 'stop'}
        <button
          type="button"
          class={slotButton}
          aria-label="Stop"
          data-testid="glass-writer-stop"
          onclick={() => onstop?.()}
        >
          <Square size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      {:else if slot === 'mic'}
        <VoiceInputButton
          disabled={disabled || busy}
          class="size-9 rounded-full bg-ink text-paper pointer-fine:hover:bg-ink pointer-fine:hover:text-paper disabled:opacity-40"
          bind:stopRef={voiceStop}
          onstart={onvoicestart}
          ontranscript={(text) => ontranscript?.(text)}
          {onpartialtranscript}
          onerror={onvoiceerror}
        />
      {:else}
        <button
          type="submit"
          class={slotButton}
          aria-label={submitLabel}
          title={submitLabel}
          disabled={!canSend}
          data-testid={submitTestId}
        >
          <CornerDownLeft size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      {/if}
    </div>
    {#if veiled}
      <!-- the veil: what is happening, over the field, so the same words aren't sent twice -->
      <div
        class="absolute inset-0 z-10 flex items-center gap-2.5 pl-5 pr-4 rounded-[inherit] bg-paper/85 backdrop-blur-[2px] text-[15px] text-ink-2 animate-[fade_0.3s_var(--ease)_both]"
        role="status"
        aria-live="polite"
        data-testid="glass-writer-busy"
      >
        <MeshSpinner size={20} working />
        <span>{busyLabel}</span>
      </div>
    {/if}
  </div>
</form>
