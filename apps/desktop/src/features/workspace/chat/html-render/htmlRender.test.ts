import { describe, expect, it } from 'vitest'
import {
  clampHtmlRenderHeight,
  extractHtmlRenderFromContent,
  extractHtmlRenderFromEvents,
  extractHtmlRendersFromContent,
  extractHtmlRendersFromEvents,
  HTML_RENDER_COLUMN_WIDTH,
  HTML_RENDER_MAX_HEIGHT,
  HTML_RENDER_MIN_HEIGHT,
  htmlRenderFileName,
  htmlRenderFrameHeight,
  htmlRenderFromToolItem,
  htmlRenderReferencesEqual,
  htmlRenderResult,
  htmlRenderTheme,
  htmlRenderThemeFragment,
  htmlRenderThemeMessage,
  injectHtmlRenderBootstrap,
  readHtmlRenderContentHeight,
  readHtmlRenderLinkRequest,
  readHtmlRenderReference,
} from './htmlRender'

describe('htmlRender protocol and helpers', () => {
  it('clamps heights to bounds', () => {
    expect(clampHtmlRenderHeight(20)).toBe(HTML_RENDER_MIN_HEIGHT)
    expect(clampHtmlRenderHeight(5000)).toBe(HTML_RENDER_MAX_HEIGHT)
    expect(clampHtmlRenderHeight(450.4)).toBe(450)
  })

  it('reads and validates HtmlRenderReference', () => {
    const valid = readHtmlRenderReference({
      attachmentId: 'att-123',
      title: 'Monthly Analytics',
      height: 450,
      heights: [[320, 600], [728, 450]],
    })
    expect(valid).toBeDefined()
    expect(valid?.attachmentId).toBe('att-123')
    expect(valid?.title).toBe('Monthly Analytics')
    expect(valid?.height).toBe(450)
    expect(valid?.heights).toEqual([[320, 600], [728, 450]])

    const inlineHtml = readHtmlRenderReference({
      title: 'Inline Mockup',
      height: 300,
      html: '<div>Hello</div>',
    })
    expect(inlineHtml).toBeDefined()
    expect(inlineHtml?.html).toBe('<div>Hello</div>')

    expect(readHtmlRenderReference(null)).toBeUndefined()
    expect(readHtmlRenderReference({ height: 'invalid' })).toBeUndefined()
  })

  it('checks equality between HtmlRenderReferences', () => {
    const a = {
      attachmentId: 'att-1',
      title: 'Chart',
      height: 400,
      heights: [[320, 500], [728, 400]] as const,
    }
    const b = {
      attachmentId: 'att-1',
      title: 'Chart',
      height: 400,
      heights: [[320, 500], [728, 400]] as const,
    }
    const c = {
      attachmentId: 'att-2',
      title: 'Chart',
      height: 400,
    }

    expect(htmlRenderReferencesEqual(a, b)).toBe(true)
    expect(htmlRenderReferencesEqual(a, c)).toBe(false)
  })

  it('computes frame height with responsive breakpoints and capping', () => {
    const reference = {
      title: 'Test Page',
      height: 500,
      heights: [
        [320, 700],
        [728, 500],
        [1000, 420],
      ] as const,
    }

    // Exact match for 728px column width
    expect(htmlRenderFrameHeight(reference, 728)).toBe(500)
    // Mobile width selects taller measured height
    expect(htmlRenderFrameHeight(reference, 360)).toBe(700)
    // Larger desktop width
    expect(htmlRenderFrameHeight(reference, 900)).toBe(500)

    // With explicit reported contentHeight
    expect(htmlRenderFrameHeight(reference, 728, 480)).toBe(480)
  })

  it('sanitizes titles for download file names', () => {
    expect(htmlRenderFileName('Test: Report <2026>?')).toBe('Test Report 2026.html')
    expect(htmlRenderFileName('   ')).toBe('visualization.html')
    expect(htmlRenderFileName('Clean Title')).toBe('Clean Title.html')
  })

  it('generates theme variables for light and dark modes', () => {
    const dark = htmlRenderTheme({}, 'dark')
    expect(dark.appearance).toBe('dark')
    expect(dark.variables['--background']).toBe('#0a0a0a')
    expect(dark.variables['--chart-1']).toBeDefined()
    expect(dark.variables['--chart-6']).toBeDefined()

    const light = htmlRenderTheme({}, 'light')
    expect(light.appearance).toBe('light')
    expect(light.variables['--background']).toBe('#fcfcfc')
  })

  it('encodes and decodes theme messages and fragments', () => {
    const theme = htmlRenderTheme({}, 'dark')
    const fragment = htmlRenderThemeFragment(theme)
    expect(fragment).toContain('#orchestra-theme=')

    const message = htmlRenderThemeMessage(theme)
    expect(message.jsonrpc).toBe('2.0')
    expect(message.method).toBe('ui/notifications/host-context-changed')
    expect(message.params.theme).toBe('dark')
    expect(message.params.styles.variables['--background']).toBeDefined()
  })

  it('parses size-changed JSON-RPC notifications', () => {
    expect(
      readHtmlRenderContentHeight({
        jsonrpc: '2.0',
        method: 'ui/notifications/size-changed',
        params: { height: 620 },
      }),
    ).toBe(620)

    expect(readHtmlRenderContentHeight({ jsonrpc: '1.0' })).toBeUndefined()
    expect(readHtmlRenderContentHeight({ method: 'other' })).toBeUndefined()
    expect(
      readHtmlRenderContentHeight({
        jsonrpc: '2.0',
        method: 'ui/notifications/size-changed',
        params: { height: -5 },
      }),
    ).toBeUndefined()
  })

  it('parses open-link JSON-RPC requests', () => {
    const valid = readHtmlRenderLinkRequest({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'ui/open-link',
      params: { url: 'https://example.com/docs' },
    })
    expect(valid).toEqual({ id: 'req-1', url: 'https://example.com/docs' })

    // Reject non-http(s) links like javascript: or file:
    expect(
      readHtmlRenderLinkRequest({
        jsonrpc: '2.0',
        id: 'req-2',
        method: 'ui/open-link',
        params: { url: 'javascript:alert(1)' },
      }),
    ).toBeUndefined()

    expect(htmlRenderResult('req-1')).toEqual({
      jsonrpc: '2.0',
      id: 'req-1',
      result: {},
    })
  })

  it('injects bootstrap script into HTML head', () => {
    const docWithHead = '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>'
    const result = injectHtmlRenderBootstrap(docWithHead)
    expect(result).toContain('<style id="orchestra-theme">')
    expect(result).toContain('getElementById("orchestra-theme")')
    expect(result).toContain('"orchestra-link-"')
    expect(result).toContain('ResizeObserver')
    expect(result).toContain('host-context-changed')

    // Document without head
    const simple = '<div>Just a card</div>'
    const bootstrappedSimple = injectHtmlRenderBootstrap(simple)
    expect(bootstrappedSimple).toContain('<head>')
    expect(bootstrappedSimple).toContain('<style id="orchestra-theme">')
    expect(bootstrappedSimple).toContain('<div>Just a card</div>')
  })

  it('extracts htmlRender from completed tool items', () => {
    const toolItem = {
      toolName: 'html_render',
      output: {
        htmlRender: {
          title: 'Active Users',
          height: 400,
          html: '<div>Chart</div>',
        },
      },
    }
    const extracted = htmlRenderFromToolItem(toolItem)
    expect(extracted).toBeDefined()
    expect(extracted?.title).toBe('Active Users')
    expect(extracted?.html).toBe('<div>Chart</div>')

    expect(htmlRenderFromToolItem({ toolName: 'bash' })).toBeUndefined()
  })

  it('extracts inline fenced visualizations from message markdown', () => {
    const markdown = `
Here are the user statistics:

\`\`\`orchestra-html
<!-- title: Slophouse Insights -->
<div class="metrics">
  <h3>85.0k</h3>
</div>
\`\`\`

The top 10% of users sent 65% of turns.
`
    const extracted = extractHtmlRenderFromContent(markdown)
    expect(extracted).toBeDefined()
    expect(extracted?.htmlRender.title).toBe('Slophouse Insights')
    expect(extracted?.htmlRender.html).toContain('85.0k')
    expect(extracted?.cleanedText).toContain('Here are the user statistics:')
    expect(extracted?.cleanedText).toContain('The top 10% of users sent 65% of turns.')
    expect(extracted?.cleanedText).not.toContain('```orchestra-html')
  })

  it('extracts every html_render tool result in a turn as variants, in order', () => {
    const events = [
      { type: 'item/toolCall/completed', payload: { toolName: 'html_render', output: { htmlRender: { title: 'First', height: 300, html: '<p>1</p>' } } } },
      { type: 'item/toolCall/completed', payload: { toolName: 'bash', output: 'ok' } },
      { type: 'item/toolCall/started', payload: { toolName: 'html_render', output: { title: 'Ignored', height: 300, html: '<p>x</p>' } } },
      { type: 'item/toolCall/completed', payload: { toolName: 'mcp:html_render', output: JSON.stringify({ title: 'Second', height: 400, html: '<p>2</p>' }) } },
      { type: 'item/toolCall/completed', payload: null },
    ]
    const renders = extractHtmlRendersFromEvents(events)
    expect(renders.map(render => render.title)).toEqual(['First', 'Second'])
    expect(extractHtmlRenderFromEvents(events)?.title).toBe('First')
    expect(extractHtmlRendersFromEvents([])).toEqual([])
  })

  it('extracts every closed inline html fence as variants and removes them from the text', () => {
    const markdown = [
      'Two directions:',
      '',
      '```orchestra-html',
      '<!-- title: Calm -->',
      '<div>calm</div>',
      '```',
      '',
      '',
      '',
      '```html-visualization',
      '<h1>Bold <em>take</em></h1>',
      '```',
      '',
      '```html-preview',
      '<div>untitled</div>',
      '```',
      '',
      '```typescript',
      'const kept = true',
      '```',
      '',
      'Pick one.',
    ].join('\n')
    const { renders, cleanedText } = extractHtmlRendersFromContent(markdown)
    expect(renders.map(render => render.title)).toEqual(['Calm', 'Bold take', 'Visualization'])
    expect(renders[0]?.html).toContain('<div>calm</div>')
    expect(renders[0]?.height).toBe(500)
    expect(cleanedText).not.toContain('orchestra-html')
    expect(cleanedText).not.toContain('html-visualization')
    expect(cleanedText).toContain('```typescript')
    expect(cleanedText.startsWith('Two directions:')).toBe(true)
    expect(cleanedText.endsWith('Pick one.')).toBe(true)
    expect(cleanedText).not.toMatch(/\n{3,}/)
  })

  it('leaves unclosed or empty inline fences and plain text untouched', () => {
    expect(extractHtmlRendersFromContent('')).toEqual({ renders: [], cleanedText: '' })
    const unclosed = 'Working on it\n```orchestra-html\n<div>partial'
    expect(extractHtmlRendersFromContent(unclosed)).toEqual({ renders: [], cleanedText: unclosed })
    const empty = 'Empty:\n```orchestra-html\n\n```'
    expect(extractHtmlRendersFromContent(empty).renders).toEqual([])
    expect(extractHtmlRendersFromContent(empty).cleanedText).toContain('```orchestra-html')
  })
})
