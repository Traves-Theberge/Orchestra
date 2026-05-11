import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodexApprovalsPanel } from './CodexApprovalsPanel'
import type { ProviderPermissions } from '@core/api/client'

const permissions: ProviderPermissions = {
  approval_mode: 'interactive',
  allow: [],
  deny: [],
  ask: [],
  sandbox: 'workspace-write',
}

describe('CodexApprovalsPanel', () => {
  it('saves Codex approval and sandbox changes', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <CodexApprovalsPanel
        permissions={permissions}
        scope="GLOBAL"
        projectName={null}
        saving={null}
        onSave={onSave}
      />,
    )

    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: 'full-auto' } })
    fireEvent.change(selects[1], { target: { value: 'danger-full-access' } })
    fireEvent.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith({
      ...permissions,
      approval_mode: 'full-auto',
      sandbox: 'danger-full-access',
    })
  })
})
