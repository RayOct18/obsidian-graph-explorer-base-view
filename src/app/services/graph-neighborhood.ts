import type { CachedMetadata, MetadataCache } from 'obsidian'
import type { EdgeSource, GraphData, GraphLink, GraphNode } from '../types/graph-types'
import {
    getNoteConfidence,
    getNoteFrontmatter,
    getNoteGraduatedNotes,
    getNoteMaturity,
    getNoteTags,
    getNoteWikiRole,
    isNoteExplored
} from '../utils/frontmatter-utils'
import { getLinkTargets } from './graph-data-builder'

export interface NeighborhoodOptions {
    edgeSource: EdgeSource
    exploredProperty: string
    maturityProperty: string
    graduatedNotesProperty: string
}

/**
 * Adds the direct neighbors of `selectedId` that are not in `graph` (e.g. notes
 * the Base filter excludes), linked in either direction. Revealed notes become
 * external nodes carrying their real frontmatter, so color-by-property still
 * works. Returns `graph` unchanged when nothing is revealed.
 *
 * When the selected note is itself outside the graph (a revealed note was
 * clicked), it is added too, so selection can walk through excluded notes.
 */
export function revealNeighborhood(
    graph: GraphData,
    selectedId: string,
    metadataCache: MetadataCache,
    options: NeighborhoodOptions
): GraphData {
    if (selectedId.startsWith('frontier:')) return graph
    const selectedMetadata = metadataCache.getCache(selectedId)
    const selectedExists = selectedId in metadataCache.resolvedLinks || selectedMetadata !== null
    if (!selectedExists) return graph

    const inGraph = new Set(graph.nodes.map((n) => n.id))
    const revealed = new Map<string, GraphNode>()
    if (!inGraph.has(selectedId)) {
        revealed.set(selectedId, createRevealedNode(selectedId, selectedMetadata, options))
    }

    const neighbors = new Set<string>([
        ...outgoingTargets(selectedId, metadataCache, options.edgeSource),
        ...incomingSources(selectedId, metadataCache, options.edgeSource, null)
    ])
    neighbors.delete(selectedId)
    for (const path of neighbors) {
        if (inGraph.has(path) || revealed.has(path)) continue
        revealed.set(path, createRevealedNode(path, metadataCache.getCache(path), options))
    }
    if (revealed.size === 0) return graph

    // Edges touching a revealed node, against everything now in the graph
    const allIds = new Set([...inGraph, ...revealed.keys()])
    const seen = new Set(graph.links.map((l) => pairKey(linkEnd(l.source), linkEnd(l.target))))
    const extraLinks: GraphLink[] = []
    const addLink = (source: string, target: string): void => {
        if (source === target || !allIds.has(source) || !allIds.has(target)) return
        const key = pairKey(source, target)
        if (seen.has(key)) return
        seen.add(key)
        extraLinks.push({ source, target, sourceRole: 'unknown' })
    }
    for (const path of revealed.keys()) {
        for (const target of outgoingTargets(path, metadataCache, options.edgeSource)) {
            addLink(path, target)
        }
        for (const source of incomingSources(path, metadataCache, options.edgeSource, allIds)) {
            addLink(source, path)
        }
    }

    for (const link of extraLinks) {
        for (const end of [link.source, link.target] as string[]) {
            const node = revealed.get(end)
            if (node) node.connectionCount++
        }
    }

    return {
        nodes: [...graph.nodes, ...revealed.values()],
        links: [...graph.links, ...extraLinks]
    }
}

function outgoingTargets(
    path: string,
    metadataCache: MetadataCache,
    edgeSource: EdgeSource
): string[] {
    return getLinkTargets(path, metadataCache.getCache(path), metadataCache, edgeSource).resolved
}

/**
 * Notes linking to `target`. `resolvedLinks` covers every link type, so it
 * narrows the candidates; for frontmatter/body edges each candidate is then
 * re-checked against its own edge-source targets.
 */
function incomingSources(
    target: string,
    metadataCache: MetadataCache,
    edgeSource: EdgeSource,
    restrictTo: Set<string> | null
): string[] {
    const sources: string[] = []
    for (const [source, targets] of Object.entries(metadataCache.resolvedLinks)) {
        if (restrictTo && !restrictTo.has(source)) continue
        if (!(target in targets)) continue
        if (
            edgeSource === 'all' ||
            outgoingTargets(source, metadataCache, edgeSource).includes(target)
        ) {
            sources.push(source)
        }
    }
    return sources
}

function createRevealedNode(
    path: string,
    metadata: CachedMetadata | null,
    options: NeighborhoodOptions
): GraphNode {
    return {
        id: path,
        name: path.replace(/\.md$/, '').split('/').pop() ?? path,
        explored: isNoteExplored(metadata, options.exploredProperty),
        connectionCount: 0,
        external: true,
        confidence: getNoteConfidence(metadata),
        wikiRole: getNoteWikiRole(metadata),
        maturity: getNoteMaturity(metadata, options.maturityProperty),
        graduatedNotes: getNoteGraduatedNotes(metadata, options.graduatedNotesProperty),
        created: null,
        tags: getNoteTags(metadata),
        frontmatter: getNoteFrontmatter(metadata),
        frontier: false
    }
}

/** force-graph replaces link ends with node objects after the first render */
function linkEnd(end: GraphLink['source']): string {
    return typeof end === 'object' && end !== null ? String((end as GraphNode).id) : String(end)
}

function pairKey(a: string, b: string): string {
    return a < b ? `${a}\t${b}` : `${b}\t${a}`
}
