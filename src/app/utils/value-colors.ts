/**
 * Node colors for "Color nodes by" a generic property (such as `status`).
 * Each distinct value gets a palette color by its place in the sorted list of
 * values, so colors do not move when notes are added or removed.
 */

/** Fill opacity of node colors */
const NODE_ALPHA = 0.9

export const VALUE_PALETTE = [
    '#3b82f6',
    '#22c55e',
    '#eab308',
    '#ef4444',
    '#a855f7',
    '#14b8a6',
    '#f97316',
    '#ec4899',
    '#6366f1',
    '#06b6d4'
]

/** `#rrggbb` → `rgba(r, g, b, alpha)` */
export function hexToRgba(hex: string, alpha = NODE_ALPHA): string {
    const n = parseInt(hex.slice(1), 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export interface ValueColorEntry {
    value: string
    /** `#rrggbb` */
    color: string
    /** Number of notes with this value */
    count: number
}

/** Color for every distinct value, sorted by value. `values` holds one entry per note (repeats are counted). */
export function assignValueColors(values: Iterable<string>): ValueColorEntry[] {
    const counts = new Map<string, number>()
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
    const sorted = [...counts.keys()].sort((a, b) => a.localeCompare(b))
    return sorted.map((value, i) => ({
        value,
        color: VALUE_PALETTE[i % VALUE_PALETTE.length] ?? '#94a3b8',
        count: counts.get(value) ?? 0
    }))
}
