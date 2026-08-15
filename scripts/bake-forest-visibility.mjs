/**
 * BAKE THE RAIL VISIBILITY MASK for the Act II forest.
 *
 *   node scripts/bake-forest-visibility.mjs
 *
 * Writes src/rendering/odyssey/world/odyssey-forest-visibility.js — a committed, generated
 * module holding one bit per cell: "can the journey's camera ever see a canopy standing here?"
 *
 * WHY THIS IS DECIDABLE AT ALL. Act II's camera is pinned to a spline over a fixed height
 * field, so "is this tree ever visible" is not a heuristic about where players tend to look —
 * it is geometry, and geometry can be settled offline to whatever margin we choose. Most games
 * cannot do this; a rail can.
 *
 * WHAT MAKES THE ANSWER SAFE. The test is deliberately weaker than the shipped camera:
 *
 *  - It ignores the FRUSTUM entirely and asks only whether terrain blocks the line of sight, so
 *    the result survives any change to fov, pitch, look-ahead, damping, per-chapter framing,
 *    seam/vista beats and the cinematic director. Measured on the first pass, that costs 22
 *    points of cull (69% of trees are outside the real frustum; only 47% are behind a ridge) —
 *    and it buys independence from every camera parameter in the tree.
 *  - It samples an ENVELOPE of eye positions per station, not a point. `computeFollowFrame`
 *    puts the eye ~28 u back along the tangent, ±2.6 u laterally from per-chapter framing, and
 *    at a measured net -16 u in Y. The backward offset needs no special handling — 28 u back
 *    along the rail is simply another station, and stations are sampled every ~7 u — but the
 *    lateral and vertical spread do, so each station tests a small grid of eyes.
 *  - Canopy height, blocking margin and dilation are generous (see the constants), and the
 *    exit gate for the plan that produced this file is bit-identical captures, not "close".
 *
 * THE STAMP IS THE POINT OF FAILURE, so it is checked in a test. A mask is only valid for the
 * rail and terrain it was baked from; move either and it silently deletes trees that ARE now
 * visible. The module therefore carries a fingerprint of both inputs, and
 * odyssey-forest-visibility.test.js recomputes it and fails on drift. That is the difference
 * between a cache and a landmine.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { odysseyWorldHeight, ODYSSEY_EYE_RAIL_OFFSET_Y } from '../src/rendering/odyssey/world/odyssey-world-height.js';
import { getOdysseyPathPointAt } from '../src/rendering/odyssey/path-utils.js';
import { forestVisibilityStamp } from '../src/rendering/odyssey/world/odyssey-forest-visibility-stamp.js';

/** Act II's progress span, widened a little at both ends so the act edges are covered. */
const P0 = 0.08;
const P1 = 0.63;
const STATIONS = 460;
/**
 * Mask grid over the plantable disc's bounding box, generous on every side.
 *
 * DERIVED FROM THE SCATTER, not guessed: it plants on a disc at (cx -220, cz -620) of radius
 * 1750, so sites run x -1970..1530 and z -2370..1130. The first cut of this baker used
 * x1 = 700 and silently excluded the island's entire far right — the exact ground the owner
 * asked about — from consideration. It failed SAFE (out-of-bounds reads return "visible", so
 * those trees simply survived) and it was invisible until a test compared the mask's box against
 * the forest's actual extent. Hence that test.
 */
const RES = 256;
const X0 = -2050;
const X1 = 1620;
const Z0 = -2450;
const Z1 = 1220;
/** Taller than any authored stage, so a mask cell can never clip a crown that would show. */
const CANOPY = 16;
/** Terrain must beat the sightline by this much before it counts as blocking. Absorbs the
 *  difference between this analytic height field and the baked, morphing clipmap that draws. */
const BLOCK_MARGIN = 6;
/** Cells of safety added around every visible region after the sweep. */
const DILATE = 2;
/** The eye envelope per station: lateral and vertical spread around the measured rail eye. */
const EYE_LATERAL = [-6, 0, 6];
const EYE_VERTICAL = [ODYSSEY_EYE_RAIL_OFFSET_Y, -4, 10];

// A cached height grid. The honest test is millions of marches; the analytic field would make
// this run for many minutes, and the bakes in the renderer cache for the same reason.
const HEXT = 9000;
const HRES = 900;
const HSTEP = HEXT / (HRES - 1);
const HORIGIN = -HEXT / 2;
const heights = new Float32Array(HRES * HRES);
for (let j = 0; j < HRES; j += 1) {
    const z = HORIGIN + (j * HSTEP);
    for (let i = 0; i < HRES; i += 1) heights[(j * HRES) + i] = odysseyWorldHeight(HORIGIN + (i * HSTEP), z);
}
function H(x, z) {
    const gx = Math.max(0, Math.min(HRES - 1.001, (x - HORIGIN) / HSTEP));
    const gz = Math.max(0, Math.min(HRES - 1.001, (z - HORIGIN) / HSTEP));
    const i0 = gx | 0;
    const j0 = gz | 0;
    const fx = gx - i0;
    const fz = gz - j0;
    const a = heights[(j0 * HRES) + i0];
    const b = heights[(j0 * HRES) + i0 + 1];
    const c = heights[((j0 + 1) * HRES) + i0];
    const d = heights[((j0 + 1) * HRES) + i0 + 1];
    return (((a * (1 - fx)) + (b * fx)) * (1 - fz)) + (((c * (1 - fx)) + (d * fx)) * fz);
}

const eyes = [];
for (let k = 0; k < STATIONS; k += 1) {
    const p = P0 + ((P1 - P0) * (k / (STATIONS - 1)));
    const a = getOdysseyPathPointAt(p);
    const b = getOdysseyPathPointAt(Math.min(1, p + 0.002));
    const fx = b.x - a.x;
    const fz = b.z - a.z;
    const fl = Math.hypot(fx, fz) || 1;
    const rx = -fz / fl;
    const rz = fx / fl;
    for (const lat of EYE_LATERAL) {
        for (const vert of EYE_VERTICAL) {
            eyes.push({ x: a.x + (rx * lat), y: a.y + vert, z: a.z + (rz * lat) });
        }
    }
}

function clearLine(s, tx, ty, tz) {
    const dx = tx - s.x;
    const dy = ty - s.y;
    const dz = tz - s.z;
    const dist = Math.hypot(dx, dz);
    const steps = Math.min(180, Math.max(8, Math.floor(dist / 28)));
    for (let i = 1; i < steps; i += 1) {
        const t = i / steps;
        if (H(s.x + (dx * t), s.z + (dz * t)) > s.y + (dy * t) + BLOCK_MARGIN) return false;
    }
    return true;
}

const raw = new Uint8Array(RES * RES);
for (let j = 0; j < RES; j += 1) {
    const z = Z0 + (((Z1 - Z0) * j) / (RES - 1));
    for (let i = 0; i < RES; i += 1) {
        const x = X0 + (((X1 - X0) * i) / (RES - 1));
        const ty = H(x, z) + CANOPY;
        // Nearest eyes first: a visible cell exits early, an invisible one pays the full sweep.
        const order = eyes
            .map((s, k) => [((s.x - x) ** 2) + ((s.z - z) ** 2), k])
            .sort((a, b) => a[0] - b[0]);
        let seen = 0;
        for (let oi = 0; oi < order.length && !seen; oi += 1) {
            if (clearLine(eyes[order[oi][1]], x, ty, z)) seen = 1;
        }
        raw[(j * RES) + i] = seen;
    }
}

const mask = new Uint8Array(RES * RES);
for (let j = 0; j < RES; j += 1) {
    for (let i = 0; i < RES; i += 1) {
        let any = 0;
        for (let dj = -DILATE; dj <= DILATE && !any; dj += 1) {
            for (let di = -DILATE; di <= DILATE && !any; di += 1) {
                const jj = j + dj;
                const ii = i + di;
                if (jj >= 0 && jj < RES && ii >= 0 && ii < RES && raw[(jj * RES) + ii]) any = 1;
            }
        }
        mask[(j * RES) + i] = any;
    }
}

const bytes = new Uint8Array(mask.length / 8);
for (let k = 0; k < mask.length; k += 1) {
    if (mask[k]) bytes[k >> 3] |= 1 << (k & 7);
}
const b64 = Buffer.from(bytes).toString('base64');
const visible = mask.reduce((a, b) => a + b, 0);
const stamp = forestVisibilityStamp();

const out = `/**
 * GENERATED by scripts/bake-forest-visibility.mjs — DO NOT EDIT BY HAND.
 *
 * One bit per cell: can the Act II journey's camera ever see a canopy standing here? The bit is
 * set from an OMNIDIRECTIONAL terrain-occlusion sweep over an envelope of eye positions along
 * the rail, so it is independent of fov, pitch, look-ahead, damping, per-chapter framing and the
 * cinematic director — see the baker for the full argument and the safety margins.
 *
 * ⚠️ VALID ONLY FOR THE RAIL AND HEIGHT FIELD IT WAS BAKED FROM. \`FOREST_VISIBILITY_STAMP\`
 * fingerprints both; odyssey-forest-visibility.test.js recomputes it and fails when it drifts.
 * If that test fails, RE-BAKE — do not relax the test. A stale mask deletes trees that have
 * become visible, and it does it silently.
 *
 * Baked ${visible} visible cells of ${RES * RES} (${((100 * visible) / mask.length).toFixed(1)}%).
 */

export const FOREST_VISIBILITY = Object.freeze({
    res: ${RES},
    x0: ${X0},
    x1: ${X1},
    z0: ${Z0},
    z1: ${Z1},
});

/** Fingerprint of the rail samples and the height field this mask was baked from. */
export const FOREST_VISIBILITY_STAMP = '${stamp}';

const BITS = '${b64}';
const BYTES = typeof atob === 'function'
    ? Uint8Array.from(atob(BITS), (c) => c.charCodeAt(0))
    : Uint8Array.from(Buffer.from(BITS, 'base64'));

/**
 * True when the journey can ever see a canopy at this world position.
 *
 * Outside the baked box the answer is TRUE, never false: a site the baker never considered must
 * not be culled by it. Every failure of this function should leave a tree standing.
 */
export function railSeesForestSite(x, z) {
    const {
        res, x0, x1, z0, z1,
    } = FOREST_VISIBILITY;
    const i = Math.round(((x - x0) / (x1 - x0)) * (res - 1));
    const j = Math.round(((z - z0) / (z1 - z0)) * (res - 1));
    if (i < 0 || j < 0 || i >= res || j >= res) return true;
    const k = (j * res) + i;
    return (BYTES[k >> 3] & (1 << (k & 7))) !== 0;
}
`;

const here = path.dirname(fileURLToPath(import.meta.url));
const dest = path.join(here, '..', 'src', 'rendering', 'odyssey', 'world', 'odyssey-forest-visibility.js');
writeFileSync(dest, out);
console.log(`[forest-visibility] ${visible}/${mask.length} cells visible (${((100 * visible) / mask.length).toFixed(1)}%)`);
console.log(`[forest-visibility] stamp ${stamp}`);
console.log(`[forest-visibility] wrote ${path.relative(path.join(here, '..'), dest)} (${(out.length / 1024).toFixed(1)} KB)`);
