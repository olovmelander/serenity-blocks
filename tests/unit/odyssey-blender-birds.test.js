/**
 * THE BLENDER BIRDS (2026-11, docs/ODYSSEY_BLENDER_BIRDS_2026-11.md): the herring gull, barn
 * swallow, greylag goose and griffon vulture the Blender script (scripts/blender/odyssey/
 * odyssey_birds.py) writes into odyssey-bird-models.js (and their keyframed wingbeats into
 * odyssey-bird-beats.js), folded by odyssey-bird-rig.js, and what draws them: the lowland flights
 * (odyssey-flights.js) and the summit kettle (odyssey-summit-birds.js).
 *
 *  - THE MODELS: sizes and triangle budgets for the pixels they cover, shells facing out and
 *    sheets facing up, hinge weights where the joints are, the plumage each species is named by.
 *  - THE WINGBEAT: the CPU twin of the vertex stage (birdWingPoseOf + tailBirdPoint +
 *    foldBirdPoint) over every pose a bird flies: no edge torn or crushed, no wing turned inside
 *    out, the hand lagging the arm, each kind's rhythm (gull glides, swallow bursts, goose steady).
 *  - NATURAL FLIGHT (2026-11-03): no corner in any motion (the acceleration the same sampled at
 *    240 and 960 Hz), a quick downstroke, a wingtip loop, the body rising against the beat, bouts
 *    that start and end at mid-upstroke, a swallow that never points straight up, a soft bank,
 *    a skein that beats as a wave and breathes, vultures that soar, and an eagle without kinks.
 *  - THE DRAW: one material shared by the three flocks' draws, inside WebGPU's vertex-buffer limit;
 *    it and the kettle's built for WebGPU (WGSL) and the WebGL2 fallback (GLSL) without a word.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';
import {
    FAR_SPECK, FLIGHT_KIND, FLIGHT_STYLE, ODYSSEY_FLIGHTS, birdBeatOf, birdBeatWeightOf, birdWingPoseAt, birdWingPoseOf,
    createOdysseyFlights, flightFrameAt, flightPositionAt, foldBirdPoint, lowlandBirdModel, resolveFlightLanes,
} from '../../src/rendering/odyssey/composition/odyssey-flights.js';
import { ODYSSEY_BIRD_MODELS } from '../../src/rendering/odyssey/composition/odyssey-bird-models.js';
import { ODYSSEY_BIRD_BEATS } from '../../src/rendering/odyssey/composition/odyssey-bird-beats.js';
import {
    beatSeriesAt, birdWingPoseAt as rigPoseAt, decodeBirdModel, tailBirdPoint,
} from '../../src/rendering/odyssey/composition/odyssey-bird-rig.js';
import {
    SUMMIT_BIRDS, createSummitBirds, summitBeatWeight, summitFrameAt, summitWingPose,
} from '../../src/rendering/odyssey/composition/odyssey-summit-birds.js';
import {
    createEaglePose, eagleBout, eagleFlight, EAGLE_BOUTS, EAGLE_BEAT, ODYSSEY_EAGLE,
} from '../../src/rendering/odyssey/composition/odyssey-eagle-flight.js';

vi.setConfig({ testTimeout: 60_000 });
afterEach(() => { vi.restoreAllMocks(); });

const TAU = Math.PI * 2;
const KINDS = [
    ['gull', FLIGHT_KIND.GULL, 1.40],
    ['swallow', FLIGHT_KIND.SWALLOW, 0.33],
    ['goose', FLIGHT_KIND.GOOSE, 1.60],
];
/** Every Blender bird: the lowland kinds and the summit kettle's vulture (no flight kind). */
const BIRDS = [...KINDS, ['vulture', null, 2.60]];
const HINGES = ['lift', 'sweep', 'bend', 'fold', 'curl'];
const luminance = (c) => (0.2126 * c[0]) + (0.7152 * c[1]) + (0.0722 * c[2]);
const vec = (a, i) => [a[i * 3], a[(i * 3) + 1], a[(i * 3) + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])];
const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
const lanesOf = (kind) => resolveFlightLanes().filter((l) => l.kind === kind);

/** The vertex nearest `target` (bird frame). */
function nearest(model, target) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < model.vertexCount; i += 1) {
        const d = Math.hypot(...sub(vec(model.positions, i), target));
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

/** Every pose a bird flies in `seconds` of clock, for a few birds (the vulture: the kettle's). */
function posesFlown(kind, seconds = 12, step = 1 / 30) {
    const out = [];
    if (kind === null) {
        [0.07, 0.31, 0.58, 0.93].forEach((seed) => {
            for (let t = 0; t < seconds; t += step) out.push(summitWingPose(t, seed));
        });
        // ... and a bout of beats in each (they are rare).
        [0.07, 0.31].forEach((seed) => {
            let t = 0;
            while (summitBeatWeight(t, seed) < 0.5 && t < 400) t += 0.25;
            for (let k = -2; k < 3; k += step) out.push(summitWingPose(t + k, seed));
        });
        return out;
    }
    lanesOf(kind).slice(0, 4).forEach((lane) => {
        for (let t = 0; t < seconds; t += step) out.push(birdWingPoseOf(lane, t));
    });
    return out;
}

/** Worst acceleration of `f` over [t0, t0 + T] sampled every h seconds (central differences). */
function worstAcc(f, t0, T, h) {
    let worst = 0;
    let a = f(t0 - h);
    let b = f(t0);
    for (let t = t0 + h; t < t0 + T; t += h) {
        const c = f(t);
        worst = Math.max(worst, Math.abs((a - (2 * b) + c) / (h * h)));
        a = b;
        b = c;
    }
    return worst;
}
/** A motion with a corner (a velocity jump) shows ~4x the acceleration at 960 Hz as at 240. */
const cornerRatio = (f, t0, T) => {
    const coarse = worstAcc(f, t0, T, 1 / 240);
    // (a channel that hardly moves, such as a goose's bank on its straight line, is noise)
    return coarse < 1e-3 ? 1 : worstAcc(f, t0, T, 1 / 960) / coarse;
};

describe('the Blender birds (models)', () => {
    BIRDS.forEach(([name, , span]) => {
        it(`models the ${name} at its real size in a few hundred triangles`, () => {
            const m = decodeBirdModel(name);
            expect(m.name).toBe(name);
            expect(m.span).toBeCloseTo(span, 1);
            expect(m.triangleCount).toBeGreaterThanOrEqual(100);
            expect(m.triangleCount).toBeLessThanOrEqual(400);
            expect(m.index.length).toBe(m.triangleCount * 3);
            expect(m.positions.length).toBe(m.vertexCount * 3);
            ['normals', 'top', 'under'].forEach((k) => expect(m[k].length, k).toBe(m.vertexCount * 3));
            expect(m.hinge.length).toBe(m.vertexCount * 4);
            expect(m.topTail.length).toBe(m.vertexCount * 4);
            expect(m.tail.length).toBe(m.vertexCount);
            expect(Math.max(...m.index)).toBeLessThan(m.vertexCount);
            // Decoded once and shared.
            expect(decodeBirdModel(name)).toBe(m);
        });

        it(`faces the ${name}'s body out and its wings up, with unit normals`, () => {
            const m = decodeBirdModel(name);
            let wingUp = 0;
            let wingCount = 0;
            for (let i = 0; i < m.vertexCount; i += 1) {
                const n = vec(m.normals, i);
                expect(Math.hypot(...n)).toBeCloseTo(1, 3);
                if (m.hinge[i * 4] > 0.5) { wingUp += n[1]; wingCount += 1; }
            }
            expect(wingUp / wingCount).toBeGreaterThan(0.8);
            // The face winding agrees with the normals (three's front faces are counter-clockwise).
            let agree = 0;
            for (let t = 0; t < m.triangleCount; t += 1) {
                const [a, b, c] = [m.index[t * 3], m.index[(t * 3) + 1], m.index[(t * 3) + 2]];
                const pa = vec(m.positions, a);
                const face = cross(sub(vec(m.positions, b), pa), sub(vec(m.positions, c), pa));
                const avg = [0, 1, 2].map((k) => m.normals[(a * 3) + k] + m.normals[(b * 3) + k]
                    + m.normals[(c * 3) + k]);
                if (dot(face, avg) > 0) agree += 1;
            }
            expect(agree / m.triangleCount).toBeGreaterThan(0.97);
        });

        it(`weights the ${name}'s wings at the shoulder, the wrist and the tip, and its tail alone`, () => {
            const m = decodeBirdModel(name);
            for (let i = 0; i < m.vertexCount; i += 1) {
                const [x, , z] = vec(m.positions, i);
                const [arm, hand, tip, thin] = [0, 1, 2, 3].map((k) => m.hinge[(i * 4) + k]);
                [arm, hand, tip, thin, m.tail[i]].forEach((w) => {
                    expect(w).toBeGreaterThanOrEqual(0);
                    expect(w).toBeLessThanOrEqual(1);
                });
                // The hand moves only what the arm moves; the tip only what the hand moves.
                expect(hand).toBeLessThanOrEqual(arm + 1e-6);
                expect(tip).toBeLessThanOrEqual(hand + 1e-6);
                // Inside the shoulder nothing folds.
                if (Math.abs(x) < m.shoulder[0] * 0.8) expect(arm).toBe(0);
                // The tail's weight is the tail's only: behind the body, on no wing.
                if (m.tail[i] > 0) {
                    expect(arm).toBe(0);
                    expect(z).toBeLessThan(0);
                }
            }
            // The wingtips are carried all the way; the tail's tip is carried, its root is not.
            const tipL = nearest(m, [m.span / 2, m.wrist[1], -m.length]);
            expect(m.hinge[tipL * 4]).toBeCloseTo(1, 2);
            expect(m.hinge[(tipL * 4) + 1]).toBeCloseTo(1, 2);
            expect(Math.max(...m.tail)).toBeGreaterThan(0.95);
        });
    });

    it('paints the plumage each bird is named by', () => {
        const gull = lowlandBirdModel(FLIGHT_KIND.GULL);
        const swallow = lowlandBirdModel(FLIGHT_KIND.SWALLOW);
        const goose = lowlandBirdModel(FLIGHT_KIND.GOOSE);
        // Gull: a white body, a grey mantle above, black wingtips; white under the arm.
        const gullBelly = nearest(gull, [0, -0.05, 0.0]);
        const gullTip = nearest(gull, [0.68, 0.03, -0.075]);
        const gullArm = nearest(gull, [0.2, 0.03, 0.0]);
        expect(luminance(vec(gull.top, gullBelly))).toBeGreaterThan(0.6);
        expect(luminance(vec(gull.top, gullTip))).toBeLessThan(0.05);
        expect(luminance(vec(gull.top, gullArm))).toBeLessThan(luminance(vec(gull.under, gullArm)));
        expect(luminance(vec(gull.under, gullArm))).toBeGreaterThan(0.6);
        // Swallow: a blue-black back, a pale belly, a rust throat.
        const back = vec(swallow.top, nearest(swallow, [0, 0.013, 0.0]));
        const belly = vec(swallow.top, nearest(swallow, [0, -0.014, -0.01]));
        const throat = vec(swallow.top, nearest(swallow, [0, -0.008, 0.036]));
        expect(luminance(back)).toBeLessThan(0.04);
        expect(back[2]).toBeGreaterThan(back[0]);
        expect(luminance(belly)).toBeGreaterThan(0.6);
        expect(throat[0]).toBeGreaterThan(throat[1] * 2);
        // Vulture: sandy coverts over blackish flight feathers, a pale head.
        const vulture = decodeBirdModel('vulture');
        const covert = vec(vulture.top, nearest(vulture, [0.3, 0.01, 0.15]));
        const flightV = vec(vulture.top, nearest(vulture, [0.3, 0.01, -0.42]));
        expect(luminance(covert)).toBeGreaterThan(luminance(flightV) * 4);
        expect(luminance(vec(vulture.top, nearest(vulture, [0, 0.07, 0.36])))).toBeGreaterThan(luminance(covert));
        // Goose: grey-brown, an orange bill, a pale forewing over dark flight feathers.
        const bill = vec(goose.top, nearest(goose, [0, -0.015, 0.47]));
        expect(bill[0]).toBeGreaterThan(bill[2] * 3);
        const fore = vec(goose.top, nearest(goose, [0.2, 0.04, 0.11]));
        const flightF = vec(goose.top, nearest(goose, [0.2, 0.04, -0.19]));
        expect(luminance(fore)).toBeGreaterThan(luminance(flightF) * 2);
    });

    it('writes the modules the script measured (the record it carries matches the arrays)', () => {
        BIRDS.forEach(([name]) => {
            const src = ODYSSEY_BIRD_MODELS[name];
            const m = decodeBirdModel(name);
            expect(src.vertexCount).toBe(m.vertexCount);
            expect(src.stretch[0]).toBeLessThan(1.4);
            // The keyframed beat: a short series per channel that Blender's curve fits closely.
            const beat = ODYSSEY_BIRD_BEATS[name];
            expect(beat.cycle.lift.length).toBe((2 * ODYSSEY_BIRD_BEATS.harmonics) + 1);
            Object.values(beat.fit).forEach((e) => expect(e).toBeLessThan(0.01));
        });
        Object.values(ODYSSEY_BIRD_BEATS.eagle.fit).forEach((e) => expect(e).toBeLessThan(0.01));
    });
});

describe('the Blender birds\' wingbeat (CPU twin of the vertex stage)', () => {
    it('holds a rest pose at zero angles', () => {
        const m = lowlandBirdModel(FLIGHT_KIND.GULL);
        const zero = {
            lift: 0, sweep: 0, bend: 0, fold: 0, curl: 0,
        };
        for (let i = 0; i < m.vertexCount; i += 7) {
            const p = vec(m.positions, i);
            const w = [0, 1, 2].map((k) => m.hinge[(i * 4) + k]);
            foldBirdPoint(m, p, w, zero).forEach((v, k) => expect(v).toBeCloseTo(p[k], 6));
        }
    });

    BIRDS.forEach(([name, kind]) => {
        it(`never tears, crushes or turns over the ${name}'s skin in any pose it flies`, () => {
            const m = decodeBirdModel(name);
            const rest = [];
            const w = [];
            for (let i = 0; i < m.vertexCount; i += 1) {
                rest.push(vec(m.positions, i));
                w.push([0, 1, 2].map((k) => m.hinge[(i * 4) + k]));
            }
            const edges = new Map();
            for (let t = 0; t < m.triangleCount; t += 1) {
                for (let e = 0; e < 3; e += 1) {
                    const a = m.index[(t * 3) + e];
                    const b = m.index[(t * 3) + ((e + 1) % 3)];
                    const key = a < b ? `${a},${b}` : `${b},${a}`;
                    if (!edges.has(key)) edges.set(key, [a, b, Math.hypot(...sub(rest[a], rest[b]))]);
                }
            }
            let stretch = 1;
            let squash = 1;
            let turned = 0;
            const poses = posesFlown(kind, 6, 1 / 20);
            poses.forEach((pose) => {
                const at = (p, i) => tailBirdPoint(m, p, m.tail[i], pose.tailSpread, pose.tailTwist);
                const moved = rest.map((p, i) => foldBirdPoint(m, at(p, i), w[i], pose));
                const normals = rest.map((p, i) => foldBirdPoint(m, vec(m.normals, i), w[i], pose, true));
                edges.forEach(([a, b, r0]) => {
                    if (r0 < 1e-5) return;
                    const r = Math.hypot(...sub(moved[a], moved[b])) / r0;
                    stretch = Math.max(stretch, r);
                    squash = Math.min(squash, r);
                });
                for (let t = 0; t < m.triangleCount; t += 1) {
                    const [a, b, c] = [m.index[t * 3], m.index[(t * 3) + 1], m.index[(t * 3) + 2]];
                    const face = cross(sub(moved[b], moved[a]), sub(moved[c], moved[a]));
                    const avg = [0, 1, 2].map((k) => normals[a][k] + normals[b][k] + normals[c][k]);
                    // A face that turns against its own (turned) normals shows its other side.
                    if (Math.hypot(...face) > 1e-9 && dot(face, avg) < 0) turned += 1;
                }
            });
            // The skin bends, stretched or bunched: the trailing edge folds in behind the wrist on
            // the upstroke (the hinge bands widen toward it so it bunches gently instead of
            // crumpling), and the tail's fan opens (its feathers slide apart). The swallow's swept
            // glide tucks its short arm's trailing edge in by the body for good — a shape it
            // holds, not a crease that flickers with the beat.
            expect(stretch, `${name} stretch`).toBeLessThan(1.4);
            expect(squash, `${name} squash`).toBeGreaterThan(kind === FLIGHT_KIND.SWALLOW ? 0.18 : 0.45);
            expect(turned / (poses.length * m.triangleCount), `${name} turned faces`).toBeLessThan(0.002);
        });

        it(`lags the ${name}'s hand behind its arm over a beat`, () => {
            const m = decodeBirdModel(name);
            // The hand's own elevation peaks after the arm's, and bottoms out after it.
            let armTop = 0;
            let handTop = 0;
            let armLow = 0;
            let handLow = 0;
            const best = [-Infinity, -Infinity, Infinity, Infinity];
            for (let k = 0; k < 360; k += 1) {
                const phi = ((k - 60) / 360) * TAU; // from just before the top
                const p = rigPoseAt(m, phi, 1);
                if (p.lift > best[0]) { best[0] = p.lift; armTop = k; }
                if (p.lift + p.bend > best[1]) { best[1] = p.lift + p.bend; handTop = k; }
                if (p.lift < best[2]) { best[2] = p.lift; armLow = k; }
                if (p.lift + p.bend < best[3]) { best[3] = p.lift + p.bend; handLow = k; }
            }
            expect(handTop).toBeGreaterThan(armTop);
            expect(handLow).toBeGreaterThan(armLow);
        });
    });

    it('soars the summit vultures on held wings, the fingers curled up, a slow beat once a minute or so', () => {
        let beating = 0;
        let n = 0;
        let bouts = 0;
        [0.2, 0.5, 0.8].forEach((seed) => {
            let was = 0;
            for (let t = 0; t < 600; t += 0.25) {
                const w = summitBeatWeight(t, seed);
                if (w > 0.05) beating += 1;
                if (was < 0.5 && w >= 0.5) bouts += 1;
                was = w;
                n += 1;
            }
        });
        // Griffons in a thermal almost never beat: a few percent of the time, a bout a minute or so.
        expect(beating / n).toBeGreaterThan(0.005);
        expect(beating / n).toBeLessThan(0.06);
        expect(bouts / 3).toBeGreaterThan(5);
        expect(bouts / 3).toBeLessThan(13);
        const v = decodeBirdModel('vulture').flight;
        expect(v.glide.curl).toBeGreaterThan(0.1);
        expect(v.rate).toBeLessThan(2);
    });

    it('flies each kind its own way: gulls glide, swallows burst, geese beat steadily', () => {
        const share = (kind) => {
            let beating = 0;
            let n = 0;
            lanesOf(kind).slice(0, 6).forEach((lane) => {
                for (let t = 0; t < 120; t += 0.25) { beating += birdBeatWeightOf(lane, t); n += 1; }
            });
            return beating / n;
        };
        expect(share(FLIGHT_KIND.GULL)).toBeGreaterThan(0.08);
        expect(share(FLIGHT_KIND.GULL)).toBeLessThan(0.35);
        expect(share(FLIGHT_KIND.SWALLOW)).toBeGreaterThan(0.3);
        expect(share(FLIGHT_KIND.SWALLOW)).toBeLessThan(0.75);
        expect(share(FLIGHT_KIND.GOOSE)).toBe(1);
        const rate = (kind) => lowlandBirdModel(kind).flight.rate;
        expect(rate(FLIGHT_KIND.SWALLOW)).toBeGreaterThan(rate(FLIGHT_KIND.GULL) * 2);
        expect(rate(FLIGHT_KIND.GOOSE)).toBeGreaterThan(2);
        // The gull's glide is a gull wing: the arm raised, the hand bowed down.
        const glide = birdWingPoseAt(FLIGHT_KIND.GULL, 0, 0);
        expect(glide.lift).toBeGreaterThan(0.1);
        expect(glide.lift + glide.bend).toBeLessThan(0);
        // The swallow glides with its hands swept back.
        expect(birdWingPoseAt(FLIGHT_KIND.SWALLOW, 0, 0).fold).toBeGreaterThan(0.4);
    });
});

describe('natural flight (2026-11-03)', () => {
    it('moves every wing channel, the heave and the tail without a corner, through beats and glides', () => {
        KINDS.forEach(([name, kind]) => {
            const lane = lanesOf(kind)[1];
            // Find a stretch with a beat starting in it (geese: any).
            let t0 = kind === FLIGHT_KIND.GOOSE ? 40 : 0;
            if (kind !== FLIGHT_KIND.GOOSE) {
                while (birdBeatWeightOf(lane, t0 + 1) < 0.5 && t0 < 200) t0 += 0.25;
            }
            [...HINGES, 'heave', 'tailSpread', 'tailTwist'].forEach((ch) => {
                const r = cornerRatio((t) => birdWingPoseOf(lane, t)[ch], t0, 3);
                expect(r, `${name} ${ch}`).toBeLessThan(1.3);
            });
            const bank = cornerRatio((t) => flightFrameAt(lane, t).bank, t0, 3);
            expect(bank, `${name} bank`).toBeLessThan(1.3);
        });
        const seed = 0.31;
        let t0 = 0;
        while (summitBeatWeight(t0 + 1, seed) < 0.5 && t0 < 400) t0 += 0.25;
        [...HINGES, 'heave', 'tailTwist'].forEach((ch) => {
            expect(cornerRatio((t) => summitWingPose(t, seed)[ch], t0, 4), `vulture ${ch}`).toBeLessThan(1.3);
        });
        expect(cornerRatio((t) => summitFrameAt(2, t).roll, 0, 20), 'vulture roll').toBeLessThan(1.3);
    });

    it('beats down quicker than up, the tip looping back on a shorter path, the body rising against it', () => {
        BIRDS.forEach(([name]) => {
            const m = decodeBirdModel(name);
            const n = 720;
            const lifts = [];
            const heaves = [];
            for (let k = 0; k < n; k += 1) {
                const p = rigPoseAt(m, (k / n) * TAU, 1);
                lifts.push(p.lift);
                heaves.push(p.heave);
            }
            // The arm's downstroke takes under half the beat.
            let down = 0;
            for (let k = 0; k < n; k += 1) if (lifts[(k + 1) % n] < lifts[k]) down += 1;
            expect(down / n, `${name} downstroke share`).toBeLessThan(0.47);
            expect(down / n, `${name} downstroke share`).toBeGreaterThan(0.36);
            // The body is highest just after the arm's lowest (within a fifth of a beat), lowest
            // just after its top.
            const low = lifts.indexOf(Math.min(...lifts));
            const high = heaves.indexOf(Math.max(...heaves));
            const after = (((high - low) % n) + n) % n;
            expect(after / n, `${name} heave`).toBeLessThan(0.2);
            expect(Math.max(...heaves) - Math.min(...heaves), `${name} heave size`).toBeGreaterThan(m.span * 0.008);
            expect(Math.max(...heaves) - Math.min(...heaves), `${name} heave size`).toBeLessThan(m.span * 0.04);
            // The wingtip, seen from the side, draws a loop (forward on the way down, back on the
            // way up), not a pendulum's line.
            let tip = 0;
            for (let i = 0; i < m.vertexCount; i += 1) if (m.positions[i * 3] > m.positions[tip * 3]) tip = i;
            const p0 = vec(m.positions, tip);
            const w = [0, 1, 2].map((k) => m.hinge[(tip * 4) + k]);
            const path = [];
            for (let k = 0; k < 96; k += 1) path.push(foldBirdPoint(m, p0, w, rigPoseAt(m, (k / 96) * TAU, 1)));
            let area = 0;
            for (let k = 0; k < 96; k += 1) {
                const a = path[k];
                const b = path[(k + 1) % 96];
                area += (a[2] * b[1]) - (b[2] * a[1]);
            }
            expect(Math.abs(area / 2) / (m.span * m.span), `${name} tip loop`).toBeGreaterThan(0.015);
        });
    });

    it('starts and ends a gull\'s bout at mid-upstroke, where the beat meets the glide', () => {
        lanesOf(FLIGHT_KIND.GULL).slice(0, 4).forEach((lane) => {
            let was = 0;
            let starts = 0;
            for (let t = 0; t < 120; t += 1 / 120) {
                const { weight, phase } = birdBeatOf(lane, t);
                if (was <= 0.001 && weight > 0.001) {
                    starts += 1;
                    expect(((phase % 1) + 1) % 1).toBeGreaterThan(0.65);
                    expect(((phase % 1) + 1) % 1).toBeLessThan(0.76);
                }
                if (was > 0.001 && weight <= 0.001) {
                    // ... past the last downstroke, on the way up.
                    expect(((phase % 1) + 1) % 1).toBeGreaterThan(0.75);
                    expect(((phase % 1) + 1) % 1).toBeLessThan(0.9);
                }
                was = weight;
            }
            expect(starts).toBeGreaterThan(6);
        });
        // There the beat's pose is near the glide's (no lurch as the weight comes in).
        const m = lowlandBirdModel(FLIGHT_KIND.GULL);
        const beat = rigPoseAt(m, 0.70 * TAU, 1);
        const glide = rigPoseAt(m, 0, 0);
        expect(Math.abs(beat.lift - glide.lift)).toBeLessThan(0.15);
        expect(Math.abs((beat.lift + beat.bend) - (glide.lift + glide.bend))).toBeLessThan(0.25);
    });

    it('never points a swallow straight up (its heading stays steady), and banks softly', () => {
        lanesOf(FLIGHT_KIND.SWALLOW).forEach((lane, i) => {
            let worstYaw = 0;
            let prev = null;
            let steepest = 0;
            for (let t = 0; t < 30; t += 1 / 60) {
                const fr = flightFrameAt(lane, t);
                steepest = Math.max(steepest, Math.abs(fr.forward[1]));
                const yaw = Math.atan2(fr.forward[0], fr.forward[2]);
                if (prev !== null) {
                    let d = yaw - prev;
                    while (d > Math.PI) d -= TAU;
                    while (d < -Math.PI) d += TAU;
                    worstYaw = Math.max(worstYaw, Math.abs(d) * 60);
                }
                prev = yaw;
                expect(Math.abs(fr.bank)).toBeLessThan(FLIGHT_STYLE[FLIGHT_KIND.SWALLOW].bankMax);
            }
            expect(worstYaw, `swallow #${i} yaw rate`).toBeLessThan(8);
            expect(steepest, `swallow #${i} climb`).toBeLessThan(0.9);
        });
    });

    it('beats the skein as one wave down the V, its spacing breathing but never jittering', () => {
        const geese = lanesOf(FLIGHT_KIND.GOOSE);
        // Each rank is a little later than the one ahead of it.
        const t = 44;
        const phase = (lane) => birdBeatOf(lane, t).phase;
        geese.slice(1).forEach((lane) => {
            const lead = geese.find((g) => g.cx === lane.cx - 1);
            const lag = phase(lead) - phase(lane);
            expect(lag).toBeGreaterThan(0.05);
            expect(lag).toBeLessThan(0.35);
        });
        // The gap between neighbours breathes a little, smoothly.
        const a = geese[1];
        const b = geese[3];
        const gap = (tt) => {
            const p = flightPositionAt(a, tt);
            const q = flightPositionAt(b, tt);
            return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
        };
        let lo = Infinity;
        let hi = -Infinity;
        for (let tt = 36; tt < 70; tt += 0.1) { lo = Math.min(lo, gap(tt)); hi = Math.max(hi, gap(tt)); }
        expect(hi - lo).toBeGreaterThan(0.3);
        expect(hi / lo).toBeLessThan(1.35);
        expect(worstAcc(gap, 36, 30, 1 / 60)).toBeLessThan(0.5);
    });

    it('keeps the summit vultures alive between beats: tilting, pitching, fingers flexing', () => {
        let rollLo = Infinity;
        let rollHi = -Infinity;
        let curlLo = Infinity;
        let curlHi = -Infinity;
        for (let t = 0; t < 60; t += 0.1) {
            const fr = summitFrameAt(4, t);
            rollLo = Math.min(rollLo, fr.roll);
            rollHi = Math.max(rollHi, fr.roll);
            const p = summitWingPose(t, 0.4);
            curlLo = Math.min(curlLo, p.curl);
            curlHi = Math.max(curlHi, p.curl);
            // Upright and orthonormal.
            expect(fr.up[1]).toBeGreaterThan(0.8);
            expect(Math.abs(dot(fr.left, fr.up))).toBeLessThan(1e-6);
            expect(Math.abs(dot(fr.forward, fr.up))).toBeLessThan(1e-6);
        }
        expect(rollHi - rollLo).toBeGreaterThan(0.06);
        expect(rollHi - rollLo).toBeLessThan(0.25);
        expect(curlHi - curlLo).toBeGreaterThan(0.06);
        expect(rollLo).toBeGreaterThan(SUMMIT_BIRDS.bank - 0.12);
    });

    it('beats the eagle without a corner, its bouts starting and ending at mid-upstroke', () => {
        const pose = createEaglePose();
        const [start, beats] = EAGLE_BOUTS[0];
        const joint = (name, c) => (t) => eagleFlight(t, {}, pose).joints[name][c];
        ['armL', 'foreL', 'handL', 'f3L', 'f6L'].forEach((name) => {
            [0, 1, 2].forEach((c) => {
                const r = cornerRatio(joint(name, c), start - 0.5, (beats / EAGLE_BEAT) + 1);
                expect(r, `${name}.${c}`).toBeLessThan(1.3);
            });
        });
        const bout = { amount: 0, phase: 0 };
        eagleBout(start + 0.001, bout);
        expect(bout.phase).toBeGreaterThan(0.65);
        expect(bout.phase).toBeLessThan(0.75);
        // The keyframed height: down in under half the beat.
        let down = 0;
        const { height } = ODYSSEY_BIRD_BEATS.eagle.cycle;
        for (let k = 0; k < 360; k += 1) {
            if (beatSeriesAt(height, ((k + 1) / 360) * TAU) < beatSeriesAt(height, (k / 360) * TAU)) down += 1;
        }
        expect(down / 360).toBeLessThan(0.47);
    });
});

describe('seen from the rail (the 2026-11-03 visibility check)', () => {
    it('draws each bird large enough to read, and keeps their sizes true to each other', () => {
        const span = (id) => ODYSSEY_FLIGHTS.find((f) => f.id === id).span;
        // Gulls 1.25x, swallows 1.54x, geese 1.3x what they were: measured in the game, specks.
        expect(span('gulls')).toBeCloseTo(5.75, 2);
        expect(span('swallows')).toBeCloseTo(2.0, 2);
        expect(span('geese')).toBeCloseTo(8.6, 2);
        // A swallow stays a small bird beside a gull (life: 0.24), a goose a big one.
        expect(span('swallows') / span('gulls')).toBeLessThan(0.4);
        expect(span('geese') / span('gulls')).toBeGreaterThan(1.1);
        // A griffon is a fifth bigger than a golden eagle; the kettle now draws it so.
        expect(SUMMIT_BIRDS.span / ODYSSEY_EAGLE.span).toBeGreaterThan(1.15);
        expect(SUMMIT_BIRDS.span / ODYSSEY_EAGLE.span).toBeLessThan(1.35);
    });

    it('keeps a far bird a dark silhouette: under ~24 px it darkens and takes on less air', () => {
        // Angular span at 60 degrees and 1440p: px = radians * 720 / tan(30 degrees).
        const px = (rad) => (rad * 720) / Math.tan(Math.PI / 6);
        expect(px(FAR_SPECK.across[1])).toBeCloseTo(24, 0);
        expect(px(FAR_SPECK.across[0])).toBeCloseTo(6, 0);
        // The geese darken most (a far skein against the sky), the white gulls least.
        const [gull, swallow, goose] = FAR_SPECK.darken;
        expect(goose).toBeGreaterThan(swallow);
        expect(swallow).toBeGreaterThan(gull - 1e-9);
        [...FAR_SPECK.darken, ...FAR_SPECK.air].forEach((v) => {
            expect(v).toBeGreaterThan(0);
            expect(v).toBeLessThan(1);
        });
    });
});

describe('the lowland flights draw', () => {
    it('is one material shared by one instanced draw per flock, inside the vertex-buffer limit', () => {
        const flights = createOdysseyFlights();
        expect(flights.group.name).toBe('odyssey-flights');
        expect(flights.meshes).toHaveLength(ODYSSEY_FLIGHTS.length);
        flights.meshes.forEach((mesh, i) => {
            expect(mesh.material).toBe(flights.material);
            const flock = ODYSSEY_FLIGHTS[i];
            expect(mesh.geometry.instanceCount).toBe(flock.count);
            expect(mesh.geometry.index.count).toBe(lowlandBirdModel(flock.kind).triangleCount * 3);
            // Every attribute is a vertex buffer on WebGPU; a pipeline binds at most eight.
            expect(Object.keys(mesh.geometry.attributes).length).toBeLessThanOrEqual(8);
            // The same layout in every draw: one shader and one pipeline for all three.
            expect(Object.keys(mesh.geometry.attributes).sort())
                .toEqual(Object.keys(flights.meshes[0].geometry.attributes).sort());
        });
        flights.dispose();
    });

    it('shows only the flocks whose window is open', () => {
        const flights = createOdysseyFlights();
        flights.update(9, 0.15);
        expect(flights.meshes.map((m) => m.visible)).toEqual([true, false, false]);
        flights.update(9, 0.30);
        expect(flights.meshes.map((m) => m.visible)).toEqual([false, true, true]);
        flights.update(9, 0.5);
        expect(flights.group.visible).toBe(false);
        flights.dispose();
    });

    const canvas = {
        style: {},
        width: 1280,
        height: 720,
        addEventListener() {},
        removeEventListener() {},
        getContext() { return null; },
        setAttribute() {},
    };
    function stubRenderer(forceWebGL) {
        const renderer = new THREE.WebGPURenderer({ canvas, forceWebGL });
        renderer.hasFeature = () => false;
        renderer._initialized = true;
        renderer._bindings = { getSharedBindGroup: (group) => group };
        if (forceWebGL) {
            renderer.backend.capabilities = { getUniformBufferLimit: () => 16384, getMaxAnisotropy: () => 1 };
        }
        if (!forceWebGL) {
            renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
        }
        return renderer;
    }

    /** Both stages of every mesh under `root` as one backend writes them; returns what three said. */
    function buildAll(root, forceWebGL) {
        const scene = new THREE.Scene();
        scene.add(root);
        const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 6000);
        camera.position.set(0, 340, 0);
        camera.updateMatrixWorld(true);
        root.updateMatrixWorld(true);
        const renderer = stubRenderer(forceWebGL);
        const heard = [];
        vi.spyOn(console, 'warn').mockImplementation((...a) => heard.push(a.join(' ')));
        vi.spyOn(console, 'error').mockImplementation((...a) => heard.push(a.join(' ')));
        const targets = [];
        root.traverse((o) => { if (o.isMesh) targets.push(o); });
        targets.forEach((target) => {
            const builder = renderer.backend.createNodeBuilder(target, renderer);
            builder.scene = scene;
            builder.material = target.material;
            builder.camera = camera;
            builder.context.material = target.material;
            builder.lightsNode = renderer.lighting.getNode(scene);
            builder.fogNode = null;
            builder.clippingContext = null;
            builder.build();
            expect(builder.fragmentShader.length, target.name).toBeGreaterThan(200);
            expect(builder.vertexShader).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
            expect(builder.fragmentShader).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
        });
        return { heard, count: targets.length };
    }

    [['WGSL', false], ['GLSL', true]].forEach(([label, forceWebGL]) => {
        it(`builds the flights' material (${label}) without a word`, () => {
            const flights = createOdysseyFlights({
                hazeColour: vec3(0.7, 0.8, 0.9),
                sunColour: uniform(new THREE.Color(1, 0.95, 0.9)),
            });
            const { heard, count } = buildAll(flights.group, forceWebGL);
            expect(count).toBe(ODYSSEY_FLIGHTS.length);
            expect(heard).toEqual([]);
            flights.dispose();
        });

        it(`builds the summit vultures' material (${label}) without a word`, () => {
            const birds = createSummitBirds({
                hazeColour: vec3(0.7, 0.8, 0.9),
                sunColour: uniform(new THREE.Color(1, 0.95, 0.9)),
            });
            expect(birds.mesh.geometry.instanceCount).toBe(SUMMIT_BIRDS.count);
            expect(Object.keys(birds.mesh.geometry.attributes).length).toBeLessThanOrEqual(8);
            const { heard, count } = buildAll(birds.mesh, forceWebGL);
            expect(count).toBe(1);
            expect(heard).toEqual([]);
            birds.dispose();
        });
    });
});
