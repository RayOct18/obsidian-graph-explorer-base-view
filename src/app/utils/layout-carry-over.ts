import type { GraphData, GraphNode } from '../types/graph-types'

/** Distance from its neighbor at which a newly added node starts */
const SEED_RADIUS = 40

/**
 * Keeps the layout stable across rebuilds. buildGraphData creates fresh node
 * objects every time, which force-graph would otherwise lay out from scratch.
 *
 * - A node already on screen (same id in `previous`) keeps its x/y/vx/vy.
 * - A new node starts on a small circle around the first neighbor that has a
 *   position, so revealed notes grow out of the note they are linked to.
 * Nodes that already have a position (e.g. a saved, pinned one) are untouched.
 */
export function carryOverPositions(data: GraphData, previous: Map<string, GraphNode>): void {
    const positioned = new Map<string, GraphNode>()
    for (const node of data.nodes) {
        if (node.x === undefined || node.y === undefined) {
            const old = previous.get(node.id)
            if (old?.x !== undefined && old.y !== undefined) {
                node.x = old.x
                node.y = old.y
                node.vx = old.vx
                node.vy = old.vy
            }
        }
        if (node.x !== undefined && node.y !== undefined) positioned.set(node.id, node)
    }

    const unplaced = data.nodes.filter((n) => n.x === undefined || n.y === undefined)
    if (unplaced.length === 0) return

    const neighbors = new Map<string, string[]>()
    for (const link of data.links) {
        const source = endId(link.source)
        const target = endId(link.target)
        neighbors.set(source, [...(neighbors.get(source) ?? []), target])
        neighbors.set(target, [...(neighbors.get(target) ?? []), source])
    }

    const seededAround = new Map<string, number>()
    for (const node of unplaced) {
        const anchorId = (neighbors.get(node.id) ?? []).find((id) => positioned.has(id))
        const anchor = anchorId ? positioned.get(anchorId) : undefined
        if (!anchor || anchor.x === undefined || anchor.y === undefined) continue
        const index = seededAround.get(anchor.id) ?? 0
        seededAround.set(anchor.id, index + 1)
        // Golden-angle spacing keeps siblings from stacking on one spot
        const angle = index * 2.399963
        node.x = anchor.x + SEED_RADIUS * Math.cos(angle)
        node.y = anchor.y + SEED_RADIUS * Math.sin(angle)
        positioned.set(node.id, node)
    }
}

/** force-graph replaces link ends with node objects after the first render */
function endId(end: unknown): string {
    if (typeof end === 'object' && end !== null && 'id' in end) {
        return String((end as { id: unknown }).id)
    }
    return String(end)
}
