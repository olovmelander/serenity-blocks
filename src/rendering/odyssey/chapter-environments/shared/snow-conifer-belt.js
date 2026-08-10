/* eslint-disable import/no-unresolved */

/**
 * @fileoverview Snow-conifer belt — the shared tree-line that bridges the Ch3→Ch4 seam.
 *
 * Instances the vertex-coloured snow conifers (fir/pine/spruce) from
 * odyssey-conifer-assets.js as a lit (MeshLambertNode) belt. Both Surface World (Ch3) and
 * Mountains (Ch4) call this with their own terrain-anchored placements, so the SAME
 * tree-line species appear on both sides of the seam — snow-dusted, thinning to the line.
 *
 * GLBs are single-mesh + COLOR_0 (snow baked in) + normals; we recenter each to base-at-0
 * and instance it. `uSnowBlend` lifts an extra white cap on the upper canopy for the winter
 * / high-altitude end. Loads async (like the Quaternius nature layer) and populates a group.
 */

import * as THREE from 'three/webgpu';
import {
    uniform, attribute, mix, vec3, positionLocal, smoothstep, float,
} from 'three/tsl';
import { loadOdysseyGltfCached } from './odyssey-gltf-loader.js';
import { getOdysseyConiferAssetRecords } from './odyssey-conifer-assets.js';

// CONSOLIDATION (remake plan action #1): ONE shared conifer material per snow-blend uniform.
// The material used to differ ONLY by each species' geometry `maxY` (baked into the snow-cap
// gradient), which minted a fresh pipeline per species AND per belt call — 6 materials for Ch3
// alone. `maxY` now rides a per-instance `aMaxY` attribute, so every species mesh + both belts
// (main + bridge, same uSnowBlend) reuse a SINGLE compiled pipeline. Cached by the uSnowBlend
// uniform object so each chapter (Ch3, Ch4) keeps its own material (their snow lines differ).
const _sharedConiferMaterials = new WeakMap();

function createConiferMaterial(uSnowBlend) {
    const material = new THREE.MeshLambertNodeMaterial();
    // Albedo = the GLB's baked vertex colours (snow/foliage/bark). They ship muted, so under
    // the warm key + golden fog they wash to pale grey blobs — boost saturation + deepen so
    // the foliage reads as lush stylised conifer (matching the saturated procedural trees);
    // Lambert then reveals the form from the chapter key + hemi fill.
    const raw = attribute('color', 'vec3');
    const lum = raw.r.mul(0.299).add(raw.g.mul(0.587)).add(raw.b.mul(0.114));
    const vColor = mix(vec3(lum, lum, lum), raw, float(1.55)).mul(0.92); // +saturation, slight deepen
    // Extra snow cap toward the winter/altitude end: lift the upper canopy toward white as
    // uSnowBlend rises (the GLB already carries baked snow; this deepens it). aMaxY = this
    // instance's species geometry height (uniform across a species), so the gradient is correct
    // for every species from the one shared material.
    const aMaxY = attribute('aMaxY', 'float');
    const topFrac = positionLocal.y.div(aMaxY);
    const snowCap = smoothstep(0.4, 0.92, topFrac).mul(uSnowBlend).mul(0.7);
    material.colorNode = mix(vColor, vec3(0.93, 0.96, 1.0), snowCap);
    material.side = THREE.DoubleSide;
    return material;
}

function getSharedConiferMaterial(uSnowBlend) {
    let mat = _sharedConiferMaterials.get(uSnowBlend);
    if (!mat) {
        mat = createConiferMaterial(uSnowBlend);
        _sharedConiferMaterials.set(uSnowBlend, mat);
    }
    return mat;
}

/**
 * @param {object} opts
 *   placementsBySpecies: { spruce:[{x,y,z,scale?,rotationY?}], pine:[...], fir:[...] }
 *   uSnowBlend: TSL uniform (0..1) shared with the terrain/mountain snow line
 * @returns {THREE.Group} group with one InstancedMesh per species (loads async)
 */
export function createSnowConiferBelt({ placementsBySpecies = {}, uSnowBlend } = {}) {
    const group = new THREE.Group();
    group.name = 'snow-conifer-belt';
    const uSnow = uSnowBlend ?? uniform(0);
    group.userData.uSnowBlend = uSnow;
    group.userData.assetStatus = 'pending';

    if (typeof window === 'undefined') {
        group.userData.assetStatus = 'deferred-non-browser';
        return group;
    }

    group.userData.loadPromise = (async () => {
        const records = getOdysseyConiferAssetRecords();
        let loaded = 0;
        for (const record of records) {
            const placements = placementsBySpecies[record.id];
            if (!placements || placements.length === 0 || !record.url) continue;
            // eslint-disable-next-line no-await-in-loop
            const gltf = await loadOdysseyGltfCached(record.url);
            let srcGeo = null;
            gltf.scene.traverse((child) => { if (child.isMesh && !srcGeo) srcGeo = child.geometry; });
            if (!srcGeo) continue;

            const geo = srcGeo.clone();
            geo.computeBoundingBox();
            const bb = geo.boundingBox;
            // Seat base at y=0, centre the trunk in xz (the LOD pivots are offset).
            geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
            geo.computeBoundingBox();
            const maxY = geo.boundingBox.max.y;

            const material = getSharedConiferMaterial(uSnow);
            // Per-instance species height for the shared material's snow-cap gradient (uniform
            // across this species' instances). Lets the one material serve fir/pine/spruce.
            const aMaxY = new Float32Array(placements.length).fill(Math.max(0.001, maxY));
            geo.setAttribute('aMaxY', new THREE.InstancedBufferAttribute(aMaxY, 1));
            const mesh = new THREE.InstancedMesh(geo, material, placements.length);
            mesh.name = `snow-conifer-${record.id}`;
            mesh.frustumCulled = false;
            mesh.castShadow = false;
            mesh.receiveShadow = false;

            const dummy = new THREE.Object3D();
            placements.forEach((p, i) => {
                const s = (record.runtimeScale ?? 9) * (p.scale ?? 1);
                dummy.position.set(p.x, p.y ?? 0, p.z);
                dummy.rotation.set(0, p.rotationY ?? 0, 0);
                dummy.scale.setScalar(s);
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
            });
            mesh.instanceMatrix.needsUpdate = true;
            group.add(mesh);
            loaded += 1;
        }
        group.userData.assetStatus = loaded > 0 ? 'loaded' : 'empty';
    })().catch((err) => {
        group.userData.assetStatus = 'error';
        group.userData.loadError = err?.message || String(err);
        // eslint-disable-next-line no-console
        console.warn('[Odyssey] snow-conifer belt failed', err);
    });

    return group;
}

/**
 * Build a terrain-anchored tree-line placement set for a foothill/upper zone.
 * Density thins toward the snow line; species shift spruce(low) → pine → fir(high), so the
 * belt reads as a real tree line. `sampleHeight(x,z)` returns terrain height (or null to skip).
 */
export function buildConiferBeltPlacements({
    count = 140,
    area = { x: 320, zMin: -300, zMax: -60 },
    heightBand = { base: 7, line: 26 }, // trees from `base` height up to the `line` (snow line)
    sampleHeight,
    yOffset = -0.4,
}) {
    const out = { spruce: [], pine: [], fir: [] };
    let guard = 0;
    let placed = 0;
    const span = area.zMax - area.zMin;
    while (placed < count && guard < count * 14) {
        guard += 1;
        const x = (Math.random() - 0.5) * area.x;
        const z = area.zMin + Math.random() * span;
        const h = sampleHeight(x, z);
        if (h == null || h < heightBand.base || h > heightBand.line) continue;
        // Altitude fraction 0(base)→1(tree line); density thins toward the line.
        const alt = (h - heightBand.base) / Math.max(1, heightBand.line - heightBand.base);
        if (Math.random() > (1.0 - alt * 0.7)) continue; // thinner higher up
        // Species by altitude: green spruce dominates the lower belt, pine mid; the white/snowy
        // fir is reserved for the very top so the lower meadow tree-line reads green, not frosted.
        let species = 'fir';
        if (alt < 0.55) species = 'spruce';
        else if (alt < 0.85) species = 'pine';
        const scale = (0.7 + Math.random() * 0.7) * (1.0 - alt * 0.35); // smaller near the line
        out[species].push({
            x, y: h + yOffset, z, scale, rotationY: Math.random() * Math.PI * 2,
        });
        placed += 1;
    }
    return out;
}
