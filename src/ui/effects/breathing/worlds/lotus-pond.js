/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * The pond under Heart Glow's lotus: its perspective and its lily pads. Shared by the painted
 * backdrop (lotus.js) and the flower's mirror image (lotus-flower.js), which must hide wherever a
 * pad lies on the water between us and the reflection.
 *
 * The pond is a plane seen in perspective. A screen point's depth on it comes from its distance
 * below the horizon, scaled so that plane units are hero units at the flower (which stands at
 * x = 0, depth 1); each depth takes its own parallax under the breathing camera.
 */
import { Vector4 } from 'three/webgpu';
import {
    If, Loop, float, int, max, screenUV, select, sin, smoothstep, uniformArray, vec2, vec4,
} from 'three/tsl';
import { fadeOut, layer } from '../stage/breath-tsl.js';

/** The flower's base meets the water this far below the hero (hero units). */
export const WATERLINE = -0.2;
/**
 * The pond's foreshortening at the flower (how far the horizon sits above the waterline): tall
 * screens look further down onto the water, so they see more pond and less sky.
 */
const LOOK = 0.5;
const LOOK_TALL = 0.2;
export const lookDown = (extY) => LOOK + (extY - 1) * LOOK_TALL;
export const lookDownNode = (u) => u.ext.y.sub(1).mul(LOOK_TALL).add(LOOK);

/**
 * Lily pads (plane units): x, depth, radius, the direction of the notch (radians), and how young
 * the leaf is (young leaves are wine-red). Listed far to near so nearer pads cover farther ones.
 * A crowded bed on the left, open water on the right for the lanterns' reflections; one pad tucked
 * behind the flower and one in front of it, cutting into its image. Depths under ~0.35 are only
 * seen on tall screens.
 */
const PADS = [
    [0.35, 4.6, 0.36, 2.2, 0.2],
    [-2.7, 3.8, 0.42, 0.7, 0.0],
    [-1.75, 3.2, 0.3, 2.6, 0.3],
    [3.2, 3.3, 0.4, 3.6, 0.5],
    [-1.3, 2.4, 0.3, 4.4, 0.1],
    [-0.8, 2.05, 0.18, 1.2, 0.0],
    [1.75, 2.2, 0.28, 1.4, 0.0],
    [-0.42, 1.75, 0.2, 5.4, 0.6],
    [0.66, 1.55, 0.16, 2.9, 0.0],
    [-1.3, 1.4, 0.28, 0.9, 0.2],
    [0.3, 1.2, 0.2, 4.2, 0.0],
    [-0.98, 1.06, 0.26, 0.3, 0.15],
    [0.95, 1.0, 0.22, 3.9, 0.3],
    [-0.45, 0.83, 0.16, 5.0, 0.1],
    [-0.74, 0.66, 0.2, 5.9, 0.0],
    [1.02, 0.6, 0.26, 2.4, 0.1],
    [-0.98, 0.5, 0.17, 3.4, 0.5],
    [-0.3, 0.5, 0.1, 2.0, 0.4],
    [0.44, 0.43, 0.11, 4.9, 0.7],
    [-0.52, 0.39, 0.12, 1.1, 0.0],
    [-0.12, 0.36, 0.07, 3.0, 0.2],
    [0.2, 0.3, 0.075, 3.3, 0.2],
    [-0.2, 0.27, 0.06, 0.5, 0.0],
    [0.04, 0.255, 0.055, 1.7, 0.0],
];
/**
 * Depth bands: a pixel only walks the pads whose depth range overlaps its own band. Neighbouring
 * pixels share a band, so the branch is coherent and the far pads cost the near water nothing.
 * Each band is a contiguous run of the shader's pad table (a pad near a boundary is listed twice).
 */
const BANDS = (() => {
    let start = 0;
    return [[1.5, 61], [0.8, 1.7], [0.0, 0.95]].map(([lo, hi]) => {
        const pads = PADS.map((pad, index) => ({ pad, index }))
            .filter(({ pad: [, z, radius] }) => z + radius * 1.15 > lo && z - radius * 1.15 < hi);
        const band = {
            lo, hi, start, end: start + pads.length, pads,
        };
        start += pads.length;
        return band;
    });
})();

/** A screen fragment's hero point (for meshes; the backdrop uses its own quad's uv). */
export const screenPoint = (u) => vec2(screenUV.x.mul(2).sub(1), float(1).sub(screenUV.y.mul(2)))
    .mul(u.ext).sub(vec2(0, u.focus));

/**
 * Where screen point `p` lands on the pond. Every value stays finite above the horizon (depth is
 * capped there) so terms built on it can be masked out safely.
 */
export function pondPlane(p, u) {
    const slope = lookDownNode(u).toVar();
    const horizon = slope.add(WATERLINE).toVar();
    const below = horizon.sub(p.y).toVar();
    // Depth at rest, then again under the camera at that depth's own parallax.
    const z0 = slope.div(below.max(0.002)).min(60);
    const wq = layer(p, u, float(1).div(z0).min(2.5)).toVar();
    const depth = slope.div(horizon.sub(wq.y).max(0.002)).min(60).toVar();
    const plane = vec2(wq.x.mul(depth), depth).toVar();
    // About a pixel and a half on screen, in plane units (the plane is foreshortened vertically).
    const planePx = u.px.mul(depth).mul(max(float(1), depth.div(slope))).mul(1.4).toVar();
    return {
        slope, horizon, below, depth, plane, planePx,
    };
}

/**
 * The lily pads as shader data, read by index inside one loop per depth band: the loop body
 * compiles once instead of once per pad. Returns `padField(plane, planePx, detail)`: the coverage
 * at a point on the pond and, with `detail`, the covering pad's own coordinates (radius 1, the
 * notch along +x), its youth and index, and the water's meniscus around the rims.
 */
export function createPadField() {
    const placeRow = [];
    const turnRow = [];
    BANDS.forEach(({ pads }) => pads.forEach(({ pad: [x, z, radius, notch, youth], index }) => {
        placeRow.push(new Vector4(x, z, 1 / radius, youth));
        turnRow.push(new Vector4(Math.cos(-notch), Math.sin(-notch), index * 1.7, index));
    }));
    const place = uniformArray(placeRow, 'vec4');
    const turns = uniformArray(turnRow, 'vec4');

    return function padField(plane, planePx, detail = true) {
        const cover = float(0).toVar();
        // The winning pad: its local x, y, its youth and its index.
        const best = vec4(2, 0, 0, 0).toVar();
        const meniscus = float(0).toVar();
        BANDS.forEach(({
            lo, hi, start, end,
        }) => {
            If(plane.y.greaterThan(lo).and(plane.y.lessThan(hi)), () => {
                Loop({
                    start: int(start), end: int(end), type: 'int', condition: '<',
                }, ({ i }) => {
                    const at = place.element(i).toVar();
                    const spin = turns.element(i).toVar();
                    const rel = plane.sub(at.xy).toVar();
                    const q = vec2(rel.x.mul(spin.x).sub(rel.y.mul(spin.y)), rel.x.mul(spin.y).add(rel.y.mul(spin.x)))
                        .mul(at.z).toVar();
                    const d = q.length().toVar();
                    const dir = q.div(d.max(1e-4));
                    // Leaves are never perfect circles.
                    const wobble = sin(dir.x.mul(5.3).add(dir.y.mul(2.1)).add(spin.z)).mul(0.03);
                    const inside = float(1).add(wobble).sub(d).toVar();
                    const soft = planePx.mul(at.z).toVar();
                    // The notch: a narrow wedge from the centre out through the rim.
                    const slit = smoothstep(0.975, 0.992, dir.x).mul(smoothstep(0.02, 0.08, d));
                    const here = smoothstep(soft.negate(), soft, inside).mul(float(1).sub(slit)).toVar();
                    if (detail) {
                        best.assign(select(here.greaterThanEqual(cover.max(0.02)), vec4(q, at.w, spin.w), best));
                        // The water's meniscus: a thin dark line hugging the rim.
                        const outside = inside.negate();
                        meniscus.assign(max(meniscus, fadeOut(soft, soft.add(0.045), outside).mul(smoothstep(-0.01, soft, outside))));
                    }
                    cover.assign(max(cover, here));
                });
            });
        });
        return {
            cover, local: best.xy, young: best.z, seed: best.w, meniscus,
        };
    };
}
