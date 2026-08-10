// ═══════════════════════════════════════════════════════════════════════════════
// Fix A verification harness — the ONE Odyssey water surface, seen from BELOW and ABOVE.
//
// The camera rises through the plane over `time`: ?t=1 sits under the water looking up (the
// caustic-teal Ch2 ceiling), ?t=7 sits above looking down (the golden-hour Ch3 top), and the
// mid values (~?t=4) straddle the membrane so we can confirm there is NO hard band at the
// crossing — the whole point of buildOdysseyWaterSurface. A vertical gradient backdrop gives a
// dark abyss below and a warm sky above so both looks have something to composite over.
//
// Verify per CLAUDE.md: wait __PLAYGROUND_READY__, capture below + above + crossing, console clean.
// ═══════════════════════════════════════════════════════════════════════════════

import * as THREE from 'three/webgpu';
import {
    uniform, positionWorld, normalize, mix, smoothstep, vec3, float, clamp,
} from 'three/tsl';
import { buildOdysseyWaterSurface } from '../../rendering/odyssey/chapter-environments/shared/odyssey-water-surface.tsl.js';

export const meta = {
    id: 'odyssey-unified-water',
    title: 'Odyssey Unified Water — below/above breach (Fix A)',
    description: 'One view-dependent water membrane: caustic teal underside, golden top, no hard band',
};

export function create({ scene }) {
    const uTime = uniform(0);
    const uDepth = uniform(1); // fully "surfaced" → caustic underside at full ignition for the test
    const uSeason = uniform(0);
    const uOpacity = uniform(1);
    const uWaveScale = uniform(0.7); // visible swell so the surface silhouette reads in isolation

    // Vertical gradient backdrop: dark abyss below the waterline, warm golden-hour sky above.
    const skyGeo = new THREE.SphereGeometry(600, 32, 24);
    const skyMat = new THREE.MeshBasicNodeMaterial();
    const dir = normalize(positionWorld);
    const up = clamp(dir.y.mul(0.5).add(0.5), 0.0, 1.0); // 0 = straight down, 1 = straight up
    const abyss = vec3(0.012, 0.05, 0.11); // deep indigo
    const horizon = vec3(0.95, 0.66, 0.36); // warm golden-hour band
    const zenith = vec3(0.20, 0.42, 0.72); // upper blue
    let skyCol = mix(abyss, horizon, smoothstep(0.30, 0.52, up));
    skyCol = mix(skyCol, zenith, smoothstep(0.52, 0.80, up));
    skyMat.colorNode = skyCol;
    skyMat.side = THREE.BackSide;
    skyMat.toneMapped = false;
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);

    // The unified water plane at Y=0.
    const { material } = buildOdysseyWaterSurface(uTime, {
        uDepth, uSeason, uOpacity, uWaveScale, useRadialEdge: false, baseAlpha: 0.92,
    });
    const waterGeo = new THREE.PlaneGeometry(600, 600, 96, 96);
    waterGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(waterGeo, material);
    water.frustumCulled = false;
    scene.add(water);

    const built = [sky, water];

    return {
        camera(time, camera) {
            // Rise through the plane: y sweeps −18 (under) → +26 (over), crossing 0 near t≈2.6s.
            // NB: numeric clamp here (Math), NOT the TSL `clamp` node — this is per-frame JS.
            const s = Math.max(0, Math.min(1, time * 0.16));
            camera.position.set(9, -18 + s * 44, 48);
            camera.lookAt(0, 0, -70); // toward the low front-left sun so the glitter path shows
            camera.fov = 50;
            camera.updateProjectionMatrix();
        },
        update(time) {
            uTime.value = time;
        },
        dispose() {
            for (const b of built) {
                b.parent?.remove(b);
                b.geometry?.dispose?.();
                b.material?.dispose?.();
            }
        },
    };
}
