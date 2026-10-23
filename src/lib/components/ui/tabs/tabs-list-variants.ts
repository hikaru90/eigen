import { tv, type VariantProps } from 'tailwind-variants'

export const tabsListVariants = tv({
  base: 'rounded-full p-[3px] data-[variant=line]:rounded-none group/tabs-list text-ink-3 inline-flex w-fit items-center justify-center group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col',
  variants: {
    variant: {
      default: 'cn-tabs-list-variant-default bg-paper-2',
      line: 'cn-tabs-list-variant-line gap-1 bg-transparent',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

export type TabsListVariant = VariantProps<typeof tabsListVariants>['variant']
