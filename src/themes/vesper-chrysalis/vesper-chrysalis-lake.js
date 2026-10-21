/**
 * Vesper Chrysalis — the lake.
 *
 * Still water that holds the whole evening upside down. The distance (sky, world, ranges) is
 * mirrored exactly: the lake calls the sky function along its own mirror ray, so the picture in
 * the water is as sharp as the one above it and bends with every ripple. What stands IN the
 * scene (the chrysalis, its wings, the crystal, the lilies, every light in flight) comes from a
 * planar reflector() that renders only those things, with alpha, at reduced resolution; the
 * water lays it over the mirrored sky. Lower tiers skip that pass and keep the mirrored sky.
 *
 * Gameplay writes onto it: a ring is a real ripple (it bends the mirror) and carries its colour
 * on its crest; a clear sends a swell across the whole lake from under the chrysalis.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    pow,
    reflect,
    reflector,
    screenUV,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    RING_FADE,
    RING_REACH,
    RING_SLOTS,
    RING_TAU,
    SWELL_GAP,
    SWELL_ORIGIN,
    SWELL_SLOTS,
    SWELL_SPEED,
    EYE,
    TAU,
    VESPER_DIR,
    SUN_DIR,
    vcBackdrop,
    vcBell,
    vcFresnel,
    vcHash33,
    vcHaze,
    vcPart,
} from './vesper-chrysalis-tsl.js';

/**
 * The breeze on the lake: wave trains (heading in radians, wavelength in metres, the slope it adds
 * before the lake's overall scale, and whether it lives only near the eye). The long ones keep
 * the far mirror whole; the short ones break the near reflections into wavelets.
 */
/** Where the last light lies: on the horizon over the place the sun went down. */
const GLOW_DIR = (() => {
    const flat = Math.hypot(SUN_DIR[0], SUN_DIR[2]);
    const lift = 0.05;
    const l = Math.hypot(1, lift);
    return [SUN_DIR[0] / flat / l, lift / l, SUN_DIR[2] / flat / l];
})();

/** Pixels between the sparks of the glitter lattice. */
const GLINT_PIXELS = 5;

/** How much of the fine ripple moves what the lake mirrors (the rest only turns the light). */
const FINE_IN_MIRROR = 0.22;

const BREEZE = Object.freeze([
    [0.42, 9.0, 0.06, false],
    [2.31, 5.3, 0.055, false],
    [4.07, 3.4, 0.05, false],
    [5.62, 2.2, 0.045, false],
    [1.27, 1.45, 0.05, true],
    [3.05, 0.92, 0.07, true],
    [0.71, 0.61, 0.08, true],
    [4.96, 0.41, 0.085, true],
    [2.02, 0.29, 0.08, true],
]);

/**
 * @param {object} u  shared uniforms
 * @param {object} [opts]
 * @param {number} [opts.mirrorScale=0]  reflector resolution scale (0 = no pass: mirrored sky only)
 * @param {number} [opts.samples=0]      the reflector's MSAA samples: the scene pass's own count, so
 *                                       the mirrored crystal is not a staircase and every material
 *                                       builds one pipeline for both passes
 * @param {boolean} [opts.lite=false]    the cut-down sky function in the mirror
 * @param {boolean} [opts.glitter=true]  the fine ripple that breaks bright things into sparks
 */
export function createLake(u, opts = {}) {
    const mirrorScale = opts.mirrorScale ?? 0;
    const samples = Math.max(0, Math.round(opts.samples ?? 0));
    const lite = opts.lite === true;
    const glitter = opts.glitter !== false;
    const reflection = mirrorScale > 0
        ? reflector({
            resolutionScale: mirrorScale, bounces: false, generateMipmaps: false, samples,
        })
        : null;
    if (reflection) {
        reflection.target.rotateX(-Math.PI / 2);
        reflection.target.name = 'VesperChrysalisReflectorTarget';
    }

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'VesperChrysalisLake';
    material.fog = false;
    material.toneMapped = false;

    material.fragmentNode = Fn(() => {
        const p = positionWorld;
        const rel = p.sub(cameraPosition).toVar();
        const dist = length(rel).toVar();
        const V = rel.div(dist).toVar();
        const st = p.xz.toVar();

        // ── The surface's slope: all but still, a breath of wind in patches ──
        // (The noise is never magnified far: a stretched texel shows in a mirror as a facet. The
        // longer waves are sums of sines for that reason: a slope read from a texture magnified
        // to tens of centimetres a texel draws every straight edge in the mirror as a sawtooth.)
        const w2 = u.noise(st.mul(0.15).sub(vec2(u.drift.mul(0.0105), u.drift.mul(-0.0062)))).toVar();
        const ruffle = smoothstep(0.42, 0.72, u.noise(st.mul(0.009).add(0.37)).b).toVar();
        // A long, slow swell under everything.
        const swellA = sin(st.x.mul(0.05).add(st.y.mul(0.085)).add(u.drift.mul(0.21)));
        const swellB = sin(st.x.mul(-0.071).add(st.y.mul(0.043)).sub(u.drift.mul(0.17)));
        // Two slopes: the broad waves bend the mirror; the fine ripple (a few pixels from crest to
        // crest near the eye) moves it only a little — at full strength it would shift what is
        // mirrored by tens of pixels every few rows and draw every edge in the water as a
        // staircase — and mostly turns the light it catches.
        const slope = vec2(swellA.mul(0.05).sub(swellB.mul(0.07)), swellA.mul(0.085).add(swellB.mul(0.043))).mul(0.9)
            .toVar();
        const fine = w2.ba.sub(0.5).mul(ruffle.mul(0.42).add(0.1)).toVar();
        // The breeze: trains of wavelets, their crests bent by a slow warp so they never line up.
        const bendPhase = u.noise(st.mul(0.0061).add(0.21)).rg.sub(0.5).mul(5.0).toVar();
        // How much of the water one pixel covers along the line of sight: a wavelet shorter
        // than a few pixels would only shimmer, so it fades out where it no longer fits.
        const footprint = dist.mul(u.pixelAngle).div(max(V.y.negate(), 0.035)).toVar();
        BREEZE.forEach(([dir, wavelength, amp, near], i) => {
            const k = TAU / wavelength;
            const kx = Math.cos(dir) * k;
            const kz = Math.sin(dir) * k;
            const phase = st.x.mul(kx).add(st.y.mul(kz)).add(bendPhase.x.mul(1 + i * 0.37)).add(bendPhase.y.mul(i % 2 ? 1 : -1))
                .sub(u.drift.mul(Math.sqrt(9.81 / k) * 0.05))
                .add(i * 1.7);
            const fits = smoothstep(4.0, 9.0, float(wavelength).div(footprint));
            // The shortest live only near the eye, and mostly where the wind is up.
            const where = near ? float(1.0).sub(smoothstep(14.0, 48.0, dist)).mul(ruffle.mul(0.7).add(0.3)) : float(1.0);
            const add = vec2(Math.cos(dir), Math.sin(dir)).mul(sin(phase).mul(amp)).mul(fits).mul(where);
            if (near) fine.addAssign(add);
            else slope.addAssign(add);
        });
        if (glitter) {
            const w3 = u.noise(st.mul(0.71).add(vec2(u.drift.mul(0.027), u.drift.mul(0.019))));
            fine.addAssign(w3.rg.sub(0.5).mul(ruffle.mul(0.3).add(0.04)));
        }
        const stirred = u.power.mul(0.55).add(u.surge.mul(0.5)).add(1.0).mul(0.05);
        slope.mulAssign(stirred);
        fine.mulAssign(stirred);
        slope.addAssign(fine);

        // ── Rings: a crisp front with wavelets behind it, and the slope they give the surface ──
        const ringLight = vec3(0.0).toVar();
        If(u.ringsLive.greaterThan(0.5), () => {
            for (let i = 0; i < RING_SLOTS; i++) {
                const A = u.ringA[i];
                const C = u.ringC[i];
                const age = u.time.sub(A.z);
                const radius = C.w.mul(RING_REACH).mul(float(1.0).sub(exp(age.div(-RING_TAU))));
                const o = st.sub(A.xy);
                const d = length(o);
                const x = d.sub(radius);
                const env = exp(age.mul(-RING_FADE)).mul(step(0.0, age)).mul(A.w);
                const front = vcBell(x.div(0.55)).add(vcBell(x.add(1.7).div(0.8)).mul(0.34))
                    .add(vcBell(x.add(3.6).div(1.2)).mul(0.14));
                ringLight.addAssign(C.rgb.mul(front.mul(env)));
                const wave = sin(x.mul(2.3)).mul(exp(x.mul(x).mul(-0.1))).mul(env);
                slope.addAssign(o.div(max(d, 1e-3)).mul(wave).mul(0.42));
            }
        });

        // ── A clear's swell: one front per line, crossing the lake from under the chrysalis ──
        const swellLight = vec3(0.0).toVar();
        If(u.swellLive.greaterThan(0.5), () => {
            for (let i = 0; i < SWELL_SLOTS; i++) {
                const A = u.swellA[i];
                const o = st.sub(vec2(SWELL_ORIGIN[0], SWELL_ORIGIN[1]));
                const d = length(o);
                // Metres behind the first front.
                const x = u.time.sub(A.x).mul(SWELL_SPEED).sub(d);
                const inside = step(0.0, x).mul(step(x, A.y.mul(SWELL_GAP)));
                const fade = exp(u.time.sub(A.x).mul(-0.42)).mul(A.z);
                const phase = x.div(SWELL_GAP);
                const wave = sin(phase.mul(TAU)).mul(inside).mul(fade);
                slope.addAssign(o.div(max(d, 1e-3)).mul(wave).mul(0.34));
                const crest = vcBell(phase.fract().sub(0.25).div(0.2)).mul(inside).mul(fade);
                swellLight.addAssign(u.swellC[i].mul(crest));
            }
        });

        // ── The mirror ──
        // What bends the mirror: the broad waves and the rings whole, a little of the fine ripple.
        const bend = slope.sub(fine.mul(1 - FINE_IN_MIRROR)).toVar();
        const N = normalize(vec3(slope.x.negate(), 1.0, slope.y.negate())).toVar();
        const Nm = normalize(vec3(bend.x.negate(), 1.0, bend.y.negate())).toVar();
        const cosT = clamp(dot(V, N).negate(), 0.0, 1.0);
        const fres = clamp(vcFresnel(cosT, 0.02).mul(1.12).add(0.07), 0.0, 1.0).toVar();
        const R = reflect(V, Nm).toVar();
        const Rup = normalize(vec3(R.x, max(R.y, 0.0).add(0.0015), R.z)).toVar();
        const mirror = vcBackdrop(u, Rup, { lite, soft: 2.4 }).toVar();
        /** 1 where what stands in the scene hides the distance in the mirror (no glints there). */
        const hidden = float(0.0).toVar();
        if (reflection) {
            // Far water is seen edge-on: its slopes shift the mirror less on screen.
            const reach = float(1.0).div(dist.mul(0.022).add(1.0));
            const ruv = screenUV.flipX().add(vec2(bend.x, bend.y.mul(1.7)).mul(reach).mul(0.9));
            const held = vec4(reflection.sample(ruv)).toVar();
            mirror.assign(mirror.mul(float(1.0).sub(clamp(held.a, 0.0, 1.0))).add(max(held.rgb, vec3(0.0))));
            hidden.assign(clamp(held.a, 0.0, 1.0));
        }

        // ── The lake's own colour, what little of it comes back from under the surface ──
        const body = u.deep.mul(u.breath.mul(0.4).add(0.6));
        const col = mix(body, mirror, fres).toVar();

        // ── Glints: facets of the fine ripple that turn a bright thing to the eye ──
        // The last light on the horizon toward the set sun lays a path of sparks on the water,
        // and the evening star a thinner column of them under itself; each spark twinkles as
        // its facet turns.
        const Rf = reflect(V, normalize(vec3(slope.x.negate(), 0.55, slope.y.negate()))).toVar();
        const toGlow = clamp(dot(Rf, vec3(GLOW_DIR[0], GLOW_DIR[1], GLOW_DIR[2])), 0.0, 1.0);
        const toStar = clamp(dot(Rf, vec3(VESPER_DIR[0], VESPER_DIR[1], VESPER_DIR[2])), 0.0, 1.0);
        const g2 = toGlow.mul(toGlow);
        // (The paths are read along the broad waves' mirror, so they bend with the swell.)
        const g8 = g2.mul(g2).mul(g2).mul(g2);
        const s2 = toStar.mul(toStar);
        const s8 = s2.mul(s2).mul(s2).mul(s2);
        // How likely a facet here is to hold the glow or the star: the columns they lay on the water.
        const open = float(1.0).sub(hidden).toVar();
        const glowPath = pow(g8, 16.0).mul(open).toVar();
        const starPath = pow(s8, 30.0).mul(open).toVar();
        // The sparks sit on a lattice laid out in the angles the resting eye sees the water at, so
        // a spark is a few pixels across at any distance yet fixed to the water while the view drifts.
        const fromEye = st.sub(vec2(EYE.x, EYE.z));
        const seen = vec2(fromEye.x.div(max(fromEye.y.negate(), 0.5)), float(EYE.y).div(max(length(fromEye), 0.5)));
        const cellAt = seen.div(u.pixelAngle.mul(GLINT_PIXELS)).toVar();
        const cell = floor(cellAt);
        const h = vcHash33(vec3(cell, 7.0)).toVar();
        const spot = fract(cellAt).sub(h.xy.mul(0.6).add(0.2));
        const point = exp(dot(spot, spot).mul(-26.0));
        const twinkle = sin(u.time.mul(h.y.mul(4.0).add(2.0)).add(h.x.mul(40.0))).mul(0.5).add(0.5);
        const sparks = point.mul(twinkle.mul(twinkle)).toVar();
        const glints = u.glow.mul(sparks.mul(step(h.z, glowPath.mul(glowPath).mul(0.6))).mul(2.6).add(glowPath.mul(0.03)))
            .add(vec3(1.0, 0.93, 0.82).mul(sparks.mul(step(h.z, starPath.mul(0.9))).mul(3.0).add(starPath.mul(0.04))))
            .mul(u.breath);
        col.addAssign(glints);

        // ── Gameplay light riding the water itself ──
        col.addAssign(ringLight.mul(1.1).add(swellLight.mul(0.9)).mul(u.breath));

        // Far water goes into the mist.
        const far = float(1.0).sub(exp(dist.mul(-1 / 900)));
        col.assign(mix(col, vcHaze(u, V), far.mul(far).mul(0.9)));
        return vec4(col, 1.0);
    })();

    const geometry = new THREE.PlaneGeometry(16000, 16000, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -3000);
    const part = vcPart('VesperChrysalisLake', geometry, material, 30);
    part.reflection = reflection;
    part.reflectorTarget = reflection ? reflection.target : null;
    return part;
}
