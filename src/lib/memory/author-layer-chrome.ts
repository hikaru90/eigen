/** Shared author-layer visual tokens (graph legend, capture list, badges). */

/** Eigen / EigenMesh marketing accent — graph pop-in, community hulls. */
export const EIGEN_MESH_ACCENT = '#22E876'

export const authorAgentChipClass =
  'inline-flex max-w-full min-w-0 items-center gap-2 rounded-full bg-black px-3 py-1.5 text-sm font-medium leading-none text-white dark:bg-white dark:text-black'

export const authorAgentChipClassSm =
  'inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-black px-2 py-0.5 text-[10px] font-medium leading-none text-white dark:bg-white dark:text-black'

export const authorUserChipClass =
  'inline-flex max-w-full min-w-0 items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-sm font-medium leading-none text-foreground'

export const authorUserChipClassSm =
  'inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium leading-none text-foreground'

export const authorAgentIconClass = 'text-[var(--color-eigen-green)]'

/** Graph legend — black square behind agent icon only; label stays plain text. */
export const authorAgentLegendIconFrameClass =
  'inline-flex shrink-0 items-center justify-center rounded-full bg-black p-0.5 dark:bg-white'

export const authorAgentLegendItemClass =
  'inline-flex w-full min-w-0 items-center justify-start gap-2 rounded-full px-3 py-2 text-sm font-medium text-foreground hover:text-foreground focus-visible:ring-ring/50 transition-opacity focus-visible:ring-1 focus-visible:outline-none'

/** Plain label row — no box, full-contrast text and icon. */
export const authorUserLegendItemClass =
  'inline-flex w-full min-w-0 items-center justify-start gap-2 rounded-full px-3 py-2 text-sm font-medium text-foreground hover:text-foreground focus-visible:ring-ring/50 transition-opacity focus-visible:ring-1 focus-visible:outline-none'

export function authorLegendItemStateClass(input: {
  filterActive: boolean
  isSelected: boolean
}): string {
  if (input.filterActive && input.isSelected) return 'bg-black/10 dark:bg-white/15'
  return ''
}

export function authorLegendItemClassForLayer(kind: 'user' | 'agent'): string {
  return kind === 'agent' ? authorAgentLegendItemClass : authorUserLegendItemClass
}

export function authorChipClassFor(
  kind: 'user' | 'agent',
  size: 'default' | 'sm' = 'default',
): string {
  if (kind === 'agent') {
    return size === 'sm' ? authorAgentChipClassSm : authorAgentChipClass
  }
  return size === 'sm' ? authorUserChipClassSm : authorUserChipClass
}
