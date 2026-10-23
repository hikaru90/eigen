<script lang="ts">
  import XIcon from '@lucide/svelte/icons/x'

  /** A plain line in the warn colour, no box: the mesh saying what went wrong. */
  type Props = {
    message: string
    class?: string
  }

  let { message, class: className = '' }: Props = $props()
</script>

<div
  class={[
    'flex items-start gap-2 min-w-0 py-0.5 font-mesh text-sm leading-[1.5] text-warn animate-[fade_0.5s_var(--ease)_both]',
    className,
  ]}
  role="alert"
>
  <span class="grid place-items-center w-4 h-5 shrink-0" aria-hidden="true"
    ><XIcon size={12} strokeWidth={1.5} /></span
  >
  <p class="min-w-0 m-0 [overflow-wrap:anywhere]">{message}</p>
</div>

