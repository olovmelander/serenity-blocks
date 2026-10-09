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
    length,
    max,
    mix,
    normalize,
    positionWorld,
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
    TAU,
    vcBackdrop,
    vcBell,
    vcFresnel,
    vcHaze,
    vcPart,
} from './vesper-chrysalis-tsl.js';

/**
 * @param {object} u  shared uniforms
 * @param {object} [opts]
 * @param {number} [opts.mirrorScale=0]  reflector resolution scale (0 = no pass: mirrored sky only)
 * @param {boolean} [opts.lite=false]    the cut-down sky function in the mirror
 * @param {boolean} [opts.glitter=true]  the fine ripple that breaks bright things into sparks
 */
export function createLake(u, opts = {}) {
    const mirrorScale = opts.mirrorScale ?? 0;
    const lite = opts.lite === true;
    const glitter = opts.glitter !== false;
    const reflection = mirrorScale > 0
        ? reflector({ resolutionScale: mirrorScale, bounces: false, generateMipmaps: false })
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
        // (The noise is never magnified far: a stretched texel shows in a mirror as a facet.)
        const w1 = u.noise(st.mul(0.037).add(vec2(u.drift.mul(0.0035), u.drift.mul(0.0021)))).toVar();
        const w2 = u.noise(st.mul(0.15).sub(vec2(u.drift.mul(0.0105), u.drift.mul(-0.0062)))).toVar();
        const ruffle = smoothstep(0.42, 0.72, u.noise(st.mul(0.009).add(0.37)).b).toVar();
        // A long, slow swell under everything.
        const swellA = sin(st.x.mul(0.05).add(st.y.mul(0.085)).add(u.drift.mul(0.21)));
        const swellB = sin(st.x.mul(-0.071).add(st.y.mul(0.043)).sub(u.drift.mul(0.17)));
        const slope = vec2(swellA.mul(0.05).sub(swellB.mul(0.07)), swellA.mul(0.085).add(swellB.mul(0.043))).mul(0.9)
            .add(w1.rg.sub(0.5).mul(0.26))
            .add(w2.ba.sub(0.5).mul(ruffle.mul(0.42).add(0.1)))
            .toVar();
        if (glitter) {
            const w3 = u.noise(st.mul(0.71).add(vec2(u.drift.mul(0.027), u.drift.mul(0.019))));
            slope.addAssign(w3.rg.sub(0.5).mul(ruffle.mul(0.3).add(0.04)));
        }
        slope.mulAssign(u.power.mul(0.55).add(u.surge.mul(0.5)).add(1.0).mul(0.05));

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
        const N = normalize(vec3(slope.x.negate(), 1.0, slope.y.negate())).toVar();
        const cosT = clamp(dot(V, N).negate(), 0.0, 1.0);
        const fres = clamp(vcFresnel(cosT, 0.02).mul(1.12).add(0.07), 0.0, 1.0).toVar();
        const R = reflect(V, N).toVar();
        const Rup = normalize(vec3(R.x, max(R.y, 0.0).add(0.0015), R.z)).toVar();
        const mirror = vcBackdrop(u, Rup, { lite, soft: 2.4 }).toVar();
        if (reflection) {
            // Far water is seen edge-on: its slopes shift the mirror less on screen.
            const reach = float(1.0).div(dist.mul(0.022).add(1.0));
            const ruv = screenUV.flipX().add(vec2(slope.x, slope.y.mul(1.7)).mul(reach).mul(0.9));
            const held = vec4(reflection.sample(ruv)).toVar();
            mirror.assign(mirror.mul(float(1.0).sub(clamp(held.a, 0.0, 1.0))).add(max(held.rgb, vec3(0.0))));
        }

        // ── The lake's own colour, what little of it comes back from under the surface ──
        const body = u.deep.mul(u.breath.mul(0.4).add(0.6));
        const col = mix(body, mirror, fres).toVar();

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
