/**
 * Voltage Storm — rain and sparks.
 *
 *  - Rain: streaks in a box of air ahead of the lens, each a closed-form fall on the rain's own
 *    clock (it hangs while the storm holds its breath). Dim against the storm, they are what a
 *    stroke lights first: every flash freezes the air into bright dashes.
 *  - Sparks: what a struck electrode throws. Streaks that leave fast, slow in the wet air, arc
 *    over and fall. A ring of preallocated slots.
 *
 * Nothing is created at event time and every pool is always drawn (dormant slots collapse to
 * zero size), so the first frame compiles every pipeline.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    exp,
    float,
    fract,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uv,
    varyingProperty,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    STORM, TAU, mulberry32, vsFxMaterial, vsPart, vsQuadGeometry,
} from './voltage-storm-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

// ── Rain ────────────────────────────────────────────────────────────────────────

/** Where a drop is: CPU twin of the vertex stage (tests, and nothing else). */
export function rainPoint(seed, clock, lean, out = [0, 0, 0]) {
    const [bx, by, bz] = STORM.rainBox;
    const speed = (STORM.rainFall * (0.8 + 0.4 * seed[3])) / by;
    const phase = (((seed[1] + clock * speed) % 1) + 1) % 1;
    const fallen = phase * by;
    out[0] = (seed[0] - 0.5) * bx + lean[0] * fallen;
    out[1] = by - fallen;
    out[2] = -4 - seed[2] * bz + lean[1] * fallen;
    return out;
}

/**
 * @param {object} u
 * @param {number} count  streaks
 */
export function createRain(u, count) {
    const n = Math.max(1, Math.round(count));
    const rand = mulberry32(0x7a1e);
    const aSeed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
        // More of them near the lens, where a streak is long enough to read.
        aSeed.set([rand(), rand(), rand() ** 1.6, rand()], i * 4);
    }
    const geometry = vsQuadGeometry(n, { aSeed: [aSeed, 4] });
    const seed = attribute('aSeed', 'vec4');
    const material = vsFxMaterial('VoltageStormRain');
    const vLight = varyingProperty('vec4', 'vsRainLight');
    const [bx, by, bz] = STORM.rainBox;

    material.vertexNode = Fn(() => {
        const speed = seed.w.mul(0.4).add(0.8).mul(STORM.rainFall / by);
        const phase = fract(seed.y.add(u.rainClock.mul(speed)));
        const fallen = phase.mul(by);
        const head = vec3(
            seed.x.sub(0.5).mul(bx).add(u.rainLean.x.mul(fallen)),
            float(by).sub(fallen),
            seed.z.mul(-bz).sub(4.0).add(u.rainLean.y.mul(fallen)),
        ).toVar();
        // The streak points back up the way it fell.
        const back = normalize(vec3(u.rainLean.x.negate(), 1.0, u.rainLean.y.negate()));
        const reach = seed.w.mul(0.5).add(0.75).mul(STORM.rainFall * STORM.rainStreak);
        const c0 = viewProjection(head).toVar();
        const c1 = viewProjection(head.add(back.mul(reach))).toVar();
        const along = positionGeometry.y.add(0.5);
        const half = u.viewport.mul(0.5);
        const s0 = c0.xy.div(max(c0.w, 0.01)).mul(half);
        const s1 = c1.xy.div(max(c1.w, 0.01)).mul(half);
        const dir = normalize(s1.sub(s0).add(vec2(0.0, 1e-4)));
        const normal = vec2(dir.y.negate(), dir.x);
        const clip = mix(c0, c1, along).toVar();
        // Gone before it reaches the lens, and thinning into the far air.
        const shown = smoothstep(2.5, 9.0, clip.w).mul(float(1.0).sub(smoothstep(90.0, bz, clip.w)));
        const widthPx = clamp(float(0.014).div(max(clip.w, 0.5).mul(u.pixelAngle)), 0.6, 1.5);
        // Dim against the storm; a stroke anywhere near lights the whole air at once.
        const own = u.haze.mul(0.8).add(u.horizon.mul(0.035));
        vLight.assign(vec4(own.mul(u.breath.mul(0.6).add(0.4)).add(u.veil.mul(0.2)).mul(shown).mul(u.rainGain), 1.0));
        return vec4(
            clip.xy.add(normal.mul(positionGeometry.x.mul(2.0).mul(widthPx)).div(half).mul(clip.w)),
            clip.z,
            clip.w,
        );
    })();
    material.colorNode = Fn(() => {
        const st = uv();
        const across = float(1.0).sub(abs(st.x.sub(0.5)).mul(2.0));
        // Bright at the head, fading up the streak.
        const along = smoothstep(1.0, 0.0, st.y).mul(smoothstep(0.0, 0.08, st.y));
        return vec4(vLight.xyz.mul(across).mul(along), 0.0);
    })();

    const part = vsPart('VoltageStormRain', geometry, material, 50);
    part.count = n;
    part.seeds = aSeed;
    return part;
}

// ── Sparks ──────────────────────────────────────────────────────────────────────

/** A spark's drag, and how hard it falls (m/s²: lighter than a stone, they are embers). */
export const SPARK_DRAG = 2.1;
export const SPARK_FALL = 13;

/** Where a spark is `tau` seconds after it left `from` at `velocity`. CPU twin of the shader. */
export function sparkPoint(from, velocity, tau, out = [0, 0, 0]) {
    const t = Math.max(0, tau);
    const travel = (1 - Math.exp(-t * SPARK_DRAG)) / SPARK_DRAG;
    out[0] = from[0] + velocity[0] * travel;
    out[1] = from[1] + velocity[1] * travel - 0.5 * SPARK_FALL * t * t;
    out[2] = from[2] + velocity[2] * travel;
    return out;
}

/**
 * @param {object} u
 * @param {number} count  pool size
 */
export function createSparks(u, count) {
    const aBirth = new Float32Array(count * 4);
    const aVel = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    // Dormant sparks wait far ahead of the camera, never on it.
    for (let i = 0; i < count; i++) aBirth.set([0, 50, -5000, -100], i * 4);
    const geometry = vsQuadGeometry(count, { aBirth: [aBirth, 4], aVel: [aVel, 4], aTint: [aTint, 4] });
    ['aBirth', 'aVel', 'aTint'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const birth = attribute('aBirth', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const tint = attribute('aTint', 'vec4');
    const material = vsFxMaterial('VoltageStormSparks');
    const vLight = varyingProperty('vec4', 'vsSparkLight');

    material.vertexNode = Fn(() => {
        const tau = u.time.sub(birth.w);
        const span = vel.w;
        const alive = step(0.0, tau).mul(step(tau, span));
        const at = (t) => birth.xyz
            .add(vel.xyz.mul(float(1.0).sub(exp(t.mul(-SPARK_DRAG))).div(SPARK_DRAG)))
            .sub(vec3(0.0, t.mul(t).mul(SPARK_FALL * 0.5), 0.0));
        const t = max(tau, 0.0);
        // A streak from where the spark was a moment ago to where it is.
        const c0 = viewProjection(at(max(t.sub(0.045), 0.0))).toVar();
        const c1 = viewProjection(at(t)).toVar();
        const along = positionGeometry.x.add(0.5);
        const half = u.viewport.mul(0.5);
        const s0 = c0.xy.div(max(c0.w, 0.01)).mul(half);
        const s1 = c1.xy.div(max(c1.w, 0.01)).mul(half);
        const dir = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
        const normal = vec2(dir.y.negate(), dir.x);
        const clip = mix(c0, c1, along).toVar();
        const widthPx = max(tint.w.div(max(clip.w, 1.0).mul(u.pixelAngle)), 1.2).mul(alive);
        const lead = dir.mul(along.sub(0.5).mul(2.0)).mul(widthPx);
        const ageK = clamp(t.div(max(span, 0.01)), 0.0, 1.0);
        const fade = float(1.0).sub(ageK).mul(float(1.0).sub(ageK));
        const glitter = sin(t.mul(tint.w.mul(31.0).add(17.0)).add(birth.x.mul(13.0))).mul(0.3).add(0.7);
        // White as it leaves, its own colour as it cools.
        const hot = mix(vec3(1.0, 0.97, 1.0), tint.rgb, smoothstep(0.0, 0.3, ageK));
        vLight.assign(vec4(hot.mul(fade).mul(glitter).mul(alive).mul(4.2)
            .mul(u.breath), 1.0));
        return vec4(
            clip.xy.add(normal.mul(positionGeometry.y.mul(2.0).mul(widthPx)).add(lead).div(half).mul(clip.w)),
            clip.z,
            clip.w,
        );
    })();
    material.colorNode = Fn(() => {
        const st = uv();
        const across = float(1.0).sub(abs(st.y.sub(0.5)).mul(2.0));
        const tail = smoothstep(0.0, 0.8, st.x);
        return vec4(vLight.xyz.mul(across.mul(across)).mul(tail), 0.0);
    })();

    const part = vsPart('VoltageStormSparks', geometry, material, 45);
    let cursor = 0;
    let bursts = 0;
    /**
     * Throw `n` sparks from a world point at `time` (which may be a moment ahead): out in every
     * direction round the vertical at `out` = (min, max) m/s, lifted by up to `lift` of that.
     */
    part.emit = ({
        x, y, z, n, rgb, time, out = [18, 70], lift = 0.9, life = [0.45, 1.2], size = 0.3, stagger = 0,
    }) => {
        const rand = mulberry32(0x51a7 + bursts * 7919);
        bursts += 1;
        const total = Math.min(Math.max(0, Math.round(n)), count);
        for (let j = 0; j < total; j++) {
            const i = cursor % count;
            cursor += 1;
            const bearing = rand() * TAU;
            const speed = out[0] + (out[1] - out[0]) * rand() ** 1.7;
            const rise = (rand() * 1.5 - 0.35) * lift * speed;
            aBirth.set([x, y, z, time + rand() * stagger], i * 4);
            aVel.set([
                Math.cos(bearing) * speed, rise, Math.sin(bearing) * speed * 0.55,
                life[0] + (life[1] - life[0]) * rand(),
            ], i * 4);
            const g = 0.7 + rand() * 0.6;
            aTint.set([rgb[0] * g, rgb[1] * g, rgb[2] * g, size * (0.55 + rand() * 0.9)], i * 4);
        }
        if (total > 0) {
            geometry.getAttribute('aBirth').needsUpdate = true;
            geometry.getAttribute('aVel').needsUpdate = true;
            geometry.getAttribute('aTint').needsUpdate = true;
        }
        return total;
    };
    part.reset = () => {
        for (let i = 0; i < count; i++) aBirth[i * 4 + 3] = -100;
        geometry.getAttribute('aBirth').needsUpdate = true;
        cursor = 0;
        bursts = 0;
    };
    part.count = count;
    return part;
}
