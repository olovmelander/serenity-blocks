/**
 * Sunbraid — the monoliths as plain arrays (three-free).
 *
 * The valley's standing stones were sculpted by script in Blender
 * (scripts/blender/sunbraid_monoliths.py → sunbraid-monolith-models.js: base64 typed arrays, no
 * loader and no asset file): eight shapes at unit height (foot at y = 0, top at y = 1, buried to
 * y = −0.05), each at two levels of detail, with the flat-topped cylinders that cast its shadows
 * worked out from its own mesh. This module decodes a shape once a page and hands it on as floats;
 * the land's plan reads the shadow cylinders, the towers' part reads the meshes.
 */
import { SUNBRAID_MONOLITH_MODELS } from './sunbraid-monolith-models.js';

/** How many shapes the towers share (each instanced). */
export const MONOLITH_VARIANTS = SUNBRAID_MONOLITH_MODELS.variants.length;
/** The levels of detail a shape comes in. */
export const MONOLITH_LEVELS = Object.freeze(['hi', 'lo']);
/** How far below its foot a shape goes on (unit heights), so a tower never floats. */
export const MONOLITH_BURY = 0.05;

function decode(text, Type) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer);
}

const wrap = (v) => ((v % MONOLITH_VARIANTS) + MONOLITH_VARIANTS) % MONOLITH_VARIANTS;

/** Shape `v`'s kind: 'tower', 'butte' or 'mitten' (a butte's shoulder with a tower off one side). */
export function monolithKind(v) {
    return SUNBRAID_MONOLITH_MODELS.variants[wrap(v)].kind;
}

/**
 * The flat-topped cylinders that cast shape `v`'s shadows, at unit height: { t0, t1, r, x, z }
 * (one a tier, bottom first; x and z its axis).
 */
export function monolithProxies(v) {
    return SUNBRAID_MONOLITH_MODELS.variants[wrap(v)].proxies;
}

const meshes = new Map();

/**
 * Shape `v` at a level of detail, decoded once a page: `position` and `normal` (xyz floats, unit
 * height), `shade` (two floats a vertex, 0..1: ambient occlusion, 1 in the open; and crest, 0 in a
 * crevice, ½ on a flat face, 1 on an exposed arris), `index` (triangles, counter-clockwise from
 * outside).
 * @param {number} v
 * @param {'hi'|'lo'} [level]
 */
export function monolithMesh(v, level = 'hi') {
    const variant = wrap(v);
    const key = `${variant}:${level}`;
    const known = meshes.get(key);
    if (known) return known;
    const model = SUNBRAID_MONOLITH_MODELS.variants[variant][level];
    if (!model) throw new Error(`Sunbraid has no monolith ${variant} at level "${level}".`);
    const { quant } = SUNBRAID_MONOLITH_MODELS;
    const raw = decode(model.positions, Int16Array);
    const position = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) position[i] = raw[i] * quant;
    const rawNormal = decode(model.normals, Int8Array);
    const normal = new Float32Array(rawNormal.length);
    for (let i = 0; i < rawNormal.length; i += 3) {
        const x = rawNormal[i];
        const y = rawNormal[i + 1];
        const z = rawNormal[i + 2];
        const len = Math.hypot(x, y, z) || 1;
        normal[i] = x / len;
        normal[i + 1] = y / len;
        normal[i + 2] = z / len;
    }
    const rawShade = decode(model.shade, Uint8Array);
    const shade = new Float32Array(rawShade.length);
    for (let i = 0; i < rawShade.length; i += 1) shade[i] = rawShade[i] / 255;
    const mesh = Object.freeze({
        variant,
        level,
        kind: monolithKind(variant),
        vertexCount: model.vertexCount,
        triangleCount: model.triangleCount,
        position,
        normal,
        shade,
        index: decode(model.index, Uint16Array),
    });
    meshes.set(key, mesh);
    return mesh;
}
