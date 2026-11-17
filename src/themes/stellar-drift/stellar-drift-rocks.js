/**
 * Stellar Drift — the rocks of the haze beyond the rings.
 *
 * Six bodies modelled by script in Blender (stellar-drift-rock-models.js, written by
 * scripts/blender/stellar_drift_rocks.py): a cleaved block of ice, a rubble-pile chunk of ring ice,
 * a cratered rocky potato, a contact binary, a splinter of ice and a slab of layered crust, each at
 * three levels (a hero rock, a boulder, a chip), with its occlusion, the dust on its crests and how
 * thin it is under each vertex baked into its vertices.
 *
 * A body is one of two materials, chosen per instance:
 *   ice   bright and blue-white, glinting where a face turns the sun to the eye, its thin edges
 *         lit through when the sun stands behind it;
 *   rock  dark warm grey-brown, the rings' pale dust on its crests, deep shadow in its crevices.
 * Both are lit by the sun with a crisp terminator, by the giant's own warm light on the side that
 * faces it and by a faint rim of the nebula's colours; play's colour is only a breath on the rim.
 *
 * A class of rocks is ONE mesh: all six designs merged, each instance wearing one of them (the
 * vertex stage folds the others onto its middle: triangles of no area, which the rasteriser drops).
 *
 * The hero rocks: two or three large bodies that drift slowly through the open sky, one pass at a
 * time, along lanes the composition leaves open (the sky right of the card and its HUD, over the
 * nebula; the dark under the giant), each tumbling slowly. A pass starts and ends beyond the edge of
 * the frame, and the next one (another design, size, depth, path and tumble) is chosen while the
 * hero is out of sight. Their state is a closed form of the drift clock worked out on the CPU (a few
 * numbers a frame, nothing allocated) and handed to the shader as rows of one table.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    cos,
    cross,
    dFdx,
    dFdy,
    dot,
    float,
    int,
    length,
    max,
    mix,
    normalGeometry,
    normalize,
    positionGeometry,
    pow,
    sign,
    sin,
    smoothstep,
    step,
    uniformArray,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    TAU, giantAnchors, mulberry32, sdPart, sdSolidMaterial,
} from './stellar-drift-tsl.js';
import { fallbackLayout } from './stellar-drift-composition.js';
import { STELLAR_DRIFT_ROCK_MODELS as MODELS } from './stellar-drift-rock-models.js';

/** The levels the Blender script writes, finest first. */
export const ROCK_LEVELS = Object.freeze(['hero', 'boulder', 'chip']);
/** The six designs, in the order the module holds them (an instance's variant indexes this). */
export const ROCK_DESIGNS = MODELS.designs;
/** The designs that are ice by nature (the rest are rock). */
export const ICE_DESIGNS = Object.freeze(['block', 'rubble', 'splinter']);
const ICY = ROCK_DESIGNS.map((design) => ICE_DESIGNS.includes(design));

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ── The models ──────────────────────────────────────────────────────────────────

function decode(text, Type) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer);
}

/** A level's models merged, decoded once a page: every world (a rebuild, a quality change) shares it. */
const merged = new Map();

/**
 * One level's models as plain arrays (three-free: the tests read it): every model's vertices one
 * after another, each tagged with the model it belongs to.
 * @param {'hero'|'boulder'|'chip'} level
 * @returns {{ position: Float32Array, normal: Float32Array, shade: Float32Array, index: Uint16Array,
 *     variants: number, vertexCount: number, triangleCount: number,
 *     ranges: { design: string, vertex: number, vertices: number, index: number, indices: number }[] }}
 *     `shade` holds (ambient occlusion, crest, thin, variant) per vertex
 */
export function rockMesh(level) {
    const known = merged.get(level);
    if (known) return known;
    const models = MODELS[level];
    if (!models?.length) throw new Error(`Stellar Drift has no rock models for level "${level}".`);
    let vertexCount = 0;
    let indexCount = 0;
    models.forEach((model) => {
        vertexCount += model.vertexCount;
        indexCount += model.triangleCount * 3;
    });
    const position = new Float32Array(vertexCount * 3);
    const normal = new Float32Array(vertexCount * 3);
    const shade = new Float32Array(vertexCount * 4);
    const index = new Uint16Array(indexCount);
    const ranges = [];
    let v = 0;
    let t = 0;
    models.forEach((model, variant) => {
        const p = decode(model.positions, Int16Array);
        const n = decode(model.normals, Int8Array);
        const s = decode(model.shade, Uint8Array);
        const tri = decode(model.index, Uint16Array);
        for (let i = 0; i < model.vertexCount; i++) {
            const o = (v + i) * 3;
            let nx = n[i * 3];
            let ny = n[i * 3 + 1];
            let nz = n[i * 3 + 2];
            // Eight bits a component: unit again, and never a zero normal (a NaN in the shader).
            const nl = Math.hypot(nx, ny, nz);
            if (nl > 0) {
                nx /= nl;
                ny /= nl;
                nz /= nl;
            } else {
                ny = 1;
            }
            position[o] = p[i * 3] * MODELS.quant;
            position[o + 1] = p[i * 3 + 1] * MODELS.quant;
            position[o + 2] = p[i * 3 + 2] * MODELS.quant;
            normal[o] = nx;
            normal[o + 1] = ny;
            normal[o + 2] = nz;
            const q = (v + i) * 4;
            shade[q] = s[i * 3] / 255;
            shade[q + 1] = s[i * 3 + 1] / 255;
            shade[q + 2] = s[i * 3 + 2] / 255;
            shade[q + 3] = variant;
        }
        for (let i = 0; i < tri.length; i++) index[t + i] = tri[i] + v;
        ranges.push({
            design: model.design, vertex: v, vertices: model.vertexCount, index: t, indices: tri.length,
        });
        v += model.vertexCount;
        t += tri.length;
    });
    const mesh = {
        position, normal, shade, index, ranges, variants: models.length, vertexCount, triangleCount: indexCount / 3,
    };
    merged.set(level, mesh);
    return mesh;
}

/**
 * A level's rocks as ONE instanced geometry: all its models, so a class stays one mesh and one
 * pipeline, with the per-instance attributes given.
 * @param {'hero'|'boulder'|'chip'} level
 * @param {number} count
 * @param {Record<string, [Float32Array, number]>} attributes  name → [data, itemSize]
 */
export function createRockGeometry(level, count, attributes = {}) {
    const mesh = rockMesh(level);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(mesh.index, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(mesh.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normal, 3));
    geometry.setAttribute('aShade', new THREE.BufferAttribute(mesh.shade, 4));
    Object.keys(attributes).forEach((name) => {
        const [data, itemSize] = attributes[name];
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, itemSize));
    });
    geometry.instanceCount = count;
    return geometry;
}

// ── The drifting field ──────────────────────────────────────────────────────────

/**
 * The classes of the drifting field: the level they wear, how far in front of the lens they ride
 * (giant radii), the angle a body's radius spans (radians: 6e-4 is about a pixel of a 900-line
 * frame), how strongly the class leans to its small end, and the chance a body is ice when its
 * design is icy and when it is rocky.
 */
export const FIELD_CLASSES = Object.freeze({
    boulders: Object.freeze({
        level: 'boulder', depth: [0.7, 2.6], angle: [0.004, 0.024], bias: 1.7, ice: [0.9, 0.12],
    }),
    shards: Object.freeze({
        level: 'chip', depth: [1.0, 4.2], angle: [0.0011, 0.0048], bias: 1.9, ice: [0.96, 0.45],
    }),
});

/** A body's own proportions: each axis of its model is stretched by a number in this range. */
const STRETCH = Object.freeze([0.82, 1.16]);

/**
 * One class of the drifting field as plain numbers (three-free: tests read it). The big bodies ride
 * near the lens and the small ones anywhere, so the near field is sparse and large, the far one fine.
 *   place  (across the frame 0..1, up it 0..1, depth, radius in giant radii)
 *   spin   (tumble axis, radians per second)
 *   look   (variant, ice 0|1, tone 0..1, the tumble's phase)
 *   shape  (stretch along x, y, z, _)
 */
export function planField(seed, count, cls) {
    const rand = mulberry32(seed);
    const place = new Float32Array(count * 4);
    const spin = new Float32Array(count * 4);
    const look = new Float32Array(count * 4);
    const shape = new Float32Array(count * 4);
    const variants = ROCK_DESIGNS.length;
    const offset = Math.floor(rand() * variants);
    for (let i = 0; i < count; i++) {
        const big = rand() ** cls.bias;
        const angle = lerp(cls.angle[0], cls.angle[1], big);
        const reach = (1 - big) * (0.25 + 0.75 * rand());
        const depth = lerp(cls.depth[0], cls.depth[1], reach);
        place.set([rand(), rand(), depth, angle * depth], i * 4);
        const z = rand() * 2 - 1;
        const a = rand() * TAU;
        const s = Math.sqrt(1 - z * z);
        // The small ones tumble faster than the large.
        const rate = (0.05 + rand() * 0.2) * (1.3 - big * 0.7) * (rand() < 0.5 ? -1 : 1);
        spin.set([s * Math.cos(a), z, s * Math.sin(a), rate], i * 4);
        // Every design in turn, so a class of a dozen wears all six.
        const variant = (i + offset) % variants;
        const ice = rand() < cls.ice[ICY[variant] ? 0 : 1] ? 1 : 0;
        look.set([variant, ice, rand(), rand() * TAU], i * 4);
        shape.set([
            lerp(STRETCH[0], STRETCH[1], rand()), lerp(STRETCH[0], STRETCH[1], rand()),
            lerp(STRETCH[0], STRETCH[1], rand()), 0,
        ], i * 4);
    }
    return {
        place, spin, look, shape, count,
    };
}

// ── The hero rocks ──────────────────────────────────────────────────────────────

/** The hero rocks' drift (screen heights are the unit of the frame; its width is the aspect). */
export const HERO = Object.freeze({
    /** Seconds of the drift clock from one of a hero's passes to its next: each its own, never in step. */
    periods: Object.freeze([97, 127, 109]),
    /** Where each hero's clock starts, as a share of its period (two are in sight as the theme opens). */
    phases: Object.freeze([0.42, 0.3, 0.8]),
    /** The share of its period a pass takes: the nearest pass the least (it crosses fastest). */
    pass: Object.freeze([0.68, 0.9]),
    /** The third hero is a smaller, further one. */
    third: 0.76,
    /** How far in front of the lens it rides (giant radii). */
    depth: Object.freeze([1.0, 2.1]),
    /** Radians per second of its tumble. */
    tumble: Object.freeze([0.03, 0.08]),
    /**
     * How far past the frame's edge a pass starts and ends, beyond its own radius (screen heights):
     * room for the camera's sway and the pointer's lean, so a pass never starts in sight.
     */
    margin: 0.1,
    /** Room kept round the card and its HUD (screen heights, beyond the hero's radius). */
    clear: 0.025,
});

/** Rows a hero takes in the table: (centre, radius), (axis, angle), (stretch, variant), (ice, tone, _, _). */
export const HERO_ROWS = 4;
/** Heroes the table holds. */
export const HERO_SLOTS = 3;

/**
 * The lanes the heroes may take for an aspect, and what they must keep clear of (screen heights,
 * y down). A lane is the edges a pass may start from and leave by (both beyond the frame, either
 * way round), the radii its heroes may have on screen, and how near the giant's limb it may come
 * (a share of its radius: below one, a pass may cross the edge of its disc for a moment).
 *   wide frames: `east` (up or down the sky right of the card and its HUD, over the nebula),
 *                `under` (along the dark under the giant, left of the card) and `north` (across the
 *                sky above the HUD)
 *   tall frames: `below` the card (the giant stands in the sky above it), and `above` it where the
 *                giant leaves room
 */
export function heroLanes(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const anchors = giantAnchors(a);
    const layout = fallbackLayout(a * 1000, 1000);
    const toRect = (r) => (r ? {
        x0: r.x0 * a, y0: r.y0, x1: r.x1 * a, y1: r.y1,
    } : null);
    const card = toRect(layout.cards[0]);
    const hud = toRect(layout.hud);
    const rects = [card, hud].filter(Boolean);
    const giant = { x: anchors.x * a, y: anchors.y, r: anchors.radius };
    const lanes = [];
    if (a >= 1.15) {
        const right = Math.max(card.x1, hud ? hud.x1 : card.x1) + 0.05;
        const wide = Math.max(right + 0.05, a - 0.05);
        // Under the giant: the strip between its limb and the foot of the frame, left of the card.
        const under = Math.min(0.9, giant.y + giant.r * 0.92);
        // Up or down the middle of the column, never along the frame's edge.
        const mid = (right + wide) * 0.5;
        const span = Math.max(0.04, (wide - right) * 0.32);
        lanes.push({
            name: 'east',
            from: [{ edge: 'bottom', lo: mid - span * 0.4, hi: mid + span }],
            to: [{ edge: 'top', lo: Math.max(mid - span * 1.4, card.x1 + 0.1), hi: mid + span * 0.6 }],
            radius: [0.034, 0.078],
            limb: 1,
        });
        // Along the strip, in from the left edge and out through the foot of the frame by the card.
        lanes.push({
            name: 'under',
            from: [{ edge: 'left', lo: under, hi: Math.min(0.95, under + 0.09) }],
            to: [{ edge: 'bottom', lo: Math.max(0.2, card.x0 - 0.24), hi: card.x0 - 0.06 }],
            radius: [0.03, Math.min(0.064, Math.max(0.04, (1 - under) * 0.4))],
            limb: 0.9,
        });
        // Across the sky above the HUD, in from the right edge and out over the top by the card.
        const top = Math.max(0.1, Math.min(0.26, (hud ? hud.y0 : card.y0 + 0.2) - 0.08));
        lanes.push({
            name: 'north',
            from: [{ edge: 'right', lo: top * 0.5, hi: top }],
            to: [{ edge: 'top', lo: card.x1 + 0.1, hi: Math.max(card.x1 + 0.14, right - 0.05) }],
            radius: [0.03, 0.05],
            limb: 1,
        });
    } else {
        const below = Math.min(0.94, card.y1 + 0.02);
        const room = Math.max(0, card.y0 - 0.02);
        const r = Math.max(0.018, Math.min(0.045, (1 - below) * 0.3));
        lanes.push({
            name: 'below',
            from: [{ edge: 'right', lo: below, hi: 0.99 }],
            to: [{ edge: 'left', lo: below, hi: 0.99 }],
            radius: [r * 0.6, r],
            limb: 1,
        });
        lanes.push({
            name: 'above',
            from: [{ edge: 'right', lo: 0.01, hi: room }],
            to: [{ edge: 'left', lo: 0.01, hi: room }],
            radius: [r * 0.5, r * 0.8],
            limb: 1,
        });
    }
    return {
        aspect: a, lanes, rects, giant,
    };
}

/** The lane hero `index` takes on its pass number `pass`. */
export const heroLane = (lanes, index, pass) => {
    const all = lanes.lanes;
    const named = (name) => all.find((lane) => lane.name === name) || all[0];
    // On a wide frame the first rides under the giant, the second over the nebula and the third
    // across the sky above the HUD; on a tall one they keep below the card.
    if (all[0].name !== 'east') return index === 2 ? all[pass % all.length] : all[0];
    return named(['under', 'east', 'north'][index % 3]);
};

function edgePoint(edge, t, aspect, margin, out) {
    const along = lerp(edge.lo, edge.hi, t);
    if (edge.edge === 'right') out.set(aspect + margin, along);
    else if (edge.edge === 'left') out.set(-margin, along);
    else if (edge.edge === 'top') out.set(along, -margin);
    else out.set(along, 1 + margin);
    return out;
}

/**
 * How much of a path's time in sight (a share of its samples) is too near a keep-out: the card or
 * its HUD (`rects`), or nearer the giant's centre than `limb` of its radius plus the hero's own.
 */
export function trespass(lanes, from, to, radius, limb = 1) {
    const steps = 48;
    const room = radius + HERO.clear;
    let bad = 0;
    let seen = 0;
    for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const x = lerp(from.x, to.x, t);
        const y = lerp(from.y, to.y, t);
        if (x < -radius || y < -radius || x > lanes.aspect + radius || y > 1 + radius) continue;
        seen += 1;
        let hit = Math.hypot(x - lanes.giant.x, y - lanes.giant.y) < lanes.giant.r * limb + radius;
        for (let r = 0; r < lanes.rects.length && !hit; r++) {
            const rect = lanes.rects[r];
            hit = x > rect.x0 - room && x < rect.x1 + room && y > rect.y0 - room && y < rect.y1 + room;
        }
        if (hit) bad += 1;
    }
    return seen ? bad / seen : 1;
}

/** A hero's pass: what it is, where it runs and how it turns. Mutable; one per hero, reused. */
export const createHeroPass = () => ({
    pass: -1,
    lanesFor: null,
    lane: '',
    /** False when no clear path could be found: the hero sits this pass out. */
    shown: true,
    from: new THREE.Vector2(),
    to: new THREE.Vector2(),
    start: 0,
    duration: 1,
    depth: 1.5,
    radius: 0.05,
    variant: 0,
    ice: 1,
    tone: 0.5,
    axis: new THREE.Vector3(0, 1, 0),
    rate: 0.05,
    phase: 0,
    stretch: new THREE.Vector3(1, 1, 1),
    trespass: 0,
});

/** Each hero's own scratch for the paths it tries (planning one hero may plan those before it). */
const TRIES = Array.from({ length: HERO_SLOTS }, () => ({ from: new THREE.Vector2(), to: new THREE.Vector2() }));
/** Each hero's view of the heroes before it while it plans (never the states the shader is fed). */
const SIBLINGS = Array.from({ length: HERO_SLOTS }, () => Array.from({ length: HERO_SLOTS }, createHeroPass));
const siblingAt = {
    x: 0, y: 0, live: false, along: 0,
};

/**
 * How much of a candidate path (a share of its samples) runs over a hero before it in the list, at
 * the same moment: two bodies sliding along together over one another read as a fault, not a pass.
 */
function crowding(seed, index, lanes, from, to, start, duration, radius) {
    const steps = 32;
    let bad = 0;
    for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const x = lerp(from.x, to.x, t);
        const y = lerp(from.y, to.y, t);
        for (let j = 0; j < index; j++) {
            const other = SIBLINGS[index][j];
            // eslint-disable-next-line no-use-before-define
            heroAt(seed, j, start + duration * t, lanes, other, siblingAt);
            if (siblingAt.live && Math.hypot(x - siblingAt.x, y - siblingAt.y) < (radius + other.radius) * 1.3) {
                bad += 1;
                break;
            }
        }
    }
    return bad / (steps + 1);
}

/**
 * Plan pass number `pass` of hero `index` into `out` (the CPU twin the tests read). A path that
 * would cross the card, its HUD or the giant, or ride over a hero before it, is drawn again (the
 * same draws every time); when none is clear the hero sits the pass out.
 */
export function planHeroPass(seed, index, pass, lanes, out) {
    const rand = mulberry32((seed * 7919 + index * 104729 + pass * 1299709) >>> 0);
    const period = HERO.periods[index % HERO.periods.length];
    const lane = heroLane(lanes, index, pass);
    const near = rand();
    out.pass = pass;
    out.lanesFor = lanes;
    out.lane = lane.name;
    // The larger ones nearer the lens.
    out.radius = lerp(lane.radius[0], lane.radius[1], near ** 0.8) * (index >= 2 ? HERO.third : 1);
    out.depth = lerp(HERO.depth[1], HERO.depth[0], near * (0.6 + 0.4 * rand())) * (index >= 2 ? 1.25 : 1);
    out.start = (pass - HERO.phases[index % HERO.phases.length]) * period;
    // The nearer, the quicker across: a pass takes a share of the period that grows with depth.
    const far = clamp01((out.depth - HERO.depth[0]) / (HERO.depth[1] - HERO.depth[0]));
    out.duration = period * lerp(HERO.pass[0], HERO.pass[1], clamp01(far * 0.7 + rand() * 0.3));
    // (Its bounding radius is one, stretched by at most 1.12.)
    const margin = out.radius * 1.15 + HERO.margin;
    const backward = rand() < 0.5;
    const { from: tryFrom, to: tryTo } = TRIES[index % HERO_SLOTS];
    let best = Infinity;
    for (let attempt = 0; attempt < 12; attempt++) {
        const start = lane.from[Math.floor(rand() * lane.from.length) % lane.from.length];
        edgePoint(start, rand(), lanes.aspect, margin, tryFrom);
        const exit = lane.to[Math.floor(rand() * lane.to.length) % lane.to.length];
        edgePoint(exit, rand(), lanes.aspect, margin, tryTo);
        let bad = trespass(lanes, tryFrom, tryTo, out.radius, lane.limb);
        if (bad === 0 && index > 0) {
            bad = backward
                ? crowding(seed, index, lanes, tryTo, tryFrom, out.start, out.duration, out.radius)
                : crowding(seed, index, lanes, tryFrom, tryTo, out.start, out.duration, out.radius);
        }
        if (bad < best) {
            best = bad;
            // Either way along the lane.
            out.from.copy(backward ? tryTo : tryFrom);
            out.to.copy(backward ? tryFrom : tryTo);
        }
        if (bad === 0) break;
    }
    out.trespass = best;
    out.shown = best === 0;
    // Its own design: each hero walks the six in its own order, so two rarely wear the same at once.
    out.variant = (index * 2 + pass * (index === 1 ? 5 : 1)) % ROCK_DESIGNS.length;
    out.ice = ICY[out.variant] ? 1 : 0;
    out.tone = rand();
    const z = rand() * 2 - 1;
    const a = rand() * TAU;
    const s = Math.sqrt(1 - z * z);
    out.axis.set(s * Math.cos(a), z, s * Math.sin(a));
    out.rate = lerp(HERO.tumble[0], HERO.tumble[1], rand()) * (rand() < 0.5 ? -1 : 1);
    out.phase = rand() * TAU;
    out.stretch.set(lerp(0.88, 1.12, rand()), lerp(0.88, 1.12, rand()), lerp(0.88, 1.12, rand()));
    return out;
}

/** The pass hero `index` is on at drift-clock `clock` (a whole number, never negative). */
export const heroPassAt = (index, clock) => {
    const period = HERO.periods[index % HERO.periods.length];
    return Math.max(0, Math.floor(clock / period + HERO.phases[index % HERO.phases.length]));
};

/**
 * Where hero `index` is at `clock` (screen heights, y down) and whether it is on its pass: the CPU
 * twin of what the table carries. `state` is a createHeroPass(), re-planned when the pass turns.
 * @returns {{ x: number, y: number, live: boolean, along: number }}
 */
export function heroAt(seed, index, clock, lanes, state, out = {
    x: 0, y: 0, live: false, along: 0,
}) {
    const pass = heroPassAt(index, clock);
    if (state.pass !== pass || state.lanesFor !== lanes) planHeroPass(seed, index, pass, lanes, state);
    const along = (clock - state.start) / state.duration;
    out.along = along;
    out.live = state.shown && along >= 0 && along <= 1;
    const t = clamp01(along);
    out.x = lerp(state.from.x, state.to.x, t);
    out.y = lerp(state.from.y, state.to.y, t);
    return out;
}

// ── Shading ─────────────────────────────────────────────────────────────────────

/** Rodrigues: `v` turned by `angle` about the unit `axis`. */
export const turnAbout = (v, axis, angle) => {
    const c = cos(angle);
    const s = sin(angle);
    return v.mul(c).add(cross(axis, v).mul(s)).add(axis.mul(dot(axis, v)).mul(float(1.0).sub(c)));
};

/**
 * A class of rocks' material: where each vertex is and how the body is lit.
 * @param {object} u     shared uniforms
 * @param {string} name
 * @param {object} body  TSL nodes per instance: centre (world), size (world radius), axis (unit),
 *                       angle, stretch (vec3), variant, ice (0..1), tone (0..1)
 * @param {object} opts
 * @param {boolean} [opts.grain=true]  the body's mottle (one lattice fetch a pixel)
 * @param {boolean} [opts.bump=false]  its fine relief (one more fetch; for bodies tens of pixels across)
 * @param {number}  [opts.glint=1]     how hard ice glints (the chips are a few pixels: less)
 */
export function rockMaterial(u, name, body, { grain = true, bump = false, glint = 1 } = {}) {
    const material = sdSolidMaterial(name);
    const shade = attribute('aShade', 'vec4');
    // Only the model this body wears keeps its shape; the others' vertices fold onto its middle.
    const wears = step(abs(shade.w.sub(body.variant)), 0.5);
    const world = body.centre.add(turnAbout(positionGeometry.mul(body.stretch), body.axis, body.angle)
        .mul(body.size.mul(wears)));
    material.positionNode = world;
    const vWorld = varying(world, `v${name}W`);
    // (A stretched model's normals turn the other way: divided by the stretch, not multiplied.)
    const vNormal = varying(turnAbout(normalize(normalGeometry.div(body.stretch)), body.axis, body.angle), `v${name}N`);
    const vShade = varying(shade.xyz, `v${name}S`);
    // (ice, tone, the body's radius on screen in pixels, its radius in the world)
    const onScreen = body.size.div(max(length(body.centre.sub(u.camPos)), 1e-3).mul(u.pixelAngle));
    const vLook = varying(vec4(body.ice, body.tone, onScreen, body.size), `v${name}L`);
    const vLocal = grain || bump ? varying(positionGeometry, `v${name}Q`) : null;

    material.colorNode = Fn(() => {
        const smooth = normalize(vNormal).toVar();
        const N = smooth.toVar();
        const V = normalize(u.camPos.sub(vWorld)).toVar();
        // The rim is the body's outline: read from its smooth normal, not its relief.
        const edge = float(1.0).sub(clamp(dot(smooth, V), 0.0, 1.0)).toVar();
        const L = u.sunDir;
        // (Clamped: with MSAA a varying is extrapolated past its corners' values on a thin body.)
        const ao = clamp(vShade.x, 0.0, 1.0).toVar();
        const crest = clamp(vShade.y, 0.0, 1.0).toVar();
        const thin = clamp(vShade.z, 0.0, 1.0).toVar();
        const ice = clamp(vLook.x, 0.0, 1.0).toVar();
        const tone = clamp(vLook.y, 0.0, 1.0).toVar();
        const px = max(vLook.z, 0.0).toVar();
        const seedAt = vec3(tone.mul(29.0).add(4.0), 7.0, tone.mul(17.0).add(11.0));
        // The body's own grain: blotches of paler and darker stuff, frost in patches on the ice.
        const g = (grain ? u.noise3(vLocal.mul(2.9).add(seedAt)) : vec2(0.5, 0.5)).toVar();
        if (bump) {
            // A large body's fine relief, from the slope of a height on screen (no tangents, no
            // texture of its own): pits and knobs in rock, softer hummocks of frost on ice.
            const fine = u.noise3(vLocal.mul(8.5).add(seedAt.zxy)).toVar();
            const relief = fine.x.mul(0.65).add(g.x.mul(0.35)).sub(0.5)
                .mul(vLook.w.mul(mix(float(0.27), float(0.008), ice)));
            const dpdx = dFdx(vWorld).toVar();
            const dpdy = dFdy(vWorld).toVar();
            const r1 = cross(dpdy, N).toVar();
            const r2 = cross(N, dpdx).toVar();
            const det = dot(dpdx, r1).toVar();
            const slope = r1.mul(dFdx(relief)).add(r2.mul(dFdy(relief))).mul(sign(det));
            const bent = N.mul(abs(det)).sub(slope).toVar();
            const size = length(bent).toVar();
            N.assign(mix(N, bent.div(max(size, 1e-30)), step(1e-24, size)));
        }
        const ndl = dot(N, L).toVar();
        const ndv = clamp(dot(N, V), 0.0, 1.0).toVar();

        // ── What it is made of ──
        // Rock: warm grey-brown or grey, darker down in its crevices, the rings' pale dust on its crests.
        const rockBase = mix(vec3(0.115, 0.095, 0.079), vec3(0.092, 0.089, 0.087), tone);
        const dusted = smoothstep(0.6, 0.92, crest).mul(0.45);
        const dust = mix(u.ringDust, u.ringIce, 0.4).mul(0.42);
        const rock = mix(rockBase.mul(mix(float(0.32), float(1.4), crest)), dust, dusted)
            .mul(g.x.mul(0.9).add(0.55));
        // Ice: blue-white with a breath of the rings' own colour, bluer in some bodies, frosted
        // paler in patches and a deep blue down in its hollows, where the light has gone furthest.
        const white = mix(u.ringIce, vec3(0.74, 0.86, 1.0), 0.65);
        const glacier = mix(white, white.mul(vec3(0.62, 0.8, 1.0)), tone).mul(g.y.mul(0.26).add(0.46))
            .mul(mix(vec3(0.38, 0.62, 0.95), vec3(1.0), ao.mul(ao)));
        const albedo = mix(rock, glacier, ice).toVar();

        // ── The sun ──
        const sun = u.sun.mul(u.sunGain).toVar();
        const lit = max(ndl, 0.0).toVar();
        // Dust sends light back the way it came: a rocky body is lit a little flatter than ice.
        const flat = lit.mul(2.0).div(lit.add(ndv).add(0.25));
        const diffuse = mix(mix(lit, flat, 0.25), lit, ice);
        // A crater or a seam holds a shadow of its own; ice scatters light into its hollows.
        const open = mix(ao.mul(ao), ao, ice).mul(0.88).add(0.12);
        const col = albedo.mul(sun).mul(diffuse.mul(open)).toVar();
        // Ice glints where a face turns the sun to the eye (not on a speck: it would strobe), and
        // its smooth faces have a wet sheen; rock has only a dull one.
        const H = normalize(L.add(V));
        const nh = clamp(dot(N, H), 1e-4, 1.0).toVar();
        const sharp = pow(nh, 56.0).mul(1.7).add(pow(nh, 14.0).mul(0.16))
            .mul(smoothstep(1.5, 6.0, px))
            .mul(glint);
        const sheen = pow(nh, 8.0).mul(0.035);
        col.addAssign(sun.mul(mix(sheen, sharp, ice)).mul(smoothstep(0.0, 0.12, ndl)).mul(ao));
        // Light through the ice: its thin edges glow when the sun stands behind it, and a little
        // always, where the light comes round the terminator.
        const behind = clamp(dot(V, L).negate(), 0.0, 1.0);
        const round = smoothstep(-0.45, 0.05, ndl).mul(float(1.0).sub(lit));
        const through = thin.mul(behind.mul(behind).mul(1.2)).add(round.mul(thin.mul(0.6).add(0.12)).mul(0.5))
            .mul(float(1.0).sub(lit.mul(0.85)));
        col.addAssign(sun.mul(u.ringIce).mul(vec3(0.36, 0.72, 1.0)).mul(through.mul(ice).mul(0.5)));

        // ── What else lights it ──
        // The giant's own warm light on the side that faces it.
        const toGiant = normalize(vWorld.negate());
        col.addAssign(albedo.mul(u.shine).mul(max(dot(N, toGiant), 0.0).mul(ao).mul(0.08)));
        // The sky's dim light everywhere, and the nebula's colours along the rim; ice mirrors them.
        const rim = edge.mul(edge).mul(edge).toVar();
        const fresnel = rim.mul(edge).mul(edge).mul(0.9).add(0.04);
        const nebula = mix(u.gasB, u.gasA, clamp(smooth.y.mul(0.5).add(0.5), 0.0, 1.0));
        col.addAssign(albedo.mul(u.night).mul(ao.mul(0.8)));
        const sky = mix(nebula, u.night.mul(4.0), 0.4);
        col.addAssign(sky.mul(ao).mul(mix(rim.mul(0.03), fresnel.mul(0.06), ice)));
        // Play's colour: a breath on the rim.
        col.addAssign(u.accent.mul(u.ringGlow.x).mul(rim.mul(edge).mul(0.06)));
        return vec4(col, 1.0);
    })();
    return material;
}

/**
 * The hero rocks: `count` (≤ HERO_SLOTS) large bodies on their own passes through the open sky.
 * @param {object} u      shared uniforms
 * @param {object} frame  the resting camera's frame (createIce): its uniforms and `tanV`, `aspect`
 * @param {number} count
 * @param {number} seed
 */
export function createHeroes(u, frame, count, seed) {
    const n = Math.max(0, Math.min(HERO_SLOTS, count));
    const rows = Array.from({ length: HERO_SLOTS * HERO_ROWS }, () => new THREE.Vector4(0, 0, 0, 0));
    const table = uniformArray(rows, 'vec4');
    const slots = Float32Array.from({ length: Math.max(1, n) }, (_, i) => i);
    const geometry = createRockGeometry('hero', n, { aSlot: [slots, 1] });
    const slot = int(attribute('aSlot', 'float').add(0.5)).mul(HERO_ROWS);
    const A = table.element(slot);
    const B = table.element(slot.add(1));
    const C = table.element(slot.add(2));
    const D = table.element(slot.add(3));
    const material = rockMaterial(u, 'StellarDriftHeroes', {
        centre: A.xyz, size: A.w, axis: B.xyz, angle: B.w, stretch: C.xyz, variant: C.w, ice: D.x, tone: D.y,
    }, { bump: true });
    const part = sdPart('StellarDriftHeroes', geometry, material, 2);
    const states = Array.from({ length: HERO_SLOTS }, createHeroPass);
    const at = {
        x: 0, y: 0, live: false, along: 0,
    };
    let lanes = null;
    return {
        ...part,
        count: n,
        table,
        states,
        /** The lanes for the frame's aspect (re-made only when it changes). */
        lanesFor(aspect) {
            if (!lanes || Math.abs(lanes.aspect - aspect) > 1e-4) lanes = heroLanes(aspect);
            return lanes;
        },
        update(clock) {
            const { tanV } = frame;
            const lane = this.lanesFor(frame.aspect);
            const home = frame.home.value;
            const right = frame.right.value;
            const up = frame.up.value;
            const fwd = frame.fwd.value;
            for (let i = 0; i < n; i++) {
                const s = states[i];
                heroAt(seed, i, clock, lane, s, at);
                const o = i * HERO_ROWS;
                if (!at.live) {
                    rows[o].w = 0;
                    continue;
                }
                // Screen heights → the resting camera's frame at the pass's depth.
                const d = s.depth;
                const x = (2 * at.x - lane.aspect) * tanV * d;
                const y = (1 - 2 * at.y) * tanV * d;
                rows[o].set(
                    home.x + right.x * x + up.x * y + fwd.x * d,
                    home.y + right.y * x + up.y * y + fwd.y * d,
                    home.z + right.z * x + up.z * y + fwd.z * d,
                    s.radius * 2 * tanV * d,
                );
                rows[o + 1].set(s.axis.x, s.axis.y, s.axis.z, s.rate * clock + s.phase);
                rows[o + 2].set(s.stretch.x, s.stretch.y, s.stretch.z, s.variant);
                rows[o + 3].set(s.ice, s.tone, 0, 0);
            }
        },
    };
}
