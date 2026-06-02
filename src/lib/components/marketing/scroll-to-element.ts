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

/** Scroll a tall section so its internal story progress lands on `targetProgress` (0–1). */
export function scrollSectionToProgress(
	sectionEl: HTMLElement,
	targetProgress: number,
	duration = 650,
	onComplete?: () => void
): void {
	if (!browser) return;

	const travel = sectionEl.offsetHeight - window.innerHeight;
	if (travel <= 0) {
		onComplete?.();
		return;
	}

	const clamped = Math.min(1, Math.max(0, targetProgress));
	const rect = sectionEl.getBoundingClientRect();
	const delta = rect.top + clamped * travel;
	const start = window.scrollY;
	const targetTop = start + delta;
	const change = targetTop - start;
	const startTime = performance.now();

	function step(currentTime: number) {
		const elapsed = currentTime - startTime;
		const t = Math.min(elapsed / duration, 1);
		window.scrollTo(0, start + change * easeInOutQuad(t));
		if (elapsed < duration) {
			requestAnimationFrame(step);
		} else {
			onComplete?.();
		}
	}

	requestAnimationFrame(step);
}
