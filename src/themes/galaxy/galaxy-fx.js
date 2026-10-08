/**
 * Galaxy — gameplay effects that are their own geometry.
 *
 *  - Seeds: a lock's light leaves the board as a comet in the piece's colour and falls into the
 *    galaxy, to the nursery it will light — a bright head and a tail of motes strung along the
 *    same arc, each a closed-form point on a quadratic curve.
 *  - Sparks: what a nova throws. Streaks that leave a nursery fast, drag to a halt in the thin
 *    gas and go out. A ring of preallocated slots.
 *  - Row beams: the cleared rows leave the card as blades of light at their own heights, drawn
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
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SEED_SLOTS, SEED_TAIL, TAU, gxArmAngle, gxFxMaterial, gxPart, gxQuadGeometry, mulberry32,
} from './galaxy-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

// ── Seeds ───────────────────────────────────────────────────────────────────────

/** How far behind the head the last mote of the tail runs, as a fraction of the flight. */
const SEED_LAG = 0.36;

/** The point of a seed's arc at `s` (0 = the board, 1 = the nursery). CPU twin of the shader. */
export function seedPoint(from, mid, to, s, out = [0, 0, 0]) {
    const a = (1 - s) * (1 - s);
    const b = 2 * s * (1 - s);
    const c = s * s;
    for (let k = 0; k < 3; k++) out[k] = from[k] * a + mid[k] * b + to[k] * c;
    return out;
}

/** @param {object} u shared galaxy uniforms */
export function createSeeds(u) {
    const count = SEED_SLOTS * SEED_TAIL;
    const aFrom = new Float32Array(count * 4);
    const aMid = new Float32Array(count * 4);
    const aTo = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        // Dormant seeds wait far ahead of the camera, never on it.
        aFrom.set([0, 0, -300, -100], i * 4);
        aTo[i * 4 + 3] = 1;
        aMid[i * 4 + 3] = (i % SEED_TAIL) / (SEED_TAIL - 1);
    }
    const geometry = gxQuadGeometry(count, {
        aFrom: [aFrom, 4], aMid: [aMid, 4], aTo: [aTo, 4], aTint: [aTint, 4],
    });
    ['aFrom', 'aMid', 'aTo', 'aTint'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const from = attribute('aFrom', 'vec4');
    const mid = attribute('aMid', 'vec4');
    const to = attribute('aTo', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = gxFxMaterial('GalaxySeeds');
    const lag = mid.w;
    const span = to.w;
    const age = u.time.sub(from.w);
    const raw = age.div(span).sub(lag.mul(SEED_LAG));
    const s = clamp(raw, 0.0, 1.0);
    // It leaves the board gently and falls into the galaxy faster and faster.
    const k = mix(s, s.mul(s), 0.55);
    const a = float(1.0).sub(k).mul(float(1.0).sub(k));
    const b = k.mul(float(1.0).sub(k)).mul(2.0);
    const c = k.mul(k);
    const flutter = sin(u.time.mul(19.0).add(lag.mul(23.0))).mul(lag).mul(0.22);
    // The nursery it falls into, where it is NOW: the pattern turns and the arms wind under it.
    const angle = gxArmAngle(to.x, u.winding).add(to.y);
    const target = u.frame.mul(vec4(cos(angle).mul(to.x), to.z, sin(angle).mul(to.x), 1.0)).xyz;
    const middle = from.xyz.add(target).mul(0.5).add(mid.xyz);
    const world = from.xyz.mul(a).add(middle.mul(b)).add(target.mul(c)).add(vec3(0.0, flutter, 0.0));
    const alive = step(0.0, raw).mul(step(raw, 0.999));
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    // The head is a lantern; the tail thins to dust.
    const px = u.viewport.y.mul(mix(float(0.0135), float(0.0034), lag.mul(lag))).mul(tint.w).mul(alive);
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const gain = mix(float(3.4), float(0.55), lag).mul(alive).mul(smoothstep(0.0, 0.06, raw));
    const vLight = varying(mix(tint.rgb, vec3(1.0), float(0.4).mul(float(1.0).sub(lag))).mul(gain), 'gxSeed');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const core = exp(d.mul(d).mul(-9.0)).add(exp(d.mul(-5.0)).mul(0.25));
        return vec4(vLight.mul(core).mul(float(1.0).sub(smoothstep(0.75, 1.0, d))), 0.0);
    })();

    const part = gxPart('GalaxySeeds', geometry, material, 40);
    let cursor = 0;
    /**
     * Send a seed from `from` (a world point) into the nursery at `site` (the plan's entry: the
     * shader finds where that nursery is at every moment of the flight), leaving at `time` and
     * taking `flight` seconds. `bow` (a world vector) pulls the middle of the arc aside; `size`
     * scales the comet.
     */
    part.launch = ({
        from: p0, site, rgb, time, flight, bow = [0, 0, 0], size = 1,
    }) => {
        const slot = cursor % SEED_SLOTS;
        cursor += 1;
        for (let j = 0; j < SEED_TAIL; j++) {
            const i = slot * SEED_TAIL + j;
            aFrom.set([p0[0], p0[1], p0[2], time], i * 4);
            aMid.set([bow[0], bow[1], bow[2]], i * 4);
            aTo.set([site.radius, site.offset, site.y, flight], i * 4);
            aTint.set([rgb[0], rgb[1], rgb[2], size], i * 4);
        }
        ['aFrom', 'aMid', 'aTo', 'aTint'].forEach((name) => {
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

// ── Sparks ──────────────────────────────────────────────────────────────────────

/** A spark's drag: it covers (1 − e^(−t·DRAG)) / DRAG seconds of its first speed. */
export const SPARK_DRAG = 1.5;

/** How far a spark has gone `tau` seconds after it left, per unit of speed. CPU twin. */
export function sparkTravel(tau) {
    return (1 - Math.exp(-Math.max(0, tau) * SPARK_DRAG)) / SPARK_DRAG;
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
    for (let i = 0; i < count; i++) aBirth.set([0, 0, -500, -100], i * 4);
    const geometry = gxQuadGeometry(count, { aBirth: [aBirth, 4], aVel: [aVel, 4], aTint: [aTint, 4] });
    ['aBirth', 'aVel', 'aTint'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const birth = attribute('aBirth', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = gxFxMaterial('GalaxySparks');
    const tau = u.time.sub(birth.w);
    const span = vel.w;
    const alive = step(0.0, tau).mul(step(tau, span));
    const at = (t) => birth.xyz.add(vel.xyz.mul(float(1.0).sub(exp(t.mul(-SPARK_DRAG))).div(SPARK_DRAG)));
    // A streak from where the spark was a moment ago to where it is.
    const t = max(tau, 0.0);
    const c0 = viewProjection(at(max(t.sub(0.07), 0.0)));
    const c1 = viewProjection(at(t));
    const along = positionGeometry.x.add(0.5);
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(c0.w).mul(half);
    const s1 = c1.xy.div(c1.w).mul(half);
    const dir = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(dir.y.negate(), dir.x);
    const clip = mix(c0, c1, along);
    const widthPx = max(tint.w.div(max(clip.w, 1.0).mul(u.pixelAngle)), u.viewport.y.mul(0.0014)).mul(alive);
    const lead = dir.mul(along.sub(0.5).mul(2.0)).mul(widthPx);
    material.vertexNode = vec4(
        clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).add(lead).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );
    const ageK = clamp(t.div(max(span, 0.01)), 0.0, 1.0);
    const fade = float(1.0).sub(ageK).mul(float(1.0).sub(ageK));
    const glitter = sin(t.mul(tint.w.mul(40.0).add(11.0)).add(birth.x.mul(13.0))).mul(0.3).add(0.7);
    const hot = mix(vec3(1.0, 0.97, 0.95), tint.rgb, smoothstep(0.0, 0.25, ageK));
    const vLight = varying(hot.mul(fade).mul(glitter).mul(alive).mul(3.0), 'gxSpark');
    material.colorNode = Fn(() => {
        const st = uv();
        const across = float(1.0).sub(abs(st.y.sub(0.5)).mul(2.0));
        const tail = smoothstep(0.0, 0.8, st.x);
        return vec4(vLight.mul(across.mul(across)).mul(tail).mul(u.breath), 0.0);
    })();

    const part = gxPart('GalaxySparks', geometry, material, 30);
    let cursor = 0;
    let bursts = 0;
    /**
     * Throw `n` sparks from a world point at `time` (which may be a moment ahead). They leave in
     * the plane spanned by `e1` and `e2` (the disc's own, as world unit vectors) at `out` =
     * (min, max) speed, with up to `lift` of that speed along `axis`.
     */
    part.emit = ({
        x, y, z, n, rgb, time, e1, e2, axis, out = [6, 26], lift = 0.5, life = [0.7, 1.6], size = 0.22, stagger = 0,
    }) => {
        const rand = mulberry32(0x51a7 + bursts * 7919);
        bursts += 1;
        const total = Math.min(n, count);
        for (let j = 0; j < total; j++) {
            const i = cursor % count;
            cursor += 1;
            const bearing = rand() * TAU;
            const speed = out[0] + (out[1] - out[0]) * rand() ** 1.6;
            const cb = Math.cos(bearing) * speed;
            const sb = Math.sin(bearing) * speed;
            const up = (rand() * 2 - 1) * lift * speed;
            aBirth.set([x, y, z, time + rand() * stagger], i * 4);
            aVel.set([
                e1[0] * cb + e2[0] * sb + axis[0] * up,
                e1[1] * cb + e2[1] * sb + axis[1] * up,
                e1[2] * cb + e2[2] * sb + axis[2] * up,
                life[0] + (life[1] - life[0]) * rand(),
            ], i * 4);
            const g = 0.7 + rand() * 0.6;
            aTint.set([rgb[0] * g, rgb[1] * g, rgb[2] * g, size * (0.55 + rand() * 0.9)], i * 4);
        }
        geometry.getAttribute('aBirth').needsUpdate = true;
        geometry.getAttribute('aVel').needsUpdate = true;
        geometry.getAttribute('aTint').needsUpdate = true;
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

// ── Row beams ───────────────────────────────────────────────────────────────────

export const BEAM_ROWS = 4;
/** Seconds a beam's head takes from the card to the edge of the frame, and its afterglow. */
export const BEAM_TRAVEL = 0.14;
export const BEAM_FADE = 0.18;

/** Eight screen-space strips: one from each side of the card for up to four cleared rows. */
export function createRowBeams(u) {
    const count = BEAM_ROWS * 2;
    const aRow = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) aRow.set([Math.floor(i / 2), i % 2 ? 1 : -1], i * 2);
    const geometry = gxQuadGeometry(count, { aRow: [aRow, 2] });
    const row = attribute('aRow', 'vec2');
    const uniforms = {
        /** Screen y (fractions, y down) of up to four rows; < 0 = unused. */
        rows: uniform(new THREE.Vector4(-1, -1, -1, -1)),
        /** (card x0, card x1, birth time, strength) */
        frame: uniform(new THREE.Vector4(0.4, 0.6, -100, 0)),
        color: uniform(new THREE.Vector3(1, 1, 1)),
    };
    const material = gxFxMaterial('GalaxyRowBeams');
    const rowY = mix(
        mix(uniforms.rows.x, uniforms.rows.y, step(0.5, row.x)),
        mix(uniforms.rows.z, uniforms.rows.w, step(2.5, row.x)),
        step(1.5, row.x),
    );
    const used = step(0.0, rowY).mul(step(0.001, uniforms.frame.w));
    const along = positionGeometry.x.add(0.5);
    // From the card's edge out to the edge of the frame.
    const edge = mix(uniforms.frame.x, uniforms.frame.y, step(0.0, row.y));
    const end = step(0.0, row.y);
    const sx = mix(edge, end, along);
    const thicknessPx = float(34.0);
    const sy = rowY.add(positionGeometry.y.mul(thicknessPx).div(u.viewport.y));
    material.vertexNode = vec4(sx.mul(2.0).sub(1.0).mul(used), float(1.0).sub(sy.mul(2.0)).mul(used), 0.0, 1.0);
    const vAlong = varying(along, 'gxBeamT');
    material.colorNode = Fn(() => {
        const age = u.time.sub(uniforms.frame.z);
        const head = age.div(BEAM_TRAVEL);
        const reached = step(vAlong, head);
        const dy = uv().y.sub(0.5).mul(thicknessPx);
        // A blade: a hairline core in a soft sheath that widens as it leaves the card.
        const taper = mix(float(1.7), float(0.6), vAlong);
        const core = exp(dy.mul(dy).div(taper.mul(taper)).negate()).mul(float(1.0).sub(vAlong.mul(0.8)));
        const sheath = exp(abs(dy).mul(-0.24)).mul(0.22);
        const tip = exp(vAlong.sub(head).mul(vAlong.sub(head)).mul(-150.0)).mul(step(head, 1.25));
        const env = exp(max(age.sub(vAlong.mul(BEAM_TRAVEL)), 0.0).div(-BEAM_FADE)).mul(step(0.0, age));
        const k = core.add(sheath).mul(reached).mul(env).add(core.add(sheath).mul(tip).mul(2.2))
            .mul(uniforms.frame.w)
            .mul(float(1.0).sub(vAlong).mul(float(1.0).sub(vAlong)).mul(float(1.0).sub(vAlong))
                .mul(0.96)
                .add(0.04));
        const col = mix(uniforms.color, vec3(1.0), core.mul(0.3));
        return vec4(col.mul(k).mul(1.7), 0.0);
    })();
    const part = gxPart('GalaxyRowBeams', geometry, material, 60);
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
