<script lang="ts">
  import CircleX from "@lucide/svelte/icons/circle-x";

  type Props = {
    message: string;
    class?: string;
  };

  let { message, class: className = "" }: Props = $props();
</script>

<div
  class="flex min-w-0 items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-sm leading-snug text-destructive dark:bg-destructive/10 {className}"
  role="alert"
>
  <CircleX class="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
  <p class="min-w-0 break-all">{message}</p>
</div>
