import { describe, expect, it } from 'vitest'
import mermaid from 'mermaid'
import { looksLikeHtmlDocument, prepareMarkdown } from './markdownFences'
import { USER_SAMPLE } from './mermaidReflow.fixtures'

const mermaidBodies = (content: string) =>
  [...content.matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map((m) => m[1])

describe('prepareMarkdown', () => {
  it.each([
    ['single backticks', `\`${USER_SAMPLE}\``],
    ['double backticks', `\`\` ${USER_SAMPLE} \`\``],
    ['triple backticks with mermaid tag', `\`\`\`mermaid ${USER_SAMPLE}\`\`\``],
    ['triple backticks without tag', `\`\`\`${USER_SAMPLE}\`\`\``],
    ['one-line tilde fence', `~~~mermaid ${USER_SAMPLE} ~~~`],
  ])('reflows the reported one-line diagram wrapped in %s', async (_label, wrapped) => {
    const content = `Here is the signal chain:\n\n${wrapped}\n\n### Notes\nUse balanced cables.`
    const prepared = prepareMarkdown(content)
    const bodies = mermaidBodies(prepared.content)
    expect(bodies).toHaveLength(1)
    expect(await mermaid.parse(bodies[0], { suppressErrors: true })).toBeTruthy()
    expect(prepared.content).toContain('Here is the signal chain:')
    expect(prepared.content).toContain('### Notes\nUse balanced cables.')
    expect(prepared.openFenceLine).toBeNull()
  })

  it('keeps blockquote and list containers around a repaired diagram', () => {
    const quoted = prepareMarkdown('> `graph TD A[x] --> B[y]`').content
    expect(quoted).toContain('> ```mermaid\n> graph TD\n>     A[x] --> B[y]\n> ```')
    const listed = prepareMarkdown('1. `graph TD A[x] --> B[y]`').content
    expect(listed).toContain('   ```mermaid\n   graph TD\n       A[x] --> B[y]\n   ```')
  })

  it('leaves valid multi-line fences byte-identical (apart from CRLF)', () => {
    const valid = 'Intro\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n```ts\nconst x = `graph TD A-->B`\n```'
    expect(prepareMarkdown(valid).content).toBe(valid)
    expect(prepareMarkdown(valid.replace(/\n/g, '\r\n')).content).toBe(valid)
  })

  it.each([
    'Use `graph TD` to declare a top-down graph.',
    'The `flowchart` keyword and `sequenceDiagram` keyword differ.',
    'Inline example `graph LR A-->B` in a sentence stays inline.',
    'Run `pie --version` or `gitGraph` commands.',
    'Some `code` and a `graphql` query.',
    'Plain prose about graph theory, flowcharts and pie.',
    '`flowchart`',
  ])('does not rewrite prose: %s', (prose) => {
    expect(prepareMarkdown(prose).content).toBe(prose)
  })

  it('turns an unreflowable fenced one-liner into a plain code block', () => {
    const out = prepareMarkdown('```mermaid gantt title A dateFormat YYYY-MM-DD section S Task :a1, 2024-01-01, 30d```').content
    expect(out).toContain('```\ngantt title A dateFormat YYYY-MM-DD section S Task :a1, 2024-01-01, 30d\n```')
    expect(out).not.toContain('```mermaid')
  })

  it.each([
    ['```HTML\n<p>x</p>\n```', '```html\n<p>x</p>\n```'],
    ['```htm\n<p>x</p>\n```', '```html\n<p>x</p>\n```'],
    ['```Mermaid\ngraph TD\nA-->B\n```', '```mermaid\ngraph TD\nA-->B\n```'],
    ['```html title="x"\n<p>x</p>\n```', '```html title="x"\n<p>x</p>\n```'],
    ['~~~HTML\n<p>x</p>\n~~~', '~~~html\n<p>x</p>\n~~~'],
    ['  ```Mermaid\n  graph TD\n  ```', '  ```mermaid\n  graph TD\n  ```'],
    ['Text\n\n    ```mermaid\n    graph TD\n      A-->B\n    ```\n', 'Text\n\n```mermaid\ngraph TD\n  A-->B\n```\n'],
  ])('normalizes fence variant %j', (input, expected) => {
    expect(prepareMarkdown(input).content).toBe(expected)
  })

  it('leaves indented fences inside lists to CommonMark', () => {
    const listed = '- step\n\n    ```mermaid\n    graph TD\n    ```'
    expect(prepareMarkdown(listed).content).toBe(listed)
  })

  it('reports an unterminated fence line (streaming or truncated)', () => {
    expect(prepareMarkdown('a\n\n```html\n<!doctype html><html><bo').openFenceLine).toBe(3)
    expect(prepareMarkdown('a\r\n\r\n~~~html\r\n<html>').openFenceLine).toBe(3)
    expect(prepareMarkdown('```html\n<html></html>\n```').openFenceLine).toBeNull()
    expect(prepareMarkdown('`graph TD A[x]-->B`\n\n```html\n<html>').openFenceLine).toBe(8)
  })
})

describe('looksLikeHtmlDocument', () => {
  it.each([
    ['<!DOCTYPE html><html><body>x</body></html>', true],
    ['<html lang="en"><head></head></html>', true],
    ['<svg viewBox="0 0 10 10"><circle r="4"/></svg>', true],
    ['<body>\n<p>x</p>\n</body>', true],
    ['<div>hi</div>', false],
    ['<kbd>Ctrl</kbd>', false],
    ['<p>Hello <b>world</b></p>', false],
    ['<svgfoo>', false],
  ])('%s -> %s', (source, expected) => {
    expect(looksLikeHtmlDocument(source)).toBe(expected)
  })
})
