import { describe, test, expect } from 'bun:test'
import { parseCameraState, parseSelectedNode, serializeCameraState } from './view-state'

describe('parseCameraState', () => {
    test('reads a saved camera', () => {
        expect(parseCameraState('{"k":1.5,"x":-20,"y":40}')).toEqual({ k: 1.5, x: -20, y: 40 })
    })

    test('round-trips through serializeCameraState', () => {
        const saved = serializeCameraState({ k: 0.123456, x: 10.4, y: -3.6 })
        expect(parseCameraState(saved)).toEqual({ k: 0.123, x: 10, y: -4 })
    })

    test('returns null for missing, malformed or invalid values', () => {
        expect(parseCameraState(undefined)).toBeNull()
        expect(parseCameraState('')).toBeNull()
        expect(parseCameraState('not json')).toBeNull()
        expect(parseCameraState('{"k":0,"x":0,"y":0}')).toBeNull()
        expect(parseCameraState('{"k":1,"x":"a","y":0}')).toBeNull()
        expect(parseCameraState('null')).toBeNull()
    })
})

describe('parseSelectedNode', () => {
    test('reads a saved note path', () => {
        expect(parseSelectedNode('Tasks/A.md')).toBe('Tasks/A.md')
    })

    test('ignores empty, non-string and frontier ids', () => {
        expect(parseSelectedNode('')).toBeNull()
        expect(parseSelectedNode(null)).toBeNull()
        expect(parseSelectedNode(3)).toBeNull()
        expect(parseSelectedNode('frontier:Missing')).toBeNull()
    })
})
