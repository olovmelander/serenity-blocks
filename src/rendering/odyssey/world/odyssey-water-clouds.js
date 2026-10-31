/**
 * CLOUDS IN THE WATER (water pass step 2, 2026-10-31).
 *
 * Neither water mirrored a cloud: the sea showed a gradient of sky, the tarn the sky and the
 * hillside. A water that holds the sky's clouds is the strongest single cue that it is water and
 * that it belongs to this sky (the owner's Witness pond frame is half reflection).
 *
 * HOW, and why not a mirror pass. A planar `reflector()` re-renders the scene for one plane only
 * (the sea and the tarn stand 293 u apart) and adds a pass whose pipelines must be warmed before
 * the reveal. Instead each water traces its OWN reflected ray against a few proxies of the cloud
 * field: an ellipsoid fitted to each mass's lobes (from the sculptor's own layout), drifting on the
 * field's own Lissajous (the vertex stage's `cfDrift`, same seed and constants), so a reflection
 * moves with its cloud. The CPU picks, each frame, the masses whose mirror image can be in view
 * (over the sea's plane or the tarn's), largest first, into a small table the shaders loop over.
 * Rippled water blurs a reflection, so a lobed ellipsoid reads as the cloud above it.
 *
 * Three-free apart from the sculptor's lobe layout, so the selection is unit-tested in Node.
 */
import { buildCloudLobes } from './odyssey-cloud-field.js';
import { makeRng } from './odyssey-hero-clouds.js';

/** How many masses the shaders trace per water pixel (two vec4 rows each). */
export const WATER_CLOUD_SLOTS = 12;

/**
 * Fit an ellipsoid to each mass, in the mass's own (yawed) frame: half extents along its long
 * axis, across it and up, from its lobes. The ellipsoid is centred between the flat base and the
 * crown; `baseQ` is the base's height in the ellipsoid's unit frame (the shader cuts below it).
 *
 * @param {ReadonlyArray<object>} specs the cloud field's specs (any look)
 * @param {{x:number, z:number, radius:[number, number]}} anchor the massif the banner holds to
 *   (CLOUD_FIELD_ANCHOR's radii about that massif): drift is scaled to 0 inside radius[0]
 * @returns {Array<object>}
 */
export function buildWaterCloudProxies(specs, anchor) {
    return specs.map((spec) => {
        const lobes = buildCloudLobes(spec);
        const cosY = Math.cos(spec.yaw || 0);
        const sinY = Math.sin(spec.yaw || 0);
        let ex = 0;
        let ez = 0;
        let top = spec.base;
        lobes.forEach((l) => {
            const dx = l.x - spec.x;
            const dz = l.z - spec.z;
            const lx = (dx * cosY) + (dz * sinY);
            const lz = (-dx * sinY) + (dz * cosY);
            ex = Math.max(ex, Math.abs(lx) + l.r);
            ez = Math.max(ez, Math.abs(lz) + l.r);
            top = Math.max(top, l.y + (l.r * l.squash));
        });
        const halfH = Math.max((top - spec.base) * 0.5, 1);
        const cy = spec.base + halfH;
        // Ellipsoid half axes a little inside the extents (lobes are round, the box is not), then
        // grown until every lobe centre lies inside: a reflection may soften a lobe, never cut one.
        let a = ex * 0.92;
        let b = halfH * 1.04;
        let c = ez * 0.92;
        let reach = 0;
        lobes.forEach((l) => {
            const dx = l.x - spec.x;
            const dz = l.z - spec.z;
            reach = Math.max(reach, Math.hypot(
                ((dx * cosY) + (dz * sinY)) / a,
                (l.y - cy) / b,
                ((-dx * sinY) + (dz * cosY)) / c,
            ));
        });
        if (reach > 0.95) {
            const k = reach / 0.95;
            a *= k;
            b *= k;
            c *= k;
        }
        // The sculptor's `color.b`: the per-mass random the field's drift is seeded by.
        const seed = makeRng(spec.seed + 991)();
        const fromAnchor = Math.hypot(spec.x - anchor.x, spec.z - anchor.z);
        const [r0, r1] = anchor.radius;
        const u = Math.max(0, Math.min(1, (fromAnchor - r0) / (r1 - r0)));
        return {
            id: spec.id,
            x: spec.x,
            y: cy,
            z: spec.z,
            a,
            b,
            c,
            cos: cosY,
            sin: sinY,
            baseQ: (spec.base - cy) / b,
            w: spec.w,
            seed,
            anchorK: u * u * (3 - (2 * u)),
        };
    });
}

/**
 * The field's drift at `time` (the vertex stage's `cfDrift`, term for term).
 * @param {object} proxy
 * @param {number} time
 * @param {{xz:number, y:number, periodMin:number, periodMax:number}} drift
 * @param {{x:number,y:number,z:number}} out
 */
export function waterCloudDrift(proxy, time, drift, out) {
    const phase = proxy.seed * 6.2831853;
    const period = drift.periodMin + (proxy.seed * (drift.periodMax - drift.periodMin));
    const w = 6.2831853 / period;
    out.x = Math.sin((time * w) + phase) * drift.xz * proxy.anchorK;
    out.y = Math.sin((time * w * 0.61) + (phase * 1.7)) * drift.y * proxy.anchorK;
    out.z = Math.cos((time * w * 0.83) + (phase * 0.6)) * drift.xz * 0.82 * proxy.anchorK;
    return out;
}

const scratchDrift = {
    x: 0, y: 0, z: 0,
};
const scratchPicks = [];

/**
 * Pick the masses whose mirror image can be in view, largest on screen first, and write them as
 * three rows each: (x, y, z, cos yaw), (1/a, 1/b, 1/c, sin yaw) and (base in the unit frame, a
 * phase for the lobes, 0, 0). Returns how many were written.
 *
 * @param {Array<object>} proxies from {@link buildWaterCloudProxies}
 * @param {number} time the world clock (the field's uTime)
 * @param {object} drift the field's drift constants
 * @param {{x:number,y:number,z:number}} eye the camera position
 * @param {(x:number, y:number, z:number, r:number) => boolean} inView a sphere-in-frustum test
 * @param {ReadonlyArray<number>} mirrorLevels the water planes (the sea, the tarn)
 * @param {Array<{x:number,y:number,z:number,w:number}>} rows 3 x WATER_CLOUD_SLOTS rows, written in place
 * @returns {number}
 */
export function selectWaterClouds(proxies, time, drift, eye, inView, mirrorLevels, rows) {
    scratchPicks.length = 0;
    proxies.forEach((p) => {
        waterCloudDrift(p, time, drift, scratchDrift);
        const x = p.x + scratchDrift.x;
        const y = p.y + scratchDrift.y;
        const z = p.z + scratchDrift.z;
        const radius = Math.max(p.a, p.b, p.c);
        let best = 0;
        mirrorLevels.forEach((level) => {
            const my = (2 * level) - y;
            if (eye.y < level) return;
            if (!inView(x, my, z, radius)) return;
            const d = Math.hypot(x - eye.x, my - eye.y, z - eye.z);
            best = Math.max(best, p.w / Math.max(d, 1));
        });
        if (best > 0) {
            scratchPicks.push({
                p, x, y, z, score: best,
            });
        }
    });
    scratchPicks.sort((m, n) => n.score - m.score);
    const count = Math.min(scratchPicks.length, Math.floor(rows.length / 3));
    for (let i = 0; i < count; i += 1) {
        const {
            p, x, y, z,
        } = scratchPicks[i];
        const r0 = rows[i * 3];
        const r1 = rows[(i * 3) + 1];
        const r2 = rows[(i * 3) + 2];
        r0.x = x; r0.y = y; r0.z = z; r0.w = p.cos;
        r1.x = 1 / p.a; r1.y = 1 / p.b; r1.z = 1 / p.c; r1.w = p.sin;
        r2.x = p.baseQ; r2.y = p.seed * 37.0; r2.z = 0; r2.w = 0;
    }
    return count;
}
