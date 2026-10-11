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
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
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
/** How tightly the vortex's arms are wound (radians of turn per unit of log angle), at rest and added by warp. */
export const WIND_REST = 1.35;
export const WIND_WARP = 1.1;

/**
 * The sky's light in a direction.
 * @param {object} u          the shared uniforms
 * @param {object} d          unit direction (vec3 node)
 * @param {object} footprint  radians of view one pixel of whatever is being painted covers
 * @param {object} options    { detail, warpRead, skyLayers }
 * @returns {object} vec3 node (scene-linear HDR)
 */
export function skyLight(u, d, footprint, { detail = true, warpRead = true, skyLayers = 3 } = {}) {
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
        // A crest: bright on its leading edge, a softer wake behind it.
        const wake = exp(max(x.negate(), 0.0).mul(-1.4)).mul(smoothstep(0.0, -0.6, x)).mul(0.22);
        waveLit.addAssign(C.rgb.mul(A.z).mul(g.add(wake)));
        bend.addAssign(A.z.mul(x).mul(g).mul(A.y).mul(0.55));
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

        // Deep clouds far from the gate, in plain direction space.
        const far = vec4(u.gas(dir.mul(0.55).add(shift))).toVar();
        if (warpRead) {
            const curl = vec4(u.gas(dir.mul(1.3).add(shift.mul(1.7)).add(far.xyz.sub(0.5).mul(0.42))));
            far.assign(mix(far, curl, 0.45));
        }
        const farMass = smoothstep(0.36, 0.86, far.x).mul(far.w.mul(0.6).add(0.4));
        const sky = u.skyCol.mul(far.x.mul(1.4).add(0.6))
            .add(u.deep.mul(farMass.mul(0.05)))
            .add(u.accent.mul(pow(far.y, 3.0).mul(farMass).mul(0.03)))
            .toVar();

        // The vortex: log-polar about the axis, wound, flowing in.
        const L = log(max(beta, 0.0035));
        const wind = float(WIND_REST).add(u.warp.mul(WIND_WARP));
        const turn = phi.sub(L.mul(wind)).add(u.spin).add(u.twist.mul(float(1.6).sub(L.mul(0.25))));
        const ring = vec2(cos(turn), sin(turn));
        const P = vec3(ring.mul(0.42), L.add(u.inflow).mul(0.23)).add(shift.mul(1.3));
        const gas = vec4(u.gas(P)).toVar();
        if (detail) {
            const fine = vec4(u.gas(vec3(ring.mul(1.1), L.add(u.inflow).mul(0.61)).add(shift.mul(2.1)).add(0.37)));
            gas.assign(vec4(gas.x.mul(0.72).add(fine.x.mul(0.28)), mix(gas.y, fine.y, 0.45), gas.z, gas.w));
        }
        // Two arms, frayed by the gas itself; the gaps between them stay dark.
        const arms = smoothstep(-0.1, 0.95, cos(turn.mul(2.0).add(gas.w.mul(2.6)))).toVar();
        const mass = smoothstep(0.4, 0.86, gas.x).mul(arms.mul(0.85).add(0.15)).toVar();
        // The gate lights the gas near it; the vortex fades out far from it.
        const near = float(1.0).div(float(1.0).add(beta.mul(beta).mul(55.0)));
        const reach = float(1.0).sub(smoothstep(0.3, 1.2, beta));
        const lit = near.mul(1.25).add(0.06).mul(reach).mul(u.warp.mul(0.35).add(1.0));
        const threads = pow(gas.y, 4.0).mul(mass.add(0.15));
        // Knots: bright clumps strung along the arms, in the third colour.
        const knots = pow(gas.z, 6.0).mul(arms).mul(reach);
        // Dark lanes along the arms: thin threads of dust.
        const lane = pow(float(1.0).sub(abs(gas.z.mul(2.0).sub(1.0))), 4.0).mul(arms.mul(0.7).add(0.3)).mul(reach);
        const veil = float(1.0).sub(lane.mul(0.85));
        // Near the gate the gas is its light; further out it falls into its own deep colour.
        const hue = mix(u.deep.mul(1.6), u.glow, smoothstep(0.02, 0.4, near));
        const vortex = hue.mul(mass.mul(lit))
            .add(u.deep.mul(mass.mul(reach).mul(0.05)))
            .add(u.accent.mul(threads.mul(lit).mul(0.7)))
            .add(u.accent.mul(knots.mul(lit.add(0.15)).mul(1.6)))
            .mul(veil);
        sky.assign(sky.mul(veil.mul(0.5).add(0.5)).add(vortex.mul(u.breath)));

        // Far stars, bent with the rest: arcs near the rim, gone in the squeeze, faded at speed.
        const lens = float(1.0).add(alpha.mul(alpha).div(th.mul(th)));
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
            const tint = mix(vec3(1.0, 0.86, 0.72), vec3(0.74, 0.86, 1.0), g.z);
            stars.addAssign(tint.mul(core.mul(core).mul(mag).mul(thin).mul(thin)));
        }
        sky.addAssign(stars.mul(u.starTint).mul(float(1.0).sub(smoothstep(0.1, 0.7, u.warp).mul(0.8))).mul(u.breath));

        // The gate's light in space round it: a thin, sharp ring, its glow, a halo and a wide glow.
        const off = th.sub(alpha).div(max(alpha, 1e-3));
        // Sharp, but never thinner than the pixels it is painted on.
        const sharp = float(2600.0).div(pow(max(float(1.0), pix.div(max(alpha, 1e-3)).mul(60.0)), 2.0));
        const rimRing = exp(off.mul(off).mul(sharp.negate())).mul(4.2)
            .add(exp(off.mul(off).mul(-180.0)).mul(0.55));
        const halo = float(0.28).div(float(1.0).add(off.mul(off).mul(22.0)))
            .add(float(0.025).div(float(1.0).add(th.mul(th).mul(14.0))));
        const rimCol = mix(u.gateCol, u.rimTint, u.rimFlash);
        sky.addAssign(rimCol.mul(rimRing).add(mix(u.gateCol, u.glow, 0.35).mul(halo.mul(0.5))).mul(gateLight));
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
            const deep = log(max(th, 0.002));
            const spokes = u.fbmLod(vec2(phi.div(TAU).mul(7.0), deep.mul(0.5).sub(u.jumpClock.mul(1.6))), 0);
            const fine = u.fbmLod(vec2(phi.div(TAU).mul(23.0).add(0.31), deep.mul(1.1).sub(u.jumpClock.mul(2.6))), 0);
            const rings = pow(fract(deep.mul(1.3).sub(u.jumpClock.mul(1.8))), 14.0);
            // The walls are where we look aside; straight ahead is the galaxy.
            const walls = smoothstep(0.12, 0.75, th);
            const streaks = pow(clamp(spokes.x.mul(1.5).sub(0.35), 0.0, 1.0), 4.0)
                .add(pow(clamp(fine.y.mul(1.6).sub(0.5), 0.0, 1.0), 6.0).mul(1.4));
            const tunnel = mix(u.thereGlow, u.thereGate, 0.35).mul(rings.mul(1.6).add(streaks.mul(1.5)))
                .add(u.thereAccent.mul(pow(spokes.z, 5.0).mul(1.2)))
                .mul(walls);
            light.assign(light.mul(float(1.0).sub(u.jump.mul(walls).mul(0.75))).add(tunnel.mul(u.jump)));
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
    const options = { detail: tier.detail, warpRead: tier.warpRead, skyLayers: tier.skyLayers };

    // ── The environment pass ──
    const envTexel = uniform(TAU / 512);
    const envFn = Fn(() => {
        const d = swEnvDir(uv()).toVar();
        const light = skyLight(u, d, envTexel, { ...options, skyLayers: Math.min(2, options.skyLayers) });
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
