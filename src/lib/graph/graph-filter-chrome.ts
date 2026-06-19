/** Shared frosted chrome for graph / timeline filter controls (matches bottom view tabs). */
const GRAPH_FILTER_GLASS_BASE =
	'border border-white/80 bg-white/20 shadow-xl shadow-black/5 backdrop-blur-md brightness-105 dark:bg-card';

/** Single-line pill controls (icon rows, popover triggers). */
export const GRAPH_FILTER_GLASS = `rounded-full ${GRAPH_FILTER_GLASS_BASE}`;

/** Expandable / multi-row panels — static corners, not pill shape. */
export const GRAPH_FILTER_GLASS_PANEL = `rounded-xl ${GRAPH_FILTER_GLASS_BASE}`;

/** Collapsed pill chrome; expanded panel chrome (rounded-xl). */
export function graphFilterGlassPanelClass(expanded: boolean): string {
	return expanded ? GRAPH_FILTER_GLASS_PANEL : GRAPH_FILTER_GLASS;
}

export const GRAPH_FILTER_GLASS_ROW = `${GRAPH_FILTER_GLASS} flex h-9 w-fit shrink-0 items-stretch gap-0.5 p-0.5`;

export function graphFilterTriggerClass(active: boolean): string {
	return `inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 ${
		active
			? 'bg-black text-white dark:bg-foreground dark:text-background'
			: 'text-black hover:text-black/80 dark:text-foreground dark:hover:text-foreground/80'
	}`;
}
