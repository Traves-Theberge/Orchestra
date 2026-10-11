import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import AnsiModule from 'ansi-to-react'
import katex from 'katex'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { spawnSync } from 'node:child_process'

const Ansi = AnsiModule.default ?? AnsiModule
test('patched ANSI linkifier retains links, colors and escaped output', () => {
  const html = renderToStaticMarkup(React.createElement(Ansi, { linkify: true }, '\u001b[31mSee https://example.com/task/42\u001b[0m <script>alert(1)</script> javascript:alert(2)'))
  assert.match(html, /href="https:\/\/example.com\/task\/42"/)
  assert.match(html, /color:/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /href="javascript:/)
  assert.doesNotMatch(html, /<script>/)
})

test('math rendering ignores inherited trust options', () => {
  const html = katex.renderToString(String.raw`\href{https://example.com/untrusted}{click}`, Object.create({ trust: true }))
  assert.doesNotMatch(html, /href="https:\/\/example.com\/untrusted"/)
})

test('patched math renderer remains compatible with the Markdown plugin pipeline', () => {
  const html = renderToStaticMarkup(React.createElement(ReactMarkdown, {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
    children: 'Inline $x^2$ and display:\n\n$$\n\\frac{1}{2}\n$$',
  }))
  assert.match(html, /class="katex"/)
  assert.match(html, /class="katex-display"/)
  assert.match(html, /<math /)
  assert.doesNotMatch(html, /katex-error/)
})

test('Electron downloader still initializes its patched proxy agent', () => {
  // Bootstrap changes global HTTP agents, so exercise the downloader in isolation.
  const result = spawnSync(process.execPath, ['-e', `
    const { createRequire } = require('node:module')
    const assert = require('node:assert/strict')
    const fromBuilder = createRequire(require.resolve('app-builder-lib/package.json'))
    fromBuilder('@electron/get').initializeProxy()
    assert.equal(global.GLOBAL_AGENT.HTTP_PROXY, 'http://127.0.0.1:9090')
  `], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, GLOBAL_AGENT_HTTP_PROXY: 'http://127.0.0.1:9090' },
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
})
