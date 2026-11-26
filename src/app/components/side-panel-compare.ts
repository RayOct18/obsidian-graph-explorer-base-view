import { Component } from 'obsidian'
import type { App, MarkdownFileInfo, TFile } from 'obsidian'
import {
    createMarkdownEmbed,
    flushMarkdownEmbed,
    type MarkdownEmbed
} from '../utils/markdown-embed'
import { log } from '../../utils/log'

/** Smallest height of either half of the side panel while dragging the splitter */
const MIN_PANE_HEIGHT = 80

/**
 * Lower half of the side panel: a second note with its own editor, for
 * comparing and editing two notes at once. A splitter above it sets the split.
 */
export class SidePanelCompare extends Component {
    private rootEl: HTMLElement
    private titleEl: HTMLElement
    private bodyEl: HTMLElement
    private embed: MarkdownEmbed | null = null
    private path: string | null = null
    /** Incremented on every show/close so stale async loads bail out. */
    private token = 0
    /** Height of the lower pane in px; null = half of the panel */
    private height: number | null = null

    constructor(
        private panelEl: HTMLElement,
        private app: App,
        private onClose: () => void,
        /** The cursor moved into the lower note */
        private onFocus: () => void
    ) {
        super()
        const splitter = panelEl.createDiv({ cls: 'ge-side-panel__splitter ge-compare--hidden' })
        this.rootEl = panelEl.createDiv({ cls: 'ge-side-panel__compare ge-compare--hidden' })
        const header = this.rootEl.createDiv({ cls: 'ge-side-panel__compare-header' })
        this.titleEl = header.createSpan({ cls: 'ge-side-panel__compare-title' })
        const closeBtn = header.createEl('button', {
            text: '✕',
            cls: 'ge-side-panel__compare-close clickable-icon',
            attr: { 'aria-label': 'Close the lower note', 'title': 'Close the lower note' }
        })
        this.registerDomEvent(closeBtn, 'click', () => this.onClose())
        this.bodyEl = this.rootEl.createDiv({ cls: 'ge-side-panel__compare-body' })
        this.registerDomEvent(this.rootEl, 'focusin', () => this.onFocus())
        this.setupSplitter(splitter)
    }

    override onunload(): void {
        void this.close()
    }

    isOpen(): boolean {
        return this.path !== null
    }

    getPath(): string | null {
        return this.path
    }

    async show(file: TFile): Promise<void> {
        const token = ++this.token
        await this.disposeEditor()
        if (token !== this.token) return
        this.path = file.path
        this.titleEl.setText(file.basename)
        this.titleEl.setAttr('title', file.path)
        this.setVisible(true)
        this.bodyEl.empty()

        const holder = this.bodyEl.createDiv({ cls: 'ge-side-panel__editor markdown-embed' })
        const embed = createMarkdownEmbed(this.app, holder, file)
        if (!embed) {
            holder.setText('This Obsidian version does not expose the embedded editor.')
            return
        }
        this.embed = embed
        this.addChild(embed)
        try {
            await embed.loadFile()
            if (token !== this.token || this.embed !== embed) return
            embed.showEditor()
        } catch (error) {
            log('Failed to open the lower side panel editor', 'warn', error)
            await this.disposeEditor()
            return
        }
        embed.registerDomEvent(holder, 'focusin', () => {
            this.app.workspace.activeEditor = embed as unknown as MarkdownFileInfo
        })
    }

    /** Saves pending edits and hides the lower pane. */
    async close(): Promise<void> {
        this.token++
        this.path = null
        this.setVisible(false)
        await this.disposeEditor()
        this.bodyEl.empty()
    }

    private setVisible(visible: boolean): void {
        this.panelEl.toggleClass('ge-side-panel--split', visible)
        for (const el of [this.rootEl, this.rootEl.previousElementSibling]) {
            el?.toggleClass('ge-compare--hidden', !visible)
        }
        this.applyHeight()
    }

    private applyHeight(): void {
        this.rootEl.style.flexBasis = this.height === null ? '50%' : `${this.height}px`
    }

    private async disposeEditor(): Promise<void> {
        const embed = this.embed
        if (!embed) return
        this.embed = null
        try {
            await flushMarkdownEmbed(embed)
        } catch (error) {
            log('Failed to save lower side panel edits', 'error', error)
        }
        if ((this.app.workspace.activeEditor as unknown) === embed) {
            this.app.workspace.activeEditor = null
        }
        this.removeChild(embed)
    }

    /** Dragging the splitter moves the border between the two notes. */
    private setupSplitter(splitter: HTMLElement): void {
        this.registerDomEvent(splitter, 'mousedown', (e: MouseEvent) => {
            if (e.button !== 0) return
            e.preventDefault()
            const startY = e.clientY
            const startHeight = this.rootEl.getBoundingClientRect().height
            const panelHeight = this.panelEl.getBoundingClientRect().height
            const onMove = (ev: MouseEvent): void => {
                const next = startHeight - (ev.clientY - startY)
                this.height = Math.max(
                    MIN_PANE_HEIGHT,
                    Math.min(panelHeight - MIN_PANE_HEIGHT * 2, next)
                )
                this.applyHeight()
            }
            const onUp = (): void => {
                activeDocument.removeEventListener('mousemove', onMove)
                activeDocument.removeEventListener('mouseup', onUp)
                activeDocument.body.removeClass('ge-resizing-row')
            }
            activeDocument.body.addClass('ge-resizing-row')
            activeDocument.addEventListener('mousemove', onMove)
            activeDocument.addEventListener('mouseup', onUp)
        })
    }
}
