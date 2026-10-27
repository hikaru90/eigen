<script lang="ts">
  /**
   * Test fixture for `overlay-scroll.svelte.spec.ts`: a Popover or a Select open on
   * mount with many entries, rendered through the real `ui/` primitives.
   */
  import * as Popover from '$lib/components/ui/popover'
  import * as Select from '$lib/components/ui/select'

  let { kind, count = 40 }: { kind: 'popover' | 'select'; count?: number } = $props()

  const entries = $derived(Array.from({ length: count }, (_, i) => i + 1))
</script>

{#if kind === 'popover'}
  <Popover.Root open>
    <Popover.Trigger data-testid="trigger">Open</Popover.Trigger>
    <Popover.Content data-testid="overlay-content">
      {#each entries as n (n)}
        <button type="button" data-testid="entry-{n}" class="block w-full py-2 text-left">
          Entry {n}
        </button>
      {/each}
    </Popover.Content>
  </Popover.Root>
{:else}
  <Select.Root type="single" open>
    <Select.Trigger data-testid="trigger">Open</Select.Trigger>
    <Select.Content data-testid="overlay-content">
      {#each entries as n (n)}
        <Select.Item value={String(n)} label="Entry {n}" data-testid="entry-{n}" />
      {/each}
    </Select.Content>
  </Select.Root>
{/if}
