import { writable } from 'svelte/store';

export const marketingScrollY = writable(0);
export const marketingSectionId = writable('topTarget');
export const marketingBackgroundClass = writable('bg-[#e8ede5]');

export type MarketingSectionTarget = {
	id: string;
	/** Scroll wrapper / nav backdrop (main column only; enterprise band uses its own bg-black). */
	bgClass: string;
};

export const marketingSectionTargets: MarketingSectionTarget[] = [
	{ id: 'topTarget', bgClass: 'bg-[#e8ede5]' },
	{ id: 'whySectionTarget', bgClass: 'bg-[#e8ede5]' },
	{ id: 'transparencySectionTarget', bgClass: 'bg-[#e8ede5]' },
	{ id: 'pricingSectionTarget', bgClass: 'bg-white' },
	{ id: 'aboutSectionTarget', bgClass: 'bg-[#e8ede5]' },
	{ id: 'faqSectionTarget', bgClass: 'bg-[#e8ede5]' },
	{ id: 'contactSectionTarget', bgClass: 'bg-black' }
];
