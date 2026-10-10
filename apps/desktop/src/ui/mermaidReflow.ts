/**
 * Reflows a Mermaid diagram that a model collapsed onto ONE line back into
 * one statement per line. One-line Mermaid is not valid Mermaid, so this is a
 * best-effort repair: it returns null whenever the statement boundaries are
 * ambiguous (callers then show the source as a plain code block).
 *
 * Pure and synchronous; validity is checked later by `mermaid.parse` in
 * MermaidBlock, which falls back to showing the source.
 */

export const MERMAID_DIAGRAM_KEYWORDS = [
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram-v2', 'stateDiagram',
  'erDiagram', 'gantt', 'pie', 'journey', 'mindmap', 'timeline', 'gitGraph',
] as const

const KEYWORD_RE = new RegExp(`^(${MERMAID_DIAGRAM_KEYWORDS.map((k) => k.replace('-', '\\-')).join('|')})(?=\\s|$)`)

/** The diagram keyword a one-line source starts with (after an optional `mermaid` tag). */
export function mermaidKeyword(source: string): string | null {
  const match = KEYWORD_RE.exec(stripMermaidTag(source))
  return match ? match[1] : null
}

function stripMermaidTag(source: string): string {
  return source.trim().replace(/^mermaid\s+/i, '')
}

interface TokenizeOptions {
  /** Split flowchart/state links (`A-->B`) into their own tokens. */
  splitLinks?: boolean
  /** Treat () [] {} as grouping (kept inside one token). */
  brackets?: boolean
}

const OPEN: Record<string, string> = { '[': ']', '(': ')', '{': '}' }
const CLOSE = new Set([']', ')', '}'])
// A complete link (`-->`, `---`, `-.->`, `==>`, `<-->`, `--x`, `~~~`, longer variants), or the
// opening half of a text link (`--`, `-.`, `==`), or the closing half (`.->`).
const LINK_AT = /^(?:<?(?:-{2,}|={2,}|-\.+-?|~{3,})(?:>|[xo](?![\w]))?|\.+->?(?=[\s|]|$|>))/

function tokenize(input: string, options: TokenizeOptions = {}): string[] | null {
  const tokens: string[] = []
  let current = ''
  let depth = 0
  let quoted = false
  const flush = () => {
    if (current) tokens.push(current)
    current = ''
  }
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quoted) {
      current += ch
      if (ch === '"') quoted = false
      continue
    }
    if (ch === '"') {
      quoted = true
      current += ch
      continue
    }
    if (options.brackets && OPEN[ch]) {
      depth++
      current += ch
      continue
    }
    if (options.brackets && CLOSE.has(ch)) {
      if (depth === 0) return null
      depth--
      current += ch
      continue
    }
    if (depth > 0) {
      current += ch
      continue
    }
    if (/\s/.test(ch)) {
      flush()
      continue
    }
    if (options.splitLinks) {
      // A pipe label (`-->|text|`) belongs to the link before it.
      if (ch === '|' && !current && tokens.length && isLink(tokens[tokens.length - 1])) {
        const end = input.indexOf('|', i + 1)
        if (end < 0) return null
        tokens[tokens.length - 1] += input.slice(i, end + 1)
        i = end
        continue
      }
      const link = LINK_AT.exec(input.slice(i))
      if (link && !(link[0].startsWith('.') && !current && !tokens.length)) {
        flush()
        tokens.push(link[0])
        i += link[0].length - 1
        continue
      }
    }
    current += ch
  }
  if (quoted || depth !== 0) return null
  flush()
  return tokens
}

const FULL_LINK = /^(?:<?(?:-{2,}|={2,}|-\.+-|~{3,})(?:>|[xo])?|<?-{2,}>?)(?:\|[^|]*\|)?$/
const LINK_OPENER = /^(?:<?(?:--|==|-\.))$/
const LINK_CLOSER = /^(?:-{2,}[>xo]?|={2,}>?|\.+->?)(?:\|[^|]*\|)?$/

function isLink(token: string): boolean {
  return FULL_LINK.test(token) || LINK_OPENER.test(token) || LINK_CLOSER.test(token)
}

const FLOW_DIRECTIONS = new Set(['TB', 'TD', 'BT', 'RL', 'LR'])
const FLOW_ARITY: Record<string, number> = { subgraph: 1, direction: 1, classDef: 2, class: 2, style: 2, linkStyle: 2 }

function reflowFlowchart(keyword: string, body: string): string[] | null {
  const tokens = tokenize(body, { splitLinks: true, brackets: true })
  if (!tokens) return null
  let header = keyword
  if (tokens.length && FLOW_DIRECTIONS.has(tokens[0])) header += ` ${tokens.shift()}`
  const lines: string[] = [header]
  let depth = 0
  let edges = 0
  let shaped = false
  let i = 0
  const push = (text: string) => lines.push(`${'    '.repeat(depth + 1)}${text}`)
  while (i < tokens.length) {
    const token = tokens[i]
    if (token === 'click' || token.startsWith('%%')) return null
    if (token === 'end') {
      if (depth === 0) return null
      depth--
      push('end')
      i++
      continue
    }
    const arity = FLOW_ARITY[token]
    if (arity !== undefined) {
      const args = tokens.slice(i + 1, i + 1 + arity)
      if (args.length < arity || args.some((arg) => isLink(arg) || arg === 'end')) return null
      push([token, ...args].join(' '))
      if (token === 'subgraph') {
        depth++
        shaped = true
      }
      i += 1 + arity
      continue
    }
    if (isLink(token) || token === '&') return null
    // node ( (& node)* link node )*
    const parts = [token]
    i++
    for (;;) {
      if (tokens[i] === '&') {
        if (i + 1 >= tokens.length || isLink(tokens[i + 1])) return null
        parts.push('&', tokens[i + 1])
        i += 2
        continue
      }
      const next = tokens[i]
      if (next === undefined) break
      if (LINK_OPENER.test(next) && !FULL_LINK.test(next)) {
        // `-- text -->`: label words up to the closing half.
        let j = i + 1
        while (j < tokens.length && !LINK_CLOSER.test(tokens[j])) j++
        if (j >= tokens.length || j === i + 1) return null
        parts.push(tokens.slice(i, j + 1).join(' '))
        i = j + 1
      } else if (FULL_LINK.test(next)) {
        parts.push(next)
        i++
        if (tokens[i]?.startsWith('|')) {
          parts.push(tokens[i])
          i++
        }
      } else {
        break
      }
      const target = tokens[i]
      if (target === undefined || isLink(target) || target === '&' || target === 'end' || FLOW_ARITY[target] !== undefined) return null
      parts.push(target)
      edges++
      i++
    }
    if (parts.some((part) => /[[({]/.test(part))) shaped = true
    push(parts.join(' '))
  }
  if (depth !== 0) return null
  // A bare `graph TD` or a lone word is prose, not a diagram.
  if (lines.length < 2 || (edges === 0 && !shaped)) return null
  return lines
}

type StartRule = (tokens: string[], i: number) => boolean

/**
 * Splits free-text diagrams (sequence, class, state, er, pie, gantt, journey,
 * timeline, gitGraph): a new line starts before every token `isStart` accepts.
 */
function reflowByStarts(header: string, body: string, isStart: StartRule, options: TokenizeOptions = {}): string[] | null {
  const tokens = tokenize(body, options)
  if (!tokens || !tokens.length) return null
  if (!isStart(tokens, 0)) return null
  const statements: string[][] = [[tokens[0]]]
  for (let i = 1; i < tokens.length; i++) {
    if (isStart(tokens, i)) statements.push([])
    statements[statements.length - 1].push(tokens[i])
  }
  if (statements.length < 2 && tokens.length < 2) return null
  return [header, ...statements.map((words) => `    ${words.join(' ')}`)]
}

const ID = '[A-Za-z_][\\w.-]*'
const SEQ_ARROW = '(?:<<)?-{1,2}(?:>>|>|x|\\))[+-]?'
const SEQ_MESSAGE = new RegExp(`^${ID}${SEQ_ARROW}${ID}:?`)
const SEQ_ARROW_ONLY = new RegExp(`^${SEQ_ARROW}$`)
const SEQ_KEYWORDS = new Set(['participant', 'actor', 'Note', 'note', 'loop', 'alt', 'else', 'opt', 'par', 'and', 'end', 'rect', 'autonumber', 'activate', 'deactivate', 'critical', 'break', 'box', 'option'])
const SEQ_BLOCKS = new Set(['loop', 'alt', 'opt', 'par', 'rect', 'critical', 'break', 'box'])

function sequenceStart(): StartRule {
  // Track open blocks so `end`/`else`/`and` inside message text are not split
  // when no block is open.
  let open = 0
  let lastIndex = -1
  return (tokens, i) => {
    if (i <= lastIndex) return false
    lastIndex = i
    const token = tokens[i]
    const prev = tokens[i - 1] ?? ''
    if (SEQ_ARROW_ONLY.test(prev) || prev === 'as' || prev === 'of' || prev === 'over') return false
    if (SEQ_BLOCKS.has(token)) {
      open++
      return true
    }
    if (token === 'end' || token === 'else' || token === 'and' || token === 'option') {
      if (open === 0) return false
      if (token === 'end') open--
      return true
    }
    if (SEQ_KEYWORDS.has(token)) return true
    if (SEQ_MESSAGE.test(token)) return true
    return new RegExp(`^${ID}$`).test(token) && SEQ_ARROW_ONLY.test(tokens[i + 1] ?? '')
  }
}

const CLASS_RELATION = /^(?:<\|--|\*--|o--|-->|--\*|--o|--\|>|--|\.\.>|\.\.\|>|<\|\.\.|\.\.)$/
function classStart(tokens: string[], i: number): boolean {
  const token = tokens[i]
  const prev = tokens[i - 1] ?? ''
  if (CLASS_RELATION.test(prev) || prev === 'class' || /^"/.test(prev) && CLASS_RELATION.test(tokens[i - 2] ?? '')) return false
  if (token === 'class' || token === 'note' || token === 'direction') return true
  const next = tokens[i + 1] ?? ''
  return new RegExp(`^${ID}$`).test(token) && (CLASS_RELATION.test(next) || next === ':' || /^"/.test(next) && CLASS_RELATION.test(tokens[i + 2] ?? ''))
}

function stateStart(tokens: string[], i: number): boolean {
  const token = tokens[i]
  const prev = tokens[i - 1] ?? ''
  if (prev === '-->' || prev === 'state' || prev === 'as' || prev === 'note' || prev === 'direction') return false
  if (token === 'state' || token === 'note' || token === 'direction' || token === '}' ) return true
  return (token === '[*]' || new RegExp(`^${ID}$`).test(token)) && tokens[i + 1] === '-->'
}

const ER_CARDINALITY = /^[|}o][|o]?(?:--|\.\.)[|o][|{o]?$/
function erStart(tokens: string[], i: number): boolean {
  const prev = tokens[i - 1] ?? ''
  if (ER_CARDINALITY.test(prev)) return false
  return new RegExp(`^${ID}$`).test(tokens[i]) && ER_CARDINALITY.test(tokens[i + 1] ?? '')
}

function pieStart(tokens: string[], i: number): boolean {
  const token = tokens[i]
  if (token === 'title') return true
  return /^"[^"]*"(?::.*)?$/.test(token) && (token.includes(':') || tokens[i + 1]?.startsWith(':') === true)
}

const GIT_COMMANDS = new Set(['commit', 'branch', 'checkout', 'switch', 'merge', 'cherry-pick'])
function gitStart(tokens: string[], i: number): boolean {
  const prev = tokens[i - 1] ?? ''
  if (prev === 'branch' || prev === 'checkout' || prev === 'switch' || prev === 'merge') return false
  return GIT_COMMANDS.has(tokens[i])
}

/**
 * Returns the reflowed multi-line diagram, or null when `source` is not a
 * single-line Mermaid diagram that can be split safely.
 */
export function reflowSingleLineMermaid(source: string): string | null {
  if (/[\r\n]/.test(source)) return null
  const text = stripMermaidTag(source)
  const keyword = mermaidKeyword(text)
  if (!keyword) return null
  const body = text.slice(keyword.length).trim()
  if (!body) return null
  let lines: string[] | null = null
  switch (keyword) {
    case 'flowchart':
    case 'graph':
      lines = reflowFlowchart(keyword, body)
      break
    case 'sequenceDiagram':
      lines = reflowByStarts(keyword, body, sequenceStart())
      break
    case 'classDiagram':
      if (/[{}]/.test(body)) return null
      lines = reflowByStarts(keyword, body, classStart)
      break
    case 'stateDiagram':
    case 'stateDiagram-v2':
      if (/[{}]/.test(body)) return null
      lines = reflowByStarts(keyword, body, stateStart)
      break
    case 'erDiagram':
      if (/[{}]\s*$|\{\s/.test(body.replace(/[|}o][|o]?(?:--|\.\.)[|o][|{o]?/g, ''))) return null
      lines = reflowByStarts(keyword, body, erStart)
      break
    case 'pie': {
      const head = /^(showData\s+)?/.exec(body)?.[0] ?? ''
      lines = reflowByStarts(`pie${head ? ` ${head.trim()}` : ''}`, body.slice(head.length), pieStart)
      break
    }
    case 'gitGraph': {
      const head = /^(?:(LR|TB|BT):\s*)?/.exec(body)?.[0] ?? ''
      lines = reflowByStarts(`gitGraph${head ? ` ${head.trim()}` : ''}`, body.slice(head.length), gitStart)
      break
    }
    case 'gantt':
    case 'journey':
    case 'timeline':
      // Task, step and event names are free multi-word text before a colon,
      // so their boundaries cannot be recovered from one line.
      return null
    case 'mindmap':
      // Mindmap hierarchy is indentation; a single line has lost it.
      return null
  }
  if (!lines || lines.length < 2) return null
  return lines.join('\n')
}
