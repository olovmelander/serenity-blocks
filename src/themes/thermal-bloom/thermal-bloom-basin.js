/**
 * Thermal Bloom — the basin: the Iris, its living bands and fingers, and the pale sinter apron out
 * to the far rim, on one polar fan mesh centred on the Iris.
 *
 * The ground's colour is a function of the water's TEMPERATURE, T (1 at the vent … 0 on dry
 * sinter), computed per fragment as the Stage A0 CPU lab proved it (iris-springs.md §5.12) and
 * the A1 critic rounds revised it: an elliptic distance to an off-centre vent, domain-warped by
 * baked fBm, scalloped into lobes that differ from band to band (the lemon ring has its own) and
 * stretched downhill toward the camera; braided, branching FINGERS in (θ·N, log r) that widen
 * downstream, longest downhill, with a denser family of thin channels fanning across the near
 * field; fine radial streaks; band breakup. T reads the season's row of the ramp texture; a
 * succession front picks the old or the new row per pixel as it sweeps out from the Iris.
 *
 * Inside the pool, the water: an analytic bowl that drops toward the vent with broken white
 * sinter shelves seen through it, wavering under convection (a fake refraction); Beer-law colour
 * from milky cyan over the shelf through turquoise to near-ink cobalt in the throat; boil domes
 * on a hashed clock; a sky sheen clamped at 0.12 (less over the throat). Not a mirror.
 *
 * Outside it: terracettes across the flow and a flow-aligned grain, strongest under the camera;
 * wet channels (darker cores, lighter drier margins, wrinkled along the flow, a sheen that flows
 * outward); dead mats breaking into dry sinter in ragged patches; bright flats, damp grey and
 * thin wet sheets on the apron, which settles into the far apron the backdrop paints beyond the
 * mesh. Light: the three-quarter back-side sun on a bump normal of the rim's lip, sky ambient,
 * and height-aware aerial perspective. Every fine term fades by the pixel's footprint.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    abs,
    atan,
    clamp,
    cross,
    dFdx,
    dFdy,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    int,
    length,
    log,
    max,
    min,
    mix,
    normalize,
    positionWorld,
    sign,
    smoothstep,
    sqrt,
    step,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    IRIS_RADIUS,
    SEASONS,
    STEAM_LEAN,
    tbAerial,
    tbFarApron,
    tbGlint,
    tbHash21,
    tbLuma,
    tbPart,
    tbSchlick,
    tbSteamVeil,
} from './thermal-bloom-tsl.js';
import { bakeBasinFan } from './thermal-bloom-bake.js';

/** The fan's reach (metres from the Iris): the far rim forest stands on its edge. */
export const BASIN_EXTENT = 3600;

const TAU = Math.PI * 2;
/** The field's parameters (the A0 lab's, revised by the A1 critic round). */
const LAB = Object.freeze({
    vent: 0.13,
    warp: 0.22,
    lobe: 0.32,
    stretch: 0.4,
    fingers: 52,
    fingerLen: 2.6,
    micro: 0.03,
});
/**
 * The temperature profile along the (warped, lobed) radius, in pool radii → T: the lemon thin
 * (~0.45× the orange), the orange the widest band of the mats, the rust medium, the olive the
 * cool fringe, then a short grey-brown of dead mats and dry, bleached sinter beyond.
 */
const PROFILE = Object.freeze([
    [0, 1.0], [0.5, 0.93], [0.82, 0.87], [1.0, 0.8], [1.17, 0.7], [1.42, 0.55],
    [1.64, 0.4], [1.95, 0.25], [2.5, 0.14], [3.6, 0.06], [9.0, 0.0],
]);
/** Metres per tile of the noise atlas's low channel (4 cells a tile, ~55 m a cell). */
const NOISE_TILE = 220;
/** Water's absorption per metre (red goes first): white sinter under the shelf reads turquoise. */
const ABSORB = Object.freeze([0.38, 0.065, 0.028]);

/** T for a radius: the piecewise-linear profile as a sum of clamped ramps (no branches). */
function profileT(rs) {
    let T = float(PROFILE[0][1]);
    for (let i = 1; i < PROFILE.length; i++) {
        const [r0, t0] = PROFILE[i - 1];
        const [r1, t1] = PROFILE[i];
        T = T.add(clamp(rs.sub(r0).div(r1 - r0), 0.0, 1.0).mul(t1 - t0));
    }
    return T;
}

/** The ramp's colour at T on a season row (linear rgb; stored as √linear). */
function rampColor(tex, T, row) {
    const st = vec2(clamp(T, 0.0, 1.0).mul(255 / 256).add(0.5 / 256), row.add(0.5).div(SEASONS.length));
    const c = texture(tex.ramp, st).level(0).rgb;
    return c.mul(c);
}

/**
 * The basin part.
 * @param {object} u     the shared uniforms
 * @param {object} tier  the quality tier
 * @param {object} tex   the world's baked textures (noise, cellular, ramp)
 */
export function createBasin(u, tier, tex) {
    const [rings, spokes] = tier.fan;
    const fan = bakeBasinFan(rings, spokes, { extent: BASIN_EXTENT, poolRadius: IRIS_RADIUS });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(fan.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(fan.indices, 1));
    const microOctaves = tier.matOctaves;

    const noise = (uv) => texture(tex.noise, uv);
    /** A lookup whose coordinates jump (the angle seam, cell ids): a fixed mip, never the derivative's. */
    const noiseAt = (uv, level = 1.0) => texture(tex.noise, uv).level(level);

    const basinFn = Fn(() => {
        const P = positionWorld.toVar();
        const toCam = u.camPos.sub(P).toVar();
        const dist = length(toCam).toVar();
        const V = toCam.div(max(dist, 1e-3)).toVar();
        // Metres a pixel covers here (grazing angles stretch it): fine terms fade by it.
        const foot = dist.mul(u.pixelAngle).div(max(V.y, 0.12)).toVar();
        const fade = (size) => float(1.0).sub(smoothstep(size * 0.3, size, foot));

        // ── The temperature field ──
        const R = u.irisRadius;
        const rel = P.xz.sub(u.irisCentre).div(R).toVar();
        const warp = noise(P.xz.div(NOISE_TILE)).toVar();
        const wrel = rel.add(vec2(warp.x.sub(0.5), warp.y.sub(0.5)).mul(LAB.warp));
        const down = u.downhill;
        const across = vec2(down.y.negate(), down.x);
        const r0 = length(rel);
        // The vent sits uphill of the pool's centre: measured from it, the bowl is off-centre.
        const q = vec2(dot(wrel, across), dot(wrel, down).add(clamp(float(1.0).sub(r0), 0.0, 1.0).mul(LAB.vent)))
            .toVar();
        const r = max(length(q), 1e-4).toVar();
        // θ = 0 downhill; the seam at ±π faces uphill, behind the pool.
        const th = atan(q.x, q.y).toVar();
        const cth = q.y.div(r);
        const sth = q.x.div(r);
        // Lobes: two angular frequencies, different for every band (they move with the radius),
        // and a smaller set on the pool's own edge and the lemon ring.
        const lobe = noise(vec2(cth.mul(1.4).add(r.mul(0.7)).add(4.0), sth.mul(1.4).sub(r.mul(0.5))).div(4.0))
            .x.sub(0.5).mul(2.0);
        const lobe2 = noise(vec2(cth.mul(3.1).sub(r.mul(1.3)).add(9.0), sth.mul(3.1).add(r.mul(1.1))).div(8.0))
            .y.sub(0.5).mul(2.0);
        const lobeIn = noise(vec2(cth.mul(2.3).add(17.0), sth.mul(2.3).sub(5.0)).div(4.0)).x.sub(0.5).mul(2.0);
        const outside = clamp(r.sub(0.98), 0.0, 2.0);
        // The lemon ring has lobes of its own (another frequency and phase), so its edges are not
        // offsets of the pool's.
        const lobeL = noise(vec2(cth.mul(3.7).add(23.0), sth.mul(3.7).sub(11.0)).div(8.0)).y.sub(0.5).mul(2.0);
        const lemonZone = exp(r.sub(1.1).div(0.09).mul(r.sub(1.1).div(0.09)).negate());
        const rr = r.add(outside.mul(lobe.mul(LAB.lobe).add(lobe2.mul(LAB.lobe * 0.5))))
            .add(lobeIn.mul(0.07).mul(smoothstep(0.6, 1.0, r)))
            .add(lobeL.mul(0.05).mul(lemonZone))
            .toVar();
        const downness = clamp(cth.add(0.2).div(1.2), 0.0, 1.0).toVar();
        const stretch = float(1.0).add(downness.mul(LAB.stretch).mul(clamp(rr.sub(1.0), 0.0, 3.0)));
        const rsRaw = rr.sub(step(1.0, rr).mul(rr.sub(1.0)).mul(float(1.0).sub(float(1.0).div(stretch))));
        // The combo's heat widens the eye and marches the bands outward.
        const rs = rsRaw.div(float(1.0).add(u.heat)).toVar();
        const T = profileT(rs).toVar();

        // Fingers: braided, branching, widening downstream; longest downhill; some channels dry.
        const lr = log(max(r, 0.05));
        const thw = th.add(noise(vec2(cth.mul(2.3).add(1.7), sth.mul(2.3).sub(4.1)).div(4.0)).x.sub(0.5).mul(0.55));
        const fa = thw.mul(LAB.fingers / TAU)
            .add(noiseAt(vec2(lr.mul(2.6).add(1.3), thw.mul(1.3)).div(4.0)).x.sub(0.5).mul(1.4)).toVar();
        const cell = floor(fa);
        const tri = float(1.0).sub(abs(fract(fa).mul(2.0).sub(1.0))).toVar();
        const strength = smoothstep(0.15, 0.55, tbHash21(vec2(cell, 7.7)));
        const reach = float(LAB.fingerLen).mul(tbHash21(vec2(cell, 9.1)).add(0.45))
            .mul(downness.mul(downness).mul(0.9).add(0.6)).mul(u.reach);
        const alongF = clamp(rs.sub(1.0).div(max(reach, 1e-3)), 0.0, 1.0).toVar();
        // Channels widen downstream (×1.5 … ×3) and never fall below ~2 px across.
        const widthBase = float(0.2).add(tbHash21(vec2(cell, 3.3)).mul(0.15));
        const width = min(widthBase.mul(alongF.mul(1.8).add(1.0)).add(fwidth(fa).mul(2.5)), 0.85);
        // Downstream a channel braids into threads that part and rejoin.
        const braidP = fa.mul(3.0).add(noiseAt(vec2(lr.mul(5.0), fa.mul(0.7)).div(4.0)).y.mul(1.6));
        const braid = float(1.0).sub(abs(fract(braidP).mul(2.0).sub(1.0)));
        const braidFw = fwidth(braidP);
        const braided = mix(
            float(1.0),
            smoothstep(float(0.25).sub(braidFw), float(0.75).add(braidFw), braid),
            smoothstep(0.2, 0.6, alongF).mul(0.85).mul(float(1.0).sub(smoothstep(0.12, 0.35, braidFw))),
        );
        const ridgeA = clamp(tri.sub(float(1.0).sub(width)).div(width), 0.0, 1.0).mul(braided);
        const fb = th.mul((LAB.fingers * 1.9) / TAU)
            .add(noiseAt(vec2(lr.mul(3.1).sub(2.0), th.mul(2.1)).div(4.0)).x.sub(0.5).mul(2.2));
        const tri2 = float(1.0).sub(abs(fract(fb).mul(2.0).sub(1.0)));
        const ridgeB = clamp(tri2.sub(0.8).div(0.2), 0.0, 1.0).mul(float(1.0).sub(smoothstep(0.15, 0.4, fwidth(fb))));
        const branchOn = smoothstep(0.3, 0.9, noiseAt(vec2(fb.mul(0.5), lr.mul(2.0).add(5.0)).div(4.0)).y)
            .mul(smoothstep(0.1, 0.4, alongF));
        // Fine radial streaks between the channels: the sunray texture of the runoff fan.
        const fc = th.mul((LAB.fingers * 4.7) / TAU)
            .add(noiseAt(vec2(lr.mul(4.3).add(7.0), th.mul(3.3)).div(4.0)).y.sub(0.5).mul(3.0));
        const tri3 = float(1.0).sub(abs(fract(fc).mul(2.0).sub(1.0)));
        const streak = smoothstep(float(0.72).sub(fwidth(fc)), 1.0, tri3)
            .mul(smoothstep(0.25, 0.75, noiseAt(vec2(fc.mul(0.31), lr.mul(1.7)).div(4.0)).x))
            .mul(float(1.0).sub(smoothstep(0.12, 0.35, fwidth(fc))))
            .toVar();
        // The near fan: a denser family of thinner, long channels on the downhill side only, so
        // the corner under the camera is crossed by many threads, not two.
        const fd = thw.mul((LAB.fingers * 2.3) / TAU)
            .add(noiseAt(vec2(lr.mul(3.4).add(4.0), thw.mul(1.7)).div(4.0)).z.sub(0.5).mul(1.8));
        const cellD = floor(fd);
        const triD = float(1.0).sub(abs(fract(fd).mul(2.0).sub(1.0)));
        const reachD = float(LAB.fingerLen * 1.15).mul(tbHash21(vec2(cellD, 5.3)).mul(0.8).add(0.5)).mul(u.reach);
        const alongD = clamp(rs.sub(1.0).div(max(reachD, 1e-3)), 0.0, 1.0);
        const widthD = min(float(0.12).mul(alongD.add(1.0)).add(fwidth(fd).mul(2.0)), 0.7);
        const ridgeD = clamp(triD.sub(float(1.0).sub(widthD)).div(widthD), 0.0, 1.0)
            .mul(smoothstep(0.45, 0.85, downness))
            .mul(smoothstep(0.25, 0.6, tbHash21(vec2(cellD, 8.1))))
            .mul(float(1.0).sub(smoothstep(0.6, 1.0, alongD)))
            .mul(0.85);
        const ridge = max(max(ridgeA.mul(sqrt(ridgeA)), ridgeB.mul(sqrt(ridgeB)).mul(branchOn).mul(0.8)), ridgeD)
            .toVar();
        const onMats = smoothstep(1.0, 1.04, rs).toVar();
        // Full strength until late in the run, so a channel widens downstream and ends in a fan.
        const finger = ridge.mul(strength).mul(float(1.0).sub(smoothstep(0.55, 1.0, alongF))).mul(onMats).toVar();
        // The streaks carry a little warmth out to about twice the channels' mean reach.
        const streakT = streak.mul(onMats).mul(float(1.0).sub(smoothstep(1.3, 2.2, rs))).mul(0.08);
        // Hot water carries the warmer bands out along the channel (never into the water's colours).
        const runHot = float(1.0).sub(smoothstep(0.5, 1.0, alongF));
        const Tpre = T.toVar();
        const lifted = min(T.add(finger.mul(0.5).mul(runHot)), max(T, 0.66));
        T.assign(mix(T, lifted, onMats));
        // The snow line follows the smooth field (never the streaks or the micro-texture, which
        // would speckle it), and only the channels at least ~1.5 px across keep it open: snow
        // fills the sub-pixel ones, which would otherwise draw dotted chains across the white.
        const pxA = widthBase.mul(alongF.mul(1.8).add(1.0)).div(max(fwidth(fa), 1e-5));
        const pxB = float(0.2).div(max(fwidth(fb), 1e-5));
        const pxD = float(0.12).mul(alongD.add(1.0)).div(max(fwidth(fd), 1e-5));
        const ridgeSnow = max(
            max(
                ridgeA.mul(sqrt(ridgeA)).mul(smoothstep(1.0, 2.5, pxA)),
                ridgeB.mul(sqrt(ridgeB)).mul(branchOn).mul(0.8).mul(smoothstep(1.0, 2.5, pxB)),
            ),
            ridgeD.mul(smoothstep(1.0, 2.5, pxD)),
        );
        const fingerSnow = ridgeSnow.mul(strength).mul(float(1.0).sub(smoothstep(0.55, 1.0, alongF))).mul(onMats);
        const Tsmooth = mix(Tpre, min(Tpre.add(fingerSnow.mul(0.5).mul(runHot)), max(Tpre, 0.66)), onMats).toVar();
        T.addAssign(streakT);
        // The channel's margin: a lighter, drier lip either side of the wet core.
        const margin = clamp(ridgeA.mul(4.0), 0.0, 1.0).sub(ridgeA.mul(ridgeA).mul(4.0)).max(0.0)
            .mul(strength)
            .mul(float(1.0).sub(alongF))
            .mul(onMats);

        // Band breakup (crisp near the rim, diffuse in the cooler bands) and micro-texture.
        const patch = noise(P.xz.mul(0.045 / 4)).x.sub(0.5).mul(2.0);
        const cool = clamp(float(0.78).sub(T).div(0.5), 0.0, 1.0);
        // The dry apron keeps a gentler breakup: its own flats texture it below.
        const calm = float(1.0).sub(smoothstep(0.22, 0.06, T).mul(0.75));
        T.addAssign(onMats.mul(patch).mul(cool.mul(0.06).add(0.015)).mul(calm));
        let micro = noise(P.xz.mul(0.45 / 16)).z.sub(0.5);
        if (microOctaves > 1) micro = micro.add(noise(P.xz.mul(1.3 / 16)).z.sub(0.5).mul(0.5));
        if (microOctaves > 2) micro = micro.add(noise(P.xz.mul(3.7 / 16)).z.sub(0.5).mul(0.25));
        T.addAssign(micro.mul(LAB.micro * 2).mul(onMats).mul(fade(2.5)));

        // ── Albedo: the season's ramp, swept by the succession front ──
        const metres = rs.mul(R);
        const frontEdge = u.frontRadius.add(noise(P.xz.div(90.0)).y.sub(0.5).mul(60.0)).add(finger.mul(40.0));
        const swept = float(1.0).sub(smoothstep(frontEdge.sub(12.0), frontEdge.add(12.0), metres));
        const albedo = mix(rampColor(tex, T, u.seasonFrom), rampColor(tex, T, u.seasonTo), swept).toVar();
        // The season's streamers (Bloom's rose) live only in the channels.
        albedo.assign(mix(albedo, u.streamer, finger.mul(u.streamerAmount)));

        // Beyond the warm bands the streaks are Calothrix-brown stains on the dead mats.
        const stainW = streak.mul(smoothstep(1.5, 2.2, rs)).mul(float(1.0).sub(smoothstep(3.6, 5.5, rs)));
        albedo.assign(mix(albedo, vec3(0.36, 0.12, 0.05), stainW.mul(0.45)));

        // Microterraces (terracettes): broken micro-rims across the flow, ~2.6 m apart, spaced
        // by the distance downhill from the vent: a light upper lip, a dark drop below it. Only a
        // low-frequency wander bends them (never enough to close a loop), and they fade to the
        // mean as they shrink under a pixel.
        const flowR = r.mul(R).add(noise(P.xz.div(60.0)).x.mul(1.2));
        // A constant spacing: dividing a radius of a hundred metres by a varying one would draw
        // the variation's own isolines (closed loops) instead of rims.
        // Scalloped: each micro-rim bows downhill between cusps 3–6 m apart along it.
        const arc = th.mul(r).mul(R).div(4.5).add(noise(P.xz.div(25.0)).y.mul(3.0));
        const scallop = abs(fract(arc).sub(0.5)).mul(2.0);
        const phase2 = flowR.div(2.6).add(float(1.0).sub(scallop.mul(scallop)).mul(0.35)).toVar();
        const fw2 = max(fwidth(phase2), 1e-4);
        const f2 = fract(phase2);
        const keep2 = float(1.0).sub(smoothstep(0.18, 0.38, fw2))
            .mul(smoothstep(0.55, 0.75, noise(vec2(th.mul(R).mul(r).div(17.0), flowR.div(11.0)).div(8.0)).x))
            .mul(onMats);
        const lipUp = smoothstep(float(0.8).sub(fw2), 0.94, f2).mul(float(1.0).sub(smoothstep(0.94, 1.0, f2)));
        const dropDn = smoothstep(0.0, float(0.03).add(fw2), f2)
            .mul(float(1.0).sub(smoothstep(0.04, float(0.14).add(fw2), f2)));
        albedo.mulAssign(float(1.0).add(lipUp.mul(0.12).sub(dropDn.mul(0.16)).mul(keep2)));
        // Runoff streaks: a grain stretched along the flow (it runs out from the vent toward the
        // camera), metres across and tens of metres long, strongest under the camera.
        const acrossDir = vec2(u.downhill.y.negate(), u.downhill.x);
        const grainUV = vec2(dot(P.xz, acrossDir).div(2.2), dot(P.xz, u.downhill).div(16.0)).div(16.0);
        const grain = noise(grainUV).z.sub(0.5).add(noise(grainUV.mul(2.7)).w.sub(0.5).mul(0.6));
        const grainFade = float(1.0).sub(smoothstep(0.5, 1.6, foot));
        albedo.mulAssign(float(1.0).add(grain.mul(0.34).mul(grainFade).mul(onMats)));
        // Wrinkles, blisters and tufts at 1–5 m, strongest under the camera, fading to the mean
        // by the pixel's footprint.
        const mottle = noise(P.xz.mul(0.35 / 16)).w.sub(0.5).mul(fade(1.6))
            .add(noise(P.xz.mul(1.1 / 16)).z.sub(0.5).mul(0.6).mul(fade(0.6)));
        albedo.mulAssign(float(1.0).add(mottle.mul(0.22).mul(onMats)));
        // Dead mats give way to sinter in patches with ragged edges, not in a smooth gradient.
        const dryN = noise(P.xz.mul(0.05 / 4)).w.add(noise(P.xz.mul(0.21 / 4)).x.mul(0.5)).div(1.5);
        const dryAll = smoothstep(0.42, 0.58, clamp(float(0.21).sub(T).div(0.16), 0.0, 1.0).add(dryN.sub(0.5).mul(0.7)))
            .toVar();

        // Dry sinter: bright flats against damp grey sinter (snow covers both in Deep Cold).
        // Two octaves on rotated, incommensurate lattices, so the atlas's period never lines up
        // into columns across the far apron.
        const pr = vec2(P.x.mul(0.8).sub(P.z.mul(0.6)), P.x.mul(0.6).add(P.z.mul(0.8)));
        const pq = vec2(P.x.mul(0.34).add(P.z.mul(0.94)), P.z.mul(0.34).sub(P.x.mul(0.94)));
        const flatsN = noise(pq.mul(0.016 / 4)).x.mul(0.6).add(noise(pr.mul(0.0123 / 4)).y.mul(0.4))
            .add(noise(pr.mul(0.09 / 4)).y.sub(0.5).mul(0.25));
        const flats = smoothstep(0.3, 0.72, flatsN);
        const dry = dryAll.mul(float(1.0).sub(u.snow));
        albedo.assign(mix(albedo, mix(vec3(0.53, 0.51, 0.47), vec3(0.65, 0.63, 0.58), flats), dry));
        // Wet sheets: thin water spreading over the apron, darker, and silver with the sky where
        // the view grazes.
        const sheet = smoothstep(0.62, 0.7, noise(pr.mul(0.0071 / 4).add(vec2(0.37, 0.71))).w)
            .mul(dryAll).mul(float(1.0).sub(u.snow))
            .mul(float(1.0).sub(smoothstep(900.0, 2600.0, dist).mul(0.65)))
            .toVar();
        albedo.mulAssign(float(1.0).sub(sheet.mul(0.3)));
        albedo.mulAssign(float(1.0).add(noise(pq.mul(0.05 / 4)).z.sub(0.5).mul(0.16).mul(dryAll)));
        // Snow lies on everything but the warm ground (Deep Cold: the bands sit in a white field;
        // the thaw leaves only patches). The fingers' warm water keeps their channels open.
        const snowN = flatsN.add(dryN.sub(0.5).mul(0.6));
        const snowCover = smoothstep(0.38, 0.3, Tsmooth.add(snowN.sub(0.5).mul(0.06)))
            .mul(smoothstep(float(1.3).sub(u.snow), float(1.44).sub(u.snow), snowN.add(0.5)))
            .mul(step(0.001, u.snow))
            .toVar();
        albedo.assign(mix(albedo, vec3(0.6, 0.63, 0.68), snowCover));
        // Jewel pools on the far apron: lime acid, champagne (a wide orange rim, fizzing), milky
        // opal — small, crisp, lobed, each its own water and rim.
        const jewelWater = float(0.0).toVar();
        for (let j = 0; j < 3; j++) {
            const J = u.jewels.element(j);
            const jd = length(P.xz.sub(J.xy)).div(max(J.z, 1.0))
                .add(noise(P.xz.div(J.z.mul(0.9).add(1.0))).x.sub(0.5).mul(0.25));
            const jfw = max(fwidth(jd), 1e-3);
            const inside = float(1.0).sub(smoothstep(float(0.95).sub(jfw), float(0.95).add(jfw), jd));
            const isLime = step(abs(J.w.sub(0.0)), 0.5);
            const isCham = step(abs(J.w.sub(1.0)), 0.5);
            const isOpal = step(abs(J.w.sub(2.0)), 0.5);
            const water = vec3(0.4, 0.58, 0.1).mul(isLime).add(vec3(0.36, 0.5, 0.48).mul(isCham))
                .add(vec3(0.58, 0.74, 0.84).mul(isOpal));
            // The rims are lobed (never a constant-width ring): wider where the overflow runs.
            const rimLobe = noise(P.xz.div(J.z.mul(0.7).add(1.0)).add(0.37)).y.sub(0.5).mul(0.5);
            const rimOuter = mix(float(1.25), float(1.75), isCham)
                .add(rimLobe.mul(mix(float(0.15), float(0.4), isCham)));
            const rim = smoothstep(0.9, 1.0, jd).mul(float(1.0).sub(smoothstep(float(1.05), rimOuter, jd)));
            // Lime and champagne rims are sinter and mats; the opal's is dark wet sinter, so the
            // pale pool separates from the pale flats.
            const rimMat = mix(vec3(0.8, 0.8, 0.72), vec3(0.78, 0.33, 0.06), isCham);
            const rimCol = mix(rimMat, vec3(0.36, 0.36, 0.33), isOpal);
            albedo.assign(mix(albedo, rimCol, rim.mul(mix(float(0.55), float(0.9), isCham))));
            albedo.assign(mix(albedo, water, inside));
            // The champagne pool fizzes: beads breaking all over it, a twinkling froth.
            const fizzCell = floor(P.xz.div(0.9)).add(floor(u.time.mul(7.0)).mul(vec2(3.7, 1.3)));
            const fizz = smoothstep(0.8, 0.95, tbHash21(fizzCell)).mul(0.6).add(0.12);
            albedo.assign(mix(albedo, vec3(0.86, 0.85, 0.8), fizz.mul(inside).mul(isCham)));
            jewelWater.assign(max(jewelWater, inside));
        }

        // Wet channels: darker and more saturated, as wet rock is; their margins lighter and drier.
        // Wet where warm water actually runs: a channel that lifts no colour stays dry, not a crack.
        const wet = smoothstep(0.3, 0.85, finger).mul(smoothstep(0.32, 0.5, T)).mul(onMats)
            .mul(float(1.0).sub(snowCover))
            .toVar();
        const luma = tbLuma(albedo);
        albedo.assign(albedo.mul(float(1.0).sub(wet.mul(0.45))).add(albedo.sub(luma).mul(wet.mul(0.3))));
        albedo.assign(mix(albedo, vec3(tbLuma(albedo)).mul(1.2), margin.mul(0.45).mul(float(1.0).sub(snowCover))));
        // Inside a channel the mat is wrinkled and blistered along the flow.
        const wrinkle = noise(grainUV.mul(4.0)).z.sub(0.5).add(noise(grainUV.mul(9.0)).w.sub(0.5).mul(0.5));
        albedo.mulAssign(float(1.0).add(wrinkle.mul(0.35).mul(finger).mul(grainFade).mul(float(1.0).sub(snowCover))));

        // ── Light ──
        // Relief: the rim's lip, as a bump normal from screen derivatives, raked by the sun (the
        // channels and terracettes are drawn in the albedo: a bump that thin only aliases).
        const lipR = exp(rs.sub(1.02).div(0.03).mul(rs.sub(1.02).div(0.03)).negate());
        const bump = lipR.mul(0.25).toVar();
        const dpdx = dFdx(P);
        const dpdy = dFdy(P);
        const N0 = vec3(0.0, 1.0, 0.0);
        const r1 = cross(dpdy, N0);
        const r2 = cross(N0, dpdx);
        const det = dot(dpdx, r1);
        const grad = sign(det).mul(dFdx(bump)).mul(r1).add(sign(det).mul(dFdy(bump)).mul(r2));
        const Nraw = normalize(abs(det).mul(N0).sub(grad));
        // Never steeper than ~65°: a bump spike at a channel's edge must not turn a pixel black.
        const N = normalize(vec3(Nraw.x, max(Nraw.y, 0.45), Nraw.z)).toVar();
        const ndl = dot(N, u.sunDir);
        const lit = clamp(ndl.add(0.1).div(1.1), 0.0, 1.0);
        const cavity = float(1.0).sub(wet.mul(0.3));
        const skyAmb = mix(u.haze, u.zenith, 0.6).mul(N.y.mul(0.22).add(0.22));
        // Plume shadows: each plume's axis, from its foot to 85% of its height, cast along the sun
        // onto the ground — a long soft streak (about 1.5× the plume's height at this sun) as wide
        // as the plume at that height, Beer over its thickness (a thin thread casts a faint one).
        const shade = float(0.0).toVar();
        Loop({
            start: int(0), end: u.steamCount, type: 'int', condition: '<', name: 'pl',
        }, ({ pl }) => {
            const A = u.steamPlumes.element(pl.mul(2));
            const B = u.steamPlumes.element(pl.mul(2).add(1));
            const run = u.sunDir.xz.div(max(u.sunDir.y, 0.15));
            const top = A.w.mul(0.85);
            const lean = u.windDir.mul(u.windSpeed.mul(STEAM_LEAN)).mul(top.div(400.0).add(1.0));
            const a0 = A.xy.sub(run.mul(A.z.sub(P.y)));
            const a1 = A.xy.add(lean.mul(top)).sub(run.mul(A.z.add(top).sub(P.y)));
            const seg = a1.sub(a0);
            const f = clamp(dot(P.xz.sub(a0), seg).div(max(dot(seg, seg), 1e-3)), 0.0, 1.0);
            const e = length(P.xz.sub(a0.add(seg.mul(f)))).div(max(mix(B.x, B.y, sqrt(f)), 1.0));
            const thick = min(B.x.div(25.0), 1.0);
            // The dome is thin to look through but its whole body shades the bands beside it.
            const shadowK = max(B.z, step(abs(B.w.sub(1.0)), 0.5));
            shade.addAssign(exp(e.mul(e).mul(-1.4)).mul(shadowK).mul(thick).mul(float(1.0).sub(f.mul(0.5))));
        });
        const shadowT = exp(shade.mul(u.steam).mul(-1.2));
        // In a plume's shadow the sky's share dims a little too (the plume hides part of it).
        const ground = albedo.mul(u.sunColor.mul(lit.mul(1.45).mul(shadowT)).add(skyAmb.mul(shadowT.mul(0.4).add(0.6))))
            .mul(cavity)
            .toVar();
        // A broad, low wet sheen: the channels, the rim, and the season's meltwater, growing
        // toward the far field where the view grazes (a silver-blue sky reflection).
        // The channels' sheen flows outward with the water.
        const flow = noise(vec2(fa.mul(0.5), lr.mul(6.0).sub(u.time.mul(0.12))).div(4.0)).level(0).z;
        const sheenMask = wet.mul(smoothstep(0.3, 0.8, flow).mul(0.7).add(0.5)).add(lipR.mul(0.8)).add(sheet.mul(0.5))
            .add(jewelWater.mul(0.6))
            .add(u.wetness.mul(dry.add(onMats.mul(0.3))));
        const fresnel = tbSchlick(max(dot(N, V), 0.0), float(0.02));
        const skySheen = mix(u.haze, u.zenith, 0.55);
        const sheenCol = mix(vec3(tbLuma(skySheen)), skySheen, 0.4);
        ground.addAssign(sheenCol.mul(fresnel.mul(clamp(sheenMask, 0.0, 1.0)).mul(1.1)));
        // Sun glints on the wet ground, out of the plumes' shadows.
        ground.addAssign(tbGlint(u, P, N, V, clamp(sheenMask, 0.0, 1.0).mul(shadowT), 0.55, 1.1));

        // ── The water ──
        const pool = float(1.0).sub(smoothstep(0.975, 0.995, rs)).toVar();
        // Depth: a shallow shelf over pale sinter, a crisp shelf break, a throat to ~50 m at the vent.
        const vd = length(vec2(q.x, q.y.add(LAB.vent * 0.6).mul(1.15))).toVar();
        const shelf = mix(float(0.25), float(2.6), smoothstep(0.98, 0.86, rs));
        const throat = float(3.0).add(smoothstep(0.86, 0.12, vd).mul(47.0));
        const breakEdge = smoothstep(0.86, 0.83, rs);
        const t = u.time;
        const wob = noise(P.xz.div(34.0).add(vec2(t.mul(0.011), t.mul(-0.007)))).y.sub(0.5)
            .add(noise(P.xz.div(9.0).add(vec2(t.mul(-0.05), t.mul(0.04)))).z.sub(0.5).mul(0.5));
        // Boil domes: one every few seconds on a hashed clock, swelling and relaxing in the eye.
        const boilCell = floor(t.div(6.5));
        const boilAge = t.sub(boilCell.mul(6.5));
        const boilAt = vec2(tbHash21(vec2(boilCell, 1.3)).sub(0.5), tbHash21(vec2(boilCell, 2.9)).sub(0.5)).mul(0.5);
        const boilR = length(vec2(q.x, q.y.add(LAB.vent)).sub(boilAt)).div(0.14);
        const boil = exp(boilR.mul(boilR).negate()).mul(smoothstep(0.0, 1.2, boilAge))
            .mul(float(1.0).sub(smoothstep(2.5, 5.5, boilAge)));
        const depth = mix(shelf, throat, breakEdge).sub(boil.mul(2.0)).max(0.2).toVar();
        // The floor: white sinter ledges round the throat, soft-edged, wavering under convection
        // (a fake refraction), dark between them; seen THROUGH the water, so they fade with depth.
        // Irregular, broken shelves: the depth's contours wander with the warp and break up.
        const ledgeP = depth.div(7.0).add(wob.mul(0.3)).add(noise(P.xz.div(26.0)).x.sub(0.5).mul(1.3));
        const ledgeFw = max(fwidth(ledgeP), 1e-3);
        const ledge = smoothstep(float(0.45).sub(ledgeFw), float(0.62).add(ledgeFw), fract(ledgeP))
            .mul(float(1.0).sub(smoothstep(0.88, 1.0, fract(ledgeP))))
            .mul(smoothstep(0.35, 0.6, noise(P.xz.div(18.0)).y))
            .mul(float(1.0).sub(smoothstep(12.0, 30.0, depth)))
            .toVar();
        const pale = max(ledge.mul(0.8), float(1.0).sub(breakEdge));
        const floorAlb = mix(vec3(0.3, 0.29, 0.26), vec3(0.72, 0.7, 0.62), pale);
        // Two-way path through the water, longer at grazing views.
        const path = depth.mul(float(1.0).add(float(1.0).div(max(V.y, 0.2))));
        const trans = vec3(exp(path.mul(-ABSORB[0])), exp(path.mul(-ABSORB[1])), exp(path.mul(-ABSORB[2])))
            .toVar();
        // What the water itself scatters back: cobalt, darkening to near-ink in the throat.
        const inScatter = vec3(0.002, 0.03, 0.22).mul(exp(depth.div(-18.0)).mul(0.85).add(0.15))
            .add(vec3(0.0, 0.012, 0.015).mul(boil));
        const sunIn = u.sunColor.mul(max(u.sunDir.y, 0.0).mul(1.5).add(0.2));
        const waterLit = floorAlb.mul(trans).mul(sunIn).add(inScatter.mul(float(1.0).sub(trans)).mul(sunIn.add(0.4)));
        // The surface reflects the sky some fifteen degrees up (cerulean, not the horizon haze),
        // and less of it over the throat, where the cobalt must stay near-ink.
        const fres = min(tbSchlick(max(V.y, 0.0), float(0.02)), 0.12).mul(mix(float(1.0), float(0.1), breakEdge));
        const water = mix(waterLit, mix(u.haze, u.zenith, 0.8), fres);

        const col = tbSteamVeil(u, mix(ground, water, pool), P).toVar();
        // Aerial perspective: warm near, cool and pale far. Toward the mesh's far edge the ground
        // settles into the far apron the backdrop paints beyond it, so there is no seam.
        const near = tbAerial(u, col, dist, V.negate());
        const farFade = smoothstep(BASIN_EXTENT * 0.62, BASIN_EXTENT * 0.95, length(P.xz.sub(u.irisCentre)));
        const outCol = mix(near, tbFarApron(u, dist, V.negate()), farFade);
        return vec4(max(outCol, vec3(0.0)), 1.0);
    });

    const material = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: true });
    material.name = 'ThermalBloomBasin';
    material.fog = false;
    material.colorNode = basinFn();
    const part = tbPart('ThermalBloomBasin', geometry, material, 10);
    /** Stand the fan on the Iris's centre (world metres). */
    part.place = (x, z) => {
        part.mesh.position.set(x, 0, z);
        part.mesh.updateMatrix();
        part.mesh.updateMatrixWorld(true);
    };
    return part;
}

/** The profile's breakpoints (pool radii → T), for the tests. */
export const BASIN_PROFILE = PROFILE;
