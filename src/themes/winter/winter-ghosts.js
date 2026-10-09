/**
 * Winter — the snow ghosts' meshes.
 *
 * `assets/snow-ghosts.bin` is written by scripts/winter/bake-ghosts.mjs: five kinds of
 * snow-loaded spruce, four meshes each (the full ghost, one for framing trees further off, one
 * for the stands on the spits, one for the far shore), with what the shader needs baked into
 * every vertex. This module reads it. Where it cannot be read (no
 * fetch, a failed request, a damaged file) plain turned stand-ins are generated instead, so the
 * wood is always there. Three-free: the trees' module turns the arrays into geometry.
 */
import manifest from './assets/snow-ghosts-manifest.json';

export const GHOSTS_URL = new URL('./assets/snow-ghosts.bin', import.meta.url).href;
export const GHOSTS_MAGIC = 'WSG1';
export const GHOST_KINDS = Object.freeze(['sentinel', 'matron', 'leaner', 'gnome', 'twins']);
export const GHOSTS_MANIFEST = manifest;
/** Levels of detail a kind is baked at. */
export const GHOST_LODS = 4;

/**
 * @typedef {object} GhostMesh
 * @property {string} kind
 * @property {number} lod        0 = the full ghost .. 3 = the far one
 * @property {number} height     metres the kind was modelled at (instances scale it)
 * @property {Float32Array} positions
 * @property {Int8Array} normals   count × 4, signed-normalised (xyz, pad)
 * @property {Uint8Array} shade    count × 4: openness, needles, thinness, height
 * @property {Uint16Array|Uint32Array} indices
 */

/**
 * Decode the baked file.
 * @param {ArrayBuffer} buffer
 * @returns {{ meshes: GhostMesh[], source: 'asset' }}
 */
export function decodeGhosts(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (magic !== GHOSTS_MAGIC) throw new Error('not a snow-ghost file');
    const headerLength = view.getUint32(4, true);
    const bodyLength = view.getUint32(8, true);
    const body = 12 + headerLength;
    if (body + bodyLength > buffer.byteLength) throw new Error('snow-ghost file is short');
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, body)));
    if (header.version !== 1) throw new Error(`snow-ghost version ${header.version}`);
    const meshes = header.meshes.map((m) => {
        const quantised = new Uint16Array(buffer.slice(body + m.position, body + m.position + m.vertices * 6));
        const positions = new Float32Array(m.vertices * 3);
        for (let v = 0; v < m.vertices; v++) {
            for (let c = 0; c < 3; c++) {
                positions[v * 3 + c] = m.min[c] + (quantised[v * 3 + c] / 65535) * (m.max[c] - m.min[c]);
            }
        }
        const indexLength = m.triangles * 3;
        const Index = m.indexBytes === 4 ? Uint32Array : Uint16Array;
        return {
            kind: m.kind,
            lod: m.lod,
            height: m.height,
            positions,
            normals: new Int8Array(buffer.slice(body + m.normal, body + m.normal + m.vertices * 4)),
            shade: new Uint8Array(buffer.slice(body + m.shade, body + m.shade + m.vertices * 4)),
            indices: new Index(buffer.slice(body + m.index, body + m.index + indexLength * m.indexBytes)),
        };
    });
    return { meshes, source: 'asset' };
}

/** A turned stand-in for one kind: a stack of pillows, dark under each. */
function turned(kind, height, girth, lod) {
    const around = [14, 11, 8, 6][lod];
    const up = [40, 26, 14, 8][lod];
    const tiers = Math.max(3, Math.round(height * 1.1));
    const radius = (t) => (girth * (1 - t) ** 0.8 + 0.08) * (1 + 0.34 * Math.abs(Math.sin(t * tiers * Math.PI)));
    const count = (around + 1) * (up + 1);
    const positions = new Float32Array(count * 3);
    const normals = new Int8Array(count * 4);
    const shade = new Uint8Array(count * 4);
    for (let j = 0; j <= up; j++) {
        const t = j / up;
        const r = radius(t);
        const slope = (radius(Math.min(1, t + 0.01)) - radius(Math.max(0, t - 0.01))) / (0.02 * height);
        for (let i = 0; i <= around; i++) {
            const a = (i / around) * Math.PI * 2;
            const v = j * (around + 1) + i;
            positions.set([Math.cos(a) * r, t * height, Math.sin(a) * r], v * 3);
            const len = Math.hypot(1, slope);
            normals.set([Math.round((Math.cos(a) / len) * 127), Math.round((-slope / len) * 127), Math.round((Math.sin(a) / len) * 127), 0], v * 4);
            // Where a pillow widens upward the eye is looking at its underside.
            shade.set([slope > 0.25 ? 120 : 230, slope > 0.4 ? 255 : 0, 70, Math.round(t * 255)], v * 4);
        }
    }
    const indices = new Uint16Array(around * up * 6);
    let o = 0;
    for (let j = 0; j < up; j++) {
        for (let i = 0; i < around; i++) {
            const a = j * (around + 1) + i;
            const b = a + around + 1;
            indices.set([a, b, a + 1, a + 1, b, b + 1], o);
            o += 6;
        }
    }
    return {
        kind, lod, height, positions, normals, shade, indices,
    };
}

/** Stand-ins for every kind and every level of detail. */
export function planGhosts() {
    const shapes = {
        sentinel: [10, 1.5], matron: [9, 2.0], leaner: [8.5, 1.4], gnome: [2.4, 0.95], twins: [2.2, 0.9],
    };
    const meshes = [];
    GHOST_KINDS.forEach((kind) => {
        for (let lod = 0; lod < GHOST_LODS; lod++) meshes.push(turned(kind, shapes[kind][0], shapes[kind][1], lod));
    });
    return { meshes, source: 'plan' };
}

/**
 * Fetch and decode the ghosts. Never rejects: the stand-ins are the fallback.
 * @returns {Promise<{ meshes: GhostMesh[], source: 'asset' | 'plan' }>}
 */
export async function loadGhosts(url = GHOSTS_URL) {
    try {
        if (typeof fetch !== 'function') return planGhosts();
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== manifest.bytes) throw new Error(`${buffer.byteLength} bytes, expected ${manifest.bytes}`);
        return decodeGhosts(buffer);
    } catch (error) {
        console.warn('[Winter] the snow ghosts could not be read; using stand-ins:', error?.message || error);
        return planGhosts();
    }
}

/** The mesh of a kind at a level of detail (the nearest one there is). */
export function ghostMesh(ghosts, kind, lod) {
    let best = null;
    for (let i = 0; i < ghosts.meshes.length; i++) {
        const m = ghosts.meshes[i];
        if (m.kind !== kind) continue;
        if (!best || Math.abs(m.lod - lod) < Math.abs(best.lod - lod)) best = m;
    }
    return best;
}
