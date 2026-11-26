import { describe, test, expect } from 'bun:test'
import {
    CARD_FONT_SIZE_DEFAULT,
    CARD_FONT_SIZE_MAX,
    CARD_FONT_SIZE_MIN,
    clampCardFontSize,
    clampCardSize,
    DEFAULT_CARD_SIZE,
    MAX_CARD_SIZE,
    MIN_CARD_SIZE,
    parseExpandedCards,
    serializeExpandedCards
} from './expanded-cards'

describe('clampCardSize', () => {
    test('keeps sizes in range and rounds them', () => {
        expect(clampCardSize({ w: 400.4, h: 300.6 })).toEqual({ w: 400, h: 301 })
    })

    test('clamps to the min and max', () => {
        expect(clampCardSize({ w: 1, h: 1 })).toEqual(MIN_CARD_SIZE)
        expect(clampCardSize({ w: 99999, h: 99999 })).toEqual(MAX_CARD_SIZE)
    })

    test('falls back to the default for invalid dimensions', () => {
        expect(clampCardSize({ w: 'x', h: Number.NaN })).toEqual(DEFAULT_CARD_SIZE)
    })
})

describe('parseExpandedCards', () => {
    test('round-trips through serializeExpandedCards', () => {
        const cards = { 'Tasks/A.md': { w: 400, h: 300 } }
        expect(parseExpandedCards(serializeExpandedCards(cards))).toEqual(cards)
    })

    test('returns no cards for missing or malformed values', () => {
        expect(parseExpandedCards(undefined)).toEqual({})
        expect(parseExpandedCards('')).toEqual({})
        expect(parseExpandedCards('nope')).toEqual({})
        expect(parseExpandedCards('[1,2]')).toEqual({})
    })

    test('drops bad entries and frontier ids, clamps sizes', () => {
        const raw = JSON.stringify({
            'ok.md': { w: 10, h: 5000 },
            'frontier:Missing': { w: 300, h: 300 },
            'bad.md': 3
        })
        expect(parseExpandedCards(raw)).toEqual({
            'ok.md': { w: MIN_CARD_SIZE.w, h: MAX_CARD_SIZE.h }
        })
    })
})

describe('clampCardFontSize', () => {
    test('keeps sizes in range and rounds them', () => {
        expect(clampCardFontSize(13.4)).toBe(13)
    })

    test('clamps to the min and max', () => {
        expect(clampCardFontSize(1)).toBe(CARD_FONT_SIZE_MIN)
        expect(clampCardFontSize(100)).toBe(CARD_FONT_SIZE_MAX)
    })

    test('falls back to the default for missing or invalid values', () => {
        expect(clampCardFontSize(undefined)).toBe(CARD_FONT_SIZE_DEFAULT)
        expect(clampCardFontSize('14')).toBe(CARD_FONT_SIZE_DEFAULT)
        expect(clampCardFontSize(Number.NaN)).toBe(CARD_FONT_SIZE_DEFAULT)
    })
})
