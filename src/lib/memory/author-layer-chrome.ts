/** Shared author-layer visual tokens (graph legend, capture list, badges). */

/** Eigen / EigenMesh marketing accent — graph pop-in, community hulls. */
export const EIGEN_MESH_ACCENT = '#28F97F';

export const authorAgentChipClass =
	'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full bg-black px-2.5 py-1 text-xs font-medium leading-none text-white dark:bg-white dark:text-black';

export const authorAgentIconClass = 'text-[#28F97F]';

/** Graph legend — black square behind agent icon only; label stays plain text. */
export const authorAgentLegendIconFrameClass =
	'inline-flex shrink-0 items-center justify-center rounded-full bg-black p-0.5 dark:bg-white';

export const authorAgentLegendItemClass =
	'inline-flex w-full min-w-0 items-center justify-start gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-foreground hover:text-foreground focus-visible:ring-ring/50 transition-opacity focus-visible:ring-1 focus-visible:outline-none';

/** Plain label row — no box, full-contrast text and icon. */
export const authorUserLegendItemClass =
	'inline-flex w-full min-w-0 items-center justify-start gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-foreground hover:text-foreground focus-visible:ring-ring/50 transition-opacity focus-visible:ring-1 focus-visible:outline-none';

export function authorLegendItemStateClass(input: {
	filterActive: boolean;
	isSelected: boolean;
}): string {
	if (input.filterActive && input.isSelected) return 'bg-black/10 dark:bg-white/15';
	return '';
}

export function authorLegendItemClassForLayer(kind: 'user' | 'agent'): string {
	return kind === 'agent' ? authorAgentLegendItemClass : authorUserLegendItemClass;
}
