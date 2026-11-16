#!/usr/bin/env node
/**
 * Measure how the arctic fox moves, without a GPU: the numbers a still picture does not show.
 *
 * Poses Winter's fox with the theme's own rig and mind at 60 frames a second and reports, over
 * the span asked for:
 *
 *   turn    the largest turn of any bone in one frame (degrees), and which bone and when
 *   short   the furthest a leg fell short of its paw (model mm)
 *   low     the lowest any vertex of the skinned mesh went under the snow (model mm)
 *   sunk    the deepest a paw that is on the snow was put under it (model mm)
 *   slip    how far a paw the gait has on the snow moved over it in one frame (world mm: the
 *           mean over every such paw and frame, and the most), mind runs only
 *
 *   node scripts/fox/measure-fox.mjs --acts                    every act of its rig, a line each
 *   node scripts/fox/measure-fox.mjs --act=SnowBath            one act, start to end
 *   node scripts/fox/measure-fox.mjs --pace=bound --speed=2 --stretch=1.5
 *                                    one pace, held (walk, trot, lope, bound)
 *   node scripts/fox/measure-fox.mjs --mind=wander --seconds=600 [--seed=7] [--visitor]
 *                                    the game's fox (or the visitor, while it is in sight), left to itself
 *   node scripts/fox/measure-fox.mjs --mind=stop:Scratch       stopped to do something, and on again
 *   node scripts/fox/measure-fox.mjs --mind=do:twirl           an answer to the board (twirl, gaze, rejoice)
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FOOT, FOX_LEGS, SPEC } from '../../src/themes/shared/fox-rig.js';
import { readGlb } from './glb-read.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', '..', 'src', 'themes');
const theme = (...parts) => import(pathToFileURL(join(SRC, ...parts)).href);
const FRAME = 1 / 60;
const DEG = 180 / Math.PI;

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
}));
const number = (name, fallback) => (args[name] === undefined ? fallback : Number(args[name]));

const rigs = await theme('winter', 'winter-fox-rig.js');
const rig = args.visitor ? rigs.VISITOR_RIG : rigs.FOX_RIG;
const asset = typeof args.glb === 'string' ? resolve(args.glb) : join(SRC, 'winter', 'assets', 'arctic-fox.glb');
const { json, read } = readGlb(asset);
const prim = json.meshes[0].primitives[0];
const rest = read(prim.attributes.POSITION);
const joints = read(prim.attributes.JOINTS_0);
const weights = read(prim.attributes.WEIGHTS_0);
const count = rest.length / 3;

/** The lowest any vertex of the mesh is in a posture (model metres; every fourth vertex is enough). */
function lowest(posture) {
    const { world, at } = posture;
    let low = Infinity;
    for (let v = 0; v < count; v += 4) {
        const x = rest[v * 3];
        const y = rest[v * 3 + 1];
        const z = rest[v * 3 + 2];
        let oy = 0;
        for (let k = 0; k < 4; k++) {
            const w = weights[v * 4 + k];
            if (w <= 0) continue;
            const b = joints[v * 4 + k];
            const q = world[b];
            const px = x - rig.bones[b][2];
            const py = y - rig.bones[b][3];
            const pz = z - rig.bones[b][4];
            const tx = 2 * (q[1] * pz - q[2] * py);
            const tz = 2 * (q[0] * py - q[1] * px);
            const ty = 2 * (q[2] * px - q[0] * pz);
            oy += w * (at[b][1] + py + q[3] * ty + (q[2] * tx - q[0] * tz));
        }
        if (oy < low) low = oy;
    }
    return low;
}

const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const turnBetween = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(dot4(a, b))));

/** What is kept of a run of frames. */
const tally = () => ({
    frames: 0,
    turn: 0,
    turnAt: '',
    short: 0,
    shortAt: '',
    low: 0,
    lowAt: '',
    sunk: 0,
    slipSum: 0,
    slipCount: 0,
    slipMost: 0,
    slipAt: '',
});

const spec = rig.createSpec();
let before = rig.createPosture();
let after = rig.createPosture();
const paw = [0, 0, 0];

/**
 * Take one frame of the spec as it stands: `label()` says when; `lift` is how high its mind has
 * it off the snow (model metres); `first` begins a run (nothing to compare with).
 */
function frame(sum, label, lift = 0, first = false) {
    rig.solve(spec, after);
    if (!first) {
        for (let b = 0; b < rig.bones.length; b++) {
            const turn = turnBetween(before.world[b], after.world[b]);
            if (turn > sum.turn) {
                sum.turn = turn;
                sum.turnAt = `${rig.bones[b][0]} ${label()}`;
            }
        }
    }
    for (let i = 0; i < 4; i++) {
        if (after.short[i] > sum.short) {
            sum.short = after.short[i];
            sum.shortAt = `${FOX_LEGS[i][0]} ${label()}`;
        }
        if (spec[SPEC.feet + i * FOOT.size + FOOT.air] < 0.01) {
            rig.point(after, FOX_LEGS[i][3], rig.marks[FOX_LEGS[i][4]], paw);
            sum.sunk = Math.max(sum.sunk, -(paw[1] + lift));
        }
    }
    const low = lowest(after) + lift;
    if (low < sum.low) {
        sum.low = low;
        sum.lowAt = label();
    }
    sum.frames += 1;
    [before, after] = [after, before];
}

const mm = (metres, places = 1) => (metres * 1000).toFixed(places);

function line(name, sum) {
    const parts = [
        `${name.padEnd(22)} turn ${(sum.turn * DEG).toFixed(1).padStart(5)}°/frame (${sum.turnAt})`,
        `short ${mm(sum.short)} mm${sum.short > 1e-4 ? ` (${sum.shortAt})` : ''}`,
        `low ${mm(sum.low, 0)} mm${sum.low < -0.03 ? ` (${sum.lowAt})` : ''}`,
        `sunk ${mm(sum.sunk)} mm`,
    ];
    if (sum.slipCount) {
        parts.push(`slip mean ${mm(sum.slipSum / sum.slipCount, 2)} mm, most ${mm(sum.slipMost)} mm (${sum.slipAt})`);
    }
    return parts.join('  ');
}

function measureAct(name) {
    const length = rig.lengths[name];
    const sum = tally();
    const frames = Math.ceil(length / FRAME);
    for (let i = 0; i <= frames; i++) {
        const t = Math.min(length, i * FRAME);
        rig.act(spec, name, t);
        frame(sum, () => `at ${t.toFixed(2)} s`, 0, i === 0);
    }
    return sum;
}

/** Follow the paws the gait has on the snow through a mind's frames: how far each moved over it. */
function slipper() {
    const footing = new Float64Array(8);
    const last = new Float64Array(8);
    const down = new Uint8Array(4);
    return (pose, sum, label, first = false) => {
        if (first) down.fill(0);
        const share = rig.footing(pose, footing);
        const c = Math.cos(pose.heading);
        const s = Math.sin(pose.heading);
        for (let i = 0; i < 4; i++) {
            // (`before` is the posture the frame just taken left behind.)
            rig.point(before, FOX_LEGS[i][3], rig.marks[FOX_LEGS[i][4]], paw);
            const x = pose.x + rig.scale * (paw[0] * c + paw[2] * s);
            const z = pose.z + rig.scale * (paw[2] * c - paw[0] * s);
            const planted = share > 0.99 && footing[2 * i] === 1 && pose.lift < 0.01;
            if (planted && down[i]) {
                const slip = Math.hypot(x - last[2 * i], z - last[2 * i + 1]);
                sum.slipSum += slip;
                sum.slipCount += 1;
                if (slip > sum.slipMost) {
                    sum.slipMost = slip;
                    sum.slipAt = `${FOX_LEGS[i][0]} ${label()}`;
                }
            }
            down[i] = planted ? 1 : 0;
            last[2 * i] = x;
            last[2 * i + 1] = z;
        }
    };
}

function measurePace(name) {
    const pace = rigs.createFoxPace();
    if (name !== 'trot') pace[name] = 1;
    pace.stretch = number('stretch', 1);
    const speed = number('speed', 1.5);
    const sum = tally();
    const metres = rig.stride(speed, pace);
    const cycles = speed / metres;
    const frames = Math.ceil(3 / cycles / FRAME);
    for (let i = 0; i <= frames; i++) {
        const phase = i * FRAME * cycles;
        spec.fill(0);
        rig.gait(spec, phase, speed, 1, 0, rig.gallop(speed), pace);
        frame(sum, () => `phase ${(phase % 1).toFixed(2)}`, 0, i === 0);
    }
    console.log(`${name} at ${speed} m/s: stride ${metres.toFixed(2)} m, ${cycles.toFixed(2)} cycles a second, `
        + `on the snow ${(rig.duty(speed, pace) * 100).toFixed(0)}% of each`);
    console.log(line(name, sum));
}

async function measureMind(asked) {
    const { foxRound } = await theme('winter', 'winter-core.js');
    const minds = await theme('winter', 'winter-fox-mind.js');
    const aspect = number('aspect', 16 / 9);
    const seed = number('seed', 0xf0c5);
    const mind = args.visitor
        ? new minds.VisitorMind(aspect, seed)
        : new minds.FoxMind(foxRound(aspect), seed, { wander: true, aspect });
    const seconds = number('seconds', 60);
    const [what, which] = asked.split(':');
    const env = { power: number('power', 0), surge: 0, aurora: number('aurora', 0) };
    const sum = tally();
    const slip = slipper();
    const kinds = new Map();
    const paces = new Map();
    let stops = 0;
    let lastAct = null;
    let repeats = 0;
    let wasSeen = false;
    let inSight = 0;
    const steps = Math.round(seconds / FRAME);
    for (let i = 0; i <= steps; i++) {
        const time = i * FRAME;
        if (what === 'stop' && i === 120) mind.rehearse(which.split(','), time);
        if (what === 'do' && i === 120) mind[which](time);
        mind.step(FRAME, time, env);
        const { pose } = mind;
        // (The visitor is measured only where it could be seen: behind the viewer it stands and waits.)
        const inView = !args.visitor || (mind.present && !mind.away);
        if (inView) {
            const label = () => `${pose.clip} at ${time.toFixed(2)} s`;
            rig.spec(pose, spec);
            frame(sum, label, (pose.lift || 0) / rig.scale, !wasSeen);
            slip(pose, sum, label, !wasSeen);
            inSight += FRAME;
        }
        wasSeen = inView;
        if (mind.act && mind.act !== lastAct) {
            const name = mind.act.join('+');
            if (lastAct && lastAct.join('+') === name) repeats += 1;
            kinds.set(name, (kinds.get(name) || 0) + 1);
            stops += 1;
            lastAct = mind.act;
        }
        if (mind.mode === 'gait' && mind.going) paces.set(mind.going, (paces.get(mind.going) || 0) + FRAME);
    }
    console.log(line(asked, sum));
    if (stops) {
        const most = [...kinds.entries()].sort((a, b) => b[1] - a[1]);
        console.log(`  ${stops} stops, ${kinds.size} kinds, the same twice running ${repeats} times`);
        console.log(`  ${most.map(([name, n]) => `${name} ${n}`).join(', ')}`);
    }
    if (args.visitor) console.log(`  in sight ${inSight.toFixed(0)} s of ${seconds}`);
    const spells = [...paces.entries()].map(([name, s]) => `${name} ${s.toFixed(0)}`);
    if (spells.length) console.log(`  paces (s): ${spells.join(', ')}`);
}

if (args.acts) {
    Object.keys(rig.lengths).filter((name) => name !== 'Run').forEach((name) => {
        console.log(line(name, measureAct(name)));
    });
} else if (typeof args.act === 'string') {
    console.log(line(args.act, measureAct(args.act)));
} else if (typeof args.pace === 'string') {
    measurePace(args.pace);
} else if (typeof args.mind === 'string') {
    await measureMind(args.mind);
} else {
    console.log('say what to measure: --acts, --act=<name>, --pace=<name>, --mind=wander|stop:<acts>|do:<verb>');
}
