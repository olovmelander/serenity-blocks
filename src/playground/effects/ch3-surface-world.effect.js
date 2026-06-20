/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, no-console */
// FULL Chapter-3 (Surface World) composition harness.
//
// Composes the SHIPPING TSL builders from surface-world.tsl.js (the exact same
// functions createSurfaceWorldEnvironment() uses) in a static, chapter-like framing
// so the whole composition — sky, sun, god-rays, mountains, terrain, water, trees —
// can be screenshot-iterated here. Because it imports the live builders, any value I
// tune in those builders shows up BOTH here and in the real chapter ("improve the
// harness = improve the chapter"). This ends the blind-edit loop for the look pass;
// the live journey camera + transition ramps still get one real capture at the end.
//
// URL params: ?effect=ch3-surface-world&orbit=0&t=8
//   season=<0..1>   spring(0) → winter(1) arc (drives sky/sun/mountain snow)
//   snow=<0..1>     terrain/foothill snow blend (default tracks season)
//   terrainY,waterY ground + water Y offsets (default -8 / -15)
//   camX,camY,camZ + lookX,lookY,lookZ  static camera override
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
    createSkyBackgroundTSL,
    createOceanSurfaceTSL,
    createLandscapeTSL,
    createFoothillBridgeTSL,
    createSunDiscTSL,
    createSunRaysTSL,
    createCloudsTSL,
    createMeadowFlowersTSL,
    createTreesTSL,
    createSpruceTreesTSL,
    createTreeLineTSL,
    createReedsTSL,
    createGreatTreeTSL,
} from '../../rendering/odyssey/chapter-environments/surface-world.tsl.js';
import {
    createCanonicalMountainRangeTSL,
} from '../../rendering/odyssey/chapter-environments/shared/canonical-mountain-range.js';

export const meta = {
    id: 'ch3-surface-world',
    title: 'Ch3 Surface World (full composition)',
    description: 'Full Chapter-3 scene from the shipping TSL builders — iterate the whole look here.',
};

const num = (params, key, dflt) => {
    const v = Number.parseFloat(params.get(key));
    return Number.isFinite(v) ? v : dflt;
};

export function create({ scene, params }) {
    const uTime = uniform(0);
    const season = num(params, 'season', 0);
    const uSeason = uniform(season);
    const snow = num(params, 'snow', season); // default: snow tracks the season arc
    const terrainOffsetY = num(params, 'terrainY', -8);
    const surfaceOffsetY = num(params, 'waterY', -15);
    const opts = { uSeason };

    // FAITHFUL ATMOSPHERE: the live chapter applies FogExp2 (Ch3 profile: 0x4f8fb8 cool
    // blue, density ~0.0016) via ChapterEnvironmentManager — that cool fog is why in-game
    // reads cooler than the un-fogged harness did. Match it so composition/colour review is
    // valid. ?fog=0 disables; ?fogD overrides density.
    const fogDensity = num(params, 'fogD', 0.0016);
    if (num(params, 'fog', 1) !== 0) {
        scene.fog = new THREE.FogExp2(0xb8a47e, fogDensity); // warm golden-hour haze (Ch3 profile)
    }

    const added = [];
    const snowTargets = [];

    // Run a builder behind a guard so one failure logs instead of blanking the harness.
    const place = (label, fn, onResult) => {
        try {
            const r = fn();
            const obj = r.group || r.mesh;
            if (obj) { scene.add(obj); added.push(obj); }
            if (onResult) onResult(r);
            return r;
        } catch (err) {
            console.error(`[ch3-harness] builder failed: ${label}`, err);
            return null;
        }
    };

    // ── Sky dome + atmosphere ────────────────────────────────────────────────
    place('sky', () => createSkyBackgroundTSL(uTime, opts));
    place('clouds', () => createCloudsTSL(uTime));

    // ── Distant mountains (canonical Ch4 hero chain, as the chapter shows them) ─
    place('mountains', () => createCanonicalMountainRangeTSL({
        hostChapterId: 3,
        name: 'playground-ch3-mountains',
        uTransition: uSeason,
        baseOpacity: 1,
    }), (r) => {
        (r.parts || []).forEach((p) => {
            if (p?.uniforms?.uSnowBlend) snowTargets.push(p.uniforms.uSnowBlend);
        });
    });

    // ── Water + terrain (terrain/foothill ride terrainOffsetY like the chapter) ─
    place('ocean', () => createOceanSurfaceTSL(uTime, surfaceOffsetY));
    place('landscape', () => createLandscapeTSL(uTime, 60), (r) => {
        if (r.mesh) r.mesh.position.y = terrainOffsetY;
        if (r.uniforms?.uSnowBlend) snowTargets.push(r.uniforms.uSnowBlend);
    });
    place('foothill', () => createFoothillBridgeTSL(uTime), (r) => {
        if (r.mesh) r.mesh.position.y = terrainOffsetY;
        if (r.uniforms?.uSnowBlend) snowTargets.push(r.uniforms.uSnowBlend);
    });

    // ── Sun disc + god rays (the Batch-1 hero sun, now low-left) ──────────────
    place('sun', () => createSunDiscTSL(uTime, opts));
    place('rays', () => createSunRaysTSL(uTime, opts));

    // ── Vegetation (anchored to getTerrainHeight in-builder, lifted by offset) ─
    const liftToTerrain = (r) => { if (r.mesh) r.mesh.position.y += terrainOffsetY; };
    place('flowers', () => createMeadowFlowersTSL(uTime, 3600), liftToTerrain);
    place('trees', () => createTreesTSL(uTime, 26, opts), liftToTerrain);
    place('spruces', () => createSpruceTreesTSL(uTime, 22), liftToTerrain);
    place('tree-line', () => createTreeLineTSL(uTime, 44), liftToTerrain);
    place('reeds', () => createReedsTSL(uTime, 220), liftToTerrain);
    place('great-tree', () => createGreatTreeTSL(uTime), liftToTerrain);

    snowTargets.forEach((u) => { u.value = snow; });

    // Lights for the LIT vegetation (MeshLambertNodeMaterial trees). A HemisphereLight gives
    // natural sky/ground bounce so shadow sides read as lush green, not black; warm directional
    // sun keys the form from the left (matching SURFACE_SUN_DIR); low flat ambient floor.
    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x5a7a44, 0.75);
    const ambient = new THREE.AmbientLight(0xacc6e6, 0.18);
    const sun = new THREE.DirectionalLight(0xffcf7a, 0.7);
    sun.position.set(-90, 38, -120);
    scene.add(hemi, ambient, sun);
    added.push(hemi, ambient, sun);

    // Static chapter-like vantage: low eye, forward + slightly up across the valley,
    // biased left so the sun (low-left) and the mountains both sit in frame.
    const cam = {
        x: num(params, 'camX', 0),
        y: num(params, 'camY', 6),
        z: num(params, 'camZ', 72),
        lx: num(params, 'lookX', -18),
        ly: num(params, 'lookY', 24),
        lz: num(params, 'lookZ', -360),
    };

    return {
        camera(time, camera) {
            camera.position.set(cam.x, cam.y, cam.z);
            camera.lookAt(cam.lx, cam.ly, cam.lz);
            camera.fov = num(params, 'fov', 55);
            camera.updateProjectionMatrix();
        },
        update(time) {
            uTime.value = time;
            uSeason.value = season;
        },
        dispose() {
            added.forEach((obj) => {
                scene.remove(obj);
                obj.traverse?.((c) => {
                    c.geometry?.dispose?.();
                    if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose?.());
                    else c.material?.dispose?.();
                });
            });
        },
    };
}
