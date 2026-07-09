/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Sky Children V2 — Poly Haven detail-texture verification harness.
 *
 * Composes the REAL theme scene builders (sky dome + cloud sea + GPU-displaced
 * valley terrain + far massif + floating islands) with the CC0 greyscale luminance
 * detail textures wired into the terrain / cliff / mountain materials — so a
 * screenshot validates the exact shipped code path IN CONTEXT (per the Polyhaven
 * audit: textures used luminance-only, multiplied into the painterly palette).
 *
 * This is a playground harness (decoupled from BaseTheme), not the theme itself.
 *
 * Params:
 *   ?detail=0    disable the detail textures (A/B against pure-procedural)
 *   ?warm=<0..1> mood radiance (0 = cool reverie palette, 1 = warm triumph)
 *   ?bare=1      drop sky/clouds/islands → just the textured terrain + massif
 */
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
    createValleyTerrainMaterial,
    createValleyCliffMaterial,
} from '../../themes/sky-children-v2/rendering/valley-terrain.js';
import { createFarRangeMaterial } from '../../themes/sky-children-v2/rendering/far-ranges.js';
import { createSkyDome } from '../../themes/sky-children-v2/rendering/sky-dome.js';
import { createCloudSea } from '../../themes/sky-children-v2/rendering/cloud-sea.js';
import { createFloatingIslands } from '../../themes/sky-children-v2/rendering/floating-islands.js';
import { createIslandBushes, createIslandArches } from '../../themes/sky-children-v2/rendering/island-props.js';
import { createIslandTrees } from '../../themes/sky-children-v2/rendering/island-trees.js';
import {
    createSkyDetailTextureSet,
    disposeSkyDetailTextureSet,
} from '../../themes/sky-children-v2/rendering/detail-texture.js';

export const meta = {
    id: 'sky-children-detail',
    title: 'Sky Children V2 — Poly Haven detail tooth',
    description: 'Theme scene (sky/clouds/islands) + CC0 luminance detail on terrain & massif.',
};

const REVERIE = {
    zenith: 0x3ea7d8, mid: 0x7ad2f2, horizon: 0xc6effc, sun: 0xffffff,
};
const TRIUMPH = {
    zenith: 0x2d6894, mid: 0xe69c73, horizon: 0xffcca3, sun: 0xffe8d1,
};

function lerpColor(aHex, bHex, t) {
    return new THREE.Color(aHex).lerp(new THREE.Color(bHex), t);
}

export function create({ scene, camera, params }) {
    const useDetail = params?.get('detail') !== '0';
    const bare = params?.get('bare') === '1';
    const warm = Math.max(0, Math.min(1, parseFloat(params?.get('warm') ?? '0.18')));

    const zenith = lerpColor(REVERIE.zenith, TRIUMPH.zenith, warm);
    const mid = lerpColor(REVERIE.mid, TRIUMPH.mid, warm);
    const horizon = lerpColor(REVERIE.horizon, TRIUMPH.horizon, warm);
    const sun = lerpColor(REVERIE.sun, TRIUMPH.sun, warm);
    const fog = horizon.clone().lerp(new THREE.Color(0xffffff), 0.05);

    scene.background = horizon.clone();
    const sunDir = new THREE.Vector3(0.35, 0.48, -0.72).normalize();

    // Shared uniform block — same shape as theme createSharedUniforms().
    const u = {
        uTime: uniform(0),
        uRadiance: uniform(warm),
        uIgnite: uniform(0),
        uGust: uniform(0),
        uSparkle: uniform(0),
        uSunDir: uniform(sunDir.clone()),
        uSunColor: uniform(sun),
        uSkyZenith: uniform(zenith),
        uSkyMid: uniform(mid),
        uSkyHorizon: uniform(horizon),
        uFogColor: uniform(fog),
        uRimColor: uniform(new THREE.Color(0xf6c063)),
        uShadowTint: uniform(new THREE.Color(0x576b88)),
        uStarFade: uniform(1),
        uCameraPos: uniform(new THREE.Vector3()),
    };

    const detail = useDetail ? createSkyDetailTextureSet() : null;
    const disposables = [];
    const runtimes = [];

    // ── Sky dome + cloud sea + floating islands (real theme builders) ───────────
    if (!bare) {
        const sky = createSkyDome(u, { radius: 1200 });
        scene.add(sky.mesh);
        runtimes.push(sky);

        const clouds = createCloudSea(u, { deck: true, clusterCount: 5, puffsPerCluster: 4 });
        scene.add(clouds.group);
        runtimes.push(clouds);

        const islands = createFloatingIslands(u, { detailTex: detail?.skirt ?? null });
        scene.add(islands.group);
        runtimes.push(islands);

        // Meadow props on the ground islands (anchor via heightFieldTSL — no terrainField needed).
        const bushes = createIslandBushes(u, { count: 220, cloudY: 10 });
        scene.add(bushes.mesh);
        runtimes.push(bushes);

        const arches = createIslandArches(u, { cloudY: 10, count: 3 });
        scene.add(arches.mesh);
        runtimes.push(arches);

        const trees = createIslandTrees(u, { count: 48, cloudY: 10 });
        scene.add(trees.mesh);
        runtimes.push(trees);
    }

    // ── Terrain (the material's positionNode displaces this flat plane) ──────────
    const terrainSize = 640;
    const geo = new THREE.PlaneGeometry(terrainSize, terrainSize, 280, 280);
    geo.rotateX(-Math.PI / 2);
    const terrainMat = createValleyTerrainMaterial(
        u,
        detail ? { grass: detail.grass, dirt: detail.dirt } : null,
    );
    const terrain = new THREE.Mesh(geo, terrainMat);
    scene.add(terrain);
    disposables.push(geo, terrainMat);

    // ── Cliff skirt slab (reads the skirt rock tooth), tucked at terrain edge ────
    const cliffGeo = new THREE.BoxGeometry(120, 90, 24);
    const cliffMat = createValleyCliffMaterial(u, detail?.skirt ?? null);
    const cliff = new THREE.Mesh(cliffGeo, cliffMat);
    cliff.position.set(0, -34, 300);
    scene.add(cliff);
    disposables.push(cliffGeo, cliffMat);

    // ── Distant massif cones (far-range material) ───────────────────────────────
    const mountainMat = createFarRangeMaterial(u, detail?.mountain ?? null);
    disposables.push(mountainMat);
    const cones = [
        {
            x: 0, y: -150, z: -760, r: 440, h: 760, s: [1.25, 1.55, 1.25],
        },
        {
            x: -560, y: -120, z: -560, r: 300, h: 420, s: [1.4, 1.0, 1.4],
        },
        {
            x: 560, y: -120, z: -600, r: 320, h: 440, s: [1.4, 1.0, 1.4],
        },
    ];
    cones.forEach((c) => {
        const cg = new THREE.ConeGeometry(c.r, c.h, 72, 40, true);
        const m = new THREE.Mesh(cg, mountainMat);
        m.position.set(c.x, c.y, c.z);
        m.scale.set(...c.s);
        scene.add(m);
        disposables.push(cg);
    });

    // Theme-like vantage: the real theme camera base/target (high, over the sea).
    // ?view=islands frames a floating island up close to read the rock underside.
    const view = params?.get('view') || '';
    let camPos;
    let camTarget;
    if (view === 'islands') {
        camPos = new THREE.Vector3(-150, 92, -130);
        camTarget = new THREE.Vector3(-380, 78, -360);
    } else if (bare) {
        camPos = new THREE.Vector3(0, 95, 130);
        camTarget = new THREE.Vector3(0, -10, -160);
    } else {
        camPos = new THREE.Vector3(0, 28, 95);
        camTarget = new THREE.Vector3(0, 12, -42);
    }
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
    u.uCameraPos.value.copy(camPos);

    return {
        cameraRadius: 130,
        update(time) {
            u.uTime.value = time;
            u.uCameraPos.value.copy(camera.position);
            runtimes.forEach((r) => r.update?.(time));
        },
        camera(time, cam) {
            cam.position.copy(camPos);
            cam.lookAt(camTarget);
        },
        dispose() {
            scene.background = null;
            runtimes.forEach((r) => {
                if (r.group?.parent) scene.remove(r.group);
                if (r.mesh?.parent) scene.remove(r.mesh);
                r.dispose?.();
            });
            scene.remove(terrain, cliff);
            disposables.forEach((d) => d?.dispose?.());
            disposeSkyDetailTextureSet(detail);
        },
    };
}
