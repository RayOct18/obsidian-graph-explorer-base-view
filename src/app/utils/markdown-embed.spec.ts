import { describe, test, expect, mock } from 'bun:test'
import type { App, TFile } from 'obsidian'
import {
    canEmbedEditor,
    createMarkdownEmbed,
    flushMarkdownEmbed,
    isMarkdownEmbed,
    type MarkdownEmbed
} from './markdown-embed'

const file = { path: 'Tasks/A.md', extension: 'md' } as unknown as import('obsidian').TFile
const containerEl = {} as HTMLElement

function fakeEmbed(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        editable: false,
        dirty: false,
        text: '',
        loadFile: () => Promise.resolve(),
        showEditor: () => {},
        showPreview: () => {},
        save: () => Promise.resolve(),
        load: () => {},
        unload: () => {},
        ...overrides
    }
}

function appWith(registry: unknown): App {
    return { embedRegistry: registry } as unknown as App
}

describe('isMarkdownEmbed', () => {
    test('accepts an object with every required method', () => {
        expect(isMarkdownEmbed(fakeEmbed())).toBe(true)
    })

    test('rejects when a required method is missing', () => {
        expect(isMarkdownEmbed(fakeEmbed({ showEditor: undefined }))).toBe(false)
    })

    test('rejects non-objects', () => {
        expect(isMarkdownEmbed(null)).toBe(false)
        expect(isMarkdownEmbed('embed')).toBe(false)
    })
})

describe('canEmbedEditor', () => {
    test('false when the app has no embed registry', () => {
        expect(canEmbedEditor({} as App, file)).toBe(false)
    })

    test('false when the registry has no creator for the file', () => {
        expect(canEmbedEditor(appWith({ getEmbedCreator: () => null }), file)).toBe(false)
    })

    test('true when a creator exists', () => {
        expect(canEmbedEditor(appWith({ getEmbedCreator: () => () => fakeEmbed() }), file)).toBe(
            true
        )
    })
})

describe('createMarkdownEmbed', () => {
    test('passes the file as link and source path and marks the embed editable', () => {
        const creator = mock((context: Record<string, unknown>, f: TFile, subpath: string) => {
            expect(context['linktext']).toBe('Tasks/A.md')
            expect(context['sourcePath']).toBe('Tasks/A.md')
            expect(context['containerEl']).toBe(containerEl)
            expect(f).toBe(file)
            expect(subpath).toBe('')
            return fakeEmbed()
        })
        const embed = createMarkdownEmbed(
            appWith({ getEmbedCreator: () => creator }),
            containerEl,
            file
        )
        expect(creator).toHaveBeenCalledTimes(1)
        expect(embed?.editable).toBe(true)
        expect(embed?.useLocalPropertiesFoldState).toBe(true)
    })

    test('returns null when the creator returns something unexpected', () => {
        const embed = createMarkdownEmbed(
            appWith({ getEmbedCreator: () => () => ({ notAnEmbed: true }) }),
            containerEl,
            file
        )
        expect(embed).toBeNull()
    })

    test('returns null without a registry', () => {
        expect(createMarkdownEmbed({} as App, containerEl, file)).toBeNull()
    })
})

describe('flushMarkdownEmbed', () => {
    test('saves the current text and cancels the pending debounced save when dirty', async () => {
        const save = mock(() => Promise.resolve())
        const cancel = mock(() => {})
        const embed = fakeEmbed({
            dirty: true,
            text: 'edited',
            save,
            requestSave: { cancel }
        }) as unknown as MarkdownEmbed
        await flushMarkdownEmbed(embed)
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(save).toHaveBeenCalledWith('edited', true)
    })

    test('does nothing when there are no pending edits', async () => {
        const save = mock(() => Promise.resolve())
        const embed = fakeEmbed({ dirty: false, save }) as unknown as MarkdownEmbed
        await flushMarkdownEmbed(embed)
        expect(save).not.toHaveBeenCalled()
    })
})
