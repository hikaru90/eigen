import type { Config } from 'dompurify'
import DOMPurify from 'isomorphic-dompurify'
import { marked } from 'marked'
import { CITATION_TOKEN_RE } from './citation-tokens'

/**
 * Drop citation tokens from chat display: Ask never shows thought ids — the thoughts
 * used to answer appear as memory cards instead. Leading spaces before a token go too.
 */
const CITATION_DISPLAY_RE = new RegExp(`[ \\t]*${CITATION_TOKEN_RE.source}`, 'g')

export function stripCitationTokensForDisplay(source: string): string {
  return source.replace(CITATION_DISPLAY_RE, '')
}

marked.setOptions({
  gfm: true,
  breaks: true,
})

const renderer = new marked.Renderer()
renderer.link = ({ href, title, text }) => {
  const safeHref = href ?? ''
  const titleAttr = title ? ` title="${title.replace(/"/g, '&quot;')}"` : ''
  return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
}
marked.use({ renderer })

const PURIFY_OPTIONS: Config = {
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
    'td',
    'span',
  ],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'align', 'class'],
}

/** Parse GitHub-flavored markdown to sanitized HTML for chat display. */
export function renderMarkdownToHtml(source: string): string {
  const trimmed = source.trim()
  if (!trimmed) return ''
  const raw = marked.parse(stripCitationTokensForDisplay(trimmed), { async: false })
  if (typeof raw !== 'string') return ''
  return String(DOMPurify.sanitize(raw, PURIFY_OPTIONS))
}
