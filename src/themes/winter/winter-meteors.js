/**
 * Winter — shooting stars.
 *
 * A small pool of streaks on the far sky. Each is thrown once (where it starts, which way it
 * goes over the sky, how far, how long it takes) and its whole flight is closed form in the time
 * since: the head runs out along a great circle and slows, the tail grows behind it and is then
 * drawn in, and the light rises quickly and dies slowly. Nothing is created at event time and
 * dormant slots collapse to nothing, so the pool is always drawn.
 *
 * One falls now and then on its own; a new level sends a shower of them out from one point.
 * They stand at their own depth inside the dome, so the trees and the fells hide them as they
 * hide the sky.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    clamp,
    cos,
    exp,
    float,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    wClip, wFxMaterial, wPart, wQuadGeometry,
} from './winter-tsl.js';

/** How far off the streaks are drawn (metres): beyond the last fell, inside the dome. */
export const METEOR_DEPTH = 22000;
/** Streaks that can be in the sky at once. */
export const METEOR_POOL = 14;

/**
 * Where a streak's head is `k` of its flight in (0..1): the angle it has run of its whole arc. It
 * starts fast and slows, as a stone does in thickening air. CPU twin of the shader.
 */
export const meteorRun = (k) => {
    const c = Math.max(0, Math.min(1, k));
    return 1 - (1 - c) * (1 - c);
};

/**
 * @param {object} u
 * @param {number} [count]
 */
export function createMeteors(u, count = METEOR_POOL) {
    const aFrom = new Float32Array(count * 4);
    const aWay = new Float32Array(count * 4);
    const aLook = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        aFrom.set([0, 1, 0, -100], i * 4);
        aWay.set([1, 0, 0, 0.1], i * 4);
        aLook.set([1, 0, 1, 0], i * 4);
    }
    const geometry = wQuadGeometry(count, { aFrom: [aFrom, 4], aWay: [aWay, 4], aLook: [aLook, 4] });
    ['aFrom', 'aWay', 'aLook'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    // (unit start direction, birth) / (unit direction it goes in, at right angles to the start;
    // the arc it runs, radians) / (seconds it lasts, brightness, width, warmth)
    const from = attribute('aFrom', 'vec4');
    const way = attribute('aWay', 'vec4');
    const look = attribute('aLook', 'vec4');

    const material = wFxMaterial('WinterMeteors');
    const tau = u.time.sub(from.w);
    const lasts = max(look.x, 0.05);
    const k = clamp(tau.div(lasts), 0.0, 1.0);
    const alive = step(0.0, tau).mul(step(tau, lasts)).mul(step(0.001, look.y));
    const ran = float(1.0).sub(float(1.0).sub(k).mul(float(1.0).sub(k)));
    // The tail grows behind the head, then is drawn in as the head slows.
    const tail = way.w.mul(smoothstep(0.0, 0.25, k)).mul(float(1.0).sub(smoothstep(0.55, 1.0, k))).mul(0.42);
    const back = float(0.5).sub(positionGeometry.y);
    const angle = way.w.mul(ran).sub(tail.mul(back));
    const onSky = (a) => normalize(from.xyz.mul(cos(a)).add(way.xyz.mul(sin(a))));
    const centre = cameraPosition.add(onSky(angle).mul(METEOR_DEPTH));
    const ahead = cameraPosition.add(onSky(angle.add(0.004)).mul(METEOR_DEPTH));
    const clip = wClip(centre);
    const clipAhead = wClip(ahead);
    const half = u.viewport.mul(0.5);
    const sc = clip.xy.div(max(clip.w, 1e-3));
    const sa = clipAhead.xy.div(max(clipAhead.w, 1e-3));
    const onScreen = sa.sub(sc).mul(half);
    const along = onScreen.div(max(length(onScreen), 1e-3));
    const across = vec2(along.y.negate(), along.x);
    // A few pixels wide whatever the frame's size.
    const wide = look.z.mul(u.viewport.y.div(1080.0)).mul(3.4).add(1.2);
    const aside = across.mul(positionGeometry.x.mul(wide)).mul(2.0).div(half).mul(alive);
    material.vertexNode = vec4(sc.add(aside).mul(clip.w), clip.z, clip.w);

    const rise = smoothstep(0.0, 0.12, k).mul(float(1.0).sub(smoothstep(0.5, 1.0, k)));
    // (The high cloud dims what is behind it.)
    const clear = float(1.0).sub(u.weather.y.mul(0.55));
    // (And the far range hides what falls behind it.)
    const over = smoothstep(0.2, 0.27, onSky(angle).y);
    const vLight = varying(vec3(rise.mul(look.y).mul(alive).mul(clear).mul(over), look.w, back), 'wMeteor');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const behind = clamp(vLight.z, 0.0, 1.0);
        // A hairline that fades back along the tail, and a small bright head.
        const core = exp(q.x.mul(q.x).mul(-9.0)).mul(exp(behind.mul(-3.6)));
        const head = exp(q.x.mul(q.x).mul(-3.0)).mul(exp(behind.mul(behind).mul(-900.0))).mul(1.6);
        const tone = mix(vec3(0.75, 0.92, 1.0), vec3(1.0, 0.9, 0.72), clamp(vLight.y, 0.0, 1.0));
        // (Green where it burns brightest: oxygen, as in the fires.)
        const hot = mix(tone, vec3(0.6, 1.0, 0.8), behind.mul(0.5));
        return vec4(hot.mul(core.add(head)).mul(vLight.x).mul(3.2).mul(u.breath.mul(0.8).add(0.2)), 0.0);
    })();

    const part = wPart('WinterMeteors', geometry, material, 31);
    let cursor = 0;
    /**
     * Throw one. `bearing` and `elevation` (radians) are where it starts; `heading` (radians) is
     * the way it goes on the sky, 0 = to the right along the horizon, −π/2 = straight down.
     * @returns {number} the slot it took
     */
    part.emit = ({
        bearing, elevation, heading, arc = 0.2, lasts: seconds = 0.9, time, bright = 1, width = 1, warmth = 0.3,
    }) => {
        const i = cursor % count;
        cursor += 1;
        const ce = Math.cos(elevation);
        const start = [Math.sin(bearing) * ce, Math.sin(elevation), -Math.cos(bearing) * ce];
        // The sky's own "right" and "up" at the start.
        const right = [Math.cos(bearing), 0, Math.sin(bearing)];
        const up = [-Math.sin(bearing) * Math.sin(elevation), ce, Math.cos(bearing) * Math.sin(elevation)];
        const ch = Math.cos(heading);
        const sh = Math.sin(heading);
        aFrom.set([start[0], start[1], start[2], time], i * 4);
        aWay.set([right[0] * ch + up[0] * sh, right[1] * ch + up[1] * sh, right[2] * ch + up[2] * sh, arc], i * 4);
        aLook.set([seconds, bright, width, warmth], i * 4);
        ['aFrom', 'aWay', 'aLook'].forEach((name) => {
            geometry.getAttribute(name).needsUpdate = true;
        });
        return i;
    };
    part.reset = () => {
        for (let i = 0; i < count; i++) aFrom[i * 4 + 3] = -100;
        geometry.getAttribute('aFrom').needsUpdate = true;
        cursor = 0;
    };
    part.count = count;
    Object.defineProperty(part, 'thrown', { get: () => cursor });
    return part;
}
