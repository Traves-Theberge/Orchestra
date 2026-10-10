import { describe, expect, it } from 'vitest'
import mermaid from 'mermaid'
import { mermaidKeyword, reflowSingleLineMermaid } from './mermaidReflow'
import { USER_SAMPLE } from './mermaidReflow.fixtures'


async function parses(source: string): Promise<boolean> {
  return Boolean(await mermaid.parse(source, { suppressErrors: true }))
}

describe('reflowSingleLineMermaid', () => {
  it('reflows the reported Antigravity sample into a parseable flowchart', async () => {
    expect(await parses(USER_SAMPLE)).toBe(false)
    const out = reflowSingleLineMermaid(USER_SAMPLE)
    expect(out).not.toBeNull()
    const lines = out!.split('\n')
    expect(lines[0]).toBe('flowchart LR')
    expect(lines).toContain('    subgraph Host["Computer & Audio Interface"]')
    expect(lines).toContain('        DAW["DAW: Calibration Signal (v1_1_1.wav)"]')
    expect(lines).toContain('        REAMP -- "Instrument Level Cable" --> AMP_IN')
    expect(lines).toContain('        AMP_IN --> PREAMP --> POWERAMP')
    expect(lines).toContain('    LINE_TAP -- "Balanced Line Level Cable" --> ADC_IN')
    expect(lines.filter((l) => l.trim() === 'end')).toHaveLength(4)
    expect(await parses(out!)).toBe(true)
  })

  it('accepts a leading mermaid tag', async () => {
    const out = reflowSingleLineMermaid('mermaid graph TD A[Start] --> B{Ok?} B -->|yes| C(Done) B -- no --> A')
    expect(out).toBe('graph TD\n    A[Start] --> B{Ok?}\n    B -->|yes| C(Done)\n    B -- no --> A')
    expect(await parses(out!)).toBe(true)
  })

  it('splits links written without spaces and & groups', async () => {
    const out = reflowSingleLineMermaid('flowchart TB A-->B & C B-.->D C==>D classDef hot fill:#f96 class D hot')
    expect(out).toBe('flowchart TB\n    A --> B & C\n    B -.-> D\n    C ==> D\n    classDef hot fill:#f96\n    class D hot')
    expect(await parses(out!)).toBe(true)
  })

  it.each([
    ['sequenceDiagram participant A as Alice participant B A->>B: Hello Bob, how are you? B-->>A: Fine thanks loop Every minute A->>B: ping end'],
    ['stateDiagram-v2 [*] --> Idle Idle --> Running : start Running --> Idle : stop Running --> [*]'],
    ['classDiagram Animal <|-- Duck Animal <|-- Fish Animal : +int age Duck : +swim()'],
    ['erDiagram CUSTOMER ||--o{ ORDER : places ORDER ||--|{ LINE_ITEM : contains'],
    ['pie title Pets adopted "Dogs" : 386 "Cats" : 85 "Rats" : 15'],
    ['gitGraph commit branch develop checkout develop commit commit checkout main merge develop'],
  ])('reflows %s into a parseable diagram', async (source) => {
    const out = reflowSingleLineMermaid(source)
    expect(out).not.toBeNull()
    expect(out!.split('\n').length).toBeGreaterThan(2)
    expect(await parses(out!)).toBe(true)
  })

  it.each([
    ['gantt title A dateFormat YYYY-MM-DD section S Task one :a1, 2024-01-01, 30d'],
    ['journey title My day section Work Make tea: 5: Me'],
    ['timeline title History 2002 : LinkedIn 2004 : Facebook'],
    ['mindmap root((x)) A B'],
  ])('declines ambiguous free-text diagrams: %s', (source) => {
    expect(reflowSingleLineMermaid(source)).toBeNull()
  })

  it.each([
    ['graph TD'],
    ['flowchart'],
    ['graph theory is fun'],
    ['flowchart LR A --> '],
    ['flowchart LR A["unterminated --> B'],
    ['flowchart LR subgraph X A --> B'],
    ['flowchart LR A --> B end'],
    ['sequenceDiagram'],
    ['pie'],
    ['graphql query'],
    ['flowchart LR\nA --> B'],
  ])('returns null for non-diagrams or unsafe input: %j', (source) => {
    expect(reflowSingleLineMermaid(source)).toBeNull()
  })

  it('detects diagram keywords only as whole words', () => {
    expect(mermaidKeyword('flowchart LR A-->B')).toBe('flowchart')
    expect(mermaidKeyword('mermaid sequenceDiagram')).toBe('sequenceDiagram')
    expect(mermaidKeyword('stateDiagram-v2 x')).toBe('stateDiagram-v2')
    expect(mermaidKeyword('graphql')).toBeNull()
    expect(mermaidKeyword('pies are great')).toBeNull()
  })
})
