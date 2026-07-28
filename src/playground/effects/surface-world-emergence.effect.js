// ═══════════════════════════════════════════════════════════════════════════════
// Odyssey Ch3 "Surface World" — masterpiece rebuild, Stage 1: the FOUNDATION.
//
// See docs/ODYSSEY_CH3_SURFACE_WORLD_REBUILD_PLAN.md. This isolated harness composes the
// chapter's PROVEN, already-consolidated foundation materials — the golden-hour sky dome, the
// CPU-baked terrain, and the ONE shared golden-water material (sea + river + hero lake) — into a
// hero golden-hour vista, so we can (a) A/B the base composition + palette and (b) build the
// CONSOLIDATED foliage/trees/particles (Stages 2–4, the compile-monster fix) directly into this
// scene before porting anything back to the live chapter.
//
// The foundation is intentionally reused, not rebuilt: it is already ~3 materials (sky, terrain,
// water) — the pipeline explosion lives in the ~20 foliage/tree/particle builders, which Stages
// 2–4 collapse into ~3 instanced materials. Stage 1 nails the light + framing the rest sits in.
// ═══════════════════════════════════════════════════════════════════════════════

import { uniform } from 'three/tsl';
import {
    createSkyBackgroundTSL,
    createLandscapeTSL,
    createOceanSurfaceTSL,
} from '../../rendering/odyssey/chapter-environments/surface-world.tsl.js';

export const meta = {
    id: 'surface-world-emergence',
    title: 'Surface World — Emergence (Ch3 rebuild · Stage 1 foundation)',
    description: 'Ch3 rebuild foundation: golden-hour sky + terrain + shared golden water',
};

export function create({ scene }) {
    const uTime = uniform(0);
    // uSeason 0 = the deep-ocean breach (teal, ties to Ch2) → 1 = the alpine hand-off to Ch4.
    // Stage 1 sits in early spring golden-hour (~0.12) to judge the warm base palette.
    const uSeason = uniform(0.12);

    // Proven foundation builders — each returns { mesh, material, geometry, uniforms }.
    // Water level 60.0 + surfaceOffsetY -15 match the live chapter's assembly (surface-world.js).
    const sky = createSkyBackgroundTSL(uTime, { uSeason });
    const terrain = createLandscapeTSL(uTime, 60.0);
    const water = createOceanSurfaceTSL(uTime, -15);

    scene.add(sky.mesh);
    scene.add(terrain.mesh);
    scene.add(water.mesh);

    const built = [sky, terrain, water];

    return {
        // Static hero framing (pass ?orbit is irrelevant — this camera hook wins): an elevated
        // 3/4 vista looking back into the valley toward the low-left golden sun, so the meadow,
        // the hero lake, and the distant ridgeline stack into readable foreground→background depth.
        camera(time, camera) {
            camera.position.set(26, 36, 156);
            camera.lookAt(0, 6, -54);
            camera.fov = 46;
            camera.updateProjectionMatrix();
        },
        update(time) {
            uTime.value = time;
            // Season is held static for the foundation A/B; Stage 4 scripts it spring→winter.
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
                b.geometry?.dispose?.();
                b.material?.dispose?.();
            }
        },
    };
}
