/**
 * The Odyssey birds' motion, sampled from the game's own CPU twins for Blender
 * (odyssey_birds_review.py): the review .blend, motion strips, onion skins and wingtip paths.
 *
 *   node scripts/blender/odyssey/bird_motion_export.mjs --out <motion.json>
 *       [--comp <composition dir>] [--fps 30] [--seconds 16]
 *
 * `--comp` points at a copy of src/rendering/odyssey/composition (to sample an older version for a
 * before/after). Everything here is three-free: the flights' and the kettle's vertex-stage frames
 * have CPU twins (`flightFrameAt`, `summitFrameAt`); for an older copy without them the frame is
 * rebuilt here as its vertex stage built it.
 *
 * Output (bird frame: x its left, y up, z forward; world axes y up):
 *   cycles[kind]   one beat at full weight, `samples` poses (phase 0 = the top of the stroke)
 *   clips[kind]    a stretch of clock with a glide -> beat -> glide in it: per frame the pose, the
 *                  beat weight, the body's heave, its tail and its frame (left, up, forward)
 *   eagle          the eagle's clip: per frame every joint (radians, three's Euler ZYX = Blender
 *                  XYZ), its frame and its heave
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const comp = path.resolve(opt('comp', path.join(here, '../../../src/rendering/odyssey/composition')));
const out = opt('out', 'bird-motion.json');
const FPS = Number(opt('fps', 30));
const SECONDS = Number(opt('seconds', 16));
const imp = (f) => import(pathToFileURL(path.join(comp, f)).href);

const flights = await imp('odyssey-flights.js');
const summit = await imp('odyssey-summit-birds.js');
const eagleM = await imp('odyssey-eagle-flight.js');
const rig = await imp('odyssey-bird-rig.js');

const TAU = Math.PI * 2;
const KINDS = [['gull', 0], ['swallow', 1], ['goose', 2]];
const POSE = ['lift', 'sweep', 'bend', 'fold', 'curl'];
const round = (x) => Math.round(x * 1e5) / 1e5;
const poseOf = (p) => Object.fromEntries([...POSE, 'heave', 'tailSpread', 'tailTwist'].map((k) => [k, round(p[k] ?? 0)]));

// -- the frame of an older flights vertex stage (no flightFrameAt) ----------------------------------
function legacyFlightFrame(lane, t) {
    const P = (tt) => flights.flightPositionAt(lane, tt);
    const dt = 0.06;
    const p0 = P(t); const p1 = P(t + dt); const pm = P(t - dt);
    const v = [p1.x - pm.x + 1e-4, p1.y - pm.y, p1.z - pm.z];
    const vl = Math.hypot(...v);
    const fwd = v.map((x) => x / vl);
    let right = [(fwd[1] * 0) - (fwd[2] * 1), (fwd[2] * 0) - (fwd[0] * 0), (fwd[0] * 1) - (fwd[1] * 0)];
    right = [right[0], right[1], right[2] + 1e-5];
    const rl = Math.hypot(...right);
    right = right.map((x) => x / rl);
    const up = [(right[1] * fwd[2]) - (right[2] * fwd[1]), (right[2] * fwd[0]) - (right[0] * fwd[2]), (right[0] * fwd[1]) - (right[1] * fwd[0])];
    const acc = [(p1.x + pm.x - (2 * p0.x)) / (dt * dt), (p1.y + pm.y - (2 * p0.y)) / (dt * dt), (p1.z + pm.z - (2 * p0.z)) / (dt * dt)];
    const gain = lane.kind === 1 ? 0.06 : 0.16;
    const bank = Math.max(-0.95, Math.min(0.95, ((acc[0] * right[0]) + (acc[1] * right[1]) + (acc[2] * right[2])) * gain));
    const cb = Math.cos(bank); const sb = Math.sin(bank);
    const left = [0, 1, 2].map((k) => -((right[k] * cb) - (up[k] * sb)));
    const upB = [0, 1, 2].map((k) => (up[k] * cb) + (right[k] * sb));
    return {
        position: [p0.x, p0.y, p0.z], left, up: upB, forward: fwd, bank,
    };
}

function legacySummitFrame(lane, t) {
    const c = summit.SUMMIT_BIRDS;
    const angle = ((t * TAU) / c.lapSeconds) * ((lane.seed * 0.3) + 0.85) + (lane.phase * TAU);
    const radial = [Math.cos(angle), 0, Math.sin(angle)];
    const forward = [-Math.sin(angle), 0, Math.cos(angle)];
    const cb = Math.cos(c.bank); const sb = Math.sin(c.bank);
    const left = [radial[0] * cb, sb, radial[2] * cb];
    const up = [-radial[0] * sb, cb, -radial[2] * sb];
    const bob = Math.sin((t * 0.23) + (lane.seed * 9)) * 3;
    return {
        position: [c.centre[0] + (radial[0] * lane.radius), c.centre[1] + lane.height + bob, c.centre[2] + (radial[2] * lane.radius)],
        left,
        up,
        forward,
        bank: c.bank,
    };
}

const flightFrame = flights.flightFrameAt ?? legacyFlightFrame;
const summitFrame = summit.summitFrameAt ?? legacySummitFrame;
const r3 = (v) => v.map(round);

// -- one beat at full weight ---------------------------------------------------------------------
const SAMPLES = 48;
const cycles = {};
KINDS.forEach(([name, kind]) => {
    cycles[name] = {
        rate: flights.lowlandBirdModel(kind).flight.rate,
        poses: Array.from({ length: SAMPLES }, (_, k) => poseOf(flights.birdWingPoseAt(kind, (k / SAMPLES) * TAU, 1))),
    };
});
{
    const model = rig.decodeBirdModel('vulture');
    cycles.vulture = {
        rate: model.flight.rate,
        poses: Array.from({ length: SAMPLES }, (_, k) => poseOf(rig.birdWingPoseAt(model, (k / SAMPLES) * TAU, 1))),
    };
}

// -- clips: a stretch of clock with a beat starting and ending in it -------------------------------
const lanes = flights.resolveFlightLanes();
const weightOf = (kind, t, seed) => flights.birdBeatWeight(kind, t, seed);
/** The first clock after `from` where the weight rises through 0.5. */
function onset(f, from, to) {
    let prev = f(from);
    for (let t = from; t < to; t += 0.02) {
        const w = f(t);
        if (prev < 0.5 && w >= 0.5) return t;
        prev = w;
    }
    return from;
}
const clips = {};
KINDS.forEach(([name, kind]) => {
    const lane = lanes.filter((l) => l.kind === kind)[kind === 2 ? 0 : 1];
    const pose = (t) => (flights.birdWingPoseOf ? flights.birdWingPoseOf(lane, t) : flights.birdWingPose(kind, t, lane.seed));
    const weight = (t) => (flights.birdBeatWeightOf ? flights.birdBeatWeightOf(lane, t) : weightOf(kind, t, lane.seed));
    const start = kind === 2 ? 20 : Math.max(0, onset(weight, 20, 200) - 2.0);
    const frames = [];
    for (let k = 0; k < SECONDS * FPS; k += 1) {
        const t = start + (k / FPS);
        const fr = flightFrame(lane, t);
        frames.push({
            t: round(t),
            weight: round(weight(t)),
            ...poseOf(pose(t)),
            position: r3(fr.position),
            left: r3(fr.left),
            up: r3(fr.up),
            forward: r3(fr.forward),
            bank: round(fr.bank ?? 0),
        });
    }
    clips[name] = {
        lane: lanes.indexOf(lane), seed: lane.seed, start, frames,
    };
});
{
    const lanesS = summit.resolveSummitBirdLanes();
    const lane = lanesS[3];
    const index = 3;
    const pose = (t) => (summit.summitWingPoseOf ? summit.summitWingPoseOf(lane, t) : summit.summitWingPose(t, lane.seed));
    const weight = (t) => (summit.summitBeatWeight ? summit.summitBeatWeight(t, lane.seed)
        : (() => { const x = Math.min(1, Math.max(0, (Math.sin((t * 0.21) + (lane.seed * 11)) - 0.55) / 0.35)); return x * x * (3 - (2 * x)); })());
    const start = Math.max(0, onset(weight, 0, 400) - 4.0);
    const frames = [];
    for (let k = 0; k < SECONDS * FPS; k += 1) {
        const t = start + (k / FPS);
        const fr = summit.summitFrameAt ? summitFrame(index, t) : summitFrame(lane, t);
        frames.push({
            t: round(t),
            weight: round(weight(t)),
            ...poseOf(pose(t)),
            position: r3(fr.position),
            left: r3(fr.left),
            up: r3(fr.up),
            forward: r3(fr.forward),
            bank: round(fr.bank ?? 0),
        });
    }
    clips.vulture = {
        lane: index, seed: lane.seed, start, frames,
    };
}

// -- the eagle: a bout of beats in its clip ----------------------------------------------------------
const eaglePose = eagleM.createEaglePose();
const boutStart = eagleM.EAGLE_BOUTS[0][0];
const eStart = boutStart - 3;
const eFrames = [];
for (let k = 0; k < SECONDS * FPS; k += 1) {
    const t = eStart + (k / FPS);
    eagleM.eagleFlight(t, { wind: 0.3 }, eaglePose);
    eFrames.push({
        t: round(t),
        amount: round(eaglePose.bout.amount),
        heave: round(eaglePose.heave),
        position: r3([eaglePose.path.x, eaglePose.path.y, eaglePose.path.z]),
        left: r3(eaglePose.left),
        up: r3(eaglePose.up),
        forward: r3(eaglePose.forward),
        joints: Object.fromEntries(Object.entries(eaglePose.joints).map(([n, j]) => [n, r3(j)])),
    });
}

fs.writeFileSync(out, JSON.stringify({
    fps: FPS, seconds: SECONDS, samples: SAMPLES, cycles, clips, eagle: { start: eStart, span: eagleM.ODYSSEY_EAGLE.span, frames: eFrames },
}));
console.log(`[bird-motion] wrote ${out} (${Object.keys(clips).join(', ')}, eagle)`);
