/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE LOWLAND FLIGHTS — gulls over the surf, swallows over the meadows, a skein of geese across
 * the massif (chapters 3-4).
 *
 * Above the water Act II had no life at all until the chapter-5 kettle: a shore with no gulls, a
 * meadow with no swallows, and nothing moving across the ~1 km view of the massif every parked
 * orb looks at. Three flocks now live there:
 *   - GULLS wheel in loose, drifting loops over the beach line ahead of the shore orbs (L11-L18),
 *     white and front-lit (the act's sun stands behind the camera), gliding on bowed wings with
 *     a few slow beats now and then — mostly against the sea and the sand, some against the sky;
 *   - SWALLOWS dart in quick figure-of-eights at eye height a little ahead of the meadow orbs
 *     (L16-L24): small, dark, bursts of fast beats with the wings swept back between — the scale
 *     cue the near field lacked;
 *   - a SKEIN of geese crosses in front of the massif's face in a V, west to east, once every
 *     `period` seconds, beating steadily — a slow event every parked view of chapters 3-4 shares.
 *
 * THE BIRDS (2026-11): a herring gull, a barn swallow and a greylag goose modelled in Blender
 * for the sizes they have in the frame (a gull 20-55 px across at 2560 x 1440, a swallow 7-36, a
 * goose 9-35): volume bodies, real wing planforms with a wrist, the plumage seen from above and
 * from below, a few hundred triangles each (`scripts/blender/odyssey/odyssey_birds.py` writes
 * `odyssey-bird-models.js`: typed arrays in the bundle, no fetch, no loader). There is no
 * skeleton: each vertex carries how much the shoulder, the wrist and the wingtip move it, and the
 * vertex stage folds the wing about those two hinges (`foldBirdPoint` is its CPU twin), the
 * normals with it, so the light turns with the beat.
 *
 * THE MOTION (2026-11-03; docs/ODYSSEY_BLENDER_BIRDS_2026-11.md, "Natural flight"):
 *   - each kind's beat is keyframed in Blender (odyssey-bird-beats.js): a quick downstroke on a
 *     spread wing, the wrist flexing on the upstroke so the tip draws a loop, the body rising
 *     against the beat;
 *   - GULLS beat in bouts of 3-5 on a clock of their own; a bout starts and ends at mid-upstroke
 *     (where the beat meets the glide) and eases in and out. Between bouts the bowed wings flex
 *     softly on the air;
 *   - SWALLOWS beat on the straights of their eight and glide swept through its turns;
 *   - the SKEIN beats as one wave running back down the V (each rank a little later), its
 *     spacing breathing slowly;
 *   - every bird banks with its turn (soft at the limit, a moment ahead of the turn) and fans
 *     and twists its tail into it. No swallow's path ever runs straight up (its heading spun).
 *
 * Every bird is CLOSED FORM in the vertex stage (position at t, heading from the position a
 * moment either side, bank from the turn, the wingbeat from the clock), so nothing is written per
 * frame but the clock and three reveal values. Orientation is built from WORLD UP (never
 * `setFromUnitVectors(+z, heading)`, which flips a bird belly-up), and a turn to the right rolls
 * the right wing DOWN. `flightFrameAt` and `birdWingPoseOf` are the vertex stage's CPU twins.
 *
 * ZERO-HITCH (ADR-0020), the summit birds' pattern: one opaque instanced draw per flock, all three
 * sharing ONE material (the same shader and pipeline: their attributes are laid out alike), built
 * with the board's presentation group before the reveal; afterwards only uniforms change — each
 * flock is revealed by SCALE (`uReveal` per flock), so no blend state and no pipeline ever
 * changes. BISECT LEVER (board): `?odysseyNoFlights=1`.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, cos, cross, dot, float, fract, length, max, mix,
    normalize, pow, positionLocal, sin, smoothstep, uniform, uniformArray, varying, vec3,
} from 'three/tsl';
import {
    BIRD_BEAT_CHANNELS, beatHarmonicsNode, beatSeriesNode, birdBoutAt, birdBoutNode, birdColourNode,
    birdWingPoseAt as birdWingPoseOfModel, decodeBirdModel, foldBirdNode, foldBirdPoint, packBeatSeries,
    setBirdTemplate, smootherstep, smootherstepNode, tailBirdNode,
} from './odyssey-bird-rig.js';

const TAU = Math.PI * 2;
/** How far a gull's loop centre wanders over a minute or so (world units). */
const GULL_DRIFT = 22;

/** Bird kinds (the `kind` field of a flock) — selects the flight model and the plumage. */
export const FLIGHT_KIND = Object.freeze({ GULL: 0, SWALLOW: 1, GOOSE: 2 });
/** The model each kind flies (keys of ODYSSEY_BIRD_MODELS), by FLIGHT_KIND. */
const KIND_MODEL = Object.freeze(['gull', 'swallow', 'goose']);

/**
 * How each kind flies (per FLIGHT_KIND):
 *   bankGain   bank (rad) per u/s^2 of turn; bankMax where it saturates (softly)
 *   tail       [spread at rest, spread per radian of bank, twist per radian of bank]
 *   flex       the held wing's slow flex: [lift amplitude, bend amplitude, rate rad/s]
 */
export const FLIGHT_STYLE = Object.freeze([
    Object.freeze({
        bankGain: 0.16, bankMax: 0.95, tail: Object.freeze([0.10, 0.24, 0.30]), flex: Object.freeze([0.035, 0.04, 0.9]),
    }),
    Object.freeze({
        bankGain: 0.06, bankMax: 1.0, tail: Object.freeze([0.06, 0.28, 0.28]), flex: Object.freeze([0.02, 0.02, 1.5]),
    }),
    Object.freeze({
        bankGain: 0.16, bankMax: 0.95, tail: Object.freeze([0.04, 0.06, 0.10]), flex: Object.freeze([0, 0, 1]),
    }),
]);
/** A smooth |bank| (no corner at level flight) for the tail's fan: sqrt(b^2 + e^2) - e. */
const TAIL_EASE = 0.08;
/** The bank reads the turn this much ahead (s): a bird rolls into a turn as it begins it. */
const BANK_LEAD = 0.1;
/** The stencil (s) the heading and the turn are read over. */
const STENCIL = 0.06;
/** The gulls' bouts (odyssey-bird-rig.js `birdBoutAt`): every 8-14 s, 3-5 beats. */
export const GULL_BOUTS = Object.freeze({
    period: Object.freeze([8, 14]), beats: Object.freeze([3, 5]), start: 0.70, rise: 0.30, fall: 0.42, tail: 0.12,
});
/** The swallows beat where their eight runs straight (|cos| of its angle above this) ... */
const SWALLOW_STRAIGHT = Object.freeze([0.30, 0.80]);
/** ... and not every time: a slow gate of their own (sin above this beats). */
const SWALLOW_GATE = Object.freeze([-0.7, -0.2, 0.41]);
/** The skein: each rank beats this much of a beat after the one ahead of it. */
const SKEIN_RANK_LAG = 0.16;

/**
 * The flocks. Windows are [fade in from, fully in by, fade out from, gone by] in JOURNEY progress
 * (chapter 3 is 0.1427-0.2457, chapter 4 0.2457-0.3489). Positions are world units; `span` is a
 * bird's wingspan in world units (artistically large: a 1.4 m gull at 150 u is a 6 px speck).
 * Sited on the CPU height mirror against the real rail (see odyssey-flights.test.js).
 */
export const ODYSSEY_FLIGHTS = Object.freeze([
    Object.freeze({
        id: 'gulls',
        kind: FLIGHT_KIND.GULL,
        count: 12,
        // Two parties over the surf: one off the shore to the left of the rail (the coast the
        // L13-L14 shots turn to), one over the beach line the rail crosses at z ~ -215 (ahead of
        // L11-L12 and L15-L16).
        centre: Object.freeze([-238, 331, -176]),
        centreB: Object.freeze([28, 322, -204]),
        spread: Object.freeze([46, 26]), // each bird's own loop centre, +-x / +-z
        radius: Object.freeze([18, 38]),
        height: Object.freeze([-6, 18]),
        lapSeconds: Object.freeze([16, 27]),
        span: 4.6,
        window: Object.freeze([0.132, 0.142, 0.221, 0.234]),
    }),
    Object.freeze({
        id: 'swallows',
        kind: FLIGHT_KIND.SWALLOW,
        count: 12,
        // Two hunting parties at eye height beside the meadow stretch of the rail: one off its
        // right (seen from L16-L21), one off its left further on (L20-L24); never nearer the eye
        // than ~20 u.
        centre: Object.freeze([-104, 352, -318]),
        centreB: Object.freeze([-252, 374, -420]),
        spread: Object.freeze([20, 16]),
        radius: Object.freeze([9, 22]),
        height: Object.freeze([-7, 9]),
        lapSeconds: Object.freeze([5.5, 8.5]),
        span: 1.3,
        // Out only once neither party is in frame (p ~0.323 on the real camera; the shrink began
        // at 0.314 with a third of them still in view) — odyssey-act2-fade-out-of-view.test.js.
        window: Object.freeze([0.196, 0.206, 0.324, 0.334]),
    }),
    Object.freeze({
        id: 'geese',
        kind: FLIGHT_KIND.GOOSE,
        count: 9,
        // A straight crossing in front of the massif's face, west -> east, climbing gently.
        // 200 u farther north and 80 u higher than it first flew (2026-10-20): the old line
        // crossed the wall's rail (6 u at p 0.371), so the skein had to dissolve mid-sky before
        // the climb. Here it keeps 169 u off the rail and 45 u over the ground, stays in frame
        // from L15 up the wall to L27, and leaves the frame on the glide after L28 — where it
        // fades (odyssey-act2-fade-out-of-view.test.js).
        from: Object.freeze([-760, 535, -670]),
        to: Object.freeze([640, 585, -820]),
        period: 52, // seconds per crossing (the crossing itself is the first `travel` of it)
        travel: 0.78,
        phase: 0.36, // where in its period the skein is at clock 0 (mid-frame at the capture clock)
        spacing: 9,
        span: 6.6,
        window: Object.freeze([0.150, 0.160, 0.412, 0.426]),
    }),
]);

/** Deterministic lanes (no Math.random: the same flocks every session). */
export function resolveFlightLanes(flocks = ODYSSEY_FLIGHTS) {
    let state = 0x5f3759df;
    const rnd = () => {
        state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) >>> 0;
        state = (state + 0x6d2b79f5) >>> 0;
        return ((state ^ (state >>> 13)) >>> 0) / 4294967296;
    };
    const lanes = [];
    flocks.forEach((flock, flockIndex) => {
        for (let i = 0; i < flock.count; i += 1) {
            if (flock.kind === FLIGHT_KIND.GOOSE) {
                // A V: the leader at rank 0, then alternate sides, one rank further back each pair.
                const rank = Math.ceil(i / 2);
                let side = 0;
                if (i > 0) side = (i % 2 === 1) ? 1 : -1;
                lanes.push({
                    flock: flockIndex,
                    kind: flock.kind,
                    // centre = the formation slot (back, side), radius = rank, height jitter
                    cx: rank,
                    cy: (rnd() - 0.5) * 1.2,
                    cz: side,
                    radius: rank,
                    lap: flock.period,
                    phase: rnd(),
                    seed: rnd(),
                });
                continue;
            }
            const base = (flock.centreB && i % 2 === 1) ? flock.centreB : flock.centre;
            lanes.push({
                flock: flockIndex,
                kind: flock.kind,
                cx: base[0] + ((rnd() - 0.5) * 2 * flock.spread[0]),
                cy: base[1] + flock.height[0] + (rnd() * (flock.height[1] - flock.height[0])),
                cz: base[2] + ((rnd() - 0.5) * 2 * flock.spread[1]),
                radius: flock.radius[0] + (rnd() * (flock.radius[1] - flock.radius[0])),
                lap: (flock.lapSeconds[0] + (rnd() * (flock.lapSeconds[1] - flock.lapSeconds[0])))
                    * (rnd() < 0.5 ? -1 : 1),
                phase: rnd(),
                seed: rnd(),
            });
        }
    });
    return lanes;
}

/**
 * The swallows' eight: its cross-track phase kept within +-0.8 rad of the lemniscate's (it ran
 * 0..3 rad from the seed, and near pi/2 the path's horizontal speed fell to nothing twice a lap:
 * the bird pointed straight up and its heading spun round in a frame or two).
 */
const swallowSkew = (seed) => (seed - 0.5) * 1.6;

/**
 * CPU mirror of the vertex stage's `placeAt` (the bird's centre at clock `t`) — for the clearance
 * and framing tests and for siting. Keep in step with `placeAt` below.
 * @returns {{x:number,y:number,z:number,shown:boolean}}
 */
export function flightPositionAt(lane, t, flocks = ODYSSEY_FLIGHTS) {
    const flock = flocks[lane.flock];
    if (flock.kind === FLIGHT_KIND.GOOSE) {
        const cyc = ((((t / flock.period) + flock.phase) % 1) + 1) % 1;
        const s = cyc / flock.travel;
        const run = [0, 1, 2].map((k) => flock.to[k] - flock.from[k]);
        const flat = Math.hypot(run[0], run[2]) || 1;
        // back = -(flat run), side = (-flat.z, 0, flat.x): the shader's uGooseBack / uGooseSide.
        const back = [-run[0] / flat, 0, -run[2] / flat];
        const sideV = [-(run[2] / flat), 0, run[0] / flat];
        const sp = flock.spacing;
        const bob = Math.sin((t * 0.9) + (lane.seed * 7)) * 0.45;
        // The V breathes: each slot slides a little back and out and weaves, slowly, its own way.
        const backK = lane.cx * sp * (1 + (0.05 * Math.sin((t * 0.13) + (lane.seed * 5))));
        const sideK = (lane.cz * lane.cx * sp * 0.72 * (1 + (0.05 * Math.sin((t * 0.11) + (lane.seed * 3)))))
            + (Math.sin((t * 0.17) + (lane.seed * 4)) * 0.6 * Math.min(1, lane.cx));
        return {
            x: flock.from[0] + (run[0] * s) + (back[0] * backK) + (sideV[0] * sideK),
            y: flock.from[1] + (run[1] * s) + lane.cy + bob,
            z: flock.from[2] + (run[2] * s) + (back[2] * backK) + (sideV[2] * sideK),
            shown: cyc < flock.travel,
        };
    }
    const ang = ((t * TAU) / lane.lap) + (lane.phase * TAU);
    const r = lane.radius;
    if (flock.kind === FLIGHT_KIND.GULL) {
        const wob = (Math.sin((ang * 2) + (lane.seed * 17)) * 0.28) + 1;
        const dx = Math.sin((t * 0.031) + (lane.seed * 40)) * GULL_DRIFT;
        const dz = Math.cos((t * 0.027) + (lane.seed * 23)) * GULL_DRIFT;
        return {
            x: lane.cx + dx + (Math.cos(ang) * r * wob),
            y: lane.cy + (Math.sin((ang * 0.5) + (lane.seed * 9)) * 6),
            z: lane.cz + dz + (Math.sin(ang) * r * wob * 0.8),
            shown: true,
        };
    }
    return {
        x: lane.cx + (Math.sin(ang) * r),
        y: lane.cy + (Math.sin((ang * 2) + (lane.seed * 5)) * r * 0.32),
        z: lane.cz + (Math.sin((ang * 2) + swallowSkew(lane.seed)) * r * 0.62),
        shown: true,
    };
}

const sub3 = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z];
const norm3 = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
};
const cross3 = (a, b) => [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])];

/** The soft limit on a bank: linear for small turns, easing into `max` (C-infinity). */
export function softBank(raw, bankMax) {
    const q = raw / bankMax;
    return raw * ((1 + (q * q * q * q)) ** -0.25);
}

/**
 * CPU twin of the vertex stage's body frame: where the bird is, its heading (from the path a
 * moment either side), and its bank (from the turn a moment ahead, softly limited).
 * @returns {{position:number[], left:number[], up:number[], forward:number[], bank:number}}
 */
export function flightFrameAt(lane, t, flocks = ODYSSEY_FLIGHTS) {
    const style = FLIGHT_STYLE[lane.kind];
    const P = (tt) => flightPositionAt(lane, tt, flocks);
    const p0 = P(t);
    const vel = sub3(P(t + STENCIL), P(t - STENCIL));
    const fwd = norm3([vel[0] + 1e-4, vel[1], vel[2]]);
    const r0 = cross3(fwd, [0, 1, 0]);
    const right = norm3([r0[0], r0[1], r0[2] + 1e-5]);
    const up = cross3(right, fwd);
    const pl = P(t + BANK_LEAD);
    const pa = P(t + BANK_LEAD + STENCIL);
    const pb = P(t + BANK_LEAD - STENCIL);
    const k = STENCIL * STENCIL;
    const acc = [(pa.x + pb.x - (2 * pl.x)) / k, (pa.y + pb.y - (2 * pl.y)) / k, (pa.z + pb.z - (2 * pl.z)) / k];
    const raw = ((acc[0] * right[0]) + (acc[1] * right[1]) + (acc[2] * right[2])) * style.bankGain;
    const bank = softBank(raw, style.bankMax);
    const cb = Math.cos(bank);
    const sb = Math.sin(bank);
    return {
        position: [p0.x, p0.y, p0.z],
        left: [0, 1, 2].map((i) => -((right[i] * cb) - (up[i] * sb))),
        up: [0, 1, 2].map((i) => (up[i] * cb) + (right[i] * sb)),
        forward: fwd,
        bank,
    };
}

// -- the birds --------------------------------------------------------------------------------

/**
 * One kind's bird (odyssey-bird-rig.js `decodeBirdModel`), decoded once and shared.
 * @param {number} kind FLIGHT_KIND
 */
export function lowlandBirdModel(kind) {
    return decodeBirdModel(KIND_MODEL[kind]);
}

const bout = { weight: 0, phase: 0 };

/**
 * The beat a bird of `lane` is in at clock `t`: weight 0 glide .. 1 beating, and the phase (in
 * beats, 0 the top of the stroke). Gulls: bouts on a clock of their own; swallows: on the
 * straights of their eight; geese: always, as a wave down the V. The vertex stage's beat.
 * @returns {{weight:number, phase:number}}
 */
export function birdBeatOf(lane, t, out = { weight: 0, phase: 0 }) {
    const model = lowlandBirdModel(lane.kind);
    const { rate } = model.flight;
    if (lane.kind === FLIGHT_KIND.GULL) {
        birdBoutAt(t, lane.seed, { ...GULL_BOUTS, rate }, bout);
        out.weight = bout.weight;
        out.phase = bout.phase;
        return out;
    }
    if (lane.kind === FLIGHT_KIND.SWALLOW) {
        const ang = ((t * TAU) / lane.lap) + (lane.phase * TAU);
        const straight = smootherstep(SWALLOW_STRAIGHT[0], SWALLOW_STRAIGHT[1], Math.abs(Math.cos(ang)));
        const gate = smootherstep(SWALLOW_GATE[0], SWALLOW_GATE[1], Math.sin((t * SWALLOW_GATE[2]) + (lane.seed * 9)));
        out.weight = straight * gate;
        out.phase = (rate * (1 + ((lane.seed - 0.5) * 0.06)) * t) + (lane.seed * 7);
        return out;
    }
    out.weight = 1;
    out.phase = (rate * t) + (lane.seed * 0.04) - (lane.cx * SKEIN_RANK_LAG)
        + (0.03 * Math.sin((t * 0.23) + (lane.seed * 6.1)));
    return out;
}

/** How much of a beat the bird of `lane` is in at clock `t` (0 glide .. 1 beating). */
export function birdBeatWeightOf(lane, t) {
    return birdBeatOf(lane, t).weight;
}

/** The pose at beat phase `phi` (radians), blended with the glide by `weight` (odyssey-bird-rig.js). */
export function birdWingPoseAt(kind, phi, weight, out = {}) {
    return birdWingPoseOfModel(lowlandBirdModel(kind), phi, weight, out);
}

const flexScratch = { lift: 0, bend: 0 };
const beatScratch = { weight: 0, phase: 0 };

/**
 * The vertex stage's whole pose for the bird of `lane` at clock `t` (the CPU twin): the hinge
 * angles, the body's heave, and the tail's spread and twist from its bank.
 */
export function birdWingPoseOf(lane, t, out = {}, flocks = ODYSSEY_FLIGHTS) {
    const style = FLIGHT_STYLE[lane.kind];
    const model = lowlandBirdModel(lane.kind);
    const { weight, phase } = birdBeatOf(lane, t, beatScratch);
    const [fa, fb, fr] = style.flex;
    const w = (t * fr) + (lane.seed * 21);
    flexScratch.lift = fa * Math.sin(w);
    flexScratch.bend = -fb * Math.sin(w - 0.7);
    birdWingPoseOfModel(model, phase * TAU, weight, out, flexScratch);
    const { bank } = flightFrameAt(lane, t, flocks);
    out.tailSpread = style.tail[0] + (style.tail[1] * (Math.sqrt((bank * bank) + (TAIL_EASE * TAIL_EASE)) - TAIL_EASE));
    out.tailTwist = style.tail[2] * bank;
    out.weight = weight;
    return out;
}

export { foldBirdPoint };

/**
 * @param {object} [opts]
 * @param {object} [opts.hazeColour] TSL vec3 node the far birds haze toward (the world's horizon)
 * @param {object} [opts.sunColour] TSL vec3 node, the world's sun colour (else a daylight white)
 * @param {number[]} [opts.sunDir] direction TOWARD the sun (world); defaults to the Act II sun
 * @param {Array} [opts.flocks] override of ODYSSEY_FLIGHTS (tests, the playground)
 */
export function createOdysseyFlights({
    hazeColour = null, sunColour = null, sunDir = [-0.46, 0.36, 0.61], flocks = ODYSSEY_FLIGHTS,
} = {}) {
    const lanes = resolveFlightLanes(flocks);
    const models = [0, 1, 2].map((k) => lowlandBirdModel(k));

    const uTime = uniform(0);
    // Per flock: x = reveal (scale), y = kind, z = drawn size (world units per model metre), w = spare.
    const flockRows = flocks.map((f) => new THREE.Vector4(0, f.kind, f.span / models[f.kind].span, 0));
    const uFlocks = uniformArray(flockRows, 'vec4');
    // The keyframed beats, per kind and channel: three vec4s of Fourier coefficients each.
    const beatRows = [];
    models.forEach((m) => BIRD_BEAT_CHANNELS.forEach((ch) => {
        packBeatSeries(m.flight.cycle[ch]).forEach((v) => beatRows.push(new THREE.Vector4(...v)));
    }));
    const uBeats = uniformArray(beatRows, 'vec4');
    // The skein's line (only one goose flock is supported): from, direction*length, timing.
    const goose = flocks.find((f) => f.kind === FLIGHT_KIND.GOOSE) || null;
    const gooseFrom = goose ? new THREE.Vector3(...goose.from) : new THREE.Vector3();
    const gooseTo = goose ? new THREE.Vector3(...goose.to) : new THREE.Vector3(1, 0, 0);
    const gooseRun = gooseTo.clone().sub(gooseFrom);
    const uGooseFrom = uniform(gooseFrom);
    const uGooseRun = uniform(gooseRun);
    const gooseFlat = new THREE.Vector3(gooseRun.x, 0, gooseRun.z).normalize();
    const uGooseSide = uniform(new THREE.Vector3(-gooseFlat.z, 0, gooseFlat.x));
    const uGooseBack = uniform(gooseFlat.clone().negate());

    const aSeat = attribute('aSeat', 'vec4');
    const aMotion = attribute('aMotion', 'vec4');
    const aHinge = attribute('aHinge', 'vec4');
    const aTop = attribute('aTop', 'vec4');
    const aNormal = attribute('normal', 'vec3');
    const flockRow = uFlocks.element(aMotion.w.add(0.5).toInt());
    const reveal = flockRow.x;
    const kind = flockRow.y;
    const drawScale = flockRow.z;
    const isGull = float(1).sub(clamp(abs(kind.sub(FLIGHT_KIND.GULL)), 0, 1));
    const isSwallow = float(1).sub(clamp(abs(kind.sub(FLIGHT_KIND.SWALLOW)), 0, 1));
    const isGoose = float(1).sub(clamp(abs(kind.sub(FLIGHT_KIND.GOOSE)), 0, 1));
    const seed = aMotion.z;
    /** A per-kind constant: gull, swallow, goose. */
    const perKind = (values) => float(values[0]).mul(isGull)
        .add(float(values[1]).mul(isSwallow)).add(float(values[2]).mul(isGoose));
    const perKind3 = (values) => vec3(...[0, 1, 2].map((c) => perKind(values.map((v) => v[c]))));
    const flight = models.map((m) => m.flight);
    const fl = (pick) => perKind(flight.map(pick));
    const st = (pick) => perKind(FLIGHT_STYLE.map(pick));

    /**
     * Where the bird is at clock `t` (world). Gulls: a loop whose radius breathes and whose centre
     * drifts slowly (wandering rounds, not a carousel). Swallows: a fast figure-of-eight with a
     * vertical swoop. Geese: their slot in the V along the skein's line, breathing.
     */
    const placeAt = (t) => {
        const lap = aMotion.x;
        const ang = t.mul(TAU).div(lap).add(aMotion.y.mul(TAU));
        const r = aSeat.w;
        // GULL
        const wob = sin(ang.mul(2.0).add(seed.mul(17.0))).mul(0.28).add(1.0);
        const drift = vec3(sin(t.mul(0.031).add(seed.mul(40.0))), 0, cos(t.mul(0.027).add(seed.mul(23.0))))
            .mul(GULL_DRIFT);
        const gull = aSeat.xyz.add(drift)
            .add(vec3(
                cos(ang).mul(r).mul(wob),
                sin(ang.mul(0.5).add(seed.mul(9.0))).mul(6.0),
                sin(ang).mul(r).mul(wob.mul(0.8)),
            ));
        // SWALLOW (the skew kept within +-0.8 rad: see swallowSkew)
        const swal = aSeat.xyz.add(vec3(
            sin(ang).mul(r),
            sin(ang.mul(2.0).add(seed.mul(5.0))).mul(r.mul(0.32)),
            sin(ang.mul(2.0).add(seed.sub(0.5).mul(1.6))).mul(r.mul(0.62)),
        ));
        // GOOSE: s runs 0..1 across `travel` of the period; the V trails behind the leader.
        const period = float(goose ? goose.period : 1);
        const cyc = fract(t.div(period).add(goose ? goose.phase : 0));
        const s = cyc.div(goose ? goose.travel : 1);
        const spacing = float(goose ? goose.spacing : 1);
        const backK = aSeat.x.mul(spacing).mul(sin(t.mul(0.13).add(seed.mul(5.0))).mul(0.05).add(1.0));
        const breathe = sin(t.mul(0.11).add(seed.mul(3.0))).mul(0.05).add(1.0);
        const sideK = aSeat.z.mul(aSeat.x).mul(spacing).mul(0.72).mul(breathe)
            .add(sin(t.mul(0.17).add(seed.mul(4.0))).mul(0.6).mul(clamp(aSeat.x, 0.0, 1.0)));
        const gooseP = uGooseFrom.add(uGooseRun.mul(s))
            .add(uGooseBack.mul(backK))
            .add(uGooseSide.mul(sideK))
            .add(vec3(0, aSeat.y.add(sin(t.mul(0.9).add(seed.mul(7.0))).mul(0.45)), 0));
        return gull.mul(isGull).add(swal.mul(isSwallow)).add(gooseP.mul(isGoose));
    };

    // The bird's normal (world) and the light it stands in, for the fragment stage.
    const vBirdN = varying(vec3(0, 1, 0), 'birdN');
    const vBounce = varying(vec3(0.2, 0.25, 0.2), 'birdBounce');
    // How far a bird has shrunk toward a speck (0 near .. 1 under ~6 px across at 1440p), and how
    // much of its plumage that speck keeps.
    const vSpeck = varying(vec3(0, 0, 0), 'birdSpeck');
    const positionNode = Fn(() => {
        const t = uTime;
        const dt = float(STENCIL);
        const p0 = placeAt(t).toVar();
        const p1 = placeAt(t.add(dt)).toVar();
        const pm = placeAt(t.sub(dt)).toVar();
        const vel = p1.sub(pm);
        const fwd = normalize(vel.add(vec3(1e-4, 0, 0))).toVar();
        const up0 = vec3(0, 1, 0);
        const right = normalize(cross(fwd, up0).add(vec3(0, 0, 1e-5))).toVar();
        const up = cross(right, fwd).toVar();
        // Bank into the turn from the lateral acceleration (u/s^2 from the second difference) a
        // moment AHEAD (a bird rolls into a turn as it starts it), softly limited (no corner where
        // it saturates); a right turn dips the right wing. Steep on purpose: a level bird seen
        // from near its own height is a one-pixel line, a banked one shows its whole planform.
        const tl = t.add(BANK_LEAD);
        const pl = placeAt(tl).toVar();
        const acc = placeAt(tl.add(dt)).add(placeAt(tl.sub(dt))).sub(pl.mul(2.0)).div(dt.mul(dt));
        const raw = dot(acc, right).mul(st((s) => s.bankGain)).toVar();
        const q = raw.div(st((s) => s.bankMax));
        const q2 = q.mul(q);
        const bank = raw.mul(pow(q2.mul(q2).add(1.0), -0.25)).toVar();
        const cb = cos(bank);
        const sb = sin(bank);
        const leftB = right.mul(cb).sub(up.mul(sb)).negate().toVar();
        const upB = up.mul(cb).add(right.mul(sb)).toVar();

        // THE BEAT (the twin: birdBeatOf / birdWingPoseOf): gulls in bouts that start and end at
        // mid-upstroke, swallows on the straights of their eight, geese always, as a wave down
        // the V.
        const gullBout = birdBoutNode(t, seed, { ...GULL_BOUTS, rate: flight[0].rate });
        const lap = aMotion.x;
        const ang = t.mul(TAU).div(lap).add(aMotion.y.mul(TAU));
        const swallowWeight = smootherstepNode(SWALLOW_STRAIGHT[0], SWALLOW_STRAIGHT[1], abs(cos(ang)))
            .mul(smootherstepNode(SWALLOW_GATE[0], SWALLOW_GATE[1], sin(t.mul(SWALLOW_GATE[2]).add(seed.mul(9.0)))));
        const beatWeight = gullBout.weight.mul(isGull).add(swallowWeight.mul(isSwallow)).add(isGoose).toVar();
        const swallowPhase = seed.sub(0.5).mul(0.06).add(1.0).mul(flight[1].rate)
            .mul(t)
            .add(seed.mul(7.0));
        const goosePhase = t.mul(flight[2].rate).add(seed.mul(0.04)).sub(aSeat.x.mul(SKEIN_RANK_LAG))
            .add(sin(t.mul(0.23).add(seed.mul(6.1))).mul(0.03));
        const phase = gullBout.phase.mul(isGull).add(swallowPhase.mul(isSwallow)).add(goosePhase.mul(isGoose));
        const phi = fract(phase).mul(TAU).toVar();
        const h = beatHarmonicsNode(phi);
        // Row of a channel's series: (kind * channels + channel) * 3 (+ 0.5, then to int).
        const series = (ch) => {
            const at = kind.mul(BIRD_BEAT_CHANNELS.length * 3).add((BIRD_BEAT_CHANNELS.indexOf(ch) * 3) + 0.5);
            return beatSeriesNode([0, 1, 2].map((j) => uBeats.element(at.add(j).toInt())), h);
        };
        // The held wing flexes softly on the air between beats (gulls most).
        const flexW = t.mul(st((s) => s.flex[2])).add(seed.mul(21.0));
        const held = (name) => {
            const base = fl((f) => f.glide[name]);
            if (name === 'lift') return base.add(sin(flexW).mul(st((s) => s.flex[0])));
            if (name === 'bend') return base.sub(sin(flexW.sub(0.7)).mul(st((s) => s.flex[1])));
            return base;
        };
        const pose = (name) => mix(held(name), series(name), beatWeight);
        const lift = pose('lift').toVar();
        const sweep = pose('sweep').toVar();
        const bend = pose('bend').toVar();
        const foldA = pose('fold').toVar();
        const curl = pose('curl').toVar();
        const heave = series('heave').mul(beatWeight).toVar();

        // THE TAIL fans and twists into the turn (the twin: tailBirdPoint), then THE FOLD
        // (odyssey-bird-rig.js; the twin: foldBirdPoint): about the wrist (the hand swung back,
        // then raised or lowered with the tip's curl), then about the shoulder (the arm swept,
        // then lifted); the normal turns with it.
        const spread = st((s) => s.tail[0])
            .add(st((s) => s.tail[1]).mul(bank.mul(bank).add(TAIL_EASE * TAIL_EASE).sqrt().sub(TAIL_EASE)));
        const twist = st((s) => s.tail[2]).mul(bank);
        const tailed = tailBirdNode({
            position: positionLocal,
            normal: aNormal,
            tail: aTop.w,
            spread,
            twist,
            tailY: perKind(models.map((m) => m.tailY)),
        });
        const { local, normal } = foldBirdNode({
            position: tailed.position,
            normal: tailed.normal,
            hinge: aHinge,
            pose: {
                lift, sweep, bend, fold: foldA, curl,
            },
            shoulder: perKind3(models.map((m) => m.shoulder)),
            wrist: perKind3(models.map((m) => m.wrist)),
        });
        vBirdN.assign(leftB.mul(normal.x).add(upB.mul(normal.y)).add(fwd.mul(normal.z)));
        // What lies under it, bounced up into the shaded underside: sea and sand under the gulls,
        // the meadows under the swallows, the lowland under the skein.
        vBounce.assign(perKind3([[0.30, 0.31, 0.28], [0.20, 0.26, 0.13], [0.22, 0.24, 0.17]]));

        // Skein birds only exist while the V is crossing; the rest of the period it is gone.
        const goosePeriodK = goose ? fract(t.div(goose.period).add(goose.phase)) : float(0);
        const gooseShown = goose
            ? smoothstep(0.0, 0.04, goosePeriodK)
                .mul(float(1).sub(smoothstep(goose.travel - 0.04, goose.travel, goosePeriodK)))
            : float(0);
        const shown = mix(float(1), gooseShown, isGoose);
        const size = drawScale.mul(reveal).mul(shown);
        // A FAR bird reads as a speck only while it is darker than the air behind it: lit pale
        // plumage (a goose's sunlit flank and belly, its pale underwing) is the sky's own value at
        // ten pixels, and the skein vanished where the old dark cut-outs had read. Under ~14 px
        // across (its angular span at 60 degrees and 1440p) a goose darkens toward its silhouette
        // and every bird loses its rim of sky; near birds keep their full plumage.
        const across = drawScale.mul(perKind(models.map((m) => m.span)))
            .div(max(length(p0.sub(cameraPosition)), 1.0));
        const far = float(1).sub(smoothstep(0.0048, 0.0112, across));
        vSpeck.assign(vec3(far, far.mul(perKind([0.15, 0.2, 0.55])), 0));
        // The body rides up and down against the beat (heave, in the bird's own up).
        const offset = leftB.mul(local.x).add(upB.mul(local.y.add(heave))).add(fwd.mul(local.z)).mul(size);
        return p0.add(offset);
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OdysseyFlights';
    material.positionNode = positionNode;
    // The act's light: the sun from behind the camera's shoulder on the backs and the near wings,
    // the sky from above, what lies below bounced up under the wings, a rim of sky on the edges
    // so a far bird keeps its shape, and the air between it and the eye. The plumage is the one
    // the eye sees: a wing or a tail shows its upperside on its front face and its underside on
    // its back face (the gull's white underwing, the swallow's buff, the goose's grey).
    const sunCol = sunColour ?? vec3(1.0, 0.96, 0.88);
    const sunD = new THREE.Vector3(...sunDir).normalize().toArray();
    const haze = hazeColour ?? vec3(0.71, 0.81, 0.91);
    material.colorNode = birdColourNode({
        normal: vBirdN,
        speck: vSpeck,
        bounce: vBounce,
        sunColour: sunCol,
        sunDir: sunD,
        haze,
        hazeRange: [180, 1400, 0.6],
    });
    material.side = THREE.DoubleSide;
    material.depthWrite = true;
    // It carries its own colour-with-distance; scene fog is the chapter-profile lerp.
    material.fog = false;

    const group = new THREE.Group();
    group.name = 'odyssey-flights';
    group.visible = false;
    // One instanced draw per flock, every one of the same layout (so one shader, one pipeline):
    // the flock's bird as the template, its lanes as the instances.
    const meshes = flocks.map((flock, flockIndex) => {
        const model = models[flock.kind];
        const geometry = new THREE.InstancedBufferGeometry();
        setBirdTemplate(geometry, model, THREE.BufferAttribute);
        const own = lanes.filter((l) => l.flock === flockIndex);
        // Two per-instance vec4s: (centre xyz, radius) and (lap seconds, phase, seed, flock index).
        const seat = new Float32Array(Math.max(1, own.length) * 4);
        const motion = new Float32Array(Math.max(1, own.length) * 4);
        own.forEach((l, i) => {
            seat.set([l.cx, l.cy, l.cz, l.radius], i * 4);
            motion.set([l.lap, l.phase, l.seed, l.flock], i * 4);
        });
        geometry.setAttribute('aSeat', new THREE.InstancedBufferAttribute(seat, 4));
        geometry.setAttribute('aMotion', new THREE.InstancedBufferAttribute(motion, 4));
        geometry.instanceCount = own.length;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `odyssey-flights-${flock.id}`;
        mesh.frustumCulled = false;
        mesh.visible = false;
        group.add(mesh);
        return mesh;
    });

    const windowWeight = (w, p) => THREE.MathUtils.smoothstep(p, w[0], w[1])
        * (1 - THREE.MathUtils.smoothstep(p, w[2], w[3]));

    return {
        group,
        meshes,
        material,
        lanes,
        uniforms: { uTime, uFlocks, uBeats },
        /** Reveal per flock at journey progress `p` (0..1 each). */
        revealAt(p) {
            return flocks.map((f) => windowWeight(f.window, p));
        },
        /**
         * @param {number} time seconds (the board clock)
         * @param {number} progress journey progress 0..1
         */
        update(time, progress) {
            let any = false;
            flocks.forEach((f, i) => {
                const r = windowWeight(f.window, progress);
                flockRows[i].x = r;
                meshes[i].visible = r > 0.01;
                if (r > 0.01) any = true;
            });
            uTime.value = time;
            group.visible = any;
        },
        dispose() {
            meshes.forEach((m) => m.geometry.dispose());
            material.dispose();
            group.removeFromParent();
        },
    };
}
