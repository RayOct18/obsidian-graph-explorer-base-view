import { describe, test, expect } from 'bun:test'
import { assignValueColors, hexToRgba, VALUE_PALETTE } from './value-colors'

const [first, second] = VALUE_PALETTE as [string, string]

describe('assignValueColors', () => {
    test('colors values by their sorted order and counts them', () => {
        expect(assignValueColors(['todo', 'doing', 'todo'])).toEqual([
            { value: 'doing', color: first, count: 1 },
            { value: 'todo', color: second, count: 2 }
        ])
    })

    test('does not depend on the order notes come in', () => {
        expect(assignValueColors(['b', 'a'])).toEqual(assignValueColors(['a', 'b']))
    })
})

test('hexToRgba', () => {
    expect(hexToRgba('#ff8000', 0.5)).toBe('rgba(255, 128, 0, 0.5)')
})
