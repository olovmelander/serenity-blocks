/**
 * Thermal Bloom — the steam (iris-springs.md §1.4, §3.3, §3.6.1): plumes as slices of one volume,
 * and the ground mist.
 *
 * Every plume is `tier.sheets` vertical sheets that share one yaw (each turns about the plume's
 * own leaning axis to face the camera) and stand staggered through the plume's depth, back to
 * front, so they never cross. A sheet's fragment reads the density of ONE continuous field at
 * its world position: an envelope (a column that widens with height and leans downwind, fading
 * in over its first metres off the ground and out over its top third) times billows from the
 * noise atlas read as 3D noise by the 2D-lattice trick (two slices of the tileable fBm, offset by
 * the integer part of height, blended by its fraction), advected upward and domain-warped, with a
 * finer second tap on the tiers that keep it. Adjacent sheets therefore show parallax-consistent
 * slices of the same billow: volume, not cards. The quad is 1.4× the envelope, so nothing ever
 * reaches its edge.
 *
 * Light: the sun times a self-shadow tap toward it, a phase that favours the backscatter we see
 * (the sun stands behind the camera's shoulder), sky on the shade side, and underlight from the
 * ground below — the Iris's dome turquoise at its core and apricot at its skirts, dying off over
 * ~12 m of height. Opacity is Beer's law over the sheet's share of the plume's depth. Output is
 * premultiplied over the scene. A gust tears a travelling lane through the Iris's dome; over the
 * card the steam thins to a quarter (the post's calm zone does the rest).
 *
 * The ground mist: a few horizontal sheets 1–4 m over the warm apron round the Iris, drifting
 * with the wind, holed where a gust passes.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    dFdx,
    dFdy,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    screenUV,
    sin,
    smoothstep,
    step,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    IRIS_RADIUS,
    PLUME_KIND,
    STEAM_LEAN,
    STEAM_SLOTS,
    tbAerial,
    tbFxMaterial,
    tbHgMix,
    tbPart,
    tbPlumeShade,
} from './thermal-bloom-tsl.js';

/** Steam's optical density per unit of field density per metre. */
const SIGMA = 0.075;
/** Rise speed of the billows (m/s) and the billow scale (metres per noise cell). */
const RISE = 1.6;
const BILLOW = 26;
/** The quad's margin round the envelope (×), and its height above the plume's top (×). */
const QUAD_WIDE = 1.4;
const QUAD_TALL = 1.15;
/** Slice offsets of the 2D-lattice trick (in tiles of the atlas): decorrelated per integer layer. */
const SLICE = [0.371, 0.173];
/** Rows a sheet is cut into, so it bends with the plume's curved lean instead of cutting it. */
const SHEET_ROWS = 8;
/** How far a swollen vent plume leans toward the frame's middle (metres per metre of height). */
const EXHALE_LEAN = 0.55;

/**
 * 3D value noise from the 2D atlas (the Void Ember lattice trick, gotcha #136): two slices of the
 * tileable fBm offset by the integer layer, blended by a smoothed fraction. The slices lie in the
 * vertical xy plane (the sheets face the camera, which looks along −z), the layers run through
 * depth: a sheet sees billows as round in both directions, and its neighbours see other layers.
 * @param {object} tex  the noise atlas
 * @param {object} p    vec3 in noise cells (z the layer axis)
 * @param {string} ch   the channel ('x' low fBm … 'z' fine)
 * @param {number} cellsPerTile  the channel's cells a tile (4 for x, 16 for z)
 */
function noise3(tex, p, ch, cellsPerTile) {
    const layer = floor(p.z);
    const f = fract(p.z);
    const w = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const uv = p.xy.div(cellsPerTile);
    // The layer's offset jumps where the layer changes: the mip must come from the continuous
    // coordinate's own derivatives, or every layer boundary draws a seam.
    const gx = dFdx(uv);
    const gy = dFdy(uv);
    const a = texture(tex, uv.add(vec2(SLICE[0], SLICE[1]).mul(layer))).grad(gx, gy)[ch];
    const b = texture(tex, uv.add(vec2(SLICE[0], SLICE[1]).mul(layer.add(1.0)))).grad(gx, gy)[ch];
    return mix(a, b, w);
}

/**
 * The plume sheets.
 * @param {object} u     the shared uniforms
 * @param {object} tier  the quality tier
 * @param {object} tex   the world's baked textures (the noise atlas)
 */
export function createSteam(u, tier, tex) {
    const sheets = Math.max(2, tier.sheets);
    const slots = Math.min(STEAM_SLOTS, tier.plumes);
    // One strip per sheet (SHEET_ROWS quads high), slots in draw order (the world fills them far
    // to near), each plume's sheets back to front. Vertices in (x ∈ −1..1, y ∈ 0..1).
    const quads = slots * sheets;
    const perSheet = (SHEET_ROWS + 1) * 2;
    const positions = new Float32Array(quads * perSheet * 3);
    const meta = new Float32Array(quads * perSheet * 2);
    const indices = new Uint32Array(quads * SHEET_ROWS * 6);
    for (let q = 0; q < quads; q++) {
        const slot = Math.floor(q / sheets);
        const k = q % sheets;
        for (let r = 0; r <= SHEET_ROWS; r++) {
            [-1, 1].forEach((x, c) => {
                const v = q * perSheet + r * 2 + c;
                positions.set([x, r / SHEET_ROWS, 0], v * 3);
                meta.set([slot, k], v * 2);
            });
            if (r < SHEET_ROWS) {
                const a = q * perSheet + r * 2;
                indices.set([a, a + 1, a + 3, a, a + 3, a + 2], (q * SHEET_ROWS + r) * 6);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSheet', new THREE.BufferAttribute(meta, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    const aSheet = attribute('aSheet', 'vec2');
    const vSlot = varying(aSheet.x, 'vSteamSlot');
    const rowA = (slot) => u.steamPlumes.element(int(slot.add(0.5)).mul(2));
    const rowB = (slot) => u.steamPlumes.element(int(slot.add(0.5)).mul(2).add(1));
    // The lean grows with height: tall columns bend over downwind near their tops.
    const leanAt = (h) => u.windDir.mul(u.windSpeed.mul(STEAM_LEAN).mul(h).mul(h.div(400.0).add(1.0)));
    /** A column's radius at a fraction of its height: a narrow stem that spreads as it rises. */
    const radiusAt = (B, frac) => mix(B.x.mul(0.6), B.y, clamp(frac, 0.0, 1.0).pow(0.8));
    /** Each sheet's share of the plume's depth (metres), and its offset toward the camera. */
    const span = 1.2;
    /**
     * A vent's own steam (the thread kind) swells into its steam phase — the Chalice's exhalation
     * after an eruption or a broken chain, the Sleeper's after a perfect clear — as its stem
     * widens (r0 ≥ 3 m … full by 12 m): 0 for every other kind and for the resting thread.
     */
    const swellOf = (B) => smoothstep(3.0, 12.0, B.x).mul(step(abs(B.w.sub(PLUME_KIND.thread)), 0.5));
    /**
     * A swollen plume towers out over the basin: besides the breeze it leans toward the frame's
     * middle (the air aloft carries it across the sky band rather than out of the frame).
     */
    const ventLean = (A, h) => {
        const f = normalize(u.camFwd.xz.add(vec2(0.0, 1e-4)));
        const v = A.xy.sub(u.camPos.xz);
        const perp = v.sub(f.mul(dot(v, f)));
        return perp.negate().div(max(length(perp), 1.0)).mul(h.mul(EXHALE_LEAN).mul(h.div(400.0).add(1.0)));
    };

    const material = tbFxMaterial('ThermalBloomSteam');
    material.positionNode = Fn(() => {
        const slot = aSheet.x;
        const A = rowA(slot);
        const B = rowB(slot);
        const live = step(slot.add(0.5), float(u.steamCount));
        const frac = positionGeometry.y.mul(QUAD_TALL);
        const h = frac.mul(A.w);
        const swell = swellOf(B);
        const c = A.xy.add(leanAt(h)).add(ventLean(A, h).mul(swell));
        const toCam = normalize(u.camPos.xz.sub(c).add(vec2(1e-3, 0.0)));
        const right = vec2(toCam.y.negate(), toCam.x);
        const rmax = max(B.x, B.y);
        // A swollen plume is sliced to its own width at each height: its stem is narrow and its
        // crown wide, and sheets spread for the crown alone would pass either side of the stem.
        const reach = radiusAt(B, frac).add(h.mul(0.07));
        // (a thread's too: on a tier of two sheets, slices spread to its crown would miss its stem)
        const hug = max(swell, step(abs(B.w.sub(PLUME_KIND.thread)), 0.5));
        const spread = mix(rmax, reach, hug);
        const halfW = mix(rmax, reach.add(2.0), swell);
        const depth = aSheet.y.div(sheets - 1).sub(0.5).negate().mul(span)
            .mul(spread);
        const xz = c.add(right.mul(positionGeometry.x).mul(halfW).mul(QUAD_WIDE)).add(toCam.mul(depth));
        // A slot the world leaves empty folds to a point far below the ground.
        return mix(vec3(0.0, -1e5, 0.0), vec3(xz.x, A.z.add(h), xz.y), live);
    })();

    const steamFn = Fn(() => {
        const slot = vSlot;
        const A = rowA(slot);
        const B = rowB(slot);
        const P = positionWorld.toVar();
        const toCam = u.camPos.sub(P);
        const dist = length(toCam).toVar();
        const V = toCam.div(max(dist, 1e-3)).toVar();
        const isDome = step(abs(B.w.sub(PLUME_KIND.dome)), 0.5);
        const isThread = step(abs(B.w.sub(PLUME_KIND.thread)), 0.5);
        const swell = swellOf(B).toVar();

        // ── The field ──
        const envelope = (Q) => {
            const hh = Q.y.sub(A.z);
            const frac = hh.div(max(A.w, 1.0));
            // A thread wanders as it rises (a rod of even width is not steam).
            const sway = vec2(u.windDir.y.negate(), u.windDir.x)
                .mul(sin(hh.mul(0.14).sub(u.time.mul(0.7))).mul(hh.mul(0.07)).mul(isThread));
            const c = A.xy.add(leanAt(hh)).add(sway).add(ventLean(A, hh).mul(swell));
            const d = length(Q.xz.sub(c));
            // A column: a stem widening upward, fading out over its top third.
            const rrCol = d.div(max(radiusAt(B, frac), 0.5));
            // Thin where it leaves the ground (seen against the dark rim forest it would lift the
            // frame's darks), fullest a fifth of the way up, fading out over its top third.
            const colEnv = smoothstep(1.0, 0.38, rrCol).mul(float(1.0).sub(smoothstep(0.62, 1.0, frac)))
                .mul(mix(float(0.55), float(1.0), smoothstep(0.02, 0.2, frac)));
            // The Iris's dome: a translucent shell (an ellipsoid as wide as the pool's skirts, as
            // tall as the plume), densest in its skin, thin inside, so a line of sight through its
            // middle sees the eye while one along its limb gathers a bright rim — the dome reads
            // by its silhouette. It rises off the water: thin over the first metres, full by ~16 m.
            const eN = texture(tex.noise, Q.xz.div(60.0)).y.sub(0.5).mul(0.18);
            // (3D noise: a warp read in the ground plane alone would smear into vertical streaks)
            const topWarp = noise3(tex.noise, Q.div(32.0).add(0.17), 'y', 4).sub(0.5).mul(0.35);
            // A heap, not a lens: it narrows as it rises, so from the low rim its crown stands
            // above the horizon against the forest and the sky.
            const heap = d.div(B.y.mul(float(1.0).sub(clamp(frac, 0.0, 1.0).mul(0.4))));
            const e = length(vec2(heap, hh.div(max(A.w.mul(topWarp.add(1.0)), 1.0)))).add(eN);
            const skin = smoothstep(1.0, 0.8, e).mul(smoothstep(0.3, 0.78, e).mul(0.7).add(0.3));
            // Thin over the water: every line of sight to the eye crosses the dome below ~12 m, so
            // the eye reads through wisps there while the crown, full above ~24 m, carries the dome.
            const crownN = noise3(tex.noise, Q.div(45.0).add(0.61), 'x', 4).sub(0.5);
            const domeEnv = skin.mul(mix(float(0.07), float(1.6), smoothstep(8.0, 26.0, hh.add(crownN.mul(10.0)))));
            return mix(colEnv, domeEnv, isDome).mul(smoothstep(0.0, 3.0, hh));
        };
        const env = envelope(P).toVar();
        const t = u.time;
        // Billows scale with the plume (a 50 m column is not made of 26 m puffs at 3 km).
        const billowSize = max(float(BILLOW), B.x.mul(1.3));
        const q = vec3(P.x, P.y.sub(t.mul(RISE)), P.z).div(billowSize).toVar();
        // The billows: a slow warp (period 9–14 s at this scale), then the lattice noise.
        const warp = noise3(tex.noise, q.mul(0.45).add(vec3(0.0, t.mul(0.009), 0.0)), 'y', 4).sub(0.5);
        const qw = q.add(vec3(warp.mul(1.6), warp.mul(-0.9), 0.0));
        let billow = noise3(tex.noise, qw, 'x', 4);
        if (tier.steamDetail) {
            const fine = noise3(tex.noise, qw.mul(3.1).add(vec3(0.0, t.mul(0.05), 0.0)), 'z', 16);
            // The fine tap fades with distance (far columns would break into grain).
            const fineW = float(0.4).mul(float(1.0).sub(smoothstep(500.0, 1800.0, dist)));
            billow = billow.mul(float(1.0).sub(fineW)).add(fine.mul(fineW));
        }
        const puffs = smoothstep(
            mix(mix(float(0.36), float(0.42), isDome), float(0.24), swell),
            mix(mix(float(0.8), float(0.72), isDome), float(0.68), swell),
            billow,
        );
        // (a swollen exhalation is optically thick: a roaring white volume, its row's density
        // left to cast the shadow it would)
        const rho = env.mul(puffs)
            .mul(B.z)
            .mul(u.steam)
            .mul(swell.mul(1.8).add(1.0))
            .toVar();
        // The gust's clear lane through the Iris's dome: it crosses in about 6 s.
        const g = u.gust;
        const across = vec2(u.windDir.y.negate(), u.windDir.x);
        const laneAt = mix(float(-1.6), float(1.6), clamp(g.x, 0.0, 1.0)).mul(IRIS_RADIUS);
        const ragged = texture(tex.noise, P.xz.div(70.0).add(vec2(0.0, t.mul(0.01)))).x.sub(0.5).mul(30.0);
        const lane = dot(P.xz.sub(A.xy), across).sub(laneAt).add(ragged).div(IRIS_RADIUS * 0.38);
        const tear = exp(lane.mul(lane).negate()).mul(step(0.0, g.x)).mul(isDome);
        rho.mulAssign(float(1.0).sub(tear.mul(0.95)));

        // ── Opacity: Beer over this sheet's share of the depth (the same total on every tier); a
        // thread is a dense core however thin it is ──
        const rmax = max(B.x, B.y);
        // (a swollen plume's sheets are spread to its width at this height: so is their share)
        const reachHere = mix(rmax, radiusAt(B, P.y.sub(A.z).div(max(A.w, 1.0))), swell);
        const L = max(reachHere.mul(span / sheets), mix(float(0.0), float(14.0), isThread.mul(float(1.0).sub(swell))));
        const alpha = float(1.0).sub(exp(rho.mul(L).mul(-SIGMA))).toVar();
        // Thinned over the card, and where a sheet meets the near plane.
        const c = u.cardRect;
        const inCard = step(c.x, screenUV.x).mul(step(screenUV.x, c.z)).mul(step(c.y, screenUV.y))
            .mul(step(screenUV.y, c.w));
        alpha.mulAssign(float(1.0).sub(inCard.mul(0.75)));
        alpha.mulAssign(smoothstep(20.0, 60.0, dist));
        // Looked down on steeply (the upright phone's high camera), the dome's crown would stand
        // over the eye as a white blotch: seen from above, it thins to the veil over the water.
        alpha.mulAssign(float(1.0).sub(smoothstep(0.3, 0.5, V.y).mul(0.9).mul(isDome)));
        // Soft against the ground behind it along the view (a soft particle against the analytic
        // floor): where a sheet nears the ground it fades, so no straight edge marks the water.
        const down = max(V.y, 1e-3);
        const tGround = u.camPos.y.sub(A.z).div(down);
        alpha.mulAssign(smoothstep(0.0, 9.0, tGround.sub(dist)));

        // ── Light ──
        // Self-shadow, toward the sun but only across and up the sheet: the sun stands behind the
        // camera, so its component along the view would only march back through this same slice.
        // A near tap through the billows (their relief) and a far one through the plume's bulk
        // (its terminator: the flank away from the sun in shade).
        const viewH = normalize(vec3(V.x, 0.0, V.z).add(vec3(1e-4, 0.0, 0.0)));
        const sunSheet = normalize(u.sunDir.sub(viewH.mul(dot(u.sunDir, viewH))).add(vec3(0.0, 1e-3, 0.0)));
        const Ps = P.add(sunSheet.mul(billowSize.mul(0.35)));
        const nearPuffs = smoothstep(0.36, 0.8, noise3(tex.noise, qw.add(sunSheet.mul(0.35)), 'x', 4));
        const nearRho = envelope(Ps).mul(nearPuffs).mul(B.z).mul(u.steam)
            .mul(mix(float(1.0), float(0.6), swell));
        const farEnv = envelope(P.add(sunSheet.mul(reachHere.mul(0.75))));
        // (a swollen exhalation is white: its bulk shades only its far flank)
        const farRho = farEnv.mul(nearPuffs.mul(0.6).add(0.4)).mul(B.z).mul(u.steam)
            .mul(mix(float(0.5), float(0.22), swell));
        const shadow = exp(nearRho.mul(-1.3).sub(farRho.mul(0.9))).toVar();
        // The dome is lit by its own form — its ellipsoid's normal toward the sun, pearl on the
        // sun's flank turning blue-grey away from it — and its billows' relief: a bulk shadow tap
        // drew a hard, straight terminator across the camera-facing slices over the eye.
        const cDome = A.xy.add(leanAt(P.y.sub(A.z)));
        const nDome = normalize(vec3(
            P.x.sub(cDome.x).div(max(B.y, 1.0)),
            P.y.sub(A.z).div(max(A.w, 1.0)).add(0.15),
            P.z.sub(cDome.y).div(max(B.y, 1.0)),
        ));
        const formLit = smoothstep(-0.55, 0.75, dot(nDome, u.sunDir)).mul(0.55).add(0.45)
            .mul(exp(nearRho.mul(-0.8)));
        shadow.assign(mix(shadow, formLit, isDome));
        const back = tbHgMix(dot(V, u.sunDir), float(0.35));
        // Lit: Steam Pearl (#F3F1EC) toward 0.86 on the display; shade: the sky's blue-grey
        // (#9DB1C6), never darker than it.
        const pearlLit = u.sunColor.mul(float(0.74).add(back.mul(0.12))).add(mix(u.haze, u.zenith, 0.5).mul(0.1));
        const shade = vec3(0.34, 0.43, 0.56).mul(mix(float(0.85), float(1.0), u.sunColor.y));
        const lit = mix(shade, pearlLit, shadow);
        // Underlight: the spring's glow from below (turquoise over the eye, apricot at the skirts);
        // the thread over the cone and the far columns catch only the warm ground.
        const hh = P.y.sub(A.z);
        const rr0 = length(P.xz.sub(A.xy)).div(max(B.x, 1.0));
        // Turquoise where the dome stands over the shelf and the deep water (rr 0.3–0.8), apricot
        // over the mats at its skirts.
        const turquoise = vec3(0.04, 0.42, 0.58).mul(smoothstep(0.15, 0.4, rr0));
        const domeGlow = mix(turquoise, vec3(0.75, 0.36, 0.12), smoothstep(0.75, 1.15, rr0));
        const groundGlow = vec3(0.5, 0.3, 0.16).mul(0.2).mul(exp(hh.div(-10.0)));
        const glow = mix(groundGlow, domeGlow.mul(exp(hh.div(-22.0))).mul(1.25), isDome)
            .mul(mix(float(0.45), float(0.85), isDome));
        // The dome's crown is tinted by the eye it stands over (about 30% toward the spring's
        // turquoise), its skirts by the mats (apricot): it reads against the pale apron behind.
        const rrLean = length(P.xz.sub(cDome)).div(max(B.y, 1.0));
        const crownCore = float(1.0).sub(smoothstep(0.3, 0.85, rrLean)).mul(smoothstep(12.0, 30.0, hh));
        const skirtWarm = smoothstep(0.7, 1.0, rrLean).mul(float(1.0).sub(smoothstep(6.0, 22.0, hh)));
        const crownTint = mix(vec3(1.0), vec3(0.7, 0.87, 0.92), crownCore);
        const domeTint = mix(crownTint, vec3(1.0, 0.86, 0.72), skirtWarm.mul(0.6));
        const col = lit.mul(mix(vec3(1.0), domeTint, isDome)).add(glow).toVar();
        const outCol = tbAerial(u, col, dist, V.negate());
        return vec4(outCol.mul(alpha), alpha);
    });
    material.colorNode = steamFn();
    const part = tbPart('ThermalBloomSteam', geometry, material, 60);
    part.slots = slots;
    return part;
}

/**
 * The ground mist: `tier.mistSheets` horizontal sheets 1–4 m over the warm apron round the Iris,
 * drifting with the wind, holed where a gust passes. Placed by the world on the Iris.
 */
export function createMist(u, tier, tex) {
    const n = Math.max(1, tier.mistSheets);
    const half = IRIS_RADIUS * 6;
    const positions = [];
    const index = [];
    for (let i = 0; i < n; i++) {
        const y = 1 + (3 * i) / Math.max(1, n - 1);
        const o = i * 4;
        positions.push(-half, y, -half, half, y, -half, half, y, half, -half, y, half);
        index.push(o, o + 2, o + 1, o, o + 3, o + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(index);
    const mistFn = Fn(() => {
        const P = positionWorld.toVar();
        const toCam = u.camPos.sub(P);
        const dist = length(toCam).toVar();
        const V = toCam.div(max(dist, 1e-3));
        const rel = P.xz.sub(u.irisCentre);
        const d = length(rel).div(IRIS_RADIUS);
        // Over the warm ground round the pool, never over the water's middle, gone by the quad's edge.
        const warm = smoothstep(0.4, 1.1, d).mul(0.75).add(0.25).mul(exp(d.div(2.2).mul(d.div(2.2)).negate()))
            .mul(float(1.0).sub(smoothstep(4.5, 5.8, d)));
        const drift = u.windDir.mul(u.windSpeed.mul(0.6).mul(u.time));
        const n1 = texture(tex.noise, P.xz.sub(drift).div(170.0)).x;
        const n2 = texture(tex.noise, P.xz.sub(drift.mul(1.3)).div(55.0).add(0.37)).y;
        const g = u.gust;
        const across = vec2(u.windDir.y.negate(), u.windDir.x);
        const lane = dot(rel, across).div(IRIS_RADIUS).sub(mix(float(-2.5), float(2.5), clamp(g.x, 0.0, 1.0)));
        const hole = exp(lane.mul(lane).negate()).mul(step(0.0, g.x));
        // Patchy: tongues and wisps over the warm ground, never a blanket (§3.3, anti-milk).
        const rho = warm.mul(smoothstep(0.52, 0.85, n1.mul(0.65).add(n2.mul(0.35)))).mul(u.steam)
            .mul(float(1.0).sub(hole.mul(0.8)));
        const alpha = min(rho.mul(0.2), 0.22).mul(smoothstep(30.0, 90.0, dist)).toVar();
        let sunShare = float(0.62);
        if (tier.anticrepuscular) {
            // The plumes' shadows run through the low mist as darker lanes, converging toward
            // the antisolar point (anticrepuscular rays at the scale of the basin).
            sunShare = sunShare.mul(exp(tbPlumeShade(u, P).shade.mul(u.steam).mul(-1.2)));
            alpha.mulAssign(float(1.15));
        }
        const lit = u.sunColor.mul(sunShare).add(mix(u.haze, u.zenith, 0.5).mul(0.3));
        const col = tbAerial(u, lit, dist, V.negate());
        return vec4(col.mul(alpha), alpha);
    });
    const material = tbFxMaterial('ThermalBloomMist');
    material.colorNode = mistFn();
    const part = tbPart('ThermalBloomMist', geometry, material, 55);
    part.place = (x, z) => {
        part.mesh.position.set(x, 0, z);
        part.mesh.updateMatrix();
        part.mesh.updateMatrixWorld(true);
    };
    return part;
}
