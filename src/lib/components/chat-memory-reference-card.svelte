<script lang="ts">
  import { citationDisplayLabel } from '$lib/chat/citation-tokens'

  type Props = {
    id?: string
    text: string
    category?: string
  }

  let { id, text, category }: Props = $props()
</script>

<li class="flex flex-col gap-1.5 rounded-md border border-border bg-muted px-3 py-2">
  {#if id}
    <span
      class="chat-citation chat-citation--block w-fit"
      title="Source {id}"
      aria-label="Memory id"
    >
      {citationDisplayLabel(id)}
    </span>
  {/if}
  <p class="min-w-0 break-all text-sm leading-snug text-foreground">{text}</p>
  {#if category}
    <span class="text-xs capitalize tracking-wide text-muted-foreground">{category}</span>
  {/if}
</li>
