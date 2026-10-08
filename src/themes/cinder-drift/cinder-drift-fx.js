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
import {
    BOMB_SLOTS, BOMB_TAIL, GRAVITY, TAU, cdFxMaterial, cdHeatColor, cdPart, cdQuadGeometry, mulberry32,
} from './cinder-drift-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

// ── Spatter ─────────────────────────────────────────────────────────────────────

/** A drop at rest lies this high on the crust. */
const REST_Y = 0.05;

/**
 * Height of a drop `tau` seconds after it leaves `y0` at `vy` m/s under `gravity` with `drag`.
 * CPU twin of the shader.
 */
export function dropHeight(y0, vy, tau, gravity = GRAVITY, drag = 0.35) {
    const h = (1 - Math.exp(-tau * drag)) / drag;
    return Math.max(REST_Y, y0 + vy * h - 0.5 * gravity * tau * tau);
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
     * Throw `n` drops from a world point at `time` (which may be ahead). `out` / `up` = (min,
     * max) speed outward / upward; `aim` = [x, z] biases the throw that way; `stagger` spreads
     * the births over that many seconds (a fountain); `gravity` < 0 makes sparks that rise.
     */
    part.emit = ({
        x, y, z, n, rgb = null, time, out = [1, 5], up = [2, 7], life = [0.9, 2.0], size = 0.05, stagger = 0,
        heat = 1.45, gravity = GRAVITY, drag = 0.35, aim = null, spread = 0,
    }) => {
        const rand = mulberry32(0x51a7 + bursts * 7919);
        bursts += 1;
        const total = Math.min(Math.max(0, Math.round(n)), count);
        for (let k = 0; k < total; k++) {
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
            const sx = spread ? (rand() - 0.5) * spread : 0;
            const sz = spread ? (rand() - 0.5) * spread : 0;
            aBirth.set([x + sx, y, z + sz, time + rand() * stagger], i * 4);
            aVel.set([vx, up[0] + (up[1] - up[0]) * rand(), vz, life[0] + (life[1] - life[0]) * rand()], i * 4);
            const g = 0.75 + rand() * 0.5;
            const c = rgb || [1, 1, 1];
            aTint.set([c[0] * g, c[1] * g, c[2] * g, size * (0.5 + rand() * 1.0)], i * 4);
            aPhys.set([gravity, Math.max(0.02, drag), heat * (0.8 + rand() * 0.4), 0], i * 4);
        }
        if (total > 0) {
            names.forEach((name) => {
                geometry.getAttribute(name).needsUpdate = true;
            });
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
    let cursor = 0;
    /** Throw a bomb from `from` with `velocity` at `time`; it flies for `flight` seconds. */
    part.launch = ({
        from: p0, velocity, time, flight: span, rgb = [1, 1, 1],
    }) => {
        const slot = cursor % BOMB_SLOTS;
        cursor += 1;
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
        cursor = 0;
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

/** Eight screen-space strips: one from each side of the card for up to four cleared rows. */
export function createRowJets(u) {
    const count = JET_ROWS * 2;
    const aRow = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) aRow.set([Math.floor(i / 2), i % 2 ? 1 : -1], i * 2);
    const geometry = cdQuadGeometry(count, { aRow: [aRow, 2] });
    const row = attribute('aRow', 'vec2');
    const uniforms = {
        /** Screen y (fractions, y down) of up to four rows; < 0 = unused. */
        rows: uniform(new THREE.Vector4(-1, -1, -1, -1)),
        /** (card x0, card x1, birth time, strength) */
        frame: uniform(new THREE.Vector4(0.4, 0.6, -100, 0)),
        /** How hot the jet burns: 1 = a single line, 1.6 = four. */
        heat: uniform(1),
    };
    const material = cdFxMaterial('CinderRowJets', { depthTest: false });
    const rowY = mix(mix(uniforms.rows.x, uniforms.rows.y, step(0.5, row.x)), mix(uniforms.rows.z, uniforms.rows.w, step(2.5, row.x)), step(1.5, row.x));
    const used = step(0.0, rowY).mul(step(0.001, uniforms.frame.w));
    const along = positionGeometry.x.add(0.5);
    // From the card's edge outward.
    const edge = mix(uniforms.frame.x, uniforms.frame.y, step(0.0, row.y));
    const sx = edge.add(row.y.mul(JET_REACH).mul(along));
    // (The strip is far taller than the row: a flame is not a ruled line.)
    const thickness = float(0.13);
    const sy = rowY.add(positionGeometry.y.mul(thickness));
    material.vertexNode = vec4(sx.mul(2.0).sub(1.0).mul(used), float(1.0).sub(sy.mul(2.0)).mul(used), 0.0, 1.0);
    const vAlong = varying(vec2(along, row.x.mul(1.7).add(row.y.mul(0.37))), 'cdJetT');
    material.colorNode = Fn(() => {
        const a = vAlong.x;
        const seed = vAlong.y;
        const raw = u.time.sub(uniforms.frame.z);
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
            .mul(uniforms.heat);
        return vec4(cdHeatColor(u, temp).mul(body.mul(env).mul(uniforms.frame.w)).mul(0.6), 0.0);
    })();
    const part = cdPart('CinderRowJets', geometry, material, 60);
    part.uniforms = uniforms;
    /** `ys` = screen y of each cleared row; `x0`/`x1` = the card's edges; all in screen fractions. */
    part.fire = (ys, x0, x1, time, strength = 1, heat = 1) => {
        uniforms.rows.value.set(ys[0] ?? -1, ys[1] ?? -1, ys[2] ?? -1, ys[3] ?? -1);
        uniforms.frame.value.set(x0, x1, time, strength);
        uniforms.heat.value = heat;
    };
    part.reset = () => {
        uniforms.frame.value.set(0.4, 0.6, -100, 0);
    };
    return part;
}
