<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import { Dialog as DialogPrimitive } from 'bits-ui'

  let { ...restProps }: ComponentProps<typeof DialogPrimitive.Trigger> = $props()
</script>

<DialogPrimitive.Trigger {...restProps} />
