/**
 * ACT II CLOUD FIELD — THE SCULPTOR (cloud-field plan Wave 1).
 *
 * Wave 0 settled two things with measurements: opaque cloud geometry is cheap on Lane B
 * (~0.131 ms fixed + ~0.0094 ms per mass, gate F1 passed at 0.393 ms for 28 masses), and the
 * Witness paint stack clears the reference bar (shade/lit 0.676 against a 0.63-0.72 band). It
 * also settled what was still WRONG: the probe's masses are a bag of balls wearing good paint.
 * You can count the spheres. This module exists to fix exactly that, and nothing else.
 *
 * WHY NOT MARCHING CUBES. The design named marching cubes (three.js addon, isolation sign
 * flip) as the polygoniser. It is not needed here and it costs more than it returns: a cumulus
 * mass is STAR-SHAPED about its own centre — every ray from the centre crosses the surface
 * exactly once, including straight down, where the flat base is simply the first crossing.
 * So the surface can be found by RAY-MARCHING an icosphere's directions outward-in, which
 * gives, for free, three things a marching-cubes mesh has to be repaired into having:
 *   - a closed watertight hull with no isolated shells or stray fragments,
 *   - an even, predictable vertex distribution (an icosphere's) with an exact triangle count
 *     per LOD, which is what the measured per-mass price is budgeted against,
 *   - normals taken from the SDF GRADIENT, which is continuous ACROSS a smooth-min join by
 *     construction. That gradient is the "melting": where two lobes merge, the normal turns
 *     smoothly through the joint instead of creasing, and no amount of shader-side normal
 *     blending can manufacture that from per-lobe radial normals (which is precisely what the
 *     retired heroes had, and precisely why they read as separate balls).
 * The one thing this trades away is overhangs. Cumulus in the reference images have none that
 * read at silhouette scale, so the trade is free here — and it is written down so a future
 * mass that NEEDS an overhang knows it must change polygoniser, not fight this one.
 *
 * WHAT THE SHAPE IS MADE OF, in the order it is assembled:
 *   1. LOBES — the hero grammar, kept because it was owner-approved as composition: 2-4
 *      primaries sharing one centre height, 4-6 secondaries seated on their rims, 6-9 crown
 *      scallops above the waist. Here they are DATA (centre, radius, squash), not geometry.
 *   2. SMOOTH-MIN UNION — the melt. `k` scales with the mass so a big cloud melts as much,
 *      proportionally, as a small one.
 *   3. SMOOTH-MAX AGAINST THE BASE PLANE — the flat condensation line every reference cumulus
 *      sits on, filleted rather than sliced. NOT a vertex clamp: clamping collapses the bottom
 *      cap to zero-area triangles and, under FrontSide culling, opens a hole (the trap the
 *      retired builder documents at its `place()`).
 *   4. A NOISE CRINKLE on the field, so the outline is cauliflower rather than a smooth blob.
 *      All high-frequency detail belongs in the SILHOUETTE (the look rules); interiors stay
 *      flat, which is why this perturbs the surface and never the shading.
 *
 * WHAT IS BAKED INTO THE VERTICES (all free at runtime):
 *   - `normal`: the SDF gradient (see above).
 *   - `aMassCentre`: the mass's own centre, for the shader's Witness centroid bend. Baked here
 *     rather than derived, because after the merge the per-mass vertex mapping is gone.
 *   - `color.r`: analytic ambient occlusion, so crevices between lobes darken and the mass
 *     reads as grouped rather than as one smooth potato. Consumed as a BAND-THRESHOLD shift,
 *     never as a colour multiply (the look rules: interiors stay flat).
 *   - `color.g`: normalised height within the mass (0 at the base, 1 at the crown).
 *   - `color.b`: a per-mass random, so sibling masses can be de-synchronised without a second
 *     attribute.
 */
import * as THREE from 'three';
import { makeRng } from './odyssey-hero-clouds.js';

/** Blend width of the lobe melt, as a fraction of the mass half-width. */
const SMIN_K = 0.16;
/** Blend width of the flat-base fillet, as a fraction of the mass half-width. */
const BASE_FILLET_K = 0.07;
/** Silhouette crinkle: amplitude as a fraction of half-width, and its spatial frequency. */
const CRINKLE_AMP = 0.055;
const CRINKLE_FREQ = 3.1;
/**
 * SPHERE-TRACING budget. The march steps INWARD from outside the hull by the field's own
 * value, which converges on the first crossing geometrically instead of linearly — a fixed
 * 48-step march measured 15.6 us per vertex, which is ~1.2 s for a whole field and blows the
 * 250 ms bake budget on its own. `SAFETY` under 1 is required because the crinkle makes the
 * field a NON-exact distance (it can locally exceed a Lipschitz constant of 1), and a full
 * step could tunnel through a thin scallop.
 */
const MARCH_STEPS = 24;
const MARCH_BISECT = 14;
const MARCH_SAFETY = 0.75;

/**
 * Icosphere subdivision per LOD.
 *
 * ⚠️ three's `IcosahedronGeometry(r, detail)` is **20 * (detail + 1)^2** faces, NOT 20 * 4^detail
 * — verified against the installed r181 (detail 1/2/3/4 -> 80/180/320/500 faces). The first
 * draft of this file assumed the 4^d form, picked "detail 3" believing it was 1280 triangles,
 * and would have shipped a quarter of the intended geometry.
 * near 6 -> 980, mid 3 -> 320, far 1 -> 80 faces.
 */
export const CLOUD_FIELD_LOD_DETAIL = Object.freeze({ near: 6, mid: 3, far: 1 });

function hash3(x, y, z) {
    let h = ((x | 0) * 374761393) + ((y | 0) * 668265263) + ((z | 0) * 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Trilinear value noise in 3-D — the 2-D one in odyssey-world-height.js, one dimension up. */
function valueNoise3(x, y, z) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;
    const ux = fx * fx * (3 - (2 * fx));
    const uy = fy * fy * (3 - (2 * fy));
    const uz = fz * fz * (3 - (2 * fz));
    const lerp = (a, b, t) => a + ((b - a) * t);
    const c00 = lerp(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), ux);
    const c10 = lerp(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), ux);
    const c01 = lerp(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), ux);
    const c11 = lerp(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), ux);
    return lerp(lerp(c00, c10, uy), lerp(c01, c11, uy), uz);
}

/**
 * Quilez's polynomial smooth-min — THE MELT.
 *
 * Deliberately NOT `smoothMax` from odyssey-world-height.js: that one scales `k` by the
 * inputs' magnitude to protect the terrain from a constant lift, which is right there and
 * wrong here — an SDF must keep its blend width constant near the surface, where the values
 * pass through zero, or the join stops melting exactly where the melt is visible.
 */
function smin(a, b, k) {
    if (k <= 1e-6) return Math.min(a, b);
    const h = Math.max(0, Math.min(1, 0.5 + ((0.5 * (b - a)) / k)));
    return (b * (1 - h)) + (a * h) - (k * h * (1 - h));
}

/** Smooth intersection, by De Morgan on the union. */
function smax(a, b, k) {
    return -smin(-a, -b, k);
}

/**
 * The lobe layout for one mass — the hero grammar as DATA.
 *
 * Kept deliberately close to `buildHeroCloudGeometry`'s placement code: that composition was
 * owner-approved, and only the MODEL (glued spheres) failed. Sizes stay irregular on purpose;
 * evenly-sized lobes read as soap bubbles even after they melt.
 */
export function buildCloudLobes(spec) {
    const rnd = makeRng(spec.seed);
    const halfW = spec.w / 2;
    const cosY = Math.cos(spec.yaw || 0);
    const sinY = Math.sin(spec.yaw || 0);
    const lobes = [];
    const primY = spec.base + (spec.h * 0.42);
    const push = (lx, ly, lz, r, squash) => {
        lobes.push({
            x: spec.x + ((lx * cosY) - (lz * sinY)),
            y: ly,
            z: spec.z + ((lx * sinY) + (lz * cosY)),
            r,
            squash,
        });
    };

    const nPrim = 2 + Math.floor(rnd() * 2);
    const primR = [];
    const primPos = [];
    const primSquash = 0.62 + (rnd() * 0.10);
    for (let i = 0; i < nPrim; i += 1) {
        const r = halfW * (0.34 + (rnd() * 0.12));
        const lx = (rnd() - 0.5) * spec.w * 0.40;
        const lz = (rnd() - 0.5) * spec.w * 0.22;
        primR.push(r);
        primPos.push([lx, lz]);
        push(lx, primY, lz, r, primSquash);
    }

    const nSec = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < nSec; i += 1) {
        const host = i % nPrim;
        const [hx, hz] = primPos[host];
        const a = rnd() * Math.PI * 2;
        const seat = primR[host] * (0.55 + (rnd() * 0.35));
        push(
            hx + (Math.cos(a) * seat),
            primY + (spec.h * (0.10 + (rnd() * 0.22))),
            hz + (Math.sin(a) * seat * 0.7),
            halfW * (0.16 + (rnd() * 0.09)),
            0.75 + (rnd() * 0.15),
        );
    }

    const nTer = 6 + Math.floor(rnd() * 4);
    for (let i = 0; i < nTer; i += 1) {
        const host = i % nPrim;
        const [hx, hz] = primPos[host];
        const a = rnd() * Math.PI * 2;
        const seat = primR[host] * (0.4 + (rnd() * 0.5));
        push(
            hx + (Math.cos(a) * seat),
            Math.max(spec.base + (spec.h * 0.52), primY + (spec.h * (0.28 + (rnd() * 0.2)))),
            hz + (Math.sin(a) * seat * 0.7),
            halfW * (0.08 + (rnd() * 0.06)),
            0.85,
        );
    }
    return lobes;
}

/**
 * The signed distance to one mass's surface. Negative inside.
 *
 * @param {object} spec
 * @param {Array<object>} lobes from `buildCloudLobes`
 * @param {number} x @param {number} y @param {number} z
 * @param {boolean} [withCrinkle] the noise term is skipped by the clearance validator, which
 *   wants the smooth hull (a crinkle can only pull the surface OUTWARD by CRINKLE_AMP, and the
 *   validator's margin already covers it — see `cloudFieldClearance`).
 */
export function cloudMassSdf(spec, lobes, x, y, z, withCrinkle = true) {
    const halfW = spec.w / 2;
    const k = halfW * SMIN_K;
    let d = Infinity;
    for (let i = 0; i < lobes.length; i += 1) {
        const l = lobes[i];
        const dx = x - l.x;
        const dy = (y - l.y) / l.squash;
        const dz = z - l.z;
        const q = (dx * dx) + (dy * dy) + (dz * dz);
        // EARLY-OUT before the sqrt. Beyond `d + k` a lobe cannot change the smooth-min at all,
        // and this inner loop runs ~30 times per vertex across a whole field — the sqrt is the
        // single hottest instruction in the bake.
        if (i > 0) {
            const bound = d + k + l.r;
            if (bound > 0 && q > bound * bound) continue;
        }
        // Scaled-sphere approximation to the ellipsoid distance: exact along the axes, and
        // conservative between them, which is all a ray-march and a clearance test need.
        const dist = (Math.sqrt(q) - l.r) * Math.min(1, l.squash);
        d = i === 0 ? dist : smin(d, dist, k);
    }
    // THE FLAT BASE, filleted rather than sliced.
    d = smax(d, spec.base - y, halfW * BASE_FILLET_K);
    if (!withCrinkle) return d;
    const f = CRINKLE_FREQ / spec.w;
    return d - ((valueNoise3(x * f, y * f, z * f) - 0.5) * halfW * CRINKLE_AMP);
}

/** How far a mass can possibly extend from its own centre — the ray-march's outer bound. */
function massReach(spec, lobes) {
    const cy = spec.base + (spec.h * 0.42);
    let reach = 0;
    lobes.forEach((l) => {
        const d = Math.hypot(l.x - spec.x, (l.y - cy) / Math.max(l.squash, 1e-3), l.z - spec.z);
        reach = Math.max(reach, d + (l.r / Math.max(l.squash, 1e-3)));
    });
    // The crinkle can push the surface outward, and the base fillet reaches below the lobes.
    return Math.max(reach * 1.12, cy - spec.base) + ((spec.w / 2) * CRINKLE_AMP);
}

/**
 * Sculpt ONE mass into a closed hull.
 *
 * @param {object} spec
 * @param {number} detail icosphere subdivision — see CLOUD_FIELD_LOD_DETAIL
 * @returns {{ position: Float32Array, normal: Float32Array, centre: Float32Array,
 *   colour: Float32Array, triangles: number }}
 */
export function sculptCloudMass(spec, detail) {
    const lobes = buildCloudLobes(spec);
    const cy = spec.base + (spec.h * 0.42);
    const reach = massReach(spec, lobes);
    const halfW = spec.w / 2;
    const eps = halfW * 0.02;
    const massRandom = makeRng(spec.seed + 991)();

    // The direction set. IcosahedronGeometry is non-indexed, so shared corners appear several
    // times — harmless and in fact load-bearing: displacement and normal are PURE functions of
    // direction, so duplicated vertices land on identical positions and the hull stays
    // watertight with no welding step.
    const sphere = new THREE.IcosahedronGeometry(1, detail);
    const dirs = sphere.attributes.position.array;
    const { count } = sphere.attributes.position;
    sphere.dispose();

    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const centre = new Float32Array(count * 3);
    const colour = new Float32Array(count * 3);

    const sdf = (x, y, z) => cloudMassSdf(spec, lobes, x, y, z);
    // The star-shaped assumption in one line: every ray is traced from this point outward, so
    // if it is not inside the field the whole module's premise is void for this spec. Cheaper
    // to fail loudly at build time than to ship a mass with an inside-out hull.
    // ⚠️ WRITTEN AS `!(d < 0)`, NOT `d >= 0`, and that is not a style choice: a zero-width
    // spec divides by `w` in the crinkle term and yields NaN, and `NaN >= 0` is FALSE — the
    // first version of this guard waved a NaN field straight through into geometry. The
    // negated form rejects NaN, zero and positive alike.
    const centreD = sdf(spec.x, cy, spec.z);
    if (!(centreD < 0)) {
        throw new Error(
            `[cloud-field] mass ${spec.id}: centre is outside its own field (sdf ${centreD})`,
        );
    }

    for (let v = 0; v < count; v += 1) {
        const dx = dirs[v * 3];
        const dy = dirs[(v * 3) + 1];
        const dz = dirs[(v * 3) + 2];

        // MARCH INWARD from outside and take the FIRST crossing, which is the OUTERMOST
        // surface. Marching outward from the centre would find the same point for a convex
        // hull but the wrong one the moment a crinkle carves a dimple through the field.
        // tLo is ALWAYS a point known to be inside and tHi one known to be outside, so the
        // pair brackets the surface at every exit from this loop and the bisection below is
        // unconditionally valid. tLo starts at 0 — the mass centre, which is inside by
        // construction (asserted once per mass above).
        //
        // ⚠️ DO NOT "handle" an exhausted march by collapsing the vertex to the centre. The
        // first draft did, and 65 of 2940 vertices on a single mass took that path — grazing
        // directions simply need more steps than the budget — punching spikes straight through
        // the hull. Running out of steps does not mean the ray missed; it means the bracket is
        // merely wider than usual, and bisection closes it just the same.
        let tHi = reach;
        let tLo = 0;
        let t = reach;
        const minStep = reach * 0.004;
        for (let i = 0; i < MARCH_STEPS; i += 1) {
            const s = sdf(spec.x + (dx * t), cy + (dy * t), spec.z + (dz * t));
            if (s <= 0) { tLo = t; break; }
            tHi = t;
            t -= Math.max(s * MARCH_SAFETY, minStep);
            if (t <= 0) break;
        }
        for (let i = 0; i < MARCH_BISECT; i += 1) {
            const tm = (tLo + tHi) * 0.5;
            if (sdf(spec.x + (dx * tm), cy + (dy * tm), spec.z + (dz * tm)) <= 0) tLo = tm;
            else tHi = tm;
        }
        const tHit = tLo;
        const px = spec.x + (dx * tHit);
        const py = cy + (dy * tHit);
        const pz = spec.z + (dz * tHit);
        position[v * 3] = px;
        position[(v * 3) + 1] = py;
        position[(v * 3) + 2] = pz;

        // THE MELT, made visible: the gradient of the smooth-min field turns continuously
        // through a lobe join, so the shading has no crease where two lobes meet.
        let nx = sdf(px + eps, py, pz) - sdf(px - eps, py, pz);
        let ny = sdf(px, py + eps, pz) - sdf(px, py - eps, pz);
        let nz = sdf(px, py, pz + eps) - sdf(px, py, pz - eps);
        const nl = Math.hypot(nx, ny, nz);
        if (nl > 1e-9) { nx /= nl; ny /= nl; nz /= nl; } else { nx = dx; ny = dy; nz = dz; }
        normal[v * 3] = nx;
        normal[(v * 3) + 1] = ny;
        normal[(v * 3) + 2] = nz;

        centre[v * 3] = spec.x;
        centre[(v * 3) + 1] = cy;
        centre[(v * 3) + 2] = spec.z;

        // ANALYTIC AO (the SDF form): step along the normal and compare the free distance to
        // the distance actually available. In a crevice between two lobes the field stays near
        // zero while the step grows, so the ratio collapses — which is exactly the grouping cue
        // that stops a melted mass reading as one smooth potato.
        let occ = 0;
        let weight = 0;
        for (let i = 1; i <= 3; i += 1) {
            const h = (i / 3) * halfW * 0.35;
            const w = 1 / (2 ** i);
            const free = Math.max(0, h - Math.abs(sdf(px + (nx * h), py + (ny * h), pz + (nz * h))));
            occ += (w * free) / h;
            weight += w;
        }
        colour[v * 3] = Math.max(0, Math.min(1, 1 - (occ / Math.max(weight, 1e-6))));
        colour[(v * 3) + 1] = Math.max(0, Math.min(1, (py - spec.base) / Math.max(spec.h, 1e-3)));
        colour[(v * 3) + 2] = massRandom;
    }

    return {
        position, normal, centre, colour, triangles: count / 3,
    };
}

/**
 * Sculpt a whole field and hand-merge it into ONE geometry.
 *
 * @param {ReadonlyArray<object>} specs each with a `lod` key naming a CLOUD_FIELD_LOD_DETAIL entry
 * @returns {{ geometry: THREE.BufferGeometry, triangles: number, masses: number }}
 */
export function buildCloudFieldGeometry(specs) {
    const parts = specs.map((spec) => sculptCloudMass(
        spec,
        CLOUD_FIELD_LOD_DETAIL[spec.lod] ?? CLOUD_FIELD_LOD_DETAIL.mid,
    ));
    let verts = 0;
    parts.forEach((p) => { verts += p.position.length / 3; });

    const position = new Float32Array(verts * 3);
    const normal = new Float32Array(verts * 3);
    const centre = new Float32Array(verts * 3);
    const colour = new Float32Array(verts * 3);
    let off = 0;
    parts.forEach((p) => {
        position.set(p.position, off);
        normal.set(p.normal, off);
        centre.set(p.centre, off);
        colour.set(p.colour, off);
        off += p.position.length;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('aMassCentre', new THREE.BufferAttribute(centre, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
    geometry.computeBoundingSphere();
    return { geometry, triangles: verts / 3, masses: specs.length };
}

/**
 * Smallest signed distance from a point to ANY mass in the field.
 *
 * This is the clearance instrument Wave 1 owes the plan, and it replaces the retired heroes'
 * CENTRE-DISTANCE rule, which could not do the job: a mass 700 u away by centre distance but
 * 900 u wide still swallows the camera. Distance to the SURFACE is the quantity that actually
 * answers "can the rail enter this cloud", and it is the same field the sculptor used, so the
 * answer cannot drift from the geometry.
 */
export function cloudFieldSdf(specs, x, y, z, lobeCache = null) {
    let d = Infinity;
    specs.forEach((spec, i) => {
        const lobes = lobeCache ? (lobeCache[i] || (lobeCache[i] = buildCloudLobes(spec)))
            : buildCloudLobes(spec);
        d = Math.min(d, cloudMassSdf(spec, lobes, x, y, z, false));
    });
    return d;
}

/**
 * Validate that the rail clears every mass by its role's margin.
 *
 * @param {ReadonlyArray<object>} specs
 * @param {ReadonlyArray<{x:number,y:number,z:number}>} railSamples
 * @param {Record<string, number>} margins per-`role` surface clearance in world units
 * @returns {Array<{id:string, problem:string}>} empty when the field is legal
 */
export function validateCloudFieldClearance(specs, railSamples, margins) {
    const problems = [];
    specs.forEach((spec) => {
        const lobes = buildCloudLobes(spec);
        const margin = margins[spec.role] ?? margins.default ?? 0;
        let worst = Infinity;
        railSamples.forEach((pt) => {
            const d = cloudMassSdf(spec, lobes, pt.x, pt.y, pt.z, false);
            if (d < worst) worst = d;
        });
        if (worst < margin) {
            problems.push({
                id: spec.id,
                problem: `surface clearance ${worst.toFixed(0)} < ${margin} for role ${spec.role}`,
            });
        }
    });
    return problems;
}
