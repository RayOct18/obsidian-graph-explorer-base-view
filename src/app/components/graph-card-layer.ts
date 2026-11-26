import { Component, TFile } from 'obsidian'
import type { App, MarkdownFileInfo } from 'obsidian'
import type { GraphNode } from '../types/graph-types'
import { clampCardSize, type CardSize, type ExpandedCards } from '../utils/expanded-cards'
import {
    createMarkdownEmbed,
    flushMarkdownEmbed,
    type MarkdownEmbed
} from '../utils/markdown-embed'
import { log } from '../../utils/log'

export interface GraphCardLayerCallbacks {
    /** Current node object for a path (null when it is not in the graph) */
    getNode: (id: string) => GraphNode | null
    toScreen: (x: number, y: number) => { x: number; y: number } | null
    getZoom: () => number
    /** Header drag: move the node to graph coordinates (live) */
    onMove: (id: string, x: number, y: number) => void
    /** Header drag finished */
    onMoveEnd: (id: string, x: number, y: number) => void
    onResizeEnd: (id: string, size: CardSize) => void
    onClose: (id: string) => void
    /** Show the note in the side panel instead of the card */
    onOpenInPanel: (id: string) => void
}

interface CardEntry {
    id: string
    size: CardSize
    el: HTMLElement
    embed: MarkdownEmbed | null
}

/**
 * HTML cards laid over the graph canvas, one per expanded note. Each card
 * holds Obsidian's markdown editor and follows its node: `position()` runs
 * after every canvas frame and maps the card's graph-space rectangle
 * (centered on the node) to the screen with the current zoom, so cards scale
 * like Canvas cards.
 */
export class GraphCardLayer extends Component {
    private layerEl: HTMLElement
    private cards = new Map<string, CardEntry>()

    constructor(
        containerEl: HTMLElement,
        private app: App,
        private callbacks: GraphCardLayerCallbacks
    ) {
        super()
        this.layerEl = containerEl.createDiv({ cls: 'ge-card-layer' })
    }

    override onunload(): void {
        for (const id of [...this.cards.keys()]) void this.removeCard(id)
        this.layerEl.remove()
    }

    /** Adds and removes cards so they match `expanded`; updates sizes. */
    sync(expanded: ExpandedCards): void {
        for (const id of [...this.cards.keys()]) {
            if (!(id in expanded)) void this.removeCard(id)
        }
        for (const [id, size] of Object.entries(expanded)) {
            const entry = this.cards.get(id)
            if (entry) {
                entry.size = size
            } else {
                this.addCard(id, size)
            }
        }
        this.position()
    }

    /** Text size inside every card, in px */
    setFontSize(px: number): void {
        this.layerEl.style.setProperty('--ge-card-font-size', `${px}px`)
    }

    /** Writes a card's pending edits now (before another editor opens the same note). */
    async flushCard(id: string): Promise<void> {
        const embed = this.cards.get(id)?.embed
        if (!embed) return
        try {
            await flushMarkdownEmbed(embed)
        } catch (error) {
            log('Failed to save card edits', 'error', error)
        }
    }

    hasCards(): boolean {
        return this.cards.size > 0
    }

    /** Places every card over its node. Hidden while its node is not in the graph. */
    position(): void {
        const k = this.callbacks.getZoom()
        for (const entry of this.cards.values()) {
            const node = this.callbacks.getNode(entry.id)
            const topLeft =
                node?.x != null && node.y != null
                    ? this.callbacks.toScreen(node.x - entry.size.w / 2, node.y - entry.size.h / 2)
                    : null
            if (!topLeft) {
                entry.el.addClass('ge-card--hidden')
                continue
            }
            entry.el.removeClass('ge-card--hidden')
            entry.el.style.width = `${entry.size.w}px`
            entry.el.style.height = `${entry.size.h}px`
            entry.el.style.transform = `translate(${topLeft.x}px, ${topLeft.y}px) scale(${k})`
        }
    }

    private addCard(id: string, size: CardSize): void {
        const file = this.app.vault.getAbstractFileByPath(id)
        if (!(file instanceof TFile)) return

        const el = this.layerEl.createDiv({ cls: 'ge-card' })
        const entry: CardEntry = { id, size, el, embed: null }
        this.cards.set(id, entry)

        const header = el.createDiv({ cls: 'ge-card__header' })
        header.createSpan({ text: file.basename, cls: 'ge-card__title' })
        const openBtn = header.createEl('button', {
            text: '\u25E8',
            cls: 'ge-card__btn clickable-icon',
            attr: {
                'aria-label': 'Open in side panel (collapses the card)',
                'title': 'Open in side panel (collapses the card)'
            }
        })
        const closeBtn = header.createEl('button', {
            text: '✕',
            cls: 'ge-card__btn clickable-icon',
            attr: { 'aria-label': 'Collapse card', 'title': 'Collapse card' }
        })
        this.registerDomEvent(openBtn, 'click', () => this.callbacks.onOpenInPanel(id))
        this.registerDomEvent(closeBtn, 'click', () => this.callbacks.onClose(id))
        this.setupDrag(entry, header)

        const body = el.createDiv({ cls: 'ge-card__body' })
        const holder = body.createDiv({ cls: 'ge-card__editor markdown-embed' })
        // Properties start collapsed in cards, to keep them small
        const embed = createMarkdownEmbed(this.app, holder, file, { collapseProperties: true })
        if (embed) {
            entry.embed = embed
            this.addChild(embed)
            void this.loadEditor(entry, embed, holder)
        } else {
            holder.setText('This Obsidian version does not expose the embedded editor.')
        }

        const resize = el.createDiv({ cls: 'ge-card__resize' })
        this.setupResize(entry, resize)
    }

    private async loadEditor(
        entry: CardEntry,
        embed: MarkdownEmbed,
        holder: HTMLElement
    ): Promise<void> {
        try {
            await embed.loadFile()
            if (entry.embed !== embed) return
            embed.showEditor()
        } catch (error) {
            log('Failed to open the card editor', 'warn', error)
            return
        }
        // Let Obsidian commands and hotkeys target the focused card
        embed.registerDomEvent(holder, 'focusin', () => {
            this.app.workspace.activeEditor = embed as unknown as MarkdownFileInfo
        })
    }

    /** Saves pending edits, then removes the card. */
    private async removeCard(id: string): Promise<void> {
        const entry = this.cards.get(id)
        if (!entry) return
        this.cards.delete(id)
        const embed = entry.embed
        entry.embed = null
        entry.el.remove()
        if (!embed) return
        try {
            await flushMarkdownEmbed(embed)
        } catch (error) {
            log('Failed to save card edits', 'error', error)
        }
        if ((this.app.workspace.activeEditor as unknown) === embed) {
            this.app.workspace.activeEditor = null
        }
        this.removeChild(embed)
    }

    /** Dragging the header moves the node; screen deltas are divided by the zoom. */
    private setupDrag(entry: CardEntry, handle: HTMLElement): void {
        this.registerDomEvent(handle, 'mousedown', (e: MouseEvent) => {
            if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
            const node = this.callbacks.getNode(entry.id)
            if (node?.x == null || node.y == null) return
            e.preventDefault()
            const startX = e.clientX
            const startY = e.clientY
            const nodeX = node.x
            const nodeY = node.y
            const k = this.callbacks.getZoom()
            let x = nodeX
            let y = nodeY
            const onMove = (ev: MouseEvent): void => {
                x = nodeX + (ev.clientX - startX) / k
                y = nodeY + (ev.clientY - startY) / k
                this.callbacks.onMove(entry.id, x, y)
                this.position()
            }
            const onUp = (): void => {
                activeDocument.removeEventListener('mousemove', onMove)
                activeDocument.removeEventListener('mouseup', onUp)
                activeDocument.body.removeClass('ge-card-dragging')
                this.callbacks.onMoveEnd(entry.id, x, y)
            }
            activeDocument.body.addClass('ge-card-dragging')
            activeDocument.addEventListener('mousemove', onMove)
            activeDocument.addEventListener('mouseup', onUp)
        })
    }

    /** Bottom-right handle; the card stays centered on its node while resizing. */
    private setupResize(entry: CardEntry, handle: HTMLElement): void {
        this.registerDomEvent(handle, 'mousedown', (e: MouseEvent) => {
            if (e.button !== 0) return
            e.preventDefault()
            e.stopPropagation()
            const startX = e.clientX
            const startY = e.clientY
            const start = { ...entry.size }
            const k = this.callbacks.getZoom()
            const onMove = (ev: MouseEvent): void => {
                // Centered on the node, so both sides grow: twice the pointer delta
                entry.size = clampCardSize({
                    w: start.w + ((ev.clientX - startX) / k) * 2,
                    h: start.h + ((ev.clientY - startY) / k) * 2
                })
                this.position()
            }
            const onUp = (): void => {
                activeDocument.removeEventListener('mousemove', onMove)
                activeDocument.removeEventListener('mouseup', onUp)
                activeDocument.body.removeClass('ge-card-dragging')
                this.callbacks.onResizeEnd(entry.id, entry.size)
            }
            activeDocument.body.addClass('ge-card-dragging')
            activeDocument.addEventListener('mousemove', onMove)
            activeDocument.addEventListener('mouseup', onUp)
        })
    }
}
