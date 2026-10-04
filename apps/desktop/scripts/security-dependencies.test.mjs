import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import AnsiModule from 'ansi-to-react'

const Ansi = AnsiModule.default ?? AnsiModule
test('patched ANSI linkifier retains links, colors and escaped output', () => {
  const html = renderToStaticMarkup(React.createElement(Ansi, { linkify: true }, '\u001b[31mSee https://example.com/task/42\u001b[0m <script>alert(1)</script> javascript:alert(2)'))
  assert.match(html, /href="https:\/\/example.com\/task\/42"/)
  assert.match(html, /color:/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /href="javascript:/)
  assert.doesNotMatch(html, /<script>/)
})
