/**
 * Ch6 comet (Wave 5) — structure, staging, and the geometry assumption its shader
 * depends on.
 *
 * The orientation test exists because the first draft shipped BOTH tail gradients
 * inverted: `uv().y` was assumed to run tip→base on ConeGeometry when it actually
 * runs base→tip, so the tail dissolved at the nucleus and went solid-bright at its
 * trailing end. The shader reads `along = uv().y` and paints bright/dense at 0 —
 * if three.js ever flips this mapping, this test fails and names the shader.
 */
import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    COMET_PATH,
    SUMMIT_EARTH_REVEAL,
    createCosmicExpanseEnvironment,
    updateCosmicExpanseEnvironment,
} from './cosmic-expanse.js';
import { deriveOdysseyChapterPositions } from '../../../core/odyssey/data/odyssey-layout.js';

// DERIVED mid-summit-window probe. This used to be the literal 0.638, which the
// north-island Wave 0 retime moved OUTSIDE the window — where `spaceReveal` returns 1
// by design (the manager gates the chapter's opacity there instead). Deriving it keeps
// the probe meaning "inside the summit window" through any future retime.
const CP = deriveOdysseyChapterPositions();
const MID_SUMMIT = CP[5] - (CP[5] - CP[4])
    * ((SUMMIT_EARTH_REVEAL.startBeforeBoundary + SUMMIT_EARTH_REVEAL.endBeforeBoundary) / 2);

afterEach(() => {
    vi.unstubAllGlobals();
});

function buildEnv() {
    vi.stubGlobal('window', { location: { search: '' } });
    const group = createCosmicExpanseEnvironment({ particleCount: 200 });
    group.userData.chapterOpacity = 1;
    return group;
}

describe('ch6 comet (Space overhaul Wave 5)', () => {
    it('mounts a glowing coma and two luminous tails, all light, all fog-exempt', () => {
        // Overhaul 2026-10-20: the head was an opaque ice ball faded through a screen-space dither
        // (a speckled blob in captures); it is now the coma — light, like the tails — and a dust
        // tail joined the ion tail.
        const group = buildEnv();
        const { comet } = group.userData;
        expect(comet?.name).toBe('comet-chase');
        const names = comet.children.map((child) => child.name).sort();
        expect(names).toEqual(['comet-dust-tail', 'comet-head', 'comet-tail']);
        comet.children.forEach((child) => {
            expect(child.material.transparent).toBe(true);
            expect(child.material.depthWrite).toBe(false);
            expect(child.material.blending).toBe(THREE.AdditiveBlending);
            expect(child.material.forceSinglePass).toBe(true);
            expect(child.material.opacityNode).toBeTruthy();
            // Space is a vacuum — every ch6 mesh joins the fog opt-out.
            expect(child.material.fog).toBe(false);
        });
    });

    it('streams its tails AWAY from the black hole, the dust tail bent back along its path', () => {
        const group = buildEnv();
        const { comet, blackHole } = group.userData;
        updateCosmicExpanseEnvironment(group, 0.016, 30, null, 0.5);
        group.updateMatrixWorld(true);
        const hole = blackHole.getWorldPosition(new THREE.Vector3());
        comet.parent.worldToLocal(hole);
        const away = comet.position.clone().sub(hole).normalize();
        expect(comet.userData.uTailDir.value.dot(away)).toBeGreaterThan(0.999);
        // The bend is square to the tail and points back along the chord (a -> b travel).
        const back = COMET_PATH.a.clone().sub(COMET_PATH.b).normalize();
        expect(Math.abs(comet.userData.uBendDir.value.dot(comet.userData.uTailDir.value))).toBeLessThan(1e-6);
        expect(comet.userData.uBendDir.value.dot(back)).toBeGreaterThan(0);
    });

    it('stages on its own uReveal — never through the entryContinuity buckets', () => {
        const group = buildEnv();
        const { comet } = group.userData;
        Object.values(group.userData.entryContinuity).forEach((bucket) => {
            expect(bucket).not.toContain(comet);
        });

        // Pre-boundary (the Ch5 summit window): the space gate holds it shut.
        updateCosmicExpanseEnvironment(group, 0.016, 1.0, null, MID_SUMMIT);
        expect(comet.userData.uReveal.value).toBe(0);
        expect(comet.visible).toBe(false);

        // Late chapter, past the reef window: gone again (it is a mid-chapter beat,
        // not set dressing that lingers into the dive).
        updateCosmicExpanseEnvironment(group, 0.016, 1.0, null, 0.95);
        expect(comet.userData.uReveal.value).toBeLessThan(0.02);
    });

    it('sweeps its chord over time rather than holding a station', () => {
        const group = buildEnv();
        const { comet } = group.userData;
        updateCosmicExpanseEnvironment(group, 0.016, 5, null, 0.5);
        const early = comet.position.clone();
        updateCosmicExpanseEnvironment(group, 0.016, 35, null, 0.5);
        expect(comet.position.distanceTo(early)).toBeGreaterThan(50);
    });
});
