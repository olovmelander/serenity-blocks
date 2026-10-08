/**
 * Halcyon Apex — gameplay effects that are their own geometry.
 *
 *  - Wisps: a lock's light leaves the board as a comet in the piece's colour and flies to the
 *    head of a ley line — a bright head and a tail of motes strung along the same arc, each a
 *    closed-form point on a quadratic curve.
 *  - Sparks: spray and light. A crystal throws a fan of them when a wisp strikes it, a great
 *    crystal when it takes or lets go of light, the lagoon a crown of them under a hard drop:
 *    streaks that rise, slow and fall back to the water. A ring of preallocated slots.
 *  - Row beams: the cleared rows leave the card as blades of light at their own heights, drawn
 *    in screen space so they line up with the rows exactly.
 *  - Beacons: a thread of light holds each great crystal up; a four-line clear turns the thread
 *    into a pillar that stands into the sky.
 *
 * Nothing is created at event time and every pool is always drawn (dormant slots collapse to
 * zero size), so the first frame compiles every pipeline.
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
    BEACON_LIFE, PYRAMID_TOP, SITE, TAU, WISP_SLOTS, WISP_TAIL, haFxMaterial, haPart, haQuadGeometry, mulberry32,
} from './halcyon-apex-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

// ── Wisps ───────────────────────────────────────────────────────────────────────

/** How far behind the head the last mote of the tail runs, as a fraction of the flight. */
const WISP_LAG = 0.26;

/** The point of a wisp's arc at `s` (0 = the board, 1 = the line's head). CPU twin of the shader. */
export function wispPoint(from, mid, to, s, out = [0, 0, 0]) {
    const a = (1 - s) * (1 - s);
    const b = 2 * s * (1 - s);
    const c = s * s;
    for (let k = 0; k < 3; k++) out[k] = from[k] * a + mid[k] * b + to[k] * c;
    return out;
}

/** @param {object} u */
export function createWisps(u) {
    const count = WISP_SLOTS * WISP_TAIL;
    const aFrom = new Float32Array(count * 4);
    const aMid = new Float32Array(count * 4);
    const aTo = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        aFrom[i * 4 + 3] = -100;
        aTo[i * 4 + 3] = 1;
        aMid[i * 4 + 3] = (i % WISP_TAIL) / (WISP_TAIL - 1);
    }
    const geometry = haQuadGeometry(count, {
        aFrom: [aFrom, 4], aMid: [aMid, 4], aTo: [aTo, 4], aTint: [aTint, 4],
    });
    ['aFrom', 'aMid', 'aTo', 'aTint'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const from = attribute('aFrom', 'vec4');
    const mid = attribute('aMid', 'vec4');
    const to = attribute('aTo', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = haFxMaterial('HalcyonApexWisps', { depthTest: false });
    const lag = mid.w;
    const span = to.w;
    const age = u.time.sub(from.w);
    const raw = age.div(span).sub(lag.mul(WISP_LAG));
    const s = clamp(raw, 0.0, 1.0);
    // Ease out of the board, straight into the stone.
    const e = s.mul(s).mul(float(3.0).sub(s.mul(2.0)));
    const k = mix(s, e, 0.6);
    const a = float(1.0).sub(k).mul(float(1.0).sub(k));
    const b = k.mul(float(1.0).sub(k)).mul(2.0);
    const c = k.mul(k);
    const flutter = sin(u.time.mul(17.0).add(lag.mul(23.0))).mul(lag).mul(0.16);
    const world = from.xyz.mul(a).add(mid.xyz.mul(b)).add(to.xyz.mul(c)).add(vec3(0.0, flutter, 0.0));
    const alive = step(0.0, raw).mul(step(raw, 0.999));
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    // The head is a lantern; the tail thins to dust.
    const metres = tint.w.mul(mix(float(1.25), float(0.3), lag));
    const px = clamp(metres.mul(pxPerMetre), u.viewport.y.mul(0.003), u.viewport.y.mul(0.055)).mul(alive);
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const gain = mix(float(2.6), float(0.5), lag).mul(alive).mul(smoothstep(0.0, 0.08, raw));
    const vLight = varying(mix(tint.rgb, vec3(1.0), float(0.35).mul(float(1.0).sub(lag))).mul(gain), 'haWisp');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const core = exp(d.mul(d).mul(-9.0)).add(exp(d.mul(-5.0)).mul(0.25));
        return vec4(vLight.mul(core).mul(smoothstep(1.0, 0.75, d)), 0.0);
    })();

    const part = haPart('HalcyonApexWisps', geometry, material, 40, false);
    let cursor = 0;
    /**
     * Send a wisp from `from` to `to` (world points), leaving at `time` and taking `flight`
     * seconds; `lift` bows the arc upward.
     */
    part.launch = ({
        from: p0, to: p1, rgb, time, flight, lift = 2.2, size = 0.3, bow = 0,
    }) => {
        const slot = cursor % WISP_SLOTS;
        cursor += 1;
        const mx = (p0[0] + p1[0]) * 0.5 + bow;
        const my = Math.max(p0[1], p1[1]) + lift;
        const mz = (p0[2] + p1[2]) * 0.5;
        for (let j = 0; j < WISP_TAIL; j++) {
            const i = slot * WISP_TAIL + j;
            aFrom.set([p0[0], p0[1], p0[2], time], i * 4);
            aMid.set([mx, my, mz], i * 4);
            aTo.set([p1[0], p1[1], p1[2], flight], i * 4);
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

const SPARK_GRAVITY = 2.6;
const SPARK_DRAG = 1.3;

/** Height of a spark `tau` seconds after it leaves a point `y0` up. CPU twin of the shader. */
export function sparkHeight(y0, vy, tau) {
    const h = (1 - Math.exp(-tau * SPARK_DRAG)) / SPARK_DRAG;
    return Math.max(0.03, y0 + vy * h - 0.5 * SPARK_GRAVITY * tau * tau);
}

/**
 * @param {object} u
 * @param {number} count  pool size
 */
export function createSparks(u, count) {
    const aBirth = new Float32Array(count * 4);
    const aVel = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) aBirth[i * 4 + 3] = -100;
    const geometry = haQuadGeometry(count, { aBirth: [aBirth, 4], aVel: [aVel, 4], aTint: [aTint, 4] });
    ['aBirth', 'aVel', 'aTint'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const birth = attribute('aBirth', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = haFxMaterial('HalcyonApexSparks');
    const tau = u.time.sub(birth.w);
    const span = vel.w;
    const alive = step(0.0, tau).mul(step(tau, span));
    const at = (t) => {
        const h = float(1.0).sub(exp(t.mul(-SPARK_DRAG))).div(SPARK_DRAG);
        return vec3(
            birth.x.add(vel.x.mul(h)),
            max(birth.y.add(vel.y.mul(h)).sub(t.mul(t).mul(SPARK_GRAVITY * 0.5)), 0.03),
            birth.z.add(vel.z.mul(h)),
        );
    };
    // A streak from where the spark was a moment ago to where it is.
    const t = max(tau, 0.0);
    const p1 = at(t);
    const p0 = at(max(t.sub(0.05), 0.0));
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
    const widthPx = max(tint.w.mul(pxPerMetre), u.viewport.y.mul(0.0015)).mul(alive);
    const lead = dir.mul(along.sub(0.5).mul(2.0)).mul(widthPx);
    material.vertexNode = vec4(
        clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).add(lead).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );
    const ageK = clamp(t.div(max(span, 0.01)), 0.0, 1.0);
    const fade = float(1.0).sub(ageK).mul(float(1.0).sub(ageK));
    // Dust glitters as it turns.
    const turn = sin(t.mul(tint.w.mul(180.0).add(9.0)).add(birth.x.mul(13.0))).mul(0.35).add(0.65);
    const hot = mix(vec3(1.0, 0.96, 1.0), tint.rgb, smoothstep(0.0, 0.3, ageK));
    const vLight = varying(hot.mul(fade).mul(turn).mul(alive).mul(2.6), 'haSpark');
    material.colorNode = Fn(() => {
        const st = uv();
        const across = float(1.0).sub(abs(st.y.sub(0.5)).mul(2.0));
        const tail = smoothstep(0.0, 0.8, st.x);
        return vec4(vLight.mul(across.mul(across)).mul(tail), 0.0);
    })();

    const part = haPart('HalcyonApexSparks', geometry, material, 30);
    let cursor = 0;
    let bursts = 0;
    /**
     * Throw `n` sparks from a world point at `time` (which may be a moment ahead). `out` =
     * (min, max) speed outward, `up` = (min, max) speed upward.
     */
    part.emit = ({
        x, y, z, n, rgb, time, out = [0.8, 4.5], up = [0.5, 4], life = [0.8, 1.9], size = 0.035, stagger = 0,
    }) => {
        const rand = mulberry32(0x51a7 + bursts * 7919);
        bursts += 1;
        const total = Math.min(n, count);
        for (let k = 0; k < total; k++) {
            const i = cursor % count;
            cursor += 1;
            const a = rand() * TAU;
            const speed = out[0] + (out[1] - out[0]) * rand() ** 1.7;
            aBirth.set([x, y, z, time + rand() * stagger], i * 4);
            aVel.set([Math.sin(a) * speed, up[0] + (up[1] - up[0]) * rand(), Math.cos(a) * speed, life[0] + (life[1] - life[0]) * rand()], i * 4);
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
export const BEAM_FADE = 0.17;

/** Eight screen-space strips: one from each side of the card for up to four cleared rows. */
export function createRowBeams(u) {
    const count = BEAM_ROWS * 2;
    const aRow = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) aRow.set([Math.floor(i / 2), i % 2 ? 1 : -1], i * 2);
    const geometry = haQuadGeometry(count, { aRow: [aRow, 2] });
    const row = attribute('aRow', 'vec2');
    const uniforms = {
        /** Screen y (fractions, y down) of up to four rows; < 0 = unused. */
        rows: uniform(new THREE.Vector4(-1, -1, -1, -1)),
        /** (card x0, card x1, birth time, strength) */
        frame: uniform(new THREE.Vector4(0.4, 0.6, -100, 0)),
        color: uniform(new THREE.Vector3(1, 1, 1)),
    };
    const material = haFxMaterial('HalcyonApexRowBeams', { depthTest: false });
    const rowY = mix(mix(uniforms.rows.x, uniforms.rows.y, step(0.5, row.x)), mix(uniforms.rows.z, uniforms.rows.w, step(2.5, row.x)), step(1.5, row.x));
    const used = step(0.0, rowY).mul(step(0.001, uniforms.frame.w));
    const along = positionGeometry.x.add(0.5);
    // From the card's edge out to the edge of the frame.
    const edge = mix(uniforms.frame.x, uniforms.frame.y, step(0.0, row.y));
    const end = step(0.0, row.y);
    const sx = mix(edge, end, along);
    const thicknessPx = float(46.0);
    const sy = rowY.add(positionGeometry.y.mul(thicknessPx).div(u.viewport.y));
    material.vertexNode = vec4(sx.mul(2.0).sub(1.0).mul(used), float(1.0).sub(sy.mul(2.0)).mul(used), 0.0, 1.0);
    const vAlong = varying(along, 'haBeamT');
    material.colorNode = Fn(() => {
        const age = u.time.sub(uniforms.frame.z);
        const head = age.div(BEAM_TRAVEL);
        const reached = step(vAlong, head);
        const dy = uv().y.sub(0.5).mul(thicknessPx);
        // A blade: a hairline core in a soft sheath that widens as it leaves the card.
        const taper = mix(float(2.2), float(0.8), vAlong);
        const core = exp(dy.mul(dy).div(taper.mul(taper)).negate()).mul(float(1.0).sub(vAlong.mul(0.8)));
        const sheath = exp(abs(dy).mul(-0.17)).mul(0.34);
        const tip = exp(vAlong.sub(head).mul(vAlong.sub(head)).mul(-150.0)).mul(step(head, 1.25));
        const env = exp(max(age.sub(vAlong.mul(BEAM_TRAVEL)), 0.0).div(-BEAM_FADE)).mul(step(0.0, age));
        const k = core.add(sheath).mul(reached).mul(env).add(core.add(sheath).mul(tip).mul(2.2))
            .mul(uniforms.frame.w)
            .mul(float(1.0).sub(vAlong).mul(float(1.0).sub(vAlong)).mul(0.9)
                .add(0.1));
        const col = mix(uniforms.color, vec3(1.0), core.mul(0.3));
        return vec4(col.mul(k).mul(2.4), 0.0);
    })();
    const part = haPart('HalcyonApexRowBeams', geometry, material, 60, false);
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

// ── Beacons ─────────────────────────────────────────────────────────────────────

/** How high a beacon stands (metres over its crystal's foot). */
export const BEACON_HEIGHT = 1400;

/** Two upright ribbons that face the viewer: [0] under and over the Apex, [1] the Halcyon. */
export function createBeacons(u) {
    const aWho = new Float32Array([0, 1]);
    const geometry = haQuadGeometry(2, { aWho: [aWho, 1] });
    const who = attribute('aWho', 'float');
    const material = haFxMaterial('HalcyonApexBeacons');
    const centre = mix(u.apexPos, u.halcyonPos, who);
    // The thread starts at the dais (or the lagoon) and ends in the crystal's core.
    const foot = mix(float(PYRAMID_TOP + 1.3), float(0.0), who);
    const girth = mix(float(SITE.apex.girth), float(SITE.halcyon.girth), who);
    const age = u.time.sub(u.beacon.x);
    const live = step(0.0, age).mul(step(age, BEACON_LIFE)).mul(u.beacon.y);
    const blaze = exp(age.mul(-0.9)).mul(live);
    const width = girth.mul(float(0.5).add(blaze.mul(2.6)).add(exp(age.mul(-7.0)).mul(live).mul(2.6)));
    const along = positionGeometry.y.add(0.5);
    const y = foot.add(along.mul(BEACON_HEIGHT));
    const base = vec3(centre.x, y, centre.z);
    const toEye = normalize(vec3(cameraPosition.x.sub(centre.x), 0.0, cameraPosition.z.sub(centre.z)));
    const side = vec3(toEye.z, 0.0, toEye.x.negate());
    const world = base.add(side.mul(positionGeometry.x.mul(width).mul(2.0)));
    material.vertexNode = viewProjection(world);
    const vAcross = varying(positionGeometry.x.mul(2.0), 'haBeaconX');
    const vHeight = varying(along.mul(BEACON_HEIGHT), 'haBeaconY');
    const vWho = varying(who, 'haBeaconW');
    const vBlaze = varying(blaze, 'haBeaconB');
    material.colorNode = Fn(() => {
        const x = abs(vAcross);
        const core = exp(x.mul(x).mul(-26.0));
        const sheath = exp(x.mul(-4.2)).mul(float(1.0).sub(smoothstep(0.7, 1.0, x)));
        const reach = mix(float(SITE.apex.hover - 1.3), float(SITE.halcyon.height), vWho);
        // At rest: a thread from the foot up into the crystal.
        const thread = float(1.0).sub(smoothstep(reach.mul(0.7), reach, vHeight)).mul(core).mul(0.5)
            .mul(sin(vHeight.mul(1.3).sub(u.time.mul(4.0))).mul(0.25).add(0.75))
            .mul(u.power.mul(1.8).add(1.0));
        // A four-line clear: the pillar, thinning with height, light running up it.
        const climb = sin(vHeight.mul(0.11).sub(u.time.mul(9.0))).mul(0.2).add(0.8);
        const pillar = core.mul(2.4).add(sheath.mul(0.5)).mul(exp(vHeight.mul(-1 / 520))).mul(climb)
            .mul(vBlaze);
        const held = mix(u.held.x, u.held.y, vWho);
        const col = u.ley.mul(thread.mul(float(1.0).add(held.mul(0.4)))).add(mix(u.ley, vec3(1.0, 0.9, 0.72), 0.6).mul(pillar).mul(2.2));
        return vec4(col.mul(u.breath.mul(0.8).add(0.2)), 0.0);
    })();
    const part = haPart('HalcyonApexBeacons', geometry, material, 22);
    part.reset = () => {};
    return part;
}
