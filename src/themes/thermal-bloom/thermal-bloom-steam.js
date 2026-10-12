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
    smoothstep,
    sqrt,
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
} from './thermal-bloom-tsl.js';

/** Steam's optical density per unit of field density per metre. */
const SIGMA = 0.055;
/** Rise speed of the billows (m/s) and the billow scale (metres per noise cell). */
const RISE = 1.6;
const BILLOW = 26;
/** The quad's margin round the envelope (×), and its height above the plume's top (×). */
const QUAD_WIDE = 1.4;
const QUAD_TALL = 1.15;
/** Slice offsets of the 2D-lattice trick (in tiles of the atlas): decorrelated per integer layer. */
const SLICE = [0.371, 0.173];

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
    const a = texture(tex, uv.add(vec2(SLICE[0], SLICE[1]).mul(layer)))[ch];
    const b = texture(tex, uv.add(vec2(SLICE[0], SLICE[1]).mul(layer.add(1.0))))[ch];
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
    // One quad per sheet, slots in draw order (the world fills them far to near), each plume's
    // sheets back to front. Corners in (x ∈ −1..1, y ∈ 0..1).
    const quads = slots * sheets;
    const positions = new Float32Array(quads * 4 * 3);
    const meta = new Float32Array(quads * 4 * 2);
    const indices = new Uint32Array(quads * 6);
    for (let q = 0; q < quads; q++) {
        const slot = Math.floor(q / sheets);
        const k = q % sheets;
        [[-1, 0], [1, 0], [1, 1], [-1, 1]].forEach(([x, y], c) => {
            positions.set([x, y, 0], (q * 4 + c) * 3);
            meta.set([slot, k], (q * 4 + c) * 2);
        });
        indices.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSheet', new THREE.BufferAttribute(meta, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    const aSheet = attribute('aSheet', 'vec2');
    const vSlot = varying(aSheet.x, 'vSteamSlot');
    const rowA = (slot) => u.steamPlumes.element(int(slot.add(0.5)).mul(2));
    const rowB = (slot) => u.steamPlumes.element(int(slot.add(0.5)).mul(2).add(1));
    const leanAt = (h) => u.windDir.mul(u.windSpeed.mul(STEAM_LEAN).mul(h));
    /** A plume's radius at a fraction of its height. */
    const radiusAt = (B, frac) => mix(B.x, B.y, sqrt(clamp(frac, 0.0, 1.0)));
    /** Each sheet's share of the plume's depth (metres), and its offset toward the camera. */
    const span = 1.2;

    const material = tbFxMaterial('ThermalBloomSteam');
    material.positionNode = Fn(() => {
        const slot = aSheet.x;
        const A = rowA(slot);
        const B = rowB(slot);
        const live = step(slot.add(0.5), float(u.steamCount));
        const h = positionGeometry.y.mul(A.w).mul(QUAD_TALL);
        const c = A.xy.add(leanAt(h));
        const toCam = normalize(u.camPos.xz.sub(c).add(vec2(1e-3, 0.0)));
        const right = vec2(toCam.y.negate(), toCam.x);
        const rmax = max(B.x, B.y);
        const depth = aSheet.y.div(sheets - 1).sub(0.5).negate().mul(span)
            .mul(rmax);
        const xz = c.add(right.mul(positionGeometry.x).mul(rmax).mul(QUAD_WIDE)).add(toCam.mul(depth));
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

        // ── The field ──
        const envelope = (Q) => {
            const hh = Q.y.sub(A.z);
            const frac = hh.div(max(A.w, 1.0));
            const c = A.xy.add(leanAt(hh));
            const rr = length(Q.xz.sub(c)).div(max(radiusAt(B, frac), 0.5));
            // A dome sits low and round; a column fades out over its top third.
            const top = mix(
                float(1.0).sub(smoothstep(0.62, 1.0, frac)),
                float(1.0).sub(smoothstep(0.35, 1.0, frac)),
                isDome,
            );
            return smoothstep(1.0, 0.38, rr).mul(smoothstep(0.0, 3.0, hh)).mul(top);
        };
        const env = envelope(P).toVar();
        const t = u.time;
        const q = vec3(P.x, P.y.sub(t.mul(RISE)), P.z).div(BILLOW).toVar();
        // The billows: a slow warp (period 9–14 s at this scale), then the lattice noise.
        const warp = noise3(tex.noise, q.mul(0.45).add(vec3(0.0, t.mul(0.009), 0.0)), 'y', 4).sub(0.5);
        const qw = q.add(vec3(warp.mul(1.6), warp.mul(-0.9), 0.0));
        let billow = noise3(tex.noise, qw, 'x', 4);
        if (tier.steamDetail) {
            const fine = noise3(tex.noise, qw.mul(3.1).add(vec3(0.0, t.mul(0.05), 0.0)), 'z', 16);
            billow = billow.mul(0.72).add(fine.mul(0.28));
        }
        const rho = env.mul(smoothstep(0.28, 0.78, billow)).mul(B.z).mul(u.steam).toVar();
        // The gust's clear lane through the Iris's dome: it crosses in about 6 s.
        const g = u.gust;
        const across = vec2(u.windDir.y.negate(), u.windDir.x);
        const laneAt = mix(float(-1.6), float(1.6), clamp(g.x, 0.0, 1.0)).mul(IRIS_RADIUS);
        const lane = dot(P.xz.sub(A.xy), across).sub(laneAt).div(IRIS_RADIUS * 0.4);
        const tear = exp(lane.mul(lane).negate()).mul(step(0.0, g.x)).mul(isDome);
        rho.mulAssign(float(1.0).sub(tear.mul(0.88)));

        // ── Opacity: Beer over this sheet's share of the depth ──
        const rmax = max(B.x, B.y);
        const L = rmax.mul(span / (sheets - 1));
        const alpha = float(1.0).sub(exp(rho.mul(L).mul(-SIGMA))).toVar();
        // Thinned over the card, and where a sheet meets the near plane.
        const c = u.cardRect;
        const inCard = step(c.x, screenUV.x).mul(step(screenUV.x, c.z)).mul(step(c.y, screenUV.y))
            .mul(step(screenUV.y, c.w));
        alpha.mulAssign(float(1.0).sub(inCard.mul(0.75)));
        alpha.mulAssign(smoothstep(20.0, 60.0, dist));

        // ── Light ──
        const Ps = P.add(u.sunDir.mul(9.0));
        const shadowRho = envelope(Ps).mul(noise3(tex.noise, qw.add(u.sunDir.mul(9.0 / BILLOW)), 'x', 4)).mul(B.z);
        const shadow = exp(shadowRho.mul(-2.2));
        const back = tbHgMix(dot(V, u.sunDir), float(0.35));
        const sunLit = u.sunColor.mul(float(0.25).add(shadow.mul(0.75))).mul(float(0.72).add(back.mul(0.35)));
        const sky = mix(u.haze, u.zenith, 0.55).mul(float(0.42).sub(shadow.mul(0.18)));
        // Underlight: the spring's glow from below (turquoise over the eye, apricot at the skirts);
        // the thread over the cone and the far columns catch only the warm ground.
        const hh = P.y.sub(A.z);
        const rr0 = length(P.xz.sub(A.xy)).div(max(B.x, 1.0));
        const domeGlow = mix(vec3(0.08, 0.42, 0.5), vec3(0.75, 0.36, 0.12), smoothstep(0.3, 1.1, rr0));
        const glow = mix(vec3(0.5, 0.3, 0.16).mul(0.35), domeGlow, isDome).mul(exp(hh.div(-12.0)))
            .mul(mix(float(0.55), float(0.9), isDome));
        const albedo = mix(float(0.82), float(0.9), isThread);
        const col = sunLit.mul(albedo).add(sky).add(glow).toVar();
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
        const warm = smoothstep(0.6, 1.3, d).mul(exp(d.div(3.2).mul(d.div(3.2)).negate()))
            .mul(float(1.0).sub(smoothstep(4.5, 5.8, d)));
        const drift = u.windDir.mul(u.windSpeed.mul(0.6).mul(u.time));
        const n1 = texture(tex.noise, P.xz.sub(drift).div(170.0)).x;
        const n2 = texture(tex.noise, P.xz.sub(drift.mul(1.3)).div(55.0).add(0.37)).y;
        const g = u.gust;
        const across = vec2(u.windDir.y.negate(), u.windDir.x);
        const lane = dot(rel, across).div(IRIS_RADIUS).sub(mix(float(-2.5), float(2.5), clamp(g.x, 0.0, 1.0)));
        const hole = exp(lane.mul(lane).negate()).mul(step(0.0, g.x));
        const rho = warm.mul(smoothstep(0.35, 0.8, n1.mul(0.65).add(n2.mul(0.35)))).mul(u.steam)
            .mul(float(1.0).sub(hole.mul(0.8)));
        const alpha = min(rho.mul(0.22), 0.3).mul(smoothstep(30.0, 90.0, dist)).toVar();
        const lit = u.sunColor.mul(0.62).add(mix(u.haze, u.zenith, 0.5).mul(0.3));
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
