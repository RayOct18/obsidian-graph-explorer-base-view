import type { App, Component, TFile } from 'obsidian'

/**
 * Typed view of Obsidian's internal markdown embed (the editor core Canvas
 * uses for file cards). Not part of the public API: every access goes through
 * the runtime guards below, so a future Obsidian change disables editing
 * instead of throwing.
 */
export interface MarkdownEmbed extends Component {
    editable: boolean
    /**
     * When false (Obsidian's default for embeds) the properties block uses one
     * collapse state shared by every embed, which starts collapsed. When true it
     * follows the note's own fold state, like the note opened in a tab.
     */
    useLocalPropertiesFoldState?: boolean
    dirty: boolean
    text: string
    editMode?: unknown
    loadFile(): Promise<void>
    showEditor(): void
    showPreview(): void
    save(text: string, clean?: boolean): unknown
    requestSave?: { cancel?: () => void }
}

interface EmbedContext {
    app: App
    containerEl: HTMLElement
    linktext: string
    sourcePath: string
    depth: number
    state: Record<string, unknown>
}

type EmbedCreator = (context: EmbedContext, file: TFile, subpath: string) => unknown

interface EmbedRegistryLike {
    getEmbedCreator?: (file: TFile) => unknown
}

function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
    return typeof value === 'function'
}

/** Returns the markdown embed creator for `file`, or null when the internal API is missing. */
export function getMarkdownEmbedCreator(app: App, file: TFile): EmbedCreator | null {
    const registry = (app as unknown as { embedRegistry?: EmbedRegistryLike }).embedRegistry
    if (!registry || !isFunction(registry.getEmbedCreator)) return null
    const creator: unknown = registry.getEmbedCreator(file)
    return isFunction(creator) ? (creator as EmbedCreator) : null
}

/** True when `value` exposes every member the side panel editor relies on. */
export function isMarkdownEmbed(value: unknown): value is MarkdownEmbed {
    if (typeof value !== 'object' || value === null) return false
    const v = value as Record<string, unknown>
    return (
        isFunction(v['loadFile']) &&
        isFunction(v['showEditor']) &&
        isFunction(v['showPreview']) &&
        isFunction(v['save']) &&
        isFunction(v['load']) &&
        isFunction(v['unload'])
    )
}

/** Whether the running Obsidian exposes an editable markdown embed for `file`. */
export function canEmbedEditor(app: App, file: TFile): boolean {
    return getMarkdownEmbedCreator(app, file) !== null
}

/**
 * Creates an editable markdown embed for `file` inside `containerEl`.
 * The caller owns the returned component (addChild / removeChild).
 */
export function createMarkdownEmbed(
    app: App,
    containerEl: HTMLElement,
    file: TFile
): MarkdownEmbed | null {
    const creator = getMarkdownEmbedCreator(app, file)
    if (!creator) return null
    const embed = creator(
        {
            app,
            containerEl,
            linktext: file.path,
            sourcePath: file.path,
            depth: 0,
            state: {}
        },
        file,
        ''
    )
    if (!isMarkdownEmbed(embed)) return null
    embed.editable = true
    // Show properties expanded unless the note itself has them folded
    embed.useLocalPropertiesFoldState = true
    return embed
}

/**
 * Writes pending edits now instead of waiting for the embed's 2 s debounced save.
 * Resolves once the write finishes.
 */
export async function flushMarkdownEmbed(embed: MarkdownEmbed): Promise<void> {
    if (!embed.dirty) return
    embed.requestSave?.cancel?.()
    await embed.save(embed.text, true)
}
