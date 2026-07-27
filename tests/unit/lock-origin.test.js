import { describe, it, expect } from 'vitest';
import { readLockViewportOrigin } from '../../src/events/lock-origin.js';

describe('readLockViewportOrigin', () => {
    it('returns the clamped normalized origin when present', () => {
        expect(readLockViewportOrigin({ viewportOrigin: { x: 0.25, y: 0.8 } }))
            .toEqual({ x: 0.25, y: 0.8 });
        expect(readLockViewportOrigin({ viewportOrigin: { x: -0.4, y: 1.7 } }))
            .toEqual({ x: 0, y: 1 }); // clamped into [0,1]
    });

    it('returns null when the field is absent or invalid', () => {
        expect(readLockViewportOrigin({})).toBeNull();
        expect(readLockViewportOrigin(null)).toBeNull();
        expect(readLockViewportOrigin(undefined)).toBeNull();
        expect(readLockViewportOrigin({ viewportOrigin: null })).toBeNull();
        expect(readLockViewportOrigin({ viewportOrigin: { x: 0.5 } })).toBeNull();
        expect(readLockViewportOrigin({ viewportOrigin: { x: Number.NaN, y: 0.5 } })).toBeNull();
        expect(readLockViewportOrigin({ viewportOrigin: { x: 0.5, y: Infinity } })).toBeNull();
    });
});
