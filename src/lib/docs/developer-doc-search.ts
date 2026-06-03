import { extractDocTitle, loadDocSource } from '$lib/docs/doc-loader';
import { developerDocSections } from '$lib/docs/developer-nav';

export type DeveloperDocSearchEntry = {
	slug: string;
	label: string;
	sectionTitle: string;
	title: string;
	haystack: string;
};

export function buildDeveloperDocSearchEntries(): DeveloperDocSearchEntry[] {
	return developerDocSections.flatMap((section) =>
		section.items.map((item) => {
			const source = loadDocSource(item.file) ?? '';
			const title = extractDocTitle(source) ?? item.label;
			const haystack = [item.label, item.slug, section.title, title, item.file.replaceAll('/', ' ')]
				.join(' ')
				.toLowerCase();

			return {
				slug: item.slug,
				label: item.label,
				sectionTitle: section.title,
				title,
				haystack
			};
		})
	);
}

export function filterDeveloperDocSearchEntries(
	entries: DeveloperDocSearchEntry[],
	query: string
): DeveloperDocSearchEntry[] {
	const trimmed = query.trim().toLowerCase();
	if (!trimmed) return entries;

	const tokens = trimmed.split(/\s+/).filter(Boolean);
	return entries.filter((entry) => tokens.every((token) => entry.haystack.includes(token)));
}
