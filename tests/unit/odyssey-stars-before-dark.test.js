/**
 * STARS BEFORE DARK (Act II -> Space transition plan, Wave 3).
 *
 * Chapter 6's NEAR star tier is deliberately not baked into the void dome precisely so it
 * can appear while there is still blue sky. This suite pins that staging: zero through the
 * whole earth-ignite window (nothing but the earth may bleed into full daylight), fading
 * up across the final climb [summitEnd, ch6Start] to a capped ceiling, and handed to the
 * normal `starReveal x spaceReveal` staging past the boundary via max() — so the boundary
 * can only ever make the stars arrive EARLIER, never dip them.
 *
 * The FAR tier must never join it: a whole starfield in daylight reads as noise; a few
 * bright early stars read as dusk.
 *
 * Stations are DERIVED from the live layout, never pinned — Wave 1A/1C re-map p for the
 * whole journey and these assertions must survive the next re-map too.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { deriveOdysseyChapterPositions } from '../../src/core/odyssey/data/odyssey-layout.js';
import {
    SUMMIT_EARTH_REVEAL,
    createCosmicExpanseEnvironment,
    updateCosmicExpanseEnvironment,
} from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.js';
import * as THREE from 'three';
import { getChapterPathRange, getOdysseyPathCurve } from '../../src/rendering/odyssey/path-utils.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('stars before dark', () => {
    const positions = deriveOdysseyChapterPositions();
    const ch5 = positions[4];
    const ch6 = positions[5];
    const skySpan = ch6 - ch5;
    const summitStart = ch6 - skySpan * SUMMIT_EARTH_REVEAL.startBeforeBoundary;
    const summitEnd = ch6 - skySpan * SUMMIT_EARTH_REVEAL.endBeforeBoundary;

    function buildEnv() {
        vi.stubGlobal('window', { location: { search: '' } });
        const group = createCosmicExpanseEnvironment({ particleCount: 200 });
        const range = getChapterPathRange(6);
        group.userData.yStart = range.start.y;
        group.userData.yEnd = range.end.y;
        group.userData.chapterOpacity = 1;
        return group;
    }

    it('lets the first stars LEAD the planet, in the twilight (2026-10-02 beat order)', () => {
        // The planet now rises after dark; the near stars arrive first, as the sky deepens.
        const env = buildEnv();
        const starsFrom = ch6 - skySpan * SUMMIT_EARTH_REVEAL.starsFromBeforeBoundary;
        // A camera stand-in on the rail: with a camera the progress is GLOBAL, so the chapter-5
        // space gate applies (headless callers without one pass chapter-local progress).
        const curve = getOdysseyPathCurve();
        const at = (p) => {
            const probe = new THREE.Object3D();
            probe.position.copy(curve.getPointAt(p));
            updateCosmicExpanseEnvironment(env, 0.016, 1.0, probe, p);
        };
        expect(starsFrom).toBeLessThan(summitStart);
        // Before the twilight: nothing at all.
        at(starsFrom - 0.002);
        expect(env.userData.starsNear.material.opacity).toBeLessThan(0.01);
        // As the planet starts to rise the near stars are already out — the far tier is not.
        at(summitStart);
        expect(env.userData.starsNear.material.opacity).toBeGreaterThan(0.05);
        expect(env.userData.starsFar.material.opacity).toBeLessThan(0.01);
        expect(env.userData.summitEarthStaging.earthReveal).toBeLessThan(0.01);
        [0.25, 0.6, 1.0].forEach((f) => {
            at(summitStart + (summitEnd - summitStart) * f);
            expect(env.userData.starsFar.material.opacity, `far tier lit at rise f=${f}`)
                .toBeLessThan(0.01);
            expect(env.userData.summitEarthStaging.earthReveal).toBeGreaterThan(0);
        });
    });

    it('fades the NEAR tier up across the final climb, while the sky is still blue', () => {
        const env = buildEnv();
        const midClimb = summitEnd + (ch6 - summitEnd) * 0.5;
        updateCosmicExpanseEnvironment(env, 0.016, 1.0, null, midClimb);
        const mid = env.userData.starsNear.material.opacity;
        expect(mid).toBeGreaterThan(0.05);
        expect(mid).toBeLessThan(SUMMIT_EARTH_REVEAL.starsBeforeDark);
        // The far tier holds — only the near tier may lead the dark.
        expect(env.userData.starsFar.material.opacity).toBeLessThan(0.01);

        // One station shy of the boundary: at the ceiling, and no further.
        updateCosmicExpanseEnvironment(env, 0.016, 1.0, null, ch6 - 1e-4);
        expect(env.userData.starsNear.material.opacity)
            .toBeCloseTo(SUMMIT_EARTH_REVEAL.starsBeforeDark, 2);
        expect(env.userData.starsFar.material.opacity).toBeLessThan(0.01);
    });

    it('never dips across the boundary — the normal staging takes over via max()', () => {
        const env = buildEnv();
        updateCosmicExpanseEnvironment(env, 0.016, 1.0, null, ch6 - 1e-4);
        const before = env.userData.starsNear.material.opacity;
        const gateEnd = ch6 + (positions[6] - ch6) * SUMMIT_EARTH_REVEAL.spaceGateBand;
        [ch6 + (gateEnd - ch6) * 0.5, gateEnd + 0.01].forEach((p) => {
            updateCosmicExpanseEnvironment(env, 0.016, 1.0, null, p);
            expect(env.userData.starsNear.material.opacity, `dip at p=${p.toFixed(4)}`)
                .toBeGreaterThanOrEqual(before - 1e-6);
        });
    });

    it('is monotonic across the whole hand-off, so the arrival cannot flicker', () => {
        const env = buildEnv();
        let prev = -1;
        for (let i = 0; i <= 24; i += 1) {
            const p = summitStart + ((ch6 + 0.02 - summitStart) * (i / 24));
            updateCosmicExpanseEnvironment(env, 0.016, 1.0, null, p);
            const v = env.userData.starsNear.material.opacity;
            expect(v, `p=${p.toFixed(4)}`).toBeGreaterThanOrEqual(prev - 1e-6);
            prev = v;
        }
    });
});
