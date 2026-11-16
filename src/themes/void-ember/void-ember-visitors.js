/**
 * Void Ember — visitors: what crosses the void on its own.
 *
 *  - Meteors: falling stars far out in the void, each a streak that brightens, flares once and
 *    goes out. One crosses every quarter of a minute or so, somewhere new; a level-up sends a
 *    shower of them out of one radiant, in the colour the void is turning to.
 *  - The wanderer: a comet that crosses the far sky every few minutes on a path of its own, never
 *    the same twice. Its two tails point away from the ember: a broad one of dust, bowed, lit in
 *    the ember's own colour, and a thin straight one of gas in the void's cold light.
 *
 * Both are far behind the belt (the depth test hides them behind the star, the stones and the
 * cinder world), both are closed forms of the clock, and a dormant slot has no size.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    exp,
    float,
    max,
    mix,
    normalize,
    positionGeometry,
    smoothstep,
    step,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    veFxMaterial, vePart, veQuadGeometry,
} from './void-ember-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

/** How far out the visitors are drawn (inside the sky's dome, behind everything else). */
export const VISITOR_RANGE = 2400;

// ── Meteors ─────────────────────────────────────────────────────────────────────

export const METEOR_SLOTS = 48;
/** The share of its path a meteor's streak covers. */
export const METEOR_TRAIL = 0.3;

/**
 * Where a meteor is, as a direction from the eye, `k` of the way along its path (0..1).
 * `start` and `travel` are unit vectors square to each other; `arc` is the path's length in
 * radians. CPU twin of the vertex stage.
 */
export function meteorDirection(start, travel, arc, k, out = [0, 0, 0]) {
    const s = arc * k;
    let x = start[0] + travel[0] * s;
    let y = start[1] + travel[1] * s;
    let z = start[2] + travel[2] * s;
    const l = Math.hypot(x, y, z) || 1;
    x /= l;
    y /= l;
    z /= l;
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
}

/** @param {object} u shared uniforms */
export function createMeteors(u) {
    const count = METEOR_SLOTS;
    const aPath = new Float32Array(count * 4);
    const aRun = new Float32Array(count * 4);
    const aLook = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        aPath.set([0, 0, -1, -100], i * 4);
        aRun.set([1, 0, 0, 1], i * 4);
        aLook.set([1, 1, 1, 0], i * 4);
    }
    const geometry = veQuadGeometry(count, { aPath: [aPath, 4], aRun: [aRun, 4], aLook: [aLook, 4] });
    const names = ['aPath', 'aRun', 'aLook'];
    names.forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const path = attribute('aPath', 'vec4');
    const run = attribute('aRun', 'vec4');
    const look = attribute('aLook', 'vec4');
    /** (arc in radians, size) of each slot, packed in the two spare lanes. */
    const arc = run.w;

    const material = veFxMaterial('VoidEmberMeteors');
    const age = u.time.sub(path.w);
    const life = max(look.w, 0.05);
    const k = clamp(age.div(life), 0.0, 1.0);
    const alive = step(0.0, age).mul(step(age, life)).mul(step(0.001, look.w));
    const at = (kk) => cameraPosition.add(normalize(path.xyz.add(run.xyz.mul(arc.mul(kk)))).mul(VISITOR_RANGE));
    const c0 = viewProjection(at(max(k.sub(METEOR_TRAIL), 0.0)));
    const c1 = viewProjection(at(k));
    const along = positionGeometry.x.add(0.5);
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(max(c0.w, 1e-3)).mul(half);
    const s1 = c1.xy.div(max(c1.w, 1e-3)).mul(half);
    const dirS = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(dirS.y.negate(), dirS.x);
    const clip = mix(c0, c1, along);
    // Sized for a 1080-line frame, never under a pixel and a half.
    const widthPx = max(u.viewport.y.mul(0.0032), 1.6).mul(alive);
    const lead = dirS.mul(along.sub(0.5).mul(2.0)).mul(widthPx);
    material.vertexNode = vec4(
        clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).add(lead).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );
    // It brightens, flares once near its end and goes out.
    const d = k.sub(0.74).div(0.075);
    const env = smoothstep(0.0, 0.1, k).mul(float(1.0).sub(smoothstep(0.82, 1.0, k)))
        .mul(exp(d.mul(d).negate()).mul(1.6).add(1.0));
    const vLight = varying(vec4(look.rgb.mul(env).mul(alive), env.mul(alive)), 'veMeteor');
    material.colorNode = Fn(() => {
        const st = uv();
        const across = clamp(float(1.0).sub(abs(st.y.sub(0.5)).mul(2.0)), 0.0, 1.0);
        // A hot white head and a tail of the meteor's own colour thinning behind it.
        const tail = st.x.mul(st.x).mul(st.x);
        const head = smoothstep(0.86, 0.985, st.x).mul(float(1.0).sub(smoothstep(0.985, 1.0, st.x)));
        const light = vLight.rgb.mul(tail.mul(0.8)).add(vec3(1.0, 0.97, 0.92).mul(head).mul(vLight.w).mul(1.5));
        return vec4(light.mul(across.mul(across)).mul(u.breath.mul(0.5).add(0.5)).mul(u.iris), 0.0);
    })();

    const part = vePart('VoidEmberMeteors', geometry, material, 6);
    let cursor = 0;
    /**
     * A meteor from `start` (a unit direction from the eye) along `travel` (a unit vector square
     * to it) over `arc` radians, leaving at `time` and lasting `life` seconds.
     */
    part.fire = ({
        start, travel, arc: length = 0.3, time, life: span = 0.8, rgb = [1, 1, 1], gain = 1,
    }) => {
        const i = cursor % count;
        cursor += 1;
        aPath.set([start[0], start[1], start[2], time], i * 4);
        aRun.set([travel[0], travel[1], travel[2], length], i * 4);
        aLook.set([rgb[0] * gain, rgb[1] * gain, rgb[2] * gain, span], i * 4);
        names.forEach((name) => {
            geometry.getAttribute(name).needsUpdate = true;
        });
        return i;
    };
    part.reset = () => {
        for (let i = 0; i < count; i++) {
            aPath[i * 4 + 3] = -100;
            aLook[i * 4 + 3] = 0;
        }
        names.forEach((name) => {
            geometry.getAttribute(name).needsUpdate = true;
        });
        cursor = 0;
    };
    /** Meteors in flight at `time` (tests, diagnostics). */
    part.flying = (time) => {
        let n = 0;
        for (let i = 0; i < count; i++) {
            const a = time - aPath[i * 4 + 3];
            if (aLook[i * 4 + 3] > 0 && a >= 0 && a <= aLook[i * 4 + 3]) n += 1;
        }
        return n;
    };
    part.count = count;
    return part;
}

// ── The wanderer ────────────────────────────────────────────────────────────────

/** Seconds between two wanderers, and how long one takes to cross. */
export const WANDERER_PERIOD = 150;
export const WANDERER_CROSSING = 64;

/**
 * @param {object} u shared uniforms
 * @param {object} opts
 * @param {boolean} [opts.streaks=true]  the fine streaks in its tails (one noise read)
 */
export function createWanderer(u, { streaks = true } = {}) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = veFxMaterial('VoidEmberWanderer');
    const uniforms = {
        /** (start direction, birth) and (travel direction, arc in radians). */
        path: uniform(new THREE.Vector4(0, 0, -1, -1000)),
        run: uniform(new THREE.Vector4(1, 0, 0, 1)),
        /** (size, how its dust tail bows −1..1, seed, crossing seconds; 0 = none) */
        look: uniform(new THREE.Vector4(1, 0.4, 0, 0)),
    };
    const age = u.time.sub(uniforms.path.w);
    const crossing = max(uniforms.look.w, 1.0);
    const k = clamp(age.div(crossing), 0.0, 1.0);
    const alive = step(0.0, age).mul(step(age, crossing)).mul(step(0.5, uniforms.look.w));
    const world = cameraPosition.add(normalize(uniforms.path.xyz.add(uniforms.run.xyz.mul(uniforms.run.w.mul(k)))).mul(VISITOR_RANGE));
    const cC = viewProjection(world);
    const cS = viewProjection(u.centre);
    const half = u.viewport.mul(0.5);
    const sC = cC.xy.div(max(cC.w, 1e-3)).mul(half);
    const sS = cS.xy.div(max(cS.w, 1e-3)).mul(half);
    // Its tails stream away from the ember.
    const awayS = normalize(sC.sub(sS).add(vec2(1e-3, 0.0)));
    const acrossS = vec2(awayS.y.negate(), awayS.x);
    /** The tail's length and the sheet's half-width, in pixels. */
    const lengthPx = u.viewport.y.mul(0.38).mul(uniforms.look.x).mul(alive);
    const widthPx = lengthPx.mul(0.3);
    const alongT = positionGeometry.x.add(0.5);
    const offset = awayS.mul(alongT.sub(0.12).mul(lengthPx)).add(acrossS.mul(positionGeometry.y.mul(2.0).mul(widthPx)));
    material.vertexNode = vec4(cC.xy.add(offset.div(half).mul(cC.w)), cC.z, cC.w);

    const vK = varying(k, 'veWandererK');
    material.colorNode = Fn(() => {
        const st = uv();
        // Along the tail in tail lengths (0 at the head), across it in sheet half-widths.
        const x = st.x.sub(0.12).div(0.88).toVar();
        const y = st.y.sub(0.5).mul(2.0).toVar();
        const back = max(x, 0.0).toVar();
        // The head: a hard point in a soft coma (the coma is round: the sheet is 0.3 as wide as long).
        const rx = x.mul(0.88 / 0.3);
        const r2 = rx.mul(rx).add(y.mul(y));
        const coma = exp(r2.mul(-900.0)).mul(4.0).add(exp(r2.mul(-90.0)).mul(0.8)).add(exp(r2.sqrt().mul(-9.0)).mul(0.16));
        let grain = float(1.0);
        if (streaks) {
            // Streaks down the tails, each its own length.
            const n = u.noise3(vec3(y.mul(9.0), back.mul(1.3).add(uniforms.look.z), uniforms.look.z.mul(3.0)));
            grain = n.x.mul(1.0).add(0.5);
        }
        // Dust: broad, bowed to one side, and gone by the sheet's end.
        const bow = uniforms.look.y.mul(back).mul(back).mul(0.55);
        const wide = back.mul(0.5).add(0.05);
        const dy = y.sub(bow).div(wide);
        const dust = exp(dy.mul(dy).negate()).mul(exp(back.mul(-2.6))).mul(smoothstep(0.0, 0.03, x)).mul(0.7);
        // Gas: thin and straight, and it reaches further.
        const gy = y.div(back.mul(0.05).add(0.022));
        const gas = exp(gy.mul(gy).negate()).mul(exp(back.mul(-1.5))).mul(smoothstep(0.0, 0.02, x)).mul(0.8);
        const end = float(1.0).sub(smoothstep(0.78, 1.0, back)).mul(float(1.0).sub(smoothstep(0.82, 1.0, abs(y))));
        // It comes out of the dark and goes back into it.
        const show = smoothstep(0.0, 0.14, vK).mul(float(1.0).sub(smoothstep(0.84, 1.0, vK)));
        // Dust in the ember's light, gas in the void's own cold light, the head near white.
        const warm = normalize(u.skyLight.add(vec3(0.3, 0.2, 0.1))).mul(1.5);
        const cold = normalize(u.dustA.add(u.starTint.mul(0.25))).mul(1.6);
        const light = warm.mul(dust.mul(grain)).add(cold.mul(gas.mul(grain))).mul(end)
            .add(vec3(1.0, 0.95, 0.88).mul(coma));
        return vec4(light.mul(show).mul(u.breath.mul(0.5).add(0.5)).mul(u.iris.pow(0.6)), 0.0);
    })();

    const part = vePart('VoidEmberWanderer', geometry, material, 6);
    part.uniforms = uniforms;
    /** Send one across: see createMeteors' fire for `start`, `travel` and `arc`. */
    part.send = ({
        start, travel, arc, time, crossing: seconds = WANDERER_CROSSING, size = 1, bow = 0.4, seed = 0,
    }) => {
        uniforms.path.value.set(start[0], start[1], start[2], time);
        uniforms.run.value.set(travel[0], travel[1], travel[2], arc);
        uniforms.look.value.set(size, bow, seed, seconds);
    };
    part.reset = () => {
        uniforms.path.value.set(0, 0, -1, -1000);
        uniforms.look.value.set(1, 0.4, 0, 0);
    };
    return part;
}
