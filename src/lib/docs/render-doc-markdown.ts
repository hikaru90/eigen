import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';
import { developerDocFileToSlug } from '$lib/docs/developer-nav';

marked.setOptions({
	gfm: true,
	breaks: true
});

const PURIFY_OPTIONS: DOMPurify.Config = {
	ALLOWED_TAGS: [
		'p',
		'br',
		'strong',
		'em',
		'del',
		's',
		'code',
		'pre',
		'blockquote',
		'ul',
		'ol',
		'li',
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'a',
		'hr',
		'table',
		'thead',
		'tbody',
		'tr',
		'th',
		'td'
	],
	ALLOWED_ATTR: ['href', 'title', 'id', 'align']
};

export type RenderDocMarkdownOptions = {
	baseFile: string;
	fileToSlug?: Map<string, string>;
};

function resolveRepoRelativePath(baseFile: string, href: string): string | null {
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

function docHrefToAppRoute(
	href: string,
	baseFile: string,
	fileToSlug: Map<string, string>
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

/** Parse markdown from repo docs; rewrite internal `.md` links to `/developers/{slug}`. */
export function renderDocMarkdownToHtml(
	source: string,
	options: RenderDocMarkdownOptions
): string {
	const trimmed = source.trim();
	if (!trimmed) return '';

	const fileToSlug = options.fileToSlug ?? developerDocFileToSlug;

	const renderer = new marked.Renderer();
	renderer.link = ({ href, title, text }) => {
		const rawHref = href ?? '';
		const appRoute = docHrefToAppRoute(rawHref, options.baseFile, fileToSlug);
		const finalHref = appRoute ?? rawHref;
		const isInternal = appRoute !== null;
		const titleAttr = title ? ` title="${title.replace(/"/g, '&quot;')}"` : '';
		const targetAttr = isInternal ? '' : ' target="_blank" rel="noopener noreferrer"';
		return `<a href="${finalHref}"${titleAttr}${targetAttr}>${text}</a>`;
	};

	const raw = marked.parse(trimmed, { async: false, renderer });
	if (typeof raw !== 'string') return '';
	return DOMPurify.sanitize(raw, PURIFY_OPTIONS);
}
