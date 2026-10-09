#!/usr/bin/env node
/**
 * Look at a fox without a GPU.
 *
 * Poses a theme's rigged fox (Winter's arctic fox, Sakura Twilight's red fox) with the theme's
 * own rig — the shared solver in src/themes/shared/fox-rig.js — and, for whole behaviours, its
 * own mind, skins it on the CPU and tiles the frames into one PNG. What this draws is what the
 * theme draws, less the fur and the light: enough to write a gait or a pose by.
 *
 *   node scripts/fox/preview-fox.mjs --fox=winter --act=Sit --frames=8      an act, start to end
 *   node scripts/fox/preview-fox.mjs --fox=sakura --act=Pounce --from=0.3 --to=1.2 --frames=10
 *   node scripts/fox/preview-fox.mjs --fox=sakura --gait=1.5 --frames=8     one cycle at 1.5 m/s
 *   node scripts/fox/preview-fox.mjs --fox=winter --mind=round --from=4 --to=12 --frames=16
 *                           the mind itself: round (at rest), run, pounce, sleep, hunt, an act
 *
 *   --fox=winter|sakura         whose (winter when not given)
 *   --yaw=<deg> --pitch=<deg>   where it is seen from (0 = from its left side, 90 = from ahead)
 *   --cols=<n> --size=<w>x<h> --span=<metres> --out=<file.png> --glb=<file>
 *   --numbers                   also print where its paws and nose are in each frame
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FOX_LEGS } from '../../src/themes/shared/fox-rig.js';
import {
    orbit, picture, readPng, tile,
} from './cpu-picture.mjs';
import { readGlb } from './glb-read.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', '..', 'src', 'themes');
const theme = (...parts) => import(pathToFileURL(join(SRC, ...parts)).href);
const DEG = Math.PI / 180;

/** Each theme's fox: its asset, its rig, how to frame it, and (when it has one) its mind. */
const FOXES = {
    async winter() {
        const { FOX_RIG } = await theme('winter', 'winter-fox-rig.js');
        return {
            asset: join(SRC, 'winter', 'assets', 'arctic-fox.glb'),
            rig: FOX_RIG,
            centre: [0, 0.3, 0.02],
            span: 1.35,
            async mind() {
                const { foxRound } = await theme('winter', 'winter-core.js');
                const { FoxMind } = await theme('winter', 'winter-fox-mind.js');
                return new FoxMind(foxRound(16 / 9));
            },
        };
    },
    async sakura() {
        const { SAKURA_FOX_RIG } = await theme('sakura-twilight', 'sakura-fox-rig.js');
        return {
            asset: join(SRC, 'sakura-twilight', 'assets', 'sakura-fox.glb'),
            rig: SAKURA_FOX_RIG,
            centre: [0, 0.42, -0.1],
            span: 2.2,
            async mind() {
                const { SakuraFoxMind } = await theme('sakura-twilight', 'sakura-fox-mind.js');
                return new SakuraFoxMind();
            },
        };
    },
};

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
}));
const number = (name, fallback) => (args[name] === undefined ? fallback : Number(args[name]));
const whose = typeof args.fox === 'string' ? args.fox : 'winter';
if (!FOXES[whose]) throw new Error(`no such fox: ${whose} (${Object.keys(FOXES).join(', ')})`);
const fox = await FOXES[whose]();
const { rig } = fox;

const glb = typeof args.glb === 'string' ? resolve(args.glb) : fox.asset;
if (!existsSync(glb)) throw new Error(`no such file: ${glb}`);
const { json, read, bytes } = readGlb(glb);
const prim = json.meshes[0].primitives[0];
const rest = read(prim.attributes.POSITION);
const indices = read(prim.indices);
const joints = read(prim.attributes.JOINTS_0);
const weights = read(prim.attributes.WEIGHTS_0);
const colours = read(prim.attributes.COLOR_0);
const uvs = prim.attributes.TEXCOORD_0 !== undefined ? read(prim.attributes.TEXCOORD_0) : null;
const count = rest.length / 3;
const names = json.skins[0].joints.map((node) => json.nodes[node].name);
names.forEach((name, i) => {
    if (rig.bones[i][0] !== name) throw new Error(`the asset's bone ${i} is ${name}, the rig's is ${rig.bones[i][0]}`);
});
// Its texture, when it has one: each vertex is drawn in the colour its coat has there.
let coat = null;
if (uvs && json.images?.length) {
    const png = readPng(bytes(json.images[0].bufferView));
    coat = (v) => {
        const x = Math.max(0, Math.min(png.width - 1, Math.floor(uvs[v * 2] * png.width)));
        const y = Math.max(0, Math.min(png.height - 1, Math.floor(uvs[v * 2 + 1] * png.height)));
        const at = (y * png.width + x) * png.channels;
        return [png.data[at] / 255, png.data[at + 1] / 255, png.data[at + 2] / 255];
    };
}

/** Skin the mesh to a posture. */
function skinned(posture) {
    const out = new Float32Array(count * 3);
    const { world, at } = posture;
    for (let v = 0; v < count; v++) {
        const x = rest[v * 3];
        const y = rest[v * 3 + 1];
        const z = rest[v * 3 + 2];
        let ox = 0;
        let oy = 0;
        let oz = 0;
        for (let k = 0; k < 4; k++) {
            const w = weights[v * 4 + k];
            if (w <= 0) continue;
            const b = joints[v * 4 + k];
            const q = world[b];
            const px = x - rig.bones[b][2];
            const py = y - rig.bones[b][3];
            const pz = z - rig.bones[b][4];
            const tx = 2 * (q[1] * pz - q[2] * py);
            const ty = 2 * (q[2] * px - q[0] * pz);
            const tz = 2 * (q[0] * py - q[1] * px);
            ox += w * (at[b][0] + px + q[3] * tx + (q[1] * tz - q[2] * ty));
            oy += w * (at[b][1] + py + q[3] * ty + (q[2] * tx - q[0] * tz));
            oz += w * (at[b][2] + pz + q[3] * tz + (q[0] * ty - q[1] * tx));
        }
        out[v * 3] = ox;
        out[v * 3 + 1] = oy;
        out[v * 3 + 2] = oz;
    }
    return out;
}

const shade = (v) => {
    const dark = colours[v * 4 + 2];
    const sees = 0.35 + 0.65 * colours[v * 4 + 3];
    if (coat) return coat(v).map((c) => c * sees);
    const s = sees * (1 - dark * 0.95);
    return [s, s, s * 1.03];
};

const [W, H] = (typeof args.size === 'string' ? args.size : '360x280').split('x').map(Number);
const span = number('span', fox.span);
const [right, up] = orbit(number('yaw', 25) * DEG, number('pitch', 8) * DEG);
const frames = Math.max(1, Math.round(number('frames', 8)));
const spec = rig.createSpec();
const posture = rig.createPosture();
const tiles = [];
const report = [];
const lastBone = (leg) => leg[3];

function draw(label, lift = 0) {
    rig.solve(spec, posture);
    const positions = skinned(posture);
    if (lift) for (let v = 0; v < count; v++) positions[v * 3 + 1] += lift;
    const p = picture({
        positions, indices, colour: shade, right, up, centre: fox.centre, span, width: W, height: H, floor: 0,
    });
    // Where each paw is meant to meet the ground (red: its leg could not reach).
    FOX_LEGS.forEach((leg, i) => {
        const paw = rig.point(posture, lastBone(leg), rig.marks[leg[4]]);
        p.dot([paw[0], paw[1] + lift, paw[2]], posture.short[i] > 1e-3 ? [255, 60, 60] : [80, 255, 140], 1);
    });
    tiles.push(p);
    if (args.numbers) {
        const paws = FOX_LEGS.map((leg) => rig.point(posture, lastBone(leg), rig.marks[leg[4]]).map((n) => n.toFixed(3)).join(','));
        const nose = rig.point(posture, 'head', rig.marks.nose).map((n) => n.toFixed(3)).join(',');
        const short = posture.short.map((n) => n.toFixed(3)).join(',');
        report.push(`${label.padEnd(18)} paws ${paws.join('  ')}  nose ${nose}  short ${short}`);
    }
}

let name = `fox-${whose}`;
if (typeof args.act === 'string') {
    const length = rig.lengths[args.act];
    if (!length) throw new Error(`no such act: ${args.act} (${Object.keys(rig.lengths).join(', ')})`);
    const from = number('from', 0);
    const to = number('to', length);
    name += `-${args.act}`;
    for (let i = 0; i < frames; i++) {
        const t = frames > 1 ? from + ((to - from) * i) / (frames - 1) : from;
        rig.spec({
            clip: args.act, clipTime: t, from: args.act, blend: 1, side: args.side === '-1' ? -1 : 1,
        }, spec);
        draw(`${args.act} ${t.toFixed(2)}`);
    }
} else if (args.gait !== undefined) {
    const speed = number('gait', 1.5);
    name += `-gait-${speed}`;
    for (let i = 0; i < frames; i++) {
        const phase = number('from', 0) + i / frames;
        spec.fill(0);
        rig.gait(spec, phase, speed, 1);
        draw(`gait ${phase.toFixed(2)}`);
    }
    console.log(`stride ${rig.stride(speed).toFixed(3)} m, ${(speed / rig.stride(speed)).toFixed(2)} cycles a second, `
        + `on the ground ${(rig.duty(speed) * 100).toFixed(0)}% of each, gallop ${rig.gallop(speed).toFixed(2)}`);
} else if (typeof args.mind === 'string') {
    const mind = await fox.mind();
    const from = number('from', 0);
    const to = number('to', 10);
    const step = 1 / 60;
    const env = { power: 0, surge: 0 };
    name += `-mind-${args.mind}`;
    let time = 0;
    let next = 0;
    const at = (i) => (frames > 1 ? from + ((to - from) * i) / (frames - 1) : from);
    const eventAt = number('at', from);
    let fired = false;
    // (A mind with more than one fox shows the one asked for: --which=1.)
    const poseOf = () => (mind.poses ? mind.poses[Math.round(number('which', 0))] : mind.pose);
    while (next < frames) {
        if (!fired && time >= eventAt) {
            fired = true;
            if (args.mind === 'sleep') mind.sleep(time);
            if (args.mind === 'pounce') mind.pounce(time);
            if (args.mind === 'run') env.power = number('power', 0.7);
            if (rig.lengths[args.mind]) mind.rehearse([args.mind], time);
            if (args.mind === 'hunt') mind.rehearse(['Listen', 'Pounce', 'Dig', 'Shake'], time);
        }
        mind.step(step, time, env);
        time += step;
        if (time >= at(next)) {
            const pose = poseOf();
            rig.spec(pose, spec);
            draw(`${time.toFixed(2)} ${pose.clip}`, (pose.lift || 0) / rig.scale);
            next += 1;
        }
    }
} else {
    spec.fill(0);
    draw('stand');
}

const out = typeof args.out === 'string' ? resolve(args.out) : join(process.cwd(), `${name}.png`);
console.log(tile(tiles, Math.max(1, Math.round(number('cols', Math.min(frames, 4)))), out));
report.forEach((line) => console.log(line));
