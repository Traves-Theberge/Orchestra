import { forwardRef, useEffect, useRef, useState, type MutableRefObject, type ReactElement, type ReactNode, type Ref } from 'react'
import { AlertCircle, Bot, ChevronDown, CircleDashed, Folder, FolderTree, MoreHorizontal, Server, SignalHigh, SignalLow, SignalMedium, User } from 'lucide-react'
import type { RuntimeEntry } from '@core/api/client'

export function getAgentIcon(name: string, size = 12): ReactNode {
  const lower = name.toLowerCase()
  const imgClass = `rounded-sm object-contain`
  if (lower.includes('claude')) return <img src="/Anthropic_Symbol_1.png" width={size} height={size} alt="Claude" className={`${imgClass} dark:invert`} />
  if (lower.includes('codex')) return <img src="/OpenAI_Symbol_1.png" width={size} height={size} alt="Codex" className={`${imgClass} dark:invert`} />
  if (lower.includes('gemini')) return <img src="/Google_Symbol_1.png" width={size} height={size} alt="Gemini" className={imgClass} />
  if (lower.includes('opencode')) return <img src="/opencode.png" width={size} height={size} alt="OpenCode" className={imgClass} />
  if (lower.includes('8gent')) return <img src="/8gent.png" width={size} height={size} alt="8gent" className={imgClass} />
  return <Bot size={size} className="text-primary/60" />
}

type DropdownValue = string | number

type CustomDropdownProps<T extends DropdownValue> = {
  value: T
  options: { label: string; value: T; icon?: ReactNode }[]
  onChange: (value: T) => void
  className?: string
  disabled?: boolean
  placeholder?: string
  triggerContent?: ReactNode
  direction?: 'up' | 'down'
}

type CustomDropdownComponent = <T extends DropdownValue>(props: CustomDropdownProps<T> & { ref?: Ref<HTMLDivElement> }) => ReactElement

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    refs.forEach((ref) => {
      if (!ref) return
      if (typeof ref === 'function') {
        ref(node)
      } else {
        ;(ref as MutableRefObject<T | null>).current = node
      }
    })
  }
}

function CustomDropdownImpl<T extends DropdownValue>(
  {
    value,
    options,
    onChange,
    className = '',
    disabled = false,
    placeholder = 'Select...',
    triggerContent,
    direction = 'down',
  }: CustomDropdownProps<T>,
  ref: Ref<HTMLDivElement>,
) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedOption = options.find((opt) => opt.value === value)

  return (
    <div className={`relative ${className}`} ref={mergeRefs(dropdownRef, ref)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={triggerContent
          ? 'flex items-center w-full h-full'
          : `flex w-auto min-w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium transition-all hover:border-primary/40 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 ${isOpen ? 'border-primary ring-2 ring-primary/20' : ''}`}
      >
        {triggerContent || (
          <>
            <div className="flex items-center gap-2 whitespace-nowrap">
              {selectedOption?.icon}
              <span className="whitespace-nowrap">{selectedOption?.label || placeholder}</span>
            </div>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {isOpen && (
        <div className={`absolute left-0 z-[100] w-max min-w-full overflow-hidden rounded-xl border border-border bg-card p-1 shadow-2xl animate-in fade-in zoom-in-95 duration-100 ${direction === 'up' ? 'bottom-full mb-1 origin-bottom' : 'top-full mt-1 origin-top'}`}>
          <div className="max-h-[300px] overflow-auto">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value)
                  setIsOpen(false)
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${option.value === value ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50'}`}
              >
                {option.icon}
                <span className="flex-1 whitespace-nowrap">{option.label}</span>
                {option.value === value && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export const CustomDropdown = forwardRef(CustomDropdownImpl) as CustomDropdownComponent

export function AgentSelector({ value, agents, onChange, direction = 'up' }: { value: string; agents: string[]; onChange: (a: string) => void; direction?: 'up' | 'down' }) {
  const normalizedValue = value.startsWith('agent-') ? value.replace('agent-', '') : value

  return (
    <CustomDropdown
      className="bg-transparent border-none hover:bg-muted/20 !h-10 !px-3 rounded-lg transition-colors shadow-none"
      value={normalizedValue || 'Unassigned'}
      direction={direction}
      options={agents.map((a) => ({ label: a, value: a, icon: getAgentIcon(a) }))}
      onChange={(v) => onChange(`agent-${v}`)}
      triggerContent={
        <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground/70 uppercase">
          {normalizedValue && normalizedValue !== 'Unassigned' ? getAgentIcon(normalizedValue) : <User size={14} className="opacity-40" />}
          <span className="truncate max-w-[100px]">{normalizedValue || 'Assignee'}</span>
        </div>
      }
    />
  )
}

export function RuntimeSelector({
  value,
  runtimes,
  onChange,
  direction = 'up',
}: {
  value: string
  runtimes: RuntimeEntry[]
  onChange: (target: string) => void
  direction?: 'up' | 'down'
}) {
  const configured = runtimes.filter((r) => r.configured)
  const current = configured.find((r) => r.target === value) ?? configured[0]

  return (
    <CustomDropdown
      className="bg-transparent border-none hover:bg-muted/20 !h-10 !px-3 rounded-lg transition-colors shadow-none"
      value={current?.target ?? 'LOCAL'}
      direction={direction}
      options={configured.map((r) => ({
        label: r.target === 'LOCAL' ? 'Local' : r.target.charAt(0) + r.target.slice(1).toLowerCase(),
        value: r.target,
        icon: <Server className="h-3.5 w-3.5 opacity-60" />,
      }))}
      onChange={onChange}
      triggerContent={
        <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground/70 uppercase">
          <Server size={14} className="opacity-40" />
          <span className="truncate max-w-[100px]">{current?.target === 'LOCAL' ? 'Local' : (current?.target ?? 'Local')}</span>
        </div>
      }
    />
  )
}

export function PriorityIcon({ priority, className }: { priority: number; className?: string }) {
  switch (priority) {
    case 1:
      return <SignalLow className={`text-muted-foreground/60 ${className}`} />
    case 2:
      return <SignalMedium className={`text-amber-500/60 ${className}`} />
    case 3:
      return <SignalHigh className={`text-orange-500/80 ${className}`} />
    case 4:
      return <AlertCircle className={`text-red-500 ${className}`} />
    default:
      return <MoreHorizontal className={`text-muted-foreground/40 ${className}`} />
  }
}

export function PriorityLabel({ priority }: { priority: number }) {
  const labels = ['No Priority', 'Low', 'Medium', 'High', 'Urgent']
  return <span>{labels[priority] || 'No Priority'}</span>
}

export function ProjectSelector({
  value,
  projects,
  onChange,
  direction = 'up',
}: {
  value: string
  projects: { id: string; name: string }[]
  onChange: (id: string) => void
  direction?: 'up' | 'down'
}) {
  const project = projects.find((p) => p.id === value)

  return (
    <CustomDropdown
      className="bg-transparent border-none hover:bg-muted/20 !h-10 !px-3 rounded-lg transition-colors shadow-none"
      value={value}
      direction={direction}
      options={[
        { label: 'Select Project', value: '', icon: <FolderTree className="h-3.5 w-3.5 opacity-40" /> },
        ...projects.map((p) => ({ label: p.name, value: p.id, icon: <Folder className="h-3.5 w-3.5 text-primary/60" /> })),
      ]}
      onChange={onChange}
      triggerContent={
        <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground/70 uppercase">
          {project ? <Folder size={14} className="text-primary/60" /> : <FolderTree size={14} className="opacity-40" />}
          <span className="truncate max-w-[100px]">{project ? project.name : 'Project'}</span>
        </div>
      }
    />
  )
}

export function PrioritySelector({ value, onChange }: { value: number; onChange: (p: number) => void }) {
  const priorities = [
    { label: 'No Priority', value: 0, icon: <CircleDashed size={12} className="opacity-40" /> },
    { label: 'Low', value: 1, icon: <SignalLow size={12} className="text-blue-500/60" /> },
    { label: 'Medium', value: 2, icon: <SignalMedium size={12} className="text-amber-500/60" /> },
    { label: 'High', value: 3, icon: <SignalHigh size={12} className="text-red-500/60" /> },
  ]
  const current = priorities.find((p) => p.value === value) || priorities[0]

  return (
    <CustomDropdown
      className="bg-transparent border-none hover:bg-muted/20 !h-7 !px-2 rounded-md transition-colors shadow-none"
      value={value.toString()}
      direction="up"
      options={priorities.map((p) => ({ label: p.label, value: p.value.toString(), icon: p.icon }))}
      onChange={(v) => onChange(Number.parseInt(v, 10))}
      triggerContent={
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground/70 uppercase">
          {current.icon}
          <span>{value > 0 ? current.label : 'Priority'}</span>
        </div>
      }
    />
  )
}
