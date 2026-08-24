<script lang="ts">
  import { page } from '$app/state'
  import EigenWordmark from '$lib/components/eigen-wordmark.svelte'
  import { Button } from '$lib/components/ui/button'
  import { resolveAppPath } from '$lib/navigation/resolve-app-path'

  const isNotFound = $derived(page.status === 404)
</script>

<div class="mx-auto flex max-w-md flex-col items-center px-5 pt-16 text-center">
  <EigenWordmark heightClass="h-8" class="mb-8" />
  <p class="text-muted-foreground text-xs uppercase tracking-wider">{page.status}</p>
  <h1 class="mt-2 text-lg font-medium">
    {isNotFound ? 'Page not found' : 'Something went wrong'}
  </h1>
  {#if !isNotFound && page.error?.message}
    <p class="text-muted-foreground mt-2 text-xs">{page.error.message}</p>
  {/if}
  <Button href={resolveAppPath('/capture')} class="mt-8" size="lg">Back to capture</Button>
</div>
