import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetAppStore, useAppStore } from '@core/store'
import { SettingsPage } from './SettingsPage'

afterEach(() => {
  cleanup()
  resetAppStore()
})

function renderSettings() {
  const onSetActiveProfile = vi.fn(async (_id: string) => {})
  const onSaveBackendConfig = vi.fn(async (_next: { baseUrl: string; apiToken: string }) => {})
  const setActiveTheme = vi.fn()
  const setMode = vi.fn()
  const setTheme = vi.fn()
  useAppStore.setState({ setActiveTheme, setMode, setTheme })
  render(<SettingsPage
    loadingConfig={false}
    savingConfig={false}
    profilesPending={false}
    config={null}
    backendProfiles={[
      { id: 'fixture-profile-a', name: 'Fixture A', baseUrl: 'http://a.fixture.invalid', apiToken: 'fixture-a' },
      { id: 'fixture-profile-b', name: 'Fixture B', baseUrl: 'http://b.fixture.invalid', apiToken: 'fixture-b' },
    ]}
    activeProfileId="fixture-profile-a"
    migrationPending={false}
    migrationFrom=""
    migrationTo=""
    migrationPlan={null}
    agentConfig={null}
    onMigrationFromChange={vi.fn()}
    onMigrationToChange={vi.fn()}
    onMigrationPlan={vi.fn(async () => {})}
    onMigrationApply={vi.fn(async () => {})}
    onSaveBackendConfig={onSaveBackendConfig}
    onSetActiveProfile={onSetActiveProfile}
    onCreateProfile={vi.fn(async () => {})}
    onDeleteProfile={vi.fn(async () => {})}
    onSaveAgentConfig={vi.fn(async () => {})}
  />)
  return { onSetActiveProfile, setActiveTheme, setMode, setTheme }
}

describe('Settings selector walkthroughs', () => {
  it('chooses the exact backend profile while keeping fixture credentials out of the callback', () => {
    const { onSetActiveProfile } = renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Fixture A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fixture B' }))
    expect(onSetActiveProfile).toHaveBeenCalledExactlyOnceWith('fixture-profile-b')
    expect(onSetActiveProfile).not.toHaveBeenCalledWith(expect.stringContaining('fixture-b'))
  })

  it('selects a theme preset by its stable ID and switches appearance mode explicitly', () => {
    const { setActiveTheme, setMode, setTheme } = renderSettings()
    const theme = useAppStore.getState().builtinThemes.find(item => item.id !== useAppStore.getState().activeThemeId)
    expect(theme).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: theme!.name }))
    expect(setActiveTheme).toHaveBeenCalledExactlyOnceWith(theme!.id)

    fireEvent.click(screen.getByRole('button', { name: 'Auto' }))
    expect(setMode).toHaveBeenCalledExactlyOnceWith('auto')
    expect(setTheme).not.toHaveBeenCalled()
  })
})
