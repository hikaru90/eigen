/** Clearance below fixed marketing nav (safe area + pill nav row). */
export const developerDocsHeaderOffsetClass =
	'pt-[calc(env(safe-area-inset-top,0)+5.5rem)]';

/** Fixed sidebar: below marketing nav + extra top padding, viewport left edge. */
export const developerDocsSidebarPositionClass =
	'top-[calc(env(safe-area-inset-top,0)+7rem)] left-4 md:pt-2';

export const developerDocsSidebarMaxHeightClass =
	'md:max-h-[calc(100dvh-env(safe-area-inset-top,0)-7rem)]';

/** Same horizontal frame as docs marketing nav (`max-w-[1200px] px-4`). */
export const developerDocsMainColumnClass = 'mx-auto w-full max-w-[1200px] px-4';

/**
 * Main content horizontal inset: always 1rem (`px-4`) on the left at `md+`, plus sidebar clearance when needed.
 * Do not pair with `px-4` on the same node — `md:pl` would override the left side of `px-4`.
 */
export const developerDocsMainContentInsetClass =
	'px-4 md:pl-[calc(1rem+max(0px,calc(16rem-(max(0px,(100vw-75rem)/2)+1rem))))]';
