import * as THREE from 'three/webgpu';
import {
    positionGeometry, positionLocal, positionWorld, cameraPosition, length, smoothstep, mix, vec3, vec4, uniform, clamp, sin, cos,
    modelWorldMatrix,
} from 'three/tsl';

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

// ── Atmospheric distance fade (aerial perspective, Firewatch-style) ────────────
// Far trees melt toward the cold horizon HAZE so the treeline dissolves into the
// background instead of reading as a busy band of crisp trees — and the tiny far
// tops fade out before they're sub-pixel, killing the shimmer. It's purely
// distance-based, so the CLOSE framing heroes keep full colour automatically (they
// fall below uFadeNear). Same idea as arctic-fox.js's haze fade. Tune the uniforms.
const HAZE = new THREE.Color(0xaec6da); // cool light horizon haze (matches the mist band)
const uHaze = uniform(HAZE);
const uFadeNear = uniform(2000); // world-distance where the haze begins (near treeline keeps green so the silhouette bands behind read as the lighter recession)
const uFadeFar = uniform(3500); // distance where the haze is ~full
const uHazeMax = uniform(0.92); // cap < 1 so a hint of the silhouette survives
// Shared wind clock — advanced each frame; ALL trees sway via their material's
// positionNode (vertex shader), so the instanced belt and the cloned heroes move alike
// with zero per-frame JS. uSwayAmp is local-space → scales with each tree's height.
const uSwayTime = uniform(0);
const uSwayAmp = uniform(0.035);

function makeTreeMat(hex, { snow = false } = {}) {
    const c = new THREE.Color(hex);
    const dist = length(positionWorld.sub(cameraPosition));
    const t = smoothstep(uFadeNear, uFadeFar, dist).mul(uHazeMax);
    const mat = new THREE.MeshStandardNodeMaterial({
        flatShading: true, roughness: 1, metalness: 0, side: THREE.DoubleSide,
    });
    // Mix the albedo toward the (light, cool) haze with distance → far trees lighten +
    // blue-shift and melt into the horizon; near trees stay full green/snow.
    mat.colorNode = mix(vec3(c.r, c.g, c.b), uHaze, t);
    // Gentle wind: bend the tree in the vertex stage — base planted, top sways most
    // (height² mask), two harmonics so it's organic. The phase MUST be constant per tree
    // (from the tree's base/origin, not per-vertex) — otherwise a big close tree shears
    // and the snow layer swims against the green and z-fight-flickers. modelWorldMatrix's
    // translation gives each hero its own phase; the instanced belt shares one (it's far).
    const mask = clamp(positionGeometry.y, 0.0, 1.0);
    const m2 = mask.mul(mask);
    const base = modelWorldMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0)).xz;
    const ph = base.x.mul(0.021).add(base.y.mul(0.017));
    const sx = sin(uSwayTime.mul(0.55).add(ph)).add(sin(uSwayTime.mul(1.3).add(ph.mul(1.7))).mul(0.4));
    const sz = cos(uSwayTime.mul(0.47).add(ph.mul(0.9))).mul(0.75);
    mat.positionNode = positionLocal.add(vec3(sx.mul(m2).mul(uSwayAmp), 0.0, sz.mul(m2).mul(uSwayAmp)));
    if (snow) {
        // keep the z-fight guard from before
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -2;
        mat.polygonOffsetUnits = -8;
    }
    return mat;
}

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

// Snow generosity per use. The distant BELT stays light (cov 0.64, no crown/clumps →
// cheap + no shimmer). The close HEROES get lavish snow: wider caps, heavier toward the
// top, a snowy crown, and soft snow clumps clinging to the branch layers.
const BELT_SNOW = {
    cov: 0.64, depth: 0.40, puff: 0.02, jit: 0.20, topHeavy: 0.0, crown: false, dollops: 0,
};
const HERO_SNOW = {
    cov: 0.90, depth: 0.62, puff: 0.06, jit: 0.22, topHeavy: 0.18, crown: true, dollops: 0,
};

// A small low-poly snow clump (a faceted mound) — the "snow clinging to a bough" detail.
function addBlob(pos, idx, cx, cy, cz, r, h, sides, rng) {
    const a0 = pos.length / 3;
    pos.push(cx, cy + h, cz);
    for (let k = 0; k < sides; k += 1) {
        const a = (k / sides) * Math.PI * 2;
        const rr = r * (0.8 + rng() * 0.4);
        pos.push(cx + Math.cos(a) * rr, cy - h * 0.25 * rng(), cz + Math.sin(a) * rr);
    }
    for (let k = 0; k < sides; k += 1) idx.push(a0, a0 + 1 + ((k + 1) % sides), a0 + 1 + k);
}

function buildVariant(p, snow = BELT_SNOW) {
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
        // Less rim jitter toward the top — small upper tiers with big jitter make thin
        // slivers that shimmer (sub-pixel) on the far treeline.
        const jt = 1 - tt * 0.5;
        addTier(gp, gi, apexY, baseY, R, N, rot, rng, 0.16 * jt, tierH * 0.32 * jt);
        // snow cap on the upper part of the tier; wider + deeper on heroes, heavier
        // toward the top (topHeavy). The green drooping rim pokes out below it.
        const cov = R * (snow.cov + tt * snow.topHeavy);
        addTier(sp, si, apexY + snow.puff, apexY - tierH * snow.depth, cov, N, rot + 0.35, rng, snow.jit * jt, tierH * 0.16 * jt);
        // Optional soft snow clumps (off by default). Seated ON the tier's drooping
        // surface (surfaceY follows the slope) + flat mounds, so they don't float off
        // as stray triangles.
        for (let d = 0; d < snow.dollops; d += 1) {
            const f = 0.45 + rng() * 0.38; // radial fraction across the tier
            const rad = R * f;
            const a = rng() * Math.PI * 2;
            const br = R * (0.11 + rng() * 0.08);
            const surfaceY = apexY - tierH * f; // the tier surface height at that radius
            addBlob(sp, si, Math.cos(a) * rad, surfaceY + br * 0.2, Math.sin(a) * rad, br, br * 0.6, 6, rng);
        }
    }
    // Pointed top spire (+ a snowy crown cap on heroes).
    addTier(gp, gi, top + p.leader, top - step * 0.78, p.Rbase * 0.05 + 0.017, N, 0, rng, 0.05, step * 0.14);
    if (snow.crown) {
        // small clean cap nested ON the crown (matched to its width so it doesn't flare
        // into a stray triangle at the very top).
        addTier(sp, si, top + p.leader + 0.012, top - step * 0.52, p.Rbase * 0.045 + 0.02, N, 0.3, rng, 0.05, step * 0.1);
    }

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
    // Flat-shaded low-poly block-colour materials with the atmospheric distance-haze
    // fade baked in (makeTreeMat). Snow keeps the polygonOffset z-fight guard.
    const mats = {
        green: makeTreeMat(GREEN),
        snow: makeTreeMat(SNOW, { snow: true }),
        trunk: makeTreeMat(TRUNK),
    };

    /** @type {Array<{ parts: Array<{geometry, material, key}> }>} */
    let variants = []; // distant belt (light snow)
    let heroVariants = []; // close framing trees (lavish snow)
    const heroes = []; // { obj, swayAmp, swaySpeed, phase }
    const instMeshes = []; // InstancedMesh list (treeline)

    function load() {
        const wrap = (parts) => parts.map(({ geometry, key }) => ({ geometry, material: mats[key], key }));
        variants = VARIANTS.map((p) => ({ parts: wrap(buildVariant(p, BELT_SNOW)) }));
        heroVariants = VARIANTS.map((p) => ({ parts: wrap(buildVariant(p, HERO_SNOW)) }));
        console.log(`[FramingSpruces] built ${variants.length} spruce variants (belt + snowy hero sets).`);
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
        if (!heroVariants.length) return;
        positions.forEach(([x, z, h, vi], i) => {
            const v = heroVariants[(vi == null ? i : vi) % heroVariants.length];
            const obj = makeTree(v.parts);
            obj.position.set(x, feetY, z);
            obj.rotation.y = (i * 2.3) % (Math.PI * 2);
            obj.scale.setScalar(h);
            group.add(obj);
            heroes.push(obj);
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
        // Advance the shared wind clock — every tree (belt + heroes) sways via its
        // material's positionNode (vertex shader). No per-frame matrix work.
        uSwayTime.value += dt;
    }

    function dispose() {
        instMeshes.forEach((m) => m.dispose?.());
        variants.forEach((v) => v.parts.forEach((p) => p.geometry?.dispose?.()));
        heroVariants.forEach((v) => v.parts.forEach((p) => p.geometry?.dispose?.()));
        Object.values(mats).forEach((m) => m.dispose?.());
        instMeshes.length = 0;
        heroes.length = 0;
        variants = [];
        heroVariants = [];
        scene.remove(group);
    }

    return {
        group, load, placeFraming, placeTreeline, update, dispose,
    };
}
