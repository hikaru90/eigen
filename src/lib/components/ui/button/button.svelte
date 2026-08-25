<script lang="ts">
  /* eslint-disable svelte/no-navigation-without-resolve -- generic anchor: internal paths use resolve(); external href requires rel="external" */
  import { resolveAppPath } from '$lib/navigation/resolve-app-path'
  import { cn } from '$lib/utils.js'
  import { buttonVariants, type ButtonProps } from './button-variants.js'

  let {
    class: className,
    variant = 'default',
    size = 'default',
    ref = $bindable(null),
    href = undefined,
    type = 'button',
    disabled,
    children,
    ...restProps
  }: ButtonProps = $props()
</script>

{#if href}
  <a
    bind:this={ref}
    data-slot="button"
    class={cn(buttonVariants({ variant, size }), className)}
    href={typeof href === 'string' && href.startsWith('/') && !href.startsWith('//')
      ? resolveAppPath(href)
      : href}
    aria-disabled={disabled}
    role={disabled ? 'link' : undefined}
    tabindex={disabled ? -1 : undefined}
    {...restProps}
  >
    {@render children?.()}
  </a>
{:else}
  <button
    bind:this={ref}
    data-slot="button"
    class={cn(buttonVariants({ variant, size }), className)}
    {type}
    {disabled}
    {...restProps}
  >
    {@render children?.()}
  </button>
{/if}
