// ═══════════════════════════════════════════════════════════════════════════════
// Fix B iteration harness — Ch3 rolling grass hills (getTerrainHeight + landscape shading).
//
// Composes the real Ch3 foundation (sky + terrain + the unified golden water) with the SAME
// vertical relationship as the live chapter so the grass/sand shading reads correctly: live
// relHeight = getTerrainHeight + 15 − SURFACE_WORLD_TERRAIN_DEPTH_OFFSET(8) = getTerrainHeight + 7,
// and here the terrain mesh sits at y=0, so waterLevel = −7 reproduces it. (The emergence harness
// used waterLevel 60 with the mesh at y=0 → the whole terrain shaded "underwater/wet" pale — a
// harness artifact, not the live look.)
//
// Camera: an elevated down-valley 3/4 so the flight lane (water leading line) threads a green
// valley with rolling grass hills on both flanks, receding toward the far ridgeline / mountains.
// ═══════════════════════════════════════════════════════════════════════════════

import { uniform } from 'three/tsl';
import {
    createSkyBackgroundTSL,
    createLandscapeTSL,
    createOceanSurfaceTSL,
} from '../../rendering/odyssey/chapter-environments/surface-world.tsl.js';

export const meta = {
    id: 'ch3-terrain',
    title: 'Ch3 Terrain — rolling grass hills (Fix B)',
    description: 'Ch3 heightfield + shading iteration: corridor-valley grass hills + golden water',
};

export function create({ scene }) {
    const uTime = uniform(0);
    const uSeason = uniform(0.12);

    const sky = createSkyBackgroundTSL(uTime, { uSeason });
    const terrain = createLandscapeTSL(uTime, -7.0); // matches live relHeight (mesh at y=0)
    const water = createOceanSurfaceTSL(uTime, -15);

    scene.add(sky.mesh);
    scene.add(terrain.mesh);
    scene.add(water.mesh);
    const built = [sky, terrain, water];

    return {
        camera(time, camera) {
            // LOW forward journey view (mimics the in-game spline camera): near the corridor mouth,
            // low over the water, looking down-valley toward the lake so the flanking grass hills
            // read at the actual flight angle — not just a director's overview.
            camera.position.set(-6, 14, 120);
            camera.lookAt(-26, 6, -160);
            camera.fov = 62;
            camera.updateProjectionMatrix();
        },
        update(time) {
            uTime.value = time;
            uSeason.value = 0.12;
        },
        dispose() {
            for (const b of built) {
                b.mesh?.parent?.remove(b.mesh);
                b.mesh?.traverse?.((o) => {
                    o.geometry?.dispose?.();
                    if (Array.isArray(o.material)) o.material.forEach((m) => m?.dispose?.());
                    else o.material?.dispose?.();
                });
            }
        },
    };
}
