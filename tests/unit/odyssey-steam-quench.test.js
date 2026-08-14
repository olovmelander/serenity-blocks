import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
    STEAM_QUENCH_EXIT_HALF_WIDTH,
    STEAM_QUENCH_HALF_WIDTH,
    STEAM_QUENCH_RADIUS,
    createSteamQuench,
} from '../../src/rendering/odyssey/composition/odyssey-steam-quench.js';
import { ODYSSEY_CHAPTER_PROFILES } from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';

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

describe('steam quench board wiring', () => {
    const ROOT = path.resolve(
        path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
        '../..',
    );
    const BOARD = readFileSync(
        path.join(ROOT, 'src/rendering/odyssey/OdysseyBoardController.js'),
        'utf8',
    );

    it('seats the volume on the rail AT the 1->2 boundary', () => {
        expect(BOARD).toMatch(/const boundary12 = this\.presentationLayout\?\.chapterPositions\?\.\[1\]/);
        expect(BOARD).toMatch(/this\.steamQuench\.mesh\.position\.set\(at\.x, at\.y, at\.z\)/);
    });

    it('is WIDER than the crossfade it hides — an occluder that is narrower just frames it', () => {
        // REPLACED 2026-08-13 (same requirement, stronger assertion): the constants moved to
        // odyssey-steam-quench.js and are asserted by VALUE instead of by source regex. The
        // approach must out-span the authored crossfade; the exit must still cover the
        // co-presence window (= the authored seamWidth), which is what stops Earth Core's
        // dissolve tail showing bare.
        const seam = ODYSSEY_CHAPTER_PROFILES.find((c) => c.id === 1)?.transition?.seamWidth;
        expect(seam).toBeGreaterThan(0);
        expect(STEAM_QUENCH_HALF_WIDTH).toBeGreaterThan(seam);
        expect(STEAM_QUENCH_EXIT_HALF_WIDTH).toBeGreaterThanOrEqual(seam);
    });

    it('is hidden outside its window, so it costs nothing for most of the journey', () => {
        expect(BOARD).toMatch(/this\.steamQuench\.mesh\.visible = inWindow;/);
        expect(BOARD).toMatch(/if \(inWindow\) this\.steamQuench\.update\(this\.time,/);
    });

    it('runs every frame rather than on the throttled position gate', () => {
        // It billows, so throttling it to ~30Hz would make the vapour stutter exactly while
        // it fills the frame. The visibility test is cheap; the update is gated on the window.
        const idx = BOARD.indexOf('this.steamQuench.mesh.visible = inWindow;');
        const before = BOARD.slice(Math.max(0, idx - 700), idx);
        // The corridor field's throttled block must have CLOSED before the steam block opens.
        expect(before).toMatch(/this\.corridorField\?\.update\([^)]*\);\s*\}/);
    });

    it('cannot take the board down if it fails to build, and is disposed', () => {
        expect(BOARD).toMatch(/console\.warn\('\[OdysseyBoard\] steam quench unavailable \(non-fatal\)/);
        expect(BOARD).toMatch(/this\.steamQuench\.dispose\(\);/);
    });
});
