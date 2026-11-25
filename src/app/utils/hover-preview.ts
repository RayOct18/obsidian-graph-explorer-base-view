/**
 * Helpers for Obsidian's Page preview ("hover-link") integration.
 * The view triggers hover-link with `targetEl: null` like the core graph does;
 * Page preview then only shows a preview when the Mod key is already held.
 * Pressing Mod while a node is hovered is handled by re-triggering with a
 * copy of the last pointer event that carries the modifier.
 */

/** True for a keydown of the platform Mod key itself (Ctrl, or Cmd on macOS). */
export function isModKeyPress(event: KeyboardEvent, isMac: boolean): boolean {
    if (event.repeat) return false
    return isMac ? event.key === 'Meta' : event.key === 'Control'
}

/** Init dict for a copy of `event` with the platform Mod modifier set. */
export function withModModifier(event: MouseEvent, isMac: boolean): MouseEventInit {
    return {
        bubbles: true,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: isMac ? event.ctrlKey : true,
        metaKey: isMac ? true : event.metaKey
    }
}

/**
 * The parts of HoverPopover used to keep or release a preview. `onTarget` and
 * `transition` are internal (the core graph uses them the same way), so they
 * are optional and checked before use.
 */
export interface PopoverLike {
    hoverEl?: HTMLElement
    onTarget?: boolean
    transition?: () => void
}

/** Tells a popover the pointer left (false) or came back to (true) its target. */
export function setPopoverOnTarget(popover: PopoverLike | null, onTarget: boolean): boolean {
    if (!popover || typeof popover.transition !== 'function') return false
    popover.onTarget = onTarget
    popover.transition()
    return true
}

/** Whether the popover is still on screen. */
export function isPopoverShown(popover: PopoverLike | null): boolean {
    return popover?.hoverEl?.isConnected === true
}
