/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Rainbow Terraces — the Blender-built models as geometry.
 *
 * The overlook's balustrade and the grove's trees were built by script in Blender
 * (scripts/blender/rainbow_terraces_models.py → rainbow-terraces-models.js: base64 typed arrays, no
 * loader and no asset file). This module decodes a model once a page and lays it out as the stone
 * builders want it (rainbow-terraces-isles.js): a BufferGeometry with `position`, `normal`, `aMat`
 * (the stone kind, constant over a piece), `aAO` (the baked ambient occlusion) and, on the
 * overlook, `aMoss`, indexed, in the game's own space (x right, y up, z toward the eye).
 *
 *   treeGeometry        one tree of the grove at its spot: a cypress, a stone pine or a shrub, in
 *                       one of its variants, at one of three levels of detail
 *   balustradeGeometry  the overlook's corner: the paving on its walled ledge, the plinth course,
 *                       the balusters, the handrail, the two piers, the ivy
 */
import * as THREE from 'three/webgpu';
import { RAINBOW_TERRACES_MODELS as MODELS } from './rainbow-terraces-models.js';

function decode(text, Type) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer);
}

/** The stone kinds these models are made of (rainbow-terraces-isles.js, MAT). */
const BARK = 1;
const LEAF = 5;

const unpacked = new WeakMap();

/**
 * A packed model as floats, decoded once a page: `position` and `normal` (xyz), `ao` and `moss`
 * (0..1; `moss` null where the model has none), `mat` (the stone kind of every vertex), `index`.
 */
function unpack(model, quant) {
    const known = unpacked.get(model);
    if (known) return known;
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
    const count = position.length / 3;
    const byteOf = (text) => {
        const bytes = decode(text, Uint8Array);
        const out = new Float32Array(bytes.length);
        for (let i = 0; i < bytes.length; i += 1) out[i] = bytes[i] / 255;
        return out;
    };
    const mat = new Float32Array(count);
    model.kinds.forEach(([kind, first, n]) => mat.fill(kind, first, first + n));
    const out = Object.freeze({
        count,
        triangles: model.triangleCount,
        position,
        normal,
        ao: byteOf(model.ao),
        moss: model.moss ? byteOf(model.moss) : null,
        mat,
        index: decode(model.index, Uint16Array),
    });
    unpacked.set(model, out);
    return out;
}

// ── Pieces gathered into one geometry ──

/** Vertices and triangles gathered from placed models: grown as they come, read out once. */
class Gather {
    constructor() {
        this.position = [];
        this.normal = [];
        this.mat = [];
        this.ao = [];
        this.moss = [];
        this.index = [];
    }

    get count() {
        return this.mat.length;
    }

    /**
     * A model placed: scaled (sx, sy, sz), turned `turn` about y, moved to (x, y, z); `mirror`
     * turns it over in x first (its triangles re-wound so that they still face out).
     */
    add(model, {
        x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, turn = 0, mirror = false, shade = 1,
    } = {}) {
        const base = this.count;
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        const mx = mirror ? -1 : 1;
        const p = model.position;
        const n = model.normal;
        for (let v = 0; v < model.count; v += 1) {
            const px = p[v * 3] * sx * mx;
            const py = p[v * 3 + 1] * sy;
            const pz = p[v * 3 + 2] * sz;
            this.position.push(x + px * c + pz * s, y + py, z - px * s + pz * c);
            // (A stretch turns the normals the other way: scale by its inverse, then renormalise.)
            const nx = (n[v * 3] / sx) * mx;
            const ny = n[v * 3 + 1] / sy;
            const nz = n[v * 3 + 2] / sz;
            const len = Math.hypot(nx, ny, nz) || 1;
            this.normal.push((nx * c + nz * s) / len, ny / len, (-nx * s + nz * c) / len);
            this.mat.push(model.mat[v]);
            this.ao.push(model.ao[v] * shade);
            this.moss.push(model.moss ? model.moss[v] : 0);
        }
        const idx = model.index;
        for (let t = 0; t < idx.length; t += 3) {
            if (mirror) this.index.push(base + idx[t], base + idx[t + 2], base + idx[t + 1]);
            else this.index.push(base + idx[t], base + idx[t + 1], base + idx[t + 2]);
        }
        return this;
    }

    geometry(withMoss = false) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.position), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.normal), 3));
        g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(this.mat), 1));
        g.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(this.ao), 1));
        if (withMoss) g.setAttribute('aMoss', new THREE.BufferAttribute(new Float32Array(this.moss), 1));
        g.setIndex(new THREE.BufferAttribute(new (this.count > 65535 ? Uint32Array : Uint16Array)(this.index), 1));
        return g;
    }
}

// ── The grove's trees ──

/** The kinds of tree a grove's spot names (its fifth number): a cypress, a stone pine, a shrub. */
export const TREE_KINDS = Object.freeze(['cypress', 'pine', 'shrub']);
/** A tree's levels of detail: 0 the crown close by, 1 across the gulf, 2 on a far isle. */
export const TREE_LEVELS = 3;
/**
 * How far over its spot a tree's foot is set (metres): a spot is sunk 1.3 m into the turf (1 m on
 * a far isle), so the foot lies a little under the turf and the trunk runs on down from it.
 */
export const TREE_FOOT = 0.9;
/** How far below its foot a trunk runs on (sizes), so no tree stands on air on a coarse crown. */
export const TREE_ROOT = 0.5;

const kindOf = (kind) => TREE_KINDS[kind] ?? TREE_KINDS[2];

/** How many shapes a kind of tree comes in. */
export function treeVariants(kind) {
    return MODELS.trees[kindOf(kind)].length;
}

/** A tree's model as floats (unpack): unit size, its foot at the origin. */
export function treeModel(kind, variant = 0, level = 0) {
    const variants = MODELS.trees[kindOf(kind)];
    const levels = variants[((variant % variants.length) + variants.length) % variants.length];
    return unpack(levels[Math.min(levels.length - 1, Math.max(0, level))], MODELS.trees.quant);
}

/**
 * One tree of a grove at its spot [x, y, z, size, kind] (y sunk into the turf): its geometry, the
 * trunk reaching below y. `turn` (radians) faces it, `tall` and `wide` stretch it (about 1),
 * `variant` picks its shape.
 */
export function treeGeometry([x, y, z, size, kind], {
    level = 0, variant = 0, turn = 0, tall = 1, wide = 1,
} = {}) {
    const model = treeModel(kind, variant, level);
    const shrub = kindOf(kind) === 'shrub';
    // A shrub is a mound whose skirts lie under the turf: the larger it is, the deeper it sits.
    const foot = shrub ? TREE_FOOT + 0.1 - 0.1 * size * wide : TREE_FOOT;
    return new Gather().add(model, {
        x, y: y + foot, z, sx: size * wide, sy: size * tall, sz: size * wide, turn,
    }).geometry();
}

// ── The overlook's balustrade ──

/** The balustrade's levels of detail: 0 lean (eight-sided balusters, thinner ivy), 1 full. */
export const BALUSTRADE_LEVELS = 2;
/** Its lay-out (metres): the balusters' pitch and count, where the piers stand, its top. */
export const BALUSTRADE = Object.freeze({ ...MODELS.balustrade.layout });
/** The share of the ivy's leaves a level grows (their rows thin evenly), and how much larger each. */
const IVY_SHARE = Object.freeze([[0.6, 1.14], [1, 1]]);

/** The ivy's leaves as rows: [x, y, z, nx, ny, nz, bearing (radians), length (m), occlusion]. */
function ivyLeaves() {
    const { ivy, quant } = MODELS.balustrade;
    const known = unpacked.get(ivy);
    if (known) return known;
    const bytes = decode(ivy.leaves, Uint8Array);
    const view = new DataView(bytes.buffer);
    const rows = [];
    for (let o = 0; o + 12 <= bytes.length; o += 12) {
        const n = [view.getInt8(o + 6), view.getInt8(o + 7), view.getInt8(o + 8)];
        const len = Math.hypot(n[0], n[1], n[2]) || 1;
        rows.push([
            view.getInt16(o, true) * quant, view.getInt16(o + 2, true) * quant, view.getInt16(o + 4, true) * quant,
            n[0] / len, n[1] / len, n[2] / len,
            (view.getUint8(o + 9) / 256) * Math.PI * 2, view.getUint8(o + 10) / 1000, view.getUint8(o + 11) / 255,
        ]);
    }
    unpacked.set(ivy, rows);
    return rows;
}

/**
 * Grow the ivy into a gather: a leaf at each of the module's places (a folded blade of four
 * triangles: its tip's bearing is measured round its normal from the axis `normal × up`), and the
 * stems as three-sided tubes.
 */
function addIvy(g, level) {
    const { ivy, quant } = MODELS.balustrade;
    const {
        points, index, lift, cup,
    } = ivy.leafShape;
    const rows = ivyLeaves();
    const [share, grow] = IVY_SHARE[Math.min(IVY_SHARE.length - 1, Math.max(0, level))];
    const count = Math.round(rows.length * share);
    for (let k = 0; k < count; k += 1) {
        const [x, y, z, nx, ny, nz, bearing, length, ao] = rows[k];
        // The frame the bearing is measured in: a = n × ref, b = n × a (ref is up, or x for a level leaf).
        const up = Math.abs(ny) < 0.95;
        let ax = up ? -nz : 0;
        let ay = up ? 0 : nz;
        let az = up ? nx : -ny;
        const al = Math.hypot(ax, ay, az) || 1;
        ax /= al; ay /= al; az /= al;
        const bx = ny * az - nz * ay;
        const by = nz * ax - nx * az;
        const bz = nx * ay - ny * ax;
        const c = Math.cos(bearing);
        const s = Math.sin(bearing);
        const tx = ax * c + bx * s;
        const ty = ay * c + by * s;
        const tz = az * c + bz * s;
        // Across the blade: tip × normal.
        const sx = ty * nz - tz * ny;
        const sy = tz * nx - tx * nz;
        const sz = tx * ny - ty * nx;
        const size = length * grow;
        const base = g.count;
        for (const [u, v, w] of points) {
            g.position.push(
                x + (sx * u + tx * v + nx * w) * size,
                y + (sy * u + ty * v + ny * w) * size,
                z + (sz * u + tz * v + nz * w) * size,
            );
            // The shading normal leans up to the sky, and each half away from the midrib.
            const side = Math.sign(u) * cup;
            const mx = nx + sx * side;
            const my = ny + lift + sy * side;
            const mz = nz + sz * side;
            const ml = Math.hypot(mx, my, mz) || 1;
            g.normal.push(mx / ml, my / ml, mz / ml);
            g.mat.push(LEAF);
            g.ao.push(ao);
            g.moss.push(0);
        }
        for (const i of index) g.index.push(base + i);
    }
    // The stems: rows of [x, y, z, radius], a row of zeros after each.
    const raw = decode(ivy.stems, Int16Array);
    let stem = [];
    for (let o = 0; o + 4 <= raw.length; o += 4) {
        if (raw[o + 3] !== 0) {
            stem.push([raw[o] * quant, raw[o + 1] * quant, raw[o + 2] * quant, raw[o + 3] * quant]);
        } else {
            if (stem.length > 1) addStem(g, stem);
            stem = [];
        }
    }
}

const STEM_SIDES = 3;

/** A stem as a tube of bark along its points (a frame carried along it, so it never twists). */
function addStem(g, stem) {
    const base = g.count;
    let ux = 0;
    let uy = 0;
    let uz = 0;
    for (let i = 0; i < stem.length; i += 1) {
        const a = stem[Math.max(0, i - 1)];
        const b = stem[Math.min(stem.length - 1, i + 1)];
        let tx = b[0] - a[0];
        let ty = b[1] - a[1];
        let tz = b[2] - a[2];
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        if (i === 0) {
            // Any axis across the first tangent.
            [ux, uy, uz] = Math.abs(tx) < 0.9 ? [1, 0, 0] : [0, 0, 1];
        }
        const d = ux * tx + uy * ty + uz * tz;
        ux -= tx * d; uy -= ty * d; uz -= tz * d;
        const ul = Math.hypot(ux, uy, uz) || 1;
        ux /= ul; uy /= ul; uz /= ul;
        const vx = ty * uz - tz * uy;
        const vy = tz * ux - tx * uz;
        const vz = tx * uy - ty * ux;
        const [px, py, pz, r] = stem[i];
        for (let k = 0; k < STEM_SIDES; k += 1) {
            const ang = (k / STEM_SIDES) * Math.PI * 2;
            const c = Math.cos(ang);
            const s = Math.sin(ang);
            const nx = ux * c + vx * s;
            const ny = uy * c + vy * s;
            const nz = uz * c + vz * s;
            g.position.push(px + nx * r, py + ny * r, pz + nz * r);
            g.normal.push(nx, ny, nz);
            g.mat.push(BARK);
            g.ao.push(0.7);
            g.moss.push(0);
        }
    }
    for (let i = 0; i + 1 < stem.length; i += 1) {
        for (let k = 0; k < STEM_SIDES; k += 1) {
            const k1 = (k + 1) % STEM_SIDES;
            const a = base + i * STEM_SIDES + k;
            const b = base + i * STEM_SIDES + k1;
            const c = base + (i + 1) * STEM_SIDES + k1;
            const d = base + (i + 1) * STEM_SIDES + k;
            g.index.push(a, b, c, a, c, d);
        }
    }
}

/**
 * The overlook's balustrade corner at a level of detail: the paving on its ledge (a bed of rock
 * behind a retaining wall of coursed ashlar), the plinth course and the moulded handrail, the newel
 * pier under its ball and its mirror at the far end, the turned balusters between them, the ivy
 * over the newel and along the rail, weeds in the paving's joints. Metres; the top of the paving
 * at y = 0, the newel at x = BALUSTRADE.pierX, the rail running off toward −x.
 */
export function balustradeGeometry(level = BALUSTRADE_LEVELS - 1) {
    const B = MODELS.balustrade;
    const { quant } = B;
    const L = B.layout;
    const lod = Math.min(BALUSTRADE_LEVELS - 1, Math.max(0, level));
    const g = new Gather();
    g.add(unpack(B.ledge, quant));
    g.add(unpack(B.paving, quant));
    g.add(unpack(B.rail, quant));
    const pier = unpack(B.pier, quant);
    g.add(pier);
    g.add(pier, { mirror: true, x: L.pierX + L.farPierX });
    const baluster = unpack(B.baluster[Math.min(B.baluster.length - 1, lod)], quant);
    for (let i = 0; i < L.balusters; i += 1) g.add(baluster, { x: L.balusterX0 - i * L.pitch });
    addIvy(g, lod);
    return g.geometry(true);
}

export const _internals = { unpack, Gather };
