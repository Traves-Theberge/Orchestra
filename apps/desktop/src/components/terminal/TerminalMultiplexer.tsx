import React, { useState, useEffect } from 'react'
import { Mosaic, MosaicWindow, MosaicNode, MosaicParent } from 'react-mosaic-component'
import { TerminalView } from './TerminalView'
import { Maximize2, Minimize2, X, Terminal as TerminalIcon } from 'lucide-react'

import 'react-mosaic-component/react-mosaic-component.css'
import './multiplexer.css'

export type TerminalNode = {
    id: string
    title: string
    projectId?: string
}

interface TerminalMultiplexerProps {
    activeTerminals: TerminalNode[]
    baseUrl: string
    onCloseTerminal: (id: string) => void
}

export const TerminalMultiplexer: React.FC<TerminalMultiplexerProps> = ({ 
    activeTerminals, 
    baseUrl,
    onCloseTerminal 
}) => {
    const [currentNode, setCurrentNode] = useState<MosaicNode<string> | null>(null)

    // Automatically update the mosaic layout when terminals change
    useEffect(() => {
        if (activeTerminals.length === 0) {
            setCurrentNode(null)
            return
        }

        // Simplistic tiling: just add the new terminal as a sibling
        const buildInitialTree = (ids: string[]): MosaicNode<string> => {
            if (ids.length === 1) return ids[0]
            
            const half = Math.floor(ids.length / 2)
            return {
                direction: ids.length % 2 === 0 ? 'row' : 'column',
                first: buildInitialTree(ids.slice(0, half)),
                second: buildInitialTree(ids.slice(half))
            }
        }

        // Only rebuild if we don't have a layout or IDs changed significantly
        // For a true "tmux" experience, we'd preserve the user's manual resizing
        if (!currentNode) {
            setCurrentNode(buildInitialTree(activeTerminals.map(t => t.id)))
        } else {
            // Check if we need to add a missing node
            const currentIds = getIdsFromNode(currentNode)
            const missing = activeTerminals.filter(t => !currentIds.includes(t.id))
            if (missing.length > 0) {
                let newNode = currentNode
                missing.forEach(m => {
                    newNode = {
                        direction: 'row',
                        first: newNode,
                        second: m.id
                    }
                })
                setCurrentNode(newNode)
            }
        }
    }, [activeTerminals])

    const getIdsFromNode = (node: MosaicNode<string>): string[] => {
        if (typeof node === 'string') return [node]
        return [...getIdsFromNode(node.first), ...getIdsFromNode(node.second)]
    }

    return (
        <div className="w-full h-full bg-[#0c0c0e] overflow-hidden terminal-multiplexer">
            {activeTerminals.length > 0 ? (
                <Mosaic<string>
                    renderTile={(id, path) => {
                        const term = activeTerminals.find(t => t.id === id)
                        return (
                            <MosaicWindow<string>
                                path={path}
                                title={term?.title || id}
                                toolbarControls={
                                    <div className="flex items-center gap-1">
                                        <button 
                                            onClick={() => onCloseTerminal(id)}
                                            className="p-1 hover:bg-red-500/20 text-zinc-500 hover:text-red-500 transition-colors rounded"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                }
                            >
                                <TerminalView 
                                    sessionId={id} 
                                    projectId={term?.projectId} 
                                    baseUrl={baseUrl} 
                                />
                            </MosaicWindow>
                        )
                    }}
                    value={currentNode}
                    onChange={setCurrentNode}
                    className="mosaic-blueprint-theme"
                />
            ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600 space-y-4">
                    <TerminalIcon size={48} className="opacity-20" />
                    <p className="text-sm font-bold uppercase tracking-[0.2em] opacity-40">No active terminal sessions</p>
                </div>
            )}
        </div>
    )
}
