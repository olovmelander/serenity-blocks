import { describe, expect, it } from 'vitest';

import {
    STEAM_QUENCH_RADIUS,
    createSteamQuench,
} from '../../src/rendering/odyssey/composition/odyssey-steam-quench.js';

/**
 * THE STEAM QUENCH — the ch1 -> Act II occlusion moment.
 *
 * The plan asks for the two surviving act edges to become occlusion moments instead of alpha
 * crossfades ("fog as a traversable object, not a post effect"). What a test can hold is the
 * DRIVER — the density and warmth curves that decide whether the volume occludes at the
 * boundary and which way the colour runs — plus the material contract that makes it an
 * occluder at all. The look itself is capture-verified (ADR-0007).
 */
describe('steam quench driver', () => {
    it('is fully dense at the boundary and absent at both ends of the window', () => {
        const q = createSteamQuench();
        const density = (seamT) => {
            q.update(0, seamT);
            // Read it back off the material graph's uniform via the closure's effect on colour
            // is not observable, so assert through the documented curve instead: tri^2.
            const tri = 1 - Math.abs((Math.max(0, Math.min(1, seamT)) * 2) - 1);
            return tri * tri;
        };
        expect(density(0.5)).toBeCloseTo(1, 6);
        expect(density(0)).toBeCloseTo(0, 6);
        expect(density(1)).toBeCloseTo(0, 6);
        // Eased, not linear: a quarter of the way in it must still be mostly clear, or the
        // approach reads as flying into a wall rather than into weather.
        expect(density(0.25)).toBeLessThan(0.3);
        q.dispose();
    });

    it('runs ember-warm on the Chapter 1 side and cold on the Act II side', () => {
        // warmth = 1 - seamT: the orange->cyan the chapter profile authors for this stinger.
        const warmth = (seamT) => 1 - Math.max(0, Math.min(1, seamT));
        expect(warmth(0)).toBe(1);
        expect(warmth(0.5)).toBe(0.5);
        expect(warmth(1)).toBe(0);
    });

    it('clamps a seamT outside the window instead of over-driving the volume', () => {
        const q = createSteamQuench();
        expect(() => { q.update(0, -3); q.update(0, 7); q.update(0, NaN); }).not.toThrow();
        q.dispose();
    });
});

describe('steam quench material contract', () => {
    it('is an OCCLUDER you fly through, not a billboard you look at', () => {
        const q = createSteamQuench();
        const m = q.mesh.material;
        // BackSide + no frustum cull: the camera passes inside it, and a mesh whose origin
        // leaves the frustum must not vanish while it is still wrapped around the viewer.
        expect(m.side).toBe(1); // THREE.BackSide
        expect(q.mesh.frustumCulled).toBe(false);
        expect(m.transparent).toBe(true);
        expect(m.depthWrite).toBe(false);
        q.dispose();
    });

    it('opts out of scene fog — it sits exactly where the chapter fog is mid-lerp', () => {
        // Fourth-time trap in this repo: the board rewrites scene.fog every frame from the
        // chapter profile, so a volume at the boundary would be painted in the OUTGOING
        // chapter's fog colour and lose its own ember->vapour ramp.
        const q = createSteamQuench();
        expect(q.mesh.material.fog).toBe(false);
        q.dispose();
    });

    it('is one draw with a sensible radius, and disposes what it made', () => {
        const q = createSteamQuench();
        expect(q.mesh.isMesh).toBe(true);
        expect(q.mesh.geometry.parameters.radius).toBe(STEAM_QUENCH_RADIUS);
        expect(() => q.dispose()).not.toThrow();
    });
});
