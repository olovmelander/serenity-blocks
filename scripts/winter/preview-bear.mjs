#!/usr/bin/env node
/**
 * Look at Winter's polar bear without a GPU.
 *
 * Runs the bear's own mind (src/themes/winter/winter-bear-plan.js: its course, its footsteps, what
 * it does) and body (winter-bear-rig.js), skins the asset on the CPU and tiles the frames into one
 * PNG, drawn where it walks in the world: what this draws is what the theme draws, less the coat's
 * light. Dots mark where each paw is: green on the ice, orange swinging.
 *
 *   node scripts/winter/preview-bear.mjs --from=8 --to=10 --frames=8          its walk (clock seconds)
 *   node scripts/winter/preview-bear.mjs --from=376 --to=392 --frames=16      walking in, stopping, sniffing
 *   node scripts/winter/preview-bear.mjs --from=20 --to=28 --rear=21 --frames=8   the board's four
 *   node scripts/winter/preview-bear.mjs --from=20 --to=40 --lie=21 --rise=32 --frames=10
 *
 *   --follow                    keep it in the middle of every frame (else one fixed view)
 *   --yaw=<deg> --pitch=<deg>   where it is seen from (0 = from the viewer's side of the lake)
 *   --cols=<n> --size=<w>x<h> --span=<metres> --out=<file.png> --numbers
 */

import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BEAR_BONES, BEAR_SCALE, createBearPosture, solveBear,
} from '../../src/themes/winter/winter-bear-rig.js';
import { BearMind } from '../../src/themes/winter/winter-bear-plan.js';
import { orbit, picture, tile } from '../fox/cpu-picture.mjs';
import { readGlb } from '../fox/glb-read.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSET = join(HERE, '..', '..', 'src', 'themes', 'winter', 'assets', 'polar-bear.glb');
const DEG = Math.PI / 180;

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
}));
const number = (name, fallback) => (args[name] === undefined ? fallback : Number(args[name]));

const { json, read } = readGlb(typeof args.glb === 'string' ? resolve(args.glb) : ASSET);
const prim = json.meshes[0].primitives[0];
const rest = read(prim.attributes.POSITION);
const indices = read(prim.indices);
const joints = read(prim.attributes.JOINTS_0);
const weights = read(prim.attributes.WEIGHTS_0);
const colours = read(prim.attributes.COLOR_0);
const count = rest.length / 3;
json.skins[0].joints.map((node) => json.nodes[node].name).forEach((name, i) => {
    if (BEAR_BONES[i][0] !== name) throw new Error(`the asset's bone ${i} is ${name}, the rig's is ${BEAR_BONES[i][0]}`);
});

/** Skin the mesh to a posture, then set it where it stands in the world. */
function skinned(posture, pose) {
    const out = new Float32Array(count * 3);
    const { world, at } = posture;
    const c = Math.cos(pose.heading);
    const s = Math.sin(pose.heading);
    for (let v = 0; v < count; v++) {
        let ox = 0;
        let oy = 0;
        let oz = 0;
        for (let k = 0; k < 4; k++) {
            const w = weights[v * 4 + k];
            if (w <= 0) continue;
            const b = joints[v * 4 + k];
            const q = world[b];
            const px = rest[v * 3] - BEAR_BONES[b][2];
            const py = rest[v * 3 + 1] - BEAR_BONES[b][3];
            const pz = rest[v * 3 + 2] - BEAR_BONES[b][4];
            const tx = 2 * (q[1] * pz - q[2] * py);
            const ty = 2 * (q[2] * px - q[0] * pz);
            const tz = 2 * (q[0] * py - q[1] * px);
            ox += w * (at[b][0] + px + q[3] * tx + (q[1] * tz - q[2] * ty));
            oy += w * (at[b][1] + py + q[3] * ty + (q[2] * tx - q[0] * tz));
            oz += w * (at[b][2] + pz + q[3] * tz + (q[0] * ty - q[1] * tx));
        }
        out[v * 3] = pose.x + (ox * c + oz * s) * BEAR_SCALE;
        out[v * 3 + 1] = pose.y + oy * BEAR_SCALE;
        out[v * 3 + 2] = pose.z + (-ox * s + oz * c) * BEAR_SCALE;
    }
    return out;
}

const shade = (v) => {
    const dark = Math.max(colours[v * 4 + 2], colours[v * 4]);
    const sees = 0.35 + 0.65 * colours[v * 4 + 3];
    const k = sees * (1 - dark * 0.92);
    return [k, k * 0.97, k * 0.9];
};

const from = number('from', 8);
const to = number('to', from + 2);
const frames = Math.max(1, Math.round(number('frames', 8)));
const mind = new BearMind(16 / 9);
// (Its clock reads `from` at world time `from`.)
mind.offset = 0;
const events = [];
if (args.rear !== undefined) events.push([number('rear'), (t) => mind.rear(t)]);
if (args.lie !== undefined) events.push([number('lie'), (t) => mind.lie(t)]);
if (args.rise !== undefined) events.push([number('rise'), (t) => mind.rise(t)]);
events.sort((a, b) => a[0] - b[0]);

const times = Array.from({ length: frames }, (_, i) => (frames > 1 ? from + ((to - from) * i) / (frames - 1) : from));
const posture = createBearPosture();
const shots = [];
let fired = 0;
for (const t of times) {
    while (fired < events.length && events[fired][0] <= t) {
        events[fired][1](events[fired][0]);
        fired += 1;
    }
    const pose = mind.step(t);
    solveBear(pose.spec, posture);
    shots.push({
        t, pose: JSON.parse(JSON.stringify({ ...pose, spec: undefined })), positions: skinned(posture, pose), short: [...posture.short],
    });
}

const [W, H] = (typeof args.size === 'string' ? args.size : '360x240').split('x').map(Number);
// Seen from the viewer's side of the lake: yaw 0 looks from the bear's course toward... the eye.
const yaw = number('yaw', 0) * DEG;
const [right, up] = orbit(yaw + Math.PI / 2, number('pitch', 6) * DEG);
const mid = shots.reduce((m, s) => [m[0] + s.pose.x / shots.length, m[1] + s.pose.y / shots.length, m[2] + s.pose.z / shots.length], [0, 0, 0]);
const spanAuto = Math.max(4.2, ...shots.map((s) => 2.2 * Math.hypot(s.pose.x - mid[0], s.pose.z - mid[2]) + 4.2));
const span = number('span', args.follow ? 4.4 : spanAuto);
const tiles = shots.map((shot) => {
    const centre = args.follow ? [shot.pose.x, shot.pose.y + 1.05, shot.pose.z] : [mid[0], mid[1] + 1.05, mid[2]];
    const p = picture({
        positions: shot.positions, indices, colour: shade, right, up, centre, span, width: W, height: H, floor: shot.pose.y,
    });
    shot.pose.paws.forEach((paw) => p.dot([paw.x, paw.y, paw.z], paw.swing > 0.01 ? [255, 160, 60] : [80, 255, 140], 1));
    return p;
});
const out = typeof args.out === 'string' ? resolve(args.out) : join(process.cwd(), `bear-${from}-${to}.png`);
console.log(tile(tiles, Math.max(1, Math.round(number('cols', Math.min(frames, 4)))), out));
if (args.numbers) {
    shots.forEach((s) => {
        const paws = s.pose.paws.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}${p.swing > 0.01 ? '*' : ' '}`).join('  ');
        console.log(`${s.t.toFixed(2).padStart(7)} ${s.pose.clip.padEnd(6)} v ${s.pose.speed.toFixed(2)}  paws ${paws}  short ${s.short.map((v) => v.toFixed(3)).join(',')}`);
    });
}
