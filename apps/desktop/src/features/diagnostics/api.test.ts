import { describe, expect, it, vi } from 'vitest'
import { requestJSON } from '@core/api/client'
import { diagnosticQuery, diagnosticsAPI, sanitizedExport, type DiagnosticExport } from './api'
vi.mock('@core/api/client', () => ({ requestJSON: vi.fn().mockResolvedValue({}) }))
describe('diagnostics contract', () => {
  it('encodes exact opaque task/project identifiers and uses bounded list reads', async () => {
    expect(diagnosticQuery({ task_id: 'task/1', project_id: 'project & 2', q: '', offset: 0 })).toBe('?task_id=task%2F1&project_id=project+%26+2&offset=0')
    await diagnosticsAPI.traces({ baseUrl: 'http://local', apiToken: '' }, { task_id: 'task/1' })
    expect(requestJSON).toHaveBeenCalledWith(expect.anything(), '/api/v1/diagnostics/traces?limit=100&task_id=task%2F1', undefined)
  })
  it('downloads only the allowed DTO fields and reports truncation', () => {
    const bundle = { schema_version: 1, exported_at: 'now', truncated: true, secret: 'credential', traces: [], spans: [], logs: [{ id: 1, trace_id: 'trace', span_id: 'span', timestamp: 'now', name: 'tool.finished', severity: 'info', prompt: 'sensitive prompt', response: 'sensitive response' }] } as unknown as DiagnosticExport
    const clean = JSON.stringify(sanitizedExport(bundle))
    expect(clean).toContain('"truncated":true')
    expect(clean).not.toMatch(/sensitive|credential|prompt|response/)
  })
})
