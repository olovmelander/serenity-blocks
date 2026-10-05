/**
 * Ice Temple — gameplay effects that are their own geometry.
 *
 *  - Chips: every lock knocks chips of ice out of the floor where the piece struck. They arc,
 *    bounce once and skitter, tumbling: a chip is dark until a face turns to the eye. A ring of
 *    preallocated slots; each chip is closed-form ballistics.
 *  - The crown: a hard drop raises a ring of ice spikes round the blow. They shoot up in a tenth
 *    of a second, stand lit from within in the piece's colour, and sink back into the lake.
 *  - Row beams: the cleared rows fire out of the board — a blade of light from each side of the
 *    card at each cleared row's height, drawn in screen space so it lines up with the row
 *    exactly, splitting into its colours along its edges as light does through ice.
 *  - The Great Snowflake: four lines call a snowflake the height of the nave out of the air
 *    round the board. It grows as a real one does — six arms, side branches budding off them in
 *    order, barbs on the branches — holds, then shatters and falls. Its shape is a distance field
 *    folded into one twelfth of the plane, so it is exact at any size.
 *
 * Nothing is created at event time and every pool is always drawn (dormant slots collapse to
 * zero size), so the first frame compiles every pipeline.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    normalGeometry,
    normalize,
    positionGeometry,
    pow,
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
    CROWN_LIFE,
    CROWN_SPIKES,
    FLAKE_GROW,
    FLAKE_HOLD,
    FLAKE_SHATTER,
    TAU,
    itAtmosphere,
    itFxMaterial,
    itHash11,
    itHash22,
    itHeartLight,
    itLobes,
    itMoonDir,
    itPart,
    itQuadGeometry,
    itSaturate,
    itSky,
    itSpectrum,
    mulberry32,
} from './ice-temple-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

// ── Chips ───────────────────────────────────────────────────────────────────────

const CHIP_GRAVITY = 9.0;
const CHIP_DRAG = 1.3;
const CHIP_BOUNCE = 0.36;

/** Height of a chip `tau` seconds after launch (one bounce, then it skitters). CPU twin of the shader. */
export function chipHeight(vy, tau) {
    const g = CHIP_GRAVITY;
    const tb = Math.max((2 * vy) / g, 0.02);
    if (tau <= tb) return Math.max(0, vy * tau - 0.5 * g * tau * tau);
    const t2 = tau - tb;
    const v2 = vy * CHIP_BOUNCE;
    return Math.max(0, v2 * t2 - 0.5 * g * t2 * t2);
}

/**
 * @param {object} u
 * @param {number} count  pool size
 */
export function createChips(u, count) {
    const aBirth = new Float32Array(count * 4);
    const aVel = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) aBirth[i * 4 + 3] = -100;
    const geometry = itQuadGeometry(count, { aBirth: [aBirth, 4], aVel: [aVel, 4], aTint: [aTint, 4] });
    ['aBirth', 'aVel', 'aTint'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const birth = attribute('aBirth', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = itFxMaterial('IceTempleChips');
    const tau = u.time.sub(birth.w);
    const span = vel.w;
    const alive = step(0.0, tau).mul(step(tau, span));
    const t = max(tau, 0.0);
    const tb = max(vel.y.mul(2 / CHIP_GRAVITY), 0.02);
    const first = step(t, tb);
    const t2 = max(t.sub(tb), 0.0);
    const y1 = vel.y.mul(t).sub(t.mul(t).mul(CHIP_GRAVITY * 0.5));
    const y2 = vel.y.mul(CHIP_BOUNCE).mul(t2).sub(t2.mul(t2).mul(CHIP_GRAVITY * 0.5));
    const run = float(1.0).sub(exp(t.mul(-CHIP_DRAG))).div(CHIP_DRAG);
    const world = vec3(
        birth.x.add(vel.x.mul(run)),
        birth.y.add(max(mix(y2, y1, first), 0.0)).add(0.03),
        birth.z.add(vel.z.mul(run)),
    );
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(u.projScale).div(max(clip.w, 0.3));
    const sizePx = max(tint.w.mul(pxPerMetre), 1.4).mul(alive);
    // It tumbles: the quad turns, and thins as it goes edge-on.
    const spin = t.mul(tint.w.mul(160.0).add(9.0)).add(birth.x.mul(13.0));
    const turn = spin.mul(0.37);
    const squash = abs(cos(spin)).mul(0.85).add(0.15);
    // A sliver, not a tile.
    const local = vec2(positionGeometry.x.mul(squash).mul(0.42), positionGeometry.y);
    const rotated = vec2(
        local.x.mul(cos(turn)).sub(local.y.mul(sin(turn))),
        local.x.mul(sin(turn)).add(local.y.mul(cos(turn))),
    );
    material.vertexNode = vec4(clip.xy.add(rotated.mul(sizePx.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const age = clamp(t.div(max(span, 0.01)), 0.0, 1.0);
    const fade = float(1.0).sub(age.mul(age));
    // A face turning to the eye: a flash, in the ice's own white; the rest of the time the chip
    // carries the colour of the piece that struck it out.
    const glint = pow(abs(sin(spin)), 14.0);
    const lightNode = mix(tint.rgb, vec3(0.8, 0.92, 1.0), glint.mul(0.4).add(0.55)).mul(glint.mul(7.0).add(0.5))
        .mul(fade).mul(alive);
    const vLight = varying(lightNode, 'itChipLight');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).abs().mul(2.0);
        const shape = float(1.0).sub(smoothstep(0.75, 1.0, q.x.add(q.y)));
        return vec4(vLight.mul(shape), 0.0);
    })();

    const part = itPart('IceTempleChips', geometry, material, 30, false);
    let cursor = 0;
    let bursts = 0;
    /**
     * Knock `n` chips out of the ice at (x, z). `spread` = (min, max) speed along the ice;
     * `up` = (min, max) upward speed.
     */
    part.emit = ({
        x, z, n, rgb, time, spread = [3, 9], up = [1.2, 4.5], life = [0.6, 1.3], size = 0.03, y = 0, stagger = 0,
    }) => {
        const rand = mulberry32(0x1ce + bursts * 7919);
        bursts += 1;
        const total = Math.min(n, count);
        for (let k = 0; k < total; k++) {
            const i = cursor % count;
            cursor += 1;
            const a = rand() * TAU;
            const speed = spread[0] + (spread[1] - spread[0]) * rand() ** 1.6;
            aBirth.set([x, y, z, time + rand() * stagger], i * 4);
            aVel.set([Math.sin(a) * speed, up[0] + (up[1] - up[0]) * rand(), -Math.cos(a) * speed, life[0] + (life[1] - life[0]) * rand()], i * 4);
            const k2 = 0.7 + rand() * 0.5;
            aTint.set([rgb[0] * k2, rgb[1] * k2, rgb[2] * k2, size * (0.55 + rand() * 0.9)], i * 4);
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

// ── The crown ───────────────────────────────────────────────────────────────────

export const CROWN_SLOTS = 2;

/** How tall a crown's spikes stand (0..1), `age` seconds after the drop. CPU twin of the shader. */
export function crownRise(age) {
    if (age <= 0 || age >= CROWN_LIFE) return 0;
    const up = 1 - Math.exp(-age * 34);
    const settle = 1 + 0.16 * Math.exp(-age * 9) * Math.sin(age * 38);
    const p = Math.max(0, (age - CROWN_LIFE * 0.58) / (CROWN_LIFE * 0.42));
    return up * settle * (1 - p * p * (3 - 2 * p));
}

/** A ring of ice spikes for each of CROWN_SLOTS hard drops. */
export function createCrown(u) {
    const count = CROWN_SLOTS * CROWN_SPIKES;
    // A unit spike: six faces from a hexagon (radius 1 on the ice) to a point at y = 1.
    const position = [];
    const normal = [];
    for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * TAU;
        const a1 = ((i + 1) / 6) * TAU;
        const A = [Math.cos(a0), 0, Math.sin(a0)];
        const B = [Math.cos(a1), 0, Math.sin(a1)];
        const am = (a0 + a1) / 2;
        const n = [Math.cos(am), 0.22, Math.sin(am)];
        const nl = Math.hypot(n[0], n[1], n[2]);
        position.push(...A, 0, 1, 0, ...B);
        for (let k = 0; k < 3; k++) normal.push(n[0] / nl, n[1] / nl, n[2] / nl);
    }
    const rand = mulberry32(0xc207);
    const aSpike = new Float32Array(count * 4);
    const aShape = new Float32Array(count * 4);
    for (let s = 0; s < CROWN_SLOTS; s++) {
        for (let k = 0; k < CROWN_SPIKES; k++) {
            const i = s * CROWN_SPIKES + k;
            // Slot, angle round the blow, distance from it, height.
            const inner = k % 3 === 0;
            aSpike.set([
                s,
                (k / CROWN_SPIKES) * TAU + (rand() - 0.5) * 0.3,
                inner ? 0.74 + rand() * 0.12 : 0.96 + rand() * 0.26,
                inner ? 1.7 + rand() * 0.9 : 0.9 + rand() * 1.1,
            ], i * 4);
            // Lean outward, width, a delay, a seed.
            aShape.set([0.2 + rand() * 0.45, 0.17 + rand() * 0.14, rand() * 0.05, rand()], i * 4);
        }
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
    geometry.setAttribute('aSpike', new THREE.InstancedBufferAttribute(aSpike, 4));
    geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(aShape, 4));
    geometry.instanceCount = count;

    const uniforms = {
        /** (x, z, birth time, ring radius) */
        place: Array.from({ length: CROWN_SLOTS }, () => uniform(new THREE.Vector4(0, 0, -100, 0))),
        color: Array.from({ length: CROWN_SLOTS }, () => uniform(new THREE.Vector3(1, 1, 1))),
    };
    const spike = attribute('aSpike', 'vec4');
    const shape = attribute('aShape', 'vec4');
    const which = step(0.5, spike.x);
    const place = mix(uniforms.place[0], uniforms.place[1], which);
    const tintNode = mix(uniforms.color[0], uniforms.color[1], which);
    const age = u.time.sub(place.z).sub(shape.z);
    const live = step(0.0, age).mul(step(age, CROWN_LIFE));
    const up = float(1.0).sub(exp(age.mul(-34.0)));
    const settle = exp(age.mul(-9.0)).mul(sin(age.mul(38.0))).mul(0.16).add(1.0);
    const sink = smoothstep(CROWN_LIFE * 0.58, CROWN_LIFE, age);
    const rise = up.mul(settle).mul(float(1.0).sub(sink)).mul(live);
    const radial = vec3(cos(spike.y), 0.0, sin(spike.y));
    const tangent = vec3(sin(spike.y).negate(), 0.0, cos(spike.y));
    const axis = normalize(vec3(0.0, 1.0, 0.0).add(radial.mul(shape.x)));
    // The ring stands round the board: place.w is its radius.
    const height = spike.w.mul(rise);
    const width = shape.y.mul(min(rise.mul(3.0), 1.0));
    const foot = vec3(place.x, -0.02, place.y).add(radial.mul(spike.z.mul(place.w)));
    const world = foot
        .add(axis.mul(positionGeometry.y.mul(height)))
        .add(radial.mul(positionGeometry.x.mul(width)))
        .add(tangent.mul(positionGeometry.z.mul(width)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'IceTempleCrown';
    material.fog = false;
    material.positionNode = world;
    const vWorld = varying(world, 'itCrownWorld');
    const vNormal = varying(
        normalize(radial.mul(normalGeometry.x).add(tangent.mul(normalGeometry.z)).add(vec3(0.0, normalGeometry.y, 0.0))),
        'itCrownNormal',
    );
    const vTint = varying(tintNode, 'itCrownTint');
    const vAlong = varying(positionGeometry.y, 'itCrownAlong');
    const vGlow = varying(exp(age.mul(-2.6)).mul(live), 'itCrownGlow');
    material.colorNode = Fn(() => {
        const N = normalize(vNormal);
        const rel = vWorld.sub(cameraPosition);
        const Vd = rel.div(max(length(rel), 1e-3));
        const ndv = itSaturate(dot(N, Vd.negate()));
        const fres = float(0.05).add(float(0.95).mul(pow(float(1.0).sub(ndv), 4.0)));
        const toHeart = u.heartPos.sub(vWorld);
        const heartDir = toHeart.div(max(length(toHeart), 1.0));
        const heart = itHeartLight(u, vWorld);
        // Six faces, each its own tone: the heart's side, the moon's side, the dark side.
        const key = itSaturate(dot(N, heartDir)).mul(0.8).add(itSaturate(dot(N, itMoonDir())).mul(0.7));
        const through = pow(itSaturate(dot(Vd, heartDir)), 3.0);
        const body = vec3(0.03, 0.15, 0.28).mul(key.add(0.2)).mul(u.ambient)
            .add(heart.mul(vec3(0.38, 0.74, 1.0)).mul(through.mul(1.3).add(0.12)));
        // Lit from within in the piece's colour: it burns at the root, where it broke through,
        // and the thin tip keeps a little of it for as long as the spike stands.
        const root = float(1.0).sub(vAlong);
        const inner = vTint.mul(vGlow).mul(root.mul(root).mul(3.4).add(0.3))
            .add(vTint.mul(0.1).mul(root.add(0.4)));
        const edge = pow(float(1.0).sub(ndv), 3.0);
        const R = Vd.sub(N.mul(dot(Vd, N).mul(2.0)));
        const mirror = itSky(u, R, 0.3).add(itLobes(u, vWorld, R));
        const col = body.add(inner).mul(float(1.0).sub(fres))
            .add(mirror.mul(fres))
            .add(vTint.mul(vGlow).add(u.skyHorizon.mul(2.0)).mul(edge));
        return itAtmosphere(u, col, vWorld);
    })();

    const part = itPart('IceTempleCrown', geometry, material, 1, true);
    part.uniforms = uniforms;
    let cursor = 0;
    part.raise = (x, z, rgb, time, radius = 2.4) => {
        const slot = cursor % CROWN_SLOTS;
        cursor += 1;
        uniforms.place[slot].value.set(x, z, time, radius);
        uniforms.color[slot].value.set(rgb[0], rgb[1], rgb[2]);
    };
    part.reset = () => {
        for (let i = 0; i < CROWN_SLOTS; i++) uniforms.place[i].value.set(0, 0, -100, 0);
        cursor = 0;
    };
    return part;
}

// ── Row beams ───────────────────────────────────────────────────────────────────

export const BEAM_ROWS = 4;
/** Seconds a beam's head takes from the card to the edge of the frame, and its afterglow. */
export const BEAM_TRAVEL = 0.11;
export const BEAM_FADE = 0.26;

/** Eight screen-space strips: one from each side of the card for up to four cleared rows. */
export function createRowBeams(u) {
    const count = BEAM_ROWS * 2;
    const aRow = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) aRow.set([Math.floor(i / 2), i % 2 ? 1 : -1], i * 2);
    const geometry = itQuadGeometry(count, { aRow: [aRow, 2] });
    const row = attribute('aRow', 'vec2');
    const uniforms = {
        /** Screen y (fractions, y down) of up to four rows; < 0 = unused. */
        rows: uniform(new THREE.Vector4(-1, -1, -1, -1)),
        /** (card x0, card x1, birth time, strength) */
        frame: uniform(new THREE.Vector4(0.4, 0.6, -100, 0)),
        color: uniform(new THREE.Vector3(1, 1, 1)),
    };
    const material = itFxMaterial('IceTempleRowBeams', { depthTest: false });
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
    const vAlong = varying(along, 'itBeamT');
    material.colorNode = Fn(() => {
        const age = u.time.sub(uniforms.frame.z);
        const head = age.div(BEAM_TRAVEL);
        const reached = step(vAlong, head);
        const dy = uv().y.sub(0.5).mul(thicknessPx);
        const taper = mix(float(1.5), float(0.7), vAlong);
        const core = exp(dy.mul(dy).div(taper.mul(taper)).negate());
        const glow = exp(abs(dy).mul(-0.24)).mul(0.2);
        const tip = exp(vAlong.sub(head).mul(vAlong.sub(head)).mul(-180.0)).mul(step(head, 1.2));
        const env = exp(max(age.sub(vAlong.mul(BEAM_TRAVEL)), 0.0).div(-BEAM_FADE)).mul(step(0.0, age));
        // Light through ice: the blade splits into its colours away from its core, further out
        // the further it has travelled.
        const split = exp(abs(dy).mul(-0.11)).mul(float(1.0).sub(core)).mul(vAlong.mul(0.8).add(0.2));
        const prism = itSpectrum(dy.div(thicknessPx).mul(1.4).add(0.5));
        const k = core.add(glow).mul(reached).mul(env).add(core.add(glow).mul(tip).mul(2.0))
            .mul(uniforms.frame.w)
            .mul(mix(float(1.0), float(0.55), vAlong));
        const col = mix(uniforms.color, vec3(1.0), core.mul(0.75)).mul(k).mul(2.5)
            .add(prism.mul(split).mul(reached).mul(env).mul(uniforms.frame.w)
                .mul(0.5));
        return vec4(col, 0.0);
    })();
    const part = itPart('IceTempleRowBeams', geometry, material, 60, false);
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

// ── The Great Snowflake ─────────────────────────────────────────────────────────

/** Spacing of the side branches along an arm (the flake's radius is 1), and how many there are. */
const BRANCH_SPACING = 0.078;
const BRANCH_COUNT = 11;
const ARM_LENGTH = 0.94;
const COS60 = 0.5;
const SIN60 = Math.sqrt(3) / 2;
/** Half-widths of the arm at its root, of a branch and of a barb (the flake's radius is 1). */
const ARM_WIDTH = 0.0038;
const BRANCH_WIDTH = 0.0023;
const BARB_WIDTH = 0.0014;

/** Distance from `p` to the segment a → a + dir · len (dir is unit). */
const segment = /* @__PURE__ */ Fn(([p, a, dir, len]) => {
    const q = p.sub(a);
    const h = clamp(dot(q, dir), 0.0, max(len, 0.0));
    return length(q.sub(dir.mul(h)));
}).setLayout({
    name: 'it_segment',
    type: 'float',
    inputs: [
        { name: 'p', type: 'vec2' }, { name: 'a', type: 'vec2' }, { name: 'dir', type: 'vec2' }, { name: 'len', type: 'float' },
    ],
});

/**
 * One side branch and its three barbs. `i` = its index along the arm, `grown` = how far the arm
 * has grown (0..ARM_LENGTH). Returns (distance to its surface, distance to its root): the first
 * is large when it has not budded yet.
 */
const branch = /* @__PURE__ */ Fn(([p, i, grown]) => {
    const x = i.add(0.7).mul(BRANCH_SPACING);
    // Long in the middle of the arm, short at the heart and at the tip; every other one is a
    // short one, as on a stellar dendrite.
    const odd = fract(i.mul(0.5)).mul(2.0);
    const shape = sin(clamp(x.div(ARM_LENGTH), 0.0, 1.0).mul(Math.PI * 0.92).add(0.12)).mul(0.25).add(0.02)
        .mul(mix(float(1.0), float(0.52), odd))
        .mul(itHash11(i.add(3.0)).mul(0.3).add(0.82));
    const budded = clamp(grown.sub(x).div(0.2), 0.0, 1.0);
    const len = shape.mul(budded);
    const dir = vec2(COS60, SIN60);
    const root = vec2(x, 0.0);
    const d = segment(p, root, dir, len).sub(BRANCH_WIDTH).toVar();
    // Barbs: parallel to the arm, as a real dendrite's are.
    const along = vec2(1.0, 0.0);
    d.assign(min(d, segment(p, root.add(dir.mul(len.mul(0.36))), along, len.mul(0.36)).sub(BARB_WIDTH)));
    d.assign(min(d, segment(p, root.add(dir.mul(len.mul(0.6))), along, len.mul(0.26)).sub(BARB_WIDTH)));
    d.assign(min(d, segment(p, root.add(dir.mul(len.mul(0.82))), along, len.mul(0.14)).sub(BARB_WIDTH)));
    const valid = step(-0.5, i).mul(step(i, BRANCH_COUNT - 0.5)).mul(step(1e-3, len));
    return vec2(mix(float(4.0), d, valid), mix(float(4.0), length(p.sub(root)), valid));
}).setLayout({
    name: 'it_flakeBranch',
    type: 'vec2',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 'i', type: 'float' }, { name: 'grown', type: 'float' }],
});

/**
 * @param {object} u
 * @returns part with `uniforms.place` (centre xyz, radius) and `uniforms.state`
 *   (birth time, strength, layers, turn)
 */
export function createSnowflake(u) {
    const aLayer = new Float32Array([0, 1]);
    const geometry = itQuadGeometry(2, { aLayer: [aLayer, 1] });
    const uniforms = {
        /** World position of the flake's centre, and its radius in metres. */
        place: uniform(new THREE.Vector4(0, 9, -10, 9)),
        /** (birth time, strength, layers 1|2, _) */
        state: uniform(new THREE.Vector4(-100, 0, 1, 0)),
        tint: uniform(new THREE.Vector3(0.7, 0.92, 1.0)),
    };
    const layer = attribute('aLayer', 'float');
    const material = itFxMaterial('IceTempleSnowflake');
    const age = u.time.sub(uniforms.state.x);
    const life = FLAKE_GROW + FLAKE_HOLD + FLAKE_SHATTER;
    const live = step(0.0, age).mul(step(age, life)).mul(step(0.001, uniforms.state.y))
        .mul(step(layer, uniforms.state.z.sub(0.5)));
    const clip = viewProjection(uniforms.place.xyz);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(u.projScale).div(max(clip.w, 0.3));
    // The second flake (a perfect clear) stands half as large again and much fainter: a halo
    // round the first, not a lattice across it.
    const radiusPx = uniforms.place.w.mul(pxPerMetre).mul(layer.mul(0.46).add(1.0)).mul(live);
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(radiusPx.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const vLayer = varying(layer, 'itFlakeLayer');
    const vPx = varying(radiusPx, 'itFlakePx');

    material.colorNode = Fn(() => {
        const q0 = uv().sub(0.5).mul(2.0).toVar();
        const grow = clamp(age.div(FLAKE_GROW), 0.0, 1.0);
        const grown = float(1.0).sub(pow(float(1.0).sub(grow), 3.0)).mul(ARM_LENGTH);
        const shatter = clamp(age.sub(FLAKE_GROW + FLAKE_HOLD).div(FLAKE_SHATTER), 0.0, 1.0).toVar();

        // ── It breaks: every shard keeps its piece of the drawing and falls with it ──
        const shard = floor(q0.mul(13.0).add(vLayer.mul(3.7)));
        const h = itHash22(shard.add(17.0));
        const fall = shatter.mul(shatter).mul(h.x.mul(0.9).add(0.25));
        const q = q0.add(vec2(h.y.sub(0.5).mul(shatter).mul(0.2), fall)).toVar();
        const gone = smoothstep(h.x.mul(0.5).add(0.25), 1.0, shatter);

        // ── Turn slowly; the second flake turns the other way, half a sector on ──
        const dirSign = float(1.0).sub(vLayer.mul(2.0));
        const turn = age.mul(0.045).mul(dirSign).add(vLayer.mul(TAU / 12));
        const c = cos(turn);
        const s = sin(turn);
        const r = length(q);
        const qa = vec2(q.x.mul(c).sub(q.y.mul(s)), q.x.mul(s).add(q.y.mul(c)));
        // Fold the plane into one twelfth: six arms, each mirrored about its own axis.
        const sector = TAU / 6;
        const a = atan(qa.y, qa.x);
        const folded = abs(a.sub(floor(a.div(sector).add(0.5)).mul(sector)));
        const p = vec2(cos(folded), sin(folded)).mul(r).toVar();

        // ── The drawing: a signed distance to its surface, and how near a node is ──
        const armWidth = mix(float(ARM_WIDTH), float(BARB_WIDTH), smoothstep(0.0, ARM_LENGTH, p.x));
        const d = segment(p, vec2(0.0, 0.0), vec2(1.0, 0.0), grown).sub(armWidth).toVar();
        const node = float(4.0).toVar();
        const i0 = floor(p.x.div(BRANCH_SPACING).sub(0.7));
        for (let k = -2; k <= 1; k++) {
            const b = branch(p, i0.add(k), grown);
            d.assign(min(d, b.x));
            node.assign(min(node, b.y));
        }
        // The plate at its heart: a hexagon, a second one inside it, spokes to its corners.
        const hex = p.x.mul(Math.cos(Math.PI / 6)).add(p.y.mul(Math.sin(Math.PI / 6)));
        const plateR = min(grown.mul(1.6), 0.17);
        d.assign(min(d, abs(hex.sub(plateR)).sub(BRANCH_WIDTH)));
        d.assign(min(d, abs(hex.sub(plateR.mul(0.55))).sub(BARB_WIDTH)));
        const plate = float(1.0).sub(smoothstep(-0.004, 0.004, hex.sub(plateR)));

        // ── Light: ice, not a tube of gas. A hard bright edge, a hair of spectrum outside it,
        // a faint glass plate, and a glint on every node ──
        const texel = float(1.5).div(max(vPx, 1.0));
        const core = float(1.0).sub(smoothstep(texel.negate(), texel, d));
        const sheen = exp(max(d, 0.0).mul(-170.0)).mul(0.5).add(exp(max(d, 0.0).mul(-34.0)).mul(0.1));
        const fringe = smoothstep(0.0, texel.mul(1.5), d).mul(exp(max(d, 0.0).mul(-240.0)));
        const prism = itSpectrum(r.mul(1.9).add(folded.mul(1.3)).sub(age.mul(0.2)));
        const glass = plate.mul(sin(hex.mul(190.0)).mul(0.25).add(0.75)).mul(0.07);
        const twinkle = pow(sin(u.time.mul(5.0).add(i0.mul(2.4)).add(folded.mul(9.0))).mul(0.5).add(0.5), 6.0);
        const glint = exp(node.mul(node).mul(-9000.0)).mul(twinkle.mul(2.6).add(0.5));
        // The growing tips burn.
        const tip = exp(abs(r.sub(grown)).mul(-26.0)).mul(float(1.0).sub(grow)).mul(1.6);
        const appear = smoothstep(0.0, 0.12, age);
        const fade = float(1.0).sub(gone).mul(appear);
        const col = mix(uniforms.tint, vec3(1.0), 0.55).mul(core.mul(0.7))
            .add(uniforms.tint.mul(sheen.mul(0.3).add(glass)))
            .add(prism.mul(fringe).mul(0.22))
            .add(vec3(1.0).mul(glint.mul(core.mul(0.7).add(0.3))))
            .add(uniforms.tint.mul(tip).mul(core.add(sheen)))
            .mul(fade)
            .mul(uniforms.state.y)
            .mul(float(1.0).sub(vLayer.mul(0.68)));
        // The quad's own edge must never show.
        return vec4(col.mul(float(1.0).sub(smoothstep(0.94, 1.0, length(q0)))), 0.0);
    })();

    const part = itPart('IceTempleSnowflake', geometry, material, 25, true);
    part.uniforms = uniforms;
    part.launch = (time, strength = 1, layers = 1) => {
        uniforms.state.value.set(time, strength, layers, 0);
    };
    part.reset = () => {
        uniforms.state.value.set(-100, 0, 1, 0);
    };
    return part;
}
