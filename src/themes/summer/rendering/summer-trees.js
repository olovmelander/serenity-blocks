/* eslint-disable import/no-unresolved */
/**
 * SummerTrees — all-procedural LOW-POLY forest (spruce / pine / birch) with unified
 * TSL vertex wind. No GLBs, no per-frame JS sway.
 *
 * Each species is a single InstancedMesh sharing ONE wind material that is INJECTED from
 * the meadow effect (`makeTreeMat`), so the trees share the scene's `uTime`/`uBreeze`
 * clock and its `shade()`/`distFog()` look. Per-instance world-XZ phase (`aWorldXZ`)
 * desyncs neighbouring trees and feeds the world-coherent gust — the same instancing
 * pattern the grass/flowers use (positionNode runs before instanceMatrix, so wind bends
 * in LOCAL tree space and the gust is sampled at the per-instance attribute).
 *
 * Geometry comes from summer-flora.js (unit-height templates, baked vertex colour); the
 * InstancedMesh scale sets each tree's world height.
 */
import * as THREE from 'three/webgpu';

// Keep-out clearing around the cottage — the stuga sits in open lawn (reference).
const COTTAGE = { x: 72, z: -141, clearR: 34 };
const farOfCottage = (x, z) => Math.hypot(x - COTTAGE.x, z - COTTAGE.z) > COTTAGE.clearR;

export function createSummerTrees(scene, ctx = {}) {
    const { makeTreeMat, treeGeos = {} } = ctx;
    if (typeof makeTreeMat !== 'function') {
        console.warn('[SummerTrees] no makeTreeMat injected — trees will be skipped.');
    }
    const group = new THREE.Group();
    group.name = 'summer-trees';
    scene.add(group);

    const geos = [];
    const meshes = [];

    // One unit-height Blender template geometry + one wind material per species. Trees sway
    // VERY slowly & subtly: low `freq` (≈⅙ the flowers' rate), small amplitude, stiff base —
    // a barely-perceptible drift in the crowns, not a fast wobble.
    const SPECIES = makeTreeMat ? Object.fromEntries(
        [
            ['spruce', treeGeos.spruce, {
                amp: 0.022, stiff: 2.8, flutter: 0.006, freq: 0.16,
            }],
            ['pine', treeGeos.pine, {
                amp: 0.022, stiff: 3.0, flutter: 0.006, freq: 0.16,
            }],
            ['birch', treeGeos.birch, {
                amp: 0.03, stiff: 2.3, flutter: 0.012, freq: 0.2,
            }],
        ].filter(([, g]) => g).map(([k, g, w]) => [k, { geo: g, mat: makeTreeMat({ height: 1.0, ...w }), list: [] }]),
    ) : {};
    Object.values(SPECIES).forEach((s) => geos.push(s.geo));

    const rand = (a, b) => a + Math.random() * (b - a);
    const push = (key, x, z, h) => SPECIES[key]?.list.push({
        x, z, h, rotY: Math.random() * Math.PI * 2,
    });

    function buildPlacements() {
        // NEAR framing — conifers hug the LEFT edge, birch the RIGHT edge (like the ref).
        [[-22, -6, 16], [-30, -11, 15], [-38, -16, 13.5], [-44, -20, 12.5], [-26, -9, 13], [-34, -14, 12]]
            .forEach(([x, z, h], i) => push(i % 3 === 2 ? 'pine' : 'spruce', x, z, h));
        [[22, -6, 19], [30, -11, 18], [38, -16, 16], [44, -20, 14.5], [26, -9, 15], [34, -14, 14]]
            .forEach(([x, z, h], i) => push(i % 3 === 2 ? 'pine' : 'birch', x, z, h));

        // FAR-shore feature trees flanking the cottage clearing.
        [[-42, -146, 18], [28, -152, 14], [116, -152, 15], [-68, -156, 19]]
            .forEach(([x, z, h], i) => push(i === 1 ? 'birch' : 'spruce', x, z, h));

        // FAR ridge — three dense bands of conifers (+ a scattering of birch/pine) walked
        // across X with jitter, receding toward the hills; cottage clearing kept empty.
        const BANDS = [
            {
                step: 6, jit: 3, zBase: -132, zRand: 12, hMin: 11, hMax: 17,
            },
            {
                step: 8, jit: 4, zBase: -146, zRand: 14, hMin: 9, hMax: 13,
            },
            {
                step: 11, jit: 5, zBase: -160, zRand: 14, hMin: 7, hMax: 11,
            },
        ];
        for (const bnd of BANDS) {
            for (let x = -200; x <= 200; x += bnd.step) {
                const jx = x + rand(-bnd.jit, bnd.jit);
                const z = bnd.zBase - Math.random() * bnd.zRand;
                if (!farOfCottage(jx, z)) continue;
                const r = Math.random();
                const key = r < 0.74 ? 'spruce' : (r < 0.88 ? 'pine' : 'birch');
                push(key, jx, z, rand(bnd.hMin, bnd.hMax));
            }
        }
    }

    function build() {
        const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        const yA = new THREE.Vector3(0, 1, 0);
        let total = 0;
        for (const key of Object.keys(SPECIES)) {
            const sp = SPECIES[key];
            if (!sp.list.length) continue;
            const inst = new THREE.InstancedMesh(sp.geo, sp.mat, sp.list.length);
            const aWorldXZ = new Float32Array(sp.list.length * 2);
            sp.list.forEach((t, i) => {
                p.set(t.x, 0, t.z); q.setFromAxisAngle(yA, t.rotY); s.set(t.h, t.h, t.h);
                m.compose(p, q, s); inst.setMatrixAt(i, m);
                aWorldXZ[i * 2] = t.x; aWorldXZ[i * 2 + 1] = t.z;
            });
            inst.instanceMatrix.needsUpdate = true;
            sp.geo.setAttribute('aWorldXZ', new THREE.InstancedBufferAttribute(aWorldXZ, 2));
            inst.frustumCulled = false;
            group.add(inst);
            meshes.push(inst);
            total += sp.list.length;
        }
        console.log(`[SummerTrees] Placed ${total} low-poly trees (3 instanced species, TSL wind).`);
    }

    return {
        group,
        load: async () => {}, // no async assets
        placeForest: () => { buildPlacements(); build(); },
        update: () => {}, // wind is 100% in-shader
        dispose: () => {
            meshes.forEach((mh) => group.remove(mh));
            geos.forEach((g) => g.dispose());
            scene.remove(group);
        },
    };
}
