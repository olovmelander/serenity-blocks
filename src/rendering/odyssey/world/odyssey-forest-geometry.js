import * as THREE from 'three/webgpu';

import {
    FOREST_LOD_BUDGET, FOREST_VALUE_ROLES,
} from './odyssey-forest-species.js';

/**
 * ACT II FOREST — the species sculptor (forest plan Wave 1).
 *
 * Two builders, one output contract. Everything is procedural: this file imports no assets,
 * matching the world renderer's own charter ("no meshes, no textures, no imported assets").
 *
 * THE ONE NON-NEGOTIABLE TRICK, and the reason this file exists at all: the painted-blob read
 * is EDITED NORMALS, not geometry and not lighting tech. The Witness transfers normals from an
 * enclosing blob onto the canopy so a chaotic cluster shades as one smooth convex mass; Alba
 * shipped an entire game on vertex normal-transfer with zero normal maps; every community
 * Ghibli-tree recipe converges on the same move; and the fluffytree shader computes exactly
 * this analytically (`normalize(worldPos - treeCentre)`) instead of baking it. Both builders
 * below therefore bake a BLOB NORMAL FIELD and throw the face normals away. Wave 0b already
 * proved the effect on the incumbent cones, measured against the reference bar.
 *
 * WHAT IS BAKED INTO EVERY VERTEX, and why each is a bake rather than a shader term:
 *   `normal`  the blob normal (above).
 *   `color.r` ANALYTIC AO — how enclosed this vertex is by the rest of its own crown. Consumed
 *             as a BAND-THRESHOLD SHIFT, never as a colour multiply: darkening by AO is how a
 *             stylised canopy turns muddy, whereas moving the threshold keeps every pixel on
 *             one of the authored tones. (The cloud field's grammar, reused verbatim.)
 *   `color.g` height in crown, 0 at the crown's underside and 1 at its top. This is Oga's dark
 *             interior mass — "blocked from the light of the sky", i.e. an OCCLUSION term and
 *             emphatically not a second N·L. Wave 0b measured that a linear ramp of this reads
 *             as an airbrush and a quantised step reads as a painted mass; the step lives in
 *             the material, so this stays linear and the material owns the quantisation.
 *   `color.b` a per-tree random, constant across the whole tree, for phase and hue jitter.
 *
 * LESSONS CARRIED IN FROM THE CLOUD SCULPTOR, all of which cost a session there:
 *   • `IcosahedronGeometry(r, detail)` is 20·(detail+1)² faces, NOT 20·4^detail. A first draft
 *     there believed detail 3 was 1280 triangles; it is 320, and the field would have shipped
 *     at a quarter of its intended geometry.
 *   • A zero-length normalize CONST-FOLDS into a WGSL compile failure rather than a warning.
 *     Every direction here is guarded, including the ones that "cannot" be degenerate.
 *   • `computeVertexNormals()` on a merged result FLATTENS the lobes and destroys exactly the
 *     smooth blob field this file exists to bake. It is never called here, deliberately.
 *   • NaN walks through a naive guard in BOTH directions: `d >= 0` admits NaN as outside and
 *     `!(d > 0)` admits it as inside. Neither is safe, and a comment claiming one while the
 *     code does the other is worse than either — this file shipped that inconsistency for one
 *     review cycle. Every inside-test here is written `Number.isFinite(d) && d <= 0`.
 */

// ⚠️ WINDING IS CCW-OUTWARD, and getting it wrong is invisible to every other test here.
// three's WebGPU backend sets frontFace: CCW + cullMode: Back for any non-DoubleSide
// material, and MeshBasicNodeMaterial defaults to FrontSide — so a CW-wound triangle is
// CULLED and the GPU rasterises the far interior surface instead, whose interpolated blob
// normal points away from the viewer. The band then evaluates on the WRONG HEMISPHERE:
// shade tone where the lit tone belongs. The first cut of this file emitted every
// hand-built triangle CW (measured: signed volume NEGATIVE on all three conifers against
// positive for ConeGeometry/IcosahedronGeometry), and 31 green tests said nothing.

/** Icosahedron face count for a subdivision level. The formula that bit the cloud field. */
export function icosahedronFaces(detail) {
    return 20 * ((detail + 1) ** 2);
}

/**
 * Polynomial smooth-min (iq). EXPORTED so the melt can be tested for what it actually is —
 * a union that UNDERCUTS min() inside the blend width and equals it outside. A test that only
 * bounds the hull's radius steps passes with a plain `Math.min`, which is not a melt at all.
 */
export function smoothMin(a, b, k) {
    const h = Math.min(1, Math.max(0, 0.5 + ((0.5 * (b - a)) / k)));
    return (b * (1 - h)) + (a * h) - (k * h * (1 - h));
}

/** Deterministic integer-hash RNG, the same shape `scatterTrees` already uses. */
function makeRng(seed) {
    let state = Math.imul(seed | 0, 2654435761) >>> 0;
    return () => {
        state = Math.imul(state ^ (state >>> 15), 2246822519) >>> 0;
        state = (state + 374761393) >>> 0;
        return ((state ^ (state >>> 13)) >>> 0) / 4294967296;
    };
}

/**
 * Deterministic 3-D value noise, smoothstep-interpolated. The crinkle's source.
 *
 * Tiny on purpose: this runs at BAKE time over a few hundred vertices per tree, so clarity
 * beats speed, and a hash-lattice value noise is exactly enough to break an arc into bumps.
 */
function valueNoise3(x, y, z) {
    const h = (i, j, k) => {
        let n = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263)
            + Math.imul(k | 0, 2147483647)) | 0;
        n = Math.imul(n ^ (n >>> 13), 1274126177);
        return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    };
    const i0 = Math.floor(x); const j0 = Math.floor(y); const k0 = Math.floor(z);
    const fx = x - i0; const fy = y - j0; const fz = z - k0;
    const sx = fx * fx * (3 - (2 * fx));
    const sy = fy * fy * (3 - (2 * fy));
    const sz = fz * fz * (3 - (2 * fz));
    const lerp = (a, b, t) => a + ((b - a) * t);
    const c00 = lerp(h(i0, j0, k0), h(i0 + 1, j0, k0), sx);
    const c10 = lerp(h(i0, j0 + 1, k0), h(i0 + 1, j0 + 1, k0), sx);
    const c01 = lerp(h(i0, j0, k0 + 1), h(i0 + 1, j0, k0 + 1), sx);
    const c11 = lerp(h(i0, j0 + 1, k0 + 1), h(i0 + 1, j0 + 1, k0 + 1), sx);
    return lerp(lerp(c00, c10, sy), lerp(c01, c11, sy), sz) - 0.5;
}

/**
 * Crinkle amplitude by LOD, as a fraction of crown width — BOUND TO VERTEX DENSITY, which is
 * the cloud sculptor's rule. A bump the mesh cannot resolve is not a bump, it is aliasing: at
 * detail 1 (80 faces) the equator carries ~10 vertices, so anything finer than a fifth of the
 * circumference turns into shimmer instead of silhouette.
 */
// ⚠️ HALVED AFTER A CAPTURE. At 0.115 with a fine frequency the crinkle out-ran the hull's own
// facet size and the canopy read as CRUMPLED PAPER — angular planes instead of rounded lumps.
// The lobes are the shape; the crinkle only has to stop their union reading as an arc. When a
// displacement is finer than the mesh can round, it does not add form, it adds facets.
const CRINKLE_AMP = Object.freeze({ hero: 0.058, mid: 0.030, far: 0 });

/**
 * The blob normal for a crown vertex: the direction from the crown's blob centre, tilted up.
 *
 * The up-bias is the polycount/habrador reproduction of the Witness normal transfer — "the
 * leaves face outwards and upwards from the center of the tree, to emulate the effect that
 * light has on the growth of the tree". Applied to the already-normalised direction so it is a
 * constant tilt rather than a distance-dependent one.
 */
function blobNormal(px, py, pz, centreY, upBias) {
    const dy = py - centreY;
    const l0 = Math.hypot(px, dy, pz) || 1;
    const uy = (dy / l0) + upBias;
    const l1 = Math.hypot(px / l0, uy, pz / l0) || 1;
    return [(px / l0) / l1, uy / l1, (pz / l0) / l1];
}

const BLOB_UP_BIAS = 0.30;

/**
 * How far a traced crown's normal is bent from its own SDF gradient toward the blob direction.
 *
 * The cloud field's `FIELD_CENTROID_BEND`, and its number: 0.30 keeps most of the real surface
 * — so the lobes and the crinkle catch light — while leaning enough toward the mass centre that
 * the cluster still shades as ONE crown instead of a bag of separate balls. At 1.0 (a pure blob
 * normal, which this file baked until an owner review) the sculpting is invisible in shading.
 */
const FOREST_CENTROID_BEND = 0.30;

/**
 * Leaf plates per crown, by LOD. Hero only — see `appendLeafPlates`. A plate is ONE opaque
 * triangle, so this is also the triangle cost.
 */
// ⚠️ MANY AND SMALL, NOT FEW AND LARGE. The first pass used 170 plates at 0.30 crown-widths
// reaching 0.85 outward, and the canopy grew SPIKES — a horse-chestnut ball, not foliage. A
// leafy read is a FINE fringe: the eye reads the density of the outline, not the length of the
// spurs. Tripling the count and more than halving the size costs the same order of triangles
// and looks like leaves instead of thorns.
// eslint-disable-next-line import/no-mutable-exports
// ⚠️ THE BUDGET SHAPE THE LANE B MEASUREMENT FORCED (2026-08-14). The first roster shipped
// plates 300 / sprigs 190 / a full mid tier, measured forestV2Ms = 3.998 ms at p=0.225 —
// 2.65x the incumbent and a Gate F2 fail by 2.191 ms. The diagnosis overturned the obvious
// suspect: the FAR tier was already lean (18 tris/tree); the HERO FRINGE was 45% of the
// forest's visible triangles on 3% of its trees, and the mid tier ran 88 tris/tree against
// the incumbent's 30. This shape (fringe roughly halved, mid on the far tier's detail-0 hull
// with its trunk kept) sweeps to ~1.44x the incumbent's visible triangles.
const fringeState = { plates: 140, sprigs: 85, midLean: true };
export const FOREST_FRINGE = {
    get plates() { return fringeState.plates; },
    get sprigs() { return fringeState.sprigs; },
    get midLean() { return fringeState.midLean; },
};
/**
 * Override the hero fringe budget. A SWEEP INSTRUMENT first (the Lane B fail is a triangle
 * budget problem, and the fringe is 45% of the forest's visible triangles on 3% of its
 * trees), and the natural quality-lane lever afterwards.
 */
export function setForestFringe(next) {
    Object.assign(fringeState, next);
}
const LEAF_PLATES = { get hero() { return FOREST_FRINGE.plates; }, mid: 0, far: 0 };

/**
 * Needle sprigs per conifer, by LOD. Fewer than the broadleaf's plates because a conifer's
 * silhouette is already carried by its drooping tiers — the sprigs break the tier EDGES rather
 * than having to invent the whole outline.
 */
const CONIFER_SPRIGS = { get hero() { return FOREST_FRINGE.sprigs; }, mid: 0, far: 0 };

/**
 * Analytic AO for a crown vertex, in [0,1] where 1 is fully open sky.
 *
 * Cheap and honest: a vertex is occluded by its own crown in proportion to how much crown sits
 * ABOVE and AROUND it. Radial openness (how far out from the axis) and height in crown both
 * raise it. This is not a ray-traced quantity and does not pretend to be — it feeds a band
 * THRESHOLD, where a smooth plausible field is worth more than a correct one.
 */
function crownAO(radialFrac, heightFrac) {
    const open = 0.30 + (0.45 * radialFrac) + (0.42 * heightFrac);
    return Math.min(1, Math.max(0, open));
}

/**
 * THE CONIFER LATHE — stacked drooping tiers.
 *
 * Descended from the winter theme's `framing-spruces.js`, which is fully procedural, has no
 * importers since the 2026-08-13 snowflow remake, and is the strongest conifer silhouette
 * prior art in the repo. What changes here: the normals are blob normals rather than face
 * normals rather than face normals, and the tier rims carry the scallop that §1b R4 asks the
 * silhouette to have.
 *
 * ⚠️ SNOW IS NOT IMPLEMENTED HERE. `spec.snow` is authored on the subalpine fir and is read by
 * NOTHING yet — it is a Wave 2/3 input, listed with `weight` and `band` in the plan's
 * carried-forward set. An earlier version of this docstring claimed the snow was already baked
 * into vertex colour on the same shell; it was not, and a comment that describes unwritten
 * code is precisely how this repo's own logged bisect reached a confident wrong answer.
 *
 * @param {object} spec a species entry from ODYSSEY_FOREST_SPECIES
 * @param {object} stage one of its `stages`
 * @param {'hero'|'mid'|'far'} lod
 * @param {number} seed
 */
function buildConifer(spec, stage, lod, seed) {
    const rnd = makeRng(seed);
    const sides = { hero: 9, mid: FOREST_FRINGE.midLean ? 4 : 6, far: 4 }[lod] ?? 6;
    // FAR DROPS TIERS AND THE TRUNK, not just sides. At 700+ units a 5 cm trunk is sub-pixel
    // and a seventh tier is a triangle nobody resolves; what still reads is the scalloped
    // outline, so that is all the far tier pays for. This is the difference between a far LOD
    // that meets its budget by design and one that is a shrunken hero.
    // FAR KEEPS MOST OF ITS TIERS. Dropping to a flat 3 satisfied the old 18-triangle budget
    // but redistributed the crown's mass badly enough to move its centroid 13% of tree height
    // — the canopy-pop defect again, arriving through the back door. At 4 sides, `tiers - 2`
    // costs 12-20 triangles against the 24 budget and keeps both invariants: the same apex
    // height AND the same crown centroid.
    // A FLOOR OF 4, not 3. `tiers - 2` is a bigger relative cut on a species with few tiers,
    // and the 5-tier cypress — the ANCHOR species, i.e. the most visually conspicuous one —
    // drifted 12.7% at 3 tiers while the 6/7-tier conifers drifted 4-6%. The floor costs at
    // most 4 triangles and is clamped so a species can never gain tiers at distance.
    const tiers = lod === 'far'
        ? Math.min(spec.tiers, Math.max(4, spec.tiers - 2))
        : spec.tiers;
    // The authored crown span, in units of `f`. Fixed by the SPECIES, never by the LOD's tier
    // count: `f` drives the crown TOP, so normalising it against `tiers` would make a dropped
    // tier shorten the tree. See the loop below.
    const fSpan = (spec.tiers - 1) / spec.tiers;
    const droop = spec.droop ?? 0.24;

    // FAR HAS NO TRUNK, AND THE CROWN DOES NOT MOVE TO COMPENSATE. An earlier cut dropped the
    // stack to the ground and absorbed the trunk height into the crown, on the reasoning that
    // a seated tree beats a floating one — but that shifts the CANOPY, and the canopy is the
    // part you can see. Measured: it moved the crown centroid by 12.8% of tree height, i.e. a
    // visible downward jump as a tree crosses 700 u. A missing sub-pixel trunk is invisible;
    // a moving canopy is not. So the far tier is crown-only, left exactly where the mid tier
    // put it, and the two builders now share one rule.
    const trunkH = spec.trunkH * stage.h;
    const trunkR = spec.trunkR * stage.w;
    // ⚠️ THE APEX HEIGHT DEPENDS ON THE TIER COUNT, so a far tree with fewer tiers is SHORTER
    // unless the stack is rescaled — measured 11-13% short before this, while userData.totalH
    // and the comment both claimed height was preserved exactly. A tree that shrinks as it
    // crosses 700 u is the same defect class as one whose canopy jumps.
    const apexFrac = (n) => ((((n - 1) / n) * 0.92) + (0.30 - (((n - 1) / n) * 0.06)));
    const crownH = spec.crownH * 3.4 * stage.h * (apexFrac(spec.tiers) / apexFrac(tiers));
    const crownW = spec.crownW * stage.w;
    // The REAL apex, not trunk+crownH: the top tier's apex sits at apexFrac of the span.
    const totalH = trunkH + (crownH * apexFrac(tiers));
    // The blob centre sits low: a cone's mass is bottom-heavy, and vertices below the centre
    // then receive downward normals, which is what hands the underside its dark mass for free.
    const centreY = trunkH + (crownH * 0.34);

    const positions = [];
    const normals = [];
    const vert = [];
    const rimSamples = [];

    const pushVert = (px, py, pz, ao, isTrunk) => {
        positions.push(px, py, pz);
        if (isTrunk) {
            // The trunk keeps its own outward normal — a blob normal on a thin cylinder would
            // light it as part of the canopy and lose the hue opposition §1b R6 measured.
            const l = Math.hypot(px, pz) || 1;
            normals.push(px / l, 0.12, pz / l);
        } else {
            const n = blobNormal(px, py, pz, centreY, BLOB_UP_BIAS);
            normals.push(n[0], n[1], n[2]);
        }
        const heightFrac = Math.min(1, Math.max(0, (py - trunkH) / (crownH || 1)));
        vert.push(
            ao,
            isTrunk ? 0 : heightFrac,
            isTrunk ? 0 : 1,
            // ⚠️ ZERO AT FAR — the wind mask, and this is the plan's "far tier: no wind" made
            // true without a shader branch. At 700+ units the 0.085-unit sway is far under a
            // pixel, so it cannot read as motion; what it CAN do is jitter a sub-pixel
            // silhouette between frames, which is shimmer. Baking the mask to 0 costs nothing,
            // needs no per-LOD material, and keeps the roster on one pipeline.
            lod === 'far' ? 0 : Math.max(0, Math.min(1, py / (totalH || 1))),
        );
    };

    // ── trunk ── (skipped at far: see the crown-only note above)
    for (let i = 0; lod !== 'far' && i < sides; i += 1) {
        const a0 = (i / sides) * Math.PI * 2;
        const a1 = ((i + 1) / sides) * Math.PI * 2;
        const x0 = Math.cos(a0) * trunkR;
        const z0 = Math.sin(a0) * trunkR;
        const x1 = Math.cos(a1) * trunkR;
        const z1 = Math.sin(a1) * trunkR;
        // Root flare: the trunk widens at the ground, which is most of what stops a cylinder
        // reading as a pipe stuck in the dirt (stillwater's `appendTreeSegments` precedent).
        const flare = 1.45;
        [
            [x0 * flare, 0, z0 * flare], [x1, trunkH, z1], [x1 * flare, 0, z1 * flare],
            [x0 * flare, 0, z0 * flare], [x0, trunkH, z0], [x1, trunkH, z1],
        ].forEach(([px, py, pz]) => pushVert(px, py, pz, 0.28, true));
    }

    // ── tiers ──
    for (let t = 0; t < tiers; t += 1) {
        const f = tiers > 1 ? (t * fSpan) / (tiers - 1) : 0;
        // Tiers overlap: each skirt hangs below the one above so the silhouette is a scalloped
        // stack rather than a set of separated discs.
        const base = trunkH + (f * crownH * 0.92);
        const top = base + (crownH * (0.30 - (f * 0.06)));
        const radius = crownW * (1.0 - (f * 0.62)) * (1 + ((rnd() - 0.5) * 0.10));
        const sag = droop * crownH * 0.09 * (1 - (f * 0.5));
        for (let i = 0; i < sides; i += 1) {
            const a0 = (i / sides) * Math.PI * 2;
            const a1 = ((i + 1) / sides) * Math.PI * 2;
            // ⚠️ THE SCALLOP, and the reason this is not a cone. Per-rim-vertex radius and sag
            // jitter is what makes the outline read as branches rather than as a lathe. The
            // jitter shrinks toward the crown top: full-amplitude jitter on the small upper
            // tiers reads as sub-pixel shimmer at distance (the framing-spruces lesson).
            const j0 = 1 + ((rnd() - 0.5) * 0.42 * (1 - f));
            const j1 = 1 + ((rnd() - 0.5) * 0.42 * (1 - f));
            const r0 = radius * j0;
            const r1 = radius * j1;
            const x0 = Math.cos(a0) * r0;
            const z0 = Math.sin(a0) * r0;
            const x1 = Math.cos(a1) * r1;
            const z1 = Math.sin(a1) * r1;
            const y0 = base - (sag * j0);
            const y1 = base - (sag * j1);
            const aoRim = crownAO(1, f);
            const aoApex = crownAO(0.25, Math.min(1, f + 0.28));
            // CCW seen from outside: rim0 -> apex -> rim1 (see the winding note above).
            pushVert(x0, y0, z0, aoRim, false);
            pushVert(0, top, 0, aoApex, false);
            pushVert(x1, y1, z1, aoRim, false);
            // The tier RIM is where conifer foliage lives — the scalloped edge is the whole
            // silhouette — so sprigs are seeded there rather than over the whole cone.
            if (lod !== 'far') {
                const rn = blobNormal(x0, y0, z0, centreY, BLOB_UP_BIAS);
                rimSamples.push({
                    x: x0,
                    y: y0,
                    z: z0,
                    n: rn,
                    ao: aoRim,
                    h: Math.min(1, Math.max(0, (y0 - trunkH) / (crownH || 1))),
                    w: Math.max(0, Math.min(1, y0 / (totalH || 1))),
                });
            }
        }
    }

    // THE NEEDLE SPRIGS. Same opaque technique as the broadleaf fringe, tuned for a conifer:
    // smaller, denser, and drooping. Without them the tiers are bare lathe cones — the three
    // conifer species had no foliage treatment at all while the two broadleaves did, which is
    // exactly the sort of gap a roster hides until someone asks about the OTHER trees.
    appendLeafPlates(
        { positions, normals, vert },
        rimSamples,
        {
            count: CONIFER_SPRIGS[lod] ?? 0,
            size: 0.30,
            out: 0.55,
            droop: 0.75,
            // Conifer foliage runs almost the whole trunk-to-tip length, unlike a broadleaf
            // crown whose underside is a deliberately solid bowl.
            minUp: 0.02,
            upJitter: 0.10,
            rnd,
            centreY,
            crownW,
            crownH,
        },
    );

    return {
        positions, normals, vert, totalH, crownW: crownW * 1.0, centreY,
    };
}

/**
 * LEAF PLATES — the leafy read, and the reason it is OPAQUE.
 *
 * The owner's note was that the canopies have no leaves like The Witness and like
 * fluffytree-threejs. Both of those scatter thousands of ALPHA-TESTED cards per crown
 * (fluffytree measures ~2,937 quads per canopy blob, 20k+ triangles per tree), which at this
 * forest's 15,400 trees is ~45M alpha-tested quads — against a stack where opaque geometry
 * measured ~20x cheaper and where `discard` disables early-Z outright.
 *
 * The answer comes from The Witness itself. Its canopy technique PREDATES its alpha support:
 * "a ton of triangles sitting in a bowl… the bowl is there to simplify the bottom and hide the
 * triangle nature of the triangles" (Shannon Galvin, the-witness.net 2011-06) — and by their
 * own account it read as leafy from SILHOUETTE AND COLOUR ALONE, with zero alpha. That is
 * exactly what this does: small opaque plates standing proud of the hull, so the outline stops
 * being a surface and becomes a mass of leaves, at the cost of triangles rather than fill.
 *
 * Each plate takes the crown's BENT normal at its root, not its own facing — the Witness
 * normal-transfer rule again. A plate lit by its own orientation would sparkle like confetti;
 * lit by the crown's normal it reads as part of one canopy.
 *
 * @returns {number} triangles emitted
 */
function appendLeafPlates(out, hull, opts) {
    const {
        count, size, out: outward, rnd, centreY, crownW, crownH,
        droop = 0, minUp = 0.18, upJitter = 0.22,
    } = opts;
    if (count <= 0) return 0;
    const { positions, normals, vert } = out;
    // Sampled RANDOMLY with attempts rather than strided, so plate count is independent of
    // hull resolution — which matters because the hull was coarsened to pay for the plates.
    let emitted = 0;
    for (let attempt = 0; attempt < count * 4 && emitted < count; attempt += 1) {
        const p = hull[Math.floor(rnd() * hull.length) % hull.length];
        // Plates thin out toward the crown's underside: the bowl is meant to read as a solid
        // simplified mass, and fringing it would undo the very thing it is there to do.
        const up = (p.y - (centreY - (crownH * 0.5))) / Math.max(1e-3, crownH);
        if (up < minUp + (rnd() * upJitter)) continue;
        const { n } = p;
        // A stable tangent frame from the plate's own normal (never a fixed world axis, which
        // degenerates where the normal aligns with it).
        const ax = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        let tx = (n[1] * ax[2]) - (n[2] * ax[1]);
        let ty = (n[2] * ax[0]) - (n[0] * ax[2]);
        let tz = (n[0] * ax[1]) - (n[1] * ax[0]);
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        const bx = (n[1] * tz) - (n[2] * ty);
        const by = (n[2] * tx) - (n[0] * tz);
        const bz = (n[0] * ty) - (n[1] * tx);
        // Random in-plane rotation, so a stand of trees never shows a combed direction.
        const a = rnd() * Math.PI * 2;
        const ca = Math.cos(a); const sa = Math.sin(a);
        const ux = (tx * ca) + (bx * sa); const uy = (ty * ca) + (by * sa); const uz = (tz * ca) + (bz * sa);
        const vx = (bx * ca) - (tx * sa); const vy = (by * ca) - (ty * sa); const vz = (bz * ca) - (tz * sa);
        const sz2 = size * crownW * (0.65 + (rnd() * 0.7));
        // Rooted slightly INSIDE the hull and reaching outward, so no plate can float free of
        // the crown and leave a gap at its base.
        const rx = p.x - (n[0] * sz2 * 0.35);
        const ry = p.y - (n[1] * sz2 * 0.35);
        const rz = p.z - (n[2] * sz2 * 0.35);
        // `droop` pulls the free tip DOWN as well as out. Conifer foliage hangs; the reference
        // pines are explicitly "saggy, irregularly spaced branches", and a sprig that radiates
        // straight out of the cone reads as a bottle brush.
        const ox = (n[0] * sz2 * outward);
        const oy = (n[1] * sz2 * outward) - (sz2 * droop);
        const oz = (n[2] * sz2 * outward);
        const tri = [
            [rx - (ux * sz2), ry - (uy * sz2), rz - (uz * sz2)],
            [rx + (ux * sz2), ry + (uy * sz2), rz + (uz * sz2)],
            [rx + ox + (vx * sz2 * 0.5), ry + oy + (vy * sz2 * 0.5), rz + oz + (vz * sz2 * 0.5)],
        ];
        tri.forEach(([qx, qy, qz]) => {
            positions.push(qx, qy, qz);
            normals.push(n[0], n[1], n[2]);
            // AO and crown height come from the ROOT, so a plate bands with the crown it grew
            // from rather than reading as its own little object.
            vert.push(p.ao, p.h, 1, p.w);
        });
        emitted += 1;
    }
    return emitted;
}

/**
 * THE BROADLEAF SCULPTOR — a smooth-min union of authored lobes.
 *
 * The cloud field's grammar at tree scale, which is the right call because a Witness canopy and
 * a Witness cloud are the same object: a cluster of rounded lumps that must read as ONE mass.
 * The field proved that a bag of glued spheres does not, and that the fix is a surface found
 * from the smooth-min FIELD, whose gradient is continuous across a join — a melt that no
 * shader-side normal blend can manufacture from per-lobe radial normals.
 *
 * SPHERE-TRACED, NOT MARCHING CUBES, for the field's reasons: a crown is star-shaped about its
 * own centre, so marching an icosphere's directions inward yields a closed watertight hull with
 * an EXACT triangle count per LOD — which is what a triangle budget has to be asserted against.
 * The trade-off, written down: no overhangs. Canopies do not have them at silhouette scale.
 *
 * AND THE BOWL. The Witness canopy is "a ton of triangles sitting in a bowl… the bowl is there
 * to simplify the bottom and hide the triangle nature of the triangles", with a solid simplified
 * underside doing real work. Here that is a smooth-MAX against a plane — the same fillet that
 * gives the cloud field its flat bases, pointing the other way.
 */
function buildBroadleaf(spec, stage, lod, seed) {
    const rnd = makeRng(seed);
    // ⚠️ HERO DROPS 3 -> 2. Once leaf plates carry the outline, the shell under them is barely
    // visible, and 140 triangles of hull resolution buy far less than 140 more leaves. The
    // silhouette moved from the hull to the fringe, so the budget followed it.
    // `midLean` drops the mid hull to the far tier's detail-0 (still crinkled, still lobed —
    // the far tier proved that form holds up) while keeping the trunk. The mid tier ran 88
    // tris/tree against the incumbent's 30, and at 120-520 u a crown subtends few enough
    // pixels that the 80-face hull's extra roundness is mostly spent below resolution.
    const midDetail = FOREST_FRINGE.midLean ? 0 : 1;
    const detail = { hero: 2, mid: midDetail, far: 0 }[lod] ?? 1;
    const lobeCount = spec.lobes ?? 5;
    // ⚠️ THE FAR TIER IS THE SAME TRACED HULL AT detail 0, AND GETTING HERE TOOK TWO WRONG
    // ANSWERS THAT THE AUDITION BOARD CAUGHT. A bespoke 12-triangle bipyramid met the 18-tri
    // budget but read as a flat KITE on the far board, and re-proportioning it only turned the
    // kite into a funnel: a bipyramid's PROFILE is a diamond at any facet count, so no amount
    // of tuning makes one round. An icosahedron is 20 faces (20*(detail+1)^2 — the same
    // formula this file already warns about) and is the CHEAPEST GENUINELY ROUND CLOSED HULL
    // there is. The 18-triangle budget was authored without that fact, so the BUDGET moved to
    // 24 rather than the shape being bent to fit it — and the far tier now shares the hero/mid
    // silhouette family instead of being a different object that happens to be small.

    const trunkH = spec.trunkH * stage.h;
    const trunkR = spec.trunkR * stage.w;
    const crownW = spec.crownW * 1.55 * stage.w;
    const crownH = spec.crownH * 1.65 * stage.h;
    const centreY = trunkH + (crownH * 0.52);
    const totalH = trunkH + (crownH * 1.15);

    // Authored lobes, scattered around the crown axis. Deterministic from the seed.
    // ⚠️ LOBES MUST STAND APART, OR THERE ARE NO LOBES. The first cut placed each lobe
    // 0.18-0.48 crown-widths from the axis and gave it a RADIUS of 0.46-0.70 — every lobe
    // therefore contained the axis, and the union was one sphere. The audition board showed
    // exactly that: a smooth dome on a stick, nothing like the reference's cauliflower of
    // countable masses. Placement distance must EXCEED lobe radius for a cluster to read as a
    // cluster.
    // ⚠️ LOBES SIT ON LIMBS NOW, AND THE SPREAD IS THE POINT. The owner named the structural
    // monotony: "just a straight stock and the canopys". The reference trees FORK — a trunk
    // splits into limbs and each limb carries its own mass, which is where their varied,
    // asymmetric silhouettes come from. Each ring lobe records that it wants a limb; the limb
    // builder below connects it to the fork, and the wider vertical scatter (0.70 of crownH,
    // up-biased) turns the crown from a disc of lobes into a climbing cluster.
    const lobes = [];
    for (let i = 0; i < lobeCount; i += 1) {
        const a = ((i / lobeCount) * Math.PI * 2) + (rnd() * 1.1);
        const rad = crownW * (0.42 + (rnd() * 0.40));
        lobes.push({
            x: Math.cos(a) * rad,
            y: centreY + ((rnd() - 0.35) * crownH * 0.70),
            z: Math.sin(a) * rad,
            r: crownW * (0.32 + (rnd() * 0.17)),
            limb: true,
        });
    }
    // A smaller core lobe keeps the field non-empty on the axis (the star-shaped assumption the
    // trace depends on) without swallowing the ring that surrounds it.
    lobes.push({
        x: 0, y: centreY, z: 0, r: crownW * 0.42,
    });

    // ⚠️ 0.13, DOWN FROM 0.34. The blend width has to JOIN neighbouring lobes, not dissolve
    // them: at a third of the crown width it melted a ring of five masses into one arc. The
    // cloud field logged the same tuning ("SMIN_K melts generously") and the fix is the same —
    // enough to make the join continuous, not enough to erase what is being joined.
    // Guarded: a zero-width spec would make this 0, and the smooth-min divides by it — the
    // cloud sculptor's "NaN that walked through the guard" arrived exactly this way.
    const SMIN_K = Math.max(1e-4, crownW * 0.13);
    const crinkleAmp = CRINKLE_AMP[lod] ?? 0;
    // Wavelength ~1.4 crown-widths — deliberately COARSER than the hull's facet spacing, so a
    // bump spans several triangles and rounds, instead of landing inside one and flattening it.
    const crinkleFreq = 4.4 / Math.max(1e-3, crownW);
    // The BOWL: a smooth-max against the crown's underside plane, flattening and solidifying
    // the bottom of the mass instead of letting lobes hang below it as separate balls.
    const bowlY = centreY - (crownH * 0.46);
    const sdf = (px, py, pz) => {
        let d = Infinity;
        for (let i = 0; i < lobes.length; i += 1) {
            const l = lobes[i];
            const dl = Math.hypot(px - l.x, py - l.y, pz - l.z) - l.r;
            d = i === 0 ? dl : smoothMin(d, dl, SMIN_K);
        }
        // THE CRINKLE. Promised by this file's own header since Wave 1 and never implemented
        // until the owner said the canopy looked nothing like the reference — a comment
        // describing unwritten code, the same defect the snow flag had. It perturbs the FIELD,
        // so the traced surface gains bumps rather than the shading faking them, and §1b R4's
        // "scalloped union of convex lobes" becomes a property of the silhouette.
        const cr = crinkleAmp > 0
            ? valueNoise3(px * crinkleFreq, py * crinkleFreq, pz * crinkleFreq)
                * crinkleAmp * crownW
            : 0;
        // smooth-max(d, bowlPlane) == -smin(-d, -plane)
        const plane = bowlY - py;
        return -smoothMin(-(d + cr), -plane, SMIN_K * 0.85);
    };

    const ico = new THREE.IcosahedronGeometry(1, detail);
    const dir = ico.getAttribute('position');
    const positions = [];
    const normals = [];
    const vert = [];

    // The trace's start radius must enclose every lobe, or a direction starts INSIDE the
    // surface and the bracket is invalid.
    let outer = 0;
    lobes.forEach((l) => {
        outer = Math.max(outer, Math.hypot(l.x, l.y - centreY, l.z) + l.r);
    });
    // The crinkle can push the surface OUTWARD, so the trace's start radius has to clear it as
    // well as the smin bulge — starting inside the surface invalidates the bracket.
    outer = (outer + SMIN_K + (crinkleAmp * crownW)) * 1.35;

    const traced = new Float32Array(dir.count * 3);
    for (let v = 0; v < dir.count; v += 1) {
        const dl = Math.hypot(dir.getX(v), dir.getY(v), dir.getZ(v)) || 1;
        const dx = dir.getX(v) / dl;
        const dy = dir.getY(v) / dl;
        const dz = dir.getZ(v) / dl;
        // March inward from outside the hull, then bisect the bracket.
        let tOut = outer;
        let tIn = 0;
        let found = false;
        for (let s = 1; s <= 20; s += 1) {
            const t = outer * (1 - (s / 20));
            const d = sdf(dx * t, centreY + (dy * t), dz * t);
            // ⚠️ EXPLICITLY FINITE, not `!(d > 0)`. The negated form treats NaN as INSIDE —
            // the mirror image of the cloud sculptor's bug, and the earlier comment here
            // described the guard it did NOT implement. A NaN field must never be read as a
            // surface hit; it must leave the vertex outside, where the bisection below is
            // still working on a valid bracket.
            if (Number.isFinite(d) && d <= 0) { tIn = t; found = true; break; }
            tOut = t;
        }
        // Running out of steps does NOT mean the ray missed — the bracket [0, tOut] is always
        // valid, and the cloud sculptor's first draft collapsed such vertices to the CENTRE,
        // punching spikes through its own hull. Bisect the bracket instead.
        if (!found) tIn = 0;
        let lo = tIn;
        let hi = tOut;
        for (let b = 0; b < 14; b += 1) {
            const mid = (lo + hi) * 0.5;
            const d = sdf(dx * mid, centreY + (dy * mid), dz * mid);
            if (Number.isFinite(d) && d <= 0) lo = mid; else hi = mid;
        }
        const t = (lo + hi) * 0.5;
        traced[v * 3] = dx * t;
        traced[(v * 3) + 1] = centreY + (dy * t);
        traced[(v * 3) + 2] = dz * t;
    }

    const idx = ico.getIndex();
    const triCount = idx ? idx.count / 3 : dir.count / 3;
    const hullTriangles = triCount;
    const hullSamples = [];
    for (let f = 0; f < triCount; f += 1) {
        for (let k = 0; k < 3; k += 1) {
            const v = idx ? idx.getX((f * 3) + k) : (f * 3) + k;
            const px = traced[v * 3];
            const py = traced[(v * 3) + 1];
            const pz = traced[(v * 3) + 2];
            positions.push(px, py, pz);
            // ⚠️ THE SDF GRADIENT, BENT ONLY PART-WAY TOWARD THE BLOB — not replaced by it.
            // A pure blob normal (which is what this baked until the owner said the canopy
            // looked nothing like the reference) radiates from the crown centre and is
            // therefore SMOOTH even where the surface is lumpy: every bump the sculptor cut
            // vanished from the shading and survived only in silhouette, so the canopy read as
            // a flat cutout with a ragged edge. The cloud field settled this already — its
            // FIELD_CENTROID_BEND is 0.30, i.e. keep most of the real surface and lean it
            // toward the mass — and the same number is what makes a cluster of lobes read as a
            // cluster here. The gradient is continuous across a smooth-min join, which is the
            // whole reason the union is a smin and not a min.
            const gEps = crownW * 0.035;
            const gx = sdf(px + gEps, py, pz) - sdf(px - gEps, py, pz);
            const gy = sdf(px, py + gEps, pz) - sdf(px, py - gEps, pz);
            const gz = sdf(px, py, pz + gEps) - sdf(px, py, pz - gEps);
            // Guarded: a zero-length normalize const-folds into a WGSL compile failure, and a
            // degenerate gradient (a perfectly flat field) is exactly where that would happen.
            const gl = Math.hypot(gx, gy, gz) || 1;
            const b = blobNormal(px, py, pz, centreY, BLOB_UP_BIAS * 0.6);
            const bend = FOREST_CENTROID_BEND;
            let nx = ((gx / gl) * (1 - bend)) + (b[0] * bend);
            let ny = ((gy / gl) * (1 - bend)) + (b[1] * bend);
            let nz = ((gz / gl) * (1 - bend)) + (b[2] * bend);
            const nl = Math.hypot(nx, ny, nz) || 1;
            nx /= nl; ny /= nl; nz /= nl;
            normals.push(nx, ny, nz);
            const heightFrac = Math.min(1, Math.max(0, (py - bowlY) / (crownH || 1)));
            const radialFrac = Math.min(1, Math.hypot(px, pz) / (crownW || 1));
            const aoHere = crownAO(radialFrac, heightFrac);
            const wHere = lod === 'far' ? 0 : Math.max(0, Math.min(1, py / (totalH || 1)));
            vert.push(aoHere, heightFrac, 1, wHere);
            if (k === 0) {
                hullSamples.push({
                    x: px, y: py, z: pz, n: [nx, ny, nz], ao: aoHere, h: heightFrac, w: wHere,
                });
            }
        }
    }
    ico.dispose();

    // THE FRINGE. Hero only: it is the tier the camera is close enough to resolve leaves on,
    // and the tier is ~520 trees of 15,400 — the same "spend detail where the player is"
    // discipline Firewatch used when it put its budget in the lower branch band.
    appendLeafPlates(
        { positions, normals, vert },
        hullSamples,
        {
            count: LEAF_PLATES[lod] ?? 0,
            size: 0.205,
            out: 0.78,
            rnd,
            centreY,
            crownW,
            crownH,
        },
    );

    // ── limbs ── (hero and mid; sub-pixel at far, like the trunk)
    // A tapered limb from the trunk's fork to just inside each ring lobe, so the crown's
    // masses are visibly CARRIED rather than floating. The quad pattern is the trunk
    // emitter's — (b0, t1, b1) / (b0, t0, t1) on a right-handed ring frame (T x B = d) — the
    // pattern the signed-volume winding test certifies; a CW limb would be invisible from
    // half the angles, which is worse than no limb.
    if (lod !== 'far') {
        const forkY = trunkH * (0.52 + (rnd() * 0.22));
        // Mid pays half the fork: 3-sided limbs on every OTHER lobe. At 120-520 u the fork
        // still reads (it is the silhouette between trunk and crown) but a full five-limb set
        // per tree measured the station back over the D5-accepted budget, and the budget is a
        // wall, not a wish.
        // Every OTHER lobe forks, at both tiers — and that is the reference's own count, not
        // only a budget cut: ref2's trees show 2-4 visible limbs, and seven limbs per crown
        // read as a broom. Measured cost of the full seven: +0.72 ms on Lane B, breaking the
        // D5 budget; four limbs is both cheaper and closer to the drawing.
        const limbSides = lod === 'hero' ? 5 : 3;
        const limbEvery = 2;
        lobes.forEach((L, li) => {
            if (!L.limb || (li % limbEvery) !== 0) return;
            const ex = L.x * 0.82;
            const ey = L.y - (L.r * 0.15);
            const ez = L.z * 0.82;
            let dx = ex; let dy = ey - forkY; let dz = ez;
            const dl = Math.hypot(dx, dy, dz) || 1;
            dx /= dl; dy /= dl; dz /= dl;
            const ax = Math.abs(dy) < 0.9 ? [0, 1, 0] : [1, 0, 0];
            let tx = (dy * ax[2]) - (dz * ax[1]);
            let ty = (dz * ax[0]) - (dx * ax[2]);
            let tz = (dx * ax[1]) - (dy * ax[0]);
            const tl = Math.hypot(tx, ty, tz) || 1;
            tx /= tl; ty /= tl; tz /= tl;
            const bx = (dy * tz) - (dz * ty);
            const by = (dz * tx) - (dx * tz);
            const bz = (dx * ty) - (dy * tx);
            const r0 = trunkR * (0.62 + (rnd() * 0.18));
            const r1 = r0 * 0.42;
            for (let i2 = 0; i2 < limbSides; i2 += 1) {
                const a0 = (i2 / limbSides) * Math.PI * 2;
                const a1 = ((i2 + 1) / limbSides) * Math.PI * 2;
                const ringAt = (cx, cy, cz, rr, a) => [
                    cx + (Math.cos(a) * tx * rr) + (Math.sin(a) * bx * rr),
                    cy + (Math.cos(a) * ty * rr) + (Math.sin(a) * by * rr),
                    cz + (Math.cos(a) * tz * rr) + (Math.sin(a) * bz * rr),
                ];
                const p0 = ringAt(0, forkY, 0, r0, a0);
                const p1 = ringAt(0, forkY, 0, r0, a1);
                const q0 = ringAt(ex, ey, ez, r1, a0);
                const q1 = ringAt(ex, ey, ez, r1, a1);
                [[p0, q1, p1], [p0, q0, q1]].forEach((tri) => tri.forEach(([px, py, pz]) => {
                    positions.push(px, py, pz);
                    // Outward radial normal from the limb's axis at this vertex.
                    const t2 = ((px * dx) + ((py - forkY) * dy) + (pz * dz));
                    let nx2 = px - (dx * t2);
                    let ny2 = (py - forkY) - (dy * t2);
                    let nz2 = pz - (dz * t2);
                    const nl2 = Math.hypot(nx2, ny2, nz2) || 1;
                    nx2 /= nl2; ny2 /= nl2; nz2 /= nl2;
                    normals.push(nx2, ny2, nz2);
                    vert.push(0.30, 0, 0, Math.max(0, Math.min(1, py / (totalH || 1))));
                }));
            }
        });
    }

    // ── trunk ──
    // 6 at hero, 4 at mid: the mid tier measured 92 triangles against a 90 budget, and two of
    // those were trunk sides nobody resolves at that distance.
    // FAR HAS NO TRUNK: at 700+ units it is sub-pixel, and dropping it is what keeps the
    // round detail-0 hull inside budget. The crown then floats by its (invisible) trunk
    // height — stated, bounded and asserted in odyssey-forest.test.js rather than hidden.
    if (lod === 'far') {
        return {
            positions, normals, vert, totalH, crownW, centreY, hullTriangles,
        };
    }
    const tSides = lod === 'hero' ? 6 : 4;
    for (let i = 0; i < tSides; i += 1) {
        const a0 = (i / tSides) * Math.PI * 2;
        const a1 = ((i + 1) / tSides) * Math.PI * 2;
        const flare = 1.5;
        const x0 = Math.cos(a0) * trunkR;
        const z0 = Math.sin(a0) * trunkR;
        const x1 = Math.cos(a1) * trunkR;
        const z1 = Math.sin(a1) * trunkR;
        const top = trunkH + (crownH * 0.20);
        [
            [x0 * flare, 0, z0 * flare], [x1, top, z1], [x1 * flare, 0, z1 * flare],
            [x0 * flare, 0, z0 * flare], [x0, top, z0], [x1, top, z1],
        ].forEach(([px, py, pz]) => {
            positions.push(px, py, pz);
            const l = Math.hypot(px, pz) || 1;
            normals.push(px / l, 0.12, pz / l);
            vert.push(0.30, 0, 0, Math.max(0, Math.min(1, py / (totalH || 1))));
        });
    }

    return {
        positions, normals, vert, totalH, crownW, centreY, hullTriangles,
    };
}

/**
 * Build one species/stage/LOD into a non-indexed BufferGeometry with the baked attributes.
 *
 * Non-indexed on purpose: the world's forest clones a geometry per chunk and attaches instanced
 * attributes to the clone, and the incumbent tree geometry is non-indexed for the same reason.
 */
export function buildForestTreeGeometry(spec, stage, lod, seed = 1) {
    const built = spec.builder === 'conifer'
        ? buildConifer(spec, stage, lod, seed)
        : buildBroadleaf(spec, stage, lod, seed);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(built.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(built.normals, 3));
    /**
     * ⚠️ ONE PACKED vec4, BECAUSE WEBGPU ALLOWS ONLY 8 VERTEX BUFFERS AND THE FIRST CUT NEEDED
     * TEN. Separate `color` / `aIsCrown` / `aHeight01` attributes plus five per-instance ones
     * blew the device limit outright: "Vertex buffer count (10) exceeds the maximum number of
     * vertex buffers (8)", every pipeline failed to create, and the frame rendered BLACK. It
     * is a hard limit, not a budget, and nothing in a headless test can see it — only a
     * capture can.
     *
     *   x = analytic AO            consumed as a band-THRESHOLD shift, never a colour multiply
     *   y = height in CROWN        Oga's dark interior mass; 0 all along a canopy's underside
     *   z = is crown (0 trunk)     because y === 0 does NOT mean trunk — see below
     *   w = height above GROUND    the wind mask; a trunk base must not sway
     *
     * `z` earns its channel: height-in-crown is legitimately 0 along the bowl of a broadleaf
     * and the lowest tier rim of a conifer, so a material separating trunk from crown by `y`
     * paints the whole underside of every canopy with the TRUNK colour — and since those are
     * exactly the surfaces meant to read dark, it looks like a shading choice rather than a bug.
     *
     * ⚠️ THE PER-TREE SEED IS GONE, AND ITS REMOVAL IS A BUG FIX. It was documented as "a
     * per-tree random, constant across the whole tree", but geometry is built once per
     * (species, LOD) and SHARED by every instance using it — so the value was constant per
     * GEOMETRY and delivered exactly zero per-tree variation. Anything genuinely per-tree has
     * to be an INSTANCED attribute, which is where the wind phase already lives.
     */
    geo.setAttribute('aVert', new THREE.Float32BufferAttribute(built.vert, 4));
    geo.userData.forest = {
        speciesId: spec.id,
        stageId: stage.id,
        lod,
        triangles: built.positions.length / 9,
        // How many of those are the TRACED hull (the rest are trunk). The collapse test needs
        // to look at exactly the traced vertices and nothing else.
        hullTriangles: built.hullTriangles ?? built.positions.length / 9,
        totalH: built.totalH,
        crownW: built.crownW,
        // Exposed so a test can check for the cloud sculptor's collapse-to-centre defect,
        // which is a collapse toward THIS point and not toward the world origin.
        centreY: built.centreY,
        role: spec.role,
        shade: FOREST_VALUE_ROLES[spec.role],
    };
    return geo;
}

/**
 * Build the whole roster: every species x stage x LOD.
 *
 * Returned as a flat array with `userData.forest` on each geometry, which is what the audition
 * board reads and what the budget test asserts against.
 */
export function buildForestRoster(species, { lods = ['hero', 'mid', 'far'] } = {}) {
    const out = [];
    species.forEach((spec, si) => {
        spec.stages.forEach((stage, gi) => {
            lods.forEach((lod, li) => {
                out.push(buildForestTreeGeometry(
                    spec,
                    stage,
                    lod,
                    ((si + 1) * 7919) + ((gi + 1) * 104729) + ((li + 1) * 1299709),
                ));
            });
        });
    });
    return out;
}

/** Budget check used by the tests and by the audition board's console summary. */
export function forestRosterBudget(geometries) {
    const worst = { hero: 0, mid: 0, far: 0 };
    geometries.forEach((g) => {
        const { lod, triangles } = g.userData.forest;
        worst[lod] = Math.max(worst[lod], triangles);
    });
    return {
        worst,
        withinBudget: Object.keys(worst).every((k) => worst[k] <= FOREST_LOD_BUDGET[k]),
        budget: FOREST_LOD_BUDGET,
    };
}
