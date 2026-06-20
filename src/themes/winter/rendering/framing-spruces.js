import * as THREE from 'three/webgpu';

// ─────────────────────────────────────────────────────────────────────────────
// FramingSpruces — Firewatch-style snow-laden spruces, built procedurally.
//
// Built as STACKED faceted drooping cone-tiers (the classic low-poly spruce: distinct
// skirt tiers with chunky polygonal drooping rims, stacked + tapering to a pointed
// spire) — matching the user's reference. Each green tier gets a smaller white snow
// cone resting on its upper part (the green rim pokes out below); a thin trunk at the
// base. Flat-shaded + matte for the bold low-poly read; per-vertex radius/height jitter
// gives the chunky organic rim. All procedural BufferGeometry — no GLBs.
//
// 3 parametric variants (slim / full / classic) so the forest isn't clones. All
// geometry is unit-height (base at y=0) → world height is just the instance scale.
//
//   • placeFraming() — close-camera hero spruces framing the LEFT & RIGHT edges
//                      (cloned, varied variant + yaw + subtle sway).
//   • placeTreeline() — the mid-ground belt, variants spread across instanced draws.
//
// Lit by the scene's moon key + cool fill; colour-matched to the cold palette (soft
// cool-white snow, bold cool spruce green). Tune the profile params + COLOURS below
// and HMR shows it instantly — no asset round-trip.
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: these are OVERSHOT bright/warm on purpose. In-game the whole frame is graded
// through WinterPipeline (exposure 0.82 + ACES + cold tint cutting red / boosting blue)
// which crushes a "correct" dark green to near-black — so the albedo must be much
// brighter here than it looks right in the flat playground. Tune against the in-game
// (full-screen) render, not the playground.
const GREEN = 0x4a7a4f; // deep spruce green (overshot a bit so it survives the grade)
const SNOW = 0xe6eef4; // bright soft cool-white snow
const TRUNK = 0x2c241d;

// Per-variant shape: STACKED faceted drooping cone-tiers (the reference low-poly
// spruce). `tiers` = number of skirts, `Rbase` = bottom radius, `taper` = how fast they
// shrink to the top, `segs` = facets per tier (low = chunky/low-poly).
const VARIANTS = [
    {
        key: 'slim', Rbase: 0.30, tiers: 5, segs: 9, taper: 0.86, trunkR: 0.05, folBase: 0.10, leader: 0.10, seed: 11,
    },
    {
        key: 'full', Rbase: 0.46, tiers: 8, segs: 11, taper: 0.80, trunkR: 0.065, folBase: 0.08, leader: 0.03, seed: 23,
    },
    {
        key: 'classic', Rbase: 0.37, tiers: 6, segs: 10, taper: 0.84, trunkR: 0.058, folBase: 0.10, leader: 0.06, seed: 7,
    },
];

// Tiny deterministic RNG (Park–Miller LCG, no bitwise) so a variant's silhouette is
// stable across reloads.
function makeRng(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

// One faceted drooping cone tier: an apex at the top-centre + a polygonal rim that
// sags down & out (per-vertex radius/height jitter → the chunky pointed low-poly rim).
function addTier(pos, idx, apexY, baseY, R, N, rotOff, rng, rJit, yJit) {
    const a0 = pos.length / 3;
    pos.push(0, apexY, 0);
    for (let k = 0; k < N; k += 1) {
        const a = rotOff + (k / N) * Math.PI * 2;
        const rr = R * (1 + (rng() - 0.5) * rJit);
        const yy = baseY - rng() * yJit;
        pos.push(Math.cos(a) * rr, yy, Math.sin(a) * rr);
    }
    for (let k = 0; k < N; k += 1) {
        idx.push(a0, a0 + 1 + ((k + 1) % N), a0 + 1 + k);
    }
}

function makeGeo(pos, idx) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}

function buildVariant(p) {
    const rng = makeRng(p.seed);
    const T = p.tiers;
    const top = 1.0;
    const step = (top - p.folBase) / T;
    const tierH = step * 1.85; // each skirt droops ~1.85 steps → overlaps the one below
    const N = p.segs;
    const gp = []; const gi = []; const sp = []; const si = [];
    for (let i = 0; i < T; i += 1) {
        const tt = i / (T - 1);
        const apexY = p.folBase + (i + 1) * step;
        const baseY = apexY - tierH;
        const R = p.Rbase * (1 - tt * p.taper) + 0.02;
        const rot = i * 0.7;
        addTier(gp, gi, apexY, baseY, R, N, rot, rng, 0.16, tierH * 0.32);
        // snow cap: a smaller white cone resting on the upper part of this tier; the
        // green drooping rim pokes out below it.
        addTier(sp, si, apexY + 0.006, apexY - tierH * 0.52, R * 0.66, N, rot + 0.35, rng, 0.20, tierH * 0.18);
    }
    // sharp top spire (+ its snow)
    addTier(gp, gi, top + p.leader, top - step * 0.7, p.Rbase * 0.06 + 0.02, N, 0, rng, 0.1, step * 0.2);
    addTier(sp, si, top + p.leader + 0.008, top - step * 0.45, p.Rbase * 0.05 + 0.015, N, 0.3, rng, 0.1, step * 0.12);

    const trunkH = p.folBase + 0.05;
    const trunkGeo = new THREE.CylinderGeometry(p.trunkR * 0.55, p.trunkR, trunkH, 6);
    trunkGeo.translate(0, trunkH / 2, 0);
    return [
        { geometry: makeGeo(gp, gi), key: 'green' },
        { geometry: makeGeo(sp, si), key: 'snow' },
        { geometry: trunkGeo, key: 'trunk' },
    ];
}

export function createFramingSpruces(scene, { feetY = -260 } = {}) {
    const group = new THREE.Group();
    group.name = 'winter-framing-spruces';
    scene.add(group);

    // Bold flat, fully MATTE materials (roughness 1 / metalness 0 → no metallic
    // specular), flat-shaded for the Firewatch low-poly block-colour read.
    const mats = {
        green: new THREE.MeshStandardMaterial({
            color: GREEN, flatShading: true, roughness: 1, metalness: 0, side: THREE.DoubleSide,
        }),
        snow: new THREE.MeshStandardMaterial({
            color: SNOW, flatShading: true, roughness: 1, metalness: 0, side: THREE.DoubleSide,
        }),
        trunk: new THREE.MeshStandardMaterial({
            color: TRUNK, flatShading: true, roughness: 1, metalness: 0,
        }),
    };

    /** @type {Array<{ parts: Array<{geometry, material, key}> }>} */
    let variants = [];
    const heroes = []; // { obj, swayAmp, swaySpeed, phase }
    const instMeshes = []; // InstancedMesh list (treeline)

    function load() {
        variants = VARIANTS.map((p) => ({
            parts: buildVariant(p).map(({ geometry, key }) => ({ geometry, material: mats[key], key })),
        }));
        console.log(`[FramingSpruces] built ${variants.length} procedural Firewatch spruce variants.`);
        return Promise.resolve();
    }

    function makeTree(parts) {
        const g = new THREE.Group();
        parts.forEach(({ geometry, material }) => {
            const m = new THREE.Mesh(geometry, material);
            m.frustumCulled = false;
            g.add(m);
        });
        return g;
    }

    // ── CLOSE-camera framing wings (few) ───────────────────────────────────────
    // positions: [x, z, worldHeight] or [x, z, worldHeight, variantIndex].
    function placeFraming(positions = []) {
        if (!variants.length) return;
        positions.forEach(([x, z, h, vi], i) => {
            const v = variants[(vi == null ? i : vi) % variants.length];
            const obj = makeTree(v.parts);
            obj.position.set(x, feetY, z);
            obj.rotation.y = (i * 2.3) % (Math.PI * 2);
            obj.scale.setScalar(h);
            group.add(obj);
            heroes.push({
                obj,
                swayAmp: 0.022 + (i % 3) * 0.006,
                swaySpeed: 0.42 + (i % 4) * 0.06,
                phase: i * 1.3,
            });
        });
    }

    // ── Mid-ground belt (instanced) ────────────────────────────────────────────
    // placements: [{ x, y, z, h, rotY }]. The 3 variants are spread across the belt.
    function placeTreeline(placements = []) {
        if (!variants.length || !placements.length) return;
        const dummy = new THREE.Object3D();
        variants.forEach((v, vi) => {
            const list = placements.filter((_, idx) => idx % variants.length === vi);
            if (!list.length) return;
            v.parts.forEach(({ geometry, material }) => {
                const inst = new THREE.InstancedMesh(geometry, material, list.length);
                inst.frustumCulled = false;
                list.forEach((q, i) => {
                    dummy.position.set(q.x, q.y, q.z);
                    dummy.rotation.set(0, q.rotY ?? 0, 0);
                    dummy.scale.setScalar(q.h);
                    dummy.updateMatrix();
                    inst.setMatrixAt(i, dummy.matrix);
                });
                inst.instanceMatrix.needsUpdate = true;
                group.add(inst);
                instMeshes.push(inst);
            });
        });
        console.log(`[FramingSpruces] treeline: ${placements.length} trees across ${variants.length} variants.`);
    }

    function update(dt) {
        // Gentle breeze: the close hero trees sway by tilting at the base (top moves
        // most). Two harmonics + a small cross-axis wobble keep it organic, not a
        // metronome. Subtle on purpose. (Instanced belt stays still — it's distant.)
        for (const h of heroes) {
            h.phase += dt * h.swaySpeed;
            h.obj.rotation.z = Math.sin(h.phase) * h.swayAmp
                + Math.sin(h.phase * 2.3 + 1.0) * h.swayAmp * 0.3;
            h.obj.rotation.x = Math.cos(h.phase * 0.8 + 0.5) * h.swayAmp * 0.4;
        }
    }

    function dispose() {
        instMeshes.forEach((m) => m.dispose?.());
        variants.forEach((v) => v.parts.forEach((p) => p.geometry?.dispose?.()));
        Object.values(mats).forEach((m) => m.dispose?.());
        instMeshes.length = 0;
        heroes.length = 0;
        variants = [];
        scene.remove(group);
    }

    return {
        group, load, placeFraming, placeTreeline, update, dispose,
    };
}
