import { createContext } from 'react'

/** Where a lone tab group renders its tab strip: the workspace tool toolbar. */
export const ToolbarTabSlotContext = createContext<HTMLElement | null>(null)

/** Opens the workspace file sidebar owned by the tool surface. */
export const OpenFileSidebarContext = createContext<(() => void) | null>(null)
