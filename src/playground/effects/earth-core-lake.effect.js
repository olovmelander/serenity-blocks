/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview A/B playground for the Earth Core LAVA LAKE remake
 * (docs/ODYSSEY_EARTH_CORE_LAVA_LAKE_REMAKE_2026-08.md §4, Session 1).
 *
 * The real `createLavaFloorTSL` builder, three ways:
 *   ?variant=analytic  — the shipped lake (19 calibrated-simplex bodies per fragment)
 *   ?variant=baked     — the SAME primitive from the periodic R16F 3D texture (19 fetches)
 *   ?variant=split     — ONE material whose noise source switches at the lake's local x = split
 *                        (default 0): x < split analytic, x ≥ split baked — identical coordinates,
 *                        camera and clock in BOTH stages (screenUV is fragment-only and the vertex
 *                        displacement goes through the same source). Compiles both bodies;
 *                        playground only.
 * Poses (static, deterministic): ?pose=entry|basin|top. Entry ≈ the chapter's p=0 station
 * (eye ~6 u above the plane looking across); basin looks down into a molten basin; top is the
 * straight-down tiling check. ?descent=0..1 ?pulse=0..1 ?seam=0..1 drive the chapter uniforms,
 * ?basins=0 drops the basin list, ?debug=2 builds the tier-ID variant (crust/mid/hot/bloom as
 * flat colours for mask statistics), ?split=<local x> moves the split line. ?t= freezes the clock.
 */

import * as THREE from 'three/webgpu';
import {
    positionLocal, select, uniform,
} from 'three/tsl';
import { createLavaFloorTSL } from '../../rendering/odyssey/chapter-environments/earth-core.tsl.js';
import { snoise3 } from '../../rendering/odyssey/chapter-environments/shared/odyssey-tsl-noise.js';
import {
    getLakeNoiseTexture, makeLakeNoiseSampler,
} from '../../rendering/odyssey/chapter-environments/shared/odyssey-lake-noise-bake.js';

export const meta = {
    id: 'earth-core-lake',
    title: 'Earth-Core Lava Lake A/B',
    description: 'The real lake builder: analytic simplex vs the periodic baked texture (split view)',
};

// The chapter bakes basins from path samples (earth-core.js createLavaFloor); three fixed pools
// of the same radius class stand in for them here so the #ffffaa vein cores and pulse spots show.
const PLAYGROUND_BASINS = [
    { x: -62, z: 18, r: 28 },
    { x: 28, z: -44, r: 32 },
    { x: 84, z: 58, r: 26 },
];

const LAKE_Y = -10; // createLavaFloorTSL's LAVA_LAKE_Y

export function create({ scene, params }) {
    const variant = params?.get('variant') || 'split';
    const pose = params?.get('pose') || 'entry';
    const num = (key, fallback) => {
        const v = Number.parseFloat(params?.get(key));
        return Number.isFinite(v) ? v : fallback;
    };
    const uTime = uniform(0);
    const uPulse = uniform(num('pulse', 0.2));
    const uDescent = uniform(num('descent', 0.3));
    const uSeam = uniform(num('seam', 0));
    const uSplitX = uniform(num('split', 0));
    const debug = params?.get('debug') === '2' ? 2 : 0;
    const basins = params?.get('basins') === '0' ? [] : PLAYGROUND_BASINS;

    const options = { basins, uSeam, debug };
    if (variant === 'baked') {
        options.noise = 'baked';
    } else if (variant === 'split') {
        const lakeTex = getLakeNoiseTexture();
        const snBaked = makeLakeNoiseSampler(lakeTex);
        options.noiseSource = (p) => select(positionLocal.x.lessThan(uSplitX), snoise3(p), snBaked(p));
    }
    const { mesh, material, geometry } = createLavaFloorTSL(uTime, uPulse, uDescent, options);
    scene.add(mesh);

    scene.background = new THREE.Color(0x12040a); // the dark vault, not the backdrop dome

    const lakeTexture = variant === 'analytic' ? null : getLakeNoiseTexture();

    return {
        cameraRadius: 120,
        update(time) {
            uTime.value = time;
            if (lakeTexture && !lakeTexture.userData.ready) {
                // Surface the bake state so a capture never mistakes the zero placeholder for art.
                if (typeof window !== 'undefined') window.__LAKE_BAKE_READY__ = false;
            } else if (typeof window !== 'undefined') {
                window.__LAKE_BAKE_READY__ = true;
            }
        },
        camera(time, camera) {
            camera.fov = 60;
            camera.near = 0.1;
            camera.far = 2000;
            if (pose === 'top') {
                camera.position.set(0, LAKE_Y + 230, 0.01);
                camera.lookAt(0, LAKE_Y, 0);
            } else if (pose === 'basin') {
                const b = PLAYGROUND_BASINS[1];
                camera.position.set(b.x - 40, LAKE_Y + 38, b.z + 44);
                camera.lookAt(b.x, LAKE_Y, b.z);
            } else {
                // entry: ≈ the chapter's p=0 station — eye ~6 u above the plane, looking across
                // toward the far shore with a slight downward pitch.
                camera.position.set(-18, LAKE_Y + 6, -11);
                camera.lookAt(70, LAKE_Y - 22, 60);
            }
            camera.updateProjectionMatrix();
        },
        dispose() {
            scene.remove(mesh);
            geometry.dispose();
            material.dispose();
        },
    };
}
