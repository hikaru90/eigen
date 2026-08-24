<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import { Dialog as DialogPrimitive } from 'bits-ui'

  let { ...restProps }: ComponentProps<typeof DialogPrimitive.Close> = $props()
</script>

<DialogPrimitive.Close {...restProps} />
