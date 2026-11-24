import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';
import { FOREST_SPECIMENS } from './odyssey-forest-models-decode.js';

/**
 * THE FOREST'S SHADE ON THE GROUND (Act II pass, step 3, 2026-10-25).
 *
 * The sun bake marches the terrain only, so not one of Act II's trees cast a shadow: every
 * stand stood on fully sunlit grass and read as pasted on, and the gaps between crowns were as
 * bright as the meadow. The trees are static (their sway is a few units at the crown), so their
 * shade is baked once from the scatter into one plate the ground reads:
 *
 *   R  the SUN SHADOW. Each crown is a few ellipsoids, measured from the grown specimen's own foliage
 *      (odyssey-forest-models.js `shade`); each one's shadow is an ellipse on the ground,
 *      stretched along the sun's bearing by 1 / sin(elevation) and set where the ray from its
 *      centre meets the terrain. Under the side sun of §1 (15° up) a 20 u pine throws a shadow
 *      ~60 u long, so the forest edge rakes long shade across the meadow.
 *   G  the CANOPY COVER: a soft disc under each crown. The ground takes it as sky occlusion (the
 *      forest floor is dark where the sun does reach it) and, beyond the forest's draw distance,
 *      as the far forest itself, read through the plate's mips as canopy density.
 *   B  the crown's red and A its green, both premultiplied by the cover, so the mips average
 *      them with it and B / G, A / G is the canopy's mean colour at any scale: the far forest
 *      takes the hue of the trees it stands in for (gold and red on the autumn side).
 *
 * Pure arithmetic over the scatter's placements, no three.js, so it can run wherever the
 * scatter runs. Union by `max`, not a sum: two shadows over one patch of ground are one shadow.
 */

/**
 * The plate: a square over the scatter's disc (centre -220, -620, radius 1750) and the shadow
 * reach past its edge, ~1.76 u per texel. RGBA8, mipmapped on the GPU. `colourScale` is the
 * headroom the crown colours are stored with (no crown channel reaches 0.7).
 */
export const FOREST_SHADE_PLATE = Object.freeze({
    x: -220,
    z: -620,
    extent: 3600,
    res: 2048,
    colourScale: 0.7,
});

/**
 * How much sun a crown stops (a broadleaf's open crown lets more through than a fir's needles), and
 * how soft each shadow's rim is.
 */
const NEEDLES = new Set(['spruce', 'fir', 'cypress', 'juniper']);
const SHADOW_OPACITY = Object.freeze({ needles: 0.86, leaves: 0.78 });
const SHADOW_SOFT = 0.5;
/**
 * A BROADLEAF'S SHADOW IS LEAFY. Drawn as a clean ellipse, a lone oak's shade on open meadow
 * read as a dark blob pasted on the grass. Its crown is a cluster of leaf masses, so its shadow
 * is too: the outline is pushed in and out by a smooth noise at the scale of those masses
 * (`RAGGED`, as a fraction of the ellipse) and light comes through the gaps (`DAPPLE`, the most
 * the same noise takes off inside). A fir's needles are dense: its shadow stays whole and sharp,
 * which is what draws the stripes down a conifer slope.
 */
const BROADLEAF_RAGGED = 0.7;
const BROADLEAF_DAPPLE = 0.4;
/** A trunk's shadow, from its foot to its crown's: faint (it is under a texel wide). */
const TRUNK_SHADOW = 0.42;
/** The canopy disc: radius as a multiple of the crown's, and its peak. */
const COVER_REACH = 1.15;
const COVER_PEAK = 1.0;

/**
 * Bake the forest's shade plate.
 * @param {Array<{x:number,y:number,z:number,specimen:number,scale:number,scaleY:number,rot:number,
 *   leanX:number,leanZ:number,crown:number[]}>} placements
 * @param {(x:number, z:number) => number} heightAt the terrain the shadows land on
 * @param {{res?: number, sun?: ArrayLike<number>}} [opts]
 * @returns {{data: Uint8Array, res: number, extent: number, x: number, z: number}} RGBA8, row j = +z
 */
export function bakeForestShadeData(placements, heightAt, {
    res = FOREST_SHADE_PLATE.res, sun = ODYSSEY_WORLD_SUN,
} = {}) {
    const P = FOREST_SHADE_PLATE;
    const texel = P.extent / res;
    const x0 = P.x - (P.extent / 2);
    const z0 = P.z - (P.extent / 2);
    const shadow = new Float32Array(res * res);
    const trunk = new Float32Array(res * res);
    const cover = new Float32Array(res * res);
    const red = new Float32Array(res * res);
    const green = new Float32Array(res * res);

    const len = Math.hypot(sun[0], sun[1], sun[2]);
    const sinE = sun[1] / len;
    const flat = Math.hypot(sun[0], sun[2]);
    // The shadow falls AWAY from the sun.
    const dx = -sun[0] / flat;
    const dz = -sun[2] / flat;
    const cotE = (flat / len) / sinE;
    const cosE = flat / len;

    const trees = FOREST_SPECIMENS.map((spec) => {
        const needles = NEEDLES.has(spec.species);
        return {
            spheres: spec.shade, opacity: needles ? SHADOW_OPACITY.needles : SHADOW_OPACITY.leaves, leafy: !needles, trunkR: spec.trunkR,
        };
    });

    // A smooth value noise from a wrapped lattice table, in world units so it does not change
    // with the plate's resolution (the leafy outline and the dapple read it).
    const LATTICE = 256;
    const table = new Float32Array(LATTICE * LATTICE);
    let seed = 0x9e3779b9;
    for (let k = 0; k < table.length; k += 1) {
        seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d);
        seed = Math.imul(seed ^ (seed >>> 12), 0x297a2d39);
        table[k] = ((seed ^ (seed >>> 15)) >>> 0) / 4294967296;
    }
    const valueNoise = (u, v) => {
        const iu = Math.floor(u);
        const iv = Math.floor(v);
        let fu = u - iu;
        let fv = v - iv;
        fu = fu * fu * (3 - (2 * fu));
        fv = fv * fv * (3 - (2 * fv));
        const a = iu & (LATTICE - 1);
        const b = (iu + 1) & (LATTICE - 1);
        const r0 = (iv & (LATTICE - 1)) * LATTICE;
        const r1 = ((iv + 1) & (LATTICE - 1)) * LATTICE;
        const top = table[r0 + a] + ((table[r0 + b] - table[r0 + a]) * fu);
        const bot = table[r1 + a] + ((table[r1 + b] - table[r1 + a]) * fu);
        return top + ((bot - top) * fv);
    };

    // One soft ellipse into a channel: `a` along (dx, dz), `b` across, peak `peak`. `leafy` pushes
    // the outline in and out and lets light through the gaps (BROADLEAF_RAGGED / _DAPPLE). Where
    // it wins a texel, `paint` (if given) is told so, with the texel index and the opacity.
    const splat = (buf, cx, cz, a, b, peak, soft, leafy = false, paint = null) => {
        const reach = Math.max(a, b) * (leafy ? 1 + (BROADLEAF_RAGGED * 0.5) : 1);
        const i0 = Math.max(0, Math.floor((cx - reach - x0) / texel));
        const i1 = Math.min(res - 1, Math.ceil((cx + reach - x0) / texel));
        const j0 = Math.max(0, Math.floor((cz - reach - z0) / texel));
        const j1 = Math.min(res - 1, Math.ceil((cz + reach - z0) / texel));
        const ia = 1 / a;
        const ib = 1 / b;
        for (let j = j0; j <= j1; j += 1) {
            const wz = z0 + ((j + 0.5) * texel);
            const pz = wz - cz;
            const row = j * res;
            for (let i = i0; i <= i1; i += 1) {
                const wx = x0 + ((i + 0.5) * texel);
                const px = wx - cx;
                const u = ((px * dx) + (pz * dz)) * ia;
                const v = ((pz * dx) - (px * dz)) * ib;
                let q = (u * u) + (v * v);
                let dapple = 1;
                if (leafy) {
                    if (q >= 2.4) continue;
                    const n = (valueNoise(wx / 5.2, wz / 5.2) * 0.62)
                        + (valueNoise((wx / 11.5) + 37.1, (wz / 11.5) - 12.7) * 0.38);
                    const edge = 1 + (BROADLEAF_RAGGED * (n - 0.5));
                    q /= edge * edge;
                    const fine = valueNoise((wx / 3.1) - 71.3, (wz / 3.1) + 5.9);
                    dapple = 1 - (BROADLEAF_DAPPLE * Math.min(1, Math.max(0, (fine - 0.35) / 0.4)));
                }
                if (q >= 1) continue;
                const t = Math.min(1, (1 - q) / soft);
                const o = peak * t * t * (3 - (2 * t)) * dapple;
                if (o > buf[row + i]) {
                    buf[row + i] = o;
                    if (paint) paint(row + i, o);
                }
            }
        }
    };

    for (let n = 0; n < placements.length; n += 1) {
        const p = placements[n];
        // A fern's shade is under a texel.
        if (p.role === 'floor') continue;
        const {
            spheres, opacity, leafy, trunkR,
        } = trees[p.specimen];
        // A far tree's shadow is a few texels: every other part of its crown, a little larger, no leaf edge.
        const far = p.lod === 'far';
        const step = far && spheres.length > 2 ? 2 : 1;
        const sxz = p.scale;
        const sy = p.scaleY;
        const turnC = Math.cos(p.rot);
        const turnS = Math.sin(p.rot);
        let crownR = 0;
        let firstReach = Infinity;
        for (let k = 0; k < spheres.length; k += step) {
            const [ox, hy, oz, r, ry] = spheres[k];
            const R = r * sxz;
            const RY = ry * sy * (step > 1 ? 1.5 : 1);
            // Where this part of the crown stands: turned with the tree, leaned with its height.
            const px = p.x + (((ox * turnC) + (oz * turnS)) * sxz) + (p.leanX * hy * sy);
            const pz = p.z + (((oz * turnC) - (ox * turnS)) * sxz) + (p.leanZ * hy * sy);
            crownR = Math.max(crownR, R);
            const cy = p.y + (hy * sy);
            // Where the ray from the sphere's centre meets the ground: two passes over the
            // terrain under it, so a shadow cast down a slope runs longer and one cast up it
            // shorter. Capped: on ground falling away nearly as steeply as the sun is low, the
            // ray grazes it and the reach runs off to streaks (and such ground is in the
            // terrain's own shadow by the sun bake anyway).
            const flatReach = (cy - p.y) * cotE;
            let s = flatReach;
            for (let it = 0; it < 2; it += 1) {
                const yg = heightAt(px + (s * dx), pz + (s * dz));
                s = Math.min(flatReach * 1.8, Math.max(0, (cy - yg) * cotE));
            }
            // An ellipsoid (R across, RY up) seen along a ray at elevation e throws an ellipse
            // R wide and sqrt(R² sin²e + RY² cos²e) / sin e long.
            const along = Math.sqrt((R * R * sinE * sinE) + (RY * RY * cosE * cosE)) / sinE;
            splat(shadow, px + (s * dx), pz + (s * dz), along, R, opacity, SHADOW_SOFT, leafy && !far);
            firstReach = Math.min(firstReach, s - (along * 0.6));
        }
        // The trunk's shadow joins the foot to the crown's, so a lone tree's shade starts at it.
        if (firstReach > texel) {
            const half = firstReach / 2;
            splat(
                trunk,
                p.x + (half * dx),
                p.z + (half * dz),
                half,
                Math.max(trunkR * sxz * 1.6, texel * 0.75),
                TRUNK_SHADOW,
                0.6,
            );
        }
        // A snag has no crown to lay over the ground.
        if (!spheres.length) continue;
        const cr = Math.min(1, (p.crown?.[0] ?? 0.15) / P.colourScale);
        const cg = Math.min(1, (p.crown?.[1] ?? 0.25) / P.colourScale);
        splat(cover, p.x, p.z, crownR * COVER_REACH, crownR * COVER_REACH, COVER_PEAK, 0.7, false, (k, o) => {
            red[k] = cr * o;
            green[k] = cg * o;
        });
    }

    const data = new Uint8Array(res * res * 4);
    for (let k = 0; k < res * res; k += 1) {
        data[k * 4] = Math.round(Math.max(shadow[k], trunk[k]) * 255);
        data[(k * 4) + 1] = Math.round(cover[k] * 255);
        data[(k * 4) + 2] = Math.round(red[k] * 255);
        data[(k * 4) + 3] = Math.round(green[k] * 255);
    }
    return {
        data, res, extent: P.extent, x: P.x, z: P.z,
    };
}
