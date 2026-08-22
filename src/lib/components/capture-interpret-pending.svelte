<script lang="ts">
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle'
  import { interpretPendingView } from '$lib/capture/interpret-pending'

  type Props = {
    raw: string
  }

  let { raw }: Props = $props()
  const view = $derived(interpretPendingView(raw))
</script>

<div
  class="bg-white dark:bg-card border-2 border-black dark:border-border shadow-[8px_8px_0px_0px_#000] dark:shadow-none px-4 py-3"
  data-testid="capture-interpret-pending"
  role="status"
  aria-live="polite"
  aria-label="Capture in progress"
>
  <p class="text-sm text-foreground line-clamp-2 leading-snug">{view.preview}</p>
  <p class="text-xs text-muted-foreground mt-0.5">{view.statusLabel}</p>
  <div class="mt-3 pt-3 border-t-2 border-black/10 dark:border-border">
    <div class="flex items-start gap-3 p-3 bg-primary/5 rounded-lg border border-primary/20">
      <LoaderCircleIcon
        class="size-4 animate-spin text-primary shrink-0 mt-0.5"
        aria-hidden="true"
      />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-foreground">{view.stepTitle}</p>
        <p class="text-muted-foreground text-xs mt-0.5 leading-relaxed">{view.stepDescription}</p>
      </div>
    </div>
  </div>
</div>
