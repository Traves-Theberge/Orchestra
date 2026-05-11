import { Settings2, FileText, Zap, Plug, Scale, Sparkles, Bot, ScrollText, TerminalSquare, Shield, Cpu, FolderTree, LayoutDashboard } from 'lucide-react'
import type { Provider, CategoryDef } from './types'

export const PROVIDERS: { id: Provider; label: string; description: string }[] = [
  { id: 'claude', label: 'Claude', description: "Anthropic's Claude Code — deep reasoning and careful analysis" },
  { id: 'codex', label: 'Codex', description: "OpenAI's Codex — fast iteration and broad knowledge" },
  { id: 'gemini', label: 'Gemini', description: "Google's Gemini CLI — multimodal and context-aware" },
  { id: 'opencode', label: 'OpenCode', description: 'Community-driven — flexible and extensible' },
  { id: '8gent', label: '8gent', description: 'Open-source autonomous coding agent — local-first, self-evolving' },
]

export const CLAUDE_CATEGORIES: CategoryDef[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, pinned: true },
  { id: 'settings', label: 'Settings', icon: Settings2, pinned: true },
  { id: 'instructions', label: 'Instructions', icon: FileText, pinned: true },
  { id: 'agents', label: 'Sub-agents', icon: Bot },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'hooks', label: 'Hooks', icon: Zap },
  { id: 'mcp', label: 'MCP Servers', icon: Plug },
  { id: 'rules', label: 'Rules', icon: Scale },
]

export const CODEX_CATEGORIES: CategoryDef[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, pinned: true },
  { id: 'config', label: 'Config', icon: Settings2, pinned: true },
  { id: 'approvals', label: 'Approvals & Sandbox', icon: Shield, pinned: true },
  { id: 'models', label: 'Models & Providers', icon: Cpu, pinned: true },
  { id: 'environment', label: 'Environment', icon: TerminalSquare },
  { id: 'profiles', label: 'Profiles', icon: FolderTree },
  { id: 'instructions', label: 'Instructions', icon: ScrollText, pinned: true },
  { id: 'agents', label: 'Sub-agents', icon: Bot },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'hooks', label: 'Hooks', icon: Zap },
  { id: 'mcp', label: 'MCP Servers', icon: Plug },
  { id: 'rules', label: 'Rules', icon: Scale },
]

export const GEMINI_CATEGORIES: CategoryDef[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, pinned: true },
  { id: 'settings', label: 'Settings', icon: Settings2, pinned: true },
  { id: 'models', label: 'Models', icon: Cpu, pinned: true },
  { id: 'permissions', label: 'Permissions', icon: Shield, pinned: true },
  { id: 'context', label: 'Context', icon: ScrollText, pinned: true },
  { id: 'commands', label: 'Commands', icon: TerminalSquare },
  { id: 'mcp', label: 'MCP Servers', icon: Plug },
]

export const OPENCODE_CATEGORIES: CategoryDef[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, pinned: true },
  { id: 'config', label: 'Config', icon: Settings2, pinned: true },
  { id: 'models', label: 'Models', icon: Cpu, pinned: true },
  { id: 'instructions', label: 'Instructions', icon: FileText, pinned: true },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'commands', label: 'Commands', icon: TerminalSquare },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'mcp', label: 'MCP Servers', icon: Plug },
  { id: 'permissions', label: 'Permissions', icon: Shield },
]

export const EIGHTGENT_CATEGORIES: CategoryDef[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, pinned: true },
  { id: 'settings', label: 'Settings', icon: Settings2, pinned: true },
  { id: 'instructions', label: 'Instructions', icon: FileText, pinned: true },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'hooks', label: 'Hooks', icon: Zap },
  { id: 'mcp', label: 'MCP Servers', icon: Plug },
]

export const MODELS_BY_PROVIDER: Record<Provider, { value: string; label: string }[]> = {
  claude: [
    { value: 'sonnet', label: 'Sonnet (latest)' },
    { value: 'opus', label: 'Opus (latest)' },
    { value: 'haiku', label: 'Haiku (latest)' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { value: 'claude-opus-4-6[1m]', label: 'Claude Opus 4.6 (1M context)' },
    { value: 'claude-sonnet-4-5-20250514', label: 'Claude Sonnet 4.5' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  codex: [
    { value: 'gpt-5.3-codex', label: 'GPT 5.3 Codex' },
    { value: 'gpt-5.3-codex-spark', label: 'GPT 5.3 Codex Spark' },
    { value: 'gpt-5.2-codex', label: 'GPT 5.2 Codex' },
    { value: 'gpt-5.1-codex', label: 'GPT 5.1 Codex' },
    { value: 'gpt-5.1-codex-max', label: 'GPT 5.1 Codex Max' },
    { value: 'gpt-5.1-codex-mini', label: 'GPT 5.1 Codex Mini' },
    { value: 'gpt-5-codex', label: 'GPT 5 Codex' },
    { value: 'gpt-5.4', label: 'GPT 5.4' },
    { value: 'gpt-5.2', label: 'GPT 5.2' },
    { value: 'codex-mini-latest', label: 'Codex Mini (latest)' },
    { value: 'o3', label: 'o3' },
  ],
  gemini: [
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  ],
  opencode: [
    { value: 'openai/gpt-5.3-codex', label: 'OpenAI GPT 5.3 Codex' },
    { value: 'openai/gpt-5.3-codex-spark', label: 'OpenAI GPT 5.3 Codex Spark' },
    { value: 'openai/gpt-5.2-codex', label: 'OpenAI GPT 5.2 Codex' },
    { value: 'openai/gpt-5.1-codex', label: 'OpenAI GPT 5.1 Codex' },
    { value: 'openai/gpt-5.1-codex-max', label: 'OpenAI GPT 5.1 Codex Max' },
    { value: 'openai/gpt-5.4', label: 'OpenAI GPT 5.4' },
    { value: 'openai/gpt-5.2', label: 'OpenAI GPT 5.2' },
    { value: 'openai/codex-mini-latest', label: 'OpenAI Codex Mini' },
    { value: 'opencode/big-pickle', label: 'Big Pickle' },
    { value: 'opencode/gpt-5-nano', label: 'GPT 5 Nano' },
    { value: 'opencode/mimo-v2-flash-free', label: 'Mimo V2 Flash (free)' },
    { value: 'opencode/minimax-m2.5-free', label: 'Minimax M2.5 (free)' },
    { value: 'opencode/nemotron-3-super-free', label: 'Nemotron 3 Super (free)' },
  ],
  '8gent': [
    { value: 'qwen3.5', label: 'Qwen 3.5 (local, default)' },
    { value: 'meta-llama/llama-4-scout:free', label: 'Llama 4 Scout (free, cloud)' },
    { value: 'meta-llama/llama-4-maverick:free', label: 'Llama 4 Maverick (free, cloud)' },
    { value: 'mistralai/mistral-small-3.1-24b-instruct:free', label: 'Mistral Small 3.1 (free, cloud)' },
    { value: 'google/gemini-2.0-flash-exp:free', label: 'Gemini 2.0 Flash (free, cloud)' },
  ],
}

export const HOOK_EVENTS_BY_PROVIDER: Record<Provider, string[]> = {
  claude: ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SubagentStop', 'PreCompact'],
  codex: [],
  gemini: ['SessionStart', 'SessionEnd', 'BeforeAgent', 'AfterAgent', 'BeforeModel', 'AfterModel', 'BeforeToolSelection'],
  opencode: [],
  '8gent': ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'],
}

export const EFFORT_LEVELS: Record<Provider, string[]> = {
  claude: ['low', 'medium', 'high'],
  codex: ['low', 'medium', 'high', 'very-high', 'max', 'reasoning'],
  gemini: ['low', 'medium', 'high'],
  opencode: ['low', 'medium', 'high'],
  '8gent': ['low', 'medium', 'high'],
}

export const APPROVAL_MODES: Record<Provider, { label: string; value: string }[]> = {
  claude: [
    { label: 'Default (interactive)', value: 'default' },
    { label: 'Accept Edits', value: 'acceptEdits' },
    { label: 'Bypass Permissions', value: 'bypassPermissions' },
    { label: 'Plan', value: 'plan' },
    { label: 'Auto', value: 'auto' },
  ],
  codex: [
    { label: 'Interactive', value: 'interactive' },
    { label: 'Auto-edit', value: 'auto-edit' },
    { label: 'Full-auto', value: 'full-auto' },
    { label: 'On-request', value: 'on-request' },
  ],
  gemini: [
    { label: 'Interactive', value: 'interactive' },
    { label: 'Auto-edit', value: 'auto-edit' },
    { label: 'Full-auto', value: 'full-auto' },
    { label: 'On-request', value: 'on-request' },
  ],
  opencode: [
    { label: 'Interactive', value: 'interactive' },
    { label: 'Auto-edit', value: 'auto-edit' },
    { label: 'Full-auto', value: 'full-auto' },
    { label: 'On-request', value: 'on-request' },
  ],
  '8gent': [
    { label: 'Default (interactive)', value: 'default' },
    { label: 'Accept Edits', value: 'acceptEdits' },
    { label: 'Infinite (no approval)', value: 'infinite' },
    { label: 'Plan only', value: 'plan' },
  ],
}
