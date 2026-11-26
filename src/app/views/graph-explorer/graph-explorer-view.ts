import { BasesView, debounce, Platform, setIcon, TFile } from 'obsidian'
import type { Debouncer, HoverParent, HoverPopover, QueryController } from 'obsidian'
import type { GraphExplorerPlugin } from '../../plugin'
import { GRAPH_EXPLORER_VIEW_TYPE } from './graph-explorer.constants'
import { GraphCanvas } from '../../components/graph-canvas'
import { GraphSidePanel } from '../../components/graph-side-panel'
import { GraphCardLayer } from '../../components/graph-card-layer'
import {
    clampCardFontSize,
    DEFAULT_CARD_SIZE,
    parseExpandedCards,
    serializeExpandedCards,
    type CardSize,
    type ExpandedCards
} from '../../utils/expanded-cards'
import { GraphControls } from '../../components/graph-controls'
import { GraphZoomControls } from '../../components/graph-zoom-controls'
import { GraphContextMenu } from '../../components/graph-context-menu'
import type { ContextMenuAction } from '../../components/graph-context-menu'
import { GraphMinimap } from '../../components/graph-minimap'
import { GraphLegend } from '../../components/graph-legend'
import type { LegendConfig, LegendEntry, LegendSection } from '../../components/graph-legend'
import { buildGraphData } from '../../services/graph-data-builder'
import { revealNeighborhood } from '../../services/graph-neighborhood'
import {
    parseCameraState,
    parseSelectedNode,
    serializeCameraState,
    type CameraState
} from '../../utils/view-state'
import {
    isModKeyPress,
    isPopoverShown,
    setPopoverOnTarget,
    withModModifier,
    type PopoverLike
} from '../../utils/hover-preview'
import { setNoteExplored, setNoteMaturity } from '../../utils/frontmatter-utils'
import type {
    EdgeSource,
    ExploredFilter,
    GraphData,
    GraphNode,
    GraphStats,
    ConfidenceLevel,
    WikiRole,
    MaturityLevel,
    ViewPreset
} from '../../types/graph-types'
import { VIEW_PRESETS, clampDisplayScale, clampNodeSpacing } from '../../types/graph-types'
import { log } from '../../../utils/log'

/**
 * Main orchestrator BasesView that ties all graph components together.
 * Creates child components, handles data flow, manages the graph lifecycle,
 * keyboard navigation, context menus, batch operations, and view presets.
 */
export class GraphExplorerView extends BasesView implements HoverParent {
    override type = GRAPH_EXPLORER_VIEW_TYPE

    private containerEl: HTMLElement
    private viewEl: HTMLElement | null = null
    private graphCanvas: GraphCanvas | null = null
    private sidePanel: GraphSidePanel | null = null
    private controls: GraphControls | null = null
    private zoomControls: GraphZoomControls | null = null
    private minimap: GraphMinimap | null = null
    private legend: GraphLegend | null = null
    private contextMenu: GraphContextMenu | null = null
    private currentGraphData: GraphData = { nodes: [], links: [] }
    private searchQuery = ''
    /** Selected node id; drives revealing its neighbors outside the base */
    private selectedNodeId: string | null = null
    /** HoverParent: the Page preview popover currently owned by this view */
    hoverPopover: HoverPopover | null = null
    private lastHoverLink: string | null = null
    private viewStateRestored = false
    private pendingSelectionRestore = false
    private applyLeftPanelHidden: ((hidden: boolean) => void) | null = null
    private cardLayer: GraphCardLayer | null = null
    /** Notes expanded into cards (path → size in graph units); saved per view */
    private expandedCards: ExpandedCards = {}
    /** Timer for opening the side panel on a second click of the selected note */
    private pendingPanelOpen: number | null = null
    private debouncedUpdate: Debouncer<[], void>
    private initialized = false
    private activePreset = ''

    private plugin: GraphExplorerPlugin

    constructor(
        controller: QueryController,
        containerEl: HTMLElement,
        plugin: GraphExplorerPlugin
    ) {
        super(controller)
        this.containerEl = containerEl
        this.plugin = plugin
        // 250ms debounce coalesces Obsidian's indexing storms (note creation,
        // metadata cache refreshes) into a single rebuild. 50ms was too tight
        // and let bursts through, causing visible flicker.
        this.debouncedUpdate = debounce(() => {
            this.rebuildGraph()
        }, 250)
    }

    override onload(): void {
        this.buildUI()
        this.initialized = true
    }

    override onunload(): void {
        this.cancelPendingPanelOpen()
        // Write a pending camera save before the view goes away
        this.saveCamera.run()
        this.graphCanvas?.unload()
        this.sidePanel?.unload()
        this.controls?.unload()
        this.zoomControls?.unload()
        this.minimap?.unload()
        this.legend?.unload()
        this.contextMenu?.unload()
        this.graphCanvas = null
        this.sidePanel = null
        this.controls = null
        this.zoomControls = null
        this.minimap = null
        this.legend = null
        this.contextMenu = null
        this.cardLayer?.unload()
        this.cardLayer = null
        this.expandedCards = {}
        this.viewEl?.remove()
        this.viewEl = null
        this.initialized = false
        this.viewStateRestored = false
        this.pendingSelectionRestore = false
        this.applyLeftPanelHidden = null
    }

    override onDataUpdated(): void {
        if (!this.initialized) return
        this.syncConfigToCanvas()
        this.debouncedUpdate()
    }

    // ── UI Setup ──────────────────────────────────────────────

    private buildUI(): void {
        this.viewEl = this.containerEl.createDiv({ cls: 'ge-view' })
        this.viewEl.tabIndex = 0 // focusable for keyboard events

        // Graph canvas area
        const graphArea = this.viewEl.createDiv({ cls: 'ge-graph-area' })

        // Canvas
        this.graphCanvas = new GraphCanvas(graphArea, {
            onNodeClick: (node) => this.handleNodeClick(node),
            onNodeDoubleClick: (node) => this.handleNodeDoubleClick(node),
            onBackgroundClick: () => this.handleBackgroundClick(),
            onNodeRightClick: (node, event) => this.handleNodeRightClick(node, event),
            onBatchSelectionChange: (ids) => this.handleBatchSelectionChange(ids),
            onNodeDragEnd: (nodeId, x, y) => this.handleNodeDragEnd(nodeId, x, y),
            onNodeHover: (node, event) => this.handleNodeHover(node, event),
            onCameraChange: (camera) => this.saveCamera(camera),
            onFrame: () => this.cardLayer?.position()
        })
        this.addChild(this.graphCanvas)

        // Expanded note cards, laid over the canvas and following their nodes
        this.cardLayer = new GraphCardLayer(graphArea, this.app, {
            getNode: (id) => this.graphCanvas?.getNode(id) ?? null,
            toScreen: (x, y) => this.graphCanvas?.toScreen(x, y) ?? null,
            getZoom: () => this.graphCanvas?.getZoom() ?? 1,
            onMove: (id, x, y) => this.graphCanvas?.moveNode(id, x, y),
            onMoveEnd: (id, x, y) => this.handleNodeDragEnd(id, x, y),
            onResizeEnd: (id, size) => this.setCard(id, size),
            onClose: (id) => this.setCard(id, null),
            onOpenInPanel: (id) => void this.moveCardToSidePanel(id)
        })
        this.addChild(this.cardLayer)

        // Left-side panel wrapper (controls + minimap)
        const leftPanel = graphArea.createDiv({ cls: 'ge-left-panel' })

        // One button hides or shows the whole left panel; state is saved per view
        const leftToggle = graphArea.createEl('button', {
            cls: 'ge-left-panel-toggle clickable-icon'
        })
        const applyLeftPanelHidden = (hidden: boolean): void => {
            graphArea.toggleClass('ge-graph-area--left-hidden', hidden)
            setIcon(leftToggle, hidden ? 'panel-left-open' : 'panel-left-close')
            const label = hidden
                ? 'Show graph controls and minimap'
                : 'Hide graph controls and minimap'
            leftToggle.setAttr('aria-label', label)
            leftToggle.setAttr('title', label)
        }
        this.applyLeftPanelHidden = applyLeftPanelHidden
        applyLeftPanelHidden(this.config?.get('leftPanelHidden') === true)
        this.registerDomEvent(leftToggle, 'click', () => {
            const hidden = !graphArea.hasClass('ge-graph-area--left-hidden')
            applyLeftPanelHidden(hidden)
            this.config?.set('leftPanelHidden', hidden)
        })

        // Controls overlay
        this.controls = new GraphControls(leftPanel, {
            onSearchChange: (query) => this.handleSearchChange(query),
            onExploredFilterChange: (filter) => {
                this.config?.set('exploredFilter', filter)
                this.rebuildGraph()
            },
            onBatchToggleExplored: () => void this.handleBatchToggleExplored(),
            onBatchSetMaturity: (maturity) => void this.handleBatchSetMaturity(maturity),
            onNodeSpacingChange: (spacing) => {
                this.graphCanvas?.setNodeSpacing(spacing)
                // Persist per view so the in-graph slider and the Bases option stay in sync
                this.config?.set('nodeSpacing', clampNodeSpacing(spacing))
            },
            onNodeScaleChange: (scale) => {
                this.graphCanvas?.setNodeScale(scale)
                // Persist per view, like node spacing, so reopening keeps it
                this.config?.set('nodeScale', clampDisplayScale(scale))
            },
            onTextScaleChange: (scale) => {
                this.graphCanvas?.setTextScale(scale)
                this.config?.set('textScale', clampDisplayScale(scale))
            },
            onCardFontSizeChange: (size) => {
                this.cardLayer?.setFontSize(size)
                this.config?.set('cardFontSize', clampCardFontSize(size))
            }
        })
        this.addChild(this.controls)

        // Initialize spacing slider from the view config, falling back to the plugin default
        this.controls.setSpacingValue(this.getNodeSpacing())

        // Restore saved filter from config
        const savedFilter = this.config?.get('exploredFilter') as ExploredFilter | undefined
        if (savedFilter && savedFilter !== 'all') {
            this.controls.setFilter(savedFilter)
        }

        // Apply preset if set
        const savedPreset = this.config?.get('preset') as string | undefined
        if (savedPreset) {
            this.activePreset = savedPreset
        }

        // Apply visualization config to canvas
        this.syncConfigToCanvas()

        // Zoom controls
        this.zoomControls = new GraphZoomControls(graphArea, {
            onZoomIn: () => this.graphCanvas?.zoomIn(),
            onZoomOut: () => this.graphCanvas?.zoomOut(),
            onZoomToFit: () => this.graphCanvas?.zoomToFit(),
            onReset: () => this.graphCanvas?.resetView()
        })
        this.addChild(this.zoomControls)

        // Minimap (below controls in left panel)
        this.minimap = new GraphMinimap(leftPanel, {
            getViewport: () => this.graphCanvas?.getViewportState() ?? null,
            onPan: (worldX, worldY) => this.graphCanvas?.panTo(worldX, worldY)
        })
        this.addChild(this.minimap)

        // Color legend
        this.legend = new GraphLegend(graphArea)
        this.addChild(this.legend)

        // Context menu
        this.contextMenu = new GraphContextMenu(graphArea)
        this.addChild(this.contextMenu)

        // Side panel
        this.sidePanel = new GraphSidePanel(this.viewEl, this.app, {
            onToggleExplored: (node) => void this.handleToggleExplored(node),
            onSetMaturity: (node, maturity) => void this.handleSetMaturity(node, maturity),
            onClose: () => this.handleBackgroundClick(),
            onNavigateToNode: (nodeId) => this.handleNavigateToNode(nodeId),
            onCompareClose: () => this.saveComparePath(null)
        })
        this.addChild(this.sidePanel)

        // Keyboard events
        this.registerDomEvent(this.viewEl, 'keydown', (e) => this.handleKeyDown(e))
        // Pressing Mod while a node is hovered opens its preview
        this.registerDomEvent(activeDocument, 'keydown', (e) => {
            if (!isModKeyPress(e, Platform.isMacOS)) return
            const node = this.graphCanvas?.getHoveredNode()
            const pointer = this.graphCanvas?.getLastPointerEvent()
            if (!node || !pointer) return
            this.lastHoverLink = null
            this.triggerHoverPreview(
                node,
                new MouseEvent('mouseover', withModModifier(pointer, Platform.isMacOS))
            )
        })

        // Listen for plugin settings changes
        this.registerDomEvent(
            activeDocument,
            'graph-explorer:settings-changed' as keyof DocumentEventMap,
            () => {
                this.syncConfigToCanvas()
                this.rebuildGraph()
            }
        )

        // Initial render (the saved viewing state is restored on the first render with data)
        this.rebuildGraph()
    }

    /**
     * Reads the saved viewing state once, on the first render that has data.
     * Not in onload: Bases may not have handed over the view config and query
     * results yet, so reads there come back empty and the defaults win.
     */
    private restoreViewState(): void {
        if (this.viewStateRestored || !this.config) return
        this.viewStateRestored = true
        this.applyLeftPanelHidden?.(this.config.get('leftPanelHidden') === true)
        this.expandedCards = parseExpandedCards(this.config.get('expandedCards'))
        this.graphCanvas?.setExpandedCards(this.expandedCards)
        this.graphCanvas?.setInitialCamera(parseCameraState(this.config.get('camera')))
        const savedSelection = parseSelectedNode(this.config.get('selectedNode'))
        if (savedSelection && this.app.vault.getAbstractFileByPath(savedSelection)) {
            this.selectedNodeId = savedSelection
            this.pendingSelectionRestore = true
        }
    }

    /** Re-selects the saved note after the first render; reopens the side panel if it was open. */
    private restoreSelection(): void {
        if (!this.selectedNodeId) return
        const node = this.currentGraphData.nodes.find((n) => n.id === this.selectedNodeId)
        if (!node) {
            this.selectedNodeId = null
            return
        }
        this.graphCanvas?.setSelectedNode(node.id)
        if (this.config?.get('sidePanelOpen') !== true) return
        void this.sidePanel?.showNode(node)
        const comparePath = this.config.get('sidePanelCompare')
        const compareFile =
            typeof comparePath === 'string'
                ? this.app.vault.getAbstractFileByPath(comparePath)
                : null
        if (compareFile instanceof TFile) void this.sidePanel?.showCompare(compareFile)
    }

    /** Opens a note below the side panel's note; opens the panel first when it is closed. */
    private openInLowerPanel(node: GraphNode): void {
        if (!this.sidePanel?.isVisible()) {
            this.selectNode(node.id)
            this.openSidePanel(node)
            return
        }
        const file = this.app.vault.getAbstractFileByPath(node.id)
        if (!(file instanceof TFile)) return
        void this.sidePanel.showCompare(file)
        this.saveComparePath(file.path)
    }

    private saveComparePath(path: string | null): void {
        const value = path ?? ''
        if ((this.config?.get('sidePanelCompare') ?? '') !== value) {
            this.config?.set('sidePanelCompare', value)
        }
    }

    /** Opens the side panel on a note and remembers that it is open. */
    private openSidePanel(node: GraphNode): void {
        void this.sidePanel?.showNode(node)
        if (this.config?.get('sidePanelOpen') !== true) this.config?.set('sidePanelOpen', true)
    }

    private closeSidePanel(): void {
        this.sidePanel?.hide()
        this.saveComparePath(null)
        if (this.config?.get('sidePanelOpen') === true) this.config?.set('sidePanelOpen', false)
    }

    /** Debounced: zoom/pan ends fire in bursts; the Base file is rewritten only on change. */
    private saveCamera = debounce(
        (camera: CameraState) => {
            const serialized = serializeCameraState(camera)
            if (this.config?.get('camera') !== serialized) {
                this.config?.set('camera', serialized)
            }
        },
        1000,
        true
    )

    // ── Config sync ───────────────────────────────────────────

    /**
     * Node spacing comes from the view config (Bases slider option); the plugin
     * setting only provides the default for views that never set it.
     */
    private getNodeSpacing(): number {
        const configured = this.config?.get('nodeSpacing')
        return clampNodeSpacing(
            typeof configured === 'number' ? configured : this.plugin.settings.nodeSpacing
        )
    }

    private syncConfigToCanvas(): void {
        const colorBy = (this.config?.get('colorBy') as string) || 'explored'
        const sizeBy = (this.config?.get('sizeBy') as string) || 'connections'

        this.graphCanvas?.setColorBy(colorBy)
        this.graphCanvas?.setSizeBy(sizeBy)
        const spacing = this.getNodeSpacing()
        this.graphCanvas?.setNodeSpacing(spacing)
        this.controls?.setSpacingValue(spacing)
        const nodeScale = clampDisplayScale(this.config?.get('nodeScale'))
        const textScale = clampDisplayScale(this.config?.get('textScale'))
        this.graphCanvas?.setNodeScale(nodeScale)
        this.graphCanvas?.setTextScale(textScale)
        this.controls?.setScaleValue(nodeScale)
        this.controls?.setTextScaleValue(textScale)
        const cardFontSize = clampCardFontSize(this.config?.get('cardFontSize'))
        this.cardLayer?.setFontSize(cardFontSize)
        this.controls?.setCardFontSizeValue(cardFontSize)
        this.updateLegend()

        // Handle preset changes
        const preset = (this.config?.get('preset') as string) || ''
        if (preset && preset !== this.activePreset) {
            this.applyPreset(preset)
        }
        this.activePreset = preset
    }

    private applyPreset(presetKey: string): void {
        const preset: ViewPreset | undefined = VIEW_PRESETS.find((p) => p.key === presetKey)
        if (!preset) return

        for (const [key, value] of Object.entries(preset.config)) {
            this.config?.set(key, value)
        }

        log(`Applied preset: ${preset.name}`, 'debug')
    }

    // ── Legend ─────────────────────────────────────────────────

    private getColorBy(): string {
        return (this.config?.get('colorBy') as string) || 'explored'
    }

    private updateLegend(): void {
        this.legend?.update(this.getLegendConfig(this.getColorBy()))
    }

    /** One row per value of a generic "color by" property, with its note count */
    private getValueColorSection(colorBy: string): LegendSection {
        const entries: LegendEntry[] = (this.graphCanvas?.getValueColorEntries() ?? []).map(
            (entry) => ({
                color: entry.color,
                label: entry.value,
                detail: String(entry.count)
            })
        )
        return {
            title: `Color — ${colorBy}`,
            entries:
                entries.length > 0
                    ? entries
                    : [{ color: 'rgba(148, 163, 184, 0.7)', label: 'No values' }]
        }
    }

    private getLegendConfig(colorBy: string): LegendConfig {
        const sections: LegendSection[] = []

        // Section 1: Node fill color
        sections.push(this.getColorSection(colorBy))

        // Section 2: Node style
        sections.push({
            title: 'Node style',
            entries: [
                {
                    color: 'rgba(34, 197, 94, 0.9)',
                    label: 'Green border = explored',
                    style: 'ring'
                },
                { color: 'rgba(148, 163, 184, 0.7)', label: 'Hollow = unexplored', style: 'ring' },
                {
                    color: 'rgba(168, 85, 247, 0.9)',
                    label: 'Graduated notes',
                    style: 'dot'
                }
            ]
        })

        return { sections }
    }

    private getColorSection(colorBy: string): LegendSection {
        switch (colorBy) {
            case 'explored':
                return {
                    title: 'Color — explored status',
                    entries: [
                        { color: 'rgba(34, 197, 94, 0.9)', label: 'Explored' },
                        { color: 'rgba(148, 163, 184, 0.7)', label: 'Unexplored' }
                    ]
                }
            case 'confidence':
                return {
                    title: 'Color — confidence',
                    entries: [
                        { color: 'rgba(34, 197, 94, 0.9)', label: 'High' },
                        { color: 'rgba(234, 179, 8, 0.9)', label: 'Medium' },
                        { color: 'rgba(249, 115, 22, 0.9)', label: 'Low' },
                        { color: 'rgba(239, 68, 68, 0.9)', label: 'Uncertain' }
                    ]
                }
            case 'wiki_role':
                return {
                    title: 'Color — wiki role',
                    entries: [
                        { color: 'rgba(59, 130, 246, 0.9)', label: 'Article \u25CB' },
                        { color: 'rgba(168, 85, 247, 0.9)', label: 'Index \u25C7' },
                        { color: 'rgba(20, 184, 166, 0.9)', label: 'Log \u25A1' },
                        { color: 'rgba(234, 179, 8, 0.9)', label: 'Source summary \u2B21' }
                    ]
                }
            case 'maturity':
                return {
                    title: 'Color — maturity',
                    entries: [
                        { color: 'rgba(34, 197, 94, 0.9)', label: 'Mature' },
                        { color: 'rgba(59, 130, 246, 0.9)', label: 'Substantial' },
                        { color: 'rgba(234, 179, 8, 0.9)', label: 'Draft' },
                        { color: 'rgba(249, 115, 22, 0.9)', label: 'Stub' }
                    ]
                }
            case 'created':
                return {
                    title: 'Color — creation date',
                    entries: [
                        { color: 'rgba(34, 197, 94, 0.9)', label: 'Recent' },
                        { color: 'rgba(148, 163, 184, 0.7)', label: 'Older' }
                    ]
                }
            default:
                return this.getValueColorSection(colorBy)
        }
    }

    // ── Graph data ────────────────────────────────────────────

    private rebuildGraph(): void {
        if (!this.data) return
        this.restoreViewState()
        const entries = this.data.data
        const exploredProperty = (this.config?.get('exploredProperty') as string) || 'explored'
        const showExternal = (this.config?.get('showExternalNodes') as boolean) || false
        const showFrontier = (this.config?.get('showFrontier') as boolean) || false
        const exploredFilter = (this.controls?.getFilter() as ExploredFilter) || 'all'
        const maturityProperty = (this.config?.get('maturityProperty') as string) || 'maturity'
        const graduatedNotesProperty =
            (this.config?.get('graduatedNotesProperty') as string) || 'graduated_notes'
        const edgeSource = (this.config?.get('edgeSource') as EdgeSource) || 'all'

        this.currentGraphData = buildGraphData(
            entries,
            this.app.metadataCache,
            exploredProperty,
            showExternal,
            exploredFilter,
            showFrontier,
            maturityProperty,
            graduatedNotesProperty,
            edgeSource
        )

        if (this.selectedNodeId && this.isRevealSelectedNeighborsOn()) {
            this.currentGraphData = revealNeighborhood(
                this.currentGraphData,
                this.selectedNodeId,
                this.app.metadataCache,
                { edgeSource, exploredProperty, maturityProperty, graduatedNotesProperty }
            )
        }

        if (this.currentGraphData.nodes.length === 0) {
            if (!this.viewEl?.querySelector('.ge-empty-state')) {
                this.viewEl?.createDiv({
                    cls: 'ge-empty-state',
                    text: 'No notes to display'
                })
            }
            return
        }
        this.viewEl?.querySelector('.ge-empty-state')?.remove()

        const positions = this.getSavedPositions()
        this.pruneStalePositions(positions)
        this.graphCanvas?.setSavedPositions(positions)
        this.graphCanvas?.setData(this.currentGraphData)
        // Values of the "color by" property may have changed
        this.updateLegend()

        // Update stats
        const stats = this.computeStats()
        this.controls?.updateStats(stats)

        // Update side panel with current graph node paths
        const nodePaths = new Set<string>(
            this.currentGraphData.nodes.filter((n) => !n.frontier).map((n) => n.id)
        )
        this.sidePanel?.setGraphNodePaths(nodePaths)
        this.cardLayer?.sync(this.expandedCards)

        // Apply search highlight if active
        if (this.searchQuery) {
            this.applySearchHighlight(this.searchQuery)
        }

        if (this.pendingSelectionRestore) {
            this.pendingSelectionRestore = false
            this.restoreSelection()
        }
    }

    private computeStats(): GraphStats {
        const nodes = this.currentGraphData.nodes
        const nonExternal = nodes.filter((n) => !n.external && !n.frontier)
        const exploredCount = nonExternal.filter((n) => n.explored).length
        const unexploredCount = nonExternal.filter((n) => !n.explored).length

        const confidenceDistribution: Record<ConfidenceLevel, number> = {
            high: 0,
            medium: 0,
            low: 0,
            uncertain: 0,
            unknown: 0
        }
        const roleDistribution: Record<WikiRole, number> = {
            article: 0,
            index: 0,
            log: 0,
            source_summary: 0,
            unknown: 0
        }
        const maturityDistribution: Record<MaturityLevel, number> = {
            stub: 0,
            draft: 0,
            substantial: 0,
            mature: 0,
            unknown: 0
        }
        let graduatedCount = 0

        for (const n of nonExternal) {
            confidenceDistribution[n.confidence]++
            roleDistribution[n.wikiRole]++
            maturityDistribution[n.maturity]++
            if (n.graduatedNotes.length > 0) graduatedCount++
        }

        const frontierCount = nodes.filter((n) => n.frontier).length
        const total = nonExternal.length
        const coveragePercent = total > 0 ? Math.round((exploredCount / total) * 100) : 0

        return {
            totalNodes: nodes.length,
            totalLinks: this.currentGraphData.links.length,
            exploredCount,
            unexploredCount,
            confidenceDistribution,
            roleDistribution,
            maturityDistribution,
            graduatedCount,
            frontierCount,
            coveragePercent
        }
    }

    // ── Node events ───────────────────────────────────────────

    /**
     * Selects the note; the side panel follows only when it is already open.
     * Clicking the already selected note again opens the panel, after a short
     * wait so the first click of a double-click (expand as card) does not.
     */
    private handleNodeClick(node: GraphNode): void {
        this.contextMenu?.hide()
        this.cancelPendingPanelOpen()
        const wasSelected = this.selectedNodeId === node.id
        this.selectNode(node.id)
        if (this.sidePanel?.isVisible()) {
            // The note that last had the cursor follows the click
            const file = node.frontier ? null : this.app.vault.getAbstractFileByPath(node.id)
            if (this.sidePanel.isLowerActive() && file instanceof TFile) {
                void this.sidePanel.showCompare(file)
                this.saveComparePath(file.path)
            } else {
                void this.sidePanel.showNode(node)
            }
        } else if (wasSelected) {
            this.pendingPanelOpen = window.setTimeout(() => {
                this.pendingPanelOpen = null
                if (this.selectedNodeId === node.id) this.openSidePanel(node)
            }, 500)
        }
    }

    private cancelPendingPanelOpen(): void {
        if (this.pendingPanelOpen !== null) {
            window.clearTimeout(this.pendingPanelOpen)
            this.pendingPanelOpen = null
        }
    }

    // ── Hover preview (Page preview core plugin) ──────────────

    private handleNodeHover(node: GraphNode | null, event: MouseEvent | null): void {
        const popover = this.hoverPopover as unknown as PopoverLike | null
        if (!node) {
            setPopoverOnTarget(popover, false)
            return
        }
        if (node.frontier || !event) return
        this.triggerHoverPreview(node, event)
    }

    /**
     * Same flow as the core graph: hover-link with no target element. Page
     * preview decides whether Mod is required (Settings → Page preview).
     */
    private triggerHoverPreview(node: GraphNode, event: MouseEvent): void {
        if (node.frontier) return
        const popover = this.hoverPopover as unknown as PopoverLike | null
        if (this.lastHoverLink === node.id && isPopoverShown(popover)) {
            setPopoverOnTarget(popover, true)
            return
        }
        this.lastHoverLink = node.id
        this.app.workspace.trigger('hover-link', {
            event,
            source: GRAPH_EXPLORER_VIEW_TYPE,
            hoverParent: this,
            targetEl: null,
            linktext: node.id,
            sourcePath: ''
        })
    }

    private isRevealSelectedNeighborsOn(): boolean {
        return this.config?.get('revealSelectedNeighbors') !== false
    }

    /** Selects a node (or clears with null) and re-reveals neighbors outside the base. */
    private selectNode(nodeId: string | null): void {
        const changed = this.selectedNodeId !== nodeId
        this.selectedNodeId = nodeId
        if (changed) this.config?.set('selectedNode', nodeId)
        if (changed && this.isRevealSelectedNeighborsOn()) this.rebuildGraph()
        this.graphCanvas?.setSelectedNode(nodeId)
    }

    /** Double-click expands the note into a card on the graph (or collapses it). */
    private handleNodeDoubleClick(node: GraphNode): void {
        this.cancelPendingPanelOpen()
        if (node.frontier) return
        this.setCard(node.id, node.id in this.expandedCards ? null : DEFAULT_CARD_SIZE)
    }

    /** Card header button: show the note in the side panel and collapse its card. */
    private async moveCardToSidePanel(path: string): Promise<void> {
        const node = this.graphCanvas?.getNode(path)
        if (!node) return
        // Save the card's edits first so the panel's editor loads them
        await this.cardLayer?.flushCard(path)
        this.setCard(path, null)
        this.cancelPendingPanelOpen()
        this.selectNode(node.id)
        this.openSidePanel(node)
    }

    private openInTab(path: string): void {
        const file = this.app.vault.getAbstractFileByPath(path)
        if (file instanceof TFile) {
            void this.app.workspace.getLeaf('tab').openFile(file)
        }
    }

    /** Expands (size) or collapses (null) a card, then saves the set of cards in the view config. */
    private setCard(path: string, size: CardSize | null): void {
        const next = { ...this.expandedCards }
        if (size) next[path] = size
        else delete next[path]
        this.expandedCards = next
        this.graphCanvas?.setExpandedCards(next)
        this.cardLayer?.sync(next)
        this.config?.set('expandedCards', serializeExpandedCards(next))
    }

    private handleBackgroundClick(): void {
        this.contextMenu?.hide()
        this.selectNode(null)
        this.closeSidePanel()
    }

    private handleNavigateToNode(nodeId: string): void {
        const node = this.currentGraphData.nodes.find((n) => n.id === nodeId)
        if (!node) return
        this.selectNode(node.id)
        this.graphCanvas?.centerOnNode(node)
        this.openSidePanel(node)
    }

    private async handleToggleExplored(node: GraphNode): Promise<void> {
        if (node.frontier) return
        const file = this.app.vault.getAbstractFileByPath(node.id)
        if (!(file instanceof TFile)) return

        const exploredProperty = (this.config?.get('exploredProperty') as string) || 'explored'
        const newExplored = !node.explored

        await setNoteExplored(this.app, file, exploredProperty, newExplored)

        // Update graph node and side panel immediately (optimistic)
        node.explored = newExplored
        this.sidePanel?.updateExploredState(newExplored)

        log(`Toggled explored: ${node.name} -> ${String(newExplored)}`, 'debug')
    }

    private async handleSetMaturity(node: GraphNode, maturity: MaturityLevel): Promise<void> {
        if (node.frontier || node.external) return
        const file = this.app.vault.getAbstractFileByPath(node.id)
        if (!(file instanceof TFile)) return

        const maturityProperty = (this.config?.get('maturityProperty') as string) || 'maturity'
        await setNoteMaturity(this.app, file, maturityProperty, maturity)

        // Optimistic update
        node.maturity = maturity
        this.sidePanel?.updateMaturityState(maturity)

        log(`Set maturity: ${node.name} -> ${maturity}`, 'debug')
    }

    // ── Context menu ──────────────────────────────────────────

    private handleNodeRightClick(node: GraphNode, event: MouseEvent): void {
        const graphArea = this.viewEl?.querySelector('.ge-graph-area')
        if (!graphArea) return
        const rect = graphArea.getBoundingClientRect()
        const x = event.clientX - rect.left
        const y = event.clientY - rect.top

        const actions = this.getContextMenuActions(node)
        this.contextMenu?.show(node, x, y, actions)
    }

    private getContextMenuActions(node: GraphNode): ContextMenuAction[] {
        const actions: ContextMenuAction[] = []

        actions.push({
            label: 'Open in side panel',
            icon: '\u25E8',
            callback: () => {
                this.selectNode(node.id)
                this.openSidePanel(node)
            }
        })

        if (!node.frontier) {
            actions.push({
                label: 'Open below in side panel',
                icon: '\u2B13',
                callback: () => this.openInLowerPanel(node)
            })
            actions.push({
                label: 'Open in new tab',
                icon: '\u2197',
                callback: () => this.openInTab(node.id)
            })
            const expanded = node.id in this.expandedCards
            actions.push({
                label: expanded ? 'Collapse card' : 'Expand as card',
                icon: expanded ? '\u2715' : '\u25A2',
                callback: () => this.setCard(node.id, expanded ? null : DEFAULT_CARD_SIZE)
            })
        }

        if (!node.external && !node.frontier) {
            actions.push({
                label: node.explored ? 'Mark as unexplored' : 'Mark as explored',
                icon: node.explored ? '\u25CB' : '\u2713',
                callback: () => void this.handleToggleExplored(node)
            })
        }

        if (!node.external && !node.frontier) {
            const maturityLevels: { value: MaturityLevel; label: string; icon: string }[] = [
                { value: 'stub', label: 'Set maturity: Stub', icon: '\u{1F7E0}' },
                { value: 'draft', label: 'Set maturity: Draft', icon: '\u{1F7E1}' },
                { value: 'substantial', label: 'Set maturity: Substantial', icon: '\u{1F535}' },
                { value: 'mature', label: 'Set maturity: Mature', icon: '\u{1F7E2}' }
            ]
            for (const level of maturityLevels) {
                actions.push({
                    label: level.label,
                    icon: level.icon,
                    callback: () => void this.handleSetMaturity(node, level.value),
                    disabled: node.maturity === level.value
                })
            }
        }

        if (!node.frontier) {
            actions.push({
                label: 'Copy wikilink',
                icon: '\u{1F4CB}',
                callback: () => {
                    const name = node.name
                    void navigator.clipboard.writeText(`[[${name}]]`)
                }
            })
        }

        const isBatchSelected = this.graphCanvas?.getBatchSelectedIds().has(node.id) ?? false
        actions.push({
            label: isBatchSelected ? 'Remove from selection' : 'Add to selection',
            icon: isBatchSelected ? '\u2212' : '\u002B',
            callback: () => this.graphCanvas?.toggleBatchSelect(node.id)
        })

        return actions
    }

    // ── Batch operations ──────────────────────────────────────

    private handleBatchSelectionChange(selectedIds: Set<string>): void {
        this.controls?.setBatchSelectionCount(selectedIds.size)
    }

    // ── Node positions ───────────────────────────────────────

    private handleNodeDragEnd(nodeId: string, x: number, y: number): void {
        const positions = this.getSavedPositions()
        positions[nodeId] = { x, y }
        this.config?.set('nodePositions', JSON.stringify(positions))
    }

    private getSavedPositions(): Record<string, { x: number; y: number }> {
        const raw = this.config?.get('nodePositions') as string | undefined
        if (!raw) return {}
        try {
            return JSON.parse(raw) as Record<string, { x: number; y: number }>
        } catch {
            return {}
        }
    }

    private pruneStalePositions(positions: Record<string, { x: number; y: number }>): void {
        let changed = false
        for (const path of Object.keys(positions)) {
            if (!this.app.vault.getAbstractFileByPath(path)) {
                delete positions[path]
                changed = true
            }
        }
        if (changed) {
            this.config?.set('nodePositions', JSON.stringify(positions))
        }
    }

    private async handleBatchToggleExplored(): Promise<void> {
        const selectedIds = this.graphCanvas?.getBatchSelectedIds()
        if (!selectedIds || selectedIds.size === 0) return

        const exploredProperty = (this.config?.get('exploredProperty') as string) || 'explored'

        for (const nodeId of selectedIds) {
            const node = this.currentGraphData.nodes.find((n) => n.id === nodeId)
            if (!node || node.frontier || node.external) continue

            const file = this.app.vault.getAbstractFileByPath(nodeId)
            if (!(file instanceof TFile)) continue

            const newExplored = !node.explored
            await setNoteExplored(this.app, file, exploredProperty, newExplored)
        }

        this.graphCanvas?.clearBatchSelection()
        log(`Batch toggled explored for ${selectedIds.size} nodes`, 'debug')
    }

    private async handleBatchSetMaturity(maturity: MaturityLevel): Promise<void> {
        const selectedIds = this.graphCanvas?.getBatchSelectedIds()
        if (!selectedIds || selectedIds.size === 0) return

        const maturityProperty = (this.config?.get('maturityProperty') as string) || 'maturity'

        for (const nodeId of selectedIds) {
            const node = this.currentGraphData.nodes.find((n) => n.id === nodeId)
            if (!node || node.frontier || node.external) continue

            const file = this.app.vault.getAbstractFileByPath(nodeId)
            if (!(file instanceof TFile)) continue

            await setNoteMaturity(this.app, file, maturityProperty, maturity)
            node.maturity = maturity
        }

        this.graphCanvas?.clearBatchSelection()
        log(`Batch set maturity to ${maturity} for ${selectedIds.size} nodes`, 'debug')
    }

    // ── Keyboard navigation ───────────────────────────────────

    private handleKeyDown(e: KeyboardEvent): void {
        // Don't capture when typing in search
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
            return
        }
        // Don't capture while typing in the side panel editor (Tab, Enter, arrows, Escape)
        if (e.target instanceof HTMLElement && e.target.closest('.ge-side-panel, .ge-card')) {
            return
        }

        switch (e.key) {
            case 'Tab':
                e.preventDefault()
                if (e.shiftKey) {
                    this.graphCanvas?.focusPrevNode()
                } else {
                    this.graphCanvas?.focusNextNode()
                }
                break
            case 'Enter':
                e.preventDefault()
                if (e.shiftKey) {
                    this.graphCanvas?.toggleBatchSelectFocused()
                } else {
                    this.graphCanvas?.selectFocusedNode()
                }
                break
            case 'Escape':
                e.preventDefault()
                this.contextMenu?.hide()
                this.handleBackgroundClick()
                this.graphCanvas?.clearFocus()
                this.graphCanvas?.clearBatchSelection()
                break
            case 'ArrowUp':
            case 'ArrowDown':
            case 'ArrowLeft':
            case 'ArrowRight':
                e.preventDefault()
                this.graphCanvas?.focusConnectedNode(e.key)
                break
        }
    }

    // ── Search ────────────────────────────────────────────────

    private handleSearchChange(query: string): void {
        this.searchQuery = query
        this.applySearchHighlight(query)
    }

    private applySearchHighlight(query: string): void {
        if (!query.trim()) {
            this.graphCanvas?.setSearchHighlight(new Set())
            return
        }
        const lowerQuery = query.toLowerCase()
        const matchIds = new Set<string>(
            this.currentGraphData.nodes
                .filter((n) => n.name.toLowerCase().includes(lowerQuery))
                .map((n) => n.id)
        )
        this.graphCanvas?.setSearchHighlight(matchIds)
    }
}
