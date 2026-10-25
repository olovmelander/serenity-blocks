import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';
import { getForestSpecies } from './odyssey-forest-species.js';

/**
 * THE FOREST'S SHADE ON THE GROUND (Act II pass, step 3, 2026-10-25).
 *
 * The sun bake marches the terrain only, so not one of Act II's trees cast a shadow: every
 * stand stood on fully sunlit grass and read as pasted on, and the gaps between crowns were as
 * bright as the meadow. The trees are static (their sway is a few units at the crown), so their
 * shade is baked once from the scatter into one plate the ground reads:
 *
 *   R  the SUN SHADOW. Each crown is a few spheres along its axis (a cone's taper for a conifer,
 *      one ellipsoid for a broadleaf); each sphere's shadow is an ellipse on the ground,
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

/** The world scale of a roster tree (1 u = 1 m); the renderer's instance matrices use it too. */
export const FOREST_WORLD_SCALE = 4.6;

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
 * How much sun a crown stops, by builder (a broadleaf's open crown lets more through than a
 * fir's), and how soft each shadow's rim is.
 */
const SHADOW_OPACITY = Object.freeze({ conifer: 0.86, broadleaf: 0.78 });
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
 * A crown as spheres in the tree's local units (mature stage, before the instance scale),
 * measured from the two builders' own formulas (odyssey-forest-geometry.js):
 *   conifer   a cone from ~0.6 of the trunk to the apex, base radius 1.2 x crownW;
 *   broadleaf one ellipsoid, horizontal radius 0.85 x the built crown width (1.55 x crownW),
 *             centred at trunk + 0.52 of the built crown height (1.65 x crownH).
 * Each entry is [height of centre, horizontal radius, vertical semi-axis].
 */
function crownSpheres(spec) {
    if (spec.builder === 'conifer') {
        const base = spec.trunkH * 0.6;
        const top = spec.trunkH + (spec.crownH * 3.4);
        const rBase = spec.crownW * 1.2;
        const span = top - base;
        return [0.12, 0.36, 0.6, 0.82].map((t) => {
            const r = rBase * (1 - t) * 1.05;
            return [base + (span * t), r, Math.max(r, span * 0.13)];
        });
    }
    const builtW = spec.crownW * 1.55;
    const builtH = spec.crownH * 1.65;
    return [[spec.trunkH + (builtH * 0.52), builtW * 0.85, builtH * 0.63]];
}

/**
 * Bake the forest's shade plate.
 * @param {Array<{x:number,y:number,z:number,speciesId:string,scaleXZ:number,scaleY:number,
 *   crown:number[]}>} placements
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

    const spheresBy = new Map();
    const spheresOf = (id) => {
        if (!spheresBy.has(id)) {
            const spec = getForestSpecies(id);
            spheresBy.set(id, spec ? {
                spheres: crownSpheres(spec),
                opacity: SHADOW_OPACITY[spec.builder] ?? SHADOW_OPACITY.broadleaf,
                leafy: spec.builder !== 'conifer',
                trunkR: spec.trunkR ?? 0.06,
            } : null);
        }
        return spheresBy.get(id);
    };

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
        const tree = spheresOf(p.speciesId);
        if (!tree) continue;
        const { spheres, opacity, leafy } = tree;
        const sxz = p.scaleXZ * FOREST_WORLD_SCALE;
        const sy = p.scaleY * FOREST_WORLD_SCALE;
        let crownR = 0;
        let firstReach = Infinity;
        for (let k = 0; k < spheres.length; k += 1) {
            const [hy, r, ry] = spheres[k];
            const R = r * sxz;
            const RY = ry * sy;
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
                const yg = heightAt(p.x + (s * dx), p.z + (s * dz));
                s = Math.min(flatReach * 1.8, Math.max(0, (cy - yg) * cotE));
            }
            // An ellipsoid (R across, RY up) seen along a ray at elevation e throws an ellipse
            // R wide and sqrt(R² sin²e + RY² cos²e) / sin e long.
            const along = Math.sqrt((R * R * sinE * sinE) + (RY * RY * cosE * cosE)) / sinE;
            splat(shadow, p.x + (s * dx), p.z + (s * dz), along, R, opacity, SHADOW_SOFT, leafy);
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
                Math.max(tree.trunkR * sxz * 1.6, texel * 0.75),
                TRUNK_SHADOW,
                0.6,
            );
        }
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
