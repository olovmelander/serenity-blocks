/**
 * Neon District — gameplay effects that are their own geometry.
 *
 *  - Sparks: every lock throws a fan of sparks out along the wet street from where the piece
 *    landed (they arc, bounce once and skid), and a clear's fronts kick more off the kerbs as
 *    they pass. A ring of preallocated slots; each spark is a closed-form ballistic streak.
 *  - Row beams: the cleared rows fire out of the board — a thin beam from each side of the card
 *    at each cleared row's height, drawn in screen space so it lines up with the row exactly.
 *  - The combo counter: a hologram hanging in the rain beside the board, "×N", punched larger
 *    each time the chain grows.
 *  - The dragon: a four-line clear calls a drone-show dragon out of the vanishing point —
 *    thousands of light drones holding a body, a crest, whiskers, horns and a tail fan — which
 *    swims up the canyon and over the camera. Closed form: every drone's place is a function of
 *    the clock and its seat on the body.
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
    cross,
    exp,
    float,
    floor,
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
    texture,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    TAU,
    mulberry32,
    ndFogAmount,
    ndFxMaterial,
    ndHash11,
    ndHash21,
    ndQuadGeometry,
} from './neon-district-tsl.js';
import { GLYPH_GRID, GLYPH_RANGE } from './neon-district-glyphs.js';

const finish = (name, geometry, material, renderOrder, reflected) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return {
        mesh, material, geometry, reflected,
    };
};

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

// ── Sparks ──────────────────────────────────────────────────────────────────────

const SPARK_GRAVITY = 9.0;
const SPARK_DRAG = 1.5;
const SPARK_BOUNCE = 0.4;

/** Height of a spark `tau` seconds after launch (one bounce, then it skids). CPU twin of the shader. */
export function sparkHeight(vy, tau) {
    const g = SPARK_GRAVITY;
    const tb = Math.max((2 * vy) / g, 0.02);
    if (tau <= tb) return Math.max(0, vy * tau - 0.5 * g * tau * tau);
    const t2 = tau - tb;
    const v2 = vy * SPARK_BOUNCE;
    return Math.max(0, v2 * t2 - 0.5 * g * t2 * t2);
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
    const geometry = ndQuadGeometry(count, { aBirth: [aBirth, 4], aVel: [aVel, 4], aTint: [aTint, 4] });
    ['aBirth', 'aVel', 'aTint'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const birth = attribute('aBirth', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = ndFxMaterial('NeonDistrictSparks');
    const tau = u.time.sub(birth.w);
    const span = vel.w;
    const alive = step(0.0, tau).mul(step(tau, span));
    const at = (t) => {
        const tb = max(vel.y.mul(2 / SPARK_GRAVITY), 0.02);
        const first = step(t, tb);
        const t2 = max(t.sub(tb), 0.0);
        const v2 = vel.y.mul(SPARK_BOUNCE);
        const y1 = vel.y.mul(t).sub(t.mul(t).mul(SPARK_GRAVITY * 0.5));
        const y2 = v2.mul(t2).sub(t2.mul(t2).mul(SPARK_GRAVITY * 0.5));
        const h = float(1.0).sub(exp(t.mul(-SPARK_DRAG))).div(SPARK_DRAG);
        return vec3(
            birth.x.add(vel.x.mul(h)),
            birth.y.add(max(mix(y2, y1, first), 0.0)).add(0.04),
            birth.z.add(u.scroll).add(vel.z.mul(h)),
        );
    };
    // A streak from where the spark was a moment ago to where it is.
    const t = max(tau, 0.0);
    const p1 = at(t);
    const p0 = at(max(t.sub(0.04), 0.0));
    const along = positionGeometry.x.add(0.5);
    const c0 = viewProjection(p0);
    const c1 = viewProjection(p1);
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(c0.w).mul(half);
    const s1 = c1.xy.div(c1.w).mul(half);
    const dir = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(dir.y.negate(), dir.x);
    const clip = mix(c0, c1, along);
    const pxPerMetre = u.viewport.y.mul(0.9).div(max(clip.w, 0.3));
    const widthPx = max(tint.w.mul(pxPerMetre), 1.6).mul(alive);
    // Half a width beyond each end, so the head is round.
    const lead = dir.mul(along.sub(0.5).mul(2.0)).mul(widthPx);
    material.vertexNode = vec4(
        clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).add(lead).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );
    const age = clamp(t.div(max(span, 0.01)), 0.0, 1.0);
    const fade = float(1.0).sub(age).mul(float(1.0).sub(age));
    const hot = mix(vec3(1.0, 0.95, 0.85), tint.rgb, smoothstep(0.0, 0.35, age));
    const vLight = varying(hot.mul(fade).mul(alive).mul(3.0), 'ndSpark');
    material.colorNode = Fn(() => {
        const st = uv();
        const across = float(1.0).sub(abs(st.y.sub(0.5)).mul(2.0));
        const tail = smoothstep(0.0, 0.85, st.x);
        return vec4(vLight.mul(across.mul(across)).mul(tail), 0.0);
    })();

    const part = finish('NeonDistrictSparks', geometry, material, 30, true);
    let cursor = 0;
    let bursts = 0;
    /**
     * Throw `n` sparks from (x, z) on the street. `z` is a world depth now; `scroll` anchors it.
     * `spread` = (min, max) launch speed along the street surface; `up` = (min, max) upward speed.
     */
    part.emit = ({
        x, z, n, rgb, time, scroll, spread = [4, 12], up = [1.2, 4.5], life = [0.5, 1.1], size = 0.035, arc = TAU, heading = 0, y = 0,
        stagger = 0,
    }) => {
        const rand = mulberry32(0x51a7 + bursts * 7919);
        bursts += 1;
        const total = Math.min(n, count);
        for (let k = 0; k < total; k++) {
            const i = cursor % count;
            cursor += 1;
            const a = heading + (rand() - 0.5) * arc;
            const speed = spread[0] + (spread[1] - spread[0]) * rand() ** 1.6;
            aBirth.set([x, y, z - scroll, time + rand() * stagger], i * 4);
            aVel.set([Math.sin(a) * speed, up[0] + (up[1] - up[0]) * rand(), -Math.cos(a) * speed, life[0] + (life[1] - life[0]) * rand()], i * 4);
            const k2 = 0.75 + rand() * 0.5;
            aTint.set([rgb[0] * k2, rgb[1] * k2, rgb[2] * k2, size * (0.6 + rand() * 0.8)], i * 4);
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
export const BEAM_TRAVEL = 0.1;
export const BEAM_FADE = 0.22;

/** Eight screen-space strips: one from each side of the card for up to four cleared rows. */
export function createRowBeams(u) {
    const count = BEAM_ROWS * 2;
    const aRow = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) aRow.set([Math.floor(i / 2), i % 2 ? 1 : -1], i * 2);
    const geometry = ndQuadGeometry(count, { aRow: [aRow, 2] });
    const row = attribute('aRow', 'vec2');
    const uniforms = {
        /** Screen y (fractions, y down) of up to four rows; < 0 = unused. */
        rows: uniform(new THREE.Vector4(-1, -1, -1, -1)),
        /** (card x0, card x1, birth time, strength) */
        frame: uniform(new THREE.Vector4(0.4, 0.6, -100, 0)),
        color: uniform(new THREE.Vector3(1, 1, 1)),
    };
    const material = ndFxMaterial('NeonDistrictRowBeams', { depthTest: false });
    const rowY = mix(mix(uniforms.rows.x, uniforms.rows.y, step(0.5, row.x)), mix(uniforms.rows.z, uniforms.rows.w, step(2.5, row.x)), step(1.5, row.x));
    const used = step(0.0, rowY).mul(step(0.001, uniforms.frame.w));
    const along = positionGeometry.x.add(0.5);
    // From the card's edge out to the edge of the frame.
    const edge = mix(uniforms.frame.x, uniforms.frame.y, step(0.0, row.y));
    const end = step(0.0, row.y);
    const sx = mix(edge, end, along);
    const thicknessPx = float(34.0);
    const sy = rowY.add(positionGeometry.y.mul(thicknessPx).div(u.viewport.y));
    material.vertexNode = vec4(sx.mul(2.0).sub(1.0).mul(used), float(1.0).sub(sy.mul(2.0)).mul(used), 0.0, 1.0);
    const vAlong = varying(along, 'ndBeamT');
    material.colorNode = Fn(() => {
        const age = u.time.sub(uniforms.frame.z);
        const head = age.div(BEAM_TRAVEL);
        const reached = step(vAlong, head);
        const dy = uv().y.sub(0.5).mul(thicknessPx);
        const taper = mix(float(1.5), float(0.7), vAlong);
        const core = exp(dy.mul(dy).div(taper.mul(taper)).negate());
        const glow = exp(abs(dy).mul(-0.26)).mul(0.22);
        const tip = exp(vAlong.sub(head).mul(vAlong.sub(head)).mul(-180.0)).mul(step(head, 1.2));
        const env = exp(max(age.sub(vAlong.mul(BEAM_TRAVEL)), 0.0).div(-BEAM_FADE)).mul(step(0.0, age));
        const k = core.add(glow).mul(reached).mul(env).add(core.add(glow).mul(tip).mul(2.0))
            .mul(uniforms.frame.w)
            .mul(mix(float(1.0), float(0.55), vAlong));
        const col = mix(uniforms.color, vec3(1.0), core.mul(0.7));
        return vec4(col.mul(k).mul(2.6), 0.0);
    })();
    const part = finish('NeonDistrictRowBeams', geometry, material, 60, false);
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

// ── The combo counter ───────────────────────────────────────────────────────────

/** Glyph atlas cells: digits are 0..9, 'X' is 10 + 23. */
const GLYPH_X = 33;

/**
 * A hologram card in the world: "×N". `state` = (combo, shown 0..1, punch 0..1, seconds).
 * @param {object} u
 * @param {THREE.Texture} glyphTex
 */
export function createCounter(u, glyphTex) {
    const geometry = ndQuadGeometry(1, {});
    const uniforms = {
        /** World position of the card's centre, and its height in metres. */
        place: uniform(new THREE.Vector4(-6.6, 8.6, -14, 3.4)),
        /** (combo, shown 0..1, punch 0..1, _) */
        state: uniform(new THREE.Vector4(0, 0, 0, 0)),
    };
    const material = ndFxMaterial('NeonDistrictCounter');
    const shown = uniforms.state.y;
    const punch = uniforms.state.z;
    const size = uniforms.place.w.mul(punch.mul(0.28).add(1.0));
    // Three cells wide ("×", tens, units), camera-facing.
    const clip = viewProjection(uniforms.place.xyz);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(0.9).div(max(clip.w, 0.3));
    const px = vec2(size.mul(2.6), size).mul(pxPerMetre).mul(step(0.004, shown));
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px).div(half).mul(clip.w)), clip.z, clip.w);

    material.colorNode = Fn(() => {
        const st = uv();
        const combo = floor(uniforms.state.x.add(0.5));
        const tens = floor(combo.div(10.0));
        const units = mod(combo, 10.0);
        const twoDigits = step(9.5, combo);
        // One digit: "×N" centred in two cells. Two digits: three cells.
        const cells = twoDigits.add(2.0);
        const gx = st.x.sub(float(1.0).sub(cells.div(3.0)).mul(0.5)).mul(3.0);
        const idx = floor(gx);
        const inside = step(0.0, gx).mul(step(gx, cells.sub(0.001)));
        const id = mix(
            float(GLYPH_X),
            mix(mix(units, tens, twoDigits), units, step(1.5, idx)),
            step(0.5, idx),
        );
        // The "×" is drawn smaller, sitting low, as a multiplier sign.
        const isX = float(1.0).sub(step(0.5, idx));
        const cu = vec2(fract(gx), st.y);
        const guv = mix(cu, cu.sub(vec2(0.5, 0.36)).mul(1.5).add(0.5), isX);
        const gc = vec2(mod(id, GLYPH_GRID), floor(id.div(GLYPH_GRID)));
        const sample = (offset) => float(1.0)
            .sub(texture(glyphTex, gc.add(clamp(guv.add(offset), 0.02, 0.98)).div(GLYPH_GRID)).r).mul(GLYPH_RANGE);
        // A hologram tears: each scanline band slips sideways now and then.
        const band = floor(st.y.mul(26.0));
        const slip = ndHash21(vec2(band, floor(u.time.mul(14.0)))).sub(0.5)
            .mul(step(0.86, ndHash21(vec2(floor(u.time.mul(7.0)), band.add(3.0)))))
            .mul(0.09)
            .add(u.glitch.mul(ndHash11(band.add(floor(u.time.mul(20.0)))).sub(0.5)).mul(0.25));
        const d = sample(vec2(slip, 0.0));
        const dGhost = sample(vec2(slip.add(0.035), 0.0));
        const core = float(1.0).sub(smoothstep(0.03, 0.05, d));
        const halo = exp(d.mul(-11.0)).mul(0.5);
        const ghost = float(1.0).sub(smoothstep(0.03, 0.06, dGhost));
        const scan = sin(st.y.mul(150.0).sub(u.time.mul(9.0))).mul(0.22).add(0.78);
        const flick = sin(u.time.mul(53.0)).mul(0.04).add(0.96);
        const tint = mix(u.accentA, vec3(1.0, 0.72, 0.24), u.heat);
        const rgb = mix(tint, vec3(1.0), 0.55).mul(core.mul(2.2))
            .add(tint.mul(halo))
            .add(u.accentB.mul(ghost).mul(0.5))
            .mul(scan)
            .mul(flick)
            .mul(inside)
            .mul(shown)
            .mul(punch.mul(1.2).add(1.0));
        return vec4(rgb, 0.0);
    })();
    const part = finish('NeonDistrictCounter', geometry, material, 34, true);
    part.uniforms = uniforms;
    return part;
}

// ── The dragon ──────────────────────────────────────────────────────────────────

/** Metres per second, body length, where it leaves the haze and where it is gone. */
export const DRAGON = Object.freeze({
    speed: 30,
    length: 46,
    start: -82,
    travel: 106,
    radius: 1.15,
});

/** The lane the dragon takes when nothing says otherwise: beside the card, on the left. */
export const DRAGON_LANE = Object.freeze([-7.9, 8.6]);
/** ... and the lane over the top of the card, for frames with no room beside it. */
export const DRAGON_OVERHEAD = Object.freeze([0, 21]);

/** Seconds a dragon flight lasts (head leaves the haze → tail passes over the camera). */
export const DRAGON_FLIGHT = (DRAGON.travel + DRAGON.length) / DRAGON.speed;

/**
 * The guide curve the dragon swims along, at `d` metres from its start: out of the haze on the
 * street's centre line, across to its lane (x, height), and up over the camera as it passes.
 * CPU twin of the shader.
 */
export function dragonPath(d, lane = DRAGON_LANE, out = { x: 0, y: 0, z: 0 }) {
    const hermite = (lo, hi, v) => {
        const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
        return t * t * (3 - 2 * t);
    };
    const ease = hermite(0, 46, d);
    const lift = hermite(DRAGON.travel - 34, DRAGON.travel + 6, d);
    out.x = (lane[0] + Math.sin(d * 0.07 + 0.6) * 0.9) * ease;
    out.y = 13 + (lane[1] - 13) * ease + Math.sin(d * 0.05 + 1.9) * 1.3 + lift * 7;
    out.z = DRAGON.start + d;
    return out;
}

/**
 * Drone seats. A drone show draws with LINES of drones, so most of the swarm sits on contours:
 *   0 scales      scattered over the body's skin (the shimmer between the lines)
 *   1 crest       a sawtooth of fins along the spine
 *   2 whiskers    two long tendrils from the snout
 *   3 horns       two swept back from the skull
 *   4 tail fan    five ribs
 *   5 eyes
 *   6 glow        a few big soft cards along the spine (the light the swarm throws on the rain)
 *   7 contours    four lines down the body: spine, belly, both flanks
 *   8 ribs        rings round the body
 *   9 jaws        four lines from the skull to the snout, the lower pair dropped open
 * aSeat = (s along the body 0..1, turn 0..1 round it / line id, q along a line 0..1, twinkle seed).
 */
export const DRAGON_RIBS = 30;
export const DRAGON_FINS = 26;

function dragonSeats(count, seed) {
    const rand = mulberry32(seed);
    const aSeat = new Float32Array(count * 4);
    const aKind = new Float32Array(count);
    const glows = Math.min(40, Math.floor(count * 0.012));
    for (let i = 0; i < count; i++) {
        const r = i / count;
        let kind = 0;
        let s = rand();
        let turn = rand();
        const q = rand();
        if (i < 2) {
            // One eye a side.
            kind = 5;
            s = 0;
            turn = i ? 0.75 : 0.25;
        } else if (i < 2 + glows) {
            kind = 6;
            s = (i - 2 + 0.5) / glows;
        } else if (r < 0.1) kind = 9;
        else if (r < 0.38) kind = 7;
        else if (r < 0.52) {
            kind = 8;
            s = (Math.floor(s * DRAGON_RIBS) + 0.5) / DRAGON_RIBS;
        } else if (r < 0.71) kind = 0;
        else if (r < 0.84) kind = 1;
        else if (r < 0.91) kind = 2;
        else if (r < 0.95) kind = 3;
        else kind = 4;
        aSeat.set([s, turn, q, rand()], i * 4);
        aKind[i] = kind;
    }
    return { aSeat, aKind };
}

/**
 * @param {object} u
 * @param {number} count  drones
 */
export function createDragon(u, count) {
    const { aSeat, aKind } = dragonSeats(count, 0xd7a6);
    const geometry = ndQuadGeometry(count, { aSeat: [aSeat, 4], aKind: [aKind, 1] });
    const seat = attribute('aSeat', 'vec4');
    const kind = floor(attribute('aKind', 'float').add(0.5));
    const uniforms = {
        /** (launch time, strength 0..1, lane x, lane height) */
        flight: uniform(new THREE.Vector4(-100, 0, DRAGON_LANE[0], DRAGON_LANE[1])),
    };
    const material = ndFxMaterial('NeonDistrictDragon');
    const is = (k) => step(k - 0.5, kind).mul(step(kind, k + 0.5));
    const isScale = is(0);
    const isCrest = is(1);
    const isWhisker = is(2);
    const isHorn = is(3);
    const isFan = is(4);
    const isEye = is(5);
    const isGlow = is(6);
    const isContour = is(7);
    const isRib = is(8);
    const isJaw = is(9);
    const onBody = isScale.add(isCrest).add(isGlow).add(isContour).add(isRib);

    const age = u.time.sub(uniforms.flight.x);
    const head = age.mul(DRAGON.speed);
    const path = (d) => {
        const ease = smoothstep(0.0, 46.0, d);
        const lift = smoothstep(DRAGON.travel - 34, DRAGON.travel + 6, d);
        return vec3(
            uniforms.flight.z.add(sin(d.mul(0.07).add(0.6)).mul(0.9)).mul(ease),
            mix(float(13.0), uniforms.flight.w, ease).add(sin(d.mul(0.05).add(1.9)).mul(1.3)).add(lift.mul(7.0)),
            d.add(DRAGON.start),
        );
    };
    const s = seat.x;
    const turn = seat.y;
    const q = seat.z;
    // How far behind the skull (s = 0) this seat rides; the jaws and whiskers start ahead of it.
    const lineId4 = floor(turn.mul(4.0));
    const fanId = floor(turn.mul(5.0)).sub(2.0);
    const back = onBody.mul(s.mul(DRAGON.length))
        .add(isJaw.mul(q.mul(-3.7)))
        .add(isEye.mul(-1.0))
        .add(isWhisker.mul(q.mul(11.0).sub(3.2)))
        .add(isHorn.mul(q.mul(3.6).add(0.2)))
        .add(isFan.mul(q.mul(5.0).add(DRAGON.length)));
    const d = head.sub(back);
    const centre = path(d);
    const T = normalize(path(d.add(0.6)).sub(path(d.sub(0.6))));
    const N = normalize(cross(vec3(0.0, 1.0, 0.0), T));
    const B = cross(T, N);
    // Body profile: a neck behind the skull, a long back, a tapering tail.
    const profile = mix(
        float(0.82),
        mix(float(1.0), float(0.1), smoothstep(0.22, 1.0, s)),
        smoothstep(0.02, 0.16, s),
    );
    const radius = profile.mul(DRAGON.radius);
    const breathe = sin(age.mul(3.2).sub(s.mul(22.0))).mul(0.06).add(1.0);
    const side = mix(float(-1.0), float(1.0), step(0.5, turn));
    const round = (angle, r) => N.mul(cos(angle)).add(B.mul(sin(angle))).mul(r);

    // ── A drone's offset from the spine, by what it is ──
    const skin = round(turn.mul(TAU), radius.mul(breathe));
    const contourAngle = lineId4.mul(Math.PI / 2).add(Math.PI / 4);
    const contour = round(contourAngle, radius.mul(breathe));
    // Fins: a sawtooth along the back, tallest behind the neck.
    const saw = float(1.0).sub(abs(fract(s.mul(DRAGON_FINS)).sub(0.5)).mul(2.0));
    const crest = B.mul(radius.add(saw.mul(1.25).mul(smoothstep(1.0, 0.55, s)).mul(smoothstep(0.0, 0.05, s))));
    // Jaws: four lines converging on the snout; the lower pair hangs open.
    const upper = float(1.0).sub(step(1.5, lineId4));
    const jawSide = mix(float(-1.0), float(1.0), step(0.5, fract(lineId4.mul(0.5))));
    const jawWidth = float(1.0).sub(q).pow(0.7).mul(0.86)
        .add(0.1);
    const brow = sin(q.mul(Math.PI)).mul(0.26);
    const jawUp = float(1.0).sub(q.mul(0.5)).mul(0.6).add(brow);
    const jawDown = float(1.0).sub(q).mul(0.5).add(q.mul(1.25))
        .negate();
    const jaw = N.mul(jawSide.mul(jawWidth).mul(mix(float(0.85), float(1.0), upper)))
        .add(B.mul(mix(jawDown, jawUp, upper)));
    const whisker = N.mul(side.mul(q.mul(2.6).add(0.3)))
        .add(B.mul(sin(q.mul(7.0).sub(age.mul(5.0)).add(side)).mul(q).mul(0.75).add(0.1)));
    const horn = N.mul(side.mul(q.mul(0.7).add(0.5))).add(B.mul(q.mul(2.3).add(0.75)));
    const fan = N.mul(fanId.mul(0.34).mul(q).mul(4.2))
        .add(B.mul(sin(fanId.add(age.mul(4.0))).mul(0.35).mul(q)));
    const eye = N.mul(side.mul(0.66)).add(B.mul(0.74));
    const offset = skin.mul(isScale.add(isRib))
        .add(contour.mul(isContour))
        .add(crest.mul(isCrest))
        .add(jaw.mul(isJaw))
        .add(whisker.mul(isWhisker))
        .add(horn.mul(isHorn))
        .add(fan.mul(isFan))
        .add(eye.mul(isEye));
    const world = centre.add(offset);

    // Out of the haze, over the camera, gone.
    const born = smoothstep(0.0, 14.0, d);
    const gone = float(1.0).sub(smoothstep(6.0, 22.0, world.z));
    const flying = step(0.0, age).mul(step(age, DRAGON_FLIGHT + 0.6)).mul(uniforms.flight.y);
    const live = born.mul(gone).mul(flying);

    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(0.9).div(max(clip.w, 0.3));
    const sizeM = mix(mix(mix(float(0.13), float(0.17), isScale), float(0.42), isEye), float(6.0), isGlow);
    const sizePx = max(sizeM.mul(pxPerMetre), 1.7);
    material.vertexNode = vec4(
        clip.xy.add(positionGeometry.xy.mul(sizePx.mul(step(0.002, live))).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );

    // Colour: gold lines, rose ribs, a cyan crest, a white-hot head, white whiskers and horns.
    const gold = vec3(1.0, 0.7, 0.22);
    const hot = vec3(1.0, 0.95, 0.85);
    const rose = u.accentB.mul(0.85).add(0.15);
    const belly = step(1.5, lineId4).mul(step(lineId4, 2.5));
    const col = gold.mul(isScale).mul(0.75)
        .add(mix(gold, rose, belly.mul(0.7)).mul(isContour).mul(1.25))
        .add(mix(rose, gold, 0.35).mul(isRib))
        .add(mix(u.accentA, vec3(1.0), 0.2).mul(isCrest).mul(1.25))
        .add(hot.mul(isJaw.add(isWhisker).add(isHorn)).mul(1.3))
        .add(mix(u.accentA, rose, q).mul(isFan))
        .add(vec3(0.6, 1.0, 1.0).mul(isEye).mul(4.5))
        .add(gold.mul(isGlow).mul(0.045));
    // A wave of light runs down the body from the head.
    const wave = sin(s.mul(26.0).sub(age.mul(9.0))).mul(0.5).add(0.5);
    const shimmer = mix(float(1.0), wave.mul(0.8).add(0.45), onBody);
    const twinkle = sin(u.time.mul(seat.w.mul(9.0).add(5.0)).add(seat.w.mul(60.0))).mul(0.22).add(0.78);
    const dist = length(world.sub(cameraPosition));
    const through = float(1.0).sub(ndFogAmount(dist, world.y).mul(0.8));
    // Spread over at least 1.7 px: keep a floor so the far dragon still reads as lines of light.
    const energy = sizeM.mul(pxPerMetre).div(sizePx);
    const vLight = varying(
        col.mul(live).mul(twinkle).mul(shimmer).mul(through)
            .mul(energy.mul(energy).mul(0.65).add(0.35))
            .mul(2.4),
        'ndDragon',
    );
    const vSoft = varying(isGlow, 'ndDragonSoft');
    material.colorNode = Fn(() => {
        const p = uv().sub(0.5).mul(2.0);
        const r2 = p.dot(p);
        const drone = exp(r2.mul(-7.0)).sub(0.001).max(0.0);
        const soft = exp(r2.mul(-3.0)).sub(0.05).max(0.0);
        return vec4(vLight.mul(mix(drone, soft, vSoft)), 0.0);
    })();
    const part = finish('NeonDistrictDragon', geometry, material, 32, true);
    part.uniforms = uniforms;
    part.launch = (time, strength = 1, lane = DRAGON_LANE) => {
        uniforms.flight.value.set(time, strength, lane[0], lane[1]);
    };
    part.reset = () => {
        uniforms.flight.value.set(-100, 0, DRAGON_LANE[0], DRAGON_LANE[1]);
    };
    part.count = count;
    return part;
}

/** The z at which a clear's kerb sparks are thrown, per spark index (near field, both kerbs). */
export function kerbSparkDepth(k, n) {
    return -4 - ((k + 0.5) / n) * 44;
}
