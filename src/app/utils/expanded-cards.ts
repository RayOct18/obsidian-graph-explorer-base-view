/**
 * Notes expanded into cards on the graph, with their size in graph units
 * (cards scale with the zoom). Saved per view as a JSON string.
 */

export interface CardSize {
    w: number
    h: number
}

export type ExpandedCards = Record<string, CardSize>

export const DEFAULT_CARD_SIZE: CardSize = { w: 360, h: 280 }
export const MIN_CARD_SIZE: CardSize = { w: 160, h: 100 }
export const MAX_CARD_SIZE: CardSize = { w: 2000, h: 2000 }

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

/** Clamps a size to the supported range; invalid dimensions fall back to the default. */
export function clampCardSize(size: Partial<Record<keyof CardSize, unknown>>): CardSize {
    const w = isFiniteNumber(size.w) ? size.w : DEFAULT_CARD_SIZE.w
    const h = isFiniteNumber(size.h) ? size.h : DEFAULT_CARD_SIZE.h
    return {
        w: Math.round(Math.max(MIN_CARD_SIZE.w, Math.min(MAX_CARD_SIZE.w, w))),
        h: Math.round(Math.max(MIN_CARD_SIZE.h, Math.min(MAX_CARD_SIZE.h, h)))
    }
}

/** Reads saved cards (JSON string); entries with a bad shape are dropped. */
export function parseExpandedCards(raw: unknown): ExpandedCards {
    if (typeof raw !== 'string' || raw === '') return {}
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return {}
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const cards: ExpandedCards = {}
    for (const [path, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!path || path.startsWith('frontier:')) continue
        if (typeof value !== 'object' || value === null) continue
        cards[path] = clampCardSize(value as Record<string, unknown>)
    }
    return cards
}

export function serializeExpandedCards(cards: ExpandedCards): string {
    return JSON.stringify(cards)
}
