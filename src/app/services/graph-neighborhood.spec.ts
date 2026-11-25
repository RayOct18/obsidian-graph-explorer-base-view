import { describe, test, expect } from 'bun:test'
import type { MetadataCache } from 'obsidian'
import { revealNeighborhood, type NeighborhoodOptions } from './graph-neighborhood'
import type { GraphData, GraphNode } from '../types/graph-types'

const options: NeighborhoodOptions = {
    edgeSource: 'all',
    exploredProperty: 'explored',
    maturityProperty: 'maturity',
    graduatedNotesProperty: 'graduated_notes'
}

function node(id: string): GraphNode {
    return {
        id,
        name: id.replace(/\.md$/, ''),
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
        frontier: false
    }
}

/**
 * Vault: open.md and open2.md are in the base; done.md and child.md are not.
 * open.md -> done.md (follow-up of), child.md -> open.md (epic), child.md -> open2.md
 */
function makeCache(caches: Record<string, Record<string, unknown>> = {}): MetadataCache {
    const resolvedLinks: Record<string, Record<string, number>> = {
        'open.md': { 'done.md': 1 },
        'open2.md': {},
        'done.md': {},
        'child.md': { 'open.md': 1, 'open2.md': 1 }
    }
    return {
        resolvedLinks,
        unresolvedLinks: {},
        getCache: (path: string) => caches[path] ?? (path in resolvedLinks ? {} : null),
        getFirstLinkpathDest: (linkpath: string) =>
            `${linkpath}.md` in resolvedLinks ? { path: `${linkpath}.md` } : null
    } as unknown as MetadataCache
}

const baseGraph = (): GraphData => ({
    nodes: [node('open.md'), node('open2.md')],
    links: []
})

const ids = (g: GraphData): string[] => g.nodes.map((n) => n.id).sort()
const pairs = (g: GraphData): string[] =>
    g.links.map((l) => [String(l.source), String(l.target)].sort().join('|')).sort()

describe('revealNeighborhood', () => {
    test('adds outgoing and incoming neighbors outside the graph as external nodes', () => {
        const result = revealNeighborhood(baseGraph(), 'open.md', makeCache(), options)
        expect(ids(result)).toEqual(['child.md', 'done.md', 'open.md', 'open2.md'])
        expect(result.nodes.find((n) => n.id === 'done.md')?.external).toBe(true)
        expect(result.nodes.find((n) => n.id === 'child.md')?.external).toBe(true)
    })

    test('links revealed nodes to every node already in the graph', () => {
        const result = revealNeighborhood(baseGraph(), 'open.md', makeCache(), options)
        expect(pairs(result)).toEqual(['child.md|open.md', 'child.md|open2.md', 'done.md|open.md'])
        expect(result.nodes.find((n) => n.id === 'child.md')?.connectionCount).toBe(2)
    })

    test('revealed nodes carry their frontmatter for color-by-property', () => {
        const cache = makeCache({ 'done.md': { frontmatter: { status: 'Done' } } })
        const result = revealNeighborhood(baseGraph(), 'open.md', cache, options)
        expect(result.nodes.find((n) => n.id === 'done.md')?.frontmatter['status']).toBe('Done')
    })

    test('a selected note outside the graph is added with its neighbors', () => {
        const result = revealNeighborhood(baseGraph(), 'done.md', makeCache(), options)
        expect(ids(result)).toEqual(['done.md', 'open.md', 'open2.md'])
        expect(pairs(result)).toEqual(['done.md|open.md'])
    })

    test('returns the graph unchanged when every neighbor is already in it', () => {
        const graph: GraphData = { nodes: [node('open.md'), node('done.md')], links: [] }
        const cache = {
            resolvedLinks: { 'open.md': { 'done.md': 1 }, 'done.md': {} },
            unresolvedLinks: {},
            getCache: () => ({})
        } as unknown as MetadataCache
        expect(revealNeighborhood(graph, 'open.md', cache, options)).toBe(graph)
    })

    test('ignores frontier selections and unknown notes', () => {
        const graph = baseGraph()
        expect(revealNeighborhood(graph, 'frontier:Missing', makeCache(), options)).toBe(graph)
        expect(revealNeighborhood(graph, 'nope.md', makeCache(), options)).toBe(graph)
    })

    test('frontmatter edge source only follows links declared in properties', () => {
        const cache = makeCache({
            // open.md links done.md in the body only; child.md links open.md in properties
            'open.md': { links: [{ link: 'done', original: '[[done]]' }] },
            'child.md': { frontmatterLinks: [{ key: 'epic', link: 'open', original: '[[open]]' }] }
        })
        const result = revealNeighborhood(baseGraph(), 'open.md', cache, {
            ...options,
            edgeSource: 'frontmatter'
        })
        expect(ids(result)).toEqual(['child.md', 'open.md', 'open2.md'])
        expect(pairs(result)).toEqual(['child.md|open.md'])
    })
})
