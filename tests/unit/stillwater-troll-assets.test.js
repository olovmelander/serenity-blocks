/**
 * The two figures' meshes (src/themes/stillwater/assets/troll-lod0..3.glb, spirit-lod0..1.glb), as
 * scripts/blender/stillwater_figures.py writes them: one quantised mesh each (positions int16,
 * normals int8, a packed colour and four joints and weights as bytes), no skin and no clip in the
 * glTF itself, the skeleton in the scene's extras as { name, parent, head, tail } with the soles and
 * the top of the figure. The files are read by hand here, byte by byte: what the loader and the
 * bodies take for granted about them is pinned, not the sculpt.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Each file and the band its triangle count is kept in (the sculpt is retuned within it). */
const TROLL_LODS = [
    { file: 'troll-lod0.glb', triangles: 52_000 },
    { file: 'troll-lod1.glb', triangles: 28_000 },
    { file: 'troll-lod2.glb', triangles: 15_000 },
    { file: 'troll-lod3.glb', triangles: 6_000 },
];
const SPIRIT_LODS = [
    { file: 'spirit-lod0.glb', triangles: 11_166 },
    { file: 'spirit-lod1.glb', triangles: 5_582 },
];
const LODS = [...TROLL_LODS, ...SPIRIT_LODS];
const BAND = 0.15;

const LIMBS = ['clavL', 'upperL', 'foreL', 'handL', 'clavR', 'upperR', 'foreR', 'handR'];
const TRUNK = ['hips', 'spine', 'chest', 'neck', 'head'];
const TROLL_BONES = [...TRUNK, ...LIMBS, 'thighL', 'shinL', 'footL', 'toeL', 'thighR', 'shinR', 'footR', 'toeR'];
const SPIRIT_BONES = [...TRUNK, ...LIMBS, 'skirtF', 'skirtB', 'skirtL', 'skirtR', 'hair1', 'hair2'];

const assetUrl = (file) => new URL(`../../src/themes/stillwater/assets/${file}`, import.meta.url);

/** The JSON chunk and the binary chunk of a GLB. */
function readGlb(file) {
    const buffer = readFileSync(assetUrl(file));
    expect(buffer.toString('utf8', 0, 4)).toBe('glTF');
    expect(buffer.readUInt32LE(4)).toBe(2);
    expect(buffer.readUInt32LE(8)).toBe(buffer.length);
    const jsonLength = buffer.readUInt32LE(12);
    expect(buffer.toString('utf8', 16, 20)).toBe('JSON');
    const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).trim());
    const binHeader = 20 + jsonLength;
    expect(buffer.toString('utf8', binHeader + 4, binHeader + 8)).toBe('BIN\0');
    const bin = buffer.subarray(binHeader + 8, binHeader + 8 + buffer.readUInt32LE(binHeader));
    return { json, bin };
}

const COMPONENT = {
    5120: { bytes: 1, read: 'readInt8' },
    5121: { bytes: 1, read: 'readUInt8' },
    5122: { bytes: 2, read: 'readInt16LE' },
    5123: { bytes: 2, read: 'readUInt16LE' },
    5125: { bytes: 4, read: 'readUInt32LE' },
};
const WIDTH = {
    SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4,
};

/** An accessor's raw values: get(i, k). */
function accessorOf({ json, bin }, index) {
    const accessor = json.accessors[index];
    const kind = COMPONENT[accessor.componentType];
    const view = json.bufferViews[accessor.bufferView];
    const width = WIDTH[accessor.type];
    const stride = view.byteStride || kind.bytes * width;
    const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    return {
        accessor,
        width,
        get: (i, k = 0) => bin[kind.read](start + i * stride + k * kind.bytes),
    };
}

const primitiveOf = (json) => json.meshes[0].primitives[0];

describe('Stillwater figure assets', () => {
    it.each(LODS)('$file stays inside its triangle band, one quantised mesh with nothing to decode', (entry) => {
        const { json } = readGlb(entry.file);
        expect(json.meshes).toHaveLength(1);
        expect(json.meshes[0].primitives).toHaveLength(1);
        const primitive = primitiveOf(json);
        expect(primitive.mode ?? 4).toBe(4);
        const triangles = json.accessors[primitive.indices].count / 3;
        expect(Number.isInteger(triangles)).toBe(true);
        expect(triangles).toBeGreaterThanOrEqual(entry.triangles * (1 - BAND));
        expect(triangles).toBeLessThanOrEqual(entry.triangles * (1 + BAND));
        expect(json.extensionsUsed).toContain('KHR_mesh_quantization');
        expect(json.extensionsRequired || []).toContain('KHR_mesh_quantization');
        for (const list of [json.extensionsUsed || [], json.extensionsRequired || []]) {
            expect(list).not.toContain('EXT_meshopt_compression');
            expect(list).not.toContain('KHR_draco_mesh_compression');
        }
        // What each attribute is stored as.
        const kind = (name) => {
            const a = json.accessors[primitive.attributes[name]];
            return [a.componentType, Boolean(a.normalized), a.type];
        };
        expect(kind('POSITION')).toEqual([5122, true, 'VEC3']);
        expect(kind('NORMAL')).toEqual([5120, true, 'VEC3']);
        expect(kind('COLOR_0')).toEqual([5121, true, 'VEC4']);
        expect(kind('JOINTS_0')).toEqual([5121, false, 'VEC4']);
        expect(kind('WEIGHTS_0')).toEqual([5121, true, 'VEC4']);
        // No skin and no clip in the glTF: the bodies pose the skeleton the extras describe.
        expect(json.skins ?? []).toEqual([]);
        expect(json.animations ?? []).toEqual([]);
        // The one node scales the quantised positions back to the model's unit frame, and does not turn them.
        const node = json.nodes.find((n) => n.mesh === 0);
        expect(node).toBeTruthy();
        expect(node.rotation ?? [0, 0, 0, 1]).toEqual([0, 0, 0, 1]);
        expect(node.matrix).toBeUndefined();
        expect((node.scale ?? [1, 1, 1]).every((s) => s > 0)).toBe(true);
    });

    it('cuts each figure finer the lower its number', () => {
        for (const lods of [TROLL_LODS, SPIRIT_LODS]) {
            const counts = lods.map(({ file }) => {
                const { json } = readGlb(file);
                return json.accessors[primitiveOf(json).indices].count / 3;
            });
            for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThan(counts[i - 1]);
        }
    });

    it.each(LODS)('$file weighs every vertex whole, on joints its skeleton has', (entry) => {
        const glb = readGlb(entry.file);
        const primitive = primitiveOf(glb.json);
        const { bones } = glb.json.scenes[0].extras;
        const joints = accessorOf(glb, primitive.attributes.JOINTS_0);
        const weights = accessorOf(glb, primitive.attributes.WEIGHTS_0);
        const { count } = joints.accessor;
        expect(weights.accessor.count).toBe(count);
        expect(glb.json.accessors[primitive.attributes.POSITION].count).toBe(count);
        const strays = [];
        const unweighed = [];
        for (let i = 0; i < count; i++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) {
                sum += weights.get(i, k);
                if (joints.get(i, k) >= bones.length && strays.length < 5) strays.push([i, joints.get(i, k)]);
            }
            if (sum !== 255 && unweighed.length < 5) unweighed.push([i, sum]);
        }
        expect(strays).toEqual([]);
        expect(unweighed).toEqual([]);
        // Every triangle names vertices the mesh has.
        const index = accessorOf(glb, primitive.indices);
        let highest = 0;
        for (let i = 0; i < index.accessor.count; i++) highest = Math.max(highest, index.get(i));
        expect(highest).toBeLessThan(count);
    });

    it.each(LODS)('$file carries its skeleton in the scene\'s extras: parents first, heads and tails', (entry) => {
        const { json } = readGlb(entry.file);
        const { extras } = json.scenes[0];
        const troll = entry.file.startsWith('troll');
        const { bones } = extras;
        const names = bones.map((b) => b.name);
        expect(new Set(names).size).toBe(names.length);
        expect([...names].sort()).toEqual([...(troll ? TROLL_BONES : SPIRIT_BONES)].sort());
        expect(names[0]).toBe('hips');
        bones.forEach((b, i) => {
            // A root, or a parent earlier in the list (so one pass in order poses parents first).
            expect(Number.isInteger(b.parent), b.name).toBe(true);
            if (i === 0) expect(b.parent, b.name).toBe(-1);
            else {
                expect(b.parent, b.name).toBeGreaterThanOrEqual(0);
                expect(b.parent, b.name).toBeLessThan(i);
            }
            for (const point of [b.head, b.tail]) {
                expect(point, b.name).toHaveLength(3);
                expect(point.every(Number.isFinite), b.name).toBe(true);
            }
            // Within the figure's unit frame.
            expect(Math.max(...b.head.map(Math.abs)), b.name).toBeLessThan(1.1);
        });
        // The limbs hang where a body has them: each side's bones on its own side (x is the figure's left).
        for (const name of names) {
            const b = bones[names.indexOf(name)];
            if (/L$/.test(name)) expect(b.head[0], name).toBeGreaterThan(0);
            if (/R$/.test(name)) expect(b.head[0], name).toBeLessThan(0);
        }
        expect(Number.isFinite(extras.sole)).toBe(true);
        expect(Number.isFinite(extras.top)).toBe(true);
        if (troll) {
            // A unit tall about its middle.
            expect(extras.sole).toBeCloseTo(-0.5, 1);
            expect(extras.top).toBeCloseTo(0.5, 1);
            // His feet are the lowest of him, his head the highest.
            const head = bones[names.indexOf('head')];
            const foot = bones[names.indexOf('footL')];
            expect(head.head[1]).toBeGreaterThan(foot.head[1]);
            expect(foot.head[1]).toBeGreaterThan(extras.sole);
        } else {
            // Her hem at 0, her crown at 1.
            expect(extras.sole).toBeCloseTo(0, 2);
            expect(extras.top).toBeCloseTo(1, 1);
            // Her hair and her gown hang down from where they are held.
            for (const name of ['hair1', 'hair2', 'skirtF', 'skirtB', 'skirtL', 'skirtR']) {
                const b = bones[names.indexOf(name)];
                expect(b.tail[1], name).toBeLessThan(b.head[1]);
            }
            expect(bones[names.indexOf('hair2')].parent).toBe(names.indexOf('hair1'));
        }
    });

    // The troll is five shells in the one mesh (scripts/blender/stillwater/troll_shape.py SHELLS):
    // his body, the hair of his head, the mantle over his back, and each arm with the moss on its
    // shoulder. As one surface, the fist that rests by his hip was grown into his loincloth and
    // bone heat gave the cloth beside it to his hand: lifted, his arm drew a web of cloth and skin
    // up after it (it looked caught in his cloth), and his mantle did the same from his thighs.
    it.each(TROLL_LODS)('$file binds each arm to its own three bones, and joins it to nothing else of him', (entry) => {
        const glb = readGlb(entry.file);
        const primitive = primitiveOf(glb.json);
        const names = glb.json.scenes[0].extras.bones.map((b) => b.name);
        const joints = accessorOf(glb, primitive.attributes.JOINTS_0);
        const weights = accessorOf(glb, primitive.attributes.WEIGHTS_0);
        const { count } = joints.accessor;
        const ARM = /^(upper|fore|hand)([LR])$/;
        /** '' for a vertex no arm moves, else the arm that does. */
        const owner = new Array(count);
        const shared = [];
        const arms = { L: 0, R: 0 };
        for (let i = 0; i < count; i++) {
            const sides = new Set();
            let other = 0;
            for (let k = 0; k < 4; k++) {
                if (weights.get(i, k) === 0) continue;
                const m = ARM.exec(names[joints.get(i, k)]);
                if (m) sides.add(m[2]);
                else other += 1;
            }
            owner[i] = sides.size ? [...sides][0] : '';
            if (sides.size) arms[owner[i]] += 1;
            if (sides.size > 1 || (sides.size && other)) shared.push(i);
        }
        // A vertex that carries any of an arm's weight carries that arm's alone...
        expect(shared).toEqual([]);
        // ...and both arms are there to be bound.
        expect(arms.L).toBeGreaterThan(count * 0.03);
        expect(arms.R).toBeGreaterThan(count * 0.03);
        // No triangle joins a vertex of an arm to one that is not of it.
        const index = accessorOf(glb, primitive.indices);
        let bridges = 0;
        for (let t = 0; t < index.accessor.count; t += 3) {
            const a = owner[index.get(t)];
            if (owner[index.get(t + 1)] !== a || owner[index.get(t + 2)] !== a) bridges += 1;
        }
        expect(bridges).toBe(0);
    });

    it.each(TROLL_LODS)('$file hangs his moss from no leg, and none of his skin or cloth from an arm', (entry) => {
        const glb = readGlb(entry.file);
        const primitive = primitiveOf(glb.json);
        const names = glb.json.scenes[0].extras.bones.map((b) => b.name);
        const joints = accessorOf(glb, primitive.attributes.JOINTS_0);
        const weights = accessorOf(glb, primitive.attributes.WEIGHTS_0);
        const colour = accessorOf(glb, primitive.attributes.COLOR_0);
        const { count } = joints.accessor;
        const LEG = /^(thigh|shin|foot|toe)[LR]$/;
        const ARM = /^(upper|fore|hand)[LR]$/;
        let mossOnLegs = 0;
        let moss = 0;
        let clothOnArms = 0;
        let cloth = 0;
        for (let i = 0; i < count; i++) {
            // (b: the moss share; r and a both nothing: leather, and at his hips that is his cloth.)
            const isMoss = colour.get(i, 2) > 200;
            const isLeather = colour.get(i, 0) < 20 && colour.get(i, 2) < 20 && colour.get(i, 3) < 20;
            let leg = 0;
            let arm = 0;
            let hips = 0;
            for (let k = 0; k < 4; k++) {
                const w = weights.get(i, k);
                const name = names[joints.get(i, k)];
                if (LEG.test(name)) leg += w;
                if (ARM.test(name)) arm += w;
                if (name === 'hips') hips += w;
            }
            if (isMoss) {
                moss += 1;
                // (The shoulder's moss rides on its arm; no moss on a leg.)
                if (leg > 0) mossOnLegs += 1;
            }
            if (isLeather && hips + leg > 128) {
                cloth += 1;
                if (arm > 0) clothOnArms += 1;
            }
        }
        expect(moss).toBeGreaterThan(count * 0.2);
        expect(cloth).toBeGreaterThan(count * 0.02);
        expect(mossOnLegs).toBe(0);
        expect(clothOnArms).toBe(0);
    });

    it.each(LODS)('$file gives every vertex a normal', (entry) => {
        // (A lock's tip cut down to a flap of two faces back to back has none of its own, and a
        // vertex without one shades as nothing.)
        const glb = readGlb(entry.file);
        const normal = accessorOf(glb, primitiveOf(glb.json).attributes.NORMAL);
        const none = [];
        for (let i = 0; i < normal.accessor.count; i++) {
            if (Math.hypot(normal.get(i, 0), normal.get(i, 1), normal.get(i, 2)) < 100 && none.length < 5) none.push(i);
        }
        expect(none).toEqual([]);
    });

    it.each(TROLL_LODS)('$file names the masses his arms keep out of, each on a bone of his', (entry) => {
        const { extras } = readGlb(entry.file).json.scenes[0];
        const names = extras.bones.map((b) => b.name);
        const { flesh } = extras;
        expect(Array.isArray(flesh?.masses)).toBe(true);
        expect(flesh.masses.length).toBeGreaterThanOrEqual(8);
        for (const mass of flesh.masses) {
            expect(names, mass.name).toContain(mass.bone);
            expect(['ell', 'wrap', 'cone'], mass.name).toContain(mass.kind);
            // Where it is at rest: by the bone that carries it, inside his unit frame.
            const at = mass.c || mass.a || [0, mass.top, mass.z0];
            expect(at.every(Number.isFinite), mass.name).toBe(true);
            expect(Math.max(...at.map(Math.abs)), mass.name).toBeLessThan(0.6);
        }
        expect(flesh.masses.map((m) => m.name)).toEqual(expect.arrayContaining(['belly', 'cloth', 'thighL', 'thighR']));
        for (const key of ['fore', 'hand', 'fist']) {
            expect(Array.isArray(flesh[key]) && flesh[key].length > 0, key).toBe(true);
        }
    });

    it('gives every mesh of a figure the same skeleton', () => {
        for (const lods of [TROLL_LODS, SPIRIT_LODS]) {
            const [first, ...rest] = lods.map(({ file }) => readGlb(file).json.scenes[0].extras.bones);
            for (const bones of rest) {
                expect(bones.map((b) => [b.name, b.parent])).toEqual(first.map((b) => [b.name, b.parent]));
                bones.forEach((b, i) => {
                    for (let k = 0; k < 3; k++) expect(b.head[k], b.name).toBeCloseTo(first[i].head[k], 3);
                });
            }
        }
    });

    it('keeps every shipping mesh small', () => {
        // (The finest troll, his mane in hundreds of locks and the way each of them runs, is about
        // a megabyte.)
        LODS.forEach(({ file }) => {
            expect(statSync(assetUrl(file)).size, file).toBeLessThan(1_100_000);
        });
    });
});
