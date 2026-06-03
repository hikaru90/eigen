import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';
import { developerDocFileToSlug } from '$lib/docs/developer-nav';
import { resolveDeveloperDocHref } from '$lib/docs/doc-link-resolve';

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
		const appRoute = resolveDeveloperDocHref(rawHref, options.baseFile, fileToSlug);
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
