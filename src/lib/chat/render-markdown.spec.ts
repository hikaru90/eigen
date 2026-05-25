import { describe, expect, it } from 'vitest';
import { renderMarkdownToHtml } from './render-markdown';

describe('renderMarkdownToHtml', () => {
	it('renders bold from double asterisks', () => {
		const html = renderMarkdownToHtml('**bold** text');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).not.toContain('**');
	});

	it('renders italic, lists, and inline code', () => {
		const html = renderMarkdownToHtml('*italic*\n\n- one\n- two\n\n`code`');
		expect(html).toContain('<em>italic</em>');
		expect(html).toContain('<ul>');
		expect(html).toContain('<li>');
		expect(html).toContain('<code>code</code>');
	});

	it('strips script tags from raw HTML', () => {
		const html = renderMarkdownToHtml('<script>alert(1)</script>hello');
		expect(html).not.toContain('<script');
		expect(html).toContain('hello');
	});

	it('returns empty string for whitespace-only input', () => {
		expect(renderMarkdownToHtml('   \n  ')).toBe('');
	});
});
