import { describe, expect, it } from 'vitest'
import { renderMarkdownToHtml } from './render-markdown'

describe('renderMarkdownToHtml', () => {
  it('renders bold from double asterisks', () => {
    const html = renderMarkdownToHtml('**bold** text')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).not.toContain('**')
  })

  it('renders italic, lists, and inline code', () => {
    const html = renderMarkdownToHtml('*italic*\n\n- one\n- two\n\n`code`')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>')
    expect(html).toContain('<code>code</code>')
  })

  it('strips script tags from raw HTML', () => {
    const html = renderMarkdownToHtml('<script>alert(1)</script>hello')
    expect(html).not.toContain('<script')
    expect(html).toContain('hello')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(renderMarkdownToHtml('   \n  ')).toBe('')
  })

  it('never shows thought ids: every citation wire form is dropped from display', () => {
    const forms = [
      'Named Alex [bb1313d8-3056-4b11-9206-55dcedbf0657].',
      'Named Alex [id=bb1313d8-3056-4b11-9206-55dcedbf0657].',
      'Named Alex [<id=bb1313d8-3056-4b11-9206-55dcedbf0657>].',
    ]
    for (const line of forms) {
      const html = renderMarkdownToHtml(line)
      expect(html).toBe('<p>Named Alex.</p>\n')
      expect(html).not.toContain('bb1313d8')
      expect(html).not.toContain('chat-citation')
    }
  })

  it('keeps line structure when a citation ends a list item', () => {
    const html = renderMarkdownToHtml('- One [id=t1]\n- Two [id=t2]')
    expect(html).toContain('<li>One</li>')
    expect(html).toContain('<li>Two</li>')
    expect(html).not.toContain('t1')
  })

  it('drops [id=uuid] citations inside profile-style Details text', () => {
    const html = renderMarkdownToHtml(
      'Details: - You are named Alex [id=bb1313d8-3056-4b11-9206-55dcedbf0657] - You need to respond to Lilli tonight [id=d428954a-aae1-4565-a162-9f38b5536d2e]',
    )
    expect(html).toBe('<p>Details: - You are named Alex - You need to respond to Lilli tonight</p>\n')
  })
})
