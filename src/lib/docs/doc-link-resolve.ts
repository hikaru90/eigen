import { developerDocBySlug, developerDocSections, developerDocFileToSlug } from '$lib/docs/developer-nav';

export type DeveloperDocFooterLink = {
	label: string;
	slug: string;
	/** Optional hash suffix (e.g. `#section`) without leading `#`. */
	hash?: string;
};

const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

export function resolveRepoRelativePath(baseFile: string, href: string): string | null {
	const hashIndex = href.indexOf('#');
	const pathPart = (hashIndex >= 0 ? href.slice(0, hashIndex) : href).trim();
	if (!pathPart || pathPart.startsWith('http://') || pathPart.startsWith('https://')) {
		return null;
	}
	if (pathPart.startsWith('/developers')) {
		return null;
	}

	let resolved = pathPart;
	if (!pathPart.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(pathPart)) {
		const baseDir = baseFile.includes('/') ? baseFile.slice(0, baseFile.lastIndexOf('/')) : '';
		const segments = [...(baseDir ? baseDir.split('/') : []), ...pathPart.split('/')];
		const stack: string[] = [];
		for (const segment of segments) {
			if (segment === '' || segment === '.') continue;
			if (segment === '..') {
				stack.pop();
				continue;
			}
			stack.push(segment);
		}
		resolved = stack.join('/');
	}

	if (resolved === 'README.md' || resolved.endsWith('/README.md')) {
		return 'README.md';
	}
	if (resolved.startsWith('docs/') && resolved.endsWith('.md')) {
		return resolved;
	}
	return null;
}

export function resolveDeveloperDocHref(
	href: string,
	baseFile: string,
	fileToSlug: Map<string, string> = developerDocFileToSlug
): string | null {
	const hashIndex = href.indexOf('#');
	const hash = hashIndex >= 0 ? href.slice(hashIndex) : '';
	const pathPart = hashIndex >= 0 ? href.slice(0, hashIndex) : href;

	const repoPath = resolveRepoRelativePath(baseFile, pathPart);
	if (!repoPath) return null;

	const slug = fileToSlug.get(repoPath);
	if (!slug) return null;

	return `/developers/${slug}${hash}`;
}

/** Internal developer-doc links from markdown (first-mention order, deduped). */
export function extractDeveloperDocFooterLinks(
	source: string,
	baseFile: string,
	currentSlug: string,
	fileToSlug: Map<string, string> = developerDocFileToSlug
): DeveloperDocFooterLink[] {
	const seen = new Set<string>();
	const links: DeveloperDocFooterLink[] = [];

	for (const match of source.matchAll(MARKDOWN_LINK_RE)) {
		const label = match[1].trim();
		const rawHref = match[2].trim();
		const appRoute = resolveDeveloperDocHref(rawHref, baseFile, fileToSlug);
		if (!appRoute) continue;

		const routeMatch = appRoute.match(/^\/developers\/([^#]+)(?:#(.*))?$/);
		if (!routeMatch) continue;

		const slug = routeMatch[1];
		const hash = routeMatch[2];
		if (slug === currentSlug && !hash) continue;

		const key = `${slug}#${hash ?? ''}`;
		if (seen.has(key)) continue;
		seen.add(key);

		const entry = developerDocBySlug.get(slug);
		links.push({
			label: label || entry?.label || slug,
			slug,
			hash
		});
	}

	return links;
}

/** Sibling pages in the same sidebar section (excluding current). */
export function getDeveloperDocSectionSiblingLinks(slug: string): DeveloperDocFooterLink[] {
	for (const section of developerDocSections) {
		if (!section.items.some((item) => item.slug === slug)) continue;
		return section.items
			.filter((item) => item.slug !== slug)
			.map((item) => ({ label: item.label, slug: item.slug }));
	}
	return [];
}

/** Footer links: in-article internal links, else siblings in the same section. */
export function getDeveloperDocFooterLinks(
	source: string,
	baseFile: string,
	currentSlug: string
): DeveloperDocFooterLink[] {
	const extracted = extractDeveloperDocFooterLinks(source, baseFile, currentSlug);
	if (extracted.length > 0) return extracted;
	return getDeveloperDocSectionSiblingLinks(currentSlug);
}

const developerDocNavOrder = developerDocSections.flatMap((section) => section.items);

/** Previous and next pages in sidebar order (global doc sequence). */
export function getDeveloperDocPrevNextLinks(currentSlug: string): {
	prev: DeveloperDocFooterLink | null;
	next: DeveloperDocFooterLink | null;
} {
	const index = developerDocNavOrder.findIndex((item) => item.slug === currentSlug);
	if (index < 0) return { prev: null, next: null };

	const prevEntry = index > 0 ? developerDocNavOrder[index - 1] : null;
	const nextEntry =
		index < developerDocNavOrder.length - 1 ? developerDocNavOrder[index + 1] : null;

	return {
		prev: prevEntry ? { label: prevEntry.label, slug: prevEntry.slug } : null,
		next: nextEntry ? { label: nextEntry.label, slug: nextEntry.slug } : null
	};
}
