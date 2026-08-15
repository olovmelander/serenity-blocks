/**
 * THE FINGERPRINT that keeps the baked forest visibility mask honest.
 *
 * A visibility mask is only valid for the rail and the height field it was baked from. Move
 * either — retune the spline, reshape a massif, change the sea level — and the mask starts
 * deleting trees that have become visible. It does that SILENTLY: no error, no warning, just
 * gaps where a forest used to be, discovered whenever somebody next looks at that part of the
 * island. This repo has shipped that shape of defect before (a lever nobody read, reporting
 * innocence rather than absence), so the mask carries a fingerprint of both its inputs and a
 * test recomputes it.
 *
 * Kept in its own module because the BAKER (a node script) and the TEST (vitest) must compute
 * it identically; a copy in each is a fingerprint that can drift from itself.
 *
 * It samples rather than hashes everything: 96 rail points and a 24x24 grid of heights is
 * plenty to notice any change that would move a sightline, and it stays fast enough for a unit
 * test to run every time.
 */

import { odysseyWorldHeight, ODYSSEY_SEA_LEVEL } from './odyssey-world-height.js';
import { getOdysseyPathPointAt } from '../path-utils.js';

const RAIL_SAMPLES = 96;
const HEIGHT_GRID = 24;
const HEIGHT_EXTENT = 5000;

/** FNV-1a over a float, quantised so meaningless last-bit noise cannot flap the stamp. */
function mixFloat(hash, value) {
    let h = hash;
    const q = Math.round(value * 100);
    for (let shift = 0; shift < 32; shift += 8) {
        h ^= (q >>> shift) & 0xff;
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
}

/**
 * A short hex fingerprint of the rail geometry and the terrain the mask was baked against.
 * @returns {string}
 */
export function forestVisibilityStamp() {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < RAIL_SAMPLES; i += 1) {
        const p = i / (RAIL_SAMPLES - 1);
        const pt = getOdysseyPathPointAt(p);
        h = mixFloat(h, pt.x);
        h = mixFloat(h, pt.y);
        h = mixFloat(h, pt.z);
    }
    const step = HEIGHT_EXTENT / (HEIGHT_GRID - 1);
    const origin = -HEIGHT_EXTENT / 2;
    for (let j = 0; j < HEIGHT_GRID; j += 1) {
        for (let i = 0; i < HEIGHT_GRID; i += 1) {
            h = mixFloat(h, odysseyWorldHeight(origin + (i * step), origin + (j * step)));
        }
    }
    h = mixFloat(h, ODYSSEY_SEA_LEVEL);
    return h.toString(16).padStart(8, '0');
}
