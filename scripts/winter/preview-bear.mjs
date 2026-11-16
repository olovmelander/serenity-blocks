#!/usr/bin/env node
/**
 * Look at Winter's polar bears without a GPU.
 *
 * Runs the bear's own mind (src/themes/winter/winter-bear-plan.js: its course, its footsteps, what
 * it does) and body (winter-bear-rig.js), skins the assets on the CPU and tiles the frames into one
 * PNG, drawn where they walk in the world: what this draws is what the theme draws, less the coat's
 * light. Dots mark where each paw is: green on the ice, orange swinging.
 *
 *   node scripts/winter/preview-bear.mjs --from=8 --to=10 --frames=8 --follow    its walk (seconds into the lap)
 *   node scripts/winter/preview-bear.mjs --lap=1 --from=60 --to=75 --frames=16   a later lap (here a mother and her cub)
 *   node scripts/winter/preview-bear.mjs --from=20 --to=28 --rear=21 --frames=8  the board's four
 *   node scripts/winter/preview-bear.mjs --from=20 --to=40 --lie=21 --rise=32 --frames=10
 *   node scripts/winter/preview-bear.mjs --act=Roll --frames=16                  one act, standing where it is
 *   node scripts/winter/preview-bear.mjs --act=Sit --len=14 --who=cub --numbers  ...on the cub's body
 *   node scripts/winter/preview-bear.mjs --laps=12                               list what each lap holds
 *
 *   --lap=<n>                   which lap the seconds are in (0: the first); --seed=<n> its seed
 *   --rear= --wonder= --lie= --rise= --scent= --glance=<s>   what the board makes it do, and when
 *   --act=<name>                draw an act of the rig on its own (bearAct), --len its length
 *   --who=cub                   follow the cub (a lap that has one), or draw an act on its body
 *   --follow                    keep it in the middle of every frame (else one fixed view)
 *   --yaw=<deg> --pitch=<deg>   where it is seen from (0 = from the viewer's side of the lake)
 *   --cols=<n> --size=<w>x<h> --span=<metres> --out=<file.png> --numbers
 *   --glb=<file> --cubglb=<file>   other assets than the theme's
 */

import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BEAR_ACTS, BEAR_BONES, BEAR_SCALE, bearAct, createBearPosture, createBearSpec, solveBear,
} from '../../src/themes/winter/winter-bear-rig.js';
import { BEAR_ROUTES, BearMind } from '../../src/themes/winter/winter-bear-plan.js';
import { orbit, picture, tile } from '../fox/cpu-picture.mjs';
import { readGlb } from '../fox/glb-read.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', '..', 'src', 'themes', 'winter', 'assets');
const DEG = Math.PI / 180;

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
}));
const number = (name, fallback) => (args[name] === undefined ? fallback : Number(args[name]));

/** A body read from an asset: its mesh, its skin, and which of its vertices are its trunk's. */
function body(file) {
    const { json, read } = readGlb(file);
    const prim = json.meshes[0].primitives[0];
    const rest = read(prim.attributes.POSITION);
    const joints = read(prim.attributes.JOINTS_0);
    const weights = read(prim.attributes.WEIGHTS_0);
    const count = rest.length / 3;
    json.skins[0].joints.map((node) => json.nodes[node].name).forEach((name, i) => {
        if (BEAR_BONES[i][0] !== name) throw new Error(`the asset's bone ${i} is ${name}, the rig's is ${BEAR_BONES[i][0]}`);
    });
    // (Not a leg's, whose long hair may brush the ice.)
    const trunk = new Set(['pelvis', 'spine1', 'spine2', 'chest', 'neck1', 'neck2', 'head'].map((name) => BEAR_BONES.findIndex((bone) => bone[0] === name)));
    const ofTrunk = Array.from({ length: count }, (_, v) => {
        let share = 0;
        for (let k = 0; k < 4; k++) if (trunk.has(joints[v * 4 + k])) share += weights[v * 4 + k];
        return share >= 0.7;
    });
    return {
        rest, joints, weights, count, ofTrunk, indices: read(prim.indices), colours: read(prim.attributes.COLOR_0),
    };
}
const ADULT = body(typeof args.glb === 'string' ? resolve(args.glb) : join(ASSETS, 'polar-bear.glb'));
const cubFile = typeof args.cubglb === 'string' ? resolve(args.cubglb) : join(ASSETS, 'polar-bear-cub.glb');
/** (Where there is no cub's body to read it is drawn in its mother's, at its own size.) */
const CUB = existsSync(cubFile) ? body(cubFile) : ADULT;

/** Skin a body to a posture, then set it where it stands in the world, at its size. */
function skinned(mesh, posture, pose) {
    const {
        rest, joints, weights, count,
    } = mesh;
    const out = new Float32Array(count * 3);
    const { world, at } = posture;
    const c = Math.cos(pose.heading);
    const s = Math.sin(pose.heading);
    const k = BEAR_SCALE * (pose.size ?? 1);
    for (let v = 0; v < count; v++) {
        let ox = 0;
        let oy = 0;
        let oz = 0;
        for (let j = 0; j < 4; j++) {
            const w = weights[v * 4 + j];
            if (w <= 0) continue;
            const b = joints[v * 4 + j];
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
        out[v * 3] = pose.x + (ox * c + oz * s) * k;
        out[v * 3 + 1] = pose.y + oy * k;
        out[v * 3 + 2] = pose.z + (-ox * s + oz * c) * k;
    }
    return out;
}
/** The lowest a body's trunk and head go under the ground it stands on (world metres, + below it). */
const sunk = (mesh, positions, floor) => {
    let low = Infinity;
    for (let v = 0; v < mesh.count; v++) if (mesh.ofTrunk[v]) low = Math.min(low, positions[v * 3 + 1]);
    return floor - low;
};

const seed = args.seed === undefined ? undefined : number('seed');
const mind = new BearMind(16 / 9, seed === undefined ? { start: 0 } : { start: 0, seed });
/** Deal the laps up to lap `n`. */
const dealTo = (n) => {
    while (mind.laps.length <= n) {
        const last = mind.laps[mind.laps.length - 1];
        mind.lapIndex(last.start + last.wait + last.period + 0.01);
    }
};
if (args.laps !== undefined) {
    dealTo(number('laps', 12));
    mind.laps.forEach((lap) => {
        const { deal } = lap;
        const who = deal.family ? `a female (${deal.size.toFixed(2)}) and her cub (${deal.cub.size.toFixed(2)})` : `the ${deal.kind} (${deal.size.toFixed(2)})`;
        const lope = deal.lope?.k !== undefined ? `, loping from knot ${deal.lope.k}` : '';
        console.log(`lap ${lap.n}: ${BEAR_ROUTES[lap.way].name}, ${who}, ${lap.period.toFixed(0)} s after ${lap.wait.toFixed(0)} s away${lope}`);
        const quick = Math.sqrt(1 / deal.size);
        mind.courseOf(lap).segments.filter((s) => s.kind === 'stop').forEach((s) => {
            console.log(`    ${(s.start / quick).toFixed(1).padStart(7)} s  ${s.act} (${(s.duration / quick).toFixed(1)} s)`);
        });
    });
    process.exit(0);
}

const act = typeof args.act === 'string' ? args.act : null;
const actLength = act ? number('len', BEAR_ACTS[act]) : 0;
const lapNumber = Math.max(0, Math.round(number('lap', 0)));
dealTo(lapNumber);
const lap = mind.laps[lapNumber];
/** A lap's seconds as the world's. */
const world = (seconds) => lap.start + lap.wait + seconds;
const from = number('from', act ? 0 : 8);
const to = number('to', act ? actLength : from + 2);
const frames = Math.max(1, Math.round(number('frames', 8)));
const events = [];
['rear', 'wonder', 'lie', 'rise', 'scent', 'glance'].forEach((verb) => {
    if (args[verb] !== undefined) events.push([world(number(verb)), (t) => mind[verb](t)]);
});
events.sort((a, b) => a[0] - b[0]);
const followCub = args.who === 'cub';

const times = Array.from({ length: frames }, (_, i) => (frames > 1 ? from + ((to - from) * i) / (frames - 1) : from));
const posture = createBearPosture();
const shots = [];
let fired = 0;
const actSpec = createBearSpec();
const flat = (pose) => JSON.parse(JSON.stringify({ ...pose, spec: undefined, cub: undefined }));
for (const t of times) {
    const at = world(t);
    while (fired < events.length && events[fired][0] <= at) {
        events[fired][1](events[fired][0]);
        fired += 1;
    }
    const drawn = [];
    if (act) {
        // (An act on its own stands at the origin, with no feet of a gait under it.)
        const pose = {
            x: 0, y: 0, z: 0, heading: 0, speed: 0, size: 1, clip: act, spec: bearAct(actSpec, act, t, actLength), paws: [],
        };
        solveBear(pose.spec, posture);
        const mesh = followCub ? CUB : ADULT;
        drawn.push({
            mesh, pose: flat(pose), positions: skinned(mesh, posture, pose), short: [...posture.short],
        });
    } else {
        const pose = mind.step(at);
        solveBear(pose.spec, posture);
        drawn.push({
            mesh: ADULT, pose: flat(pose), positions: skinned(ADULT, posture, pose), short: [...posture.short],
        });
        if (pose.cub.present) {
            solveBear(pose.cub.spec, posture);
            drawn.push({
                mesh: CUB, pose: flat(pose.cub), positions: skinned(CUB, posture, pose.cub), short: [...posture.short],
            });
        }
    }
    const lead = drawn[followCub && drawn.length > 1 ? 1 : 0];
    shots.push({
        t, drawn, pose: lead.pose, short: lead.short, sunk: sunk(lead.mesh, lead.positions, lead.pose.y),
    });
}

/** Every body of a frame as one mesh. */
function merged(drawn) {
    const total = drawn.reduce((n, d) => n + d.mesh.count, 0);
    const positions = new Float32Array(total * 3);
    const indices = new Uint32Array(drawn.reduce((n, d) => n + d.mesh.indices.length, 0));
    const shades = new Float32Array(total);
    let v0 = 0;
    let i0 = 0;
    drawn.forEach(({ mesh, positions: p }) => {
        positions.set(p, v0 * 3);
        for (let i = 0; i < mesh.indices.length; i++) indices[i0 + i] = mesh.indices[i] + v0;
        for (let v = 0; v < mesh.count; v++) {
            const dark = Math.max(mesh.colours[v * 4 + 2], mesh.colours[v * 4]);
            shades[v0 + v] = (0.35 + 0.65 * mesh.colours[v * 4 + 3]) * (1 - dark * 0.92);
        }
        v0 += mesh.count;
        i0 += mesh.indices.length;
    });
    return { positions, indices, colour: (v) => [shades[v], shades[v] * 0.97, shades[v] * 0.9] };
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
        ...merged(shot.drawn), right, up, centre, span, width: W, height: H, floor: shot.pose.y,
    });
    shot.drawn.forEach((d) => d.pose.paws.forEach((paw) => p.dot([paw.x, paw.y, paw.z], paw.swing > 0.01 ? [255, 160, 60] : [80, 255, 140], 1)));
    return p;
});
const out = typeof args.out === 'string' ? resolve(args.out) : join(process.cwd(), `bear-${act || from}-${to}.png`);
console.log(tile(tiles, Math.max(1, Math.round(number('cols', Math.min(frames, 4)))), out));
if (args.numbers) {
    shots.forEach((s) => {
        const paws = s.pose.paws.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}${p.swing > 0.01 ? '*' : ' '}`).join('  ');
        console.log(`${s.t.toFixed(2).padStart(7)} ${s.pose.clip.padEnd(6)} v ${s.pose.speed.toFixed(2)}  paws ${paws}  short ${s.short.map((v) => v.toFixed(3)).join(',')}  sunk ${s.sunk.toFixed(3)}`);
    });
}
