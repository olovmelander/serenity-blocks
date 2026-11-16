/**
 * Halcyon Apex — the skyfarers' hulls and lamps (CPU only, three-free).
 *
 * The craft that come to the sanctuary's light are modelled in Blender
 * (scripts/blender/halcyon_apex_fleet.py writes halcyon-apex-fleet-model.js: nothing is loaded at
 * run time). This module unpacks them into one vertex buffer, each kind a contiguous range, and
 * names what each vertex is made of, where each hull's lamps sit and where its engines burn.
 *
 *   saucer   a chrome disc, 15 m      swift    a courier dart, 17 m, crescent wings
 *   manta    a dark flying wing, 44 m barge    a hauler with a cargo of crystals, 34 m
 *   ark      a ship under sails, 233 m hoop    a ring that carries a crystal, 20 m
 *   capsule  a plain white capsule    orb      a ball of light
 *
 * How they fly is halcyon-apex-flight.js; how they are drawn, halcyon-apex-visitors.js.
 */

import { HALCYON_FLEET } from './halcyon-apex-fleet-model.js';

/** The hull kinds, in the order their ranges lie in the buffer. */
export const VISITOR_KINDS = Object.freeze(Object.keys(HALCYON_FLEET.hulls));
export const VISITOR_KIND = Object.freeze(Object.fromEntries(VISITOR_KINDS.map((k, i) => [k, i])));

/**
 * What a hull vertex is made of (aPart.x). `param` (aPart.y) is the albedo for the painted
 * surfaces, the lamp group (0 | 1) for lamps.
 */
export const SURFACE = Object.freeze({
    chrome: 0, satin: 1, matte: 2, glass: 3, lamp: 4, orb: 5, pearl: 6, engine: 7, trim: 8, crystal: 9,
});

/** Lamp sprites the sky may show at once. */
export const LAMP_POOL = 192;
/** Ribbons (an exhaust trail or a beam each) the sky may show at once, and the cross-sections in one. */
export const RIBBONS = 30;
export const RIBBON_SAMPLES = 24;

function bytesOf(text) {
    const binary = globalThis.atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

let built = null;

/**
 * Every hull in one buffer: position, normal and part (surface, param 0..1, kind, occlusion 0..1),
 * and one index. Each kind's vertices and indices are one contiguous range
 * (`ranges[kind] = { vertex: [start, count], index: [start, count] }`). Unpacked once a session.
 */
export function buildHulls() {
    if (built) return built;
    const total = VISITOR_KINDS.reduce((sum, name) => sum + HALCYON_FLEET.hulls[name].vertexCount, 0);
    const triangles = VISITOR_KINDS.reduce((sum, name) => sum + HALCYON_FLEET.hulls[name].triangleCount, 0);
    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    const part = new Float32Array(total * 4);
    const index = total > 65535 ? new Uint32Array(triangles * 3) : new Uint16Array(triangles * 3);
    const ranges = [];
    const sizes = [];
    let v0 = 0;
    let i0 = 0;
    VISITOR_KINDS.forEach((name, kind) => {
        const hull = HALCYON_FLEET.hulls[name];
        const p = new Int16Array(bytesOf(hull.positions).buffer);
        const n = new Int8Array(bytesOf(hull.normals).buffer);
        const q = bytesOf(hull.parts);
        const ix = new Uint16Array(bytesOf(hull.index).buffer);
        for (let i = 0; i < hull.vertexCount; i++) {
            const o = (v0 + i) * 3;
            position[o] = p[i * 3] * hull.quant;
            position[o + 1] = p[i * 3 + 1] * hull.quant;
            position[o + 2] = p[i * 3 + 2] * hull.quant;
            const nx = n[i * 3];
            const ny = n[i * 3 + 1];
            const nz = n[i * 3 + 2];
            const l = Math.hypot(nx, ny, nz) || 1;
            normal[o] = nx / l;
            normal[o + 1] = ny / l;
            normal[o + 2] = nz / l;
            const w = (v0 + i) * 4;
            part[w] = q[i * 4];
            part[w + 1] = q[i * 4 + 1] / 255;
            part[w + 2] = kind;
            part[w + 3] = q[i * 4 + 2] / 255;
        }
        for (let i = 0; i < ix.length; i++) index[i0 + i] = ix[i] + v0;
        ranges[kind] = { vertex: [v0, hull.vertexCount], index: [i0, ix.length] };
        sizes[kind] = { min: hull.min, max: hull.max };
        v0 += hull.vertexCount;
        i0 += ix.length;
    });
    built = Object.freeze({
        position, normal, part, index, ranges, sizes, vertexCount: total, indexCount: triangles * 3,
    });
    return built;
}

/**
 * Where each kind's lamps sit on its hull (metres, hull space: x the nose, y up, z starboard), and
 * what kind of lamp each is. The world lights them as sprites, so a lamp still reads as a point of
 * light when its hull is a few pixels across.
 */
export const VISITOR_LAMPS = Object.freeze(Object.fromEntries(VISITOR_KINDS.map((name) => [
    name,
    Object.freeze(HALCYON_FLEET.hulls[name].lamps.map(([group, x, y, z, size, index]) => Object.freeze({
        at: [x, y, z], group: HALCYON_FLEET.lampGroups[group], index, size,
    }))),
])));

/** Where each kind's engines burn: [x, y, z, radius] in hull space. An exhaust trail leaves from the last. */
export const VISITOR_ENGINES = Object.freeze(Object.fromEntries(VISITOR_KINDS.map((name) => [
    name, Object.freeze(HALCYON_FLEET.hulls[name].engines.map((e) => Object.freeze([...e]))),
])));

/** Where a kind's exhaust trail leaves its hull (hull space), or null for a hull without engines. */
export function trailOrigin(kind) {
    const engines = VISITOR_ENGINES[kind];
    if (engines && engines.length) return engines[engines.length - 1];
    if (kind === 'orb') return [0, 0, 0, 1];
    return null;
}
