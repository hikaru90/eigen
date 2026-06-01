import { developerDocBySlug, type DeveloperDocEntry } from '$lib/docs/developer-nav';

const docModules = {
	...import.meta.glob('../../../docs/**/*.md', {
		query: '?raw',
		import: 'default',
		eager: true
	}),
	...import.meta.glob('../../../README.md', {
		query: '?raw',
		import: 'default',
		eager: true
	})
} as Record<string, string>;

/** Normalize Vite glob keys to repo-relative paths. */
function normalizeGlobKey(key: string): string {
	const withoutPrefix = key.replace(/^\.\.\/\.\.\/\.\.\//, '');
	return withoutPrefix === 'README.md' ? 'README.md' : withoutPrefix;
}

const sourcesByFile = new Map<string, string>(
	Object.entries(docModules).map(([key, source]) => [normalizeGlobKey(key), source])
);

export function getDeveloperDocEntry(slug: string): DeveloperDocEntry | undefined {
	return developerDocBySlug.get(slug);
}

export function loadDocSource(file: string): string | undefined {
	return sourcesByFile.get(file);
}

/** First markdown H1, else undefined. */
export function extractDocTitle(source: string): string | undefined {
	const match = source.match(/^#\s+(.+)$/m);
	return match?.[1]?.trim();
}

export function listLoadedDocFiles(): string[] {
	return [...sourcesByFile.keys()];
}
