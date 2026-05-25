import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

marked.setOptions({
	gfm: true,
	breaks: true
});

const renderer = new marked.Renderer();
renderer.link = ({ href, title, text }) => {
	const safeHref = href ?? '';
	const titleAttr = title ? ` title="${title.replace(/"/g, '&quot;')}"` : '';
	return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};
marked.use({ renderer });

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
	ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'align']
};

/** Parse GitHub-flavored markdown to sanitized HTML for chat display. */
export function renderMarkdownToHtml(source: string): string {
	const trimmed = source.trim();
	if (!trimmed) return '';
	const raw = marked.parse(trimmed, { async: false });
	if (typeof raw !== 'string') return '';
	return DOMPurify.sanitize(raw, PURIFY_OPTIONS);
}
