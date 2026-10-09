/**
 * What the fox rigging scripts share (scripts/winter/rig-fox.mjs, scripts/sakura/rig-fox.mjs):
 * the neighbours of a mesh's vertices, relaxing values over them, smooth normals, an occlusion
 * bake, and a binary glTF writer for one skinned mesh on axis-aligned bones.
 * Everything here is deterministic: the same input gives the same bytes.
 */

/** Each vertex's neighbours, as offsets into one list. */
export function adjacency(indices, count) {
    const sets = Array.from({ length: count }, () => new Set());
    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t];
        const b = indices[t + 1];
        const c = indices[t + 2];
        sets[a].add(b).add(c);
        sets[b].add(a).add(c);
        sets[c].add(a).add(b);
    }
    const start = new Uint32Array(count + 1);
    for (let i = 0; i < count; i++) start[i + 1] = start[i] + sets[i].size;
    const list = new Uint32Array(start[count]);
    for (let i = 0; i < count; i++) {
        // (Sorted: a Set keeps the order the triangles came in, which is the file's.)
        list.set([...sets[i]].sort((p, q) => p - q), start[i]);
    }
    return { start, list };
}

/** Move every value a step toward the mean of its neighbours' (step < 0 moves it away). */
export function relax(values, size, adj, step, hold = null) {
    const count = values.length / size;
    const out = new Float64Array(values.length);
    for (let i = 0; i < count; i++) {
        const from = adj.start[i];
        const to = adj.start[i + 1];
        const k = hold ? step * hold[i] : step;
        for (let c = 0; c < size; c++) {
            let mean = 0;
            for (let j = from; j < to; j++) mean += values[adj.list[j] * size + c];
            mean = to > from ? mean / (to - from) : values[i * size + c];
            out[i * size + c] = values[i * size + c] + (mean - values[i * size + c]) * k;
        }
    }
    values.set(out);
}

/** Smooth vertex normals: area-weighted, then relaxed over the surface. */
export function normalsOf(pos, indices, adj, passes) {
    const count = pos.length / 3;
    const nor = new Float64Array(count * 3);
    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t] * 3;
        const b = indices[t + 1] * 3;
        const c = indices[t + 2] * 3;
        const ux = pos[b] - pos[a];
        const uy = pos[b + 1] - pos[a + 1];
        const uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a];
        const vy = pos[c + 1] - pos[a + 1];
        const vz = pos[c + 2] - pos[a + 2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        [a, b, c].forEach((v) => {
            nor[v] += nx;
            nor[v + 1] += ny;
            nor[v + 2] += nz;
        });
    }
    const normalise = () => {
        for (let i = 0; i < count; i++) {
            const l = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]) || 1;
            nor[i * 3] /= l;
            nor[i * 3 + 1] /= l;
            nor[i * 3 + 2] /= l;
        }
    };
    normalise();
    for (let p = 0; p < passes; p++) {
        relax(nor, 3, adj, 0.6);
        normalise();
    }
    return nor;
}

/**
 * How much of the sky each vertex sees: rays over its hemisphere against the mesh and the
 * ground it stands on (y = 0, which closes the sky below it but lights it too: half shut).
 * @param {object} [o]
 * @param {number} [o.cell=0.03]   size of the grid the triangles are sorted into (metres)
 * @param {number} [o.reach=0.28]  how far a ray looks (metres)
 */
export function occlusion(pos, nor, indices, adj, { cell = 0.03, reach = 0.28 } = {}) {
    const count = pos.length / 3;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], pos[i * 3 + k]);
            hi[k] = Math.max(hi[k], pos[i * 3 + k]);
        }
    }
    const dims = [0, 1, 2].map((k) => Math.max(1, Math.ceil((hi[k] - lo[k]) / cell) + 1));
    const cells = Array.from({ length: dims[0] * dims[1] * dims[2] }, () => []);
    const cellOf = (k, v) => Math.max(0, Math.min(dims[k] - 1, Math.floor((v - lo[k]) / cell)));
    for (let t = 0; t < indices.length; t += 3) {
        const tri = [indices[t], indices[t + 1], indices[t + 2]];
        const a = [0, 1, 2].map((k) => cellOf(k, Math.min(...tri.map((v) => pos[v * 3 + k]))));
        const b = [0, 1, 2].map((k) => cellOf(k, Math.max(...tri.map((v) => pos[v * 3 + k]))));
        for (let cz = a[2]; cz <= b[2]; cz++) {
            for (let cy = a[1]; cy <= b[1]; cy++) {
                for (let cx = a[0]; cx <= b[0]; cx++) cells[(cz * dims[1] + cy) * dims[0] + cx].push(t);
            }
        }
    }
    const stamp = new Int32Array(indices.length / 3).fill(-1);
    let ray = 0;
    /** Does a ray from `o` along `d` meet the mesh within reach? */
    const blocked = (o, d) => {
        ray += 1;
        const steps = Math.ceil(reach / (cell * 0.5));
        let last = -1;
        for (let s = 0; s <= steps; s++) {
            const at = (s * reach) / steps;
            const px = o[0] + d[0] * at;
            const py = o[1] + d[1] * at;
            const pz = o[2] + d[2] * at;
            if (px < lo[0] - cell || py < lo[1] - cell || pz < lo[2] - cell) return false;
            if (px > hi[0] + cell || py > hi[1] + cell || pz > hi[2] + cell) return false;
            const here = (cellOf(2, pz) * dims[1] + cellOf(1, py)) * dims[0] + cellOf(0, px);
            if (here === last) continue;
            last = here;
            const list = cells[here];
            for (let j = 0; j < list.length; j++) {
                const t = list[j];
                if (stamp[t / 3] === ray) continue;
                stamp[t / 3] = ray;
                // Möller–Trumbore.
                const a = indices[t] * 3;
                const b = indices[t + 1] * 3;
                const c = indices[t + 2] * 3;
                const e1x = pos[b] - pos[a];
                const e1y = pos[b + 1] - pos[a + 1];
                const e1z = pos[b + 2] - pos[a + 2];
                const e2x = pos[c] - pos[a];
                const e2y = pos[c + 1] - pos[a + 1];
                const e2z = pos[c + 2] - pos[a + 2];
                const hx = d[1] * e2z - d[2] * e2y;
                const hy = d[2] * e2x - d[0] * e2z;
                const hz = d[0] * e2y - d[1] * e2x;
                const det = e1x * hx + e1y * hy + e1z * hz;
                if (Math.abs(det) < 1e-12) continue;
                const sx = o[0] - pos[a];
                const sy = o[1] - pos[a + 1];
                const sz = o[2] - pos[a + 2];
                const u = (sx * hx + sy * hy + sz * hz) / det;
                if (u < 0 || u > 1) continue;
                const qx = sy * e1z - sz * e1y;
                const qy = sz * e1x - sx * e1z;
                const qz = sx * e1y - sy * e1x;
                const v = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
                if (v < 0 || u + v > 1) continue;
                const hit = (e2x * qx + e2y * qy + e2z * qz) / det;
                if (hit > 1e-4 && hit < reach) return true;
            }
        }
        return false;
    };
    // A fixed spread of directions over the hemisphere (cosine-weighted, a golden spiral).
    const RAYS = 40;
    const spread = [];
    for (let k = 0; k < RAYS; k++) {
        const r = Math.sqrt((k + 0.5) / RAYS);
        const a = k * 2.399963229728653;
        spread.push([r * Math.cos(a), r * Math.sin(a), Math.sqrt(Math.max(0, 1 - r * r))]);
    }
    const sees = new Float64Array(count);
    for (let i = 0; i < count; i++) {
        const n = [nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]];
        // A frame on the normal.
        const h = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        let t = [h[1] * n[2] - h[2] * n[1], h[2] * n[0] - h[0] * n[2], h[0] * n[1] - h[1] * n[0]];
        const tl = Math.hypot(...t) || 1;
        t = t.map((v) => v / tl);
        const b = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
        const lift = 0.004;
        const o = [pos[i * 3] + n[0] * lift, pos[i * 3 + 1] + n[1] * lift, pos[i * 3 + 2] + n[2] * lift];
        let open = 0;
        for (let k = 0; k < RAYS; k++) {
            const s = spread[k];
            const d = [
                t[0] * s[0] + b[0] * s[1] + n[0] * s[2],
                t[1] * s[0] + b[1] * s[1] + n[1] * s[2],
                t[2] * s[0] + b[2] * s[1] + n[2] * s[2],
            ];
            if (blocked(o, d)) continue;
            open += d[1] < 0 && o[1] + d[1] * reach < 0 ? 0.5 : 1;
        }
        sees[i] = open / RAYS;
    }
    for (let p = 0; p < 3; p++) relax(sees, 1, adj, 0.6);
    return sees;
}

/**
 * One skinned mesh on axis-aligned bones as a binary glTF.
 * @param {object} o
 * @param {string} o.name       the mesh's (and the scene's) name
 * @param {Array} o.bones       [[name, parent, x, y, z], ...], parents first
 * @param {object} o.extras     written into asset.extras (a script's stamp)
 * @param {string} o.generator
 * @param {Float32Array} o.positions
 * @param {Float32Array} o.normals
 * @param {Uint8Array} o.colours     four normalised bytes a vertex
 * @param {Float32Array} [o.uvs]
 * @param {Uint8Array} o.joints      four a vertex
 * @param {Uint8Array} o.weights     four normalised bytes a vertex
 * @param {Uint16Array} o.indices
 * @param {{ bytes: Buffer, mimeType: string, sampler?: object, material?: object }} [o.image]
 *        a base-colour texture to carry (the bytes of the image file as they are)
 */
export function writeGlb({
    name, bones, extras, generator, positions, normals, colours, uvs = null, joints, weights, indices, image = null,
}) {
    const count = positions.length / 3;
    const joint = Object.fromEntries(bones.map((bone) => [bone[0], [bone[2], bone[3], bone[4]]]));
    const chunks = [];
    const views = [];
    const accessors = [];
    let offset = 0;
    const view = (buffer, target) => {
        const padded = Buffer.alloc(Math.ceil(buffer.byteLength / 4) * 4);
        Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).copy(padded);
        views.push({
            buffer: 0, byteOffset: offset, byteLength: buffer.byteLength, ...(target ? { target } : {}),
        });
        chunks.push(padded);
        offset += padded.length;
        return views.length - 1;
    };
    const add = (buffer, target, accessor) => {
        accessors.push({ bufferView: view(buffer, target), ...accessor });
        return accessors.length - 1;
    };
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], positions[i * 3 + k]);
            hi[k] = Math.max(hi[k], positions[i * 3 + k]);
        }
    }
    const attributes = {};
    attributes.POSITION = add(positions, 34962, {
        componentType: 5126, count, type: 'VEC3', min: lo, max: hi,
    });
    attributes.NORMAL = add(normals, 34962, { componentType: 5126, count, type: 'VEC3' });
    if (uvs) attributes.TEXCOORD_0 = add(uvs, 34962, { componentType: 5126, count, type: 'VEC2' });
    attributes.COLOR_0 = add(colours, 34962, {
        componentType: 5121, normalized: true, count, type: 'VEC4',
    });
    attributes.JOINTS_0 = add(joints, 34962, { componentType: 5121, count, type: 'VEC4' });
    attributes.WEIGHTS_0 = add(weights, 34962, {
        componentType: 5121, normalized: true, count, type: 'VEC4',
    });
    const aIndices = add(indices, 34963, { componentType: 5123, count: indices.length, type: 'SCALAR' });
    // Every bone is axis-aligned at rest: its inverse bind is a move back to the origin.
    const binds = new Float32Array(bones.length * 16);
    bones.forEach((bone, i) => {
        binds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -bone[2], -bone[3], -bone[4], 1], i * 16);
    });
    const aBinds = add(binds, 0, { componentType: 5126, count: bones.length, type: 'MAT4' });

    const nodes = bones.map((bone) => {
        const parent = bone[1] ? joint[bone[1]] : [0, 0, 0];
        const node = {
            name: bone[0],
            translation: [bone[2] - parent[0], bone[3] - parent[1], bone[4] - parent[2]].map((v) => Math.fround(v)),
        };
        const children = bones.map((b, i) => (b[1] === bone[0] ? i : -1)).filter((i) => i >= 0);
        if (children.length) node.children = children;
        return node;
    });
    const root = bones.findIndex((bone) => bone[1] === null);
    nodes.push({ name, mesh: 0, skin: 0 });
    const primitive = { attributes, indices: aIndices, mode: 4 };
    const json = {
        asset: { version: '2.0', generator, extras },
        scene: 0,
        scenes: [{ name, nodes: [root, nodes.length - 1] }],
        nodes,
        meshes: [{ name, primitives: [primitive] }],
        skins: [{
            name, joints: bones.map((_, i) => i), inverseBindMatrices: aBinds, skeleton: root,
        }],
    };
    if (image) {
        primitive.material = 0;
        json.materials = [{
            name,
            pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 },
            ...(image.material || {}),
        }];
        json.textures = [{ sampler: 0, source: 0 }];
        json.samplers = [image.sampler || { magFilter: 9729, minFilter: 9987 }];
        json.images = [{ mimeType: image.mimeType, bufferView: view(image.bytes, 0) }];
    }
    json.accessors = accessors;
    json.bufferViews = views;
    json.buffers = [{ byteLength: offset }];
    let text = JSON.stringify(json);
    while (Buffer.byteLength(text) % 4) text += ' ';
    const jsonChunk = Buffer.from(text, 'utf8');
    const bin = Buffer.concat(chunks);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
    const jsonHead = Buffer.alloc(8);
    jsonHead.writeUInt32LE(jsonChunk.length, 0);
    jsonHead.writeUInt32LE(0x4e4f534a, 4);
    const binHead = Buffer.alloc(8);
    binHead.writeUInt32LE(bin.length, 0);
    binHead.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, jsonHead, jsonChunk, binHead, bin]);
}
