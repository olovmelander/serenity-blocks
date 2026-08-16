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
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
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
    it('ConeGeometry uv.y is 0 at the BASE and 1 at the TIP (the tail shader depends on this)', () => {
        const geometry = new THREE.ConeGeometry(5, 95, 12, 1, true);
        const pos = geometry.attributes.position;
        const uv = geometry.attributes.uv;
        let tipUv = null;
        let baseUv = null;
        let maxY = -Infinity;
        let minY = Infinity;
        for (let i = 0; i < pos.count; i += 1) {
            const y = pos.getY(i);
            if (y > maxY) { maxY = y; tipUv = uv.getY(i); }
            if (y < minY) { minY = y; baseUv = uv.getY(i); }
        }
        expect(tipUv).toBe(1);
        expect(baseUv).toBe(0);
    });

    it('mounts a head and a dithered-opaque tail, both fog-exempt', () => {
        const group = buildEnv();
        const comet = group.userData.comet;
        expect(comet?.name).toBe('comet-chase');
        const names = comet.children.map((child) => child.name).sort();
        expect(names).toEqual(['comet-head', 'comet-tail']);
        comet.children.forEach((child) => {
            // Opaque queue + dithered dissolve, never a blend state.
            expect(child.material.transparent).toBe(false);
            expect(child.material.depthWrite).toBe(true);
            expect(child.material.alphaTest).toBeGreaterThan(0);
            expect(child.material.opacityNode).toBeTruthy();
            // Space is a vacuum — every ch6 mesh joins the fog opt-out.
            expect(child.material.fog).toBe(false);
        });
    });

    it('trails the tail BEHIND the head along the travel chord', () => {
        const group = buildEnv();
        const comet = group.userData.comet;
        const tail = comet.children.find((child) => child.name === 'comet-tail');
        // The chord runs a -> b; the tail body must sit on the -travel side of the head.
        const dir = new THREE.Vector3(-270, -50, -790).sub(new THREE.Vector3(250, 70, -330)).normalize();
        expect(tail.position.dot(dir)).toBeLessThan(0);
        // ...and its local +Y (the cone tip) must point further backwards still.
        const tipWorldOffset = new THREE.Vector3(0, 47.5, 0)
            .applyQuaternion(tail.quaternion)
            .add(tail.position);
        expect(tipWorldOffset.dot(dir)).toBeLessThan(tail.position.dot(dir));
    });

    it('stages on its own uReveal — never through the entryContinuity buckets', () => {
        const group = buildEnv();
        const comet = group.userData.comet;
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
        const comet = group.userData.comet;
        updateCosmicExpanseEnvironment(group, 0.016, 5, null, 0.5);
        const early = comet.position.clone();
        updateCosmicExpanseEnvironment(group, 0.016, 35, null, 0.5);
        expect(comet.position.distanceTo(early)).toBeGreaterThan(50);
    });
});
