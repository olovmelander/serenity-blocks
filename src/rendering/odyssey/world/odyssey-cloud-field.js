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

/**
 * Blend width of the lobe melt, as a fraction of the mass half-width.
 *
 * THE SINGLE MOST IMPORTANT LOOK CONSTANT IN THIS FILE, and it is a two-sided cliff. Too small
 * and the lobes stop merging — back to the countable balls that got the heroes retired. Too
 * large and the mass melts into one smooth potato with no cauliflower at all, which is where
 * 0.16 landed it: correctly ONE shape, but smoother than every reference frame. 0.105 keeps
 * the joins continuous (the SDF gradient still turns through them) while letting each lobe
 * push a real bulge into the silhouette.
 */
const SMIN_K = 0.105;
/** Blend width of the flat-base fillet, as a fraction of the mass half-width. */
const BASE_FILLET_K = 0.07;
/**
 * Silhouette crinkle: amplitude as a fraction of half-width, and its spatial frequency.
 *
 * The frequency is BOUND TO THE VERTEX DENSITY, not to taste. An icosphere at the `near`
 * detail has ~0.064·w between vertices, so a wavelength of w/3.1 = 0.32·w is sampled ~5 times
 * — comfortably above Nyquist, which is why the amplitude can be raised without the bumps
 * degenerating into per-vertex noise. At `far` detail the same wavelength is sampled ~1.5
 * times and the crinkle stops being a shape and becomes irregularity; that is acceptable
 * because those masses are a few pixels across, but it is the reason this frequency must not
 * be raised without also raising the LOD that carries it.
 */
const CRINKLE_AMP = 0.085;
const CRINKLE_FREQ = 3.1;
/**
 * SPHERE-TRACING budget. The march steps INWARD from outside the hull by the field's own
 * value, which converges on the first crossing geometrically instead of linearly — a fixed
 * 48-step march measured 15.6 us per vertex, which is ~1.2 s for a whole field and blows the
 * 250 ms bake budget on its own. `SAFETY` under 1 is required because the crinkle makes the
 * field a NON-exact distance (it can locally exceed a Lipschitz constant of 1), and a full
 * step could tunnel through a thin scallop.
 */
const MARCH_STEPS = 18;
const MARCH_BISECT = 11;
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
export const CLOUD_FIELD_LOD_DETAIL = Object.freeze({ near: 6, mid: 4, far: 3 });

/**
 * ⚠️ THE FLOOR IS NOT AN OPTIMISATION KNOB. `far` was detail 1 — EIGHTY faces — and at 80
 * faces a hull's facets span ~25 degrees of its own sphere, so the SILHOUETTE is a visible
 * polygon however smooth its normals are (and ours are smooth: they come from the field
 * gradient, not from the triangles). The owner photographed the result: a small mass reading
 * as a flat angular shard with a hard crease down it, "sharp" where every other cloud was
 * round. Detail 3 (320 faces) is the floor at which a hull stops showing straight edges at the
 * sizes this field actually renders.
 *
 * The deeper rule, learnt twice now — first on the zenith masses, then here — is that detail
 * must follow ANGULAR size, not world distance. A 300 u mass at 1500 u still covers ~11
 * degrees, which is ~250 px at 720p; calling it "far" because of its distance and handing it
 * 80 faces is how a cloud becomes a shard. `assignCloudFieldLod` below does that arithmetic
 * rather than trusting the label in the spec table.
 */

/**
 * Choose a LOD tier from a mass's worst-case ANGULAR size against the rail.
 *
 * @param {object} spec
 * @param {ReadonlyArray<{x:number,y:number,z:number}>} railSamples
 * @returns {'near'|'mid'|'far'}
 */
export function assignCloudFieldLod(spec, railSamples) {
    let nearest = Infinity;
    railSamples.forEach((pt) => {
        const d = Math.hypot(spec.x - pt.x, (spec.base - pt.y), spec.z - pt.z);
        if (d < nearest) nearest = d;
    });
    if (!Number.isFinite(nearest) || nearest <= 0) return 'near';
    // Radians subtended at closest approach. The thresholds are where a hull of each tier
    // stops resolving: ~1280 faces carries a 20-degree mass, ~500 carries 8, below that the
    // 320-face floor applies and nothing goes coarser.
    const subtended = spec.w / nearest;
    if (subtended > 0.35) return 'near';
    if (subtended > 0.14) return 'mid';
    return 'far';
}

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

    // ── MEASURED AGAINST THE REFERENCES, not chosen by feel ──────────────────────────
    // Silhouettes profiled from the owner's Witness frames vs ours (2026-08-14):
    //   aspect W/H   refs 1.81-2.35   ours 1.06-1.51   -> ours too TALL
    //   top bumps    refs 7-10        ours 2-5         -> ours too FEW
    //   roughness    refs 0.13-0.18   ours 0.17-0.31   -> ours too DEEP
    // i.e. the reference read is MANY SHALLOW bumps on a WIDE, LOW mass; ours was a few deep
    // lumps on a round one. Everything below follows from those three numbers.
    //
    // ⚠️ THE RESOLUTION FLOOR IS THE BINDING CONSTRAINT, and it is why "just add more, smaller
    // lobes" fails. An icosphere at `near` detail has ~0.064*w between vertices, so a lobe
    // smaller than about 0.1*w (= 0.2*halfW) cannot be represented AT ALL — it costs bake time
    // and changes nothing. The old tertiaries at 0.08-0.14*halfW were entirely below that
    // floor: invisible detail, paid for. Bump SIZE is therefore pinned near the floor and the
    // count is what rises.
    const nPrim = 2 + Math.floor(rnd() * 2);
    const primR = [];
    const primPos = [];
    // Flatter primaries (0.62-0.72 -> 0.50-0.58) and a wider spread: the aspect ratio is set
    // here, before a single bump is placed.
    const primSquash = 0.50 + (rnd() * 0.08);
    for (let i = 0; i < nPrim; i += 1) {
        const r = halfW * (0.32 + (rnd() * 0.11));
        // ⚠️ THE FIRST PRIMARY IS PINNED TO THE ORIGIN, and this is load-bearing rather than
        // stylistic. Every ray in this module is traced from the mass centre outward, so that
        // centre MUST be inside the field. Widening the spread to 0.58*w for the aspect ratio
        // made it possible for all primaries to land off-centre with none covering the origin
        // — mass A11 did exactly that and the star-shape guard threw (sdf +3.49). Anchoring
        // one lobe at the origin makes the premise true by construction, and it composes
        // better anyway: a core with satellites, rather than a ring around a hole.
        const lx = i === 0 ? 0 : (rnd() - 0.5) * spec.w * 0.58;
        const lz = i === 0 ? 0 : (rnd() - 0.5) * spec.w * 0.30;
        primR.push(r);
        primPos.push([lx, lz]);
        push(lx, primY, lz, r, primSquash);
    }

    // SECONDARIES ARE THE SILHOUETTE. Placed on a GOLDEN-ANGLE ring rather than at random
    // angles: random placement clumps, and a clump of lobes merges into one bump, which is
    // exactly how 12 lobes used to produce 5 bumps. Even spacing turns each lobe into its own
    // arc on the outline. Seated at 0.78-1.02 of the primary radius so they break the rim
    // instead of sitting inside it.
    // ⚠️ LOBE COUNT IS BOUNDED FROM BOTH SIDES, and the first attempt violated the upper one.
    // For a lobe to read as its OWN bump the gap between neighbouring centres must be at least
    // its radius; for it to be REPRESENTABLE the radius must exceed the vertex spacing
    // (~0.064*w at `near`, i.e. ~0.13*halfW). On a rim of radius ~0.35*halfW those two
    // conditions leave room for roughly 8, not 14: at 14 the spacing falls to 0.157*halfW
    // against radii of 0.17-0.24, so neighbours overlapped into a smooth ring — MEASURED as 14
    // lobes producing only 6 bumps and ambient occlusion collapsing to a 0.47 floor because
    // there were no valleys left between them. Fewer, better-spaced lobes give more bumps than
    // more crowded ones. The reference band is 7-10; this targets its low end deliberately,
    // because that is what the vertex budget can actually carry.
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    const nSec = 8 + Math.floor(rnd() * 3);
    for (let i = 0; i < nSec; i += 1) {
        const host = i % nPrim;
        const [hx, hz] = primPos[host];
        const a = (i * GOLDEN) + (rnd() * 0.35);
        const seat = primR[host] * (0.78 + (rnd() * 0.24));
        push(
            hx + (Math.cos(a) * seat),
            primY + (spec.h * (0.02 + (rnd() * 0.20))),
            hz + (Math.sin(a) * seat * 0.72),
            halfW * (0.185 + (rnd() * 0.065)),
            0.68 + (rnd() * 0.16),
        );
    }

    // CROWN SCALLOPS, still crown-only, but sized AT the resolution floor rather than under it.
    const nTer = 5 + Math.floor(rnd() * 3);
    for (let i = 0; i < nTer; i += 1) {
        const host = i % nPrim;
        const [hx, hz] = primPos[host];
        const a = (i * GOLDEN * 1.7) + (rnd() * 0.4);
        const seat = primR[host] * (0.45 + (rnd() * 0.45));
        push(
            hx + (Math.cos(a) * seat),
            Math.max(spec.base + (spec.h * 0.50), primY + (spec.h * (0.22 + (rnd() * 0.18)))),
            hz + (Math.sin(a) * seat * 0.72),
            halfW * (0.115 + (rnd() * 0.055)),
            0.80,
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
    // xyz = the DOMINANT lobe's centre for this vertex, w = that lobe's breathing phase.
    // Per-LOBE, deliberately: see the note on breathing in odyssey-world-renderer.js. A cloud
    // that reshapes per VERTEX boils; one that reshapes per LOBE billows.
    const lobeInfo = new Float32Array(count * 4);

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
            // RADIUS TUNED TO THE CREVICES THAT EXIST. The re-authored lobe grammar trades a
            // few deep valleys for many shallow ones, and a 0.35*halfW probe steps clean over
            // the shallow kind — measured: minimum AO rose 0.087 -> 0.470, i.e. the term had
            // quietly stopped finding anything. A shorter probe reads the crevices the new
            // silhouette actually has. Sample distance must follow the geometry, not habit.
            const h = (i / 3) * halfW * 0.16;
            const w = 1 / (2 ** i);
            const free = Math.max(0, h - Math.abs(sdf(px + (nx * h), py + (ny * h), pz + (nz * h))));
            occ += (w * free) / h;
            weight += w;
        }
        // Which lobe owns this vertex — the nearest one by its own surface distance. The
        // phase walks with the lobe INDEX rather than jumping randomly, so neighbours breathe
        // nearly in step and the smooth-min joins between them never tear.
        let bestLobe = 0;
        let bestD = Infinity;
        for (let l = 0; l < lobes.length; l += 1) {
            const lo = lobes[l];
            const ldx = px - lo.x;
            const ldy = (py - lo.y) / lo.squash;
            const ldz = pz - lo.z;
            const ld = Math.abs(Math.sqrt((ldx * ldx) + (ldy * ldy) + (ldz * ldz)) - lo.r);
            if (ld < bestD) { bestD = ld; bestLobe = l; }
        }
        lobeInfo[v * 4] = lobes[bestLobe].x;
        lobeInfo[(v * 4) + 1] = lobes[bestLobe].y;
        lobeInfo[(v * 4) + 2] = lobes[bestLobe].z;
        lobeInfo[(v * 4) + 3] = (bestLobe * 0.9) + (massRandom * 6.2831853);

        colour[v * 3] = Math.max(0, Math.min(1, 1 - (occ / Math.max(weight, 1e-6))));
        colour[(v * 3) + 1] = Math.max(0, Math.min(1, (py - spec.base) / Math.max(spec.h, 1e-3)));
        colour[(v * 3) + 2] = massRandom;
    }

    return {
        position, normal, centre, colour, lobeInfo, triangles: count / 3,
    };
}

/**
 * Sculpt a whole field and hand-merge it into ONE geometry.
 *
 * @param {ReadonlyArray<object>} specs each with a `lod` key naming a CLOUD_FIELD_LOD_DETAIL entry
 * @returns {{ geometry: THREE.BufferGeometry, triangles: number, masses: number }}
 */
export function buildCloudFieldGeometry(specs, railSamples = null) {
    const parts = specs.map((spec) => {
        // The spec's `lod` is a floor the author can raise, never a ceiling: when the rail is
        // known, a mass that subtends MORE than its label claims is promoted. A hand-authored
        // table cannot keep this correct as placements move, and getting it wrong is visible
        // (see the note on CLOUD_FIELD_LOD_DETAIL).
        const measured = railSamples ? assignCloudFieldLod(spec, railSamples) : spec.lod;
        const rank = { far: 0, mid: 1, near: 2 };
        const tier = (rank[measured] ?? 0) > (rank[spec.lod] ?? 0) ? measured : spec.lod;
        return sculptCloudMass(spec, CLOUD_FIELD_LOD_DETAIL[tier] ?? CLOUD_FIELD_LOD_DETAIL.mid);
    });
    let verts = 0;
    parts.forEach((p) => { verts += p.position.length / 3; });

    const position = new Float32Array(verts * 3);
    const normal = new Float32Array(verts * 3);
    const centre = new Float32Array(verts * 3);
    const colour = new Float32Array(verts * 3);
    const lobeInfo = new Float32Array(verts * 4);
    let off = 0;
    let off4 = 0;
    parts.forEach((p) => {
        position.set(p.position, off);
        normal.set(p.normal, off);
        centre.set(p.centre, off);
        colour.set(p.colour, off);
        lobeInfo.set(p.lobeInfo, off4);
        off += p.position.length;
        off4 += p.lobeInfo.length;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('aMassCentre', new THREE.BufferAttribute(centre, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
    geometry.setAttribute('aLobe', new THREE.BufferAttribute(lobeInfo, 4));
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
export function validateCloudFieldClearance(specs, railSamples, margins, driftAmplitude = 0, breathFraction = 0) {
    const problems = [];
    specs.forEach((spec) => {
        const lobes = buildCloudLobes(spec);
        // ⚠️ DRIFT EATS CLEARANCE. A mass validated where the spec table places it can still
        // reach the rail once it is animated, because the drift swings it about that point.
        // The margin therefore has to cover the WORST excursion, not the authored position —
        // otherwise raising the drift amplitude for visibility silently spends the safety
        // budget the clearance rules exist to protect.
        // Breathing extends the surface OUTWARD as well: a lobe swelling by `breathFraction`
        // of its own radius pushes the hull out by roughly that fraction of a lobe radius,
        // which for this grammar is ~0.25 of the half-width. Small next to the drift term, but
        // it is the same class of mistake to leave it out — an animated surface must clear the
        // rail at its largest, not at the size the bake happened to produce.
        const swell = breathFraction * 0.25 * (spec.w / 2);
        const margin = (margins[spec.role] ?? margins.default ?? 0) + driftAmplitude + swell;
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
