import { Fragment, useMemo, useRef, useEffect } from 'react'

type DiffLine = {
  type: 'add' | 'del' | 'ctx'
  content: string
  oldNum: number | null
  newNum: number | null
}

type Hunk = {
  header: string
  lines: DiffLine[]
}

// Strips CSI / OSC ANSI escape sequences so colored `git diff --color` output
// renders cleanly. Kept inline (no dependency) — the regex covers the common
// cases (color, cursor, OSC) without parsing the full ANSI grammar.
const ANSI_PATTERN = /\[[0-9;?]*[A-Za-z]|\][^]*(?:|\\)/g
function stripAnsi(s: string): string {
  return s.replace(ANSI_PATTERN, '')
}

function parseDiff(rawInput: string): Hunk[] {
  const hunks: Hunk[] = []
  const raw = stripAnsi(rawInput)
  const lines = raw.split('\n')
  let current: Hunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)/)
    if (hunkMatch) {
      current = { header: line, lines: [] }
      hunks.push(current)
      oldLine = parseInt(hunkMatch[1], 10)
      newLine = parseInt(hunkMatch[2], 10)
      continue
    }

    if (!current) continue

    const { lines: currentLines } = current
    const first = line.charAt(0)
    if (first === '+') {
      currentLines.push({ type: 'add', content: line.slice(1), oldNum: null, newNum: newLine })
      newLine++
    } else if (first === '-') {
      currentLines.push({ type: 'del', content: line.slice(1), oldNum: oldLine, newNum: null })
      oldLine++
    } else if (first === ' ' || line === '') {
      currentLines.push({ type: 'ctx', content: first === ' ' ? line.slice(1) : line, oldNum: oldLine, newNum: newLine })
      oldLine++
      newLine++
    }
  }
  return hunks
}

type SplitRow = {
  leftNum: number | null
  leftContent: string
  leftType: 'add' | 'del' | 'ctx' | 'empty'
  rightNum: number | null
  rightContent: string
  rightType: 'add' | 'del' | 'ctx' | 'empty'
}

type SplitHunk = {
  header: string
  rows: SplitRow[]
}

function buildSplitHunks(hunks: Hunk[]): SplitHunk[] {
  const result: SplitHunk[] = []
  for (const hunk of hunks) {
    const rows: SplitRow[] = []
    const lines = hunk.lines
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      if (line.type === 'ctx') {
        rows.push({
          leftNum: line.oldNum, leftContent: line.content, leftType: 'ctx',
          rightNum: line.newNum, rightContent: line.content, rightType: 'ctx',
        })
        i++
      } else if (line.type === 'del') {
        // Pair deletions with following additions
        const dels: DiffLine[] = []
        while (i < lines.length && lines[i].type === 'del') { dels.push(lines[i]); i++ }
        const adds: DiffLine[] = []
        while (i < lines.length && lines[i].type === 'add') { adds.push(lines[i]); i++ }
        const max = Math.max(dels.length, adds.length)
        for (let j = 0; j < max; j++) {
          const d = dels[j]
          const a = adds[j]
          rows.push({
            leftNum: d?.oldNum ?? null, leftContent: d?.content ?? '', leftType: d ? 'del' : 'empty',
            rightNum: a?.newNum ?? null, rightContent: a?.content ?? '', rightType: a ? 'add' : 'empty',
          })
        }
      } else if (line.type === 'add') {
        rows.push({
          leftNum: null, leftContent: '', leftType: 'empty',
          rightNum: line.newNum, rightContent: line.content, rightType: 'add',
        })
        i++
      } else {
        i++
      }
    }
    result.push({ header: hunk.header, rows })
  }
  return result
}

function lineStyle(type: 'add' | 'del' | 'ctx' | 'empty'): string {
  switch (type) {
    case 'add': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    case 'del': return 'bg-red-500/10 text-red-600 dark:text-red-400'
    default: return ''
  }
}

export function DiffViewer({
  filePath,
  diff,
  mode,
  onModeChange,
}: {
  filePath: string | null
  diff: string | null
  mode: 'unified' | 'split'
  onModeChange: (mode: 'unified' | 'split') => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const hunks = useMemo(() => (diff ? parseDiff(diff) : []), [diff])
  const splitHunks = useMemo(() => (mode === 'split' ? buildSplitHunks(hunks) : []), [hunks, mode])

  useEffect(() => {
    if (scrollRef.current?.scrollTo) scrollRef.current.scrollTo(0, 0)
  }, [diff])

  if (filePath === null || diff === null) {
    return (
      <div className="flex items-center justify-center h-full text-[12px] text-muted-foreground/50">
        Select a file to view its diff
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-border/30 sticky top-0 z-10 shrink-0 bg-background">
        {filePath && (
          <span className="font-mono text-[11.5px] text-foreground/85 truncate mr-4">{filePath}</span>
        )}
        <div className="flex items-center rounded-md bg-muted/30 p-0.5 ml-auto">
          <button
            className={`px-2.5 h-6 rounded text-[10.5px] font-medium tracking-tight transition-colors ${
              mode === 'split' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/60 hover:text-foreground'
            }`}
            onClick={() => onModeChange('split')}
          >
            Split
          </button>
          <button
            className={`px-2.5 h-6 rounded text-[10.5px] font-medium tracking-tight transition-colors ${
              mode === 'unified' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/60 hover:text-foreground'
            }`}
            onClick={() => onModeChange('unified')}
          >
            Unified
          </button>
        </div>
      </div>

      {/* Diff content */}
      <div ref={scrollRef} className="flex-1 overflow-auto font-mono text-[11px] leading-5">
        {mode === 'unified' ? (
          <table className="w-full border-collapse">
            <tbody>
              {hunks.map((hunk, hi) => (
                <Fragment key={`h-${hi}`}>
                  <tr>
                    <td colSpan={3} className="px-3 py-1 text-[10px] text-muted-foreground/60 bg-muted/10 select-none">
                      {hunk.header}
                    </td>
                  </tr>
                  {hunk.lines.map((line, li) => (
                    <tr key={`${hi}-${li}`} className={lineStyle(line.type)}>
                      <td className="w-10 text-right pr-2 text-muted-foreground/30 select-none align-top">{line.oldNum ?? ''}</td>
                      <td className="w-10 text-right pr-2 text-muted-foreground/30 select-none align-top">{line.newNum ?? ''}</td>
                      <td className="px-3 whitespace-pre-wrap break-all">
                        {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}{line.content}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {splitHunks.map((sh, hi) => (
                <Fragment key={`sh-${hi}`}>
                  <tr>
                    <td colSpan={4} className="px-3 py-1 text-[10px] text-muted-foreground/60 bg-muted/10 select-none">
                      {sh.header}
                    </td>
                  </tr>
                  {sh.rows.map((row, ri) => (
                    <tr key={ri}>
                      <td className={`w-10 text-right pr-1 select-none align-top text-muted-foreground/30 ${lineStyle(row.leftType)}`}>
                        {row.leftNum ?? ''}
                      </td>
                      <td className={`w-1/2 px-2 whitespace-pre-wrap break-all ${lineStyle(row.leftType)}`}>
                        {row.leftContent}
                      </td>
                      <td className={`w-10 text-right pr-1 select-none align-top text-muted-foreground/30 ${lineStyle(row.rightType)}`}>
                        {row.rightNum ?? ''}
                      </td>
                      <td className={`w-1/2 px-2 whitespace-pre-wrap break-all ${lineStyle(row.rightType)}`}>
                        {row.rightContent}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
