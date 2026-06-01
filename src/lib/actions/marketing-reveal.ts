import { browser } from '$app/environment';

/**
 * Sets `data-visible="true"` when the element enters the viewport.
 * Pair with Tailwind `is-visible:*` utilities in layout.css.
 */
export function marketingReveal(
	node: HTMLElement,
	options?: { offset?: number; threshold?: number; once?: boolean }
) {
	if (!browser) return {};

	const offset = options?.offset ?? 0;
	const threshold = options?.threshold ?? 0.1;
	const once = options?.once ?? true;

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					(entry.target as HTMLElement).dataset.visible = 'true';
					if (once) observer.unobserve(entry.target);
				} else if (!once) {
					delete (entry.target as HTMLElement).dataset.visible;
				}
			}
		},
		{
			root: null,
			rootMargin: `${offset}px`,
			threshold
		}
	);

	observer.observe(node);

	return {
		destroy() {
			observer.disconnect();
		}
	};
}
