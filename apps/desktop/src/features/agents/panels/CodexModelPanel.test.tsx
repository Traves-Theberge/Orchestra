import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodexModelPanel } from './CodexModelPanel'
import type { ProviderModelConfig } from '@core/api/client'

const modelConfig: ProviderModelConfig = {
  model: '',
  effort: '',
  temperature: null,
}

describe('CodexModelPanel', () => {
  it('saves model provider block edits into config.toml', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onSaveConfig = vi.fn().mockResolvedValue(undefined)

    render(
      <CodexModelPanel
        modelConfig={modelConfig}
        configContent={'model = "gpt-5.3-codex"\n'}
        scope="GLOBAL"
        projectName={null}
        saving={null}
        onSave={onSave}
        onSaveConfig={onSaveConfig}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('openai'), { target: { value: 'openai' } })
    fireEvent.change(screen.getByPlaceholderText('https://api.openai.com/v1'), { target: { value: 'https://example.test/v1' } })
    fireEvent.click(screen.getByText('Save'))

    expect(onSave).toHaveBeenCalledWith(modelConfig)
    await waitFor(() => expect(onSaveConfig).toHaveBeenCalledTimes(1))
    expect(onSaveConfig.mock.calls[0][0]).toContain('model_provider = "openai"')
    expect(onSaveConfig.mock.calls[0][0]).toContain('[model_providers.openai]')
    expect(onSaveConfig.mock.calls[0][0]).toContain('base_url = "https://example.test/v1"')
  })
})
