import { describe, expect, it } from 'vitest';

import { VEIL_RADIAL_FEATHER } from './chapter-threshold-director.tsl.js';

// In-game (2026-08): a hard-edged bright RECTANGLE hung in the middle of Chapter 4's hero
// massif, reading as a transparent window cut through the mountain. It was the breach
// veil's own quad border. The veil is an additive PlaneGeometry whose alpha is feathered
// by r = length(uv * 2 - 1); the ramp ended at r = 1.28, but the quad's boundary sits at
// r = 1.0 (edge midpoints) through r = 1.414 (corners) — so the whole edge was still
// carrying 59% of the veil's weight and the quad drew its own outline. It only became
// obvious once the massif behind it stopped being semi-transparent.

describe('breach veil radial feather', () => {
    const smoothstep = (a, b, x) => {
        const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
    };
    const weight = (r) => 1 - smoothstep(VEIL_RADIAL_FEATHER.start, VEIL_RADIAL_FEATHER.end, r);

    it('reaches zero by the quad boundary', () => {
        // r = 1 is the closest the boundary ever comes to the centre (the edge midpoints).
        expect(VEIL_RADIAL_FEATHER.end).toBeLessThanOrEqual(1.0);
        expect(VEIL_RADIAL_FEATHER.start).toBeLessThan(VEIL_RADIAL_FEATHER.end);
    });

    it('carries no weight anywhere on the quad edge', () => {
        // Walk the full boundary of the [-1, 1] square, not just the midpoints.
        for (let i = 0; i <= 200; i += 1) {
            const t = -1 + (i / 100);
            for (const [x, y] of [[1, t], [-1, t], [t, 1], [t, -1]]) {
                expect(weight(Math.hypot(x, y))).toBe(0);
            }
        }
    });

    it('keeps the veil core at full weight', () => {
        expect(weight(0)).toBe(1);
        expect(weight(VEIL_RADIAL_FEATHER.start)).toBe(1);
        expect(weight(0.9)).toBeGreaterThan(0);
        expect(weight(0.9)).toBeLessThan(1);
    });

    it('would have failed against the 1.28 ramp it replaced', () => {
        // Falsification: the shipped bug left 59% of the veil's weight on the edge.
        const old = 1 - smoothstep(0.78, 1.28, 1.0);
        expect(old).toBeGreaterThan(0.5);
    });
});
