import { createContext } from 'react'

/** Where a lone tab group renders its tab strip: the workspace tool toolbar. */
export const ToolbarTabSlotContext = createContext<HTMLElement | null>(null)
