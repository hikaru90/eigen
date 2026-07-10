/** Shared frosted chrome for graph / timeline filter controls (matches bottom view tabs). */
const GRAPH_FILTER_GLASS_BASE =
	'border border-white/80 bg-white/20 shadow-xl shadow-black/5 backdrop-blur-md brightness-105 dark:bg-card';

/** Single-line pill controls (icon rows, popover triggers). */
export const GRAPH_FILTER_GLASS = `rounded-full ${GRAPH_FILTER_GLASS_BASE}`;

/** Graph filter shell — collapsed row and expanded panel share rounded-2xl corners. */
export const GRAPH_FILTER_GLASS_PANEL = `${GRAPH_FILTER_GLASS_BASE} rounded-[20px]`;

export function graphFilterGlassPanelClass(_expanded: boolean): string {
	return GRAPH_FILTER_GLASS_PANEL;
}

export const GRAPH_FILTER_GLASS_ROW = `${GRAPH_FILTER_GLASS_PANEL} flex flex-col w-fit shrink-0 items-stretch gap-0.5 p-0.5`;

/** Popover panels — same frosted chrome as the icon row, not default shadcn popover surface. */
export const GRAPH_FILTER_GLASS_POPOVER = `${GRAPH_FILTER_GLASS_BASE} rounded-xl text-foreground ring-0`;

/** Fits within graph overlay padding (left-3 right-3); popover is align-end on the toolbar. */
export const GRAPH_FILTER_POPOVER_WIDTH = 'w-[min(18rem,calc(100vw-1.5rem))]';

export function graphFilterTriggerClass(active: boolean): string {
	return `inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 ${
		active
			? 'bg-black text-white dark:bg-foreground dark:text-background'
			: 'text-black hover:text-black/80 dark:text-foreground dark:hover:text-foreground/80'
	}`;
}
