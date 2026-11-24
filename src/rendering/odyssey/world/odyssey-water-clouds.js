/**
 * CLOUDS IN THE WATER (water pass step 2, 2026-10-31; the clouds themselves since 2026-11-24).
 *
 * A water that holds the sky's clouds is the strongest single cue that it is water and that it belongs to this
 * sky. Not a mirror pass (the sea and the tarn stand 293 u apart, and a pass has pipelines to warm): each
 * water traces its OWN reflected ray against an ellipsoid for each of the sky's clouds, where that cloud is
 * this frame, so a reflection moves, grows and thins with its cloud. The CPU picks the clouds whose mirror
 * image can be in view, largest first, into a small table the shaders loop over. Rippled water blurs a
 * reflection, so a lobed ellipsoid reads as the cloud above it.
 *
 * Three-free, so the selection is unit-tested in Node.
 */
import { CLOUD_SHAPES } from './odyssey-cloud-data.js';

/** How many clouds the shaders trace per water pixel (three vec4 rows each). */
export const WATER_CLOUD_SLOTS = 12;

/** Who is worth a reflection: the wall and the floor are the horizon's, the cap is small. */
const MIRRORED = new Set(['fair', 'giant']);

/**
 * A cloud's ellipsoid where it stands: its middle and its half axes along its length, up, and across.
 * @param {object} s a CloudState (odyssey-cloud-composition.js)
 * @param {object} out written and returned
 */
export function waterCloudProxy(s, out) {
    const { box, lo, hi } = CLOUD_SHAPES[s.shape];
    const half = (i) => box[i] * (hi[i] - lo[i]) * 0.5;
    // What is eaten away is smaller all round.
    const keep = 1 - (0.35 * Math.max(0, Math.min(1, s.eaten)));
    out.a = Math.max(1, half(0) * s.w * 1.04 * keep);
    out.b = Math.max(1, half(1) * s.w * s.tall * 1.04 * keep);
    out.c = Math.max(1, half(2) * s.w * 1.04 * keep);
    const mx = ((lo[0] + hi[0]) * 0.5) - 0.5;
    const mz = ((lo[2] + hi[2]) * 0.5) - 0.5;
    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    const ox = mx * box[0] * s.w;
    const oz = mz * box[2] * s.w;
    out.x = s.x + (ox * cos) + (oz * sin);
    out.y = s.y + ((lo[1] + hi[1]) * 0.5 * box[1] * s.w * s.tall);
    out.z = s.z + (oz * cos) - (ox * sin);
    out.cos = cos;
    // (The table turns a world offset into the cloud's own frame by +yaw.)
    out.sin = -sin;
    // Where its flat base cuts the ellipsoid, in the ellipsoid's own unit.
    out.baseQ = -0.82;
    return out;
}

const scratchPicks = [];
const scratchProxy = {};

/**
 * Pick the clouds whose mirror image can be in view, largest on screen first, and write them as three rows
 * each: (x, y, z, cos yaw), (1/a, 1/b, 1/c, sin yaw) and (base in the unit frame, a phase for the lobes, 0, 0).
 * Returns how many were written.
 *
 * @param {Array<object>} states the sky's clouds this frame (odyssey-clouds.js `states`)
 * @param {{x:number,y:number,z:number}} eye the camera position
 * @param {(x:number, y:number, z:number, r:number) => boolean} inView a sphere-in-frustum test
 * @param {ReadonlyArray<number>} mirrorLevels the water planes (the sea, the tarn)
 * @param {Array<{x:number,y:number,z:number,w:number}>} rows 3 x WATER_CLOUD_SLOTS rows, written in place
 * @returns {number}
 */
export function selectWaterClouds(states, eye, inView, mirrorLevels, rows) {
    scratchPicks.length = 0;
    for (let i = 0; i < states.length; i += 1) {
        const s = states[i];
        if (!MIRRORED.has(s.role) || s.cover < 0.25 || s.eaten > 0.6) continue;
        const p = waterCloudProxy(s, scratchProxy);
        const radius = Math.max(p.a, p.b, p.c);
        let best = 0;
        for (let k = 0; k < mirrorLevels.length; k += 1) {
            const my = (2 * mirrorLevels[k]) - p.y;
            if (eye.y >= mirrorLevels[k] && inView(p.x, my, p.z, radius)) {
                best = Math.max(best, s.w / Math.max(Math.hypot(p.x - eye.x, my - eye.y, p.z - eye.z), 1));
            }
        }
        if (best > 0) scratchPicks.push({ s, score: best });
    }
    scratchPicks.sort((m, n) => n.score - m.score);
    const count = Math.min(scratchPicks.length, Math.floor(rows.length / 3));
    for (let i = 0; i < count; i += 1) {
        const p = waterCloudProxy(scratchPicks[i].s, scratchProxy);
        const r0 = rows[i * 3];
        const r1 = rows[(i * 3) + 1];
        const r2 = rows[(i * 3) + 2];
        r0.x = p.x; r0.y = p.y; r0.z = p.z; r0.w = p.cos;
        r1.x = 1 / p.a; r1.y = 1 / p.b; r1.z = 1 / p.c; r1.w = p.sin;
        r2.x = p.baseQ; r2.y = scratchPicks[i].s.seed * 37.0; r2.z = 0; r2.w = 0;
    }
    return count;
}
