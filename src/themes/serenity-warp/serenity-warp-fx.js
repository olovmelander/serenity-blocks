/**
 * Serenity Warp — light the board sends into the sky (drawn in screen space, so it lines up with
 * the card and the gate exactly).
 *
 *  - Streams: the cleared rows leave the card as streams of light that run to the throat along
 *    a gentle bow, a bright bead travelling ahead of each. The gate takes them in.
 *  - Flares: a four-pointed star of light where something is born or swallowed: the edge of the
 *    card a lock's piece comes out of (in its colour), the rim a piece falls into.
 *
 * Nothing is created at event time and every pool is always drawn (dormant slots collapse to
 * zero size), so the first frame compiles every pipeline.
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    clamp,
    exp,
    float,
    int,
    length,
    max,
    min,
    mix,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uniformArray,
    uv,
    varying,
    vec2,
    vec4,
} from 'three/tsl';
import {
    STREAM_LIFE, STREAM_SLOTS, swFxMaterial, swPart, swQuadGeometry,
} from './serenity-warp-tsl.js';

/** Flares held at once, and how long one lives (seconds). */
export const FLARE_SLOTS = 10;
export const FLARE_LIFE = 0.9;
/** Segments along a stream (it bows, so it is a strip, not one quad). */
const STREAM_SEGMENTS = 24;

/**
 * The slot to write next in a table of two rows a slot (birth in row A's z): a spent one, else the
 * one with the least light left (`left(slot, age)`; one not born yet keeps all of it). A burst
 * never cuts off a stream or a flare still in full light while a fading one is there to take.
 */
function weakestSlot(table, slots, time, life, left) {
    let pick = 0;
    let least = Infinity;
    for (let i = 0; i < slots; i++) {
        const age = time - table[i * 2].z;
        const light = age > life ? 0 : left(i, Math.max(0, age) / life);
        if (light < least) {
            least = light;
            pick = i;
        }
    }
    return pick;
}

/** A strip of `segments` quads along x (0..1) for `count` instances, with an instance index. */
function stripGeometry(count, segments) {
    const geometry = new THREE.InstancedBufferGeometry();
    const position = [];
    const uvs = [];
    const index = [];
    for (let i = 0; i <= segments; i++) {
        const x = i / segments;
        position.push(x, -0.5, 0, x, 0.5, 0);
        uvs.push(x, 0, x, 1);
        if (i < segments) {
            const a = i * 2;
            index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
    }
    geometry.setIndex(index);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const ids = new Float32Array(count);
    for (let i = 0; i < count; i++) ids[i] = i;
    geometry.setAttribute('aSlot', new THREE.InstancedBufferAttribute(ids, 1));
    geometry.instanceCount = count;
    return geometry;
}

export function createStreams(u) {
    const geometry = stripGeometry(STREAM_SLOTS, STREAM_SEGMENTS);
    // Two rows a stream: (where it leaves the card, UV y down; birth; strength), (colour, bow).
    const table = Array.from({ length: STREAM_SLOTS * 2 }, () => new THREE.Vector4(0, 0, -100, 0));
    const rows = uniformArray(table, 'vec4');
    const base = int(attribute('aSlot', 'float').add(0.5)).mul(2);
    const A = rows.element(base);
    const C = rows.element(base.add(1));
    const age = u.time.sub(A.z);
    const k = clamp(age.div(STREAM_LIFE), 0.0, 1.0);
    const live = step(0.0, age).mul(step(age, STREAM_LIFE)).mul(step(1e-3, A.w));
    // Screen heights, y up: the way from where it leaves to the gate.
    const aspect = u.viewport.x.div(u.viewport.y);
    const start = vec2(A.x.mul(aspect), float(1.0).sub(A.y));
    const gate = vec2(u.gateUv.x.mul(aspect), float(1.0).sub(u.gateUv.y));
    const way = gate.sub(start);
    const far = max(length(way), 1e-3);
    const dir = way.div(far);
    const side = vec2(dir.y.negate(), dir.x);
    // It runs out fast and reaches the rim; its light runs along it after.
    const reach = far.mul(float(1.0).sub(exp(k.mul(-6.5)))).mul(0.97);
    const along = positionGeometry.x;
    const run = along.mul(reach);
    const bow = sin(along.mul(Math.PI)).mul(C.w).mul(reach).mul(0.16);
    const widthPx = float(4.5).mul(A.w).mul(live).mul(float(1.0).sub(along.mul(0.55)));
    const at = start.add(dir.mul(run)).add(side.mul(bow))
        .add(side.mul(positionGeometry.y.mul(2.0).mul(widthPx).div(u.viewport.y)));
    const material = swFxMaterial('SerenityWarpStreams');
    material.vertexNode = vec4(at.x.div(aspect).mul(2.0).sub(1.0), at.y.mul(2.0).sub(1.0), 1.0, 1.0);
    const fade = float(1.0).sub(k);
    const vLight = varying(C.rgb.mul(A.w).mul(fade.mul(fade)).mul(live).mul(u.iris), 'swStreamLight');
    const vAge = varying(k, 'swStreamAge');
    const st = uv();
    const q = clamp(st.y.sub(0.5).mul(2.0), -1.0, 1.0);
    const across = exp(q.mul(q).mul(-3.2));
    // A bright bead runs ahead along it and into the gate.
    const beadAt = min(vAge.mul(1.9), 1.0);
    const bead = exp(st.x.sub(beadAt).mul(st.x.sub(beadAt)).mul(-90.0)).mul(2.6);
    const root = smoothstep(0.0, 0.05, st.x);
    material.colorNode = vec4(vLight.mul(across).mul(float(0.55).add(bead)).mul(root), 0.0);

    const part = swPart('SerenityWarpStreams', geometry, material, 80);
    let cursor = 0;
    const streamLeft = (i, gone) => table[i * 2].w * (1 - gone) * (1 - gone);
    /**
     * One stream per point. `points` are where the rows leave the card (UV, y down).
     * @param {{ x: number, y: number }[]} points
     */
    part.fire = (points, rgb, time, strength = 1) => {
        for (let i = 0; i < points.length && i < 4; i++) {
            const slot = weakestSlot(table, STREAM_SLOTS, time, STREAM_LIFE, streamLeft);
            cursor += 1;
            const lean = (i % 2 ? -1 : 1) * (0.6 + 0.4 * ((cursor * 0.37) % 1));
            table[slot * 2].set(points[i].x, points[i].y, time + i * 0.04, strength);
            table[slot * 2 + 1].set(rgb[0], rgb[1], rgb[2], lean);
        }
    };
    part.reset = () => {
        cursor = 0;
        for (let i = 0; i < STREAM_SLOTS; i++) table[i * 2].set(0, 0, -100, 0);
    };
    part.table = table;
    return part;
}

export function createFlares(u) {
    const ids = new Float32Array(FLARE_SLOTS);
    for (let i = 0; i < FLARE_SLOTS; i++) ids[i] = i;
    const geometry = swQuadGeometry(FLARE_SLOTS, { aSlot: [ids, 1] });
    // Two rows a flare: (UV y down, birth, size in frame heights), (colour, strength).
    const table = Array.from({ length: FLARE_SLOTS * 2 }, () => new THREE.Vector4(0, 0, -100, 0));
    const rows = uniformArray(table, 'vec4');
    const base = int(attribute('aSlot', 'float').add(0.5)).mul(2);
    const A = rows.element(base);
    const C = rows.element(base.add(1));
    const age = u.time.sub(A.z);
    const k = clamp(age.div(FLARE_LIFE), 0.0, 1.0);
    const live = step(0.0, age).mul(step(age, FLARE_LIFE)).mul(step(1e-4, C.w));
    const aspect = u.viewport.x.div(u.viewport.y);
    const size = A.w.mul(float(0.6).add(k.mul(0.8))).mul(live);
    const centre = vec2(A.x.mul(2.0).sub(1.0), float(1.0).sub(A.y.mul(2.0)));
    const material = swFxMaterial('SerenityWarpFlares');
    material.vertexNode = vec4(centre.add(positionGeometry.xy.mul(size.mul(2.0)).mul(vec2(float(1.0).div(aspect), 1.0))), 1.0, 1.0);
    const fade = float(1.0).sub(k);
    const vLight = varying(C.rgb.mul(C.w).mul(fade.mul(fade).mul(fade)).mul(live).mul(u.iris), 'swFlareLight');
    const p = uv().sub(0.5).mul(2.0);
    const r = length(p);
    const core = exp(r.mul(r).mul(-60.0)).mul(3.0);
    const halo = exp(r.mul(-5.0)).mul(0.35);
    // Four long, thin points of light, and four shorter ones between them.
    const ax = abs(p.x);
    const ay = abs(p.y);
    const spikes = exp(ay.mul(-90.0)).add(exp(ax.mul(-90.0))).mul(float(1.0).sub(smoothstep(0.0, 1.0, r)));
    const d1 = abs(p.x.add(p.y)).mul(0.707);
    const d2 = abs(p.x.sub(p.y)).mul(0.707);
    const minor = exp(d1.mul(-110.0)).add(exp(d2.mul(-110.0))).mul(float(1.0).sub(smoothstep(0.0, 0.5, r))).mul(0.4);
    const edge = float(1.0).sub(smoothstep(0.85, 1.0, r));
    material.colorNode = vec4(vLight.mul(core.add(halo).add(spikes.mul(1.3)).add(minor)).mul(edge).mul(mix(float(1.0), float(0.6), k)), 0.0);

    const part = swPart('SerenityWarpFlares', geometry, material, 90);
    const flareLeft = (i, gone) => table[i * 2 + 1].w * (1 - gone) ** 3;
    /** A flare at a screen point (UV, y down), `span` in frame heights. */
    part.fire = (x, y, rgb, time, span = 0.08, strength = 1) => {
        const slot = weakestSlot(table, FLARE_SLOTS, time, FLARE_LIFE, flareLeft);
        table[slot * 2].set(x, y, time, span);
        table[slot * 2 + 1].set(rgb[0], rgb[1], rgb[2], strength);
    };
    part.reset = () => {
        for (let i = 0; i < FLARE_SLOTS; i++) {
            table[i * 2].set(0, 0, -100, 0);
            table[i * 2 + 1].set(0, 0, 0, 0);
        }
    };
    part.table = table;
    return part;
}
