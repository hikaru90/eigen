<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui'
  import type { ComponentProps } from 'svelte'

  let { ...restProps }: ComponentProps<typeof DialogPrimitive.Trigger> = $props()
</script>

<DialogPrimitive.Trigger {...restProps} />
