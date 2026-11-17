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
 *  - The dragon: a four-line clear calls a drone-show dragon into the street — thousands of
 *    light drones holding a body, a crest, a mane, antlers, whiskers, legs and a tail fan — and
 *    it never flies the same way twice (neon-district-dragon.js plans each flight). Closed form:
 *    every drone's place is a function of the clock, its seat on the body and the flight's curve.
 *
 *  - The strike: a hard drop comes down out of the smog as a thin column of light.
 *  - The gyre: a twist sends spinning hoops of light away up the canyon.
 *  - Fireworks: a new level and a perfect clear send rockets up between the walls.
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
    int,
    ivec2,
    length,
    max,
    min,
    mix,
    mod,
    normalize,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    step,
    texture,
    textureLoad,
    uniform,
    uniformArray,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    STREET,
    TAU,
    mulberry32,
    ndFogAmount,
    ndFxMaterial,
    ndHash11,
    ndHash21,
    ndQuadGeometry,
} from './neon-district-tsl.js';
import { GLYPH_GRID, GLYPH_RANGE } from './neon-district-glyphs.js';
import {
    DRAGON_BODY, DRAGON_CONTOURS, DRAGON_FINS, DRAGON_HEAD, DRAGON_KIND, DRAGON_KNOTS, DRAGON_RIBS,
    DRAGON_STRANDS, dragonSeats,
} from './neon-district-dragon.js';
import { ndGlyphFootprint } from './neon-district-text.js';

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
        const foot = ndGlyphFootprint(guv);
        const sample = (offset) => float(1.0)
            .sub(texture(glyphTex, gc.add(clamp(guv.add(offset), 0.02, 0.98)).div(GLYPH_GRID)).grad(foot.gx, foot.gy).r)
            .mul(GLYPH_RANGE);
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

// ── The strike (a hard drop) ────────────────────────────────────────────────────

/** Seconds a strike's column burns, and how tall it stands (metres). */
export const STRIKE_LIFE = 0.34;
export const STRIKE_HEIGHT = 16;
export const STRIKE_SLOTS = 2;

/**
 * A hard drop's shock breaks against the kerbs: where its ring meets them, either side of the
 * board, a column of light stands up out of the street in the piece's colour, there for a third
 * of a second. (The landing itself is under the card; the kerbs are what the frame shows.) It is
 * thin, never a flash across the frame.
 */
export function createStrike(u) {
    const aSlot = new Float32Array(STRIKE_SLOTS);
    for (let i = 0; i < STRIKE_SLOTS; i++) aSlot[i] = i;
    const geometry = ndQuadGeometry(STRIKE_SLOTS, { aSlot: [aSlot, 1] });
    const rows = Array.from({ length: STRIKE_SLOTS * 2 }, () => new THREE.Vector4(0, 0, -100, 0));
    const table = uniformArray(rows, 'vec4');
    const slot = int(floor(attribute('aSlot', 'float').add(0.5)));
    /** (x, z − scroll at birth, birth time, strength) and the colour. */
    const A = table.element(slot.mul(2));
    const C = table.element(slot.mul(2).add(1)).xyz;
    const material = ndFxMaterial('NeonDistrictStrike');
    const age = u.time.sub(A.z);
    const alive = step(0.0, age).mul(step(age, STRIKE_LIFE)).mul(step(0.001, A.w));
    const foot = vec3(A.x, 0.05, A.y.add(u.scroll));
    const world = foot.add(vec3(0.0, positionGeometry.y.add(0.5).mul(STRIKE_HEIGHT), 0.0));
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(0.9).div(max(clip.w, 0.3));
    const widthPx = max(float(1.1).mul(pxPerMetre), 14.0).mul(alive);
    material.vertexNode = vec4(clip.xy.add(vec2(positionGeometry.x.mul(widthPx), 0.0).div(half).mul(clip.w)), clip.z, clip.w);
    const vLight = varying(C.mul(A.w).mul(alive), 'ndStrike');
    const vAge = varying(age.div(STRIKE_LIFE), 'ndStrikeAge');
    material.colorNode = Fn(() => {
        const st = uv();
        const across = st.x.sub(0.5).mul(2.0);
        // The column stands up out of the street in the first sixth of its life, then thins and dies.
        const reached = step(st.y, vAge.mul(6.0));
        const fade = float(1.0).sub(vAge);
        const core = exp(across.mul(across).mul(mix(float(140.0), float(420.0), vAge)).negate());
        const glow = exp(abs(across).mul(-5.5)).mul(0.2);
        // Brightest at the foot, where it lands.
        const fall = exp(st.y.mul(-3.0)).mul(0.85).add(0.15).mul(float(1.0).sub(smoothstep(0.7, 1.0, st.y)));
        const k = core.add(glow).mul(reached).mul(fade.mul(fade)).mul(fall);
        return vec4(mix(vLight, vec3(1.0), core.mul(0.6)).mul(k).mul(2.2), 0.0);
    })();
    const part = finish('NeonDistrictStrike', geometry, material, 31, true);
    let cursor = 0;
    /** A column at (x, z) on the street (`z` a world depth now; `scroll` anchors it). */
    part.fire = (x, z, rgb, time, scroll, strength = 1) => {
        const i = cursor % STRIKE_SLOTS;
        cursor += 1;
        rows[i * 2].set(x, z - scroll, time, strength);
        rows[i * 2 + 1].set(rgb[0], rgb[1], rgb[2], 0);
    };
    part.reset = () => {
        for (let i = 0; i < STRIKE_SLOTS; i++) rows[i * 2].set(0, 0, -100, 0);
        cursor = 0;
    };
    part.table = rows;
    return part;
}

// ── The gyre (a twist) ──────────────────────────────────────────────────────────

/** Hoops in a gyre, dashes in a hoop, seconds one lives, and how far it runs up the street. */
export const GYRE_HOOPS = 3;
export const GYRE_DASHES = 56;
export const GYRE_LIFE = 1.5;
export const GYRE_RUN = 52;

/** How far up the street a gyre's first hoop is, `age` seconds after the twist. CPU twin. */
export function gyreDepth(age) {
    return 5 + GYRE_RUN * (1 - Math.exp(-Math.max(0, age) * 1.7));
}

/**
 * A twist turns the circuit over: hoops of light, spinning, run away up the canyon round its
 * walls, the road and the air overhead, one behind another, in the turn's own direction.
 */
export function createGyre(u) {
    const count = GYRE_HOOPS * GYRE_DASHES;
    const aDash = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) aDash.set([Math.floor(i / GYRE_DASHES), (i % GYRE_DASHES) / GYRE_DASHES], i * 2);
    const geometry = ndQuadGeometry(count, { aDash: [aDash, 2] });
    const dash = attribute('aDash', 'vec2');
    const uniforms = {
        /** (birth time, strength, which way it turns ±1, _) */
        turn: uniform(new THREE.Vector4(-100, 0, 1, 0)),
    };
    const material = ndFxMaterial('NeonDistrictGyre');
    const hoop = floor(dash.x.add(0.5));
    // Each hoop leaves a beat after the one before.
    const age = u.time.sub(uniforms.turn.x).sub(hoop.mul(0.13));
    const alive = step(0.0, age).mul(step(age, GYRE_LIFE)).mul(step(0.001, uniforms.turn.y));
    const depth = float(GYRE_RUN).mul(float(1.0).sub(exp(max(age, 0.0).mul(-1.7)))).add(5.0);
    const spin = uniforms.turn.z.mul(age.mul(float(5.2).sub(hoop.mul(0.9))).add(hoop.mul(1.3)));
    const at = (a) => vec3(
        cos(a).mul(STREET.halfStreet - 0.9),
        sin(a).mul(8.2).add(8.9),
        depth.negate(),
    );
    const angle = dash.y.mul(TAU).add(spin);
    const p0 = at(angle);
    const p1 = at(angle.add(TAU / GYRE_DASHES));
    const along = positionGeometry.x.add(0.5);
    const c0 = viewProjection(p0);
    const c1 = viewProjection(p1);
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(max(c0.w, 0.3)).mul(half);
    const s1 = c1.xy.div(max(c1.w, 0.3)).mul(half);
    const dir = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(dir.y.negate(), dir.x);
    const clip = mix(c0, c1, along);
    const pxPerMetre = u.viewport.y.mul(0.9).div(max(clip.w, 0.3));
    const widthPx = max(float(0.3).mul(pxPerMetre), 2.6).mul(alive);
    material.vertexNode = vec4(clip.xy.add(nrm.mul(positionGeometry.y.mul(widthPx)).div(half).mul(clip.w)), clip.z, clip.w);
    const life = clamp(age.div(GYRE_LIFE), 0.0, 1.0);
    // A hoop is not lit all the way round: two bright arcs chase each other, so the turn reads.
    const arc = pow(max(sin(dash.y.mul(TAU).mul(2.0)), 0.0), 2.0).mul(0.94).add(0.06);
    const tint = mix(u.accentB, u.accentA, sin(dash.y.mul(TAU)).mul(0.5).add(0.5));
    const through = float(1.0).sub(ndFogAmount(depth, float(8.0)).mul(0.7));
    const fade = float(1.0).sub(life);
    const vLight = varying(
        mix(tint, vec3(1.0), 0.25).mul(arc).mul(fade.mul(fade)).mul(alive)
            .mul(uniforms.turn.y)
            .mul(through)
            .mul(3.2),
        'ndGyre',
    );
    material.colorNode = Fn(() => {
        const across = uv().y.sub(0.5).mul(2.0);
        return vec4(vLight.mul(exp(across.mul(across).mul(-6.0))), 0.0);
    })();
    const part = finish('NeonDistrictGyre', geometry, material, 33, false);
    part.uniforms = uniforms;
    part.fire = (time, strength = 1, way = 1) => {
        uniforms.turn.value.set(time, strength, way < 0 ? -1 : 1, 0);
    };
    part.reset = () => {
        uniforms.turn.value.set(-100, 0, 1, 0);
    };
    return part;
}

// ── Fireworks (a new level, a perfect clear) ────────────────────────────────────

export const FIREWORK_SHELLS = 6;
/** Seconds a rocket climbs before it bursts, and a burst hangs before it is gone. */
export const FIREWORK_RISE = 0.6;
export const FIREWORK_LIFE = 2.3;
const FIREWORK_CLIMB = 15;

/** How far a star of a burst is from its centre, as a share of the burst's radius. CPU twin. */
export function fireworkSpread(age) {
    return 1 - Math.exp(-Math.max(0, age) * 3.4);
}

/**
 * Fireworks between the walls: a rocket climbs out of the street and bursts into a ball of stars
 * that hang, droop and go out, and the wet road shows every one of them again. Closed form: a
 * shell is four numbers (where and when) and a colour; its stars are seats on a sphere.
 * @param {object} u
 * @param {number} stars  per shell
 */
export function createFireworks(u, stars) {
    const count = FIREWORK_SHELLS * stars;
    const aStar = new Float32Array(count * 4);
    const aWhich = new Float32Array(count * 2);
    const rand = mulberry32(0xf12e);
    for (let i = 0; i < count; i++) {
        // Even on the sphere, with a little scatter.
        const z = rand() * 2 - 1;
        const a = rand() * TAU;
        const r = Math.sqrt(Math.max(0, 1 - z * z));
        aStar.set([Math.cos(a) * r, z, Math.sin(a) * r, rand()], i * 4);
        // (shell, what it is: 0 the rocket, 1 a star)
        aWhich.set([Math.floor(i / stars), i % stars === 0 ? 0 : 1], i * 2);
    }
    const geometry = ndQuadGeometry(count, { aStar: [aStar, 4], aWhich: [aWhich, 2] });
    const star = attribute('aStar', 'vec4');
    const which = attribute('aWhich', 'vec2');
    const rows = Array.from({ length: FIREWORK_SHELLS * 2 }, () => new THREE.Vector4(0, 0, 0, -100));
    const table = uniformArray(rows, 'vec4');
    /** How bright a burst's flash is (the world scales it by the reduce-flashing setting). */
    const flashGain = uniform(1);
    const shell = int(floor(which.x.add(0.5)));
    /** (x, y, z, when it bursts) and (colour, radius). */
    const A = table.element(shell.mul(2));
    const C = table.element(shell.mul(2).add(1));
    const isStar = step(0.5, which.y);
    const material = ndFxMaterial('NeonDistrictFireworks');
    const age = u.time.sub(A.w);
    const burst = max(age, 0.0);
    const spread = float(1.0).sub(exp(burst.mul(-3.4)));
    // A star: out from the centre, slowing, then drooping; a few are flung further.
    const reach = C.w.mul(star.w.mul(0.35).add(0.75));
    const starAt = A.xyz.add(star.xyz.mul(reach).mul(spread)).sub(vec3(0.0, burst.mul(burst).mul(0.75), 0.0));
    // The rocket: up to the centre over FIREWORK_RISE, slowing as it tops out.
    const climb = clamp(age.div(FIREWORK_RISE).add(1.0), 0.0, 1.0);
    const rocketAt = A.xyz.sub(vec3(0.0, float(FIREWORK_CLIMB).mul(float(1.0).sub(climb)).mul(float(1.0).sub(climb)), 0.0));
    const world = mix(rocketAt, starAt, isStar);
    const starLive = step(0.0, age).mul(step(age, FIREWORK_LIFE));
    const rocketLive = step(-FIREWORK_RISE, age).mul(step(age, 0.5));
    const live = mix(rocketLive, starLive, isStar).mul(step(-50.0, A.w));
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(0.9).div(max(clip.w, 0.3));
    // A star is drawn out along its flight while it is fast (the streaks of a fresh burst).
    const ahead = viewProjection(world.add(mix(vec3(0.0, 1.0, 0.0), star.xyz, isStar).mul(0.25)));
    const run = ahead.xy.div(max(ahead.w, 0.3)).sub(clip.xy.div(max(clip.w, 0.3))).mul(half);
    const along = normalize(run.add(vec2(1e-4, 0.0)));
    const across = vec2(along.y.negate(), along.x);
    // (the rocket, once it has burst, is the flash of the burst: a wide soft card that dies fast)
    const flash = step(0.0, age).mul(float(1.0).sub(isStar));
    const sizePx = max(mix(mix(float(0.18), C.w.mul(2.6), flash), float(0.15), isStar).mul(pxPerMetre), 1.8);
    const flown = mix(float(1.2), reach.mul(exp(burst.mul(-3.4))).mul(0.7), isStar);
    const lengthPx = max(sizePx, min(flown.mul(length(run)).mul(4.0), 90.0).mul(float(1.0).sub(flash)));
    material.vertexNode = vec4(
        clip.xy.add(
            along.mul(positionGeometry.x.mul(lengthPx)).add(across.mul(positionGeometry.y.mul(sizePx)))
                .mul(step(0.5, live)).div(half)
                .mul(clip.w),
        ),
        clip.z,
        clip.w,
    );
    const life = clamp(burst.div(FIREWORK_LIFE), 0.0, 1.0);
    // White as it bursts, its own colour as it hangs, glittering as it dies.
    const glitter = sin(u.time.mul(star.w.mul(21.0).add(17.0)).add(star.w.mul(90.0))).mul(0.5).add(0.5);
    const dying = mix(float(1.0), glitter, smoothstep(0.35, 0.9, life));
    const fade = float(1.0).sub(life);
    const starCol = mix(vec3(1.0, 0.96, 0.9), C.xyz, smoothstep(0.0, 0.14, life)).mul(fade).mul(dying).mul(3.0);
    const rocketCol = mix(
        vec3(1.0, 0.85, 0.6).mul(climb.mul(0.7).add(0.3)).mul(1.6),
        mix(C.xyz, vec3(1.0), 0.4).mul(exp(burst.mul(-8.0))).mul(flashGain.mul(0.3)),
        flash,
    );
    const dist = length(world.sub(cameraPosition));
    const through = float(1.0).sub(ndFogAmount(dist, world.y).mul(0.75));
    const vLight = varying(mix(rocketCol, starCol, isStar).mul(live).mul(through), 'ndFirework');
    const vFlash = varying(flash, 'ndFireworkFlash');
    material.colorNode = Fn(() => {
        const p = uv().sub(0.5).mul(2.0);
        const window = max(float(1.0).sub(p.x.mul(p.x)), 0.0);
        const streak = exp(p.y.mul(p.y).mul(-6.0)).mul(window.mul(window));
        const soft = exp(p.dot(p).mul(-3.2)).sub(0.04).max(0.0);
        return vec4(vLight.mul(mix(streak, soft, vFlash)), 0.0);
    })();
    const part = finish('NeonDistrictFireworks', geometry, material, 33, true);
    let cursor = 0;
    /**
     * A shell that bursts at (x, y, z) at `time` (its rocket climbs before that). `gain` scales
     * the soft flash of the burst (the stars are not a flash: they are small and they hang).
     */
    part.fire = (x, y, z, time, rgb, radius = 4.5, gain = 1) => {
        flashGain.value = gain;
        const i = cursor % FIREWORK_SHELLS;
        cursor += 1;
        rows[i * 2].set(x, y, z, time);
        rows[i * 2 + 1].set(rgb[0], rgb[1], rgb[2], radius);
    };
    part.reset = () => {
        for (let i = 0; i < FIREWORK_SHELLS; i++) rows[i * 2].set(0, 0, 0, -100);
        cursor = 0;
    };
    part.table = rows;
    part.count = count;
    return part;
}

// ── The dragon ──────────────────────────────────────────────────────────────────

/** Dragons that can be in the street at once (a perfect clear calls two), and their table rows. */
export const DRAGON_SLOTS = 2;
const DRAGON_ROWS = 8;
const ROW = Object.freeze({
    flight: 0, // (head arc length, light 0..~1.7, body scale, knot spacing)
    motion: 1, // (seconds in flight, head speed, jaws open 0..1, arc length the curve ends at)
    burst: 2, // (how far the swarm has left its seats 0..1, the cloud's turn, its radius, body length)
    cloud: 3, // (where the cloud hangs)
    body: 4,
    belly: 5,
    crest: 6,
    hot: 7,
});

/**
 * The drone-show dragon. Every drone has a seat on the body (neon-district-dragon.js:
 * dragonSeats) and the body rides a curve the flight planner baked into a float texture: one row
 * of knots and one of frames for each of the DRAGON_SLOTS dragons this one mesh can fly. A
 * drone's place is its seat on the curve, or, while the swarm is burst apart, its own place in
 * the cloud; nothing is simulated, so any frame can be drawn from the clock alone.
 * @param {object} u
 * @param {number} count  drones in one dragon
 */
export function createDragon(u, count) {
    const total = count * DRAGON_SLOTS;
    const aSeat = new Float32Array(total * 4);
    const aKind = new Float32Array(total * 2);
    for (let w = 0; w < DRAGON_SLOTS; w++) {
        const seats = dragonSeats(count, 0xd7a6 + w * 0x1f3);
        aSeat.set(seats.aSeat, w * count * 4);
        for (let i = 0; i < count; i++) aKind.set([seats.aKind[i], w], (w * count + i) * 2);
    }
    const geometry = ndQuadGeometry(total, { aSeat: [aSeat, 4], aKind: [aKind, 2] });
    const seat = attribute('aSeat', 'vec4');
    const kindWho = attribute('aKind', 'vec2');
    const kind = floor(kindWho.x.add(0.5));
    const who = floor(kindWho.y.add(0.5));

    // The curves: per dragon a row of knots and a row of frames. Read by index, never filtered.
    const pathData = new Float32Array(DRAGON_KNOTS * DRAGON_SLOTS * 2 * 4);
    const pathTex = new THREE.DataTexture(pathData, DRAGON_KNOTS, DRAGON_SLOTS * 2, THREE.RGBAFormat, THREE.FloatType);
    pathTex.minFilter = THREE.NearestFilter;
    pathTex.magFilter = THREE.NearestFilter;
    pathTex.generateMipmaps = false;
    pathTex.colorSpace = THREE.NoColorSpace;
    pathTex.name = 'neon-district-dragon-paths';
    pathTex.needsUpdate = true;

    const rows = Array.from({ length: DRAGON_SLOTS * DRAGON_ROWS }, () => new THREE.Vector4(0, 0, 1, 1));
    const table = uniformArray(rows, 'vec4');
    const base = int(who).mul(DRAGON_ROWS);
    const row = (k) => table.element(base.add(k));
    const F = row(ROW.flight);
    const M = row(ROW.motion);
    const Bu = row(ROW.burst);
    const cloudAt = row(ROW.cloud).xyz;
    const cBody = row(ROW.body).xyz;
    const cBelly = row(ROW.belly).xyz;
    const cCrest = row(ROW.crest).xyz;
    const cHot = row(ROW.hot).xyz;
    const head = F.x;
    const strength = F.y;
    const sc = F.z;
    const spacing = F.w;
    const age = M.x;
    const speed = M.y;
    const jawOpen = M.z;
    const endArc = M.w;
    const amount = Bu.x;
    const swirl = Bu.y;
    const cloudR = Bu.z;
    const bodyL = Bu.w;

    const material = ndFxMaterial('NeonDistrictDragon');
    const K = DRAGON_KIND;
    const is = (k) => step(k - 0.5, kind).mul(step(kind, k + 0.5));
    const isScale = is(K.scale);
    const isCrest = is(K.crest);
    const isWhisker = is(K.whisker);
    const isHorn = is(K.horn);
    const isFan = is(K.fan);
    const isEye = is(K.eye);
    const isGlow = is(K.glow);
    const isContour = is(K.contour);
    const isRib = is(K.rib);
    const isJaw = is(K.jaw);
    const isMane = is(K.mane);
    const isLeg = is(K.leg);
    const isEmber = is(K.ember);
    const onBody = isScale.add(isCrest).add(isGlow).add(isContour).add(isRib)
        .add(isEmber);

    const s = seat.x;
    const turn = seat.y;
    const q = seat.z;
    const side = mix(float(-1.0), float(1.0), step(0.5, turn));

    // ── How far behind the skull (s = 0) this seat rides; the snout and whiskers lead it ──
    const fork = step(0.5, seat.w); // an antler's tine (the seat says which drones are on it)
    const hornQ = mix(q, float(0.5), fork);
    const legId = floor(turn.mul(4.0));
    const hind = step(1.5, legId);
    const legSide = mix(float(-1.0), float(1.0), step(0.5, fract(legId.mul(0.5))));
    const limb = clamp(q.div(0.6), 0.0, 1.0);
    const claw = clamp(q.sub(0.6).div(0.4), 0.0, 1.0);
    const paddle = sin(age.mul(5.0).add(legId.mul(1.7))).mul(0.45);
    // An ember hangs where the body let it go: it falls behind by what the body has flown since.
    const emberAge = fract(seat.w.add(age.mul(0.9))).mul(1.1);
    // The head is drawn larger than the body it leads: it is what makes the swarm a dragon.
    const hs = sc.mul(DRAGON_HEAD);
    const back = onBody.mul(s.mul(bodyL))
        .add(isEmber.mul(speed.mul(emberAge)))
        .add(hs.mul(
            isJaw.mul(q.mul(-3.9))
                .add(isEye.mul(-1.0))
                .add(isWhisker.mul(q.mul(7.5).sub(3.4)))
                .add(isHorn.mul(hornQ.mul(3.6).add(0.2).sub(fork.mul(q).mul(1.5))))
                .add(isMane.mul(q.mul(4.6).add(0.1))),
        ))
        .add(sc.mul(isLeg.mul(limb.mul(paddle.add(1.1)).sub(claw.mul(0.7)))))
        .add(isLeg.mul(mix(float(0.17), float(0.5), hind)).mul(bodyL))
        .add(isFan.mul(bodyL.add(q.mul(5.0).mul(sc))));
    const d = head.sub(back);

    // ── The curve under this seat: uniform Catmull–Rom over four knots, and its frame ──
    const f = clamp(d.div(spacing), 0.0, DRAGON_KNOTS - 1.001);
    const fi = floor(f);
    const ft = f.sub(fi);
    const knotRow = int(who).mul(2);
    const knot = (offset) => textureLoad(pathTex, ivec2(int(clamp(fi.add(offset), 0.0, DRAGON_KNOTS - 1)), knotRow)).xyz;
    const frameOf = (offset) => textureLoad(pathTex, ivec2(int(clamp(fi.add(offset), 0.0, DRAGON_KNOTS - 1)), knotRow.add(1))).xyz;
    const k0 = knot(-1);
    const k1 = knot(0);
    const k2 = knot(1);
    const k3 = knot(2);
    const t2 = ft.mul(ft);
    const t3 = t2.mul(ft);
    const centre = k0.mul(t3.mul(-0.5).add(t2).sub(ft.mul(0.5)))
        .add(k1.mul(t3.mul(1.5).sub(t2.mul(2.5)).add(1.0)))
        .add(k2.mul(t3.mul(-1.5).add(t2.mul(2.0)).add(ft.mul(0.5))))
        .add(k3.mul(t3.mul(0.5).sub(t2.mul(0.5))));
    const slope = k0.mul(t2.mul(-1.5).add(ft.mul(2.0)).sub(0.5))
        .add(k1.mul(t2.mul(4.5).sub(ft.mul(5.0))))
        .add(k2.mul(t2.mul(-4.5).add(ft.mul(4.0)).add(0.5)))
        .add(k3.mul(t2.mul(1.5).sub(ft)));
    // Never a zero vector: where two knots coincide (the end of the curve) the slope is nothing.
    const T = normalize(slope.add(vec3(0.0, 0.0, 1e-4)));
    const lean = mix(frameOf(0), frameOf(1), ft);
    const N = normalize(lean.sub(T.mul(lean.dot(T))).add(vec3(1e-4, 0.0, 0.0)));
    const B = cross(T, N);

    // Body profile: a neck behind the skull, a long back, a tapering tail.
    const profile = mix(
        float(0.82),
        mix(float(1.0), float(0.1), smoothstep(0.22, 1.0, s)),
        smoothstep(0.02, 0.16, s),
    );
    const radius = profile.mul(DRAGON_BODY.radius).mul(sc);
    const breathe = sin(age.mul(3.2).sub(s.mul(22.0))).mul(0.06).add(1.0);
    const round = (angle, r) => N.mul(cos(angle)).add(B.mul(sin(angle))).mul(r);

    // ── A drone's offset from the spine, by what it is (metres at scale 1, then scaled) ──
    const skin = round(turn.mul(TAU), radius.mul(breathe));
    const lineId = floor(turn.mul(DRAGON_CONTOURS));
    const contour = round(lineId.add(0.5).mul(TAU / DRAGON_CONTOURS), radius.mul(breathe));
    // Fins: a sawtooth along the back, tallest behind the neck.
    const saw = float(1.0).sub(abs(fract(s.mul(DRAGON_FINS)).sub(0.5)).mul(2.0));
    const crest = B.mul(radius.add(saw.mul(1.35).mul(sc).mul(smoothstep(1.0, 0.55, s)).mul(smoothstep(0.0, 0.05, s))));
    // Jaws: four lines converging on the snout; the lower pair hangs open, wider in a roar.
    const jawLine = floor(turn.mul(4.0));
    const upper = float(1.0).sub(step(1.5, jawLine));
    const jawSide = mix(float(-1.0), float(1.0), step(0.5, fract(jawLine.mul(0.5))));
    const jawWidth = pow(max(float(1.0).sub(q), 0.0), 0.7).mul(0.86).add(0.1);
    const brow = sin(q.mul(Math.PI)).mul(0.26);
    const jawUp = float(1.0).sub(q.mul(0.5)).mul(0.6).add(brow);
    const jawDown = float(1.0).sub(q).mul(0.5).add(q.mul(jawOpen.mul(1.5).add(0.35)))
        .negate();
    const jaw = N.mul(jawSide.mul(jawWidth).mul(mix(float(0.85), float(1.0), upper)))
        .add(B.mul(mix(jawDown, jawUp, upper)));
    const whisker = N.mul(side.mul(q.mul(2.3).add(0.3)))
        .add(B.mul(sin(q.mul(6.0).sub(age.mul(5.0)).add(side)).mul(q).mul(0.9).sub(q.mul(0.5))
            .add(0.1)));
    // Antlers: a beam swept back, and a tine that leaves it halfway and reaches forward.
    const horn = N.mul(side.mul(hornQ.mul(0.7).add(0.5).add(fork.mul(q).mul(0.75))))
        .add(B.mul(hornQ.mul(2.3).add(0.75).add(fork.mul(q).mul(0.7))));
    const fanId = floor(turn.mul(5.0)).sub(2.0);
    const fan = N.mul(fanId.mul(0.34).mul(q).mul(4.2))
        .add(B.mul(sin(fanId.add(age.mul(4.0))).mul(0.35).mul(q)));
    const eye = N.mul(side.mul(0.66)).add(B.mul(0.74));
    // The mane: strands off the top and sides of the neck, streaming back and out, waving.
    const maneAngle = turn.sub(0.5).mul(2.8).add(Math.PI / 2);
    const mane = N.mul(cos(maneAngle)).add(B.mul(sin(maneAngle))).mul(q.mul(1.25).add(1.02))
        .add(B.mul(sin(q.mul(5.0).sub(age.mul(6.0)).add(turn.mul(19.0))).mul(q).mul(0.3)));
    // Legs: down and out from the flank, the foot trailing; three claws spread from it.
    const clawId = floor(seat.w.mul(3.0)).sub(1.0);
    const leg = N.mul(legSide.mul(float(0.9).add(sin(limb.mul(1.5)).mul(0.6)).add(clawId.mul(claw).mul(0.3))))
        .add(B.mul(limb.mul(-1.45).sub(0.45).sub(claw.mul(0.3))));
    // Embers leave the skin and rise a little as they die.
    const ember = skin.mul(emberAge.mul(0.5).add(1.15)).add(vec3(0.0, 1.0, 0.0).mul(emberAge.mul(0.9).mul(sc)));
    // The body swims: a wave runs down it, wider toward the tail.
    const wag = smoothstep(0.04, 0.5, s).mul(onBody.add(isLeg.mul(0.5)).add(isFan));
    const swim = N.mul(sin(back.div(sc).mul(0.34).sub(age.mul(4.4))).mul(0.3))
        .add(B.mul(sin(back.div(sc).mul(0.23).sub(age.mul(3.1)).add(1.3)).mul(0.16)))
        .mul(wag)
        .mul(sc);
    const offset = skin.mul(isScale.add(isRib))
        .add(contour.mul(isContour))
        .add(crest.mul(isCrest))
        .add(ember.mul(isEmber))
        .add(fan.mul(isFan).mul(sc))
        .add(
            jaw.mul(isJaw)
                .add(whisker.mul(isWhisker))
                .add(horn.mul(isHorn))
                .add(eye.mul(isEye))
                .add(mane.mul(isMane))
                .mul(hs),
        )
        .add(leg.mul(isLeg).mul(sc).mul(mix(float(1.0), float(0.8), hind)));
    const seated = centre.add(offset).add(swim);

    // ── The cloud: where this drone hangs while the swarm is burst apart ──
    const h1 = seat.w;
    const h2 = ndHash11(seat.w.mul(917.0).add(seat.z.mul(131.0)));
    const h3 = ndHash11(seat.z.mul(573.0).add(seat.x.mul(79.0)).add(11.0));
    const dir = normalize(vec3(h1.sub(0.5), h2.sub(0.5), h3.sub(0.5)).add(vec3(1e-3, 0.0, 0.0)));
    const spin = swirl.mul(h1.mul(0.8).add(0.6));
    const turned = vec3(
        dir.x.mul(cos(spin)).sub(dir.z.mul(sin(spin))),
        dir.y,
        dir.x.mul(sin(spin)).add(dir.z.mul(cos(spin))),
    );
    const drift = vec3(
        sin(age.mul(3.0).add(h1.mul(40.0))),
        cos(age.mul(2.3).add(h2.mul(40.0))),
        sin(age.mul(2.7).add(h3.mul(40.0))),
    ).mul(0.3);
    const hung = cloudAt.add(turned.mul(cloudR.mul(pow(h3, 0.4).mul(0.8).add(0.2)))).add(drift);
    // Each drone leaves its seat at its own moment, and all are away when the burst is whole.
    const away = smoothstep(h1.mul(0.4), h1.mul(0.4).add(0.6), amount);
    const world = mix(seated, hung, away);

    // Onto the curve, off its end; an ember dies; a drone in the cloud is lit whatever its seat.
    const born = smoothstep(0.0, DRAGON_BODY.fadeIn, d);
    const gone = float(1.0).sub(smoothstep(endArc.sub(DRAGON_BODY.fadeOut), endArc, d));
    const emberFade = mix(float(1.0), float(1.0).sub(emberAge.div(1.1)), isEmber);
    const live = mix(born.mul(gone), float(1.0), away).mul(strength).mul(emberFade.mul(emberFade));

    // ── Tubes: a drone on a line is drawn out along it, so a row of drones is one neon tube ──
    // Which way its line runs: down the body for most, round it for a rib, up and down the
    // sawtooth for a fin; the dots (scales, eyes, embers, legs) have none.
    const isTube = isContour.add(isWhisker).add(isHorn).add(isJaw).add(isMane)
        .add(isFan);
    const ringAngle = turn.mul(TAU);
    const finSlope = mix(float(1.0), float(-1.0), step(0.5, fract(s.mul(DRAGON_FINS))))
        .mul(sc.mul(1.35 * 2 * DRAGON_FINS).div(bodyL));
    const lineDir = T.mul(isTube)
        .add(N.mul(sin(ringAngle).negate()).add(B.mul(cos(ringAngle))).mul(isRib))
        .add(normalize(T.negate().add(B.mul(finSlope))).mul(isCrest));
    // How long a drone is drawn: the gap to the next drone on its line and half as much again
    // (so the fewer the drones, the longer each dash: a low tier's dragon is still tubes).
    const reach = (lines, metres, share) => (metres * lines * 1.6) / Math.max(1, count * share);
    const tubeM = isContour.mul(bodyL.mul(reach(DRAGON_CONTOURS, 1, 0.23)))
        .add(isRib.mul(radius.mul(TAU * reach(DRAGON_RIBS, 1, 0.1))))
        .add(isCrest.mul(bodyL.mul(reach(1, 1.7, 0.1))))
        .add(hs.mul(
            isWhisker.mul(reach(2, 7.5, 0.05))
                .add(isHorn.mul(reach(4, 2.6, 0.04)))
                .add(isJaw.mul(reach(4, 3.9, 0.085)))
                .add(isMane.mul(reach(DRAGON_STRANDS, 4.6, 0.075))),
        ))
        .add(isFan.mul(sc.mul(reach(5, 5, 0.045))));
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(0.9).div(max(clip.w, 0.3));
    const sizeM = mix(
        mix(mix(float(0.12), float(0.15), isScale.add(isEmber)), float(0.5), isEye),
        float(3.4),
        isGlow,
    ).mul(sc.mul(0.5).add(0.5));
    const sizePx = max(sizeM.mul(pxPerMetre), 1.7);
    // The line as the screen sees it: a tube pointing at the camera is a dot.
    const ahead = viewProjection(world.add(lineDir.mul(0.25)));
    const run = ahead.xy.div(max(ahead.w, 0.3)).sub(clip.xy.div(max(clip.w, 0.3))).mul(half);
    const along = normalize(run.add(vec2(1e-4, 0.0)));
    const across = vec2(along.y.negate(), along.x);
    const lengthPx = max(sizePx, min(tubeM.mul(length(run)).mul(4.0), 90.0).mul(float(1.0).sub(away)));
    const shown = step(0.002, live);
    material.vertexNode = vec4(
        clip.xy.add(
            along.mul(positionGeometry.x.mul(lengthPx)).add(across.mul(positionGeometry.y.mul(sizePx)))
                .mul(shown).div(half)
                .mul(clip.w),
        ),
        clip.z,
        clip.w,
    );
    const isLine = isTube.add(isRib).add(isCrest);

    // ── Colour, by the flight's scheme ──
    const belly = step(float(DRAGON_CONTOURS / 2 + 0.5), lineId).mul(step(lineId, DRAGON_CONTOURS - 1.5));
    const downBody = mix(cBody, cBelly, smoothstep(0.5, 1.0, s).mul(0.45));
    // Teeth: beads of white along the jaws.
    const teeth = step(0.55, fract(q.mul(11.0))).mul(step(q, 0.8)).mul(0.9).add(0.75);
    const col = downBody.mul(isScale).mul(0.8)
        .add(mix(downBody, cBelly, belly.mul(0.75)).mul(isContour))
        .add(mix(cBelly, cBody, 0.3).mul(isRib).mul(0.55))
        .add(mix(cCrest, vec3(1.0), 0.15).mul(isCrest))
        .add(cHot.mul(isWhisker.add(isHorn)).mul(1.05))
        .add(cHot.mul(isJaw).mul(teeth))
        .add(mix(cCrest, cBelly, q).mul(isFan))
        .add(mix(cHot, cCrest, smoothstep(0.1, 0.9, q)).mul(isMane).mul(0.85))
        .add(mix(cBody, cHot, step(0.6, q)).mul(isLeg).mul(1.1))
        .add(mix(cHot, cBody, emberAge.div(1.1)).mul(isEmber).mul(1.2))
        .add(mix(cCrest, vec3(1.0), 0.5).mul(isEye).mul(4.5))
        .add(cBody.mul(isGlow).mul(0.06));
    // A wave of light runs down the body from the head.
    const wave = sin(s.mul(26.0).sub(age.mul(9.0))).mul(0.5).add(0.5);
    const shimmer = mix(float(1.0), wave.mul(0.8).add(0.45), onBody);
    // The swarm glitters, and harder while it hangs in the cloud.
    const blink = sin(u.time.mul(seat.w.mul(9.0).add(5.0)).add(seat.w.mul(60.0)));
    // (a tube burns steady: only the dots and the cloud twinkle)
    const flutter = mix(mix(float(0.24), float(0.05), isLine), float(0.5), away);
    const twinkle = blink.mul(flutter).add(float(1.0).sub(flutter));
    const dist = length(world.sub(cameraPosition));
    const through = float(1.0).sub(ndFogAmount(dist, world.y).mul(0.8));
    // Spread over at least 1.7 px: keep a floor so the far dragon still reads as lines of light.
    const energy = sizeM.mul(pxPerMetre).div(sizePx);
    const vLight = varying(
        mix(col, cHot.mul(1.15), away.mul(0.45).mul(float(1.0).sub(isGlow)))
            .mul(live).mul(twinkle).mul(shimmer)
            .mul(through)
            .mul(energy.mul(energy).mul(0.65).add(0.35))
            .mul(1.9),
        'ndDragon',
    );
    // (soft 0..1 for the glow cards, tube 0..1 for a drone drawn out along its line)
    const vShape = varying(vec2(isGlow, isLine.mul(float(1.0).sub(away))), 'ndDragonShape');
    material.colorNode = Fn(() => {
        const p = uv().sub(0.5).mul(2.0);
        const r2 = p.dot(p);
        const drone = exp(r2.mul(-7.0)).sub(0.001).max(0.0);
        const soft = exp(r2.mul(-3.0)).sub(0.05).max(0.0);
        // A tube: a narrow core across, and ends that melt into the next dash along.
        const window = max(float(1.0).sub(p.x.mul(p.x)), 0.0);
        const tube = exp(p.y.mul(p.y).mul(-7.0)).mul(window.mul(window)).mul(0.8);
        return vec4(vLight.mul(mix(mix(drone, tube, vShape.y), soft, vShape.x)), 0.0);
    })();
    const part = finish('NeonDistrictDragon', geometry, material, 32, true);
    part.table = rows;
    part.pathTexture = pathTex;
    part.count = count;
    const at = (slot, k) => rows[slot * DRAGON_ROWS + k];
    /**
     * Load a flight (neon-district-dragon.js: planDragonFlight) into a slot: its curve and its
     * colours. `colours` = { body, belly, crest, hot }, scene-linear.
     */
    part.fly = (slot, plan, colours) => {
        const width = DRAGON_KNOTS * 4;
        pathData.set(plan.knots, slot * 2 * width);
        pathData.set(plan.frames, (slot * 2 + 1) * width);
        pathTex.needsUpdate = true;
        at(slot, ROW.flight).set(plan.first * plan.spacing, 0, plan.scale, plan.spacing);
        at(slot, ROW.motion).set(0, 0, 0, plan.end);
        at(slot, ROW.burst).set(0, 0, 6, plan.body);
        at(slot, ROW.body).set(colours.body[0], colours.body[1], colours.body[2], 0);
        at(slot, ROW.belly).set(colours.belly[0], colours.belly[1], colours.belly[2], 0);
        at(slot, ROW.crest).set(colours.crest[0], colours.crest[1], colours.crest[2], 0);
        at(slot, ROW.hot).set(colours.hot[0], colours.hot[1], colours.hot[2], 0);
    };
    /** Where a slot's flight is now (flightState) and how bright it burns. */
    part.pose = (slot, state, seconds, light) => {
        const flight = at(slot, ROW.flight);
        flight.x = state.head;
        flight.y = state.strength * light;
        const motion = at(slot, ROW.motion);
        motion.x = seconds;
        motion.y = state.speed;
        motion.z = state.jaw;
        const burst = at(slot, ROW.burst);
        burst.x = state.burst;
        burst.y = state.swirl;
        burst.z = state.radius;
        at(slot, ROW.cloud).set(state.cloud[0], state.cloud[1], state.cloud[2], 0);
    };
    /** How bright a slot burns (0 = no dragon in it). */
    part.light = (slot) => at(slot, ROW.flight).y;
    part.rest = (slot) => {
        at(slot, ROW.flight).y = 0;
    };
    part.reset = () => {
        for (let slot = 0; slot < DRAGON_SLOTS; slot++) part.rest(slot);
    };
    part.dispose = () => pathTex.dispose();
    return part;
}

/** The z at which a clear's kerb sparks are thrown, per spark index (near field, both kerbs). */
export function kerbSparkDepth(k, n) {
    return -4 - ((k + 0.5) / n) * 44;
}
