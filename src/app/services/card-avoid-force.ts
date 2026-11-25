import type { CardSize } from '../utils/expanded-cards'

/** The node fields the force reads and writes (d3 simulation node shape). */
export interface AvoidNode {
    id: string
    x?: number
    y?: number
    vx?: number
    vy?: number
    fx?: number | null
    fy?: number | null
}

export interface CardAvoidForce {
    (alpha: number): void
    initialize(nodes: AvoidNode[]): void
}

/** Share of the overlap removed per tick; collision forces in d3 are not scaled by alpha */
const STRENGTH = 0.6

/**
 * d3 force keeping nodes out of expanded cards. Each card is a rectangle
 * (size in graph units, centered on its node, plus `padding`). A node inside
 * a card is pushed out along the shorter way; two overlapping cards push each
 * other apart. Pinned nodes (fx/fy set) do not move; the other side takes the
 * whole push instead.
 */
export function createCardAvoidForce(
    getCardSize: (id: string) => CardSize | null,
    padding = 16
): CardAvoidForce {
    let nodes: AvoidNode[] = []

    const isPinned = (n: AvoidNode): boolean => n.fx != null && n.fy != null

    const push = (n: AvoidNode, dx: number, dy: number): void => {
        n.vx = (n.vx ?? 0) + dx
        n.vy = (n.vy ?? 0) + dy
    }

    const tick = (): void => {
        const cards = nodes.filter((n) => getCardSize(n.id) && n.x != null && n.y != null)
        if (cards.length === 0) return

        for (const card of cards) {
            const size = getCardSize(card.id)
            if (!size) continue
            const cx = card.x ?? 0
            const cy = card.y ?? 0

            for (const other of nodes) {
                if (other === card || other.x == null || other.y == null) continue
                const otherSize = getCardSize(other.id)
                // Half extents of the combined rectangle (a card vs. a card, or a card vs. a point)
                const hw = size.w / 2 + padding + (otherSize ? otherSize.w / 2 : 0)
                const hh = size.h / 2 + padding + (otherSize ? otherSize.h / 2 : 0)
                const dx = other.x - cx
                const dy = other.y - cy
                const overlapX = hw - Math.abs(dx)
                const overlapY = hh - Math.abs(dy)
                if (overlapX <= 0 || overlapY <= 0) continue

                // Shorter way out; a node exactly at the center leaves to the right
                let px = 0
                let py = 0
                if (overlapX < overlapY) px = (dx >= 0 ? 1 : -1) * overlapX * STRENGTH
                else py = (dy >= 0 ? 1 : -1) * overlapY * STRENGTH

                const otherPinned = isPinned(other)
                const cardPinned = isPinned(card)
                if (otherPinned && cardPinned) continue
                if (otherSize) {
                    // Card vs card: each card is visited, so give each half per visit
                    if (!otherPinned) push(other, px / 2, py / 2)
                    if (!cardPinned) push(card, -px / 2, -py / 2)
                } else if (!otherPinned) {
                    push(other, px, py)
                } else {
                    push(card, -px, -py)
                }
            }
        }
    }

    return Object.assign(tick, {
        initialize: (next: AvoidNode[]): void => {
            nodes = next
        }
    })
}
