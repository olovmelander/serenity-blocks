/**
 * Cinder Drift — gameplay effects that are their own geometry.
 *
 *  - Spatter: drops of lava. A lock throws a crown of them from where it strikes the lake and a
 *    spray of sparks from the edge of the card; a fountain is a few hundred of them staggered
 *    over its life. Each is a streak along its own ballistic path that cools from white through
 *    gold and red as it flies, lands on the crust and lies there glowing until it is out.
 *    Sparks are the same thing made light: they rise instead of falling.
 *  - Bombs: a four-line clear throws clots of lava across the chamber. Each is a white-hot head
 *    and a string of embers strung along the arc behind it.
 *  - Row jets: the cleared rows leave the card as tongues of fire at their own heights, drawn
 *    in screen space so they line up with the rows exactly.
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
    length,
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
import { flashScale } from '../../utils/photosensitivity.js';
import {
    BOMB_SLOTS, BOMB_TAIL, GRAVITY, TAU, cdFxMaterial, cdHeatColor, cdPart, cdQuadGeometry, mulberry32,
} from './cinder-drift-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

/**
 * Forked volcanic lightning above the lava banks. The leader grows once through the ash,
 * holds incandescent, then the branches cool together. Each segment is one small quad.
 */
export function createAshLightning(u, quality) {
    const lean = quality === 'Minimal' || quality === 'Low';
    const steps = lean ? 16 : 32;
    const perBolt = steps * 2;
    const slots = 4; // a second perfect clear can overlap both banks of the first
    const capacity = perBolt * slots;
    const starts = new Float32Array(capacity * 4);
    const ends = new Float32Array(capacity * 4);
    const strokes = new Float32Array(capacity * 4);
    const geometry = cdQuadGeometry(capacity, { aLeader: [starts, 4], aTip: [ends, 4], aStroke: [strokes, 4] });
    const attrs = ['aLeader', 'aTip', 'aStroke'].map((key) => geometry.getAttribute(key).setUsage(THREE.DynamicDrawUsage));
    const a = attribute('aLeader', 'vec4');
    const b = attribute('aTip', 'vec4');
    const stroke = attribute('aStroke', 'vec4');
    const material = cdFxMaterial('CinderAshLightning');
    const age = u.time.sub(a.w);
    const fade = smoothstep(0.0, 0.11, age).mul(float(1).sub(smoothstep(-0.72, 0.0, u.time.sub(b.w))));
    const along = positionGeometry.x.add(0.5);
    const edge = mix(stroke.xy, stroke.zw, along);
    const show = step(0.001, fade.mul(edge.y));
    const p0 = viewProjection(a.xyz);
    const p1 = viewProjection(b.xyz);
    const half = u.viewport.mul(0.5);
    const delta = p1.xy.div(max(0.1, p1.w)).sub(p0.xy.div(max(0.1, p0.w))).mul(half);
    const dir = delta.div(max(length(delta), 0.001));
    const clip = mix(p0, p1, along.mul(smoothstep(0.0, 0.08, age)));
    const screenWidth = u.viewport.y.mul(edge.x).mul(show);
    const offset = vec2(dir.y.negate(), dir.x).mul(positionGeometry.y.mul(2))
        .add(dir.mul(positionGeometry.x).mul(0.12)).mul(screenWidth);
    material.vertexNode = vec4(clip.xy.add(offset.div(half).mul(clip.w)), clip.z, clip.w);
    const intensity = varying(edge.y.mul(fade), 'cdLeaderIntensity');
    material.colorNode = Fn(() => {
        const d = abs(uv().y.mul(2).sub(1)).toVar();
        const d2 = d.mul(d).toVar();
        const core = exp(d2.mul(-37)).mul(vec3(3.85, 3.05, 2.06));
        const sheath = exp(d2.mul(-7.2)).mul(vec3(0.68, 0.40, 0.95));
        return vec4(core.add(sheath).mul(intensity).mul(float(1).sub(smoothstep(0.66, 1.0, d))), 0);
    })();
    const part = cdPart('CinderAshLightning', geometry, material, 35);
    const spent = new Float64Array(slots).fill(-Infinity);
    const xs = new Float64Array(steps + 1);
    const ys = new Float64Array(steps + 1);
    const previous = [0, 0, 0];
    let strikes = 0;
    let lastGlow = -Infinity;

    part.strike = (world, time) => {
        const rng = mulberry32(0x5c4a3b + 9187 * strikes++);
        const { aspect } = world;
        const motion = world.reducedMotion ? 0.66 : 1;
        const gain = flashScale() * motion;
        for (const side of [-1, 1]) {
            const room = world.bankRoom(side);
            if (room < 0.035) continue;
            const inset = room * 0.09;
            const xMin = side < 0 ? inset : 1 - room + inset;
            const xMax = side < 0 ? room - inset : 1 - inset;
            const sx = (fraction) => xMin + (xMax - xMin) * (side < 0 ? fraction : 1 - fraction);
            const height = Math.min(1, 0.45 + room * aspect) * motion;
            const sy = (fraction) => 0.33 + (fraction - 0.33) * height;
            const start = time + (side < 0 ? 0.1 : 0.29);
            const finish = start + 1.81 + rng() * 0.25;
            const depth = side < 0 ? 24 : 14;
            let slot = 0;
            for (let i = 1; i < slots; i++) if (spent[i] < spent[slot]) slot = i;
            spent[slot] = finish;
            lastGlow = Math.max(lastGlow, finish);
            const first = slot * perBolt;
            let index = first;
            strokes.fill(0, first * 4, (first + perBolt) * 4);
            // Subdivided paths keep their larger kinks. Smaller forks come directly off
            // an actual parent vertex so the conducting channel stays connected.
            const channel = (x0, y0, x1, y1, n, width, light, born, travel) => {
                xs[0] = x0;
                ys[0] = y0;
                xs[n] = x1;
                ys[n] = y1;
                for (let stride = n; stride >= 2; stride /= 2) {
                    for (let i = 0; i < n; i += stride) {
                        const j = i + stride;
                        const m = i + stride / 2;
                        const r = (rng() - 0.5) * 0.83;
                        const x = (xs[i] + xs[j]) * 0.5 - ((ys[j] - ys[i]) * r) / aspect;
                        xs[m] = Math.max(xMin, Math.min(xMax, x));
                        ys[m] = (ys[i] + ys[j]) * 0.5 + (xs[j] - xs[i]) * r * aspect;
                    }
                }
                world.screenToWorld(xs[0], ys[0], depth, previous);
                const feather = (f) => {
                    const taper = Math.min(1, (1 - f) * 3.8, n === steps ? f * 12 : 1);
                    return taper * taper * (3 - 2 * taper);
                };
                for (let i = 1; i <= n; i++, index++) {
                    const tip = world.screenToWorld(xs[i], ys[i], depth);
                    const f = (i - 1) / n;
                    starts.set([previous[0], previous[1], previous[2], born + f * travel], index * 4);
                    ends.set([tip[0], tip[1], tip[2], finish], index * 4);
                    const fEnd = i / n;
                    const w0 = feather(f);
                    const w1 = feather(fEnd);
                    strokes.set([
                        width * (1 - 0.4 * f) * w0, light * gain * w0,
                        width * (1 - 0.4 * fEnd) * w1, light * gain * w1,
                    ], index * 4);
                    previous[0] = tip[0];
                    previous[1] = tip[1];
                    previous[2] = tip[2];
                }
            };
            const jitter = rng() * 0.04;
            channel(sx(0.19), sy(0.29 + jitter), sx(0.88), sy(0.17 + jitter), steps, 0.0095, 1.23, start, 0.4);
            // Save the later fork before the first branch takes the scratch path.
            const forkX = xs[(steps * 3) / 4];
            const forkY = ys[(steps * 3) / 4];
            channel(xs[steps / 4], ys[steps / 4], sx(0.58), sy(0.49), steps / 2, 0.0063, 0.82, start + 0.13, 0.37);
            channel(forkX, forkY, sx(0.97), sy(0.33), steps / 4, 0.0042, 0.71, start + 0.30, 0.26);
            attrs.forEach((attr) => markSpatterSlots(attr, first, perBolt, capacity));
            geometry.instanceCount = Math.max(geometry.instanceCount, index);
        }
    };
    part.update = (time) => {
        if (time > lastGlow) geometry.instanceCount = 1;
    };
    part.reset = () => {
        geometry.instanceCount = 1; // warm one collapsed quad even before the first crown
        strokes.fill(0);
        attrs[2].clearUpdateRanges();
        attrs[2].addUpdateRange(0, strokes.length);
        attrs[2].needsUpdate = true;
        spent.fill(-Infinity);
        strikes = 0;
        lastGlow = -Infinity;
    };
    part.reset();
    return part;
}

// ── Spatter ─────────────────────────────────────────────────────────────────────

/** A drop at rest lies this high on the crust. */
const REST_Y = 0.05;
/** How many drops not yet thrown a new burst passes over, at most, for each slot it takes. */
const SKIP_UNBORN = 48;

/**
 * Height of a drop `tau` seconds after it leaves `y0` at `vy` m/s under `gravity` with `drag`.
 * CPU twin of the shader.
 */
export function dropHeight(y0, vy, tau, gravity = GRAVITY, drag = 0.35) {
    const h = (1 - Math.exp(-tau * drag)) / drag;
    return Math.max(REST_Y, y0 + vy * h - 0.5 * gravity * tau * tau);
}

/**
 * Upload only the `total` slots a burst wrote from `first` on (wrapping a pool of `count`), not
 * the whole pool: the pool is hundreds of KB, a burst a few dozen slots. Ranges add up until the
 * next upload; past a few dozen (a pool not drawn for a while) the whole pool goes up instead.
 */
export function markSpatterSlots(pool, first, total, count) {
    const { itemSize } = pool;
    const head = Math.min(total, count - first);
    pool.addUpdateRange(first * itemSize, head * itemSize);
    if (total > head) pool.addUpdateRange(0, (total - head) * itemSize);
    if (pool.updateRanges.length > 32) {
        pool.clearUpdateRanges();
        pool.addUpdateRange(0, count * itemSize);
    }
    pool.needsUpdate = true;
}

/**
 * @param {object} u
 * @param {number} count  pool size
 */
export function createSpatter(u, count) {
    const aBirth = new Float32Array(count * 4);
    const aVel = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    const aPhys = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        aBirth[i * 4 + 3] = -100;
        aVel[i * 4 + 3] = 1;
        aPhys.set([GRAVITY, 0.35, 1, 0], i * 4);
    }
    const geometry = cdQuadGeometry(count, {
        aBirth: [aBirth, 4], aVel: [aVel, 4], aTint: [aTint, 4], aPhys: [aPhys, 4],
    });
    const names = ['aBirth', 'aVel', 'aTint', 'aPhys'];
    names.forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const birth = attribute('aBirth', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const tint = attribute('aTint', 'vec4');
    const phys = attribute('aPhys', 'vec4');

    const material = cdFxMaterial('CinderSpatter');
    const tau = u.time.sub(birth.w);
    const span = vel.w;
    const alive = step(0.0, tau).mul(step(tau, span));
    const at = (t) => {
        const h = float(1.0).sub(exp(t.mul(phys.y).negate())).div(phys.y);
        return vec3(
            birth.x.add(vel.x.mul(h)),
            max(birth.y.add(vel.y.mul(h)).sub(t.mul(t).mul(phys.x).mul(0.5)), REST_Y),
            birth.z.add(vel.z.mul(h)),
        );
    };
    // A streak from where the drop was a moment ago to where it is.
    const t = max(tau, 0.0);
    const p1 = at(t);
    const p0 = at(max(t.sub(0.075), 0.0));
    const along = positionGeometry.x.add(0.5);
    const c0 = viewProjection(p0);
    const c1 = viewProjection(p1);
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(c0.w).mul(half);
    const s1 = c1.xy.div(c1.w).mul(half);
    const dir = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(dir.y.negate(), dir.x);
    const clip = mix(c0, c1, along);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    const widthPx = max(tint.w.mul(pxPerMetre), u.viewport.y.mul(0.0016)).mul(alive);
    const lead = dir.mul(along.sub(0.5).mul(2.0)).mul(widthPx);
    material.vertexNode = vec4(
        clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).add(lead).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );
    // It leaves the lake white and cools as it flies; `phys.z` is how hot it started.
    const ageK = clamp(t.div(max(span, 0.01)), 0.0, 1.0);
    const temp = phys.z.mul(float(1.0).sub(ageK.mul(0.86)));
    const fade = float(1.0).sub(smoothstep(0.7, 1.0, ageK));
    const vLight = varying(cdHeatColor(u, temp).mul(tint.rgb).mul(fade).mul(alive)
        .mul(u.breath.mul(0.7).add(0.3))
        .mul(1.9), 'cdSpat');
    material.colorNode = Fn(() => {
        const st = uv();
        const across = float(1.0).sub(abs(st.y.sub(0.5)).mul(2.0));
        // A hot head, a tail that thins behind it.
        const tail = st.x.mul(st.x).mul(smoothstep(1.0, 0.86, st.x));
        return vec4(vLight.mul(across.mul(across)).mul(tail), 0.0);
    })();

    const part = cdPart('CinderSpatter', geometry, material, 32);
    let cursor = 0;
    let bursts = 0;
    /**
     * The world's clock (it keeps this current): a drop born after it has not been thrown yet (a
     * fountain staggers its drops over its life), and a new burst passes over it rather than
     * taking its slot, so what follows a curtain of fire does not thin its fountains out.
     */
    part.clock = 0;
    /**
     * Throw `n` drops from a world point at `time` (which may be ahead). `out` / `up` = (min,
     * max) speed outward / upward; `aim` = [x, z] biases the throw that way; `stagger` spreads
     * the births over that many seconds (a fountain); `gravity` < 0 makes sparks that rise.
     */
    part.emit = ({
        x, y, z, n, rgb = null, time, out = [1, 5], up = [2, 7], life = [0.9, 2.0], size = 0.05, stagger = 0,
        heat = 1.45, gravity = GRAVITY, drag = 0.35, aim = null, spread = 0, heightSpread = 0,
        fan = null, spiral = null,
    }) => {
        const rand = mulberry32(0x51a7 + bursts * 7919);
        bursts += 1;
        const total = Math.min(Math.max(0, Math.round(n)), count);
        const first = cursor % count;
        const start = cursor;
        for (let k = 0; k < total; k++) {
            // Pass over drops not yet thrown (a bounded look: a pool full of them is overwritten).
            for (let look = 0; look < SKIP_UNBORN && aBirth[(cursor % count) * 4 + 3] > part.clock; look++) cursor += 1;
            const i = cursor % count;
            cursor += 1;
            const a = rand() * TAU;
            const speed = out[0] + (out[1] - out[0]) * rand() ** 1.6;
            let vx = Math.sin(a) * speed;
            let vz = Math.cos(a) * speed;
            if (aim) {
                vx = vx * 0.45 + aim[0] * speed;
                vz = vz * 0.45 + aim[1] * speed;
            }
            let sx = spread ? (rand() - 0.5) * spread : 0;
            let sz = spread ? (rand() - 0.5) * spread : 0;
            const sy = heightSpread ? rand() * heightSpread : 0;
            let phase = rand();
            if (spiral) {
                // The turning crust sheds a continuous winding scar, each grain leaving
                // tangent to the turn at that particular place and instant.
                phase = (k + phase) / total;
                const angle = phase * TAU * 1.33 * spiral.sign;
                const radius = spiral.radius * (0.32 + 0.68 * phase);
                sx += Math.cos(angle) * radius;
                sz += Math.sin(angle) * radius;
                vx = -Math.sin(angle) * spiral.sign * speed;
                vz = Math.cos(angle) * spiral.sign * speed;
            }
            aBirth.set([x + sx, y + sy, z + sz, time + phase * stagger], i * 4);
            let vy = up[0] + (up[1] - up[0]) * rand();
            if (fan) {
                // The crown throws bright ribs of different reach from one lip. Sharing a
                // bearing keeps each rib together as gravity draws its tip back to the lake.
                const rib = (k % 7) / 3 - 1;
                const angle = rib * fan.angle + (rand() - 0.5) * 0.05;
                const lateral = Math.sin(angle) * vy;
                vx = vx * 0.12 + fan.right.x * lateral;
                vz = vz * 0.12 + fan.right.z * lateral;
                vy *= Math.cos(angle);
            }
            aVel.set([vx, vy, vz, life[0] + (life[1] - life[0]) * rand()], i * 4);
            const g = 0.75 + rand() * 0.5;
            const c = rgb || [1, 1, 1];
            aTint.set([c[0] * g, c[1] * g, c[2] * g, size * (0.5 + rand() * 1.0)], i * 4);
            aPhys.set([gravity, Math.max(0.02, drag), heat * (0.8 + rand() * 0.4), 0], i * 4);
        }
        // (What was passed over goes up with what was written: one range.)
        const written = Math.min(cursor - start, count);
        if (total > 0) names.forEach((name) => markSpatterSlots(geometry.getAttribute(name), first, written, count));
        return total;
    };
    part.reset = () => {
        for (let i = 0; i < count; i++) aBirth[i * 4 + 3] = -100;
        // Every slot changed: the whole pool goes up, whatever bursts follow in the same frame.
        const births = geometry.getAttribute('aBirth');
        births.clearUpdateRanges();
        births.addUpdateRange(0, count * 4);
        births.needsUpdate = true;
        cursor = 0;
        bursts = 0;
    };
    part.count = count;
    return part;
}

// ── Bombs ───────────────────────────────────────────────────────────────────────

/** Seconds of flight the last ember of a bomb's tail runs behind its head. */
const BOMB_LAG = 0.5;

/** Where a bomb is `tau` seconds into its flight. CPU twin of the shader. */
export function bombPoint(from, velocity, tau, out = [0, 0, 0]) {
    out[0] = from[0] + velocity[0] * tau;
    out[1] = from[1] + velocity[1] * tau - 0.5 * GRAVITY * tau * tau;
    out[2] = from[2] + velocity[2] * tau;
    return out;
}

/** @param {object} u */
export function createBombs(u) {
    const count = BOMB_SLOTS * BOMB_TAIL;
    const aFrom = new Float32Array(count * 4);
    const aVel = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        aFrom[i * 4 + 3] = -100;
        aVel[i * 4 + 3] = 1;
        // (The fourth float of the tint is this ember's place in the tail: 0 = the head.)
        aTint[i * 4 + 3] = (i % BOMB_TAIL) / (BOMB_TAIL - 1);
    }
    const geometry = cdQuadGeometry(count, { aFrom: [aFrom, 4], aVel: [aVel, 4], aTint: [aTint, 4] });
    ['aFrom', 'aVel', 'aTint'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const from = attribute('aFrom', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = cdFxMaterial('CinderBombs');
    const lag = tint.w;
    const raw = u.time.sub(from.w).sub(lag.mul(BOMB_LAG));
    const flight = vel.w;
    const tau = clamp(raw, 0.0, flight);
    const world = vec3(
        from.x.add(vel.x.mul(tau)),
        max(from.y.add(vel.y.mul(tau)).sub(tau.mul(tau).mul(GRAVITY * 0.5)), 0.05),
        from.z.add(vel.z.mul(tau)),
    );
    const alive = step(0.0, raw).mul(step(raw, flight));
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    // The head is a clot of lava the size of a boulder; the tail thins to sparks.
    const metres = mix(float(0.62), float(0.1), lag);
    const px = clamp(metres.mul(pxPerMetre), u.viewport.y.mul(0.0022), u.viewport.y.mul(0.06)).mul(alive);
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const temp = mix(float(1.7), float(0.55), lag).sub(tau.div(max(flight, 0.1)).mul(0.25));
    const vLight = varying(cdHeatColor(u, temp).mul(tint.rgb).mul(alive).mul(mix(float(1.0), float(0.45), lag)), 'cdBomb');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const core = exp(d.mul(d).mul(-6.0)).add(exp(d.mul(-3.6)).mul(0.22));
        return vec4(vLight.mul(core).mul(smoothstep(1.0, 0.72, d)), 0.0);
    })();

    const part = cdPart('CinderBombs', geometry, material, 34);
    /** When each slot's bomb (and the last ember of its tail) is down. */
    const down = new Float64Array(BOMB_SLOTS).fill(-Infinity);
    /**
     * Throw a bomb from `from` with `velocity` at `time`; it flies for `flight` seconds. It takes
     * the slot whose bomb comes down first (one already down, if any): a second volley never
     * erases the first mid-arc while there is room.
     */
    part.launch = ({
        from: p0, velocity, time, flight: span, rgb = [1, 1, 1],
    }) => {
        let slot = 0;
        for (let i = 1; i < BOMB_SLOTS; i++) if (down[i] < down[slot]) slot = i;
        down[slot] = time + span + BOMB_LAG;
        for (let j = 0; j < BOMB_TAIL; j++) {
            const i = slot * BOMB_TAIL + j;
            aFrom.set([p0[0], p0[1], p0[2], time], i * 4);
            aVel.set([velocity[0], velocity[1], velocity[2], span], i * 4);
            aTint.set([rgb[0], rgb[1], rgb[2]], i * 4);
        }
        ['aFrom', 'aVel', 'aTint'].forEach((name) => {
            geometry.getAttribute(name).needsUpdate = true;
        });
        return slot;
    };
    part.reset = () => {
        for (let i = 0; i < count; i++) aFrom[i * 4 + 3] = -100;
        geometry.getAttribute('aFrom').needsUpdate = true;
        down.fill(-Infinity);
    };
    part.count = count;
    return part;
}

// ── Flashes ─────────────────────────────────────────────────────────────────────

/** Bursts of light alive at once: a lock's strike, a bomb landing, a fissure cracking open. */
export const FLASH_SLOTS = 24;
/** Seconds a flash takes to fall to 1/e. */
export const FLASH_FADE = 0.15;

/**
 * The instant something strikes: a ball of light that swells and is gone, with the thin
 * horizontal flare a lens draws through anything that bright.
 * @param {object} u
 */
export function createFlashes(u) {
    const aAt = new Float32Array(FLASH_SLOTS * 4);
    const aTint = new Float32Array(FLASH_SLOTS * 4);
    for (let i = 0; i < FLASH_SLOTS; i++) aAt[i * 4 + 3] = -100;
    const geometry = cdQuadGeometry(FLASH_SLOTS, { aAt: [aAt, 4], aTint: [aTint, 4] });
    ['aAt', 'aTint'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const at = attribute('aAt', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = cdFxMaterial('CinderFlashes', { depthTest: false });
    const raw = u.time.sub(at.w);
    const age = max(raw, 0.0);
    const env = exp(age.div(-FLASH_FADE)).mul(step(0.0, raw)).mul(float(1.0).sub(smoothstep(0.6, 0.9, age)));
    const clip = viewProjection(at.xyz);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    const swell = age.mul(2.6).add(0.55);
    const px = clamp(tint.w.mul(swell).mul(pxPerMetre), u.viewport.y.mul(0.006), u.viewport.y.mul(0.2)).mul(step(1e-3, env));
    // (Twice as wide as tall: room for the flare.)
    material.vertexNode = vec4(
        clip.xy.add(positionGeometry.xy.mul(vec2(4.0, 2.0)).mul(px).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );
    const vLight = varying(tint.rgb.mul(env).mul(u.breath.mul(0.6).add(0.4)), 'cdFlash');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(vec2(4.0, 2.0));
        const d = length(q);
        const ball = exp(d.mul(d).mul(-7.0)).mul(1.6).add(exp(d.mul(-3.4)).mul(0.24));
        const flare = exp(abs(q.y).mul(-26.0)).mul(exp(abs(q.x).mul(-1.9))).mul(0.5);
        const edge = float(1.0).sub(smoothstep(0.8, 1.0, abs(q.y))).mul(float(1.0).sub(smoothstep(1.6, 2.0, abs(q.x))));
        return vec4(vLight.mul(ball.add(flare)).mul(edge), 0.0);
    })();

    const part = cdPart('CinderFlashes', geometry, material, 36);
    let cursor = 0;
    /** A burst of light `size` metres across at a world point at `time` (which may be ahead). */
    part.fire = ({
        x, y, z, time, rgb, size = 1.5, gain = 1,
    }) => {
        const i = cursor % FLASH_SLOTS;
        cursor += 1;
        aAt.set([x, y, z, time], i * 4);
        aTint.set([rgb[0] * gain, rgb[1] * gain, rgb[2] * gain, size], i * 4);
        geometry.getAttribute('aAt').needsUpdate = true;
        geometry.getAttribute('aTint').needsUpdate = true;
        return i;
    };
    part.reset = () => {
        for (let i = 0; i < FLASH_SLOTS; i++) aAt[i * 4 + 3] = -100;
        geometry.getAttribute('aAt').needsUpdate = true;
        cursor = 0;
    };
    part.count = FLASH_SLOTS;
    return part;
}

// ── Row jets ────────────────────────────────────────────────────────────────────

export const JET_ROWS = 4;
/** Seconds a jet takes to reach its full length, the time it holds, and its fade. */
export const JET_TRAVEL = 0.1;
export const JET_HOLD = 0.2;
export const JET_FADE = 0.2;
/** How far a jet reaches out of the card, as a fraction of the screen's width. */
export const JET_REACH = 0.17;

/** Sets of row jets: a cascade's next wave fires the other set while the last one burns away. */
export const JET_SETS = 2;
/** Seconds after its birth a set of jets has burnt away (it may be fired again without a cut). */
const JET_SPENT = JET_TRAVEL + JET_HOLD + JET_FADE * 3;

/**
 * Screen-space strips: one from each side of the card for up to four cleared rows, in JET_SETS
 * sets, so a cascade's waves follow one another out of the card instead of the newest snapping
 * the last back into it.
 */
export function createRowJets(u) {
    const perSet = JET_ROWS * 2;
    const count = perSet * JET_SETS;
    const aRow = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const j = i % perSet;
        aRow.set([Math.floor(j / 2), j % 2 ? 1 : -1, Math.floor(i / perSet)], i * 3);
    }
    const geometry = cdQuadGeometry(count, { aRow: [aRow, 3] });
    const row = attribute('aRow', 'vec3');
    const makeSet = () => ({
        /** Screen y (fractions, y down) of up to four rows; < 0 = unused. */
        rows: uniform(new THREE.Vector4(-1, -1, -1, -1)),
        /** (card x0, card x1, birth time, strength) */
        frame: uniform(new THREE.Vector4(0.4, 0.6, -100, 0)),
        /** How hot the jet burns: 1 = a single line, 1.6 = four. */
        heat: uniform(1),
    });
    const sets = Array.from({ length: JET_SETS }, makeSet);
    // (Two sets: a mix on the set index picks this strip's.)
    const second = step(0.5, row.z);
    const rows4 = mix(sets[0].rows, sets[1].rows, second);
    const frame4 = mix(sets[0].frame, sets[1].frame, second);
    const material = cdFxMaterial('CinderRowJets', { depthTest: false });
    const rowY = mix(mix(rows4.x, rows4.y, step(0.5, row.x)), mix(rows4.z, rows4.w, step(2.5, row.x)), step(1.5, row.x));
    // Once the tongue burns away, collapse the strip so the noise samples stop with it.
    const elapsed = u.time.sub(frame4.z);
    const used = step(0.0, rowY).mul(step(0.001, frame4.w)).mul(step(0.0, elapsed)).mul(step(elapsed, JET_SPENT));
    const along = positionGeometry.x.add(0.5);
    // From the card's edge outward.
    const edge = mix(frame4.x, frame4.y, step(0.0, row.y));
    const sx = edge.add(row.y.mul(JET_REACH).mul(along));
    // (The strip is far taller than the row: a flame is not a ruled line.)
    const thickness = float(0.13);
    const sy = rowY.add(positionGeometry.y.mul(thickness));
    material.vertexNode = vec4(sx.mul(2.0).sub(1.0).mul(used), float(1.0).sub(sy.mul(2.0)).mul(used), 0.0, 1.0);
    // (The set's birth, strength and heat ride to the fragment with the strip.)
    const vAlong = varying(vec2(along, row.x.mul(1.7).add(row.y.mul(0.37)).add(row.z.mul(5.3))), 'cdJetT');
    const vSet = varying(vec3(frame4.z, frame4.w, mix(sets[0].heat, sets[1].heat, second)), 'cdJetSet');
    material.colorNode = Fn(() => {
        const a = vAlong.x;
        const seed = vAlong.y;
        const raw = u.time.sub(vSet.x);
        const age = max(raw, 0.0);
        const dy = uv().y.sub(0.5).mul(2.0);
        // A tongue of fire: fat where it leaves the card, torn along its edges, a tip that licks.
        const lick = u.noise(vec2(a.mul(0.9).sub(age.mul(3.6)).add(seed), dy.mul(0.16).add(seed.mul(3.0)))).r;
        const curl = u.noise(vec2(a.mul(2.6).sub(age.mul(6.5)).add(seed.mul(5.0)), dy.mul(0.45).add(lick.mul(0.5)))).g;
        // It shoots out, holds, then lets go of the card and burns away outward.
        const head = age.div(JET_TRAVEL);
        const root = max(age.sub(JET_HOLD), 0.0).div(JET_FADE);
        const length01 = clamp(a.div(max(head.min(1.0), 1e-3)), 0.0, 1.0);
        const taper = float(1.0).sub(length01).pow(0.7).mul(smoothstep(0.0, 0.1, a).mul(0.55).add(0.45));
        const girth = taper.mul(lick.mul(0.9).add(0.35)).mul(0.8).add(0.02);
        // Fire rises: the tongue curls upward as it leaves the card.
        const bend = dy.add(a.mul(a).mul(0.55)).add(lick.sub(0.5).mul(0.36).mul(a)).add(curl.sub(0.5).mul(0.2).mul(a.add(0.2)));
        const d = abs(bend).div(girth);
        const body = float(1.0).sub(smoothstep(0.45, 1.0, d)).mul(step(a, head)).mul(smoothstep(root.sub(0.25), root.add(0.05), a))
            .mul(step(0.0, raw));
        const core = float(1.0).sub(smoothstep(0.0, 0.6, d));
        const env = exp(root.mul(-1.6));
        // Gold in its throat, orange along its body, red where it tears away.
        const temp = float(0.52).add(core.mul(0.42)).add(float(1.0).sub(a).mul(0.3)).add(curl.sub(0.5).mul(0.5))
            .mul(vSet.z);
        return vec4(cdHeatColor(u, temp).mul(body.mul(env).mul(vSet.y)).mul(0.6), 0.0);
    })();
    const part = cdPart('CinderRowJets', geometry, material, 60);
    part.sets = sets;
    /** The set fired last (its uniforms: rows, frame, heat). */
    part.uniforms = sets[0];
    /**
     * `ys` = screen y of each cleared row; `x0`/`x1` = the card's edges; all in screen fractions.
     * It fires the set that has burnt away (or the older one): the jets still burning finish.
     */
    part.fire = (ys, x0, x1, time, strength = 1, heat = 1) => {
        let set = sets[0];
        for (let i = 1; i < JET_SETS; i++) {
            const age = time - sets[i].frame.value.z;
            const best = time - set.frame.value.z;
            if (best < JET_SPENT && (age >= JET_SPENT || sets[i].frame.value.z < set.frame.value.z)) set = sets[i];
        }
        set.rows.value.set(ys[0] ?? -1, ys[1] ?? -1, ys[2] ?? -1, ys[3] ?? -1);
        set.frame.value.set(x0, x1, time, strength);
        set.heat.value = heat;
        part.uniforms = set;
    };
    part.reset = () => {
        sets.forEach((set) => set.frame.value.set(0.4, 0.6, -100, 0));
        part.uniforms = sets[0];
    };
    return part;
}
