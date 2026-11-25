import { describe, test, expect, mock } from 'bun:test'
import {
    isModKeyPress,
    isPopoverShown,
    setPopoverOnTarget,
    withModModifier,
    type PopoverLike
} from './hover-preview'

const key = (k: string, repeat = false): KeyboardEvent =>
    ({ key: k, repeat }) as unknown as KeyboardEvent

describe('isModKeyPress', () => {
    test('Control on Windows/Linux, Meta on macOS', () => {
        expect(isModKeyPress(key('Control'), false)).toBe(true)
        expect(isModKeyPress(key('Meta'), false)).toBe(false)
        expect(isModKeyPress(key('Meta'), true)).toBe(true)
        expect(isModKeyPress(key('Control'), true)).toBe(false)
    })

    test('ignores auto-repeat and other keys', () => {
        expect(isModKeyPress(key('Control', true), false)).toBe(false)
        expect(isModKeyPress(key('a'), false)).toBe(false)
    })
})

describe('withModModifier', () => {
    const source = {
        clientX: 10,
        clientY: 20,
        screenX: 30,
        screenY: 40,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false
    } as MouseEvent

    test('copies the pointer position and sets Ctrl on Windows/Linux', () => {
        expect(withModModifier(source, false)).toMatchObject({
            clientX: 10,
            clientY: 20,
            ctrlKey: true,
            metaKey: false
        })
    })

    test('sets Cmd on macOS', () => {
        expect(withModModifier(source, true)).toMatchObject({ ctrlKey: false, metaKey: true })
    })
})

describe('setPopoverOnTarget', () => {
    test('sets onTarget and runs the transition', () => {
        const transition = mock(() => {})
        const popover: PopoverLike = { onTarget: true, transition }
        expect(setPopoverOnTarget(popover, false)).toBe(true)
        expect(popover.onTarget).toBe(false)
        expect(transition).toHaveBeenCalledTimes(1)
    })

    test('does nothing without a popover or without the internal transition', () => {
        expect(setPopoverOnTarget(null, false)).toBe(false)
        expect(setPopoverOnTarget({ onTarget: true }, false)).toBe(false)
    })
})

describe('isPopoverShown', () => {
    test('follows whether the hover element is in the document', () => {
        expect(isPopoverShown(null)).toBe(false)
        expect(isPopoverShown({ hoverEl: { isConnected: true } as HTMLElement })).toBe(true)
        expect(isPopoverShown({ hoverEl: { isConnected: false } as HTMLElement })).toBe(false)
    })
})
