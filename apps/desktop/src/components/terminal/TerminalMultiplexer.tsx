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
    theme?: 'light' | 'dark'
}

export const TerminalMultiplexer: React.FC<TerminalMultiplexerProps> = ({ 
    activeTerminals, 
    baseUrl,
    onCloseTerminal,
    theme
}) => {
    const [currentNode, setCurrentNode] = useState<MosaicNode<string> | null>(null)

    // Automatically update the mosaic layout when terminals change
    useEffect(() => {
        if (activeTerminals.length === 0) {
            setCurrentNode(null)
            return
        }

        const ids = activeTerminals.map(t => t.id)
        
        // Recursive function to build a balanced tree
        const buildBalancedTree = (nodeIds: string[], direction: 'row' | 'column' = 'row'): MosaicNode<string> => {
            if (nodeIds.length === 1) return nodeIds[0]
            
            const half = Math.ceil(nodeIds.length / 2)
            const firstHalf = nodeIds.slice(0, half)
            const secondHalf = nodeIds.slice(half)
            
            return {
                direction,
                first: buildBalancedTree(firstHalf, direction === 'row' ? 'column' : 'row'),
                second: buildBalancedTree(secondHalf, direction === 'row' ? 'column' : 'row')
            }
        }

        // Check if current IDs match activeTerminals IDs
        const currentIds = currentNode ? getIdsFromNode(currentNode).sort().join(',') : ''
        const activeIds = ids.slice().sort().join(',')

        if (currentIds !== activeIds) {
            setCurrentNode(buildBalancedTree(ids))
        }
    }, [activeTerminals])

    const getIdsFromNode = (node: MosaicNode<string>): string[] => {
        if (typeof node === 'string') return [node]
        return [...getIdsFromNode(node.first), ...getIdsFromNode(node.second)]
    }

    return (
        <div className="w-full h-full bg-background overflow-hidden terminal-multiplexer">
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
                                            className="p-1 hover:bg-destructive/20 text-muted-foreground/60 hover:text-destructive transition-colors rounded"
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
                                    theme={theme}
                                />
                            </MosaicWindow>
                        )
                    }}
                    value={currentNode}
                    onChange={setCurrentNode}
                    className="flex-1"
                />
            ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/20 space-y-6">
                    <div className="relative">
                        <TerminalIcon size={80} className="animate-pulse" strokeWidth={1} />
                        <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full" />
                    </div>
                    <div className="text-center space-y-2 relative z-10">
                        <p className="text-sm font-black uppercase tracking-[0.3em]">No Active Runtime Contexts</p>
                        <p className="text-[10px] font-medium uppercase tracking-widest opacity-60">Deploy an agent or open a project shell to begin</p>
                    </div>
                </div>
            )}
        </div>
    )
}
