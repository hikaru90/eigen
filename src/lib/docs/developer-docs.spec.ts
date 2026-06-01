import { describe, expect, it } from 'vitest';
import {
	developerDocBySlug,
	developerDocSections,
	DEFAULT_DEVELOPER_DOC_SLUG
} from '$lib/docs/developer-nav';
import {
	extractDocTitle,
	getDeveloperDocEntry,
	loadDocSource,
	listLoadedDocFiles
} from '$lib/docs/doc-loader';
import { renderDocMarkdownToHtml } from '$lib/docs/render-doc-markdown';

describe('developer documentation', () => {
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
