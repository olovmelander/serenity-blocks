#!/usr/bin/env node
/**
 * Forest — make the eagle owl's asset.
 *
 * The owl is the project's own: no scan, no download, no stock clip. Two steps make it:
 *
 *   blender  headless Blender (scripts/blender/forest_owl.py) models it (a distance-field body and a
 *            vane for every feather), rigs it (a bone for every flight feather) and writes a GLB
 *   pack     this script rewrites that file compactly: normals as normalised bytes, colours, plumage
 *            codes and skin weights as bytes, joints as bytes, indices as shorts
 *            (KHR_mesh_quantization); and it stamps the bone list, the counts and the plan the
 *            theme's rig mirrors into the asset's extras
 *
 *   node scripts/forest/pack-owl.mjs                     Blender, pack, write the asset
 *   node scripts/forest/pack-owl.mjs --from=<raw.glb>    pack a file Blender already wrote (its .json beside it)
 *   node scripts/forest/pack-owl.mjs --raw=<file>        keep Blender's file there
 *   node scripts/forest/pack-owl.mjs --blender=<exe>     (default: Blender 5.2 where it installs)
 *   node scripts/forest/pack-owl.mjs --out=<file>        write elsewhere (default: the asset)
 *   node scripts/forest/pack-owl.mjs --dry               everything but write
 *
 * Deterministic: the same Blender and the same scripts give the same bytes.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb } from '../fox/glb-read.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ASSET = join(ROOT, 'src', 'themes', 'forest', 'assets', 'owl.glb');
const MANIFEST = join(ROOT, 'src', 'themes', 'forest', 'assets', 'asset-manifest.json');
const MODEL_SCRIPT = join(ROOT, 'scripts', 'blender', 'forest_owl.py');
const BLENDER = 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';
const GENERATOR = 'Serenity Blocks - Forest eagle owl (scripts/blender/forest_owl.py + scripts/forest/pack-owl.mjs)';

function args() {
    const out = {};
    for (const arg of process.argv.slice(2)) {
        const [key, value] = arg.replace(/^--/, '').split('=');
        out[key] = value === undefined ? true : value;
    }
    return out;
}

function runBlender(exe, rawFile, manifestFile) {
    const result = spawnSync(exe, ['--background', '--factory-startup', '--python', MODEL_SCRIPT, '--',
        '--out', rawFile, '--manifest', manifestFile], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const tagged = `${result.stdout || ''}${result.stderr || ''}`.split(/\r?\n/)
        .filter((line) => line.includes('[forest-owl]'));
    tagged.forEach((line) => console.log(line));
    if (result.status !== 0 || !existsSync(rawFile)) {
        console.error(result.stdout?.slice(-4000), result.stderr?.slice(-4000));
        throw new Error(`Blender failed (${result.status})`);
    }
}

/** The GLB writer: views and accessors appended into one binary chunk. */
function createWriter() {
    const chunks = [];
    const bufferViews = [];
    const accessors = [];
    let offset = 0;
    const accessor = (typed, target, spec, stride) => {
        const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
        const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
        bytes.copy(padded);
        bufferViews.push({
            buffer: 0,
            byteOffset: offset,
            byteLength: bytes.length,
            ...(target ? { target } : {}),
            ...(stride ? { byteStride: stride } : {}),
        });
        chunks.push(padded);
        offset += padded.length;
        accessors.push({ bufferView: bufferViews.length - 1, ...spec });
        return accessors.length - 1;
    };
    const finish = (json) => {
        const out = {
            ...json, accessors, bufferViews, buffers: [{ byteLength: offset }],
        };
        let text = JSON.stringify(out);
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
    };
    return { accessor, finish };
}

const SIZES = {
    SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16,
};

function minMax(values, size) {
    const lo = new Array(size).fill(Infinity);
    const hi = new Array(size).fill(-Infinity);
    for (let i = 0; i < values.length; i++) {
        lo[i % size] = Math.min(lo[i % size], values[i]);
        hi[i % size] = Math.max(hi[i % size], values[i]);
    }
    return { min: lo.map(Math.fround), max: hi.map(Math.fround) };
}

const unorm8 = (values) => Uint8Array.from(values, (v) => Math.max(0, Math.min(255, Math.round(v * 255))));
const snorm8 = (values) => Int8Array.from(values, (v) => Math.max(-127, Math.min(127, Math.round(v * 127))));

/** Weights as bytes that still sum to 255 (the largest takes the rounding). */
function weightBytes(weights) {
    const out = new Uint8Array(weights.length);
    for (let i = 0; i < weights.length; i += 4) {
        const w = [0, 1, 2, 3].map((k) => weights[i + k]);
        const sum = w.reduce((a, b) => a + b, 0) || 1;
        const bytes = w.map((v) => Math.round((v / sum) * 255));
        let largest = 0;
        for (let k = 1; k < 4; k++) if (w[k] > w[largest]) largest = k;
        bytes[largest] += 255 - bytes.reduce((a, b) => a + b, 0);
        out.set(bytes, i);
    }
    return out;
}

export function pack(rawFile, manifest) {
    const { json, read } = readGlb(rawFile);
    const writer = createWriter();
    const out = {
        asset: {
            version: '2.0',
            generator: GENERATOR,
            extras: {
                bones: manifest.bones,
                triangles: manifest.triangles,
                feathers: manifest.feathers,
                plan: manifest.plan,
            },
        },
        extensionsUsed: ['KHR_mesh_quantization'],
        extensionsRequired: ['KHR_mesh_quantization'],
        scene: 0,
        scenes: json.scenes.map((scene) => ({ name: scene.name, nodes: scene.nodes })),
        nodes: json.nodes.map((node) => {
            const copy = { ...node };
            delete copy.extras;
            return copy;
        }),
    };
    out.meshes = json.meshes.map((mesh) => ({
        name: mesh.name,
        primitives: mesh.primitives.map((primitive) => {
            const attributes = {};
            for (const [name, index] of Object.entries(primitive.attributes)) {
                const source = json.accessors[index];
                const values = read(index);
                const { count } = source;
                if (name === 'POSITION') {
                    attributes.POSITION = writer.accessor(Float32Array.from(values), 34962, {
                        componentType: 5126, count, type: 'VEC3', ...minMax(values, 3),
                    });
                } else if (name === 'NORMAL') {
                    const padded = new Float64Array(count * 4);
                    for (let i = 0; i < count; i++) {
                        padded.set([values[i * 3], values[i * 3 + 1], values[i * 3 + 2], 0], i * 4);
                    }
                    attributes.NORMAL = writer.accessor(snorm8(padded), 34962, {
                        componentType: 5120, normalized: true, count, type: 'VEC3',
                    }, 4);
                } else if (name === 'COLOR_0' || name.startsWith('_')) {
                    const size = SIZES[source.type];
                    attributes[name] = writer.accessor(unorm8(values), 34962, {
                        componentType: 5121, normalized: true, count, type: size === 3 ? 'VEC3' : 'VEC4',
                    }, size === 3 ? 4 : undefined);
                } else if (name === 'JOINTS_0') {
                    attributes.JOINTS_0 = writer.accessor(Uint8Array.from(values), 34962, {
                        componentType: 5121, count, type: 'VEC4',
                    });
                } else if (name === 'WEIGHTS_0') {
                    attributes.WEIGHTS_0 = writer.accessor(weightBytes(values), 34962, {
                        componentType: 5121, normalized: true, count, type: 'VEC4',
                    });
                } else {
                    throw new Error(`unexpected attribute ${name}`);
                }
            }
            const indices = read(primitive.indices);
            const index = writer.accessor(Uint16Array.from(indices), 34963, {
                componentType: 5123, count: indices.length, type: 'SCALAR',
            });
            return { attributes, indices: index, mode: 4 };
        }),
    }));
    out.skins = json.skins.map((skin) => ({
        name: skin.name,
        joints: skin.joints,
        ...(skin.skeleton !== undefined ? { skeleton: skin.skeleton } : {}),
        inverseBindMatrices: writer.accessor(Float32Array.from(read(skin.inverseBindMatrices)), 0, {
            componentType: 5126, count: json.accessors[skin.inverseBindMatrices].count, type: 'MAT4',
        }),
    }));
    return writer.finish(out);
}

/** The asset's line in the Forest pack's manifest (its size and hash are checked by the tests). */
function recordInManifest(bytes, sha, manifest) {
    // Edited as text: the rest of the manifest is the Blender pack's, written as Python writes it.
    let text = readFileSync(MANIFEST, 'utf8');
    const entry = {
        file: 'owl.glb',
        bytes: bytes.length,
        sha256: sha,
        kind: 'owl',
        triangles: manifest.triangles,
        bones: manifest.bones.length,
        feathers: manifest.feathers,
    };
    // Drop a line written before, then add this one at the end of the list.
    text = text.replace(/,\n {4}\{\n {6}"file": "owl\.glb"[\s\S]*?\n {4}\}(?=\n {2}\])/, '');
    const block = JSON.stringify(entry, null, 2).split('\n').map((line) => `    ${line}`).join('\n');
    const end = text.lastIndexOf('\n  ]');
    if (end < 0) throw new Error('asset-manifest.json: no assets list to add the owl to');
    text = `${text.slice(0, end)},\n${block}${text.slice(end)}`;
    JSON.parse(text);
    writeFileSync(MANIFEST, text);
    console.log(`[pack-owl] recorded in ${MANIFEST}`);
}

function main() {
    const opts = args();
    const work = mkdtempSync(join(tmpdir(), 'forest-owl-'));
    try {
        const rawFile = opts.from ? resolve(String(opts.from))
            : resolve(String(opts.raw || join(work, 'owl-raw.glb')));
        const manifestFile = rawFile.replace(/\.glb$/i, '.json');
        if (!opts.from) runBlender(String(opts.blender || BLENDER), rawFile, manifestFile);
        const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
        const bytes = pack(rawFile, manifest);
        const sha = createHash('sha256').update(bytes).digest('hex');
        console.log(`[pack-owl] ${manifest.triangles} triangles, ${manifest.bones.length} bones; `
            + `raw ${readFileSync(rawFile).length} B -> ${bytes.length} B; sha256 ${sha}`);
        if (!opts.dry) {
            const target = resolve(String(opts.out || ASSET));
            writeFileSync(target, bytes);
            console.log(`[pack-owl] wrote ${target}`);
            if (target === ASSET) recordInManifest(bytes, sha, manifest);
        }
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

main();
