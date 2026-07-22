import { marked } from 'marked'
import DOMPurify from 'isomorphic-dompurify'
import { citationDisplayLabel, replaceCitationTokens } from './citation-tokens'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Turn raw citation tokens into compact inline citation chips for chat display. */
export function formatCitationTokens(source: string): string {
  return replaceCitationTokens(source, (id) => {
    const safeId = escapeHtml(id)
    const label = escapeHtml(citationDisplayLabel(id))
    return `<span class="chat-citation" title="Source ${safeId}">${label}</span>`
  })
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
    'td',
    'span',
  ],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'align', 'class'],
}

/** Parse GitHub-flavored markdown to sanitized HTML for chat display. */
export function renderMarkdownToHtml(source: string): string {
  const trimmed = source.trim()
  if (!trimmed) return ''
  const raw = marked.parse(formatCitationTokens(trimmed), { async: false })
  if (typeof raw !== 'string') return ''
  return DOMPurify.sanitize(raw, PURIFY_OPTIONS)
}
