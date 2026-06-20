import { describe, expect, it } from 'vitest';
import { resolveChapterFramingForProgress } from './OdysseyCameraController.js';

describe('OdysseyCameraController chapter framing', () => {
    it('levels the Sky Drift horizon and drops to the aurora canopy, then cranes to space', () => {
        const entry = resolveChapterFramingForProgress(5, 0);
        const mid = resolveChapterFramingForProgress(5, 0.5);
        const exit = resolveChapterFramingForProgress(5, 1);

        // Composition overhaul: the near-vertical Ch5 spline rolled the horizon and craned
        // the camera up at empty sky. Entry/mid level the horizon (worldUp) and kill the
        // climb up-push (climbScale 0) so the aim drops to the peak+aurora HORIZON.
        expect(entry.worldUp).toBeGreaterThan(0.5);
        expect(mid.worldUp).toBeGreaterThan(0.5);
        expect(entry.climbScale).toBeCloseTo(0, 5);
        expect(mid.climbScale).toBeCloseTo(0, 5);
        // Both beats aim DOWN to the horizon (negative lookUp), and the aurora-canopy hero
        // beat (mid) is the most level of the chapter — it aims lower than the entry.
        expect(mid.lookUp).toBeLessThan(0);
        expect(mid.lookUp).toBeLessThan(entry.lookUp);
        expect(entry.lookRight).toBeLessThan(mid.lookRight);
        expect(entry.camForward).toBeLessThan(mid.camForward);

        // Exit cranes UP for the Sky→Space hand-off and relaxes the roll-lock as the
        // peaks fall away into the void.
        expect(exit.lookUp).toBeGreaterThan(mid.lookUp);
        expect(exit.lookForward).toBeGreaterThan(mid.lookForward);
        expect(exit.camUp).toBeGreaterThan(mid.camUp);
        expect(exit.worldUp).toBeLessThan(entry.worldUp);
    });
});
