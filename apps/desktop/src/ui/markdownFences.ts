import { mermaidKeyword, reflowSingleLineMermaid } from './mermaidReflow'

/**
 * Render-time normalization of assistant markdown so diagrams and HTML pages
 * render for every model and harness, including already-saved messages:
 *
 * - CRLF / CR newlines become LF.
 * - Fence info strings for html/htm/mermaid are lower-cased (`HTML` -> `html`,
 *   `htm` -> `html`), keeping any extra info (`html title="x"`).
 * - A mermaid/html fence indented 4+ spaces outside a list is dedented, so it
 *   is a fence instead of an indented code block showing literal backticks.
 * - Single-line Mermaid that a model collapsed into a code span
 *   (`` `flowchart LR A --> B` ``, ```` ```mermaid graph TD A-->B``` ````) or a
 *   one-line `~~~` fence is reflowed into a real ```mermaid block. When it
 *   cannot be reflowed safely it becomes a plain code block.
 *
 * Content inside real fences is never touched.
 */
export interface PreparedMarkdown {
  readonly content: string
  /** 1-based line of a fence that is never closed (streaming or truncated), else null. */
  readonly openFenceLine: number | null
}

const NORMALIZED_LANGS: Record<string, string> = { html: 'html', htm: 'html', xhtml: 'html', mermaid: 'mermaid' }
const FENCE_RE = /^( *)(`{3,}|~{3,})(.*)$/
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s/

function normalizeInfo(info: string): string {
  const match = /^(\s*)(\S+)(.*)$/.exec(info)
  if (!match) return info
  const lang = NORMALIZED_LANGS[match[2].toLowerCase()]
  return lang ? `${lang}${match[3]}` : info
}

function fenceLang(info: string): string {
  return NORMALIZED_LANGS[(/^\s*(\S+)/.exec(info)?.[1] ?? '').toLowerCase()] ?? ''
}

function isCloser(line: string, char: string, length: number, maxIndent: number): boolean {
  const match = /^( *)(`+|~+)\s*$/.exec(line)
  return !!match && match[1].length <= maxIndent && match[2][0] === char && match[2].length >= length
}

/** `> ` and list-item continuation prefix for lines inserted after `line`'s start. */
function continuationPrefix(line: string): { lead: string; rest: string } {
  const match = /^((?:\s*>\s?)*)(\s*)((?:[-*+]|\d+[.)])\s+)?/.exec(line)
  const quote = match?.[1] ?? ''
  const indent = match?.[2] ?? ''
  const marker = match?.[3] ?? ''
  return { lead: quote + indent + marker, rest: quote + indent + ' '.repeat(marker.length) }
}

function fencedBlock(lang: string, body: string, prefix: string): string {
  return ['', `\`\`\`${lang}`, ...body.split('\n'), '```', ''].map((l) => (l ? prefix + l : prefix.trimEnd())).join('\n')
}

/** Replaces single-line Mermaid code spans on a line outside fences. */
function repairInlineMermaid(line: string): string {
  if (!line.includes('`')) return line
  const { lead, rest } = continuationPrefix(line)
  const spans = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g
  let out = ''
  let last = 0
  let match: RegExpExecArray | null
  while ((match = spans.exec(line)) !== null) {
    const ticks = match[1]
    const inner = match[2].trim()
    if (!mermaidKeyword(inner)) continue
    const tagged = /^mermaid\s/i.test(inner)
    const reflowed = reflowSingleLineMermaid(inner)
    const before = line.slice(last, match.index)
    const after = line.slice(match.index + match[0].length)
    // A diagram-looking span inside a sentence is prose (e.g. "use `graph TD A-->B`"),
    // unless it is fence-like (``` / mermaid tag) or clearly a multi-statement diagram.
    const standalone = (last === 0 ? before.slice(lead.length) : before).trim() === '' && after.trim() === ''
    const fenceLike = ticks.length >= 3 || tagged
    if (reflowed && (standalone || fenceLike || reflowed.split('\n').length >= 4)) {
      out += before + fencedBlock('mermaid', reflowed, rest)
    } else if (!reflowed && fenceLike && reflowSourceHasBody(inner)) {
      out += before + fencedBlock('', inner.replace(/^mermaid\s+/i, ''), rest)
    } else {
      continue
    }
    last = match.index + match[0].length
  }
  if (last === 0) return line
  const tail = line.slice(last)
  return out + (tail.trim() ? `\n${rest}${tail.trim()}` : '')
}

function reflowSourceHasBody(source: string): boolean {
  const text = source.replace(/^mermaid\s+/i, '')
  const keyword = mermaidKeyword(text)
  return !!keyword && text.slice(keyword.length).trim().split(/\s+/).length >= 3
}

export function prepareMarkdown(input: string): PreparedMarkdown {
  if (!input) return { content: input, openFenceLine: null }
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let open: { char: string; length: number; line: number } | null = null
  let lineCount = 0
  const push = (text: string) => {
    out.push(text)
    lineCount += text.split('\n').length
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (open) {
      push(line)
      if (isCloser(line, open.char, open.length, 3)) open = null
      continue
    }
    const fence = FENCE_RE.exec(line)
    if (fence && !(fence[2][0] === '`' && fence[3].includes('`'))) {
      const [, indentText, marker, info] = fence
      const indent = indentText.length
      // One-line `~~~mermaid flowchart ... ~~~` would otherwise swallow the rest of the message.
      const oneLine = marker[0] === '~' ? new RegExp(`^(.*?)\\s*~{${marker.length},}\\s*$`).exec(info) : null
      if (oneLine && mermaidKeyword(oneLine[1])) {
        const reflowed = reflowSingleLineMermaid(oneLine[1])
        push(reflowed ? fencedBlock('mermaid', reflowed, '') : fencedBlock('', oneLine[1].trim().replace(/^mermaid\s+/i, ''), ''))
        continue
      }
      if (indent <= 3) {
        open = { char: marker[0], length: marker.length, line: lineCount + 1 }
        push(`${indentText}${marker}${normalizeInfo(info)}`)
        continue
      }
      // 4+ spaces: an indented code block in CommonMark. Dedent mermaid/html
      // fences that are not list continuations so they render as intended.
      const prevText = [...out].reverse().find((l) => l.trim() !== '') ?? ''
      const inList = LIST_ITEM_RE.test(prevText) || /^\s/.test(prevText)
      if (fenceLang(info) && !inList) {
        let close = i + 1
        while (close < lines.length && !isCloser(lines[close], marker[0], marker.length, indent)) close++
        if (close < lines.length) {
          const strip = new RegExp(`^ {0,${indent}}`)
          push(`${marker}${normalizeInfo(info)}`)
          for (let k = i + 1; k < close; k++) push(lines[k].replace(strip, ''))
          push(lines[close].trim())
          i = close
          continue
        }
      }
      push(line)
      continue
    }
    push(repairInlineMermaid(line))
  }
  return { content: out.join('\n'), openFenceLine: open ? open.line : null }
}

/** True when an html fence body is a full document or page worth previewing. */
export function looksLikeHtmlDocument(source: string): boolean {
  return /<!doctype\s+html|<html[\s>]|<body[\s>]|<svg[\s>]/i.test(source)
}
