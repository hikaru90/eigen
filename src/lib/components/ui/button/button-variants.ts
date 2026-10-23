import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements'
import { type VariantProps, tv } from 'tailwind-variants'
import { type WithElementRef } from '$lib/utils.js'

export const buttonVariants = tv({
  base: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-full border-0 bg-clip-padding font-mesh text-sm font-normal focus-visible:ring-1 active:not-aria-[haspopup]:translate-y-px aria-invalid:ring-1 [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  variants: {
    variant: {
      default: 'bg-ink text-paper pointer-fine:hover:bg-ink/85',
      outline:
        'bg-transparent text-ink-2 shadow-[inset_0_0_0_1px_var(--ink-4)] pointer-fine:hover:text-ink pointer-fine:hover:shadow-[inset_0_0_0_1px_var(--ink-3)] aria-expanded:text-ink',
      secondary:
        'bg-paper-2 text-ink pointer-fine:hover:bg-paper-2/70 aria-expanded:bg-paper-2',
      ghost:
        'bg-transparent text-ink-2 pointer-fine:hover:text-ink pointer-fine:hover:bg-paper-2 aria-expanded:text-ink',
      destructive:
        'bg-transparent text-warn shadow-[inset_0_0_0_1px_var(--warn)] pointer-fine:hover:bg-warn/10',
      link: 'h-auto px-0 text-ink-2 underline-offset-4 pointer-fine:hover:text-ink pointer-fine:hover:underline',
    },
    size: {
      default:
        'h-[34px] gap-2 px-4 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
      xs: "h-6 gap-1 px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
      sm: "h-[30px] gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
      lg: 'h-10 gap-2 px-5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
      icon: 'size-[34px]',
      'icon-xs': "size-6 [&_svg:not([class*='size-'])]:size-3",
      'icon-sm': 'size-7',
      'icon-lg': 'size-9',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
})

export type ButtonVariant = VariantProps<typeof buttonVariants>['variant']
export type ButtonSize = VariantProps<typeof buttonVariants>['size']

export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
  WithElementRef<HTMLAnchorAttributes> & {
    variant?: ButtonVariant
    size?: ButtonSize
  }
