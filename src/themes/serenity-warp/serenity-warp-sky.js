/**
 * Serenity Warp — the sky: the wormhole, the vortex that runs into it, and the other sky inside.
 *
 * Everything far is ONE function of a direction (skyLight below), written in the gate's own frame:
 * θ = the angle off the gate's axis, φ = the turn round it.
 *
 *  - The throat. Inside the angle α the other sky shows, its whole sphere folded into the disc
 *    (γ = π (θ/α)^p): its heart in the middle, its far side round the rim. Outside, our sky is
 *    seen bent round the throat: the light at θ comes from β = θ − α²/θ, so whatever stands
 *    straight behind the gate is drawn out into a ring at the rim (an Einstein ring) and the
 *    stars near it into arcs. Both sides of the rim are rings of light; the throat is sharp at
 *    every resolution because the two sides are blended over one pixel of the view.
 *  - The vortex. The gas round the gate is read in log-polar coordinates about its axis: two
 *    spiral arms wound by `φ − wind · log β`, the masses and threads of the baked gas volume
 *    along them, and the whole pattern flows inward as `inflow` grows (the world integrates
 *    it: a chain makes it run faster). The gate lights the arms; far from it the sky is deep
 *    clouds read in plain direction space, their lanes curled by a second read.
 *  - Waves: rings of light that leave the throat (a clear, a chain step, a level) and bend the
 *    sky as they pass. Ripples: rings round a newborn piece, in its colour.
 *  - A jump: the throat opens wider than the frame and we are inside it, rings of its light
 *    rushing past toward us.
 *
 * The backdrop draws it along every view ray at the screen's own resolution (after the glass,
 * with the depth test on: it is shaded only where it shows). The environment pass paints it in
 * every direction into a small target each frame, which is what the glass refracts and reflects.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    abs,
    atan,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    log,
    max,
    min,
    mix,
    positionGeometry,
    pow,
    screenUV,
    sin,
    smoothstep,
    sqrt,
    step,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
    pow2,
} from 'three/tsl';
import {
    EVENT_ROWS,
    ENV_CODE_PEAK,
    GATE,
    TAU,
    swEnvDir,
    swHash23,
    swPart,
    swPassMaterial,
    swTarget,
    swViewRay,
} from './serenity-warp-tsl.js';

/** A star's core as a share of its lattice cell, at the size it is drawn on a 1080-line frame. */
const STAR_SPREAD = 0.23;
/** The pole of the band of our own galaxy across the sky (its plane passes near the gate). */
const BAND_NORMAL = /* @__PURE__ */ vec3(0.52, 0.8, 0.3);

/** A star's colour by its temperature (0 cool → 1 hot): orange, gold-white, white, blue-white. */
const starColor = (t) => mix(
    mix(vec3(1.0, 0.6, 0.36), vec3(1.0, 0.9, 0.78), clamp(t.mul(2.2), 0.0, 1.0)),
    vec3(0.7, 0.82, 1.0),
    clamp(t.mul(2.0).sub(1.0), 0.0, 1.0),
);
/** How tightly the vortex's arms are wound (radians of turn per unit of log angle), at rest and added by warp. */
export const WIND_REST = 1.35;
export const WIND_WARP = 1.1;

/**
 * The sky's light in a direction.
 * @param {object} u          the shared uniforms
 * @param {object} d          unit direction (vec3 node)
 * @param {object} footprint  radians of view one pixel of whatever is being painted covers
 * @param {object} options    { detail, warpRead, skyLayers, vortexLight, vortexDust, heroStars, richFar }
 * @returns {object} vec3 node (scene-linear HDR)
 */
export function skyLight(u, d, footprint, {
    detail = true, warpRead = true, skyLayers = 3,
    vortexLight = true, vortexDust = true, heroStars = true, richFar = true,
} = {}) {
    const G = u.gateDir;
    const cosT = clamp(dot(d, G), -1.0, 1.0);
    const sx = dot(d, u.gateX);
    const sy = dot(d, u.gateY);
    const sinT = sqrt(sx.mul(sx).add(sy.mul(sy)));
    const theta = atan(sinT, cosT).toVar();
    const phi = atan(sy, sx).toVar();
    const alpha = u.gateRadius;

    // ── Waves and ripples (they bend what is behind them, then add their light) ──
    const waveLit = vec3(0.0).toVar();
    const bend = float(0.0).toVar();
    Loop({
        start: int(0), end: u.waveCount, type: 'int', condition: '<', name: 'w',
    }, ({ w }) => {
        const A = u.events.element(w.mul(2).add(EVENT_ROWS.waves));
        const C = u.events.element(w.mul(2).add(EVENT_ROWS.waves + 1));
        const x = theta.sub(A.x).div(max(A.y, 1e-4));
        const g = exp(x.mul(x).negate());
        // A lens more than a light: a dim body with a soft wake behind it, and a thin crest on
        // its leading edge whose colours split a little (blue leads, red trails), like a shock
        // seen through glass.
        const wake = exp(max(x.negate(), 0.0).mul(-1.4)).mul(smoothstep(0.0, -0.6, x)).mul(0.12);
        const crest = (k) => exp(pow2(x.sub(k).mul(2.2)).negate());
        const edge = vec3(crest(0.24), crest(0.4), crest(0.56));
        const crestLight = edge.mul(mix(C.rgb, vec3(1.0), 0.45)).mul(1.15);
        waveLit.addAssign(C.rgb.mul(g.mul(0.32).add(wake)).add(crestLight).mul(A.z));
        bend.addAssign(A.z.mul(x).mul(g).mul(A.y).mul(1.1));
    });
    const rippleLit = vec3(0.0).toVar();
    Loop({
        start: int(0), end: u.rippleCount, type: 'int', condition: '<', name: 'r',
    }, ({ r }) => {
        const A = u.events.element(r.mul(2).add(EVENT_ROWS.ripples));
        const C = u.events.element(r.mul(2).add(EVENT_ROWS.ripples + 1));
        const off = sqrt(max(float(2.0).sub(dot(d, A.xyz).mul(2.0)), 0.0));
        const x = off.sub(A.w).div(max(A.w.mul(0.16).add(0.004), 1e-4));
        rippleLit.addAssign(C.rgb.mul(C.w).mul(exp(x.mul(x).negate())));
    });
    const th = max(theta.add(bend), 1e-5).toVar();

    // The rim, blended over a pixel of whatever is painted (both sides are rings of light).
    const pix = max(footprint, 1e-5).mul(1.2).toVar();
    const outside = smoothstep(alpha.sub(pix), alpha.add(pix), th).toVar();
    const result = vec3(0.0).toVar();
    // The light of the gate itself, laid over both sides.
    const gateLight = u.gateGain.mul(u.breath.mul(0.85).add(0.15)).toVar();

    // ── Outside: our sky, bent round the throat ──
    If(outside.greaterThan(0.001), () => {
        const beta = max(th.sub(alpha.mul(alpha).div(th)), 0.0).toVar();
        const dir = u.gateDir.mul(cos(beta))
            .add(u.gateX.mul(cos(phi)).add(u.gateY.mul(sin(phi))).mul(sin(beta)))
            .toVar();
        const shift = u.hereShift;

        // ── Deep space far from the gate, in plain direction space ──
        const far = vec4(u.gas(dir.mul(0.55).add(shift))).toVar();
        if (warpRead) {
            const curl = vec4(u.gas(dir.mul(1.3).add(shift.mul(1.7)).add(far.xyz.sub(0.5).mul(0.42))));
            far.assign(mix(far, curl, 0.45));
        }
        // On the lean tiers the open sky stays one soft field (its sky shader is what an iGPU
        // spends its frame on); from Medium up it is a nebula with dust, under a band of stars.
        let band = float(0.0);
        let clear = float(1.0);
        const sky = vec3(0.0).toVar();
        if (richFar) {
            // A faint band of the galaxy we stand in crosses the sky toward the gate: more gas,
            // more dust and more stars along it.
            const lat = dot(dir, BAND_NORMAL);
            band = exp(lat.mul(lat).mul(-7.0)).toVar();
            const spine = exp(lat.mul(lat).mul(-60.0));
            // Emission on wide ramps (a heart in the densest masses), in two hues across the sky.
            const em = smoothstep(float(0.46).sub(band.mul(0.16)), 0.94, far.x).toVar();
            const nebCol = mix(u.deep.mul(1.15), mix(u.glow, u.accent, 0.35), smoothstep(0.3, 0.75, far.w));
            // Dust: thin threads where the billows cross their middle, thickest inside the
            // masses, and a rift down the band's spine. It is what gives the clouds their edges.
            const thread = pow(float(1.0).sub(abs(far.z.mul(2.0).sub(1.0))), 3.0);
            const rift = smoothstep(0.35, 0.7, far.y.mul(0.6).add(far.x.mul(0.5))).mul(spine);
            clear = exp(thread.mul(smoothstep(0.3, 0.75, far.x).mul(1.8).add(band.mul(1.1)))
                .add(rift.mul(2.2)).negate()).toVar();
            // The band's own light: the stars too far to tell apart, warm, brightest on its spine.
            const milk = mix(vec3(0.62, 0.55, 0.7), u.starTint, 0.4).mul(u.dust.mul(0.5).add(0.5));
            sky.assign(u.skyCol.mul(far.x.mul(1.2).add(0.45))
                .add(nebCol.mul(em.mul(0.03).add(em.mul(em).mul(0.13))).mul(clear))
                .add(milk.mul(band.mul(band).mul(far.x.mul(0.6).add(0.4)).mul(0.03)).mul(clear))
                .add(u.accent.mul(pow(far.y, 4.0).mul(em).mul(0.09)).mul(clear)));
        } else {
            const farMass = smoothstep(0.36, 0.86, far.x).mul(far.w.mul(0.6).add(0.4));
            sky.assign(u.skyCol.mul(far.x.mul(1.4).add(0.6))
                .add(u.deep.mul(farMass.mul(0.05)))
                .add(u.accent.mul(pow(far.y, 3.0).mul(farMass).mul(0.03))));
        }

        // ── The vortex: log-polar about the axis, wound, flowing in ──
        const L = log(max(beta, 0.0035)).toVar();
        const wind = float(WIND_REST).add(u.warp.mul(WIND_WARP)).toVar();
        const turn = phi.sub(L.mul(wind)).add(u.spin).add(u.twist.mul(float(1.6).sub(L.mul(0.25)))).toVar();
        const ring = vec2(cos(turn), sin(turn));
        const P = vec3(ring.mul(0.42), L.add(u.inflow).mul(0.23)).add(shift.mul(1.3));
        const gas = vec4(u.gas(P)).toVar();
        const coarse = gas.x.toVar();
        if (detail) {
            const fine = vec4(u.gas(vec3(ring.mul(1.1), L.add(u.inflow).mul(0.61)).add(shift.mul(2.1)).add(0.37)));
            gas.assign(vec4(gas.x.mul(0.72).add(fine.x.mul(0.28)), mix(gas.y, fine.y, 0.45), gas.z, gas.w));
        }
        // Lit by the throat: the same gas a step nearer to it. Where the gas thickens outward its
        // face looks at the gate and takes its light; the far side of each billow is in shade.
        const facing = float(0.5).toVar();
        if (vortexLight) {
            const dL = 0.14;
            const turnIn = turn.add(wind.mul(dL));
            const ringIn = vec2(cos(turnIn), sin(turnIn));
            const Pin = vec3(ringIn.mul(0.42), L.sub(dL).add(u.inflow).mul(0.23)).add(shift.mul(1.3));
            facing.assign(clamp(coarse.sub(u.gas(Pin).x).mul(5.5).add(0.5), 0.0, 1.0));
        }
        const shade = mix(float(0.3), float(1.6), facing.mul(facing).mul(float(3.0).sub(facing.mul(2.0)))).toVar();
        // Two arms, frayed by the gas itself; the gaps between them stay dark.
        const arms = smoothstep(-0.1, 0.95, cos(turn.mul(2.0).add(gas.w.mul(2.6)))).toVar();
        // The gate lights the gas near it; the vortex fades out far from it.
        const near = float(1.0).div(float(1.0).add(beta.mul(beta).mul(55.0))).toVar();
        const reach = float(1.0).sub(smoothstep(0.3, 1.2, beta)).toVar();
        // Far out the log-polar read is magnified into long smears: break the outer arms up with
        // the clouds of the open sky, which keep their own size everywhere.
        const outer = smoothstep(0.12, 0.5, beta);
        const clumps = mix(float(1.0), smoothstep(0.25, 0.75, far.x).mul(1.25).add(0.2), outer.mul(0.8));
        const mass = smoothstep(0.4, 0.86, gas.x).mul(arms.mul(0.85).add(0.15)).mul(clumps).toVar();
        const lit = near.mul(1.25).add(0.06).mul(reach)
            .mul(u.warp.mul(0.35).add(1.0))
            .toVar();
        const threads = pow(gas.y, 4.0).mul(mass.add(0.15));
        // Knots: bright clumps strung along the arms, in the third colour.
        const knots = pow(gas.z, 6.0).mul(arms).mul(reach);
        // Dark lanes along the arms: thin threads of dust.
        const lane = pow(float(1.0).sub(abs(gas.z.mul(2.0).sub(1.0))), 4.0).mul(arms.mul(0.7).add(0.3)).mul(reach);
        const veil = float(1.0).sub(lane.mul(0.85)).toVar();
        // Far out the gas falls into its own deep colour; nearer it is the glow, and nearest the
        // throat it runs hot, toward the gate's own white.
        const hue = mix(u.deep.mul(1.6), u.glow, smoothstep(0.02, 0.4, near));
        const hot = mix(hue, mix(u.glow, u.gateCol, 0.55), smoothstep(0.45, 0.95, near).mul(0.6));
        const vortex = hot.mul(mass.mul(lit).mul(shade))
            .add(u.deep.mul(mass.mul(reach).mul(0.05)))
            .add(u.accent.mul(threads.mul(lit).mul(shade).mul(0.7)))
            .add(u.accent.mul(knots.mul(lit.add(0.15)).mul(1.6)))
            // The faces that look at the throat catch its colour at their edges.
            .add(u.gateCol.mul(pow(facing, 4.0).mul(mass).mul(near)
                .mul(reach)
                .mul(0.35)))
            .mul(veil)
            .toVar();
        // A second, nearer veil of dust that winds more slowly than the gas behind it: its threads
        // cross the arms and stand dark against the glow (it is what puts depth into the drain).
        const front = float(1.0).toVar();
        if (vortexDust) {
            const turnD = phi.sub(L.mul(wind.mul(0.7))).add(u.spin.mul(0.55)).add(2.1);
            const PD = vec3(vec2(cos(turnD), sin(turnD)).mul(0.5), L.add(u.inflow.mul(0.55)).mul(0.29))
                .add(shift.mul(0.8)).add(vec3(0.31, 0.17, 0.53));
            const dd = vec4(u.gas(PD));
            const dThread = pow(float(1.0).sub(abs(dd.z.mul(2.0).sub(1.0))), 3.0);
            const where = smoothstep(0.004, 0.05, beta).mul(float(1.0).sub(smoothstep(0.35, 1.0, beta)));
            front.assign(exp(dThread.mul(smoothstep(0.35, 0.75, dd.x)).mul(where).mul(-2.2)));
        }
        sky.assign(sky.mul(veil.mul(0.5).add(0.5)).add(vortex.mul(u.breath)).mul(front));

        // ── Far stars, bent with the rest: arcs near the rim, gone in the squeeze, faded at speed ──
        const lens = float(1.0).add(alpha.mul(alpha).div(th.mul(th))).toVar();
        // Dust hides stars as it hides the gas; the band holds more of them.
        const seenStars = richFar ? clear.mul(veil).mul(front).mul(band.mul(0.9).add(0.55)).toVar() : front;
        const stars = vec3(0.0).toVar();
        for (let i = 0; i < skyLayers; i++) {
            const scale = [150, 96, 62][i];
            const want = footprint.mul(scale * 1.25).mul(lens);
            const spread = min(want, 0.4);
            const thin = min(float(STAR_SPREAD).div(want), 1.0);
            const p = dir.mul(scale).add(vec3(11.3 * (i + 1), 7.1 * (i + 2), 3.7 * (i + 3)));
            const cell = floor(p);
            const f = fract(p).sub(0.5);
            const h = swHash23(cell.xy.add(cell.z.mul(vec2(37.0, 17.0))));
            const g = swHash23(cell.xy.add(cell.z.mul(vec2(-11.0, 53.0))).add(4.7));
            const at = vec3(h.x, h.y, g.x).sub(0.5).mul(0.7);
            const away = length(f.sub(at));
            const mag = pow(h.z, 9.0).mul(2.6).add(pow(g.y, 3.0).mul(0.16));
            const core = float(1.0).sub(smoothstep(0.0, spread, away));
            stars.addAssign(starColor(g.z).mul(core.mul(core).mul(mag).mul(thin).mul(thin)));
        }
        // The band's grain: a fine lattice of faint stars that is there only along it.
        if (richFar && skyLayers >= 3) {
            const scale = 260;
            const want = footprint.mul(scale * 1.25).mul(lens);
            const thin = min(float(STAR_SPREAD).div(want), 1.0);
            const p = dir.mul(scale).add(vec3(2.9, 13.7, 5.3));
            const cell = floor(p);
            const h = swHash23(cell.xy.add(cell.z.mul(vec2(23.0, 41.0))).add(1.9));
            const away = length(fract(p).sub(0.5).sub(vec3(h.x, h.y, 0.5).sub(0.5).mul(0.6)));
            const core = float(1.0).sub(smoothstep(0.0, min(want, 0.4), away));
            const odds = band.mul(far.x.mul(0.8).add(0.3));
            const here = step(float(1.0).sub(odds.mul(0.75)), h.z);
            stars.addAssign(starColor(h.z.mul(0.7)).mul(core.mul(core).mul(here).mul(thin.mul(thin).mul(0.5))));
        }
        // A few bright stars of our own galaxy, each with a soft halo and four spikes upright on
        // the screen (in the lens's own axes): the sky's sense of scale.
        if (heroStars) {
            const HS = 21.0;
            const hp = dir.mul(HS).add(vec3(3.1, 8.3, 1.7));
            const hc = floor(hp);
            const hh = swHash23(hc.xy.add(hc.z.mul(vec2(29.0, 61.0))).add(2.3)).toVar();
            // One cell in twenty holds a star, and a cell is tens of pixels wide: the branch is
            // coherent, and the other cells skip the spikes and the halo altogether.
            If(hh.z.greaterThan(0.955), () => {
                const hg = swHash23(hc.xy.add(hc.z.mul(vec2(-41.0, 13.0))).add(9.1));
                const dp = hp.sub(hc.add(0.5).add(vec3(hh.x, hh.y, hg.x).sub(0.5).mul(0.36))).toVar();
                const r = length(dp);
                const px = max(footprint.mul(HS * 1.25).mul(lens), 1e-5).toVar();
                const ax = abs(dot(dp, u.camRight));
                const ay = abs(dot(dp, u.camUp));
                const spikeW = max(px.mul(0.7), 0.0035);
                const along = (a) => pow(clamp(float(1.0).sub(a.div(0.24)), 0.0, 1.0), 3.0);
                const spikes = along(ax).mul(exp(ay.div(spikeW).pow(2.0).negate()))
                    .add(along(ay).mul(exp(ax.div(spikeW).pow(2.0).negate())));
                const core = exp(r.div(px.mul(0.9)).pow(2.0).negate());
                const glowR = float(1.0).div(float(1.0).add(r.div(0.018).pow(2.0)));
                const bright = mix(float(3.0), float(9.0), pow(hg.y, 2.0)).mul(min(float(STAR_SPREAD * 6).div(px.mul(4.0)), 1.0));
                stars.addAssign(starColor(hg.z).mul(core.add(spikes.mul(0.09)).add(glowR.mul(0.02)).mul(bright)));
            });
        }
        sky.addAssign(stars.mul(u.starTint).mul(seenStars).mul(float(1.0).sub(smoothstep(0.1, 0.7, u.warp).mul(0.8))).mul(u.breath));

        // ── The gate's light in space round it: the photon ring, its glow, a halo and a wide glow ──
        const off = th.sub(alpha).div(max(alpha, 1e-3)).toVar();
        // Sharp, but never thinner than the pixels it is painted on.
        const sharp = float(2600.0).div(pow(max(float(1.0), pix.div(max(alpha, 1e-3)).mul(60.0)), 2.0)).toVar();
        // The gas swirling round the throat is beamed toward us on the side it comes at us from:
        // that side of the ring is brighter and whiter, the other dimmer and in the gas's colour.
        const beam = cos(phi.sub(u.spin.mul(0.7)).sub(0.9)).mul(0.5).add(0.5).toVar();
        const beamGain = mix(float(0.42), float(1.5), beam).toVar();
        // The gas behind the throat, lensed into arcs along the ring (at the rim the vortex's read
        // depends on the turn alone).
        const arcs = mix(float(0.5), float(1.4), smoothstep(0.3, 0.85, gas.x));
        const rimRing = exp(off.mul(off).mul(sharp.negate())).mul(4.2).mul(arcs)
            .add(exp(off.mul(off).mul(-180.0)).mul(0.55))
            // A second, fainter ring a little outside: light that went round the throat twice.
            .add(exp(pow2(off.sub(0.07)).mul(sharp.mul(-1.4))).mul(0.7));
        const halo = float(0.28).div(float(1.0).add(off.mul(off).mul(22.0)))
            .add(float(0.025).div(float(1.0).add(th.mul(th).mul(14.0))));
        const ringHot = mix(mix(u.glow, u.gateCol, 0.45), u.gateCol.mul(vec3(0.9, 0.97, 1.12)), beam);
        const rimCol = mix(ringHot, u.rimTint, u.rimFlash);
        // The halo takes half of a surge (all of it washed the whole gate grey), in the gas's glow.
        const haloLight = mix(float(1.0), gateLight, 0.5);
        sky.addAssign(rimCol.mul(rimRing.mul(beamGain)).mul(gateLight)
            .add(mix(u.gateCol, u.glow, 0.5).mul(halo.mul(0.5).mul(beamGain.mul(0.4).add(0.6))).mul(haloLight)));
        result.assign(sky);
    });

    // ── Inside: the other sky, folded into the throat ──
    If(outside.lessThan(0.999), () => {
        const k = clamp(th.div(max(alpha, 1e-4)), 0.0, 1.0).toVar();
        const gamma = pow(k, GATE.fold).mul(Math.PI).toVar();
        // Seen through, left and right swap; the far sky turns its own way.
        const around = phi.negate().add(u.spin.mul(0.6));
        const dir = u.gateDir.mul(cos(gamma))
            .add(u.gateX.mul(cos(around)).add(u.gateY.mul(sin(around))).mul(sin(gamma)))
            .toVar();
        // The other sky: a galaxy seen face on at the far end, deep space round it.
        const g = max(gamma, 0.004);
        const gL = log(g);
        const gTurn = around.sub(gL.mul(1.9)).add(u.spin.mul(2.2));
        const gRing = vec2(cos(gTurn), sin(gTurn));
        const gal = vec4(u.gas(vec3(gRing.mul(0.36), gL.mul(0.32)).add(u.thereShift))).toVar();
        const galArms = smoothstep(-0.25, 0.95, cos(gTurn.mul(2.0).add(gal.w.mul(2.2))));
        const disc = exp(g.mul(-1.6));
        const nucleus = float(1.0).div(float(1.0).add(th.mul(th).mul(float(1.0).div(max(pix.mul(pix).mul(9.0), 1.2e-5)))));
        const bulge = exp(g.mul(-7.0));
        const galMass = smoothstep(0.3, 0.85, gal.x).mul(galArms.mul(0.8).add(0.2)).mul(disc);
        const galLanes = pow(float(1.0).sub(abs(gal.z.mul(2.0).sub(1.0))), 4.0).mul(galArms).mul(disc);
        const far = vec4(u.gas(dir.mul(0.9).add(u.thereShift.mul(1.3)))).toVar();
        const light = u.thereGlow.mul(galMass.mul(1.5))
            .add(u.thereAccent.mul(pow(gal.y, 3.0).mul(disc).mul(0.9)))
            .add(u.thereAccent.mul(pow(gal.z, 6.0).mul(galArms).mul(disc).mul(1.8)))
            .mul(float(1.0).sub(galLanes.mul(0.8)))
            .add(u.thereGate.mul(nucleus.mul(5.0).add(bulge.mul(1.1))))
            .add(u.thereDeep.mul(smoothstep(0.4, 0.9, far.x).mul(0.09).add(0.012)).mul(float(1.0).sub(disc.mul(0.6))))
            .toVar();
        // The other sky's stars, as large as the fold lets them be.
        const squeeze = float(Math.PI * GATE.fold).mul(pow(max(k, 0.05), GATE.fold - 1)).div(max(alpha, 1e-3));
        const want = footprint.mul(70.0 * 1.25).mul(squeeze);
        const p = dir.mul(70.0).add(vec3(5.1, 9.7, 2.3));
        const cell = floor(p);
        const h = swHash23(cell.xy.add(cell.z.mul(vec2(37.0, 17.0))));
        const away = length(fract(p).sub(0.5).sub(vec3(h.x, h.y, 0.5).sub(0.5).mul(0.6)));
        const core = float(1.0).sub(smoothstep(0.0, min(want, 0.4), away));
        const thin = min(float(STAR_SPREAD).div(want), 1.0);
        light.addAssign(vec3(1.0, 0.95, 0.9).mul(core.mul(core).mul(pow(h.z, 5.0).mul(2.2).add(0.05)).mul(thin)));
        // The inner rim: the other sky's far side drawn out round it.
        const edge = float(1.0).sub(k);
        light.addAssign(u.thereGate.mul(exp(edge.mul(edge).mul(-1800.0)).mul(2.4).add(exp(edge.mul(edge).mul(-90.0)).mul(0.25))));

        // ── In a jump we are inside the throat: its walls rush past, the galaxy ahead ──
        If(u.jump.greaterThan(0.002), () => {
            const deep = log(max(th, 0.002)).toVar();
            // The walls are where we look aside; straight ahead is the galaxy.
            const walls = smoothstep(0.1, 0.7, th).toVar();
            // The walls' glow: the other sky's gas drawn out along the tunnel, broad and dim, so
            // the streaks have something to run over.
            const glowRead = u.fbmLod(vec2(phi.div(TAU).mul(5.0), deep.mul(0.35).sub(u.jumpClock.mul(0.9))), 1);
            const wallGlow = mix(u.thereDeep, u.thereGlow, glowRead.x).mul(glowRead.y.mul(0.16).add(0.03));
            // Streaks: lanes round the tunnel, each holding dashes of light that run out past us.
            // A lane is a pixel or so wide at any size (its width follows the pixel's angle there).
            const streaks = vec3(0.0).toVar();
            const lanesAt = (count, speed, seed, gain) => {
                const a = phi.div(TAU).mul(count).add(seed);
                const lane = floor(a);
                const across = fract(a).sub(0.5);
                const lh = swHash23(vec2(lane, seed * 7.0));
                const s = deep.mul(1.6).sub(u.jumpClock.mul(speed).mul(lh.y.mul(0.8).add(0.6))).add(lh.x.mul(9.0));
                const dash = floor(s);
                const along = fract(s);
                const dh = swHash23(vec2(lane, dash).add(seed * 3.1));
                const len = mix(float(0.18), float(0.7), dh.y);
                const shape = smoothstep(0.0, 0.04, along).mul(float(1.0).sub(smoothstep(len.mul(0.4), len, along)));
                // The lane's half width in lane units: a pixel of view at this angle off the axis.
                const pixLane = pix.div(max(sin(min(th, 1.5)), 0.02)).mul(count / TAU);
                const w = max(pixLane.mul(0.75), 0.012);
                const line = exp(pow2(across.div(w)).negate()).mul(min(pixLane.mul(0.75).div(w), 1.0).mul(0.5).add(0.5));
                const col = mix(mix(u.thereGlow, u.thereGate, dh.z), u.thereAccent, step(0.82, dh.x));
                streaks.addAssign(col.mul(line.mul(shape).mul(step(0.42, dh.x)).mul(gain)));
            };
            lanesAt(70.0, 3.4, 1.0, 2.2);
            lanesAt(150.0, 4.6, 2.0, 1.3);
            // Thin rings rushing past toward us, a few at a time (not filled bands).
            const ringAt = fract(deep.mul(1.1).sub(u.jumpClock.mul(1.7)));
            const ringW = max(pix.div(max(th, 0.02)).mul(1.1 * 1.5), 0.012);
            const rings = exp(pow2(ringAt.sub(0.5).div(ringW)).negate()).mul(0.9);
            const tunnel = wallGlow
                .add(streaks)
                .add(mix(u.thereGlow, u.thereGate, 0.5).mul(rings))
                .mul(walls);
            light.assign(light.mul(float(1.0).sub(u.jump.mul(walls).mul(0.8))).add(tunnel.mul(u.jump)));
        });
        // Swallowed by the throat, the other sky is seen from inside its light: the iris would
        // close on it, so it is held down here instead of crushing everything else.
        result.assign(mix(light.mul(gateLight).mul(float(1.0).sub(u.jump.mul(0.45))), result, outside));
    });

    return result.add(waveLit.add(rippleLit).mul(u.iris));
}

/**
 * The backdrop (full screen, at the screen's resolution, behind the glass) and the environment
 * pass (every direction, into a small target the glass reads).
 * @param {object} u
 * @param {{ detail: boolean, warpRead: boolean, skyLayers: number, env: number, envEvery: number }} tier
 */
export function createSky(u, tier) {
    const options = {
        detail: tier.detail,
        warpRead: tier.warpRead,
        skyLayers: tier.skyLayers,
        vortexLight: tier.vortexLight !== false,
        vortexDust: tier.vortexDust !== false,
        heroStars: tier.heroStars !== false,
        richFar: tier.richFar !== false,
    };

    // ── The environment pass (what the glass mirrors: no spikes, no second veil, no relief) ──
    const envTexel = uniform(TAU / 512);
    const envFn = Fn(() => {
        const d = swEnvDir(uv()).toVar();
        const light = skyLight(u, d, envTexel, {
            ...options, skyLayers: Math.min(2, options.skyLayers), vortexLight: false, vortexDust: false, heroStars: false,
        });
        // Where the target is 8-bit, keep the dark sky's steps: store √(light / peak).
        const stored = u.floatTarget ? light : sqrt(clamp(light.div(ENV_CODE_PEAK), 0.0, 1.0));
        return vec4(stored, 1.0);
    });
    const envMaterial = swPassMaterial('SerenityWarpEnvironment', envFn());
    const quad = new THREE.QuadMesh(envMaterial);
    let target = swTarget(4, 2, 'serenity-warp-environment', u.floatTarget, THREE.RepeatWrapping);
    u.envTex.value = target.texture;

    // ── The backdrop ──
    const backdropFn = Fn(() => {
        const d = swViewRay(u, screenUV).toVar();
        return vec4(max(skyLight(u, d, u.pixelAngle, options), vec3(0.0)), 1.0);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const backdrop = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: false });
    backdrop.name = 'SerenityWarpSky';
    backdrop.fog = false;
    backdrop.depthFunc = THREE.LessEqualDepth;
    // At the far plane: anything solid in front of it (the glass) keeps its pixels.
    backdrop.vertexNode = vec4(positionGeometry.xy, 1.0, 1.0);
    backdrop.colorNode = backdropFn();
    // Drawn after the glass among the opaque parts, so it is shaded only where it shows.
    const part = swPart('SerenityWarpSky', geometry, backdrop, 50);

    let frame = 0;
    /** Size the environment target for a tier (width; height is half). Returns true if rebuilt. */
    part.resize = (width) => {
        const w = Math.max(16, Math.round(width));
        const h = Math.max(8, Math.round(width / 2));
        if (target.width === w && target.height === h) return false;
        target.dispose();
        target = swTarget(w, h, 'serenity-warp-environment', u.floatTarget, THREE.RepeatWrapping);
        u.envTex.value = target.texture;
        envTexel.value = TAU / w;
        frame = 0;
        return true;
    };
    part.resize(tier.env);
    /** Paint the environment for this frame (every `envEvery`-th frame; the first always). */
    part.render = (renderer, force = false) => {
        if (!renderer || typeof renderer.setRenderTarget !== 'function') return false;
        const every = Math.max(1, tier.envEvery | 0);
        const due = force || frame % every === 0;
        frame += 1;
        if (!due) return false;
        const previous = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
        renderer.setRenderTarget(target);
        quad.render(renderer);
        renderer.setRenderTarget(previous);
        return true;
    };
    part.pass = { quad, material: envMaterial };
    part.target = () => target;
    part.dispose = () => {
        target.dispose();
        envMaterial.dispose();
    };
    return part;
}
