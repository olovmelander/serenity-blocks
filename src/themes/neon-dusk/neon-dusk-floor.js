/**
 * Neon Dusk — the glass floor: a dark mirror with a scrolling neon grid.
 *
 * Showcase tiers mirror the world for real: a planar reflector() renders the sky dome and the
 * mountains from the mirrored camera at a reduced resolution, and the floor samples it with a
 * slow ripple in the UV, so the sun, the ranges and the hologram rings all stand upside down in
 * the glass. Lower tiers mirror the sky analytically (gradient + sun), with no second render.
 *
 * Grid lines are "pristine grid" anti-aliased (crisp near, their true average at the horizon).
 * Events write into the glass: piece locks send a ripple ring out from where the piece landed,
 * line clears roll a wave of light in from the horizon.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    fwidth,
    length,
    max,
    min,
    mix,
    normalize,
    positionWorld,
    pow,
    reflector,
    screenUV,
    sin,
    smoothstep,
    vec2,
    vec3,
} from 'three/tsl';
import {
    GRID_SPACING,
    ndHazeColor,
    ndLineAA,
    ndNoise2,
    ndSkyGradient,
    ndSunAlign,
    ndSunDisc,
    rgb,
} from './neon-dusk-tsl.js';
import { ndSunColor, ndSunSlits } from './neon-dusk-sky.js';

/** The grid's slow pulse at rest: every `period` s a band runs in from `from` units in `run` s. */
export const AMBIENT_PULSE = Object.freeze({
    period: 11, run: 7.5, from: 900, energy: 0.2,
});

/** A gaussian ring at `dist` for pulse slot P = (radius, 1/width, energy, 0). */
const ringTerm = (dist, P) => {
    const d = dist.sub(P.x).mul(P.y);
    return exp(d.mul(d).negate()).mul(P.z);
};

/**
 * The analytic mirror for tiers without a reflector: sky gradient, the sun and its glow, and the
 * ranges as one dark silhouette — the pass's V (fitted to the generated terrain: ~1.5° at its
 * floor, walls rising ~1:1, levelling near 15°) with a wandering ridge beyond — so the mirrored
 * sun shows only through the pass, as it does in the reflector's image.
 */
const analyticReflection = (R, u) => {
    const hLen = max(length(vec2(R.x, R.z)), 1e-4);
    const sa = ndSunAlign(R.z.div(hLen));
    const col = ndSkyGradient(max(R.y, 0.0), sa).toVar();
    const lx = dot(R, u.sunRight);
    const ly = dot(R, u.sunUp);
    const ang = length(vec2(lx, ly));
    // The sun's image in the glass, measured in the lens's image plane along the view ray (the
    // mirror ray turned back down), so it is as round as the sun above it.
    const sd = ndSunDisc(u, vec3(R.x, R.y.negate(), R.z), true).toVar();
    const r = length(sd);
    const fwR = max(fwidth(r), 1e-4);
    const inside = float(1.0).sub(smoothstep(0.92, 1.06, r));
    const halo = exp(max(r.sub(1.0), 0.0).mul(-2.6)).mul(mix(float(0.42), float(0.13), inside));
    col.addAssign(rgb(0xff2a7a).mul(exp(ang.mul(-3.4)).mul(0.16)).add(rgb(0xff6a2e).mul(halo)));
    // Soft-edged, as the reflector's rough glass draws it on the tiers above.
    const soft = max(fwR, 0.07);
    const disc = float(1.0).sub(smoothstep(float(1.0).sub(soft), float(1.0).add(soft), r));
    const slit = ndSunSlits(sd.y, max(fwidth(sd.y), 0.025), u.time);
    col.assign(mix(col, ndSunColor(sd.y), disc.mul(slit)));
    const a = abs(atan(R.x, R.z.negate()));
    const vee = max(a.mul(0.25).add(0.026), a.sub(0.02));
    const ridge = float(0.25).add(sin(a.mul(23.0)).mul(0.02)).add(sin(a.mul(57.0)).mul(0.012));
    const edge = min(vee, ridge);
    const behind = float(1.0).sub(smoothstep(edge.sub(0.004), edge.add(0.004), R.y));
    const rangeCol = mix(rgb(0x140a26), ndHazeColor(sa).mul(0.7), exp(R.y.mul(-14.0)).mul(0.6));
    col.assign(mix(col, rangeCol, behind));
    return col;
};

/**
 * @param {object} u  shared world uniforms
 * @param {object} [opts]
 * @param {number} [opts.reflectionScale=0]  reflector resolution scale (0 = analytic mirror)
 * @param {number} [opts.reflectionBlur=0]   mip level the mirror is read at (0 = no mip chain)
 * @returns {{ mesh: THREE.Mesh, reflectorTarget: THREE.Object3D|null, reflection: object|null }}
 */
export function createFloor(u, opts = {}) {
    const reflectionScale = opts.reflectionScale ?? 0;
    const reflectionBlur = opts.reflectionBlur ?? 0;
    const S = float(GRID_SPACING);
    const reflection = reflectionScale > 0
        ? reflector({ resolutionScale: reflectionScale, bounces: false, generateMipmaps: reflectionBlur > 0 })
        : null;
    if (reflection) {
        reflection.target.rotateX(-Math.PI / 2);
        reflection.target.name = 'NeonDuskReflectorTarget';
    }

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NeonDuskFloor';
    material.fog = false;

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const rel = p.sub(cameraPosition).toVar();
        const dist = length(vec2(rel.x, rel.z)).toVar();
        const V = normalize(rel).toVar();

        // ── Grid coordinates (fwidth up front: uniform control flow) ──
        const gx = p.x.div(S);
        const gz = p.z.sub(u.scroll).div(S);
        const fx = fwidth(gx);
        const fz = fwidth(gz);
        const dx = fract(gx.add(0.5)).sub(0.5);
        const dz = fract(gz.add(0.5)).sub(0.5);

        // ── Event waves: a ripple ring from the last lock, light waves from the horizon ──
        const toRipple = length(p.xz.sub(u.ripple.xy));
        const rippleD = toRipple.sub(u.ripple.z).mul(0.22);
        const rippleRing = exp(rippleD.mul(rippleD).negate()).mul(u.ripple.w).toVar();
        const wave = ringTerm(dist, u.ring0).add(ringTerm(dist, u.ring1)).toVar();
        // At rest a soft band of light runs in along the grid every AMBIENT_PULSE.period seconds
        // (closed form in time, so a seek lands on it; off under reduced motion).
        const ambT = fract(u.time.div(AMBIENT_PULSE.period)).mul(AMBIENT_PULSE.period);
        const ambR = float(AMBIENT_PULSE.from).mul(max(float(1.0).sub(ambT.div(AMBIENT_PULSE.run)), 0.0));
        const ambEnd = smoothstep(AMBIENT_PULSE.run - 1.5, AMBIENT_PULSE.run, ambT);
        const ambEnv = smoothstep(0.0, 0.6, ambT).mul(float(1.0).sub(ambEnd));
        const ambD = dist.sub(ambR).div(ambR.mul(0.06).add(5.0));
        wave.addAssign(exp(ambD.mul(ambD).negate()).mul(ambEnv).mul(u.ambient).mul(AMBIENT_PULSE.energy));

        // ── The mirror ──
        // Slow swell in the glass, fading with distance so the far mirror stays calm; the
        // ripple ring adds its own push.
        const swell = ndNoise2(vec2(p.x.mul(0.035), p.z.sub(u.scroll).mul(0.05)).add(u.time.mul(0.04)))
            .sub(0.5).mul(0.012).mul(exp(dist.mul(-0.004)));
        const push = rippleD.mul(exp(rippleD.mul(rippleD).negate())).mul(u.ripple.w).mul(0.012);
        const cosT = clamp(V.y.negate(), 0.0, 1.0);
        const fres = mix(float(0.16), float(0.82), pow(float(1.0).sub(cosT), 4.0));

        // Ripples lying across the view, riding the floor's scroll: each crest tilts the glass
        // toward the eye, so the mirror's image breaks into bars that run in toward the lens —
        // the sun lies in the glass as a road of light. Fine toward the horizon, faded out where
        // a crest would be narrower than a pixel.
        const rph = p.z.sub(u.scroll).mul(0.45).add(u.time.mul(0.8))
            .add(ndNoise2(vec2(p.x.mul(0.012), p.z.sub(u.scroll).mul(0.02))).mul(6.0))
            .toVar();
        const rfw = fwidth(rph);
        const rippleOn = float(1.0).sub(smoothstep(0.6, 1.8, rfw)).toVar();
        const crest = sin(rph).toVar();
        const barMask = mix(float(1.0), smoothstep(-0.55, 0.45, crest).mul(0.9).add(0.18), rippleOn.mul(0.85));

        const mirror = vec3(0.0).toVar();
        if (reflection) {
            // Wind ripples: thin horizontal bands that shift the mirror sideways a few pixels,
            // breaking the reflected sun into bars like wet glass (screen-space, so they never
            // alias with distance).
            const band = sin(screenUV.y.mul(260.0).add(u.time.mul(1.3))
                .add(ndNoise2(vec2(screenUV.x.mul(6.0), screenUV.y.mul(40.0).add(u.time.mul(0.2)))).mul(5.0)));
            const bars = band.mul(0.0017).mul(smoothstep(0.0, 0.25, float(1.0).sub(cosT)));
            const tilt = cos(rph).mul(rippleOn).mul(0.006);
            const ruv = screenUV.flipX().add(vec2(swell.add(push).add(bars), swell.mul(0.6).add(tilt))).toVar();
            // Wet glass: the image is drawn out DOWN the screen (five taps along the vertical,
            // weighted toward the middle), so the sun lies in the glass as a long road of bars
            // and every neon line as a short streak, and it is rough only near the lens: crisp
            // toward the horizon, a mip or two softer underfoot (the grid on top stays crisp).
            const reach = mix(float(0.004), float(0.016), smoothstep(0.0, 0.3, cosT)).toVar();
            const lod = reflectionBlur > 0
                ? mix(float(0.35), float(reflectionBlur + 0.4), smoothstep(0.02, 0.4, cosT)).toVar()
                : null;
            const tap = (k, w) => {
                const s = reflection.sample(ruv.add(vec2(0.0, reach.mul(k))));
                return (lod ? s.level(lod) : s).rgb.mul(w);
            };
            mirror.assign(tap(0, 0.3).add(tap(-1, 0.2)).add(tap(1, 0.2)).add(tap(-2, 0.15))
                .add(tap(2, 0.15)));
        } else {
            const tiltY = cos(rph).mul(rippleOn).mul(0.012);
            const R = normalize(vec3(V.x.add(swell.add(push).mul(2.0)), V.y.negate().add(tiltY), V.z));
            mirror.assign(analyticReflection(R, u));
        }
        mirror.mulAssign(barMask);
        // Dark violet-tinted glass.
        const glass = rgb(0x06020e);
        const col = mix(glass, mirror.mul(vec3(0.8, 0.72, 0.9)), fres).toVar();

        // ── Neon grid ──
        const hw = float(0.018);
        const line = max(ndLineAA(dx, hw, fx), ndLineAA(dz, hw, fz)).toVar();
        const haloNear = max(exp(abs(dx).mul(-14.0)), exp(abs(dz).mul(-14.0)));
        const haloMix = smoothstep(0.05, 0.3, max(fx, fz));
        const halo = mix(haloNear, float(0.2), haloMix).mul(0.16);
        const near = mix(rgb(0xff2a9d), rgb(0xff3fd2), smoothstep(0.0, 0.5, u.comboShift));
        const shifted = mix(near, rgb(0x2ce8ff), smoothstep(0.5, 1.0, u.comboShift));
        const far = mix(rgb(0x8a3cff), rgb(0x3a7bff), u.comboShift);
        const lineCol = mix(shifted, far, smoothstep(60.0, 700.0, dist)).mul(1.9);
        const energy = line.add(halo).mul(float(1.0).add(wave.mul(2.6)).add(rippleRing.mul(2.0)));
        // The grid fades with distance so the mirror owns the far floor.
        const gridFade = exp(dist.mul(-0.0019));
        col.addAssign(lineCol.mul(energy).mul(gridFade));
        col.addAssign(lineCol.mul(wave.mul(0.04).add(rippleRing.mul(0.05))).mul(gridFade));

        // ── Far floor: into the horizon haze (the colour the sky starts from) ──
        const fk = dist.mul(1 / 2900);
        const fog = float(1.0).sub(exp(fk.mul(fk).negate()));
        const sa = ndSunAlign(rel.z.div(max(dist, 1e-3)));
        col.assign(mix(col, ndHazeColor(sa), min(fog, 1.0)));
        return col;
    })();

    // A disc-like quad: from behind the camera to past the far range's feet.
    const geometry = new THREE.PlaneGeometry(12000, 6000, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -2900);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NeonDuskFloor';
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    return { mesh, reflectorTarget: reflection ? reflection.target : null, reflection };
}
