/**
 * Galaxy — the suns of the disc, the bulge and the halo.
 *
 * One instanced draw of camera-facing quads, every sun a closed form of the shared clocks (no
 * simulation, no compute pass, so the WebGL2 backend draws the same galaxy):
 *
 *   arm suns    stand at an offset from their arm's ridge, so they keep the pattern and follow
 *               when gameplay winds the arms;
 *   old suns    orbit. Their angular speed falls with radius (a flat rotation curve), so inside
 *               corotation they overtake the pattern, and each one brightens as it crosses an
 *               arm: the density wave, made of the suns passing through it;
 *   bulge, halo the same orbit, out of the plane.
 *
 * A sun is a point of light: its quad is sized from its angular size and never smaller than a
 * pixel (a sub-pixel sun would shimmer as the camera drifts); what the clamp adds in area it
 * takes back in brightness.
 *
 * The board's light: a clear's fronts lift and flare every sun they pass, in the clear's colour,
 * and a lock's ripple lights the suns round its nursery.
 */

import {
    Fn,
    If,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    exp,
    float,
    length,
    max,
    mix,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uv,
    varyingProperty,
    vec3,
    vec4,
} from 'three/tsl';
import {
    GALAXY, TAU, gxArmAngle, gxFxMaterial, gxMax3, gxPart, gxQuadGeometry, gxRippleLight, gxWaveLight,
} from './galaxy-tsl.js';

/** Angular speed of the old suns in the pattern's frame: STREAM · (30 / r) − PATTERN, rad/s of flow. */
export const STREAM_RATE = 0.022;
export const PATTERN_RATE = 0.0085;
/** How far a clear's front lifts a sun out of the plane (light-units). */
const WAVE_LIFT = 2.4;

/** A sun's angular speed in the pattern's frame (CPU twin of the vertex stage). */
export function streamRate(radius) {
    return STREAM_RATE * (30 / Math.max(radius, 6)) - PATTERN_RATE;
}

/**
 * @param {object} u     shared galaxy uniforms
 * @param {object} plan  the plan's `stars`
 * @param {number} count suns drawn (a prefix of the plan)
 */
export function createStars(u, plan, count) {
    const n = Math.max(1, Math.min(plan.count, Math.round(count)));
    const geometry = gxQuadGeometry(n, {
        aOrbit: [plan.orbit.subarray(0, n * 4), 4],
        aLook: [plan.look.subarray(0, n * 4), 4],
    });
    const orbit = attribute('aOrbit', 'vec4');
    const look = attribute('aLook', 'vec4');
    const material = gxFxMaterial('GalaxyStars');

    const vLight = varyingProperty('vec3', 'gxStar');
    material.vertexNode = Fn(() => {
        const radius = orbit.x;
        const pop = look.z;
        const mag = look.y;
        const isArm = float(1.0).sub(step(0.5, pop));
        const isDisc = step(0.5, pop).mul(float(1.0).sub(step(1.5, pop)));
        const ridge = gxArmAngle(radius, u.winding);
        const rate = float(STREAM_RATE * 30).div(max(radius, 6.0)).sub(PATTERN_RATE);
        // Arm suns keep their place on the ridge (a small epicycle keeps them alive).
        const epicycle = sin(u.flow.mul(0.37).add(look.w.mul(TAU))).mul(0.014);
        const angle = mix(orbit.y.sub(rate.mul(u.flow)), ridge.add(orbit.y).add(epicycle), isArm).toVar();
        const local = vec3(cos(angle).mul(radius), orbit.z, sin(angle).mul(radius)).toVar();

        // An old sun brightens as it crosses an arm.
        const inArm = cos(angle.sub(ridge).mul(GALAXY.arms)).mul(0.5).add(0.5);
        const crossing = mix(float(1.0), inArm.mul(inArm).mul(inArm).mul(1.25).add(0.42), isDisc);
        const temp = look.x;
        const warm = mix(vec3(1.0, 0.5, 0.26), u.core, smoothstep(0.0, 0.42, temp));
        const young = mix(u.armInner, u.armOuter, smoothstep(14.0, 80.0, radius)).mul(0.55).add(vec3(0.5, 0.56, 0.7));
        const hot = mix(vec3(1.0, 0.97, 0.94), young, smoothstep(0.6, 1.0, temp));
        const tint = mix(warm, hot, smoothstep(0.36, 0.64, temp));
        const twinkle = sin(u.time.mul(look.w.mul(2.6).add(0.7)).add(orbit.w.mul(40.0))).mul(0.2).add(0.8);
        // Dust below magnitude 0.6, the few that carry the picture above it.
        const bright = smoothstep(0.6, 1.0, mag);
        const light = tint.mul(mag.mul(1.2).add(0.16).add(bright.mul(bright).mul(3.0))).mul(crossing).mul(twinkle)
            .toVar();

        // The board's light.
        If(u.wavesLive.greaterThan(0.5), () => {
            const wave = gxWaveLight(u, radius).toVar();
            const front = gxMax3(wave.rgb);
            local.y.addAssign(front.mul(WAVE_LIFT).mul(orbit.w.mul(0.8).add(0.6)));
            light.assign(light.mul(wave.a.mul(0.35).add(1.0)).add(wave.rgb.mul(mag.mul(1.5).add(0.22))));
        });
        If(u.ripplesLive.greaterThan(0.5), () => {
            light.addAssign(gxRippleLight(u, local.xz).mul(mag.mul(2.0).add(0.45)));
        });

        const world = u.frame.mul(vec4(local, 1.0)).xyz;
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0)).toVar();
        // Angular size → pixels, never under one; the clamp's extra area is paid back in light.
        const raw = mag.mul(0.16).add(bright.mul(0.12)).add(0.1).div(max(clip.w, 1.0).mul(u.pixelAngle));
        const px = clamp(raw, 1.05, u.viewport.y.mul(0.012));
        const paid = clamp(raw.div(px), 0.42, 1.0);
        vLight.assign(light.mul(paid.mul(paid)).mul(u.breath));
        const half = u.viewport.mul(0.5);
        return vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    })();

    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d2 = q.dot(q);
        const core = exp(d2.mul(-6.0)).mul(float(1.0).sub(smoothstep(0.7, 1.0, length(q))));
        return vec4(vLight.mul(core), 0.0);
    })();

    const part = gxPart('GalaxyStars', geometry, material, 0);
    part.count = n;
    return part;
}
