import { writable } from 'svelte/store';

export const marketingScrollY = writable(0);
export const marketingSectionId = writable('topTarget');
export const marketingBackgroundClass = writable('bg-white');

export type MarketingSectionTarget = {
	id: string;
	/** Scroll wrapper / nav backdrop (main column only; enterprise band uses its own bg-black). */
	bgClass: string;
};

export const marketingSectionTargets: MarketingSectionTarget[] = [
	{ id: 'topTarget', bgClass: 'bg-white' },
	{ id: 'flowSectionTarget', bgClass: 'bg-[#f0f3f0]' },
	{ id: 'uspsSectionTarget', bgClass: 'bg-white' },
	{ id: 'transparencySectionTarget', bgClass: 'bg-[#e8ede5]' },
	{ id: 'newsletterSectionTarget', bgClass: 'bg-white' },
	{ id: 'aboutSectionTarget', bgClass: 'bg-[#f0f3f0]' },
	{ id: 'faqSectionTarget', bgClass: 'bg-white' },
	{ id: 'contactSectionTarget', bgClass: 'bg-black' }
];
