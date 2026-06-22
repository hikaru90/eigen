/** Shared frosted chrome for graph / timeline filter controls (matches bottom view tabs). */
const GRAPH_FILTER_GLASS_BASE =
	'border border-white/80 bg-white/20 shadow-xl shadow-black/5 backdrop-blur-md brightness-105 dark:bg-card';

/** Pill cap for h-9 controls — half height, not 9999px (which explodes when a panel grows). */
const GRAPH_FILTER_PILL_RADIUS = 'rounded-[1.125rem]';

/** Single-line pill controls (icon rows, popover triggers). */
export const GRAPH_FILTER_GLASS = `rounded-full ${GRAPH_FILTER_GLASS_BASE}`;

/** Expanded filter panel — static top cap, rounded-xl bottom (original open state). */
export const GRAPH_FILTER_GLASS_PANEL = `${GRAPH_FILTER_GLASS_BASE} rounded-t-[1.125rem] rounded-b-xl`;

const GRAPH_FILTER_RADIUS_TRANSITION = 'transition-[border-radius] duration-200 ease-out';

/** Collapsed pill cap; expanded keeps the same static top radius, xl below. */
export function graphFilterGlassPanelClass(expanded: boolean): string {
	return expanded
		? `${GRAPH_FILTER_GLASS_PANEL} ${GRAPH_FILTER_RADIUS_TRANSITION}`
		: `${GRAPH_FILTER_GLASS_BASE} ${GRAPH_FILTER_PILL_RADIUS} ${GRAPH_FILTER_RADIUS_TRANSITION}`;
}

export const GRAPH_FILTER_GLASS_ROW = `${GRAPH_FILTER_GLASS} flex h-9 w-fit shrink-0 items-stretch gap-0.5 p-0.5`;

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
