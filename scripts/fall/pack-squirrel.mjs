#!/usr/bin/env node
/**
 * Fall — make the red squirrel's asset.
 *
 * The squirrel is the project's own: no scan, no download, no stock clip. Two steps make it:
 *
 *   blender  headless Blender (scripts/blender/fall_squirrel.py) models it as a distance field round
 *            its rig's joints, skins it to that rig, keys every clip (fall_squirrel/motion.py) into
 *            an action and writes them all as one GLB with the acorn it nibbles on its left hand
 *   pack     this script rewrites that file compactly: rotations as normalised 16-bit, a channel
 *            that never moves in a clip as one key, the translation and scale channels a bone never
 *            uses dropped, colours, fur and weights as bytes, normals as normalised bytes
 *            (KHR_mesh_quantization); and it stamps each clip's length, loop and speed into the
 *            asset's extras for the theme to check against fall-squirrel-clips.js
 *
 *   node scripts/fall/pack-squirrel.mjs                       Blender, pack, write the asset
 *   node scripts/fall/pack-squirrel.mjs --from=<raw.glb>      pack a file Blender already wrote
 *   node scripts/fall/pack-squirrel.mjs --raw=<file>          keep Blender's file there
 *   node scripts/fall/pack-squirrel.mjs --blender=<exe>       (default: Blender 5.2 where it installs)
 *   node scripts/fall/pack-squirrel.mjs --out=<file>          write elsewhere (default: the asset)
 *   node scripts/fall/pack-squirrel.mjs --dry                 everything but write
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
const ASSET = join(ROOT, 'src', 'themes', 'fall', 'assets', 'squirrel.glb');
const MANIFEST = join(ROOT, 'src', 'themes', 'fall', 'assets', 'asset-manifest.json');
const MODEL_SCRIPT = join(ROOT, 'scripts', 'blender', 'fall_squirrel.py');
const BLENDER = 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';
const GENERATOR = 'Serenity Blocks - Fall red squirrel '
    + '(scripts/blender/fall_squirrel.py + scripts/fall/pack-squirrel.mjs)';
/** A channel whose every key is within this of its first is one key. */
const STILL = 2e-5;

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
        .filter((line) => line.includes('[fall-squirrel]'));
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
    const view = (typed, target) => {
        const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
        const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
        bytes.copy(padded);
        bufferViews.push({
            buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}),
        });
        chunks.push(padded);
        offset += padded.length;
        return bufferViews.length - 1;
    };
    const accessor = (typed, target, spec, stride) => {
        const index = view(typed, target);
        if (stride) bufferViews[index].byteStride = stride;
        accessors.push({ bufferView: index, ...spec });
        return accessors.length - 1;
    };
    /** Several accessors in one buffer view: `parts` = [{ typed, spec }], each 4-byte aligned. */
    const accessors4 = (parts) => {
        const sizes = parts.map((part) => Math.ceil(part.typed.byteLength / 4) * 4);
        const joined = new Uint8Array(sizes.reduce((a, b) => a + b, 0));
        let at = 0;
        const offsets = parts.map((part, i) => {
            joined.set(new Uint8Array(part.typed.buffer, part.typed.byteOffset, part.typed.byteLength), at);
            const start = at;
            at += sizes[i];
            return start;
        });
        const index = view(joined, 0);
        return parts.map((part, i) => {
            accessors.push({ bufferView: index, byteOffset: offsets[i], ...part.spec });
            return accessors.length - 1;
        });
    };
    const finish = (json) => {
        json.accessors = accessors;
        json.bufferViews = bufferViews;
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
    };
    return { accessor, accessors4, finish };
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

/** Normalised unsigned bytes (rounded, clamped). */
const unorm8 = (values) => Uint8Array.from(values, (v) => Math.max(0, Math.min(255, Math.round(v * 255))));
/** Normalised signed bytes / shorts. */
const snorm8 = (values) => Int8Array.from(values, (v) => Math.max(-127, Math.min(127, Math.round(v * 127))));
const snorm16 = (values) => Int16Array.from(values, (v) => Math.max(-32767, Math.min(32767, Math.round(v * 32767))));

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
                clips: Object.fromEntries(Object.entries(manifest.clips).map(([name, clip]) => [name, {
                    length: clip.length, loop: clip.loop, speed: clip.speed, frames: clip.frames,
                }])),
                bones: manifest.bones,
                triangles: manifest.triangles,
                acornTriangles: manifest.acornTriangles,
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
    // -- meshes ------------------------------------------------------------------------
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
                    // Normalised signed bytes padded to four a vertex (attribute alignment).
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
    // -- skins -------------------------------------------------------------------------
    out.skins = json.skins.map((skin) => ({
        name: skin.name,
        joints: skin.joints,
        ...(skin.skeleton !== undefined ? { skeleton: skin.skeleton } : {}),
        inverseBindMatrices: writer.accessor(Float32Array.from(read(skin.inverseBindMatrices)), 0, {
            componentType: 5126, count: json.accessors[skin.inverseBindMatrices].count, type: 'MAT4',
        }),
    }));
    // -- animations --------------------------------------------------------------------
    // Which bones ever move other than by rotation (only the root, by its offset).
    const restTranslation = (node) => json.nodes[node].translation || [0, 0, 0];
    const keep = (channel, sampler) => {
        const { path } = channel.target;
        const values = read(sampler.output);
        if (path === 'scale') return values.some((v) => Math.abs(v - 1) > 1e-5);
        if (path === 'translation') {
            const rest = restTranslation(channel.target.node);
            return values.some((v, i) => Math.abs(v - rest[i % 3]) > 1e-6);
        }
        return true;
    };
    const moving = new Set();
    for (const animation of json.animations) {
        for (const channel of animation.channels) {
            const sampler = animation.samplers[channel.sampler];
            if (channel.target.path !== 'rotation' && keep(channel, sampler)) {
                moving.add(`${channel.target.node}/${channel.target.path}`);
            }
        }
    }
    let keys = 0;
    let stills = 0;
    out.animations = json.animations
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((animation) => {
            const samplers = [];
            const channels = [];
            const parts = [];
            const ordered = animation.channels.slice().sort((a, b) => (a.target.node - b.target.node)
                || a.target.path.localeCompare(b.target.path));
            let input = null;
            for (const channel of ordered) {
                const { node, path } = channel.target;
                if (path !== 'rotation' && !moving.has(`${node}/${path}`)) continue;
                const sampler = animation.samplers[channel.sampler];
                input = input || read(sampler.input);
                const output = read(sampler.output);
                const size = path === 'rotation' ? 4 : 3;
                const still = output.every((v, i) => Math.abs(v - output[i % size]) <= STILL);
                const values = still ? output.slice(0, size) : output;
                parts.push({
                    node,
                    path,
                    still,
                    typed: path === 'rotation' ? snorm16(values) : Float32Array.from(values),
                    spec: path === 'rotation'
                        ? {
                            componentType: 5122, normalized: true, count: values.length / 4, type: 'VEC4',
                        }
                        : { componentType: 5126, count: values.length / 3, type: 'VEC3' },
                });
                keys += values.length / size;
                if (still) stills += 1;
            }
            const [many, one] = writer.accessors4([
                {
                    typed: Float32Array.from(input),
                    spec: {
                        componentType: 5126, count: input.length, type: 'SCALAR', ...minMax(input, 1),
                    },
                },
                {
                    typed: Float32Array.from([0]),
                    spec: {
                        componentType: 5126, count: 1, type: 'SCALAR', min: [0], max: [0],
                    },
                },
            ]);
            const outputs = writer.accessors4(parts);
            parts.forEach((part, i) => {
                samplers.push({ input: part.still ? one : many, output: outputs[i], interpolation: 'LINEAR' });
                channels.push({ sampler: samplers.length - 1, target: { node: part.node, path: part.path } });
            });
            return { name: animation.name, channels, samplers };
        });
    const bytes = writer.finish(out);
    return { bytes, keys, stills };
}

/** The asset's line in the Fall pack's manifest (its size and hash are checked by the tests). */
function recordInManifest(bytes, sha, manifest) {
    const text = readFileSync(MANIFEST, 'utf8');
    const listing = JSON.parse(text);
    const entry = {
        file: 'squirrel.glb',
        bytes: bytes.length,
        sha256: sha,
        kind: 'squirrel',
        triangles: manifest.triangles,
        acornTriangles: manifest.acornTriangles,
        bones: manifest.bones.length,
        clips: Object.keys(manifest.clips).sort(),
    };
    const at = listing.assets.findIndex((asset) => asset.file === entry.file);
    if (at >= 0) listing.assets[at] = entry;
    else listing.assets.push(entry);
    writeFileSync(MANIFEST, `${JSON.stringify(listing, null, 2)}${text.endsWith('\n') ? '\n' : ''}`);
    console.log(`[pack-squirrel] recorded in ${MANIFEST}`);
}

function main() {
    const opts = args();
    const work = mkdtempSync(join(tmpdir(), 'fall-squirrel-'));
    try {
        const rawFile = opts.from ? resolve(String(opts.from))
            : resolve(String(opts.raw || join(work, 'squirrel-raw.glb')));
        const manifestFile = rawFile.replace(/\.glb$/i, '.json');
        if (!opts.from) runBlender(String(opts.blender || BLENDER), rawFile, manifestFile);
        const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
        const { bytes, keys, stills } = pack(rawFile, manifest);
        const sha = createHash('sha256').update(bytes).digest('hex');
        console.log(`[pack-squirrel] ${manifest.triangles} triangles, ${Object.keys(manifest.clips).length} clips, `
            + `${keys} keys (${stills} still channels); raw ${readFileSync(rawFile).length} B -> ${bytes.length} B; `
            + `sha256 ${sha}`);
        if (!opts.dry) {
            const target = resolve(String(opts.out || ASSET));
            writeFileSync(target, bytes);
            console.log(`[pack-squirrel] wrote ${target}`);
            if (target === ASSET) recordInManifest(bytes, sha, manifest);
        }
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

main();
