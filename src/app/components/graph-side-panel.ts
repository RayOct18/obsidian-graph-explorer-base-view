import { Component, MarkdownRenderer, TFile } from 'obsidian'
import { SidePanelCompare } from './side-panel-compare'
import type { App, MarkdownFileInfo } from 'obsidian'
import type { GraphNode, MaturityLevel } from '../types/graph-types'
import {
    canEmbedEditor,
    createMarkdownEmbed,
    flushMarkdownEmbed,
    type MarkdownEmbed
} from '../utils/markdown-embed'
import { log } from '../../utils/log'

export type SidePanelMode = 'preview' | 'edit'

export interface GraphSidePanelCallbacks {
    onToggleExplored: (node: GraphNode) => void
    onSetMaturity: (node: GraphNode, maturity: MaturityLevel) => void
    onClose: () => void
    onNavigateToNode: (nodeId: string) => void
    /** The lower note was closed with its ✕ */
    onCompareClose?: () => void
}

/**
 * Right-side panel showing the selected note with rendered content,
 * wiki role, confidence, and tags. In edit mode the content area hosts
 * Obsidian's own markdown editor (the one Canvas uses for file cards).
 */
export class GraphSidePanel extends Component {
    private panelEl: HTMLElement
    private headerEl: HTMLElement
    private contentEl: HTMLElement
    private app: App
    private callbacks: GraphSidePanelCallbacks
    private currentNode: GraphNode | null = null
    private renderComponent: Component | null = null
    private graphNodePaths: Set<string> = new Set()
    private mode: SidePanelMode = 'edit'
    private embed: MarkdownEmbed | null = null
    /** Incremented on every showNode/hide so stale async renders bail out. */
    private renderToken = 0
    /** Second note below the first, for comparing and editing both */
    private compare: SidePanelCompare
    /** Whether the cursor was last in the lower note */
    private lowerActive = false

    constructor(containerEl: HTMLElement, app: App, callbacks: GraphSidePanelCallbacks) {
        super()
        this.app = app
        this.callbacks = callbacks

        this.panelEl = containerEl.createDiv({ cls: 'ge-side-panel ge-side-panel--hidden' })

        // Resize handle
        const resizeHandle = this.panelEl.createDiv({ cls: 'ge-side-panel__resize-handle' })
        this.setupResize(resizeHandle)

        this.headerEl = this.panelEl.createDiv({ cls: 'ge-side-panel__header' })
        this.contentEl = this.panelEl.createDiv({ cls: 'ge-side-panel__content' })
        this.compare = new SidePanelCompare(
            this.panelEl,
            this.app,
            () => {
                void this.compare.close()
                this.setLowerActive(false)
                this.callbacks.onCompareClose?.()
            },
            () => this.setLowerActive(true)
        )
        this.addChild(this.compare)
        this.registerDomEvent(this.contentEl, 'focusin', () => this.setLowerActive(false))
    }

    /**
     * True when the cursor was last in the lower note: clicking a node then
     * switches the lower note instead of the upper one.
     */
    isLowerActive(): boolean {
        return this.lowerActive && this.compare.isOpen()
    }

    private setLowerActive(active: boolean): void {
        this.lowerActive = active
        this.panelEl.toggleClass('ge-side-panel--lower-active', active)
    }

    /** Opens `file` in the lower half of the panel (the panel must be open). */
    async showCompare(file: TFile): Promise<void> {
        await this.compare.show(file)
    }

    async closeCompare(): Promise<void> {
        this.setLowerActive(false)
        await this.compare.close()
    }

    getComparePath(): string | null {
        return this.compare.getPath()
    }

    override onunload(): void {
        void this.disposeEditor()
        this.renderComponent?.unload()
        this.renderComponent = null
        this.panelEl.remove()
    }

    async showNode(node: GraphNode): Promise<void> {
        const token = ++this.renderToken
        // Write pending edits of the previous note before its editor goes away
        await this.disposeEditor()
        if (token !== this.renderToken) return

        this.currentNode = node
        this.contentEl.scrollTop = 0

        // Frontier nodes have no file
        if (node.frontier) {
            this.panelEl.removeClass('ge-side-panel--hidden')
            this.renderHeader(node)
            this.clearContent()
            this.contentEl.createDiv({
                cls: 'ge-side-panel__frontier-notice',
                text: 'This note does not exist yet. It is referenced by other notes in the graph.'
            })
            return
        }

        const file = this.app.vault.getAbstractFileByPath(node.id)
        if (!(file instanceof TFile)) return

        this.panelEl.removeClass('ge-side-panel--hidden')
        this.renderHeader(node)
        if (this.mode === 'edit' && (await this.renderEditor(file, token))) return
        if (token !== this.renderToken) return
        await this.renderContent(file)
    }

    hide(): void {
        this.renderToken++
        void this.compare.close()
        this.setLowerActive(false)
        this.panelEl.addClass('ge-side-panel--hidden')
        this.currentNode = null
        void this.disposeEditor()
        this.clearContent()
    }

    getMode(): SidePanelMode {
        return this.mode
    }

    private toggleMode(): void {
        this.mode = this.mode === 'edit' ? 'preview' : 'edit'
        if (this.currentNode) void this.showNode(this.currentNode)
    }

    isVisible(): boolean {
        return !this.panelEl.hasClass('ge-side-panel--hidden')
    }

    getCurrentNode(): GraphNode | null {
        return this.currentNode
    }

    setGraphNodePaths(paths: Set<string>): void {
        this.graphNodePaths = paths
    }

    updateExploredState(explored: boolean): void {
        if (!this.currentNode) return
        this.currentNode = { ...this.currentNode, explored }
        this.renderHeader(this.currentNode)
    }

    updateMaturityState(maturity: MaturityLevel): void {
        if (!this.currentNode) return
        this.currentNode = { ...this.currentNode, maturity }
        this.renderHeader(this.currentNode)
    }

    private setupResize(handle: HTMLElement): void {
        let startX = 0
        let startWidth = 0

        const onMouseMove = (e: MouseEvent) => {
            const delta = startX - e.clientX
            const newWidth = Math.max(240, Math.min(startWidth + delta, window.innerWidth * 0.7))
            this.panelEl.style.width = `${newWidth}px`
        }

        const onMouseUp = () => {
            activeDocument.removeEventListener('mousemove', onMouseMove)
            activeDocument.removeEventListener('mouseup', onMouseUp)
            activeDocument.body.removeClass('ge-resizing')
        }

        handle.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault()
            startX = e.clientX
            startWidth = this.panelEl.getBoundingClientRect().width
            activeDocument.body.addClass('ge-resizing')
            activeDocument.addEventListener('mousemove', onMouseMove)
            activeDocument.addEventListener('mouseup', onMouseUp)
        })
    }

    private renderHeader(node: GraphNode): void {
        this.headerEl.empty()

        // Row 1: Title + close
        const titleRow = this.headerEl.createDiv({ cls: 'ge-side-panel__title-row' })
        const titleEl = titleRow.createDiv({ cls: 'ge-side-panel__title' })
        const nameEl = titleEl.createSpan({
            text: node.name,
            cls: 'ge-side-panel__name',
            attr: { title: 'Click to open in new tab' }
        })
        if (!node.frontier) {
            nameEl.addClass('ge-side-panel__name--clickable')
            nameEl.addEventListener('click', () => {
                const file = this.app.vault.getAbstractFileByPath(node.id)
                if (file instanceof TFile) {
                    void this.app.workspace.getLeaf('tab').openFile(file)
                }
            })
        }

        const closeBtn = titleRow.createEl('button', {
            cls: 'ge-side-panel__close clickable-icon',
            attr: { 'aria-label': 'Close panel', 'title': 'Close panel' }
        })
        closeBtn.textContent = '\u2715'
        this.registerDomEvent(closeBtn, 'click', () => {
            this.callbacks.onClose()
        })

        // Row 2: Badges/pills
        const badgesEl = this.headerEl.createDiv({ cls: 'ge-side-panel__badges' })

        if (node.external) {
            badgesEl.createSpan({
                text: 'external',
                cls: 'ge-side-panel__badge ge-side-panel__external-badge',
                attr: { title: 'This note is outside the current Base filter' }
            })
        }
        if (node.frontier) {
            badgesEl.createSpan({
                text: 'frontier',
                cls: 'ge-side-panel__badge ge-side-panel__frontier-badge',
                attr: { title: 'This note does not exist yet (unresolved link)' }
            })
        }
        if (node.wikiRole !== 'unknown') {
            const roleDescriptions: Record<string, string> = {
                article: 'Wiki article: a knowledge entry',
                index: 'Wiki index: table of contents for the wiki',
                log: 'Wiki log: change history and activity record',
                source_summary: 'Source summary: digest of an ingested source'
            }
            badgesEl.createSpan({
                text: node.wikiRole.replace(/_/g, ' '),
                cls: `ge-side-panel__badge ge-side-panel__role-badge ge-side-panel__role-badge--${node.wikiRole}`,
                attr: { title: roleDescriptions[node.wikiRole] ?? node.wikiRole }
            })
        }
        if (node.confidence !== 'unknown') {
            const confDescriptions: Record<string, string> = {
                high: 'High confidence: well-sourced and cross-referenced',
                medium: 'Medium confidence: partially verified',
                low: 'Low confidence: needs more sources',
                uncertain: 'Uncertain: speculative or unverified'
            }
            badgesEl.createSpan({
                text: node.confidence,
                cls: `ge-side-panel__badge ge-side-panel__confidence-badge ge-side-panel__confidence-badge--${node.confidence}`,
                attr: { title: confDescriptions[node.confidence] ?? node.confidence }
            })
        }
        if (node.graduatedNotes.length > 0) {
            badgesEl.createSpan({
                text: `${node.graduatedNotes.length} graduated`,
                cls: 'ge-side-panel__badge ge-side-panel__graduated-badge',
                attr: {
                    title: `Graduated notes: ${node.graduatedNotes.join(', ')}`
                }
            })
        }
        if (node.tags.length > 0) {
            for (const tag of node.tags.slice(0, 5)) {
                badgesEl.createSpan({
                    text: tag,
                    cls: 'ge-side-panel__badge ge-side-panel__tag',
                    attr: { title: `Tag: ${tag}` }
                })
            }
        }

        // Row 3: Action buttons
        const actionsEl = this.headerEl.createDiv({ cls: 'ge-side-panel__actions' })

        if (!node.external && !node.frontier) {
            const toggleBtn = actionsEl.createEl('button', {
                cls: 'ge-side-panel__toggle-explored',
                attr: {
                    'aria-label': node.explored ? 'Mark as unexplored' : 'Mark as explored',
                    'title': node.explored ? 'Mark as unexplored' : 'Mark as explored'
                }
            })
            toggleBtn.textContent = node.explored ? '\u2713 Explored' : '\u25CB Mark explored'
            if (node.explored) {
                toggleBtn.addClass('ge-side-panel__toggle-explored--active')
            }
            this.registerDomEvent(toggleBtn, 'click', () => {
                if (this.currentNode) {
                    this.callbacks.onToggleExplored(this.currentNode)
                }
            })
        }

        if (!node.external && !node.frontier) {
            const maturitySelect = actionsEl.createEl('select', {
                cls: `ge-side-panel__maturity-select ge-side-panel__maturity-select--${node.maturity}`,
                attr: {
                    'aria-label': 'Set maturity level',
                    'title': 'Set maturity level'
                }
            })
            const levels: { value: MaturityLevel; label: string }[] = [
                { value: 'unknown', label: 'No maturity' },
                { value: 'stub', label: '\u{1F7E0} Stub' },
                { value: 'draft', label: '\u{1F7E1} Draft' },
                { value: 'substantial', label: '\u{1F535} Substantial' },
                { value: 'mature', label: '\u{1F7E2} Mature' }
            ]
            for (const level of levels) {
                const option = maturitySelect.createEl('option', {
                    text: level.label,
                    value: level.value
                })
                if (level.value === node.maturity) {
                    option.selected = true
                }
            }
            this.registerDomEvent(maturitySelect, 'change', () => {
                if (this.currentNode) {
                    const val = maturitySelect.value as MaturityLevel
                    this.callbacks.onSetMaturity(this.currentNode, val)
                    // Update styling to match new value
                    maturitySelect.className = `ge-side-panel__maturity-select ge-side-panel__maturity-select--${val}`
                }
            })
        }

        const editFile = node.frontier ? null : this.app.vault.getAbstractFileByPath(node.id)
        if (editFile instanceof TFile && canEmbedEditor(this.app, editFile)) {
            const editing = this.mode === 'edit'
            const editBtn = actionsEl.createEl('button', {
                text: editing ? '\u{1F441} Preview' : '\u270E Edit',
                cls: 'ge-side-panel__edit-btn',
                attr: {
                    'aria-label': editing ? 'Show rendered note' : 'Edit note in panel',
                    'title': editing ? 'Show rendered note' : 'Edit note in panel'
                }
            })
            if (editing) editBtn.addClass('ge-side-panel__edit-btn--active')
            this.registerDomEvent(editBtn, 'click', () => this.toggleMode())
        }
    }

    private async renderContent(file: TFile): Promise<void> {
        this.clearContent()

        const content = await this.app.vault.cachedRead(file)
        this.renderComponent = new Component()
        this.renderComponent.load()

        await MarkdownRenderer.render(
            this.app,
            content,
            this.contentEl,
            file.path,
            this.renderComponent
        )

        // Make internal links clickable
        // Left-click: navigate in-panel if target is a graph node, otherwise open in tab
        // Middle-click: always open in new tab
        this.contentEl.querySelectorAll('a.internal-link').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.preventDefault()
                const href = el.getAttribute('href')
                if (!href) return
                const target = this.app.metadataCache.getFirstLinkpathDest(href, file.path)
                if (!(target instanceof TFile)) return

                if (this.graphNodePaths.has(target.path)) {
                    // Navigate within the panel
                    this.callbacks.onNavigateToNode(target.path)
                } else {
                    // Open in new tab
                    void this.app.workspace.getLeaf('tab').openFile(target)
                }
            })
            el.addEventListener('auxclick', (e) => {
                if ((e as MouseEvent).button !== 1) return
                e.preventDefault()
                const href = el.getAttribute('href')
                if (!href) return
                const target = this.app.metadataCache.getFirstLinkpathDest(href, file.path)
                if (target instanceof TFile) {
                    void this.app.workspace.getLeaf('tab').openFile(target)
                }
            })
        })

        // Make external links clickable
        this.contentEl.querySelectorAll('a.external-link').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.preventDefault()
                const href = el.getAttribute('href')
                if (href) window.open(href)
            })
        })
    }

    /**
     * Mounts an editable markdown embed for `file`.
     * Returns false when the internal editor API is unavailable (caller falls back to preview).
     */
    private async renderEditor(file: TFile, token: number): Promise<boolean> {
        this.clearContent()
        const holder = this.contentEl.createDiv({
            cls: 'ge-side-panel__editor markdown-embed'
        })
        const embed = createMarkdownEmbed(this.app, holder, file)
        if (!embed) {
            holder.remove()
            return false
        }
        this.embed = embed
        this.addChild(embed)
        try {
            await embed.loadFile()
            if (token !== this.renderToken || this.embed !== embed) return true
            embed.showEditor()
        } catch (error) {
            log('Failed to open the side panel editor', 'warn', error)
            await this.disposeEditor()
            return false
        }
        // Let Obsidian commands and hotkeys (bold, toggle checkbox, ...) target this editor
        embed.registerDomEvent(holder, 'focusin', () => {
            this.app.workspace.activeEditor = embed as unknown as MarkdownFileInfo
        })
        return true
    }

    /** Saves pending edits, then unloads the editor. Safe to call when no editor is mounted. */
    private async disposeEditor(): Promise<void> {
        const embed = this.embed
        if (!embed) return
        this.embed = null
        try {
            await flushMarkdownEmbed(embed)
        } catch (error) {
            log('Failed to save side panel edits', 'error', error)
        }
        if ((this.app.workspace.activeEditor as unknown) === embed) {
            this.app.workspace.activeEditor = null
        }
        this.removeChild(embed)
    }

    private clearContent(): void {
        this.renderComponent?.unload()
        this.renderComponent = null
        this.contentEl.empty()
    }
}
