import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';

import {
    ChapterThresholdDirector,
    ODYSSEY_THRESHOLD_PROFILES,
    thresholdComponentAuthored,
} from './ChapterThresholdDirector.js';

// SEAMLESS PASS (2026-10-02): nothing non-diegetic floats in the world at a seam. The veil quad,
// the scanning ring and the 180 rail particles were overlays the camera flew through (the 4->5
// lavender flash was the eye passing the veil plane + its particle cloud), so every profile
// authors them off and the director builds none of them.

describe('chapter threshold director — no overlays at any seam', () => {
    it('authors veil, ring and particles OFF in all seven profiles', () => {
        const profiles = Object.values(ODYSSEY_THRESHOLD_PROFILES);
        expect(profiles).toHaveLength(7);
        profiles.forEach((profile) => {
            expect(profile.veilScale, `${profile.id} veil`).toBe(0);
            expect(profile.ringScale, `${profile.id} ring`).toBe(0);
            // Explicit: an omitted particleScale used to default to a full 180-particle burst.
            expect(profile.particleScale, `${profile.id} particles`).toBe(0);
        });
        expect(thresholdComponentAuthored('veilScale')).toBe(false);
        expect(thresholdComponentAuthored('ringScale')).toBe(false);
        expect(thresholdComponentAuthored('particleScale')).toBe(false);
    });

    it('builds no mesh (no pipeline at warm-up, no draw at a seam) and stays hidden through a seam', () => {
        const scene = new THREE.Scene();
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 50, -50), new THREE.Vector3(0, 100, -100),
        ]);
        const director = new ChapterThresholdDirector(scene, curve, { chapterPositions: [0, 0.5, 1] });
        let meshes = 0;
        director.group.traverse((o) => { if (o.isMesh) meshes += 1; });
        expect(meshes).toBe(0);
        expect(director.veil).toBeNull();
        expect(director.ring).toBeNull();
        expect(director.particles).toBeNull();

        // The board still drives the seam phase every frame; nothing may become visible.
        for (const boundaryId of Object.keys(ODYSSEY_THRESHOLD_PROFILES)) {
            director.trigger({ boundaryId, boundaryPosition: 0.5 });
            director.setSeamPhase({
                boundaryId, boundaryPosition: 0.5, seamProgress: 0.5, seamPhase: 0, envelope: 1,
            });
            director.update(1 / 60, new THREE.PerspectiveCamera(), { energy: 1, beatPulse: 1 });
            expect(director.group.visible, boundaryId).toBe(false);
        }
        director.dispose();
    });

    it('keeps no hard-edged square sparkle lattice in the veil shader', () => {
        const here = path.dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(path.join(here, 'chapter-threshold-director.tsl.js'), 'utf8');
        // `step(…, hash21(floor(uv * 70)))` drew one hard square per 70th of the quad.
        expect(src).not.toMatch(/hash21\(floor\(/);
    });
});
