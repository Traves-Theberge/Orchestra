import { describe, expect, it } from 'vitest'
import { RECONNECT_BASE_MS, RECONNECT_MAX_ATTEMPTS, RECONNECT_MAX_MS, reconnectDelay, shouldReconnect } from './terminal-reconnect'

describe('reconnectDelay', () => {
    it('backs off exponentially up to the cap, then gives up', () => {
        expect(reconnectDelay(0)).toBe(RECONNECT_BASE_MS)
        expect(reconnectDelay(1)).toBe(RECONNECT_BASE_MS * 2)
        expect(reconnectDelay(RECONNECT_MAX_ATTEMPTS - 1)).toBeLessThanOrEqual(RECONNECT_MAX_MS)
        expect(reconnectDelay(RECONNECT_MAX_ATTEMPTS)).toBeNull()
        expect(reconnectDelay(-1)).toBeNull()
    })
})

describe('shouldReconnect', () => {
    it('retries abnormal closes of sockets that had connected', () => {
        expect(shouldReconnect({ wasOpen: true, disposed: false, code: 1006 })).toBe(true)
    })
    it('never retries rejected upgrades, deliberate closes or disposed sessions', () => {
        expect(shouldReconnect({ wasOpen: false, disposed: false, code: 1006 })).toBe(false)
        expect(shouldReconnect({ wasOpen: true, disposed: true, code: 1006 })).toBe(false)
        expect(shouldReconnect({ wasOpen: true, disposed: false, code: 1000 })).toBe(false)
        expect(shouldReconnect({ wasOpen: true, disposed: false, code: 1008 })).toBe(false)
    })
})
