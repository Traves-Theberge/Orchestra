import React, { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { Activity } from 'lucide-react'

interface Node extends d3.SimulationNodeDatum {
    id: string
    group: string
    label: string
}

interface Link extends d3.SimulationLinkDatum<Node> {
    source: string
    target: string
    value: number
}

const data: { nodes: Node[], links: Link[] } = {
    nodes: [
        { id: 'backend', group: 'core', label: 'Go Backend' },
        { id: 'orchestrator', group: 'core', label: 'Orchestrator' },
        { id: 'api', group: 'core', label: 'REST API' },
        { id: 'sse', group: 'core', label: 'SSE Stream' },
        { id: 'db', group: 'core', label: 'SQLite Warehouse' },
        
        { id: 'desktop', group: 'ui', label: 'Electron Desktop' },
        { id: 'react', group: 'ui', label: 'React Renderer' },
        { id: 'store', group: 'ui', label: 'Zustand Store' },
        
        { id: 'claude', group: 'agent', label: 'Claude Code' },
        { id: 'gemini', group: 'agent', label: 'Gemini CLI' },
        { id: 'codex', group: 'agent', label: 'Codex Server' },
        { id: 'opencode', group: 'agent', label: 'OpenCode' },
    ],
    links: [
        { source: 'backend', target: 'orchestrator', value: 5 },
        { source: 'backend', target: 'api', value: 5 },
        { source: 'backend', target: 'sse', value: 5 },
        { source: 'orchestrator', target: 'db', value: 3 },
        
        { source: 'desktop', target: 'api', value: 2 },
        { source: 'desktop', target: 'sse', value: 2 },
        { source: 'desktop', target: 'react', value: 5 },
        { source: 'react', target: 'store', value: 3 },
        
        { source: 'orchestrator', target: 'claude', value: 1 },
        { source: 'orchestrator', target: 'gemini', value: 1 },
        { source: 'orchestrator', target: 'codex', value: 1 },
        { source: 'orchestrator', target: 'opencode', value: 1 },
    ]
}

export const D3ArchitectureGraph: React.FC = () => {
    const svgRef = useRef<SVGSVGElement>(null)

    useEffect(() => {
        if (!svgRef.current) return

        const width = 800
        const height = 500

        const svg = d3.select(svgRef.current)
            .attr('viewBox', `0 0 ${width} ${height}`)
            .style('width', '100%')
            .style('height', 'auto')

        svg.selectAll('*').remove()

        // Create copies of data to avoid mutation issues with D3
        const nodes = data.nodes.map(d => ({ ...d }))
        const links = data.links.map(d => ({ ...d }))

        const simulation = d3.forceSimulation<Node>(nodes)
            .force('link', d3.forceLink<Node, Link>(links).id(d => d.id).distance(120))
            .force('charge', d3.forceManyBody().strength(-400))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('x', d3.forceX(width / 2).strength(0.1))
            .force('y', d3.forceY(height / 2).strength(0.1))

        const link = svg.append('g')
            .attr('stroke', '#444')
            .attr('stroke-opacity', 0.4)
            .selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke-width', d => Math.sqrt(d.value) * 2)

        const node = svg.append('g')
            .selectAll<SVGGElement, Node>('g')
            .data(nodes)
            .join('g')
            .call(drag(simulation) as any)

        node.append('circle')
            .attr('r', 10)
            .attr('fill', d => {
                if (d.group === 'core') return '#10b981'
                if (d.group === 'ui') return '#3b82f6'
                return '#f59e0b'
            })
            .attr('stroke', '#18181b')
            .attr('stroke-width', 2)

        node.append('text')
            .attr('x', 14)
            .attr('y', 4)
            .text(d => d.label)
            .style('font-size', '13px')
            .style('font-weight', '600')
            .style('fill', '#e4e4e7')
            .style('paint-order', 'stroke')
            .style('stroke', '#18181b')
            .style('stroke-width', '3px')
            .style('stroke-linecap', 'round')
            .style('stroke-linejoin', 'round')

        const radius = 10;
        simulation.on('tick', () => {
            link
                .attr('x1', d => Math.max(radius, Math.min(width - radius, (d.source as any).x)))
                .attr('y1', d => Math.max(radius, Math.min(height - radius, (d.source as any).y)))
                .attr('x2', d => Math.max(radius, Math.min(width - radius, (d.target as any).x)))
                .attr('y2', d => Math.max(radius, Math.min(height - radius, (d.target as any).y)))

            node
                .attr('transform', d => `translate(${Math.max(radius, Math.min(width - radius, d.x))},${Math.max(radius, Math.min(height - radius, d.y))})`)
        })

        function drag(sim: d3.Simulation<Node, undefined>) {
            function dragstarted(event: any) {
                if (!event.active) sim.alphaTarget(0.3).restart()
                event.subject.fx = event.subject.x
                event.subject.fy = event.subject.y
            }

            function dragged(event: any) {
                event.subject.fx = event.x
                event.subject.fy = event.y
            }

            function dragended(event: any) {
                if (!event.active) sim.alphaTarget(0)
                event.subject.fx = null
                event.subject.fy = null
            }

            return d3.drag<SVGGElement, Node>()
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended)
        }

        return () => {
            simulation.stop()
        }
    }, [])

    return (
        <div className="my-10 rounded-3xl border border-white/5 bg-black/40 p-8 shadow-2xl overflow-hidden backdrop-blur-md">
            <div className="mb-6 flex items-center justify-between border-b border-white/5 pb-4">
                <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-primary/10 p-2 text-primary">
                        <Activity className="h-5 w-5" />
                    </div>
                    <div>
                        <span className="block text-xs font-black uppercase tracking-widest text-foreground/90">System Relations</span>
                        <span className="block text-[10px] text-muted-foreground">Interactive Force-Directed Graph</span>
                    </div>
                </div>
                <div className="flex gap-6 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    <span className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-[#10b981]" /> Core</span>
                    <span className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-[#3b82f6]" /> UI</span>
                    <span className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-[#f59e0b]" /> Agents</span>
                </div>
            </div>
            <div className="relative rounded-2xl bg-black/20 border border-white/5">
                <svg ref={svgRef} className="cursor-grab active:cursor-grabbing w-full h-full min-h-[500px]" />
            </div>
        </div>
    )
}
