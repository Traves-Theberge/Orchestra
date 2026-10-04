import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createProject, type BackendConfig } from '@core/api/client'
import { useProjectActions } from './use-project-actions'

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(),
}))
vi.mock('@core/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@core/api/client')>(),
  createProject: vi.fn(),
}))

describe('useProjectActions registration', () => {
  it('reports and rejects backend registration failure so the caller cannot mistake it for success', async () => {
    const failure = new Error('unauthorized project path')
    vi.mocked(createProject).mockRejectedValueOnce(failure)
    const error = vi.fn()
    const status = vi.fn()
    const { result } = renderHook(() => useProjectActions({ baseUrl: 'http://localhost:4014', apiToken: 'fixture' } as BackendConfig, 'PROJECTS', { setErrorMessage: error, setStatusMessage: status }))
    await expect(result.current.handleAddProject('C:\\Projects\\app')).rejects.toBe(failure)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('unauthorized project path'))
    expect(status).not.toHaveBeenCalled()
  })

  it('rejects missing backend configuration rather than pretending to add a project', async () => {
    const { result } = renderHook(() => useProjectActions(null, 'PROJECTS', { setErrorMessage: vi.fn(), setStatusMessage: vi.fn() }))
    await expect(result.current.handleAddProject('C:\\Projects\\app')).rejects.toThrow('Reconnect to the backend')
  })
})
