import { describe, expect, it } from 'vitest';
import {
	developerDocBySlug,
	developerDocSections,
	developerDocsNavbarItems,
	DEFAULT_DEVELOPER_DOC_SLUG
} from '$lib/docs/developer-nav';
import {
	extractDocTitle,
	getDeveloperDocEntry,
	loadDocSource,
	listLoadedDocFiles
} from '$lib/docs/doc-loader';
import {
	extractDeveloperDocFooterLinks,
	getDeveloperDocFooterLinks,
	getDeveloperDocPrevNextLinks
} from '$lib/docs/doc-link-resolve';
import {
	buildDeveloperDocSearchEntries,
	filterDeveloperDocSearchEntries
} from '$lib/docs/developer-doc-search';
import { renderDocMarkdownToHtml } from '$lib/docs/render-doc-markdown';

describe('developer documentation', () => {
	it('exposes one navbar link per doc section', () => {
		expect(developerDocsNavbarItems).toHaveLength(developerDocSections.length);
		for (const item of developerDocsNavbarItems) {
			expect(developerDocBySlug.has(item.slug)).toBe(true);
		}
	});

	it('has a default getting-started slug', () => {
		expect(DEFAULT_DEVELOPER_DOC_SLUG).toBe('getting-started');
		expect(developerDocBySlug.has(DEFAULT_DEVELOPER_DOC_SLUG)).toBe(true);
	});

	it('loads every curated nav markdown source', () => {
		const files = listLoadedDocFiles();
		for (const section of developerDocSections) {
			for (const item of section.items) {
				expect(files, `glob missing ${item.file}`).toContain(item.file);
				const source = loadDocSource(item.file);
				expect(source, item.file).toBeTruthy();
				expect(source!.length).toBeGreaterThan(20);
			}
		}
	});

	it('extracts title from README', () => {
		const source = loadDocSource('README.md');
		expect(source).toBeTruthy();
		expect(extractDocTitle(source!)).toBe('Eigen');
	});

	it('filters documentation search by label and slug tokens', () => {
		const entries = buildDeveloperDocSearchEntries();
		expect(entries.length).toBeGreaterThan(5);
		expect(filterDeveloperDocSearchEntries(entries, 'ingestion').some((h) => h.slug === 'ingestion')).toBe(
			true
		);
		expect(
			filterDeveloperDocSearchEntries(entries, 'capture queue').some((h) => h.slug === 'capture-queue')
		).toBe(true);
	});

	it('builds footer links from in-article developer doc references', () => {
		const source = loadDocSource('docs/repo-map/index.md');
		expect(source).toBeTruthy();
		const links = extractDeveloperDocFooterLinks(source!, 'docs/repo-map/index.md', 'architecture');
		const slugs = links.map((l) => l.slug);
		expect(slugs).toContain('ingestion');
		expect(slugs).toContain('capture-queue');
		expect(slugs).not.toContain('architecture');
	});

	it('falls back to section siblings when the article has no internal doc links', () => {
		const links = getDeveloperDocFooterLinks('no internal links', 'docs/foo.md', 'maintenance');
		expect(links).toEqual([{ label: 'Known conflicts', slug: 'conflicts' }]);
	});

	it('resolves previous and next pages in sidebar order', () => {
		expect(getDeveloperDocPrevNextLinks('getting-started')).toEqual({
			prev: null,
			next: { label: 'Onboarding & setup', slug: 'onboarding-and-setup' }
		});
		expect(getDeveloperDocPrevNextLinks('ingestion')).toEqual({
			prev: { label: 'Embeddings boundary', slug: 'embeddings-boundary' },
			next: { label: 'Retrieval', slug: 'retrieval' }
		});
		expect(getDeveloperDocPrevNextLinks('conflicts')).toEqual({
			prev: { label: 'Doc maintenance', slug: 'maintenance' },
			next: null
		});
	});

	it('rewrites internal markdown links to developer routes', () => {
		const html = renderDocMarkdownToHtml(
			'See [architecture](./docs/repo-map/index.md) for domains.',
			{ baseFile: 'README.md' }
		);
		expect(html).toContain('href="/developers/architecture"');
		expect(html).not.toContain('docs/repo-map/index.md');
	});

	it('returns 404 entry for unknown slug', () => {
		expect(getDeveloperDocEntry('not-a-real-page')).toBeUndefined();
	});
});
