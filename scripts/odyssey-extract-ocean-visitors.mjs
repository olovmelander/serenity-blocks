#!/usr/bin/env node
/**
 * Copy the Ocean theme's manta and whale shark into Odyssey's own asset (Act I overhaul, 2026-10-20).
 *
 * The Ocean theme's creature pack (src/themes/ocean/assets/creatures.glb, built in Blender from
 * numbers by scripts/blender/ocean_creatures_assets.py) holds nine animals. Odyssey's deep ocean
 * swims two of them, and a theme's files are not Odyssey's to import (themes are islands, and a
 * re-baked pack must not change Odyssey under it), so this writes a CONTAINED copy: only the named
 * nodes, their meshes and the byte ranges they read, in the pack's own layout (normalised int16
 * positions + node scale, the _SHAPE / _SKIN / _PIVOT attributes, the scene's `oceanCreatures`
 * extras), so composition/odyssey-ocean-visitors.js parses it the way the theme parses the pack.
 *
 *   node scripts/odyssey-extract-ocean-visitors.mjs [--kinds=manta,whaleShark]
 *       [--from=src/themes/ocean/assets/creatures.glb]
 *       [--out=src/rendering/odyssey/assets/chapter-02/visitors/ocean-visitors.glb]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const FROM = args.from || 'src/themes/ocean/assets/creatures.glb';
const OUT = args.out || 'src/rendering/odyssey/assets/chapter-02/visitors/ocean-visitors.glb';
const KINDS = (args.kinds || 'manta,whaleShark').split(',');

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const src = readFileSync(FROM);
if (src.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${FROM} is not a GLB`);
let at = 12;
let doc = null;
let bin = null;
while (at + 8 <= src.length) {
    const length = src.readUInt32LE(at);
    const type = src.readUInt32LE(at + 4);
    const body = src.subarray(at + 8, at + 8 + length);
    if (type === CHUNK_JSON) doc = JSON.parse(body.toString('utf8'));
    else if (type === CHUNK_BIN) bin = body;
    at += 8 + length;
}
if (!doc?.scenes?.[0]?.extras?.oceanCreatures || !bin) throw new Error('not the ocean creature pack');

const out = {
    asset: { generator: 'Serenity Blocks - Odyssey ocean visitors (copied from the Ocean creature pack)', version: '2.0' },
    scene: 0,
    scenes: [{ extras: { ...doc.scenes[0].extras, copiedFrom: FROM.replace(/\\/g, '/'), kept: KINDS }, nodes: [] }],
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
};
const chunks = [];
let binLength = 0;
const viewMap = new Map();
const copyView = (index) => {
    if (viewMap.has(index)) return viewMap.get(index);
    const view = doc.bufferViews[index];
    const bytes = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const pad = (4 - (binLength % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); binLength += pad; }
    const next = { ...view, buffer: 0, byteOffset: binLength };
    chunks.push(Buffer.from(bytes));
    binLength += bytes.length;
    out.bufferViews.push(next);
    viewMap.set(index, out.bufferViews.length - 1);
    return out.bufferViews.length - 1;
};
const copyAccessor = (index) => {
    const acc = doc.accessors[index];
    out.accessors.push({ ...acc, bufferView: copyView(acc.bufferView) });
    return out.accessors.length - 1;
};

KINDS.forEach((kind) => {
    const node = doc.nodes.find((n) => n.name === kind && n.mesh !== undefined);
    if (!node) throw new Error(`no ${kind} in the pack`);
    const mesh = doc.meshes[node.mesh];
    const primitives = mesh.primitives.map((prim) => ({
        ...prim,
        attributes: Object.fromEntries(Object.entries(prim.attributes).map(([name, a]) => [name, copyAccessor(a)])),
        indices: copyAccessor(prim.indices),
    }));
    out.meshes.push({ name: mesh.name, primitives });
    out.nodes.push({ ...node, mesh: out.meshes.length - 1 });
    out.scenes[0].nodes.push(out.nodes.length - 1);
});
const binChunk = Buffer.concat(chunks);
const binPadded = Buffer.concat([binChunk, Buffer.alloc((4 - (binChunk.length % 4)) % 4)]);
out.buffers.push({ byteLength: binPadded.length });
const json = Buffer.from(JSON.stringify(out), 'utf8');
const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(GLB_MAGIC, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);
const jsonHead = Buffer.alloc(8);
jsonHead.writeUInt32LE(jsonPadded.length, 0);
jsonHead.writeUInt32LE(CHUNK_JSON, 4);
const binHead = Buffer.alloc(8);
binHead.writeUInt32LE(binPadded.length, 0);
binHead.writeUInt32LE(CHUNK_BIN, 4);
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, jsonHead, jsonPadded, binHead, binPadded]));
console.log(`wrote ${OUT}: ${KINDS.join(', ')} (${(12 + 16 + jsonPadded.length + binPadded.length)} bytes)`);
