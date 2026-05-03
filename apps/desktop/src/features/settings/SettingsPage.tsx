import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bell,
  Cable,
  Check,
  CheckCircle2,
  CircleDashed,
  Copy,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FlaskConical,
  GitBranch,
  Globe,
  Keyboard,
  Loader2,
  Paintbrush,
  PanelLeft,
  Play,
  Plus,
  RefreshCcw,
  ShieldCheck,
  SignalHigh,
  SlidersHorizontal,
  Terminal,
  Trash2,
  Type,
  Upload,
  Users,
  Info,
} from 'lucide-react'
import { Button } from '@ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ui/dialog'
import {
  type BackendConfig,
  type WorkspaceMigrationResult,
  fetchUnsandboxConfig,
  saveUnsandboxConfig,
  deleteUnsandboxConfig,
  fetchUnsandboxStatus,
  fetchAgentProviderKeys,
  saveAgentProviderKey,
  fetchProjects,
  disconnectProjectGitHub,
  type UnsandboxConfig,
  type UnsandboxStatus,
} from '@core/api/client'
import type { Project } from '@core/api/types'
import { Github } from 'lucide-react'
import { CHAT_PROVIDERS } from '@features/embedded-agent/lib/types'
import { usePlatform } from '@/hooks/use-platform'
import { CustomDropdown } from '@layout/shared/controls'
import { useAppStore } from '@core/store'
import { applyTheme, resolveMode } from '@core/theme/apply'
import { contrastRatio, formatHslTriplet, hexToHslTriplet, hslTripletToHex, parseHslTriplet, wcagBadge } from '@core/theme/color-utils'
import { deriveRoles } from '@core/theme/derive-surface'
import { normalizeTheme } from '@core/theme/defaults'
import type { ChartPalette, RoleSet, Theme, ThemeMode, ThemeRoleKey } from '@core/theme/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BackendProfile = {
  id: string
  name: string
  baseUrl: string
  apiToken: string
}

type TypographyPatch = {
  fontSans?: string
  fontMono?: string
  baseSizePx?: number
  lineHeight?: number
  headingScale?: number
  letterSpacing?: Partial<NonNullable<Theme['typography']>['letterSpacing']>
  fontWeight?: Partial<NonNullable<Theme['typography']>['fontWeight']>
}

type DensityPatch = {
  preset?: NonNullable<Theme['density']>['preset']
  spacingScale?: number
  controlHeight?: Partial<NonNullable<Theme['density']>['controlHeight']>
  borderWidthPx?: number
}

type MotionPatch = {
  scale?: number
  reduceMotion?: boolean
  backdropBlurPx?: number
  durationMs?: Partial<NonNullable<Theme['motion']>['durationMs']>
}

const ROLE_SECTIONS: Array<{
  title: string
  roles: Array<{ key: ThemeRoleKey; label: string; description: string }>
}> = [
  {
    title: 'Surfaces',
    roles: [
      { key: 'background', label: 'Background', description: 'Page canvas and app shell.' },
      { key: 'surface', label: 'Surface', description: 'Cards, panels, and rows.' },
      { key: 'surfaceRaised', label: 'Surface Raised', description: 'Dialogs, menus, and overlays.' },
      { key: 'surfaceSunken', label: 'Surface Sunken', description: 'Inputs and inset containers.' },
    ],
  },
  {
    title: 'Borders & Text',
    roles: [
      { key: 'border', label: 'Border', description: 'Default strokes and dividers.' },
      { key: 'borderStrong', label: 'Border Strong', description: 'Emphasized boundaries.' },
      { key: 'text', label: 'Text', description: 'Primary text and labels.' },
      { key: 'textMuted', label: 'Text Muted', description: 'Secondary and supporting copy.' },
    ],
  },
  {
    title: 'Status & Accent',
    roles: [
      { key: 'accent', label: 'Accent', description: 'Brand color, active states, primary actions.' },
      { key: 'accentForeground', label: 'Accent Foreground', description: 'Text and icons on accent surfaces.' },
      { key: 'success', label: 'Success', description: 'Healthy or complete states.' },
      { key: 'warning', label: 'Warning', description: 'Caution or pending states.' },
      { key: 'error', label: 'Error', description: 'Destructive and error states.' },
    ],
  },
]

const CONTRAST_PAIRS: Array<{ label: string; foreground: ThemeRoleKey; background: ThemeRoleKey }> = [
  { label: 'Text on Surface', foreground: 'text', background: 'surface' },
  { label: 'Text on Background', foreground: 'text', background: 'background' },
  { label: 'Muted on Surface', foreground: 'textMuted', background: 'surface' },
  { label: 'Accent FG on Accent', foreground: 'accentForeground', background: 'accent' },
]

// ---------------------------------------------------------------------------
// Section definitions
// ---------------------------------------------------------------------------

const SECTIONS = [
  { id: 'connections', label: 'Connections', icon: Database },
  { id: 'agents', label: 'Maestro', icon: Cpu },
  { id: 'integrations', label: 'Integrations', icon: Cable },
  { id: 'appearance', label: 'Appearance', icon: Paintbrush },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'browser', label: 'Browser', icon: Globe },
  { id: 'editor', label: 'Editor', icon: Type },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'experimental', label: 'Experimental', icon: FlaskConical },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

// ---------------------------------------------------------------------------
// Flash animation style (injected once)
// ---------------------------------------------------------------------------

const FLASH_STYLE_ID = 'settings-flash-style'

function ensureFlashStyle() {
  if (document.getElementById(FLASH_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = FLASH_STYLE_ID
  style.textContent = `
@keyframes settings-flash {
  0%, 100% { background-color: transparent; }
  20% { background-color: hsl(var(--accent) / 0.3); }
}
.settings-section-flash {
  animation: settings-flash 900ms ease-out;
}
`
  document.head.appendChild(style)
}

// ---------------------------------------------------------------------------
// SettingsPage
// ---------------------------------------------------------------------------

export function SettingsPage({
  loadingConfig,
  savingConfig,
  profilesPending,
  config,
  backendProfiles,
  activeProfileId,
  migrationPending: _migrationPending,
  migrationFrom: _migrationFrom,
  migrationTo: _migrationTo,
  migrationPlan: _migrationPlan,
  agentConfig: _agentConfig,
  onMigrationFromChange: _onMigrationFromChange,
  onMigrationToChange: _onMigrationToChange,
  onMigrationPlan: _onMigrationPlan,
  onMigrationApply: _onMigrationApply,
  onSaveBackendConfig,
  onSetActiveProfile,
  onCreateProfile,
  onDeleteProfile,
  onSaveAgentConfig: _onSaveAgentConfig,
  notifSound,
  notifMuted,
  notifVolume,
  onNotifSoundChange,
  onNotifMutedChange,
  onNotifVolumeChange,
  initialTab,
}: {
  loadingConfig: boolean
  savingConfig: boolean
  profilesPending: boolean
  config: BackendConfig | null
  backendProfiles: BackendProfile[]
  activeProfileId: string
  migrationPending: boolean
  migrationFrom: string
  migrationTo: string
  migrationPlan: WorkspaceMigrationResult | null
  agentConfig: { commands: Record<string, string>; agent_provider: string; max_turns: number } | null
  onMigrationFromChange: (value: string) => void
  onMigrationToChange: (value: string) => void
  onMigrationPlan: () => Promise<void>
  onMigrationApply: () => Promise<void>
  onSaveBackendConfig: (nextConfig: BackendConfig) => Promise<void>
  onSetActiveProfile: (profileId: string) => Promise<void>
  onCreateProfile: (name: string) => Promise<void>
  onDeleteProfile: (profileId: string) => Promise<void>
  onSaveAgentConfig: (config: { commands: Record<string, string>; agent_provider: string; max_turns: number }) => Promise<void>
  notifSound?: string
  notifMuted?: boolean
  notifVolume?: number
  onNotifSoundChange?: (sound: string) => void
  onNotifMutedChange?: (muted: boolean) => void
  onNotifVolumeChange?: (volume: number) => void
  initialTab?: 'backend' | 'agents' | 'integrations' | 'shortcuts' | 'notifications'
}) {
  const { isMac } = usePlatform()
  const theme = useAppStore(s => s.theme)
  const setTheme = useAppStore(s => s.setTheme)
  const browserHomepage = useAppStore(s => s.browserHomepage)
  const setBrowserHomepage = useAppStore(s => s.setBrowserHomepage)
  const builtinThemes = useAppStore(s => s.builtinThemes)
  const customThemes = useAppStore(s => s.customThemes)
  const activeThemeId = useAppStore(s => s.activeThemeId)
  const modeOverride = useAppStore(s => s.modeOverride)
  const setActiveTheme = useAppStore(s => s.setActiveTheme)
  const setMode = useAppStore(s => s.setMode)
  const getActiveTheme = useAppStore(s => s.getActiveTheme)
  const saveCustomTheme = useAppStore(s => s.saveCustomTheme)
  const duplicateTheme = useAppStore(s => s.duplicateTheme)
  const deleteCustomTheme = useAppStore(s => s.deleteCustomTheme)
  const reapply = useAppStore(s => s.reapply)
  const [homepageDraft, setHomepageDraft] = useState(browserHomepage)
  const [themeStudioOpen, setThemeStudioOpen] = useState(false)
  const [themeStudioDraft, setThemeStudioDraft] = useState<Theme | null>(null)
  const [themeStudioSourceId, setThemeStudioSourceId] = useState(activeThemeId)
  const [themeStudioPreviewMode, setThemeStudioPreviewMode] = useState<'light' | 'dark'>(
    modeOverride === 'auto' ? resolveMode('auto') : modeOverride,
  )
  useEffect(() => { setHomepageDraft(browserHomepage) }, [browserHomepage])

  useEffect(() => {
    if (!themeStudioOpen) return
    setThemeStudioPreviewMode(modeOverride === 'auto' ? resolveMode('auto') : modeOverride)
  }, [modeOverride, themeStudioOpen])

  // Live-apply draft to the running app while Theme Studio is open
  useEffect(() => {
    if (!themeStudioOpen || !themeStudioDraft) return
    applyTheme(normalizeTheme(themeStudioDraft), themeStudioPreviewMode)
  }, [themeStudioDraft, themeStudioPreviewMode, themeStudioOpen])

  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<SectionId>('connections')

  useEffect(() => {
    ensureFlashStyle()
  }, [])

  // Scroll to the section specified by initialTab on first mount
  useEffect(() => {
    if (!initialTab) return
    const tabToSection: Record<string, SectionId> = {
      backend: 'connections',
      agents: 'agents',
      integrations: 'integrations',
      shortcuts: 'shortcuts',
      notifications: 'notifications',
    }
    const sectionId = tabToSection[initialTab]
    if (!sectionId) return
    const handle = window.setTimeout(() => scrollToSection(sectionId), 120)
    return () => window.clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Scroll-spy: track which section is at ~40% viewport height
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    let ticking = false
    const handleScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        const threshold = el.getBoundingClientRect().top + el.clientHeight * 0.4
        let current: SectionId = SECTIONS[0].id
        for (const section of SECTIONS) {
          const node = el.querySelector(`[data-settings-section="${section.id}"]`)
          if (node) {
            const rect = node.getBoundingClientRect()
            if (rect.top <= threshold) {
              current = section.id
            }
          }
        }
        setActiveId(current)
      })
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  const scrollToSection = useCallback((id: SectionId) => {
    const el = scrollRef.current
    if (!el) return
    const target = el.querySelector(`[data-settings-section="${id}"]`)
    if (!target) return

    target.scrollIntoView({ behavior: 'smooth', block: 'start' })

    // Flash animation
    target.classList.remove('settings-section-flash')
    // Force reflow to restart animation
    void (target as HTMLElement).offsetWidth
    target.classList.add('settings-section-flash')
    const cleanup = () => {
      target.classList.remove('settings-section-flash')
      target.removeEventListener('animationend', cleanup)
    }
    target.addEventListener('animationend', cleanup)
  }, [])

  return (
    <div className="flex flex-1 min-h-0 min-w-0 bg-background">
      {/* Sidebar */}
      <nav className="w-[220px] shrink-0 border-r border-border/40 flex flex-col overflow-y-auto custom-scrollbar bg-background">
        <div className="px-5 pt-8 pb-6">
          <h2 className="text-[15px] font-black tracking-tight leading-none">Settings</h2>
        </div>
        <div className="flex flex-col gap-1 px-3 pb-6">
          {SECTIONS.map((section) => {
            const Icon = section.icon
            const isActive = activeId === section.id
            return (
              <button
                key={section.id}
                onClick={() => scrollToSection(section.id)}
                className={`group relative flex items-center gap-3 px-3 h-10 rounded-lg transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  isActive
                    ? 'bg-foreground/[0.06] text-foreground'
                    : 'text-muted-foreground/80 hover:text-foreground hover:bg-foreground/[0.03]'
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-primary" />
                )}
                <Icon
                  className={`h-[15px] w-[15px] shrink-0 transition-colors ${
                    isActive ? 'text-primary' : 'text-muted-foreground/60 group-hover:text-foreground'
                  }`}
                  strokeWidth={isActive ? 2.25 : 1.75}
                />
                <span className="truncate text-[12.5px] font-medium tracking-tight">{section.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* Scrollable content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-5xl mx-auto pt-12 pb-24 px-12 space-y-14">
          {/* Page hero */}
          <header className="space-y-2 pb-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary/80">Workspace</p>
            <h1 className="text-3xl font-black tracking-tight">Settings</h1>
            <p className="text-[12px] text-muted-foreground max-w-md">
              Tune Orchestra to your workflow. Changes save automatically.
            </p>
          </header>
          {/* ── Connections ── */}
          <section data-settings-section="connections" className="rounded-xl transition-colors duration-500 scroll-mt-4">
            <SectionHeading icon={Database} title="Connections" description="Backend profiles and API connection" />
            <div className="mt-4">
              <div className="rounded-2xl border border-border/40 bg-gradient-to-b from-card via-card to-muted/20 p-6 shadow-sm">
                <BackendConfigForm
                  loadingConfig={loadingConfig}
                  savingConfig={savingConfig}
                  profilesPending={profilesPending}
                  config={config}
                  backendProfiles={backendProfiles}
                  activeProfileId={activeProfileId}
                  onSaveBackendConfig={onSaveBackendConfig}
                  onSetActiveProfile={onSetActiveProfile}
                  onCreateProfile={onCreateProfile}
                  onDeleteProfile={onDeleteProfile}
                  disabled={loadingConfig || savingConfig || profilesPending}
                />
              </div>
            </div>
          </section>

          {/* ── Agents ── */}
          <section data-settings-section="agents" className="rounded-xl transition-colors duration-500 scroll-mt-4">
            <SectionHeading icon={Cpu} title="Maestro" description="LLM provider and embedded agent configuration" />
            <div className="mt-4 space-y-6">
              <EmbeddedAgentConfigForm config={config} disabled={savingConfig || loadingConfig} />
              <UnsandboxConfigForm config={config} disabled={savingConfig || loadingConfig} />
            </div>
          </section>

          {/* ── Integrations ── */}
          <section data-settings-section="integrations" className="rounded-xl transition-colors duration-500 scroll-mt-4">
            <SectionHeading icon={Cable} title="Integrations" description="GitHub, Linear, Jira, and other service connections" />
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-border/40 bg-gradient-to-b from-card via-card to-muted/20 p-6 shadow-sm">
                <div className="flex items-start gap-3">
                  <Cable size={16} className="mt-0.5 shrink-0 text-muted-foreground/50" />
                  <div>
                    <p className="text-[13px] font-semibold text-foreground/80">Issue source is configured per project</p>
                    <p className="mt-1 text-[12px] text-muted-foreground/60 leading-relaxed">
                      Open a project, click the <span className="font-mono bg-muted/60 px-1 rounded text-[11px]">Source</span> button in the toolbar, and enter the tracker type, endpoint, and API token. Each project stores its own credentials independently.
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-border/40 bg-gradient-to-b from-card via-card to-muted/20 p-6 shadow-sm">
                <GitConnectionsPane config={config} />
              </div>
            </div>
          </section>

          {/* ── Appearance ── */}
          <section data-settings-section="appearance" className="rounded-xl transition-colors duration-500 scroll-mt-4">
            <SectionHeading icon={Paintbrush} title="Appearance" description="Theme and visual preferences" />
            <div className="mt-4 space-y-4">
              <AppearanceModePane
                modeOverride={modeOverride}
                onModeChange={(m) => {
                  setMode(m)
                  // Keep legacy `theme` slice in sync so anything still reading
                  // it gets a concrete light/dark value.
                  const resolved = m === 'auto' ? resolveMode('auto') : m
                  if (resolved !== theme) setTheme(resolved)
                }}
              />
              <ThemePresetPane
                themes={[...builtinThemes, ...customThemes]}
                activeThemeId={activeThemeId}
                modeOverride={modeOverride}
                onSelect={setActiveTheme}
                onOpenStudio={() => {
                  const active = cloneTheme(getActiveTheme())
                  setThemeStudioSourceId(active.id)
                  setThemeStudioDraft(active)
                  setThemeStudioPreviewMode(modeOverride === 'auto' ? resolveMode('auto') : modeOverride)
                  setThemeStudioOpen(true)
                }}
              />
            </div>
          </section>

          {/* ── Terminal ── */}
          <section data-settings-section="terminal" className="rounded-xl transition-colors duration-500 scroll-mt-4">
            <SectionHeading icon={Terminal} title="Terminal" description="Terminal emulator preferences" />
            <div className="mt-4">
              <PlaceholderPane text="Terminal settings coming soon" />
            </div>
          </section>

          {/* ── Browser ── */}
          <section data-settings-section="browser" className="rounded-xl transition-colors duration-500 scroll-mt-4">
            <SectionHeading icon={Globe} title="Browser" description="Embedded browser preferences" />
            <div className="mt-4">
              <div className="p-4 rounded-xl border border-border/40 bg-gradient-to-b from-card via-card to-muted/20">
                <div className="space-y-0.5 mb-3">
                  <p className="text-xs font-black tracking-tight">Default Homepage</p>
                  <p className="text-[10px] text-muted-foreground">URL loaded when opening a new browser tab</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={homepageDraft}
                    onChange={(e) => setHomepageDraft(e.target.value)}
                    onBlur={() => {
                      if (homepageDraft !== browserHomepage) setBrowserHomepage(homepageDraft)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur()
                      } else if (e.key === 'Escape') {
                        setHomepageDraft(browserHomepage)
                        e.currentTarget.blur()
                      }
                    }}
                    placeholder="https://example.com or about:blank"
                    className="flex-1 px-3 py-2 rounded-lg bg-muted/20 border border-border/30 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setHomepageDraft('about:blank')
                      setBrowserHomepage('about:blank')
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {/* ── Editor ── */}
          <section data-settings-section="editor" className="rounded-xl transition-colors duration-500 scroll-mt-4">
            <SectionHeading icon={Type} title="Editor" description="Code editor configuration" />
            <div className="mt-4">
              <EditorSettingsPane />
            </div>
          </section>

          {/* ── Notifications ── */}
          <section data-settings-section="notifications" className="rounded-xl transition-colors duration-500 scroll-mt-4">
            <SectionHeading icon={Bell} title="Notifications" description="Sound and notification preferences" />
            <div className="mt-4">
              <NotificationsPane
                notifSound={notifSound}
                notifMuted={notifMuted}
                notifVolume={notifVolume}
                onNotifSoundChange={onNotifSoundChange}
                onNotifMutedChange={onNotifMutedChange}
                onNotifVolumeChange={onNotifVolumeChange}
              />
            </div>
          </section>

          {/* ── Shortcuts ── */}
          <section data-settings-section="shortcuts" className="rounded-xl transition-colors duration-500 scroll-mt-4">
            <SectionHeading icon={Keyboard} title="Shortcuts" description="Keyboard shortcut reference" />
            <div className="mt-4">
              <ShortcutsPane isMac={isMac} />
            </div>
          </section>

          {/* ── Experimental ── */}
          <section data-settings-section="experimental" className="rounded-xl transition-colors duration-500 scroll-mt-4">
            <SectionHeading icon={FlaskConical} title="Experimental" description="Early-access features" />
            <div className="mt-4">
              <PlaceholderPane text="Experimental features coming soon" />
            </div>
          </section>
        </div>
      </div>

      <ThemeStudioDialog
        open={themeStudioOpen}
        onOpenChange={(open) => {
          setThemeStudioOpen(open)
          if (!open) {
            setThemeStudioDraft(null)
            setThemeStudioSourceId(activeThemeId)
            reapply()
          }
        }}
        themes={[...builtinThemes, ...customThemes]}
        activeThemeId={activeThemeId}
        sourceThemeId={themeStudioSourceId}
        draftTheme={themeStudioDraft}
        previewMode={themeStudioPreviewMode}
        onPreviewModeChange={setThemeStudioPreviewMode}
        onSelectTheme={(id) => {
          const selected = [...builtinThemes, ...customThemes].find(themeOption => themeOption.id === id)
          if (!selected) return
          setThemeStudioSourceId(id)
          setThemeStudioDraft(cloneTheme(selected))
        }}
        onDraftNameChange={(name) => {
          setThemeStudioDraft((current) => (current ? { ...current, name } : current))
        }}
        onDraftToneModeChange={(mode) => {
          setThemeStudioDraft((current) => {
            if (!current) return current
            if (mode === 'tone') {
              const nextTone = current.tone ?? { hue: 160, saturation: 10 }
              return {
                ...current,
                tone: nextTone,
                roles: {
                  light: deriveRoles(nextTone.hue, nextTone.saturation, 'light'),
                  dark: deriveRoles(nextTone.hue, nextTone.saturation, 'dark'),
                },
              }
            }
            return { ...current, tone: undefined }
          })
        }}
        onDraftToneChange={(key, value) => {
          setThemeStudioDraft((current) => {
            if (!current) return current
            const tone = {
              hue: current.tone?.hue ?? 160,
              saturation: current.tone?.saturation ?? 10,
              [key]: value,
            }
            return {
              ...current,
              tone,
              roles: {
                light: deriveRoles(tone.hue, tone.saturation, 'light'),
                dark: deriveRoles(tone.hue, tone.saturation, 'dark'),
              },
            }
          })
        }}
        onDraftRoleChange={(mode, role, value) => {
          setThemeStudioDraft((current) => {
            if (!current) return current
            return {
              ...current,
              tone: undefined,
              roles: {
                ...current.roles,
                [mode]: {
                  ...current.roles[mode],
                  [role]: value,
                },
              },
            }
          })
        }}
        onDraftChartChange={(mode, index, value) => {
          setThemeStudioDraft((current) => {
            if (!current) return current
            const nextCharts: ChartPalette = [...normalizeTheme(current).charts[mode]] as ChartPalette
            nextCharts[index] = value
            return {
              ...current,
              charts: {
                ...normalizeTheme(current).charts,
                [mode]: nextCharts,
              },
            }
          })
        }}
        onSaveDraft={() => {
          if (!themeStudioDraft) return
          const shouldCreateNew = themeStudioDraft.builtin
          const nextDraft = shouldCreateNew
            ? {
                ...cloneTheme(themeStudioDraft),
                id: createDraftThemeId(),
                builtin: false,
              }
            : { ...cloneTheme(themeStudioDraft), builtin: false }
          const saved = saveCustomTheme(nextDraft, { activate: true })
          setThemeStudioSourceId(saved.id)
          setThemeStudioDraft(cloneTheme(saved))
        }}
        onDuplicateDraft={() => {
          const baseId = themeStudioDraft?.id ?? themeStudioSourceId
          const duplicated = duplicateTheme(baseId, { activate: true })
          if (!duplicated) return
          setThemeStudioSourceId(duplicated.id)
          setThemeStudioDraft(cloneTheme(duplicated))
        }}
        onDeleteDraft={() => {
          if (!themeStudioDraft || themeStudioDraft.builtin) return
          deleteCustomTheme(themeStudioDraft.id)
          const fallback = cloneTheme(getActiveTheme())
          setThemeStudioSourceId(fallback.id)
          setThemeStudioDraft(fallback)
        }}
        onResetDraft={() => {
          const source = [...builtinThemes, ...customThemes].find(themeOption => themeOption.id === themeStudioSourceId)
          if (!source) return
          setThemeStudioDraft(cloneTheme(source))
        }}
        onExportDraft={() => {
          if (!themeStudioDraft) return
          exportThemeJson(normalizeTheme(themeStudioDraft))
        }}
        onImportTheme={(theme) => {
          const imported = saveCustomTheme({
            ...normalizeTheme(theme),
            id: theme.builtin ? createDraftThemeId() : (theme.id || createDraftThemeId()),
            builtin: false,
            name: theme.name || 'Imported Theme',
          }, { activate: true })
          setThemeStudioSourceId(imported.id)
          setThemeStudioDraft(cloneTheme(imported))
        }}
        onDraftTypographyChange={(patch) => {
          setThemeStudioDraft((current) => {
            if (!current) return current
            const normalized = normalizeTheme(current)
            return {
              ...current,
              typography: {
                ...normalized.typography,
                ...patch,
                letterSpacing: {
                  ...normalized.typography.letterSpacing,
                  ...patch.letterSpacing,
                },
                fontWeight: {
                  ...normalized.typography.fontWeight,
                  ...patch.fontWeight,
                },
              },
            }
          })
        }}
        onDraftDensityChange={(patch) => {
          setThemeStudioDraft((current) => {
            if (!current) return current
            const normalized = normalizeTheme(current)
            return {
              ...current,
              density: {
                ...normalized.density,
                ...patch,
                controlHeight: {
                  ...normalized.density.controlHeight,
                  ...patch.controlHeight,
                },
              },
            }
          })
        }}
        onDraftRadiiChange={(patch) => {
          setThemeStudioDraft((current) => {
            if (!current) return current
            const normalized = normalizeTheme(current)
            return {
              ...current,
              radii: {
                ...normalized.radii,
                ...patch,
              },
            }
          })
        }}
        onDraftShadowsChange={(patch) => {
          setThemeStudioDraft((current) => {
            if (!current) return current
            const normalized = normalizeTheme(current)
            return {
              ...current,
              shadows: {
                ...normalized.shadows,
                ...patch,
              },
            }
          })
        }}
        onDraftMotionChange={(patch) => {
          setThemeStudioDraft((current) => {
            if (!current) return current
            const normalized = normalizeTheme(current)
            return {
              ...current,
              motion: {
                ...normalized.motion,
                ...patch,
                durationMs: {
                  ...normalized.motion.durationMs,
                  ...patch.durationMs,
                },
              },
            }
          })
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function SectionHeading({ icon: Icon, title, description }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 pb-1 border-b border-border/30">
      <div className="rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 p-2 text-primary ring-1 ring-primary/15 mt-0.5">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0 pb-3">
        <h2 className="text-base font-black tracking-tight leading-tight">{title}</h2>
        <p className="text-[11px] text-muted-foreground/80 mt-0.5">{description}</p>
      </div>
    </div>
  )
}

function PlaceholderPane({ text }: { text: string }) {
  return (
    <div className="p-8 rounded-xl border border-dashed border-border/30 bg-gradient-to-b from-muted/5 to-transparent text-center">
      <p className="text-xs text-muted-foreground/50 font-medium tracking-wide">{text}</p>
    </div>
  )
}

function EditorSettingsPane() {
  const editorSettings = useAppStore((s) => s.editorSettings)
  const setEditorSettings = useAppStore((s) => s.setEditorSettings)

  return (
    <div className="space-y-3">
      <div className="p-4 rounded-xl border border-border/40 bg-gradient-to-b from-card via-card to-muted/20 grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground mb-1">Font Size</p>
          <div className="flex items-center gap-3">
            <input
              type="range" min={10} max={20} step={1}
              value={editorSettings.fontSize}
              onChange={(e) => setEditorSettings({ fontSize: Number(e.target.value) })}
              className="flex-1 accent-primary"
            />
            <span className="text-[11px] font-mono text-muted-foreground w-6 text-right">{editorSettings.fontSize}</span>
          </div>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground mb-1">Tab Size</p>
          <div className="flex items-center gap-3">
            <input
              type="range" min={1} max={8} step={1}
              value={editorSettings.tabSize}
              onChange={(e) => setEditorSettings({ tabSize: Number(e.target.value) })}
              className="flex-1 accent-primary"
            />
            <span className="text-[11px] font-mono text-muted-foreground w-6 text-right">{editorSettings.tabSize}</span>
          </div>
        </div>
        <div className="md:col-span-2">
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground mb-1">Font Family</p>
          <input
            value={editorSettings.fontFamily}
            placeholder="Default (inherit from theme)"
            onChange={(e) => setEditorSettings({ fontFamily: e.target.value })}
            className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-[11px] font-mono outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      <div className="p-4 rounded-xl border border-border/40 bg-gradient-to-b from-card via-card to-muted/20 grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground mb-1.5">Word Wrap</p>
          <select
            value={editorSettings.wordWrap}
            onChange={(e) => setEditorSettings({ wordWrap: e.target.value as typeof editorSettings.wordWrap })}
            className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-[11px] outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="on">On</option>
            <option value="off">Off</option>
            <option value="wordWrapColumn">At Column</option>
            <option value="bounded">Bounded</option>
          </select>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground mb-1.5">Line Numbers</p>
          <select
            value={editorSettings.lineNumbers}
            onChange={(e) => setEditorSettings({ lineNumbers: e.target.value as typeof editorSettings.lineNumbers })}
            className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-[11px] outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="on">On</option>
            <option value="off">Off</option>
            <option value="relative">Relative</option>
          </select>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground mb-1.5">Render Whitespace</p>
          <select
            value={editorSettings.renderWhitespace}
            onChange={(e) => setEditorSettings({ renderWhitespace: e.target.value as typeof editorSettings.renderWhitespace })}
            className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-[11px] outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="none">None</option>
            <option value="boundary">Boundary</option>
            <option value="selection">Selection</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      <div className="p-4 rounded-xl border border-border/40 bg-gradient-to-b from-card via-card to-muted/20 space-y-2">
        {([
          { key: 'minimap', label: 'Show Minimap' },
          { key: 'formatOnSave', label: 'Format on Save' },
        ] as const).map(({ key, label }) => (
          <label key={key} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-muted/20 cursor-pointer">
            <span className="text-[12px] font-medium">{label}</span>
            <button
              type="button"
              aria-pressed={editorSettings[key]}
              onClick={() => setEditorSettings({ [key]: !editorSettings[key] })}
              className={`relative h-5 w-9 rounded-full transition-colors ${editorSettings[key] ? 'bg-primary' : 'bg-muted'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${editorSettings[key] ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </label>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Appearance — Mode picker (Light / Dark / Auto)
// ---------------------------------------------------------------------------

function AppearanceModePane({
  modeOverride,
  onModeChange,
}: {
  modeOverride: ThemeMode
  onModeChange: (mode: ThemeMode) => void
}) {
  const modes: Array<{ id: ThemeMode; label: string }> = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'auto', label: 'Auto' },
  ]
  return (
    <div className="p-4 rounded-xl border border-border/40 bg-gradient-to-b from-card via-card to-muted/20">
      <div className="space-y-0.5 mb-3">
        <p className="text-xs font-black tracking-tight">Mode</p>
        <p className="text-[10px] text-muted-foreground">
          Light, dark, or follow your system. Active theme adapts to the chosen mode.
        </p>
      </div>
      <div className="flex gap-2">
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => onModeChange(m.id)}
            className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
              modeOverride === m.id
                ? 'bg-white text-black shadow-lg shadow-black/20'
                : 'bg-muted/30 text-muted-foreground hover:bg-muted/50'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Appearance — Theme preset picker
// ---------------------------------------------------------------------------

function ThemePresetPane({
  themes,
  activeThemeId,
  modeOverride,
  onSelect,
  onOpenStudio,
}: {
  themes: Theme[]
  activeThemeId: string
  modeOverride: ThemeMode
  onSelect: (id: string) => void
  onOpenStudio: () => void
}) {
  const resolved: 'light' | 'dark' = modeOverride === 'auto' ? resolveMode('auto') : modeOverride
  return (
    <div className="p-4 rounded-xl border border-border/40 bg-gradient-to-b from-card via-card to-muted/20">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-xs font-black tracking-tight">Theme</p>
          <p className="text-[10px] text-muted-foreground">
            Pick a preset or open Theme Studio to start shaping a custom look.
          </p>
        </div>
        <Button size="sm" variant="outline" className="shrink-0 gap-2" onClick={onOpenStudio}>
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Theme Studio
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {themes.map((t) => (
          <ThemeSwatchCard
            key={t.id}
            theme={t}
            mode={resolved}
            active={t.id === activeThemeId}
            onClick={() => onSelect(t.id)}
          />
        ))}
      </div>
    </div>
  )
}

function ThemeStudioDialog({
  open,
  onOpenChange,
  themes,
  activeThemeId,
  sourceThemeId,
  draftTheme,
  previewMode,
  onPreviewModeChange,
  onSelectTheme,
  onDraftNameChange,
  onDraftToneModeChange,
  onDraftToneChange,
  onDraftRoleChange,
  onDraftChartChange,
  onSaveDraft,
  onDuplicateDraft,
  onDeleteDraft,
  onResetDraft,
  onExportDraft,
  onImportTheme,
  onDraftTypographyChange,
  onDraftDensityChange,
  onDraftRadiiChange,
  onDraftShadowsChange,
  onDraftMotionChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  themes: Theme[]
  activeThemeId: string
  sourceThemeId: string
  draftTheme: Theme | null
  previewMode: 'light' | 'dark'
  onPreviewModeChange: (mode: 'light' | 'dark') => void
  onSelectTheme: (id: string) => void
  onDraftNameChange: (name: string) => void
  onDraftToneModeChange: (mode: 'tone' | 'manual') => void
  onDraftToneChange: (key: 'hue' | 'saturation', value: number) => void
  onDraftRoleChange: (mode: 'light' | 'dark', role: ThemeRoleKey, value: string) => void
  onDraftChartChange: (mode: 'light' | 'dark', index: number, value: string) => void
  onSaveDraft: () => void
  onDuplicateDraft: () => void
  onDeleteDraft: () => void
  onResetDraft: () => void
  onExportDraft: () => void
  onImportTheme: (theme: Theme) => void
  onDraftTypographyChange: (patch: TypographyPatch) => void
  onDraftDensityChange: (patch: DensityPatch) => void
  onDraftRadiiChange: (patch: Partial<NonNullable<Theme['radii']>>) => void
  onDraftShadowsChange: (patch: Partial<NonNullable<Theme['shadows']>>) => void
  onDraftMotionChange: (patch: MotionPatch) => void
}) {
  const draft = draftTheme ? normalizeTheme(draftTheme) : null
  const importInputRef = useRef<HTMLInputElement>(null)
  if (!draft) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        srTitle="Theme Studio"
        showCloseButton={false}
        className="left-0 top-0 h-screen w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0 p-0 overflow-hidden bg-background sm:rounded-none"
      >
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="border-b border-border/40 px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="text-xl font-black tracking-tight">Theme Studio</DialogTitle>
                <DialogDescription className="mt-1 text-[12px] max-w-2xl">
                  Pick a base theme, edit colors, typography, density, and motion. Changes apply live. Save to persist.
                </DialogDescription>
              </div>
              <div className="ml-auto flex items-start gap-2">
                <div className="flex items-center gap-2">
                  <PreviewModeToggle value={previewMode} onChange={onPreviewModeChange} />
                  <Button size="sm" className="gap-2" onClick={onSaveDraft}>
                    Save Theme
                  </Button>
                  <div className="flex items-center gap-1 rounded-xl border border-border/40 bg-card/60 p-1">
                    <Button size="icon" variant="ghost" tooltip="Duplicate theme" onClick={onDuplicateDraft}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" tooltip="Import theme" onClick={() => importInputRef.current?.click()}>
                      <Upload className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" tooltip="Export theme" onClick={onExportDraft}>
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" tooltip="Reset draft" onClick={onResetDraft}>
                      <RefreshCcw className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      tooltip={draft.builtin ? 'Built-in themes cannot be deleted' : 'Delete custom theme'}
                      onClick={onDeleteDraft}
                      disabled={draft.builtin}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <DialogClose asChild>
                  <Button size="icon" variant="ghost" className="shrink-0" aria-label="Close Theme Studio">
                    <span className="sr-only">Close Theme Studio</span>
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </Button>
                </DialogClose>
              </div>
            </div>
          </DialogHeader>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.currentTarget.value = ''
              if (!file) return
              const imported = await importThemeJson(file)
              if (imported) onImportTheme(imported)
            }}
          />

          <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_360px]">
            <div className="min-h-0 border-r border-border/40 bg-card/30">
              <ThemeStudioThemeList
                themes={themes}
                activeThemeId={activeThemeId}
                sourceThemeId={sourceThemeId}
                previewMode={previewMode}
                onSelectTheme={onSelectTheme}
              />
            </div>

            <div className="min-h-0 overflow-y-auto custom-scrollbar bg-background">
              <ThemeStudioEditorPane
                draft={draft}
                sourceThemeId={sourceThemeId}
                previewMode={previewMode}
                onDraftNameChange={onDraftNameChange}
                onDraftToneModeChange={onDraftToneModeChange}
                onDraftToneChange={onDraftToneChange}
                onDraftRoleChange={onDraftRoleChange}
                onDraftChartChange={onDraftChartChange}
                onDraftTypographyChange={onDraftTypographyChange}
                onDraftDensityChange={onDraftDensityChange}
                onDraftRadiiChange={onDraftRadiiChange}
                onDraftShadowsChange={onDraftShadowsChange}
                onDraftMotionChange={onDraftMotionChange}
              />
            </div>

            <div className="min-h-0 border-l border-border/40 bg-card/20">
              <ThemeStudioPreviewPane draft={draft} previewMode={previewMode} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ThemeStudioThemeList({
  themes,
  activeThemeId,
  sourceThemeId,
  previewMode,
  onSelectTheme,
}: {
  themes: Theme[]
  activeThemeId: string
  sourceThemeId: string
  previewMode: 'light' | 'dark'
  onSelectTheme: (id: string) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/40 px-4 py-4">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/80">Themes</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Choose a base preset for the working draft.</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-3">
        <div className="space-y-2">
          {themes.map((theme) => {
            const normalized = normalizeTheme(theme)
            const isSelected = sourceThemeId === theme.id
            const isActive = activeThemeId === theme.id
            const roles = normalized.roles[previewMode]
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => onSelectTheme(theme.id)}
                className={`w-full rounded-xl border p-3 text-left transition-all ${
                  isSelected
                    ? 'border-primary/60 bg-primary/8 shadow-sm'
                    : 'border-border/40 bg-card/60 hover:border-border/70 hover:bg-card'
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-bold tracking-tight">{theme.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {theme.builtin ? 'Built-in' : 'Custom'}{isActive ? ' • active' : ''}
                    </p>
                  </div>
                  {isSelected ? <Check className="h-4 w-4 text-primary" /> : null}
                </div>
                <div className="flex gap-1.5">
                  <div className="h-8 flex-1 rounded-lg border border-black/10" style={{ background: `hsl(${roles.background})` }} />
                  <div className="h-8 flex-1 rounded-lg border border-black/10" style={{ background: `hsl(${roles.surface})` }} />
                  <div className="h-8 flex-1 rounded-lg border border-black/10" style={{ background: `hsl(${roles.accent})` }} />
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ThemeStudioEditorPane({
  draft,
  sourceThemeId,
  previewMode,
  onDraftNameChange,
  onDraftToneModeChange,
  onDraftToneChange,
  onDraftRoleChange,
  onDraftChartChange,
  onDraftTypographyChange,
  onDraftDensityChange,
  onDraftRadiiChange,
  onDraftShadowsChange,
  onDraftMotionChange,
}: {
  draft: ReturnType<typeof normalizeTheme>
  sourceThemeId: string
  previewMode: 'light' | 'dark'
  onDraftNameChange: (name: string) => void
  onDraftToneModeChange: (mode: 'tone' | 'manual') => void
  onDraftToneChange: (key: 'hue' | 'saturation', value: number) => void
  onDraftRoleChange: (mode: 'light' | 'dark', role: ThemeRoleKey, value: string) => void
  onDraftChartChange: (mode: 'light' | 'dark', index: number, value: string) => void
  onDraftTypographyChange: (patch: TypographyPatch) => void
  onDraftDensityChange: (patch: DensityPatch) => void
  onDraftRadiiChange: (patch: Partial<NonNullable<Theme['radii']>>) => void
  onDraftShadowsChange: (patch: Partial<NonNullable<Theme['shadows']>>) => void
  onDraftMotionChange: (patch: MotionPatch) => void
}) {
  const roleSet = draft.roles[previewMode]
  const colorMode = draft.tone ? 'tone' : 'manual'

  return (
    <div className="px-6 py-5">
      <div className="surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/75">Draft</p>
            <input
              value={draft.name}
              onChange={(event) => onDraftNameChange(event.target.value)}
              className="mt-2 w-full rounded-xl border border-border/40 bg-background px-3 py-2 text-lg font-black tracking-tight outline-none focus:ring-2 focus:ring-primary/30"
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Based on <span className="font-mono">{sourceThemeId}</span>. Unsaved changes apply live but reset on close.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4">
        <div className="surface p-4 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black tracking-tight">Color Roles</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Edit the {previewMode} palette directly or drive both palettes from a tone seed.
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-border/40 bg-muted/20 p-1">
              {(['tone', 'manual'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onDraftToneModeChange(mode)}
                  className={`rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] transition-all ${
                    colorMode === mode ? 'bg-white text-black shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {mode === 'tone' ? 'Tone Seed' : 'Manual'}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-4">
              {colorMode === 'tone' ? (
                <ToneSeedEditor
                  tone={draft.tone ?? { hue: 160, saturation: 10 }}
                  roleSet={roleSet}
                  onToneChange={onDraftToneChange}
                />
              ) : null}

              {ROLE_SECTIONS.map((section) => (
                <div key={section.title} className="rounded-2xl border border-border/40 bg-card/60 p-4">
                  <div className="mb-3">
                    <h4 className="text-[12px] font-black tracking-tight">{section.title}</h4>
                  </div>
                  <div className="space-y-4">
                    {section.roles.map((role) => (
                      <RoleEditorCard
                        key={role.key}
                        label={role.label}
                        description={role.description}
                        value={roleSet[role.key]}
                        disabled={colorMode === 'tone'}
                        onChange={(value) => onDraftRoleChange(previewMode, role.key, value)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <ContrastPanel roleSet={roleSet} />
              <ChartPaletteEditor
                palette={draft.charts[previewMode]}
                onChange={(index, value) => onDraftChartChange(previewMode, index, value)}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <TypographyEditor draft={draft} onChange={onDraftTypographyChange} />
          <DensityShapeEditor
            draft={draft}
            onDensityChange={onDraftDensityChange}
            onRadiiChange={onDraftRadiiChange}
          />
          <SurfaceMotionEditor
            draft={draft}
            onShadowChange={onDraftShadowsChange}
            onMotionChange={onDraftMotionChange}
          />
          <ThemeSummaryCard draft={draft} />
        </div>
      </div>
    </div>
  )
}

function TypographyEditor({
  draft,
  onChange,
}: {
  draft: ReturnType<typeof normalizeTheme>
  onChange: (patch: TypographyPatch) => void
}) {
  return (
    <div className="surface p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary ring-1 ring-primary/15">
          <Type className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-black tracking-tight">Typography</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">Fonts, size scale, line-height, and weight tuning.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        <TextField
          label="Sans Font Stack"
          value={draft.typography.fontSans}
          onChange={(value) => onChange({ fontSans: value })}
        />
        <TextField
          label="Mono Font Stack"
          value={draft.typography.fontMono}
          onChange={(value) => onChange({ fontMono: value })}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <RangeField
            label="Base Size"
            min={12}
            max={18}
            step={1}
            value={draft.typography.baseSizePx}
            onChange={(value) => onChange({ baseSizePx: value })}
          />
          <RangeField
            label="Line Height"
            min={1.2}
            max={1.7}
            step={0.05}
            value={draft.typography.lineHeight}
            onChange={(value) => onChange({ lineHeight: value })}
          />
          <RangeField
            label="Heading Scale"
            min={1.125}
            max={1.5}
            step={0.025}
            value={draft.typography.headingScale}
            onChange={(value) => onChange({ headingScale: value })}
          />
          <RangeField
            label="Heading Weight"
            min={500}
            max={900}
            step={10}
            value={draft.typography.fontWeight.heading}
            onChange={(value) => onChange({ fontWeight: { heading: value } })}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <RangeField
            label="Body Spacing"
            min={-0.04}
            max={0.08}
            step={0.005}
            value={draft.typography.letterSpacing.bodyEm}
            onChange={(value) => onChange({ letterSpacing: { bodyEm: value } })}
          />
          <RangeField
            label="Heading Spacing"
            min={-0.08}
            max={0.04}
            step={0.005}
            value={draft.typography.letterSpacing.headingEm}
            onChange={(value) => onChange({ letterSpacing: { headingEm: value } })}
          />
          <RangeField
            label="Code Spacing"
            min={-0.08}
            max={0.04}
            step={0.005}
            value={draft.typography.letterSpacing.codeEm}
            onChange={(value) => onChange({ letterSpacing: { codeEm: value } })}
          />
        </div>
      </div>
    </div>
  )
}

function DensityShapeEditor({
  draft,
  onDensityChange,
  onRadiiChange,
}: {
  draft: ReturnType<typeof normalizeTheme>
  onDensityChange: (patch: DensityPatch) => void
  onRadiiChange: (patch: Partial<NonNullable<Theme['radii']>>) => void
}) {
  return (
    <div className="surface p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary ring-1 ring-primary/15">
          <PanelLeft className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-black tracking-tight">Density & Shape</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">Spacing cadence, control heights, border width, and radii.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        <SelectField
          label="Density Preset"
          value={draft.density.preset}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'cozy', label: 'Cozy' },
            { value: 'comfortable', label: 'Comfortable' },
          ]}
          onChange={(value) => onDensityChange({ preset: value as NonNullable<Theme['density']>['preset'] })}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <RangeField
            label="Spacing Scale"
            min={0.85}
            max={1.2}
            step={0.01}
            value={draft.density.spacingScale}
            onChange={(value) => onDensityChange({ spacingScale: value })}
          />
          <RangeField
            label="Border Width"
            min={1}
            max={3}
            step={1}
            value={draft.density.borderWidthPx}
            onChange={(value) => onDensityChange({ borderWidthPx: value })}
          />
          <RangeField
            label="Control Small"
            min={28}
            max={40}
            step={1}
            value={draft.density.controlHeight.sm}
            onChange={(value) => onDensityChange({ controlHeight: { sm: value } })}
          />
          <RangeField
            label="Control Medium"
            min={32}
            max={48}
            step={1}
            value={draft.density.controlHeight.md}
            onChange={(value) => onDensityChange({ controlHeight: { md: value } })}
          />
          <RangeField
            label="Control Large"
            min={36}
            max={56}
            step={1}
            value={draft.density.controlHeight.lg}
            onChange={(value) => onDensityChange({ controlHeight: { lg: value } })}
          />
        </div>
        <SelectField
          label="Radius Scale"
          value={draft.radii.scale}
          options={[
            { value: 'sharp', label: 'Sharp' },
            { value: 'default', label: 'Default' },
            { value: 'rounded', label: 'Rounded' },
            { value: 'pill', label: 'Pill' },
          ]}
          onChange={(value) => onRadiiChange({ scale: value as NonNullable<Theme['radii']>['scale'] })}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <RangeField
            label="Radius Small"
            min={0}
            max={1}
            step={0.05}
            value={draft.radii.smRem}
            onChange={(value) => onRadiiChange({ smRem: value })}
          />
          <RangeField
            label="Radius Medium"
            min={0}
            max={1.25}
            step={0.05}
            value={draft.radii.mdRem}
            onChange={(value) => onRadiiChange({ mdRem: value })}
          />
          <RangeField
            label="Radius Large"
            min={0}
            max={1.5}
            step={0.05}
            value={draft.radii.lgRem}
            onChange={(value) => onRadiiChange({ lgRem: value })}
          />
          <RangeField
            label="Radius XL"
            min={0}
            max={2}
            step={0.05}
            value={draft.radii.xlRem}
            onChange={(value) => onRadiiChange({ xlRem: value })}
          />
        </div>
      </div>
    </div>
  )
}

function SurfaceMotionEditor({
  draft,
  onShadowChange,
  onMotionChange,
}: {
  draft: ReturnType<typeof normalizeTheme>
  onShadowChange: (patch: Partial<NonNullable<Theme['shadows']>>) => void
  onMotionChange: (patch: MotionPatch) => void
}) {
  return (
    <div className="surface p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary ring-1 ring-primary/15">
          <Eye className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-black tracking-tight">Surface & Motion</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">Shadow character, blur, motion scale, and reduced-motion tuning.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        <SelectField
          label="Shadow Strength"
          value={draft.shadows.strength}
          options={[
            { value: 'none', label: 'None' },
            { value: 'subtle', label: 'Subtle' },
            { value: 'default', label: 'Default' },
            { value: 'strong', label: 'Strong' },
          ]}
          onChange={(value) => onShadowChange({ strength: value as NonNullable<Theme['shadows']>['strength'] })}
        />
        <TextField
          label="Surface Shadow"
          value={draft.shadows.surface}
          onChange={(value) => onShadowChange({ surface: value })}
        />
        <TextField
          label="Overlay Shadow"
          value={draft.shadows.overlay}
          onChange={(value) => onShadowChange({ overlay: value })}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <RangeField
            label="Backdrop Blur"
            min={0}
            max={32}
            step={1}
            value={draft.motion.backdropBlurPx}
            onChange={(value) => onMotionChange({ backdropBlurPx: value })}
          />
          <RangeField
            label="Motion Scale"
            min={0.5}
            max={1.5}
            step={0.05}
            value={draft.motion.scale}
            onChange={(value) => onMotionChange({ scale: value })}
          />
          <RangeField
            label="Fast Duration"
            min={50}
            max={400}
            step={10}
            value={draft.motion.durationMs.fast}
            onChange={(value) => onMotionChange({ durationMs: { fast: value } })}
          />
          <RangeField
            label="Base Duration"
            min={80}
            max={600}
            step={10}
            value={draft.motion.durationMs.base}
            onChange={(value) => onMotionChange({ durationMs: { base: value } })}
          />
          <RangeField
            label="Slow Duration"
            min={120}
            max={900}
            step={10}
            value={draft.motion.durationMs.slow}
            onChange={(value) => onMotionChange({ durationMs: { slow: value } })}
          />
        </div>
        <ToggleField
          label="Reduce Motion Override"
          checked={draft.motion.reduceMotion}
          onChange={(checked) => onMotionChange({ reduceMotion: checked })}
        />
      </div>
    </div>
  )
}

function ThemeSummaryCard({ draft }: { draft: ReturnType<typeof normalizeTheme> }) {
  return (
    <div className="surface p-4">
      <h3 className="text-sm font-black tracking-tight">Current Draft Readout</h3>
      <div className="mt-4 space-y-2">
        {[
          `Sans: ${draft.typography.fontSans}`,
          `Mono: ${draft.typography.fontMono}`,
          `Density: ${draft.density.preset} / ${draft.density.spacingScale.toFixed(2)}x`,
          `Radius: ${draft.radii.scale} / lg ${draft.radii.lgRem.toFixed(2)}rem`,
          `Shadow: ${draft.shadows.strength}`,
          `Motion: ${draft.motion.reduceMotion ? 'reduce' : `${draft.motion.scale.toFixed(2)}x`}`,
        ].map((item) => (
          <div key={item} className="surface-sub px-3 py-2 text-[11px] text-foreground/85">
            {item}
          </div>
        ))}
      </div>
    </div>
  )
}

function ToneSeedEditor({
  tone,
  roleSet,
  onToneChange,
}: {
  tone: { hue: number; saturation: number }
  roleSet: RoleSet
  onToneChange: (key: 'hue' | 'saturation', value: number) => void
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-[12px] font-black tracking-tight">Tone Seed</h4>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Regenerate both light and dark role sets from a shared hue and saturation axis.
          </p>
        </div>
        <div className="flex gap-1.5">
          {(['background', 'surface', 'accent'] as const).map((key) => (
            <div key={key} className="h-8 w-8 rounded-full border border-black/10" style={{ background: `hsl(${roleSet[key]})` }} />
          ))}
        </div>
      </div>
      <div className="mt-4 space-y-4">
        <RangeField
          label="Hue"
          min={0}
          max={360}
          step={1}
          value={tone.hue}
          onChange={(value) => onToneChange('hue', value)}
        />
        <RangeField
          label="Saturation"
          min={0}
          max={30}
          step={1}
          value={tone.saturation}
          onChange={(value) => onToneChange('saturation', value)}
        />
      </div>
    </div>
  )
}

function RoleEditorCard({
  label,
  description,
  value,
  disabled,
  onChange,
}: {
  label: string
  description: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const color = parseHslTriplet(value)
  const hexValue = hslTripletToHex(value)

  return (
    <div className={`rounded-xl border border-border/40 bg-background/70 p-3 ${disabled ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 rounded-full border border-black/10" style={{ background: `hsl(${value})` }} />
            <h5 className="text-[12px] font-bold tracking-tight">{label}</h5>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-lg border border-border/40 bg-muted/20 px-2 py-1 text-[10px] font-mono text-muted-foreground">
          {value}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[104px_minmax(0,1fr)]">
        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground">Hex</span>
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={hexValue}
                disabled={disabled}
                onChange={(event) => {
                  const next = hexToHslTriplet(event.target.value)
                  if (next) onChange(next)
                }}
                className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-border/40 bg-card p-0.5 disabled:cursor-not-allowed"
              />
              <input
                value={hexValue}
                disabled={disabled}
                onChange={(event) => {
                  const next = hexToHslTriplet(event.target.value)
                  if (next) onChange(next)
                }}
                className="w-full rounded-lg border border-border/40 bg-card px-2 py-2 text-[11px] font-mono outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed"
              />
            </div>
          </label>
        </div>
        <div className="space-y-2">
          <RangeField
            label="Hue"
            min={0}
            max={360}
            step={1}
            value={color.hue}
            disabled={disabled}
            onChange={(next) => onChange(formatHslTriplet({ ...color, hue: next }))}
          />
          <RangeField
            label="Sat"
            min={0}
            max={100}
            step={1}
            value={color.saturation}
            disabled={disabled}
            onChange={(next) => onChange(formatHslTriplet({ ...color, saturation: next }))}
          />
          <RangeField
            label="Light"
            min={0}
            max={100}
            step={1}
            value={color.lightness}
            disabled={disabled}
            onChange={(next) => onChange(formatHslTriplet({ ...color, lightness: next }))}
          />
        </div>
      </div>
    </div>
  )
}

function ContrastPanel({ roleSet }: { roleSet: RoleSet }) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-4">
      <div className="mb-3">
        <h4 className="text-[12px] font-black tracking-tight">Contrast</h4>
        <p className="mt-1 text-[11px] text-muted-foreground">Quick WCAG readout for the key foreground/background pairs.</p>
      </div>
      <div className="space-y-2">
        {CONTRAST_PAIRS.map((pair) => {
          const ratio = contrastRatio(roleSet[pair.foreground], roleSet[pair.background])
          const badge = wcagBadge(ratio)
          return (
            <div key={pair.label} className="flex items-center justify-between gap-3 rounded-xl border border-border/30 bg-background/70 px-3 py-2">
              <div>
                <p className="text-[11px] font-bold">{pair.label}</p>
                <p className="text-[10px] text-muted-foreground">{ratio.toFixed(2)}:1</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] ${
                badge === 'AAA'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : badge === 'AA'
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-red-500/15 text-red-300'
              }`}>
                {badge}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ChartPaletteEditor({
  palette,
  onChange,
}: {
  palette: ChartPalette
  onChange: (index: number, value: string) => void
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 p-4">
      <div className="mb-3">
        <h4 className="text-[12px] font-black tracking-tight">Chart Palette</h4>
        <p className="mt-1 text-[11px] text-muted-foreground">Edit the five chart stops used by shared data visualizations.</p>
      </div>
      <div className="space-y-3">
        {palette.map((stop, index) => (
          <div key={`${index}-${stop}`} className="rounded-xl border border-border/30 bg-background/70 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="h-5 w-5 rounded-full border border-black/10" style={{ background: `hsl(${stop})` }} />
                <span className="text-[11px] font-bold">Slot {index + 1}</span>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground">{stop}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={hslTripletToHex(stop)}
                onChange={(event) => {
                  const next = hexToHslTriplet(event.target.value)
                  if (next) onChange(index, next)
                }}
                className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-border/40 bg-card p-0.5"
              />
              <input
                value={hslTripletToHex(stop)}
                onChange={(event) => {
                  const next = hexToHslTriplet(event.target.value)
                  if (next) onChange(index, next)
                }}
                className="w-full rounded-lg border border-border/40 bg-card px-2 py-2 text-[11px] font-mono outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RangeField({
  label,
  min,
  max,
  step,
  value,
  disabled,
  onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
        <span className="text-[10px] font-mono text-muted-foreground">{Number.isInteger(value) ? value : value.toFixed(step < 0.1 ? 3 : step < 1 ? 2 : 0)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary disabled:cursor-not-allowed"
      />
    </label>
  )
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-[11px] outline-none focus:ring-2 focus:ring-primary/20"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-[11px] outline-none focus:ring-2 focus:ring-primary/20"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-border/30 bg-background/70 px-3 py-2">
      <span className="text-[11px] font-bold">{label}</span>
      <button
        type="button"
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  )
}

function ThemeStudioPreviewPane({
  draft,
  previewMode,
}: {
  draft: ReturnType<typeof normalizeTheme>
  previewMode: 'light' | 'dark'
}) {
  const roles = draft.roles[previewMode]
  const palette = draft.charts[previewMode]
  const panelStyle = {
    background: `hsl(${roles.background})`,
    color: `hsl(${roles.text})`,
    fontFamily: draft.typography.fontSans,
    fontSize: `${draft.typography.baseSizePx}px`,
    lineHeight: draft.typography.lineHeight,
  } as const
  const cardStyle = {
    background: `linear-gradient(to bottom, hsl(${roles.surface}), hsl(${roles.surface}), hsl(${roles.surfaceSunken} / 0.2))`,
    border: `${draft.density.borderWidthPx}px solid hsl(${roles.border} / 0.45)`,
    borderRadius: `${draft.radii.lgRem}rem`,
    boxShadow: draft.shadows.surface,
  } as const

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/40 px-4 py-4">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/80">Preview</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Live readout of the current draft in {previewMode} mode.</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-4">
        <div className="space-y-4 rounded-[1.25rem] border border-border/20 p-4" style={panelStyle}>
          <div style={cardStyle} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: `hsl(${roles.textMuted})` }}>Workspace</p>
                <h3 className="mt-1 text-lg font-black tracking-tight">{draft.name}</h3>
              </div>
              <div
                className="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em]"
                style={{ background: `hsl(${roles.accent})`, color: `hsl(${roles.accentForeground})` }}
              >
                Active
              </div>
            </div>
            <p className="mt-3 text-[12px]" style={{ color: `hsl(${roles.textMuted})` }}>
              Preview surfaces, typography, density, and motion tokens before the full editor lands.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="rounded-full px-3 py-2 text-[11px] font-bold"
                style={{ background: `hsl(${roles.accent})`, color: `hsl(${roles.accentForeground})` }}
              >
                Primary Action
              </button>
              <button
                type="button"
                className="rounded-full px-3 py-2 text-[11px] font-bold"
                style={{
                  background: `hsl(${roles.surfaceRaised})`,
                  color: `hsl(${roles.text})`,
                  border: `${draft.density.borderWidthPx}px solid hsl(${roles.borderStrong})`,
                }}
              >
                Secondary
              </button>
            </div>
          </div>

          <div style={cardStyle} className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-black tracking-tight">Chart Palette</h4>
              <span className="text-[10px]" style={{ color: `hsl(${roles.textMuted})` }}>5 slots</span>
            </div>
            <div className="flex gap-2">
              {palette.map((stop) => (
                <div
                  key={stop}
                  className="h-12 flex-1 rounded-xl border border-black/10"
                  style={{ background: `hsl(${stop})` }}
                />
              ))}
            </div>
          </div>

          <div style={cardStyle} className="p-4">
            <div className="grid grid-cols-3 gap-2">
              <PreviewStat label="Density" value={draft.density.preset} muted={roles.textMuted} />
              <PreviewStat label="Radius" value={draft.radii.scale} muted={roles.textMuted} />
              <PreviewStat label="Motion" value={draft.motion.reduceMotion ? 'Reduce' : `${draft.motion.scale}x`} muted={roles.textMuted} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function PreviewModeToggle({
  value,
  onChange,
}: {
  value: 'light' | 'dark'
  onChange: (mode: 'light' | 'dark') => void
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-border/40 bg-muted/20 p-1">
      {(['light', 'dark'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={`rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] transition-all ${
            value === mode ? 'bg-white text-black shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {mode}
        </button>
      ))}
    </div>
  )
}

function PreviewStat({ label, value, muted }: { label: string; value: string; muted: string }) {
  return (
    <div className="rounded-xl border border-black/10 bg-black/5 px-3 py-2">
      <p className="text-[9px] font-black uppercase tracking-[0.16em]" style={{ color: `hsl(${muted})` }}>{label}</p>
      <p className="mt-1 text-xs font-bold">{value}</p>
    </div>
  )
}

function cloneTheme(theme: Theme): Theme {
  return JSON.parse(JSON.stringify(normalizeTheme(theme))) as Theme
}

function createDraftThemeId(): string {
  try {
    return `theme-${crypto.randomUUID()}`
  } catch {
    return `theme-${Date.now().toString(36)}`
  }
}

function exportThemeJson(theme: Theme): void {
  try {
    const blob = new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${slugifyThemeName(theme.name || 'theme')}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  } catch {
    // ignore export failures in non-DOM environments
  }
}

async function importThemeJson(file: File): Promise<Theme | null> {
  try {
    const text = await file.text()
    const parsed = JSON.parse(text) as Theme
    return normalizeTheme({
      ...parsed,
      id: parsed.id || createDraftThemeId(),
      name: parsed.name || file.name.replace(/\.json$/i, '') || 'Imported Theme',
      builtin: false,
    })
  } catch {
    return null
  }
}

function slugifyThemeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'theme'
}

function ThemeSwatchCard({
  theme,
  mode,
  active,
  onClick,
}: {
  theme: Theme
  mode: 'light' | 'dark'
  active: boolean
  onClick: () => void
}) {
  const roles = theme.roles[mode]
  const bg = `hsl(${roles.background})`
  const surface = `hsl(${roles.surface})`
  const surfaceRaised = `hsl(${roles.surfaceRaised})`
  const text = `hsl(${roles.text})`
  const accent = `hsl(${roles.accent})`
  const border = `hsl(${roles.border})`
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative rounded-xl overflow-hidden text-left transition-all border ${
        active
          ? 'border-white/80 ring-2 ring-white/40 shadow-lg shadow-black/20'
          : 'border-border/40 hover:border-border/70'
      }`}
      aria-pressed={active}
    >
      {/* Mini preview */}
      <div className="p-2.5 flex flex-col gap-1.5" style={{ background: bg }}>
        <div className="flex gap-1.5">
          <div className="h-2 w-2 rounded-full" style={{ background: accent }} />
          <div className="h-2 w-2 rounded-full opacity-60" style={{ background: text }} />
          <div className="h-2 w-2 rounded-full opacity-30" style={{ background: text }} />
        </div>
        <div
          className="h-6 rounded-md flex items-center px-1.5 gap-1"
          style={{ background: surface, border: `1px solid ${border}` }}
        >
          <div className="h-1 w-3 rounded-full opacity-80" style={{ background: text }} />
          <div className="h-1 w-5 rounded-full opacity-40" style={{ background: text }} />
        </div>
        <div
          className="h-3 rounded-sm"
          style={{ background: surfaceRaised, border: `1px solid ${border}` }}
        />
      </div>
      {/* Label */}
      <div className="px-2.5 py-2 flex items-center justify-between gap-2 bg-card/60 backdrop-blur border-t border-border/30">
        <span className="text-[11px] font-bold tracking-tight truncate">{theme.name}</span>
        {active && <Check className="h-3 w-3 text-white shrink-0" />}
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Git connections pane — shows which Orchestra projects are linked to GitHub repos
// ---------------------------------------------------------------------------

function GitConnectionsPane({ config }: { config: BackendConfig | null }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!config) return
    setLoading(true)
    setError('')
    try {
      const data = await fetchProjects(config)
      setProjects(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }, [config])

  useEffect(() => { void load() }, [load])

  const linked = projects.filter((p) => p.github_owner && p.github_repo)
  const unlinked = projects.filter((p) => !(p.github_owner && p.github_repo))

  const handleDisconnect = async (projectId: string) => {
    if (!config) return
    setPendingId(projectId)
    setError('')
    try {
      await disconnectProjectGitHub(config, projectId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed')
    } finally {
      setPendingId(null)
    }
  }

  const openOnGitHub = (owner: string, repo: string) => {
    const url = `https://github.com/${owner}/${repo}`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = (window as any).orchestraDesktop
    if (bridge && typeof bridge.openExternal === 'function') {
      void bridge.openExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <GitBranch size={13} className="text-muted-foreground/60" />
          <span className="text-[12px] font-semibold tracking-tight">GitHub project links</span>
        </div>
        <p className="text-[11px] text-muted-foreground/60 mb-4">
          Projects linked to a GitHub repo — connect from the Git tab inside a project.
        </p>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/55">Linked</span>
            <span className="text-[10px] font-medium tabular-nums text-muted-foreground/40">{linked.length}</span>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading || !config}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium tracking-tight text-muted-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] disabled:opacity-40 transition-colors"
          >
            <RefreshCcw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {error && (
          <p className="text-[11.5px] text-destructive mb-3">{error}</p>
        )}

        {linked.length === 0 ? (
          <div className="px-4 py-8 rounded-lg bg-foreground/[0.02] border border-border/30 text-center">
            <Github size={20} className="mx-auto mb-2 text-muted-foreground/40" strokeWidth={1.75} />
            <p className="text-[12px] font-medium text-foreground/70">No GitHub connections</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1">
              Open a project and connect it from the Git → GitHub tab.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border/30 bg-background overflow-hidden">
            {linked.map((project, idx) => (
              <div
                key={project.id}
                className={`group relative flex items-center gap-3 px-3.5 py-2.5 hover:bg-foreground/[0.03] transition-colors ${
                  idx > 0 ? 'border-t border-border/20' : ''
                }`}
              >
                <Github size={14} className="text-muted-foreground/60 shrink-0" strokeWidth={2} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium tracking-tight text-foreground/90 truncate">
                    {project.name}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground/60 truncate">
                    {project.github_owner}/{project.github_repo}
                  </div>
                </div>
                <button
                  onClick={() => openOnGitHub(project.github_owner!, project.github_repo!)}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                >
                  <ExternalLink size={11} />
                  Open
                </button>
                <button
                  onClick={() => void handleDisconnect(project.id)}
                  disabled={pendingId === project.id}
                  className="inline-flex items-center h-7 px-2.5 rounded-md text-[11px] font-medium text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors"
                >
                  {pendingId === project.id ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {unlinked.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/55">Unlinked projects</span>
            <span className="text-[10px] font-medium tabular-nums text-muted-foreground/40">{unlinked.length}</span>
          </div>
          <div className="rounded-lg border border-border/30 bg-background overflow-hidden">
            {unlinked.map((project, idx) => (
              <div
                key={project.id}
                className={`flex items-center gap-3 px-3.5 py-2.5 ${idx > 0 ? 'border-t border-border/20' : ''}`}
              >
                <span className="w-2 h-2 rounded-full bg-muted-foreground/20 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium tracking-tight text-foreground/85 truncate">
                    {project.name}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground/55 truncate">
                    {project.remote_url || project.root_path}
                  </div>
                </div>
                <span className="text-[10.5px] text-muted-foreground/50">Not connected</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground/60 mt-2.5">
            Connect a project to GitHub from the <span className="font-medium text-foreground/80">Git</span> tab inside the project.
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Notifications pane (migrated from SettingsCard)
// ---------------------------------------------------------------------------

function NotificationsPane({
  notifSound,
  notifMuted,
  notifVolume,
  onNotifSoundChange,
  onNotifMutedChange,
  onNotifVolumeChange,
}: {
  notifSound?: string
  notifMuted?: boolean
  notifVolume?: number
  onNotifSoundChange?: (sound: string) => void
  onNotifMutedChange?: (muted: boolean) => void
  onNotifVolumeChange?: (volume: number) => void
}) {
  return (
    <div className="space-y-4">
      <div className="group relative flex items-center justify-between p-4 rounded-xl border border-border/40 bg-gradient-to-b from-card via-card to-muted/20 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-primary/[0.03] via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        <div className="space-y-0.5">
          <p className="text-xs font-black tracking-tight">Mute All Sounds</p>
          <p className="text-[10px] text-muted-foreground">Disable notification sounds when agents complete</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[9px] font-bold uppercase tracking-widest ${!notifMuted ? 'text-foreground' : 'text-muted-foreground/30'}`}>On</span>
          <button
            onClick={() => {
              const next = !notifMuted
              onNotifMutedChange?.(next)
              localStorage.setItem('orchestra_notif_muted', String(next))
            }}
            className={`h-8 w-14 rounded-full transition-colors ${notifMuted ? 'bg-muted' : 'bg-white'} relative`}
          >
            <div className={`absolute top-1 h-6 w-6 rounded-full ${notifMuted ? 'bg-white' : 'bg-black'} shadow transition-transform ${notifMuted ? 'left-7' : 'left-1'}`} />
          </button>
          <span className={`text-[9px] font-bold uppercase tracking-widest ${notifMuted ? 'text-red-400' : 'text-muted-foreground/30'}`}>Mute</span>
        </div>
      </div>

      <div className="group relative p-4 rounded-xl border border-border/40 bg-gradient-to-b from-card via-card to-muted/20 space-y-3 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-primary/[0.03] via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <p className="text-xs font-black tracking-tight">Notification Sound</p>
            <p className="text-[10px] text-muted-foreground">Sound played when an agent completes a task</p>
          </div>
          <button
            onClick={() => {
              try {
                const vol = notifVolume ?? 0.3
                const sound = notifSound ?? 'chime'
                const ctx = new AudioContext()
                const g = ctx.createGain()
                g.connect(ctx.destination)
                g.gain.setValueAtTime(vol, ctx.currentTime)
                g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
                const osc = ctx.createOscillator()
                osc.connect(g)
                if (sound === 'bell') {
                  osc.type = 'sine'
                  osc.frequency.setValueAtTime(1047, ctx.currentTime)
                  osc.frequency.exponentialRampToValueAtTime(523, ctx.currentTime + 0.3)
                } else if (sound === 'pulse') {
                  osc.type = 'square'
                  osc.frequency.setValueAtTime(440, ctx.currentTime)
                  osc.frequency.setValueAtTime(440, ctx.currentTime + 0.05)
                  osc.frequency.setValueAtTime(0, ctx.currentTime + 0.1)
                  osc.frequency.setValueAtTime(440, ctx.currentTime + 0.15)
                } else {
                  osc.frequency.setValueAtTime(880, ctx.currentTime)
                  osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1)
                  osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.2)
                }
                osc.start(ctx.currentTime)
                osc.stop(ctx.currentTime + 0.5)
                osc.onended = () => ctx.close()
              } catch { /* ignore */ }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-white/10 text-foreground border border-white/20 hover:bg-white/20 transition-colors"
          >
            <Play size={10} />
            Test
          </button>
        </div>
        <div className="flex gap-2">
          {[
            { id: 'chime', label: 'Chime' },
            { id: 'bell', label: 'Bell' },
            { id: 'pulse', label: 'Pulse' },
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => {
                onNotifSoundChange?.(s.id)
                localStorage.setItem('orchestra_notif_sound', s.id)
              }}
              className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                notifSound === s.id
                  ? 'bg-white text-black shadow-lg shadow-black/20'
                  : 'bg-muted/30 text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="group relative p-4 rounded-xl border border-border/40 bg-gradient-to-b from-card via-card to-muted/20 space-y-3 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-primary/[0.03] via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <p className="text-xs font-black tracking-tight">Volume</p>
            <p className="text-[10px] text-muted-foreground">{Math.round((notifVolume ?? 0.3) * 100)}%</p>
          </div>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={notifVolume ?? 0.3}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            onNotifVolumeChange?.(v)
            localStorage.setItem('orchestra_notif_volume', String(v))
          }}
          className="w-full accent-primary"
        />
      </div>

      <div className="group relative p-4 rounded-xl border border-border/40 bg-gradient-to-b from-card via-card to-muted/20 space-y-3 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-primary/[0.03] via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        <div className="space-y-0.5">
          <p className="text-xs font-black tracking-tight">Browser Notifications</p>
          <p className="text-[10px] text-muted-foreground">Desktop notification when agents complete tasks</p>
        </div>
        <button
          onClick={() => {
            if ('Notification' in window) {
              void Notification.requestPermission()
            }
          }}
          className="px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-muted/30 text-muted-foreground hover:bg-muted/50 transition-all"
        >
          {'Notification' in window ? `Status: ${Notification.permission}` : 'Not supported'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shortcuts pane (migrated from SettingsCard)
// ---------------------------------------------------------------------------

function ShortcutsPane({ isMac }: { isMac: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[
        { label: 'Command Palette', desc: 'Search and navigate instantly', keys: [isMac ? '⌘' : 'Ctrl', 'K'] },
        { label: 'Refresh Tracker', desc: 'Full state synchronization', keys: [isMac ? '⌘' : 'Ctrl', 'R'] },
        { label: 'Toggle Sidebar', desc: 'Collapse/expand navigation', keys: [isMac ? '⌘' : 'Ctrl', '/'] },
        { label: 'Switch Tab', desc: 'Ctrl+1 Tasks, Ctrl+2 Projects, etc.', keys: [isMac ? '⌘' : 'Ctrl', '1-8'] },
      ].map((s, idx) => (
        <div key={idx} className="group/item relative flex items-center justify-between p-4 rounded-xl border border-border/40 bg-gradient-to-b from-card via-card to-muted/20 shadow-sm transition-all hover:border-primary/20 overflow-hidden">
          <div className="space-y-0.5">
            <p className="text-xs font-black tracking-tight">{s.label}</p>
            <p className="text-[10px] text-muted-foreground leading-tight">{s.desc}</p>
          </div>
          <div className="flex gap-1">
            {s.keys.map(k => (
              <kbd key={k} className="flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-lg bg-muted border border-border/60 text-[9px] font-black font-mono shadow-sm">
                {k}
              </kbd>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// BackendConfigForm (migrated from SettingsCard)
// ---------------------------------------------------------------------------

function BackendConfigForm({
  loadingConfig: _loadingConfig,
  savingConfig,
  profilesPending,
  config,
  backendProfiles,
  activeProfileId,
  onSaveBackendConfig,
  onSetActiveProfile,
  onCreateProfile,
  onDeleteProfile,
  disabled,
}: {
  loadingConfig: boolean
  savingConfig: boolean
  profilesPending: boolean
  config: BackendConfig | null
  backendProfiles: BackendProfile[]
  activeProfileId: string
  onSaveBackendConfig: (nextConfig: BackendConfig) => Promise<void>
  onSetActiveProfile: (profileId: string) => Promise<void>
  onCreateProfile: (name: string) => Promise<void>
  onDeleteProfile: (profileId: string) => Promise<void>
  disabled?: boolean
}) {
  const [baseUrl, setBaseUrl] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [newProfileName, setNewProfileName] = useState('')
  const [showToken, setShowToken] = useState(false)

  const baseUrlTrimmed = baseUrl.trim()
  const baseUrlInvalid = baseUrlTrimmed !== '' && (() => {
    try { new URL(baseUrlTrimmed); return false } catch { return true }
  })()

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBaseUrl(config?.baseUrl ?? '')
    setApiToken(config?.apiToken ?? '')
  }, [config])

  const syncFromConfig = () => {
    setBaseUrl(config?.baseUrl ?? '')
    setApiToken(config?.apiToken ?? '')
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between pb-2 border-b border-border/20">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-black uppercase tracking-wider">Connection Profiles</h3>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-primary" />
            <h4 className="text-[10px] font-black uppercase tracking-widest text-foreground/80">Profile Management</h4>
          </div>

          <div className="space-y-4 p-4 rounded-xl bg-muted/20 border border-border/40">
            <label className="space-y-1.5 block">
              <span className="block text-[9px] font-black uppercase tracking-wider text-muted-foreground px-1">Active Profile</span>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <CustomDropdown
                    className="w-full"
                    value={activeProfileId}
                    options={backendProfiles.map((p) => ({ label: p.name, value: p.id, icon: <ShieldCheck className="h-3 w-3" /> }))}
                    onChange={(val) => void onSetActiveProfile(val)}
                    disabled={disabled || backendProfiles.length === 0}
                  />
                  {profilesPending && (
                    <div className="absolute right-8 top-1/2 -translate-y-1/2">
                      <Loader2 className="h-3 w-3 animate-spin-smooth text-primary" />
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Delete"
                  className="h-9 px-3 rounded-lg border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-all"
                  disabled={disabled || backendProfiles.length <= 1 || activeProfileId === ''}
                  onClick={(e) => {
                    e.preventDefault()
                    if (activeProfileId === '') return
                    const name = backendProfiles.find((p) => p.id === activeProfileId)?.name ?? activeProfileId
                    if (window.confirm(`Delete backend profile "${name}"? This cannot be undone.`)) {
                      void onDeleteProfile(activeProfileId)
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </label>

            <label className="space-y-1.5 block pt-2 border-t border-border/20">
              <span className="block text-[9px] font-black uppercase tracking-wider text-muted-foreground px-1">New Profile</span>
              <div className="flex gap-2">
                <input
                  className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-xs focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm"
                  value={newProfileName}
                  onChange={(event) => setNewProfileName(event.target.value)}
                  placeholder="Production, Staging, Local..."
                  disabled={disabled}
                />
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Create"
                  className="h-9 px-3 rounded-lg bg-white/5 border-white/20 text-foreground hover:bg-white hover:text-black"
                  disabled={disabled || newProfileName.trim() === ''}
                  onClick={() => {
                    void onCreateProfile(newProfileName.trim())
                    setNewProfileName('')
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </label>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <SignalHigh className="h-3.5 w-3.5 text-primary" />
            <h4 className="text-[10px] font-black uppercase tracking-widest text-foreground/80">Connection Parameters</h4>
          </div>

          <div className="space-y-4 p-4 rounded-xl bg-muted/20 border border-border/40">
            <label className="space-y-1.5 block">
              <span className="block text-[9px] font-black uppercase tracking-wider text-muted-foreground px-1">Endpoint URL</span>
              <div className="relative">
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40">
                  <Globe className="h-3 w-3" />
                </div>
                <input
                  className={`h-9 w-full rounded-lg border bg-background pl-8 pr-3 text-xs font-mono focus:ring-2 transition-all shadow-sm ${baseUrlInvalid ? 'border-destructive/60 focus:ring-destructive/20 focus:border-destructive' : 'border-border focus:ring-primary/20 focus:border-primary'}`}
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="http://127.0.0.1:4010"
                  disabled={disabled}
                  aria-invalid={baseUrlInvalid || undefined}
                />
              </div>
              {baseUrlInvalid && (
                <span className="block text-[10px] text-destructive px-1">Must be a valid absolute URL (http:// or https://)</span>
              )}
            </label>

            <label className="space-y-1.5 block">
              <span className="block text-[9px] font-black uppercase tracking-wider text-muted-foreground px-1">Access Token</span>
              <div className="relative group/token">
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 group-focus-within/token:text-primary/60 transition-colors">
                  <ShieldCheck className="h-3 w-3" />
                </div>
                <input
                  type={showToken ? 'text' : 'password'}
                  className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-9 text-xs font-mono focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm"
                  value={apiToken}
                  onChange={(event) => setApiToken(event.target.value)}
                  placeholder="Bearer token (optional)"
                  disabled={disabled}
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-all"
                  title={showToken ? 'Hide token' : 'Reveal token'}
                >
                  {showToken ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
              </div>
            </label>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border/20">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60 hover:text-foreground h-9 px-4"
            onClick={syncFromConfig}
            disabled={disabled}
          >
            <RefreshCcw className="h-3 w-3 mr-2" />
            Revert
          </Button>
          <div className="hidden sm:flex items-center gap-2 text-primary/40 px-3 border-l border-border/20">
            <Info className="h-3 w-3" />
            <span className="text-[9px] font-medium italic">Base URL changes trigger reconnect.</span>
          </div>
        </div>
        <Button
          onClick={() => void onSaveBackendConfig({ baseUrl: baseUrlTrimmed, apiToken: apiToken.trim() })}
          disabled={disabled || baseUrlTrimmed === '' || baseUrlInvalid}
          className="px-6 shadow-lg shadow-black/20 font-black uppercase tracking-widest text-[9px] h-9 rounded-lg"
        >
          {savingConfig ? <Loader2 className="h-3 w-3 animate-spin-smooth" /> : 'Save Backend Config'}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ModelSearchDropdown (migrated from SettingsCard)
// ---------------------------------------------------------------------------

function ModelSearchDropdown({
  models,
  modelId,
  loading,
  error,
  hasKey,
  onSelect,
}: {
  models: { id: string; name: string }[]
  modelId: string
  loading: boolean
  error: string
  hasKey: boolean
  onSelect: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = search
    ? models.filter(m =>
        m.id.toLowerCase().includes(search.toLowerCase()) ||
        m.name.toLowerCase().includes(search.toLowerCase())
      )
    : models

  const selectedModel = models.find(m => m.id === modelId)

  if (error) {
    return (
      <div className="space-y-1">
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Model</label>
        <p className="text-[11px] text-red-500">{error}</p>
      </div>
    )
  }

  if (!hasKey) {
    return (
      <div className="space-y-1">
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Model</label>
        <p className="text-[11px] text-muted-foreground/60">Enter an API key to load models</p>
      </div>
    )
  }

  if (models.length === 0) {
    return (
      <div className="space-y-1">
        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Model
          {loading && <Loader2 className="ml-1.5 inline h-2.5 w-2.5 animate-spin-smooth" />}
        </label>
        <p className="text-[11px] text-muted-foreground/60">Loading models...</p>
      </div>
    )
  }

  return (
    <div className="space-y-1 relative">
      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Model
        {loading && <Loader2 className="ml-1.5 inline h-2.5 w-2.5 animate-spin-smooth" />}
        <span className="ml-2 text-muted-foreground/40 normal-case tracking-normal font-normal">{models.length} available</span>
      </label>

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={open ? search : (selectedModel?.name || modelId || '')}
          onChange={(e) => { setSearch(e.target.value); if (!open) setOpen(true) }}
          onFocus={() => { setOpen(true); setSearch('') }}
          placeholder="Search models..."
          className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none"
        />
        {modelId && !open && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/40">
            {models.length} models
          </span>
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-[240px] overflow-y-auto rounded-lg border border-border/40 bg-card shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-muted-foreground/60">
              No models match &ldquo;{search}&rdquo;
            </div>
          ) : (
            filtered.slice(0, 100).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onSelect(m.id)
                  setSearch('')
                  setOpen(false)
                }}
                className={`w-full px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-muted/50 ${
                  m.id === modelId ? 'bg-primary/10 text-primary font-bold' : 'text-foreground'
                }`}
              >
                <span className="block font-mono truncate">{m.id}</span>
                {m.name !== m.id && (
                  <span className="block text-[10px] text-muted-foreground/60 truncate">{m.name}</span>
                )}
              </button>
            ))
          )}
          {filtered.length > 100 && (
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground/40 border-t border-border/20">
              Showing first 100 of {filtered.length} — type to filter
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setSearch('') }} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmbeddedAgentConfigForm (migrated from SettingsCard)
// ---------------------------------------------------------------------------

function EmbeddedAgentConfigForm({ config, disabled }: { config: BackendConfig | null; disabled: boolean }) {
  const savedPrefs = (() => { try { return JSON.parse(localStorage.getItem('orchestra-agent-provider-prefs') ?? '{}') } catch { return {} } })()
  const [providerId, setProviderId] = useState<string>(savedPrefs.providerId ?? CHAT_PROVIDERS[0].id)
  const [modelId, setModelId] = useState<string>(savedPrefs.modelId ?? '')
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [storedKey, setStoredKey] = useState('')

  useEffect(() => {
    if (!config) return
    fetchAgentProviderKeys(config)
      .then((result) => {
        const prefs = (() => { try { return JSON.parse(localStorage.getItem('orchestra-agent-provider-prefs') ?? '{}') } catch { return {} } })()
        const target = prefs.providerId && result.providers[prefs.providerId]?.configured
          ? prefs.providerId
          : CHAT_PROVIDERS.find(p => result.providers[p.id]?.configured)?.id
        if (target) {
          const info = result.providers[target]
          setProviderId(target)
          setHasKey(true)
          setStoredKey(info?.api_key ?? '')
          if (prefs.modelId) setModelId(prefs.modelId)
        }
      })
      .catch(() => {})
  }, [config])

  useEffect(() => {
    const key = storedKey || apiKey.trim()
    if (!key) {
      setModels([])
      setModelsError('')
      return
    }

    let cancelled = false
    setModelsLoading(true)
    setModelsError('')

    import('@features/embedded-agent/lib/providers')
      .then(({ fetchProviderModels }) => fetchProviderModels(providerId, key))
      .then((fetched) => {
        if (cancelled) return
        setModels(fetched)
        if (fetched.length > 0) {
          setModelId((prev) => {
            if (prev && fetched.find((m: { id: string }) => m.id === prev)) return prev
            const prefs = (() => { try { return JSON.parse(localStorage.getItem('orchestra-agent-provider-prefs') ?? '{}') } catch { return {} } })()
            const match = prefs.modelId && fetched.find((m: { id: string }) => m.id === prefs.modelId)
            return match ? prefs.modelId : fetched[0].id
          })
        }
      })
      .catch((err) => {
        if (cancelled) return
        setModels([])
        setModelsError(err instanceof Error ? err.message : 'Failed to fetch models')
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })

    return () => { cancelled = true }
  }, [providerId, storedKey, apiKey])

  const handleSave = async () => {
    if (!config || !apiKey.trim()) return
    setSaving(true)
    setMessage('')
    try {
      await saveAgentProviderKey(config, providerId, apiKey.trim())
      setHasKey(true)
      setStoredKey(apiKey.trim())
      setApiKey('')
      setMessage('API key saved.')
    } catch (err) {
      setMessage(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    const key = storedKey || apiKey.trim()
    if (!key || !modelId) return
    setTesting(true)
    setMessage('')
    try {
      const { createProvider } = await import('@features/embedded-agent/lib/providers')
      const { generateText } = await import('ai')
      const provider = createProvider(providerId, key)
      await generateText({
        model: provider(modelId),
        prompt: 'Say "ok" and nothing else.',
      })
      setMessage('Connection verified.')
    } catch (err) {
      setMessage(`Test failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/20 bg-muted/10 p-4 space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-bold">Embedded Agent</p>
          <p className="text-[10px] text-muted-foreground">Configure the LLM provider for the chat widget</p>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Provider</label>
          <CustomDropdown
            className="w-full"
            value={providerId}
            options={CHAT_PROVIDERS.map(p => ({ label: p.label, value: p.id }))}
            onChange={(v) => {
              const nextProvider = v as string
              setProviderId(nextProvider)
              setModelId('')
              setModels([])
              setModelsError('')
              try { localStorage.setItem('orchestra-agent-provider-prefs', JSON.stringify({ providerId: nextProvider, modelId: '' })) } catch { /* */ }
              if (config) {
                setStoredKey('')
                setHasKey(false)
                fetchAgentProviderKeys(config)
                  .then((result) => {
                    const info = result.providers[nextProvider]
                    if (info?.configured) {
                      setHasKey(true)
                      setStoredKey(info.api_key ?? '')
                    }
                  })
                  .catch(() => {})
              } else {
                setStoredKey('')
                setHasKey(false)
              }
            }}
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            API Key
            {hasKey && (
              <span className="ml-2 inline-flex items-center gap-1 text-emerald-500">
                <CheckCircle2 className="h-2.5 w-2.5" />
                Configured
              </span>
            )}
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? '••••••••' : (providerId === 'openrouter' ? 'sk-or-...' : providerId === 'claude' ? 'sk-ant-...' : 'sk-...')}
                disabled={disabled || saving}
                className="w-full rounded-lg border border-border/40 bg-background px-3 pr-9 py-2 text-sm font-mono placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-all"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <button
              onClick={handleSave}
              disabled={disabled || saving || !apiKey.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-black hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin-smooth" /> : <Check className="h-3 w-3" />}
              Save
            </button>
          </div>
        </div>

        <ModelSearchDropdown
          models={models}
          modelId={modelId}
          loading={modelsLoading}
          error={modelsError}
          hasKey={hasKey || !!apiKey.trim()}
          onSelect={(id) => {
            setModelId(id)
            try { localStorage.setItem('orchestra-agent-provider-prefs', JSON.stringify({ providerId, modelId: id })) } catch { /* */ }
          }}
        />

        <div className="flex items-center gap-2">
          <button
            onClick={handleTest}
            disabled={disabled || testing || !modelId || (!hasKey && !apiKey.trim())}
            className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-border disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {testing ? <Loader2 className="h-3 w-3 animate-spin-smooth" /> : <ShieldCheck className="h-3 w-3" />}
            Test Connection
          </button>
        </div>

        {message && (
          <p className={`text-[11px] font-medium ${message.includes('failed') || message.includes('Failed') ? 'text-red-500' : 'text-emerald-500'}`}>
            {message}
          </p>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Models are fetched directly from the provider API. API keys stored at <code className="text-[10px] font-mono bg-muted/30 px-1 rounded">~/.orchestra/agent-providers.json</code> (600).
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// UnsandboxConfigForm (migrated from SettingsCard)
// ---------------------------------------------------------------------------

function UnsandboxConfigForm({ config, disabled }: { config: BackendConfig | null; disabled: boolean }) {
  const [publicKey, setPublicKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [status, setStatus] = useState<UnsandboxStatus | null>(null)
  const [unsandboxConfig, setUnsandboxConfig] = useState<UnsandboxConfig | null>(null)
  const [message, setMessage] = useState('')
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!config) return
    fetchUnsandboxConfig(config)
      .then((cfg) => {
        setUnsandboxConfig(cfg)
        if (cfg.public_key) setPublicKey(cfg.public_key)
      })
      .catch(() => {})
  }, [config])

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    setMessage('')
    try {
      const result = await saveUnsandboxConfig(config, publicKey, secretKey)
      setUnsandboxConfig(result)
      setSecretKey('')
      setMessage('Credentials saved.')
    } catch (err) {
      setMessage(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!config) return
    setChecking(true)
    setMessage('')
    try {
      const s = await fetchUnsandboxStatus(config)
      setStatus(s)
      if (s.valid) {
        setMessage('Connection verified.')
      } else if (s.error) {
        setMessage(`Validation failed: ${s.error}`)
      } else if (!s.configured) {
        setMessage('No credentials configured.')
      }
    } catch (err) {
      setMessage(`Test failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setChecking(false)
    }
  }

  const handleRemove = async () => {
    if (!config) return
    setSaving(true)
    setMessage('')
    try {
      await deleteUnsandboxConfig(config)
      setUnsandboxConfig(null)
      setPublicKey('')
      setSecretKey('')
      setStatus(null)
      setMessage('Credentials removed.')
    } catch (err) {
      setMessage(`Remove failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const isConfigured = unsandboxConfig?.configured ?? false

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/20 bg-muted/10 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold">Unsandbox</p>
              <button
                type="button"
                onClick={() => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const bridge = (window as any).orchestraDesktop
                  if (bridge && typeof bridge.openExternal === 'function') {
                    void bridge.openExternal('https://unsandbox.com')
                  } else {
                    window.open('https://unsandbox.com', '_blank')
                  }
                }}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                title="Open unsandbox.com"
              >
                unsandbox.com
                <ExternalLink className="h-2.5 w-2.5" />
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">Remote code execution across 42+ languages</p>
          </div>
          <div className="flex items-center gap-2">
            {isConfigured ? (
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-500">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Configured
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <CircleDashed className="h-3.5 w-3.5" />
                Not configured
              </span>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Public Key</label>
            <input
              type="text"
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              placeholder="pk_..."
              disabled={disabled || saving}
              className="w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none disabled:opacity-50"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Secret Key {isConfigured && <span className="text-muted-foreground/60">(leave blank to keep current)</span>}
            </label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder={isConfigured ? '••••••••' : 'sk_...'}
                disabled={disabled || saving}
                className="w-full rounded-lg border border-border/40 bg-background px-3 pr-9 py-2 text-sm font-mono placeholder:text-muted-foreground/40 focus:border-primary focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-all"
                title={showSecret ? 'Hide key' : 'Reveal key'}
              >
                {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={disabled || saving || !publicKey.trim() || (!secretKey.trim() && !isConfigured)}
            className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-black hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin-smooth" /> : <Check className="h-3 w-3" />}
            Save Keys
          </button>
          <button
            onClick={handleTest}
            disabled={disabled || checking || !isConfigured}
            className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-border disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {checking ? <Loader2 className="h-3 w-3 animate-spin-smooth" /> : <ShieldCheck className="h-3 w-3" />}
            Test Connection
          </button>
          {isConfigured && (
            <button
              onClick={handleRemove}
              disabled={disabled || saving}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-red-500 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              Remove
            </button>
          )}
        </div>

        {message && (
          <p className={`text-[11px] font-medium ${message.includes('failed') || message.includes('Failed') ? 'text-red-500' : 'text-emerald-500'}`}>
            {message}
          </p>
        )}

        {status?.valid && status.key_info && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">API Key Status</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              {status.key_info.tier ? <><span className="text-muted-foreground">Tier</span><span className="font-mono">{String(status.key_info.tier)}</span></> : null}
              {status.key_info.rate_per_minute ? <><span className="text-muted-foreground">Rate</span><span className="font-mono">{String(status.key_info.rate_per_minute)}/min</span></> : null}
              {status.key_info.concurrency ? <><span className="text-muted-foreground">Concurrency</span><span className="font-mono">{String(status.key_info.concurrency)}</span></> : null}
            </div>
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Credentials are stored at <code className="text-[10px] font-mono bg-muted/30 px-1 rounded">~/.unsandbox/accounts.csv</code> with restricted permissions (600).
        You can also set <code className="text-[10px] font-mono bg-muted/30 px-1 rounded">UNSANDBOX_PUBLIC_KEY</code> and <code className="text-[10px] font-mono bg-muted/30 px-1 rounded">UNSANDBOX_SECRET_KEY</code> environment variables.{' '}
        <button
          type="button"
          onClick={() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const bridge = (window as any).orchestraDesktop
            if (bridge && typeof bridge.openExternal === 'function') {
              void bridge.openExternal('https://unsandbox.com/docs')
            } else {
              window.open('https://unsandbox.com/docs', '_blank')
            }
          }}
          className="inline-flex items-center gap-0.5 text-primary hover:underline"
        >
          API docs <ExternalLink className="h-2.5 w-2.5" />
        </button>
      </p>
    </div>
  )
}

