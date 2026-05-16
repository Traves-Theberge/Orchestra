import { useEffect, useState } from 'react'
import type { BackendConfig, UnsandboxStatus } from '@core/api/client'
import {
  fetchKubernetesConfig,
  fetchTailscaleConfig,
  fetchUnsandboxStatus,
} from '@core/api/client'
import { TabStatusPill, type PillStatus } from './sandbox-shared'
import { UnsandboxTab } from './UnsandboxTab'
import { TailscaleTab } from './TailscaleTab'
import { KubernetesTab } from './KubernetesTab'

type TabId = 'unsandbox' | 'tailscale' | 'kubernetes'

export function SandboxDashboard({ config, onOpenSettings }: { config: BackendConfig | null; onOpenSettings?: () => void }) {
  const [activeTab, setActiveTab] = useState<TabId>('unsandbox')

  const [unsandboxStatus, setUnsandboxStatus] = useState<UnsandboxStatus | null>(null)
  const [tailscaleConfigured, setTailscaleConfigured] = useState(false)
  const [kubernetesConfigured, setKubernetesConfigured] = useState(false)

  useEffect(() => {
    if (!config) return
    fetchUnsandboxStatus(config).then(setUnsandboxStatus).catch(() => {})
    fetchTailscaleConfig(config).then((d) => setTailscaleConfigured(d.configured ?? false)).catch(() => {})
    fetchKubernetesConfig(config).then((d) => setKubernetesConfigured(d.configured ?? false)).catch(() => {})
  }, [config])

  if (!config) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        No backend connected.
      </div>
    )
  }

  const unsandboxPill: PillStatus =
    unsandboxStatus?.configured && unsandboxStatus?.valid ? 'connected' : 'not-configured'
  const tailscalePill: PillStatus = tailscaleConfigured ? 'configured' : 'not-configured'
  const kubernetesPill: PillStatus = kubernetesConfigured ? 'configured' : 'not-configured'

  const tabs: Array<{ id: TabId; label: string; pill: PillStatus }> = [
    { id: 'unsandbox', label: 'Unsandbox', pill: unsandboxPill },
    { id: 'tailscale', label: 'Tailscale', pill: tailscalePill },
    { id: 'kubernetes', label: 'Kubernetes', pill: kubernetesPill },
  ]

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="w-full px-6 pt-6 pb-16 space-y-8">
        <header className="flex items-end justify-between gap-4">
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50">Compute</p>
            <h1 className="text-4xl font-semibold tracking-tight">Remote Execution</h1>
          </div>
        </header>

        <div className="flex items-end gap-1 border-b border-border/30">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group flex items-center gap-2 px-4 py-2.5 text-[12px] font-semibold tracking-tight transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground/60 hover:text-foreground/80 hover:border-border'
              }`}
            >
              {tab.label}
              <TabStatusPill status={tab.pill} />
            </button>
          ))}
        </div>

        {activeTab === 'unsandbox' && (
          <UnsandboxTab config={config} onOpenSettings={onOpenSettings} />
        )}
        {activeTab === 'tailscale' && (
          <TailscaleTab config={config} />
        )}
        {activeTab === 'kubernetes' && (
          <KubernetesTab config={config} />
        )}
      </div>
    </div>
  )
}
