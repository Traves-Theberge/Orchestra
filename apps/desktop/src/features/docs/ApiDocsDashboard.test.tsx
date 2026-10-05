import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { BackendConfig } from '@core/api/client'
import { ApiDocsDashboard } from './ApiDocsDashboard'

const { fetchOpenAPISpec } = vi.hoisted(() => ({ fetchOpenAPISpec: vi.fn() }))
vi.mock('@core/api/client', () => ({
  fetchOpenAPISpec: (...args: unknown[]) => fetchOpenAPISpec(...args),
  toDisplayError: (error: unknown) => String(error),
}))

const config: BackendConfig = { baseUrl: 'http://localhost:4000', apiToken: 'test' }

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('ApiDocsDashboard', () => {
  it('loads and filters the API reference in-app', async () => {
    fetchOpenAPISpec.mockResolvedValue(`openapi: 3.0.0
info:
  title: Orchestra API
  version: 1.2.3
paths:
  /api/v1/projects:
    get:
      summary: List projects
      tags: [Projects]
      responses:
        '200':
          description: Project list
    post:
      summary: Create project
      responses:
        '201':
          description: Created
  /api/v1/health:
    get:
      summary: Health check
`)
    render(<ApiDocsDashboard config={config} />)

    expect(await screen.findByText('Orchestra API')).toBeTruthy()
    expect(screen.getAllByText('GET')).toHaveLength(2)
    expect(screen.getAllByText('/api/v1/projects')).toHaveLength(2)
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter API operations' }), { target: { value: 'health' } })
    expect(screen.getByText('/api/v1/health')).toBeTruthy()
    expect(screen.queryByText('/api/v1/projects')).toBeNull()
    expect(document.querySelector('a')).toBeNull()
  })

  it('reports fetch failures and offers retry', async () => {
    fetchOpenAPISpec.mockRejectedValueOnce(new Error('backend unavailable')).mockResolvedValueOnce('openapi: 3.0.0\npaths: {}\n')
    render(<ApiDocsDashboard config={config} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No API operations match that filter.')).toBeTruthy()
    expect(fetchOpenAPISpec).toHaveBeenCalledTimes(2)
  })
})
