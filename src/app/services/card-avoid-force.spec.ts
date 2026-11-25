import { describe, test, expect } from 'bun:test'
import { createCardAvoidForce, type AvoidNode } from './card-avoid-force'
import type { CardSize } from '../utils/expanded-cards'

function run(nodes: AvoidNode[], cards: Record<string, CardSize>, padding = 0): void {
    const force = createCardAvoidForce((id) => cards[id] ?? null, padding)
    force.initialize(nodes)
    force(1)
}

const card = { w: 200, h: 100 }

describe('createCardAvoidForce', () => {
    test('pushes a node inside a card out along the shorter way', () => {
        // 90 right of center: 10 from the right edge, 50 from top/bottom → push right
        const a: AvoidNode = { id: 'card', x: 0, y: 0 }
        const b: AvoidNode = { id: 'b', x: 90, y: 0 }
        run([a, b], { card })
        expect(b.vx).toBeGreaterThan(0)
        expect(b.vy ?? 0).toBe(0)
        expect(a.vx ?? 0).toBe(0)
    })

    test('pushes vertically when that is shorter', () => {
        const a: AvoidNode = { id: 'card', x: 0, y: 0 }
        const b: AvoidNode = { id: 'b', x: 0, y: -45 }
        run([a, b], { card })
        expect(b.vy).toBeLessThan(0)
        expect(b.vx ?? 0).toBe(0)
    })

    test('leaves nodes outside the card (and its padding) alone', () => {
        const a: AvoidNode = { id: 'card', x: 0, y: 0 }
        const b: AvoidNode = { id: 'b', x: 150, y: 0 }
        run([a, b], { card }, 20)
        expect(b.vx).toBeUndefined()
    })

    test('padding widens the card', () => {
        const a: AvoidNode = { id: 'card', x: 0, y: 0 }
        const b: AvoidNode = { id: 'b', x: 110, y: 0 }
        run([a, b], { card }, 20)
        expect(b.vx).toBeGreaterThan(0)
    })

    test('moves the card instead when the other node is pinned', () => {
        const a: AvoidNode = { id: 'card', x: 0, y: 0 }
        const b: AvoidNode = { id: 'b', x: 90, y: 0, fx: 90, fy: 0 }
        run([a, b], { card })
        expect(a.vx).toBeLessThan(0)
        expect(b.vx).toBeUndefined()
    })

    test('two overlapping cards push each other apart', () => {
        const a: AvoidNode = { id: 'a', x: 0, y: 0 }
        const b: AvoidNode = { id: 'b', x: 150, y: 0 }
        run([a, b], { a: card, b: card })
        expect(a.vx).toBeLessThan(0)
        expect(b.vx).toBeGreaterThan(0)
    })

    test('does nothing without cards', () => {
        const b: AvoidNode = { id: 'b', x: 0, y: 0 }
        run([b], {})
        expect(b.vx).toBeUndefined()
    })
})
