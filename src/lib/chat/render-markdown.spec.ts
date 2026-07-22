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

  it('renders thought id citations as styled chips', () => {
    const html = renderMarkdownToHtml('You are home. [829b4cc7-ee30-403f-975b-f4663f52eb00]')
    expect(html).toContain('class="chat-citation"')
    expect(html).toContain('829b4cc7…')
    expect(html).toContain('title="Source 829b4cc7-ee30-403f-975b-f4663f52eb00"')
    expect(html).not.toContain('[829b4cc7')
  })

  it('renders [<id=uuid>] citations from compose-answer output', () => {
    const html = renderMarkdownToHtml(
      'You are working from home today. [<id=d2af9064-8fbe-490a-856a-ccaee8410516>]',
    )
    expect(html).toContain('class="chat-citation"')
    expect(html).toContain('d2af9064…')
    expect(html).not.toContain('[<id=')
    expect(html).not.toContain('<id=d2af9064')
  })

  it('renders [id=uuid] citations without angle brackets', () => {
    const html = renderMarkdownToHtml('You are home. [id=d428954a-aae1-4565-a162-9f38b5536d2e]')
    expect(html).toContain('class="chat-citation"')
    expect(html).toContain('d428954a…')
    expect(html).toContain('title="Source d428954a-aae1-4565-a162-9f38b5536d2e"')
    expect(html).not.toContain('[id=d428954a')
  })

  it('keeps short citation ids intact in chip labels', () => {
    const html = renderMarkdownToHtml('Fact [t1] here.')
    expect(html).toContain('>t1<')
  })

  it('renders all citation wire forms as the same chip', () => {
    const forms = [
      'Named Alex [bb1313d8-3056-4b11-9206-55dcedbf0657]',
      'Named Alex [id=bb1313d8-3056-4b11-9206-55dcedbf0657]',
      'Named Alex [<id=bb1313d8-3056-4b11-9206-55dcedbf0657>]',
    ]
    for (const line of forms) {
      const html = renderMarkdownToHtml(line)
      expect(html).toContain('class="chat-citation"')
      expect(html).toContain('bb1313d8…')
      expect(html).toContain('title="Source bb1313d8-3056-4b11-9206-55dcedbf0657"')
      expect(html).not.toContain('[bb1313d8')
      expect(html).not.toContain('[id=bb1313d8')
      expect(html).not.toContain('[<id=')
    }
  })

  it('renders [id=uuid] citations inside profile-style Details text', () => {
    const html = renderMarkdownToHtml(
      'Details: - You are named Alex [id=bb1313d8-3056-4b11-9206-55dcedbf0657] - You need to respond to Lilli tonight [id=d428954a-aae1-4565-a162-9f38b5536d2e]',
    )
    expect(html).toContain('bb1313d8…')
    expect(html).toContain('d428954a…')
    expect(html).not.toContain('[id=bb1313d8')
    expect(html).not.toContain('[id=d428954a')
  })
})
