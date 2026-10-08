/**
 * Geode — the air in the cavity, and the gameplay effects that are their own geometry.
 *
 *  - Air: dust that drifts round the axis and toward the viewer, glittering in every jewel
 *    colour, and stars — points of the lining that flash a four-pointed star as the view drifts
 *    and flare when a wave passes them. One instanced draw.
 *  - Sparks: a lock's light leaves the board as a comet in the piece's colour and flies into a
 *    crystal — a bright head and a tail of motes strung along the same arc, each a closed-form
 *    point on a quadratic curve.
 *  - Shards: crystal dust. A crystal throws a fan of it along its own axis when a spark strikes
 *    it or a clear releases it; the crown throws it when a chain breaks.
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
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    mod,
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
    CAVITY,
    TAU,
    WISP_SLOTS,
    WISP_TAIL,
    gdClearLight,
    gdFxMaterial,
    gdLuma,
    gdMineral,
    gdPart,
    gdPulseLight,
    gdQuadGeometry,
    gdSpectrum,
    mulberry32,
} from './geode-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

// ── Air: dust and stars ─────────────────────────────────────────────────────────

/** The dust lives between these depths and is carried toward the viewer, wrapping. */
const DUST_Z0 = -98;
const DUST_SPAN = 108;

/**
 * @param {object} u
 * @param {{ count: number, pos: Float32Array, look: Float32Array }} stars  the plan's stars
 * @param {object} opts
 * @param {number} opts.motes  dust motes
 * @param {number} opts.stars  stars drawn (the plan's first N)
 * @param {number} [opts.seed]
 */
export function createAir(u, stars, { motes, stars: starCount, seed = 0x5a17 }) {
    const ns = Math.min(starCount, stars.count);
    const count = motes + ns;
    const aPos = new Float32Array(count * 4);
    const aLook = new Float32Array(count * 4);
    const rand = mulberry32(seed);
    for (let i = 0; i < motes; i++) {
        // Thicker toward the axis, where the heart's light streams.
        const r = (0.08 + 0.8 * rand() ** 0.8) * CAVITY.a;
        const a = rand() * TAU;
        aPos.set([Math.cos(a) * r, Math.sin(a) * r, DUST_Z0 + rand() * DUST_SPAN, 0.05 + rand() ** 2.4 * 0.16], i * 4);
        aLook.set([rand(), rand(), 0, rand()], i * 4);
    }
    for (let i = 0; i < ns; i++) {
        const o = (motes + i) * 4;
        aPos.set(stars.pos.subarray(i * 4, i * 4 + 4), o);
        aLook.set([stars.look[i * 4], stars.look[i * 4 + 1], 1, stars.look[i * 4 + 3]], o);
    }
    const geometry = gdQuadGeometry(count, { aPos: [aPos, 4], aLook: [aLook, 4] });
    const pos = attribute('aPos', 'vec4');
    const look = attribute('aLook', 'vec4');
    const isStar = step(0.5, look.z);

    const material = gdFxMaterial('GeodeAir');
    // Dust: carried round the axis and toward the viewer.
    const ang = u.drift.mul(look.x.mul(0.6).add(0.2)).mul(0.11).add(u.twist.mul(1.2));
    const ca = cos(ang);
    const sa = sin(ang);
    const carried = mod(pos.z.sub(DUST_Z0).add(u.drift.mul(look.w.mul(0.8).add(0.4))), DUST_SPAN);
    const bob = sin(u.time.mul(look.w.mul(0.5).add(0.3)).add(look.x.mul(50.0))).mul(0.5);
    const dust = vec3(
        pos.x.mul(ca).sub(pos.y.mul(sa)),
        pos.x.mul(sa).add(pos.y.mul(ca)).add(bob),
        carried.add(DUST_Z0),
    );
    const world = mix(dust, pos.xyz, isStar);
    const clip = viewProjection(world);
    const toCam = normalize(cameraPosition.sub(world));
    // A grain turns in the light: it flashes as the eye moves past it, and slowly on its own.
    const facetDir = normalize(vec3(look.x, look.w, fract(look.x.mul(7.3).add(look.w.mul(3.1)))).sub(0.5));
    const turn = sin(dot(toCam, facetDir).mul(42.0).add(u.time.mul(look.w.mul(0.9).add(0.25))).add(look.x.mul(60.0)))
        .mul(0.5).add(0.5);
    const t2 = turn.mul(turn);
    const flash = t2.mul(t2).mul(t2);
    const wakeAt = gdClearLight(u, pos.w);
    const wake = gdLuma(gdPulseLight(u, pos.w)).mul(5.0).add(gdLuma(wakeAt.rgb).mul(5.0)).add(wakeAt.a.mul(0.2))
        .mul(isStar);
    const charge = u.power.mul(0.9).add(u.surge.mul(1.6)).add(1.0);
    const starLight = mix(mix(u.druzy, gdMineral(u, look.y), 0.6), vec3(1.0), 0.45)
        .mul(flash.mul(1.5).add(0.03).add(wake)).mul(charge);
    // Dust is brightest in the heart's stream, and fades at both ends of its run.
    const ends = smoothstep(0.0, 14.0, carried).mul(float(1.0).sub(smoothstep(DUST_SPAN - 16, DUST_SPAN, carried)));
    const stream = exp(length(world.xy).mul(-0.07)).mul(1.1).add(0.3);
    const dustLight = mix(gdSpectrum(look.y), u.heart, 0.35)
        .mul(flash.mul(1.1).add(0.1)).mul(stream).mul(ends)
        .mul(charge)
        .mul(0.85);
    const light = mix(dustLight, starLight, isStar).mul(u.breath);

    const half = u.viewport.mul(0.5);
    const pxPerSpan = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    const scale = u.viewport.y.div(1080.0);
    const dustPx = clamp(pos.w.mul(pxPerSpan), scale.mul(1.1), scale.mul(7.0));
    const starPx = clamp(gdLuma(starLight).sqrt().mul(34.0), 0.0, 46.0).add(5.0).mul(scale);
    const px = mix(dustPx, starPx, isStar);
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const vLight = varying(vec4(light, isStar), 'gdAir');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const ax = abs(q.x);
        const ay = abs(q.y);
        const soft = exp(d.mul(d).mul(-6.0));
        const rays = exp(ay.mul(-30.0)).mul(exp(ax.mul(-3.4))).add(exp(ax.mul(-30.0)).mul(exp(ay.mul(-3.4))));
        const star = rays.mul(0.6).add(exp(d.mul(d).mul(-30.0)));
        const k = mix(soft, star, vLight.w).mul(float(1.0).sub(smoothstep(0.65, 1.0, d)));
        return vec4(vLight.rgb.mul(k), 0.0);
    })();

    const part = gdPart('GeodeAir', geometry, material, 20);
    part.count = count;
    part.motes = motes;
    part.stars = ns;
    return part;
}

// ── Sparks ──────────────────────────────────────────────────────────────────────

/** How far behind the head the last mote of the tail runs, as a fraction of the flight. */
const WISP_LAG = 0.26;

/** The point of a spark's arc at `s` (0 = the board, 1 = the crystal). CPU twin of the shader. */
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
    const geometry = gdQuadGeometry(count, {
        aFrom: [aFrom, 4], aMid: [aMid, 4], aTo: [aTo, 4], aTint: [aTint, 4],
    });
    ['aFrom', 'aMid', 'aTo', 'aTint'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const from = attribute('aFrom', 'vec4');
    const mid = attribute('aMid', 'vec4');
    const to = attribute('aTo', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = gdFxMaterial('GeodeWisps', { depthTest: false });
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
    const pxPerSpan = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    // The head is a lantern; the tail thins to dust.
    const spans = tint.w.mul(mix(float(1.25), float(0.3), lag));
    const px = clamp(spans.mul(pxPerSpan), u.viewport.y.mul(0.003), u.viewport.y.mul(0.05)).mul(alive);
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const gain = mix(float(2.6), float(0.5), lag).mul(alive).mul(smoothstep(0.0, 0.08, raw));
    const vLight = varying(mix(tint.rgb, vec3(1.0), float(0.35).mul(float(1.0).sub(lag))).mul(gain), 'gdWisp');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const core = exp(d.mul(d).mul(-9.0)).add(exp(d.mul(-5.0)).mul(0.25));
        return vec4(vLight.mul(core).mul(float(1.0).sub(smoothstep(0.75, 1.0, d))), 0.0);
    })();

    const part = gdPart('GeodeWisps', geometry, material, 40);
    let cursor = 0;
    /**
     * Send a spark from `from` to `to` (world points), leaving at `time` and taking `flight`
     * seconds; `bow` (a world vector) pushes the middle of the arc aside.
     */
    part.launch = ({
        from: p0, to: p1, rgb, time, flight, bow = [0, 0, 0], size = 0.3,
    }) => {
        const slot = cursor % WISP_SLOTS;
        cursor += 1;
        const m = [(p0[0] + p1[0]) * 0.5 + bow[0], (p0[1] + p1[1]) * 0.5 + bow[1], (p0[2] + p1[2]) * 0.5 + bow[2]];
        for (let j = 0; j < WISP_TAIL; j++) {
            const i = slot * WISP_TAIL + j;
            aFrom.set([p0[0], p0[1], p0[2], time], i * 4);
            aMid.set(m, i * 4);
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

// ── Shards ──────────────────────────────────────────────────────────────────────

const SHARD_GRAVITY = 1.1;
const SHARD_DRAG = 1.5;

/** How far a shard has travelled `tau` seconds after leaving at unit speed. CPU twin of the shader. */
export function shardReach(tau) {
    return (1 - Math.exp(-tau * SHARD_DRAG)) / SHARD_DRAG;
}

/**
 * @param {object} u
 * @param {number} count  pool size
 */
export function createShards(u, count) {
    const aBirth = new Float32Array(count * 4);
    const aVel = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) aBirth[i * 4 + 3] = -100;
    const geometry = gdQuadGeometry(count, { aBirth: [aBirth, 4], aVel: [aVel, 4], aTint: [aTint, 4] });
    ['aBirth', 'aVel', 'aTint'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const birth = attribute('aBirth', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = gdFxMaterial('GeodeShards');
    const tau = u.time.sub(birth.w);
    const span = vel.w;
    const alive = step(0.0, tau).mul(step(tau, span));
    const at = (t) => {
        const h = float(1.0).sub(exp(t.mul(-SHARD_DRAG))).div(SHARD_DRAG);
        return vec3(
            birth.x.add(vel.x.mul(h)),
            birth.y.add(vel.y.mul(h)).sub(t.mul(t).mul(SHARD_GRAVITY * 0.5)),
            birth.z.add(vel.z.mul(h)),
        );
    };
    // A streak from where the shard was a moment ago to where it is.
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
    const pxPerSpan = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
    const widthPx = max(tint.w.mul(pxPerSpan), u.viewport.y.mul(0.0015)).mul(alive);
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
    const hot = mix(vec3(1.0, 0.97, 0.94), tint.rgb, smoothstep(0.0, 0.3, ageK));
    const vLight = varying(hot.mul(fade).mul(turn).mul(alive).mul(2.6), 'gdShard');
    material.colorNode = Fn(() => {
        const st = uv();
        const across = float(1.0).sub(abs(st.y.sub(0.5)).mul(2.0));
        const tail = smoothstep(0.0, 0.8, st.x);
        return vec4(vLight.mul(across.mul(across)).mul(tail), 0.0);
    })();

    const part = gdPart('GeodeShards', geometry, material, 30);
    let cursor = 0;
    let bursts = 0;
    /**
     * Throw `n` shards from a world point at `time` (which may be a moment ahead), fanned round
     * the unit vector `dir`: `out` = (min, max) speed across it, `along` = (min, max) speed
     * along it.
     */
    part.emit = ({
        x, y, z, n, rgb, time, dir: d = [0, 1, 0], out = [0.8, 4.5], along: al = [0.5, 4], life = [0.8, 1.9],
        size = 0.035, stagger = 0,
    }) => {
        const rand = mulberry32(0x51a7 + bursts * 7919);
        bursts += 1;
        // Two unit vectors across `dir`.
        const ref = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const e1 = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
        const inv = 1 / Math.max(1e-6, Math.hypot(e1[0], e1[1], e1[2]));
        e1[0] *= inv;
        e1[1] *= inv;
        e1[2] *= inv;
        const e2 = [d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0]];
        const total = Math.min(n, count);
        for (let k = 0; k < total; k++) {
            const i = cursor % count;
            cursor += 1;
            const a = rand() * TAU;
            const across = out[0] + (out[1] - out[0]) * rand() ** 1.7;
            const forward = al[0] + (al[1] - al[0]) * rand();
            const ca = Math.cos(a) * across;
            const sa = Math.sin(a) * across;
            aBirth.set([x, y, z, time + rand() * stagger], i * 4);
            aVel.set([
                e1[0] * ca + e2[0] * sa + d[0] * forward,
                e1[1] * ca + e2[1] * sa + d[1] * forward,
                e1[2] * ca + e2[2] * sa + d[2] * forward,
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
export const BEAM_FADE = 0.17;

/** Eight screen-space strips: one from each side of the card for up to four cleared rows. */
export function createRowBeams(u) {
    const count = BEAM_ROWS * 2;
    const aRow = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) aRow.set([Math.floor(i / 2), i % 2 ? 1 : -1], i * 2);
    const geometry = gdQuadGeometry(count, { aRow: [aRow, 2] });
    const row = attribute('aRow', 'vec2');
    const uniforms = {
        /** Screen y (fractions, y down) of up to four rows; < 0 = unused. */
        rows: uniform(new THREE.Vector4(-1, -1, -1, -1)),
        /** (card x0, card x1, birth time, strength) */
        frame: uniform(new THREE.Vector4(0.4, 0.6, -100, 0)),
        color: uniform(new THREE.Vector3(1, 1, 1)),
    };
    const material = gdFxMaterial('GeodeRowBeams', { depthTest: false });
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
    const thicknessPx = float(46.0);
    const sy = rowY.add(positionGeometry.y.mul(thicknessPx).div(u.viewport.y));
    material.vertexNode = vec4(sx.mul(2.0).sub(1.0).mul(used), float(1.0).sub(sy.mul(2.0)).mul(used), 0.0, 1.0);
    const vAlong = varying(along, 'gdBeamT');
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
    const part = gdPart('GeodeRowBeams', geometry, material, 60);
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
