export const RECONNECT_BASE_MS = 500
export const RECONNECT_MAX_MS = 8000
export const RECONNECT_MAX_ATTEMPTS = 6

/** Exponential backoff for the nth (0-based) reconnect attempt, or null once attempts are exhausted. */
export function reconnectDelay(attempt: number): number | null {
    if (!Number.isInteger(attempt) || attempt < 0 || attempt >= RECONNECT_MAX_ATTEMPTS) return null
    return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt)
}

/**
 * Auth/validation failures reach the client as an HTTP rejection of the upgrade (close code 1006 with no
 * open), so only retry sockets that were open at least once, and never after a deliberate close.
 */
export function shouldReconnect(info: { wasOpen: boolean; disposed: boolean; code: number }): boolean {
    if (info.disposed || !info.wasOpen) return false
    return info.code !== 1000 && info.code !== 1008 && info.code !== 1011
}
