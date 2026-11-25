import { describe, expect, test } from 'bun:test'
import {
    DISPLAY_SCALE_MAX,
    DISPLAY_SCALE_MIN,
    NODE_SPACING_MAX,
    NODE_SPACING_MIN,
    clampDisplayScale,
    clampNodeSpacing
} from './graph-types'

describe('clampDisplayScale', () => {
    test('keeps saved values inside the slider range', () => {
        expect(clampDisplayScale(150)).toBe(150)
        expect(clampDisplayScale(5)).toBe(DISPLAY_SCALE_MIN)
        expect(clampDisplayScale(999)).toBe(DISPLAY_SCALE_MAX)
    })

    test('falls back to 100% when nothing usable is saved', () => {
        expect(clampDisplayScale(undefined)).toBe(100)
        expect(clampDisplayScale('150')).toBe(100)
        expect(clampDisplayScale(Number.NaN)).toBe(100)
    })
})

describe('clampNodeSpacing', () => {
    test('keeps values inside the supported range', () => {
        expect(clampNodeSpacing(1500)).toBe(1500)
        expect(clampNodeSpacing(NODE_SPACING_MIN)).toBe(NODE_SPACING_MIN)
        expect(clampNodeSpacing(NODE_SPACING_MAX)).toBe(NODE_SPACING_MAX)
    })

    test('clamps values outside the supported range', () => {
        expect(clampNodeSpacing(0)).toBe(NODE_SPACING_MIN)
        expect(clampNodeSpacing(-100)).toBe(NODE_SPACING_MIN)
        expect(clampNodeSpacing(99999)).toBe(NODE_SPACING_MAX)
    })
})
