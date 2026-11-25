import { describe, test, expect } from 'bun:test'
import { carryOverPositions } from './layout-carry-over'
import type { GraphData, GraphNode } from '../types/graph-types'

function node(id: string, pos?: { x: number; y: number }): GraphNode {
    return {
        id,
        name: id,
        explored: false,
        connectionCount: 0,
        external: false,
        confidence: 'unknown',
        wikiRole: 'unknown',
        maturity: 'unknown',
        graduatedNotes: [],
        created: null,
        tags: [],
        frontmatter: {},
        frontier: false,
        ...pos
    }
}

describe('carryOverPositions', () => {
    test('rebuilt nodes keep the position of the node with the same id', () => {
        const previous = new Map([['a', { ...node('a', { x: 10, y: 20 }), vx: 1, vy: 2 }]])
        const data: GraphData = { nodes: [node('a')], links: [] }
        carryOverPositions(data, previous)
        expect(data.nodes[0]).toMatchObject({ x: 10, y: 20, vx: 1, vy: 2 })
    })

    test('does not override a position the node already has (saved, pinned)', () => {
        const previous = new Map([['a', node('a', { x: 10, y: 20 })]])
        const data: GraphData = { nodes: [node('a', { x: 99, y: 99 })], links: [] }
        carryOverPositions(data, previous)
        expect(data.nodes[0]).toMatchObject({ x: 99, y: 99 })
    })

    test('new nodes start near a positioned neighbor', () => {
        const previous = new Map([['a', node('a', { x: 100, y: 100 })]])
        const data: GraphData = {
            nodes: [node('a'), node('b'), node('c')],
            links: [
                { source: 'a', target: 'b' },
                { source: 'c', target: 'a' }
            ]
        }
        carryOverPositions(data, previous)
        const [, b, c] = data.nodes
        for (const n of [b, c]) {
            expect(Math.hypot((n?.x ?? 0) - 100, (n?.y ?? 0) - 100)).toBeCloseTo(40, 5)
        }
        // Siblings around the same anchor do not share a spot
        expect(b?.x).not.toBe(c?.x)
    })

    test('new nodes without a positioned neighbor stay unplaced for force-graph', () => {
        const data: GraphData = { nodes: [node('a'), node('b')], links: [] }
        carryOverPositions(data, new Map())
        expect(data.nodes[0]?.x).toBeUndefined()
        expect(data.nodes[1]?.x).toBeUndefined()
    })
})
