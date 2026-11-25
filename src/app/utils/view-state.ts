/**
 * Last viewing state of a Graph Explorer view, saved in the Base view config
 * so reopening returns to the same zoom, center and selected note.
 */

/** Zoom factor and graph-space center point */
export interface CameraState {
    k: number
    x: number
    y: number
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

/** Reads a saved camera (JSON string from the config); null when missing or invalid. */
export function parseCameraState(raw: unknown): CameraState | null {
    if (typeof raw !== 'string' || raw === '') return null
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return null
    }
    if (typeof parsed !== 'object' || parsed === null) return null
    const { k, x, y } = parsed as Record<string, unknown>
    if (!isFiniteNumber(k) || k <= 0 || !isFiniteNumber(x) || !isFiniteNumber(y)) return null
    return { k, x, y }
}

/** Serializes a camera, rounded so tiny jitter does not rewrite the Base file. */
export function serializeCameraState(camera: CameraState): string {
    return JSON.stringify({
        k: Math.round(camera.k * 1000) / 1000,
        x: Math.round(camera.x),
        y: Math.round(camera.y)
    })
}

/** Reads the saved selected note path; null when missing. */
export function parseSelectedNode(raw: unknown): string | null {
    return typeof raw === 'string' && raw !== '' && !raw.startsWith('frontier:') ? raw : null
}
