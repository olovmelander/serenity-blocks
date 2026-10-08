/**
 * Bioluminescence — gameplay effects that are their own geometry.
 *
 *  - Swimmers: a lock's light goes into the pool and swims to a mushroom. What you see is the
 *    plankton it wakes: a bright head that crosses the water on a bowed path, and behind it a
 *    line of sparks that light as it passes and die away where they lie.
 *  - Spores: one pool of soft motes for everything the grotto throws — the splash where a piece
 *    dives in, the puff off a cap that blooms, the breath a clear lets out of every mushroom, the
 *    jets from the cleared rows, the elder's fountain. They drift, they slow in the damp air,
 *    most of them float.
 *  - Row jets: the cleared rows leave the card as blades of light at their own heights, drawn in
 *    screen space so they line up with the rows exactly.
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
    positionGeometry,
    sin,
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
    RUNNER_SLOTS, RUNNER_TAIL, TAU, blFogAmount, blFxMaterial, blPart, blQuadGeometry, mulberry32,
} from './bioluminescence-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

// ── Swimmers ────────────────────────────────────────────────────────────────────

/** Seconds a spark of the wake takes to die to 1/e once the head has passed it. */
export const WAKE_FADE = 0.75;

/** The point of a swimmer's path at `s` (0 = where it dived, 1 = the mushroom's foot). */
export function runnerPoint(from, mid, to, s, out = [0, 0]) {
    const a = (1 - s) * (1 - s);
    const b = 2 * s * (1 - s);
    const c = s * s;
    out[0] = from[0] * a + mid[0] * b + to[0] * c;
    out[1] = from[1] * a + mid[1] * b + to[1] * c;
    return out;
}

/** @param {object} u */
export function createRunners(u) {
    const count = RUNNER_SLOTS * RUNNER_TAIL;
    // aPath = (from x, from z, to x, to z); aBend = (mid x, mid z, where along the path, jitter);
    // aGo = (leave time, flight seconds, size, _); aTint = colour.
    const aPath = new Float32Array(count * 4);
    const aBend = new Float32Array(count * 4);
    const aGo = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 3);
    const rand = mulberry32(0x77a1);
    for (let i = 0; i < count; i++) {
        const j = i % RUNNER_TAIL;
        aBend[i * 4 + 2] = j / (RUNNER_TAIL - 1);
        aBend[i * 4 + 3] = rand();
        aGo.set([-100, 1, 0.2, 0], i * 4);
    }
    const geometry = blQuadGeometry(count, {
        aPath: [aPath, 4], aBend: [aBend, 4], aGo: [aGo, 4], aTint: [aTint, 3],
    });
    ['aPath', 'aBend', 'aGo', 'aTint'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const path = attribute('aPath', 'vec4');
    const bend = attribute('aBend', 'vec4');
    const go = attribute('aGo', 'vec4');
    const tint = attribute('aTint', 'vec3');

    const material = blFxMaterial('BioluminescenceRunners');
    const slotS = bend.z;
    const jitter = bend.w;
    const age = u.time.sub(go.x);
    const head = clamp(age.div(go.y), 0.0, 1.0);
    // The first mote of every slot is the head: it rides the path. The rest lie where they are.
    const isHead = step(slotS, 0.0005);
    const eased = head.mul(head).mul(float(3.0).sub(head.mul(2.0)));
    const s = mix(slotS, mix(head, eased, 0.5), isHead);
    const a = float(1.0).sub(s).mul(float(1.0).sub(s));
    const b = s.mul(float(1.0).sub(s)).mul(2.0);
    const c = s.mul(s);
    const flat = path.xy.mul(a).add(bend.xy.mul(b)).add(path.zw.mul(c));
    // The wake's sparks scatter a little to either side of the path.
    const scatter = vec2(sin(jitter.mul(91.0)), sin(jitter.mul(57.0).add(1.3))).mul(0.22).mul(float(1.0).sub(isHead));
    const afloat = vec3(flat.x.add(scatter.x), 0.05, flat.y.add(scatter.y));
    // A spark lights as the head passes it, then dies away where it lies.
    const sinceHead = age.sub(slotS.mul(go.y));
    const wake = exp(max(sinceHead, 0.0).div(-WAKE_FADE)).mul(step(0.0, sinceHead));
    const headLive = step(0.0, age).mul(step(age, go.y.mul(1.02)));
    const live = mix(wake, headLive, isHead);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(viewProjection(afloat).w, 0.3));
    const metres = go.z.mul(mix(jitter.mul(0.3).add(0.2), float(1.5), isHead));
    const px = clamp(metres.mul(pxPerMetre), u.viewport.y.mul(0.0022), u.viewport.y.mul(0.06)).mul(step(0.004, live));
    // A spark sits ON the water (its own radius above it), so the pool does not cut it in half
    // and whatever stands in the pool passes in front of it.
    const clip = viewProjection(vec3(afloat.x, px.div(pxPerMetre).add(0.02), afloat.z));
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const wink = sin(u.time.mul(jitter.mul(9.0).add(6.0)).add(jitter.mul(40.0))).mul(0.3).add(0.7);
    const gain = mix(wake.mul(wink).mul(1.8), headLive.mul(4.0), isHead);
    const vLight = varying(mix(tint, vec3(1.0), isHead.mul(0.4)).mul(gain), 'blRunner');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const core = exp(d.mul(d).mul(-9.0)).add(exp(d.mul(-5.0)).mul(0.22));
        return vec4(vLight.mul(core).mul(smoothstep(1.0, 0.75, d)), 0.0);
    })();

    const part = blPart('BioluminescenceRunners', geometry, material, 40, false);
    let cursor = 0;
    /**
     * Send a swimmer over the water from `from` to `to` (world x, z), leaving at `time` and
     * taking `flight` seconds; `bow` bends the path to one side.
     */
    part.launch = ({
        from, to, rgb, time, flight, bow = 0, size = 0.25,
    }) => {
        const slot = cursor % RUNNER_SLOTS;
        cursor += 1;
        const dx = to[0] - from[0];
        const dz = to[1] - from[1];
        const len = Math.hypot(dx, dz) || 1;
        const mx = (from[0] + to[0]) * 0.5 + (-dz / len) * bow;
        const mz = (from[1] + to[1]) * 0.5 + (dx / len) * bow;
        for (let j = 0; j < RUNNER_TAIL; j++) {
            const i = slot * RUNNER_TAIL + j;
            aPath.set([from[0], from[1], to[0], to[1]], i * 4);
            aBend[i * 4] = mx;
            aBend[i * 4 + 1] = mz;
            aGo.set([time, flight, size, 0], i * 4);
            aTint.set(rgb, i * 3);
        }
        ['aPath', 'aBend', 'aGo', 'aTint'].forEach((name) => {
            geometry.getAttribute(name).needsUpdate = true;
        });
        return slot;
    };
    part.reset = () => {
        for (let i = 0; i < count; i++) aGo[i * 4] = -100;
        geometry.getAttribute('aGo').needsUpdate = true;
        cursor = 0;
    };
    part.count = count;
    return part;
}

// ── Spores ──────────────────────────────────────────────────────────────────────

/** How fast a spore loses its first speed to the damp air (1/s). */
const SPORE_DRAG = 1.5;

/** Height of a spore `tau` seconds after it leaves a point `y0` up. CPU twin of the shader. */
export function sporeHeight(y0, vy, tau, gravity) {
    const h = (1 - Math.exp(-tau * SPORE_DRAG)) / SPORE_DRAG;
    return Math.max(0.03, y0 + vy * h - 0.5 * gravity * tau * tau);
}

/**
 * @param {object} u
 * @param {number} count  pool size
 */
export function createSpores(u, count) {
    const aBirth = new Float32Array(count * 4);
    const aVel = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    const aPhys = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) aBirth[i * 4 + 3] = -100;
    const geometry = blQuadGeometry(count, {
        aBirth: [aBirth, 4], aVel: [aVel, 4], aTint: [aTint, 4], aPhys: [aPhys, 2],
    });
    ['aBirth', 'aVel', 'aTint', 'aPhys'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const birth = attribute('aBirth', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const tint = attribute('aTint', 'vec4');
    const phys = attribute('aPhys', 'vec2');

    const material = blFxMaterial('BioluminescenceSpores');
    const tau = u.time.sub(birth.w);
    const span = vel.w;
    const alive = step(0.0, tau).mul(step(tau, span));
    const t = max(tau, 0.0);
    const h = float(1.0).sub(exp(t.mul(-SPORE_DRAG))).div(SPORE_DRAG);
    const seed = phys.y;
    // They do not fall straight: each one wanders as it goes.
    const flutter = vec2(
        sin(t.mul(seed.mul(1.7).add(1.1)).add(seed.mul(40.0))),
        sin(t.mul(seed.mul(1.3).add(0.9)).add(seed.mul(71.0))),
    ).mul(t.min(2.0)).mul(0.11);
    const world = vec3(
        birth.x.add(vel.x.mul(h)).add(flutter.x),
        max(birth.y.add(vel.y.mul(h)).sub(t.mul(t).mul(phys.x).mul(0.5)), 0.03),
        birth.z.add(vel.z.mul(h)).add(flutter.y),
    );
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    const px = clamp(tint.w.mul(pxPerMetre), u.viewport.y.mul(0.0016), u.viewport.y.mul(0.03)).mul(alive);
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const ageK = clamp(t.div(max(span, 0.01)), 0.0, 1.0);
    const fade = float(1.0).sub(ageK).mul(float(1.0).sub(ageK)).mul(smoothstep(0.0, 0.06, ageK));
    const wink = sin(t.mul(seed.mul(7.0).add(4.0)).add(seed.mul(30.0))).mul(0.3).add(0.7);
    // Born white-hot, cooling to their own colour.
    const hot = mix(vec3(1.0), tint.rgb, smoothstep(0.0, 0.22, ageK));
    const fog = float(1.0).sub(blFogAmount(clip.w, world.y).mul(0.8));
    const vLight = varying(hot.mul(fade).mul(wink).mul(alive).mul(fog)
        .mul(2.4), 'blSpore');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        return vec4(vLight.mul(exp(d.mul(d).mul(-6.0)).add(exp(d.mul(-4.0)).mul(0.1))).mul(smoothstep(1.0, 0.7, d)), 0.0);
    })();

    const part = blPart('BioluminescenceSpores', geometry, material, 30);
    let cursor = 0;
    let bursts = 0;
    /**
     * Throw `n` spores from round a world point at `time` (which may be a moment ahead).
     * `spread` = how far from the point they start; `push` = a velocity they all share;
     * `out` / `up` = (min, max) speed outward / upward; `gravity` < 0 floats them.
     */
    part.emit = ({
        x, y, z, n, rgb, time, spread = 0, push = null, out = [0.3, 1.5], up = [0.2, 1.4], life = [1.2, 2.8],
        size = 0.03, stagger = 0, gravity = -0.22,
    }) => {
        const rand = mulberry32(0x3c0d + bursts * 7919);
        bursts += 1;
        const total = Math.min(Math.max(0, Math.round(n)), count);
        for (let k = 0; k < total; k++) {
            const i = cursor % count;
            cursor += 1;
            const a = rand() * TAU;
            const r = spread * Math.sqrt(rand());
            const speed = out[0] + (out[1] - out[0]) * rand() ** 1.6;
            aBirth.set([x + Math.cos(a) * r, y, z + Math.sin(a) * r, time + rand() * stagger], i * 4);
            aVel.set([
                Math.cos(a) * speed + (push ? push[0] : 0),
                up[0] + (up[1] - up[0]) * rand() + (push ? push[1] : 0),
                Math.sin(a) * speed + (push ? push[2] : 0),
                life[0] + (life[1] - life[0]) * rand(),
            ], i * 4);
            const g = 0.7 + rand() * 0.6;
            aTint.set([rgb[0] * g, rgb[1] * g, rgb[2] * g, size * (0.55 + rand() * 0.9)], i * 4);
            aPhys.set([gravity * (0.7 + rand() * 0.6), rand()], i * 2);
        }
        if (total > 0) {
            ['aBirth', 'aVel', 'aTint', 'aPhys'].forEach((name) => {
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
    part.state = { aBirth, aVel, aTint };
    return part;
}

// ── Row jets ────────────────────────────────────────────────────────────────────

export const JET_ROWS = 4;
/** Seconds a jet's head takes from the card to the edge of the frame, and its afterglow. */
export const JET_TRAVEL = 0.16;
export const JET_FADE = 0.2;
/** How tall a jet's strip is, as a fraction of the frame's height. */
export const JET_THICKNESS = 0.066;

/** Eight screen-space strips: one from each side of the card for up to four cleared rows. */
export function createRowJets(u) {
    const count = JET_ROWS * 2;
    const aRow = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) aRow.set([Math.floor(i / 2), i % 2 ? 1 : -1], i * 2);
    const geometry = blQuadGeometry(count, { aRow: [aRow, 2] });
    const row = attribute('aRow', 'vec2');
    const uniforms = {
        /** Screen y (fractions, y down) of up to four rows; < 0 = unused. */
        rows: uniform(new THREE.Vector4(-1, -1, -1, -1)),
        /** (card x0, card x1, birth time, strength) */
        frame: uniform(new THREE.Vector4(0.4, 0.6, -100, 0)),
        color: uniform(new THREE.Vector3(1, 1, 1)),
    };
    const material = blFxMaterial('BioluminescenceRowJets', { depthTest: false });
    const rowY = mix(mix(uniforms.rows.x, uniforms.rows.y, step(0.5, row.x)), mix(uniforms.rows.z, uniforms.rows.w, step(2.5, row.x)), step(1.5, row.x));
    const used = step(0.0, rowY).mul(step(0.001, uniforms.frame.w));
    const along = positionGeometry.x.add(0.5);
    // From the card's edge out to the edge of the frame.
    const edge = mix(uniforms.frame.x, uniforms.frame.y, step(0.0, row.y));
    const end = step(0.0, row.y);
    const sx = mix(edge, end, along);
    // A jet is a fixed share of the frame tall whatever the pixel ratio; its profile is drawn in
    // the 54 design pixels that share is at 813 px.
    const thicknessPx = float(54.0);
    const sy = rowY.add(positionGeometry.y.mul(JET_THICKNESS));
    material.vertexNode = vec4(sx.mul(2.0).sub(1.0).mul(used), float(1.0).sub(sy.mul(2.0)).mul(used), 0.0, 1.0);
    const vAlong = varying(vec2(along, row.x.mul(1.7).add(row.y)), 'blJetT');
    material.colorNode = Fn(() => {
        const far = vAlong.x;
        const age = u.time.sub(uniforms.frame.z);
        const head = age.div(JET_TRAVEL);
        const reached = step(far, head);
        const dy = uv().y.sub(0.5).mul(thicknessPx);
        // A blade that breaks up into spores as it leaves the card.
        const grain = u.noise(vec2(far.mul(3.0).sub(age.mul(1.6)).add(vAlong.y), dy.mul(0.02).add(vAlong.y.mul(0.37)))).r;
        const taper = mix(float(2.4), float(1.0), far);
        const core = exp(dy.mul(dy).div(taper.mul(taper)).negate()).mul(float(1.0).sub(far.mul(0.8)));
        const sheath = exp(abs(dy).mul(-0.15)).mul(0.36).mul(smoothstep(0.3, 0.75, grain).mul(far).add(float(1.0).sub(far)));
        const tip = exp(far.sub(head).mul(far.sub(head)).mul(-150.0)).mul(step(head, 1.25));
        const env = exp(max(age.sub(far.mul(JET_TRAVEL)), 0.0).div(-JET_FADE)).mul(step(0.0, age));
        const k = core.add(sheath).mul(reached).mul(env).add(core.add(sheath).mul(tip).mul(2.2))
            .mul(uniforms.frame.w)
            .mul(float(1.0).sub(far).mul(float(1.0).sub(far)).mul(0.9)
                .add(0.1));
        const col = mix(uniforms.color, vec3(1.0), core.mul(0.3));
        return vec4(col.mul(k).mul(2.2), 0.0);
    })();
    const part = blPart('BioluminescenceRowJets', geometry, material, 60, false);
    part.uniforms = uniforms;
    /** `ys` = screen y of each cleared row; `x0`/`x1` = the card's edges; all in screen fractions. */
    part.fire = (ys, x0, x1, rgb, time, strength = 1) => {
        uniforms.rows.value.set(ys[0] ?? -1, ys[1] ?? -1, ys[2] ?? -1, ys[3] ?? -1);
        uniforms.frame.value.set(x0, x1, time, strength);
        uniforms.color.value.set(rgb[0], rgb[1], rgb[2]);
    };
    part.reset = () => {
        uniforms.frame.value.set(0.4, 0.6, -100, 0);
    };
    return part;
}
