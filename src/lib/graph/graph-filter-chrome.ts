/** Shared frosted chrome for graph / timeline filter controls (matches bottom view tabs). */
const GRAPH_FILTER_GLASS_BASE =
  'border border-white/80 bg-white/20 shadow-xl shadow-black/5 backdrop-blur-md brightness-105 dark:border-white/15 dark:bg-black/45 dark:backdrop-blur-xl dark:brightness-100'

/** Single-line pill controls (icon rows, popover triggers). */
export const GRAPH_FILTER_GLASS = `rounded-full ${GRAPH_FILTER_GLASS_BASE}`

/** Graph filter shell — collapsed row and expanded panel share rounded-2xl corners. */
export const GRAPH_FILTER_GLASS_PANEL = `${GRAPH_FILTER_GLASS_BASE} rounded-[19px]`

export function graphFilterGlassPanelClass(_expanded: boolean): string {
  return GRAPH_FILTER_GLASS_PANEL
}

export const GRAPH_FILTER_GLASS_ROW = `${GRAPH_FILTER_GLASS_PANEL} flex flex-col w-fit shrink-0 items-stretch gap-0.5 p-0.5`

/** Popover panels — same frosted chrome as the icon row, not default shadcn popover surface. */
export const GRAPH_FILTER_GLASS_POPOVER = `${GRAPH_FILTER_GLASS_BASE} rounded-[19px] text-foreground ring-0`

/** Select dropdown menus — match graph/memory frosted popover chrome. */
export const GRAPH_FILTER_GLASS_SELECT = GRAPH_FILTER_GLASS_POPOVER

/** Fits within graph overlay padding (left-3 right-3); popover is align-end on the toolbar. */
export const GRAPH_FILTER_POPOVER_WIDTH = 'w-[min(18rem,calc(100vw-1.5rem))]'

export function graphFilterTriggerClass(
  active: boolean,
  variant: 'icon' | 'label' = 'icon',
): string {
  const sizeClass =
    variant === 'icon'
      ? 'inline-flex size-8 shrink-0 items-center justify-center'
      : 'inline-flex h-8 min-w-0 items-center justify-start gap-1.5 px-3 text-left'
  const showActive = active && variant === 'icon'
  return `${sizeClass} rounded-full text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 ${
    showActive
      ? 'bg-black text-white dark:bg-foreground dark:text-background'
      : 'text-black hover:text-black/80 dark:text-foreground dark:hover:text-foreground/80'
  }`
}
