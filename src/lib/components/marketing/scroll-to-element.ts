import { browser } from '$app/environment';

function easeInOutQuad(t: number): number {
	return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function scrollToElement(element: HTMLElement, duration = 400): void {
	if (!browser) return;

	const container = document.documentElement;
	const targetTop = element.getBoundingClientRect().top + container.scrollTop - 80;
	const start = container.scrollTop;
	const change = targetTop - start;
	const startTime = performance.now();

	function step(currentTime: number) {
		const elapsed = currentTime - startTime;
		const progress = Math.min(elapsed / duration, 1);
		container.scrollTop = start + change * easeInOutQuad(progress);
		if (elapsed < duration) requestAnimationFrame(step);
	}

	requestAnimationFrame(step);
}

export function scrollToSectionId(sectionId: string, duration = 400): void {
	if (!browser) return;
	const el = document.getElementById(sectionId);
	if (el) scrollToElement(el, duration);
}
