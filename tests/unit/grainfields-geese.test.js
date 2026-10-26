/**
 * Grainfields — the geese's flight (grainfields-goose-flight.js), run without a renderer: the
 * tiers' flocks, the wingbeat built from the authored poses, the take-off and the V, the route a
 * flight out picks for the layout on screen (read through the rest lens, checked against three's
 * own camera), and that every bird moves smoothly frame to frame.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    CROSSINGS, FLIGHT_LIFE, FLIGHT_OUT, GLIDE_POSE, GOOSE_BEAT, GOOSE_MIN_PX, GOOSE_RIG, GOOSE_SPAN, GOOSE_STRIDE,
    GooseSkies, gooseFlockSizes, planTakeoff, restProjector, strokePhase, wingPose,
} from '../../src/themes/grainfields/grainfields-goose-flight.js';
import { fallbackLayout, outsideKeepOut } from '../../src/themes/grainfields/grainfields-composition.js';
import { tierFor } from '../../src/themes/grainfields/grainfields-quality.js';
import { EYE, PLACES } from '../../src/themes/grainfields/grainfields-core.js';
import { groundHeight } from '../../src/themes/grainfields/grainfields-plan.js';
import { GrainfieldsWorld } from '../../src/themes/grainfields/grainfields-world.js';

const TIERS = ['Extreme', 'Ultra', 'High', 'Medium', 'Low', 'Minimal'];
const KEYS = ['lift', 'sweep', 'bend', 'fold', 'curl'];
const LAYOUTS = Object.freeze([[1920, 1080], [2560, 1080], [1200, 1100], [900, 1600]]);
/** The view a 1080p rest lens gives (radians a pixel), as the world writes it. */
const view = (height = 1080, fov = 44) => ({
    eye: [EYE.x, EYE.y, EYE.z], pixelAngle: (2 * Math.tan((fov * Math.PI) / 360)) / height,
});
const write = (skies, time, v = view()) => {
    const out = new Float32Array(skies.pool * GOOSE_STRIDE);
    const n = skies.write(time, v, out);
    return { out, n };
};
const bird = (out, i) => {
    const o = i * GOOSE_STRIDE;
    return {
        p: [out[o], out[o + 1], out[o + 2]],
        scale: out[o + 3],
        fwd: [out[o + 4], out[o + 5], out[o + 6]],
        heave: out[o + 7],
        up: [out[o + 8], out[o + 9], out[o + 10]],
        pose: {
            lift: out[o + 11], sweep: out[o + 12], bend: out[o + 13], fold: out[o + 14], curl: out[o + 15],
        },
    };
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

describe('the tiers\' flocks', () => {
    it('flies a flight out on every tier, and never more birds at once than the tier allows', () => {
        for (const tier of TIERS) {
            const { birds } = tierFor(tier);
            const sizes = gooseFlockSizes(birds);
            // The level-up's flock was the one the old budget cut first (none at Medium and below).
            expect(sizes.out, tier).toBeGreaterThanOrEqual(3);
            expect(sizes.pool, tier).toBe(birds);
            expect(sizes.crossings.every((n) => n >= 3), tier).toBe(true);
            expect(sizes.crossings[0], tier).toBeLessThanOrEqual(CROSSINGS[0].birds);
            expect(sizes.crossings[1], tier).toBeLessThanOrEqual(CROSSINGS[1].birds);
            // A flight out and a crossing in sight together fit the budget.
            expect(sizes.out + sizes.crossings[0], tier).toBeLessThanOrEqual(birds);
        }
        expect(gooseFlockSizes(tierFor('High').birds)).toMatchObject({ out: 11, crossings: [13, 9] });
    });

    it('writes no more than its pool even with two flights out and both crossings in the air', () => {
        const skies = new GooseSkies(8);
        const route = planTakeoff({ layout: fallbackLayout(1920, 1080), aspect: 16 / 9 });
        skies.launch(40, route);
        skies.launch(44, route);
        for (let t = 40; t < 300; t += 3) expect(write(skies, t).n).toBeLessThanOrEqual(skies.pool);
    });
});

describe('the wingbeat', () => {
    it('hits the authored poses: the beat\'s four, the take-off\'s four, and the glide', () => {
        const at = (phi) => {
            // The warp's inverse by bisection: the θ whose stroke phase is φ.
            let lo = 0;
            let hi = 2 * Math.PI;
            for (let k = 0; k < 60; k += 1) {
                const mid = (lo + hi) / 2;
                if (strokePhase(mid) < phi) lo = mid;
                else hi = mid;
            }
            return (lo + hi) / 2;
        };
        const quarters = [['top', 0], ['down', Math.PI / 2], ['bottom', Math.PI], ['up', 1.5 * Math.PI]];
        for (const [name, phi] of quarters) {
            const cruise = wingPose(at(phi), 0, 1);
            const hard = wingPose(at(phi), 1, 1);
            const takeoff = `takeoff${name[0].toUpperCase()}${name.slice(1)}`;
            for (const key of KEYS) {
                expect(cruise[key], `${name} ${key}`).toBeCloseTo(GOOSE_RIG.poses[name][key], 6);
                expect(hard[key], `${takeoff} ${key}`).toBeCloseTo(GOOSE_RIG.poses[takeoff][key], 6);
            }
        }
        const glide = wingPose(1.234, 0.5, 0);
        for (const key of KEYS) expect(glide[key]).toBeCloseTo(GLIDE_POSE[key], 9);
        expect(glide.heave).toBe(-0);
    });

    it('takes longer over the downstroke than the upstroke, and the warp keeps the beat going one way', () => {
        // The bottom of the stroke (φ = π) comes at 58 % of the beat.
        let theta = 0;
        while (strokePhase(theta) < Math.PI) theta += 1e-4;
        expect(theta / (2 * Math.PI)).toBeCloseTo(0.58, 2);
        for (let t = 0; t < 2 * Math.PI; t += 0.01) expect(strokePhase(t + 0.01)).toBeGreaterThan(strokePhase(t));
        expect(strokePhase(2 * Math.PI)).toBeCloseTo(2 * Math.PI, 9);
    });
});

describe('a flight out', () => {
    const layout = fallbackLayout(1920, 1080);
    const route = planTakeoff({ layout, aspect: 16 / 9, seed: 1 });
    const START = 40;
    const make = () => {
        const skies = new GooseSkies(26);
        skies.launch(START, route);
        return skies;
    };

    it('goes up from the barley one bird after another, all of them within a second and a half', () => {
        const skies = make();
        const flight = skies.flightOut(START);
        const n = flight.birds.length;
        expect(n).toBe(11);
        const delays = flight.birds.map((b) => b.delay);
        expect(delays[0]).toBe(0);
        expect(Math.max(...delays)).toBeLessThanOrEqual(FLIGHT_OUT.stagger + 0.1);
        const up = (age) => flight.birds.filter((_, i) => skies.flightBird(flight, i, age, 1, [0, 0, 0])).length;
        expect(up(0)).toBe(1);
        expect(up(0.5)).toBeGreaterThan(1);
        expect(up(0.5)).toBeLessThan(n);
        expect(up(FLIGHT_OUT.stagger + 0.1)).toBe(n);
        // Each starts in the barley, by its own spot, and is well clear of it three seconds on.
        const p = [0, 0, 0];
        flight.birds.forEach((b, i) => {
            skies.flightBird(flight, i, b.delay + 1e-3, 1, p);
            expect(p[1] - groundHeight(p[0], p[2]), `bird ${i}`).toBeLessThan(0.6);
            expect(Math.hypot(p[0] - route.x, p[2] - route.z), `bird ${i}`).toBeLessThan(FLIGHT_OUT.spread[0] + 1);
            skies.flightBird(flight, i, b.delay + 3, 1, p);
            expect(p[1] - groundHeight(p[0], p[2]), `bird ${i}`).toBeGreaterThan(10);
        });
    });

    it('beats hard and pitched up as it goes, then settles into the cruise beat and heads for the gate', () => {
        const skies = make();
        const early = write(skies, START + 0.4);
        const first = bird(early.out, 0);
        // Pitched up steeply off the ground, the take-off stroke's reach.
        expect(Math.asin(first.fwd[1])).toBeGreaterThan(0.6);
        const late = write(skies, START + 30);
        const gate = [PLACES.gate.x, 0, PLACES.gate.z];
        for (let i = 0; i < 11; i += 1) {
            const b = bird(late.out, i);
            expect(Math.asin(b.fwd[1]), `bird ${i}`).toBeLessThan(0.12);
            // Its heading points at the gate, near enough.
            const to = [gate[0] - b.p[0], 0, gate[2] - b.p[2]];
            const l = Math.hypot(to[0], to[2]);
            const flat = Math.hypot(b.fwd[0], b.fwd[2]);
            expect(angle([b.fwd[0] / flat, 0, b.fwd[2] / flat], [to[0] / l, 0, to[2] / l]), `bird ${i}`).toBeLessThan(0.12);
        }
        // The beat eased from the take-off's rate to the cruise's (each bird its own a little).
        expect(GOOSE_BEAT.takeoff).toBeGreaterThan(GOOSE_BEAT.cruise);
    });

    it('closes into a V behind its leader, arms either side, each bird a little loose in its slot', () => {
        const skies = make();
        const { out } = write(skies, START + 35);
        const lead = bird(out, 0);
        const flat = Math.hypot(lead.fwd[0], lead.fwd[2]);
        const f = [lead.fwd[0] / flat, 0, lead.fwd[2] / flat];
        const r = [-f[2], 0, f[0]];
        const span = GOOSE_SPAN * lead.scale;
        let left = 0;
        let right = 0;
        for (let i = 1; i < 11; i += 1) {
            const b = bird(out, i);
            const d = [b.p[0] - lead.p[0], 0, b.p[2] - lead.p[2]];
            const back = -dot(d, f) / span;
            const across = dot(d, r) / span;
            expect(back, `bird ${i}`).toBeGreaterThan(0.5);
            // On an arm: as far out to the side as it is back, near enough (the V's half angle).
            expect(Math.abs(across) / back, `bird ${i}`).toBeGreaterThan(0.4);
            expect(Math.abs(across) / back, `bird ${i}`).toBeLessThan(1.4);
            if (across < 0) left += 1;
            else right += 1;
        }
        expect(left).toBeGreaterThanOrEqual(3);
        expect(right).toBeGreaterThanOrEqual(3);
    });

    it('is gone when its time in the air is up, smaller and smaller toward the end', () => {
        const skies = make();
        const sizeAt = (age) => {
            const { out, n } = write(skies, START + age);
            if (!n) return 0;
            const b = bird(out, 0);
            const d = Math.hypot(b.p[0] - EYE.x, b.p[1] - EYE.y, b.p[2] - EYE.z);
            return (GOOSE_SPAN * b.scale) / d / view().pixelAngle;
        };
        // Near the eye: real size, tens of pixels; a kilometre out never under the least size.
        expect(sizeAt(1)).toBeGreaterThan(40);
        expect(sizeAt(40)).toBeCloseTo(GOOSE_MIN_PX, 0);
        expect(sizeAt(90)).toBeLessThan(2);
        // (The crossings fly on.)
        expect(write(skies, START + FLIGHT_LIFE + 0.01).n).toBe(write(new GooseSkies(26), START + FLIGHT_LIFE + 0.01).n);
        expect(skies.flightOut(START + FLIGHT_LIFE + 0.01)).toBeNull();
    });

    it('moves every bird smoothly from frame to frame, from the first stroke to the last', () => {
        const skies = make();
        const dt = 1 / 60;
        let before = null;
        const worst = {
            step: 0, turn: 0, roll: 0, wing: 0,
        };
        for (let t = START; t < START + FLIGHT_LIFE - 12; t += dt) {
            const { out } = write(skies, t);
            const flight = skies.flightOut(t);
            const ids = flight.birds.map((_, i) => skies.flightBird(flight, i, t - START, 1, [0, 0, 0]));
            const now = ids.map((upNow, i) => (upNow ? bird(out, ids.slice(0, i).filter(Boolean).length) : null));
            for (let i = 0; before && i < now.length; i += 1) {
                const a = before[i];
                const b = now[i];
                if (a && b) {
                    worst.step = Math.max(worst.step, Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]));
                    worst.turn = Math.max(worst.turn, angle(a.fwd, b.fwd));
                    worst.roll = Math.max(worst.roll, angle(a.up, b.up));
                    for (const k of KEYS) worst.wing = Math.max(worst.wing, Math.abs(b.pose[k] - a.pose[k]));
                }
            }
            before = now;
        }
        // At most a goose's top speed a frame, no snap of the body, the hardest stroke's pace on the wing.
        expect(worst.step).toBeLessThan(0.45);
        expect(worst.turn).toBeLessThan(0.08);
        expect(worst.roll).toBeLessThan(0.08);
        expect(worst.wing).toBeLessThan(0.6);
    });

    it('is a function of the clock and the launches: a second sky with the same launch says the same', () => {
        const a = make();
        const b = make();
        write(a, START + 3);
        write(a, START + 11);
        for (const t of [START + 0.2, START + 5.5, START + 40]) expect(write(a, t).out).toEqual(write(b, t).out);
    });

    it('takes the older flight\'s place when another goes up, and draws the newest first', () => {
        const skies = make();
        skies.launch(START + 50, route);
        expect(skies.flights.filter((f) => f.live(START + 51))).toHaveLength(2);
        const { out } = write(skies, START + 52);
        // The first bird written is the new flight's (still near the field), not the old one's.
        expect(bird(out, 0).p[1] - groundHeight(bird(out, 0).p[0], bird(out, 0).p[2])).toBeLessThan(40);
        skies.launch(START + 100, route);
        expect(skies.flights.map((f) => f.at).sort((x, y) => x - y)).toEqual([START + 50, START + 100]);
        skies.reset();
        expect(skies.flightOut(START + 101)).toBeNull();
    });
});

describe('where a flight out goes up', () => {
    it('keeps the flock in the open (off the board, the stats and the frame\'s edges) on every layout', () => {
        for (const [W, H] of LAYOUTS) {
            const aspect = W / H;
            const layout = fallbackLayout(W, H);
            const route = planTakeoff({ layout, aspect, seed: 3 });
            expect(route, `${W}x${H}`).not.toBeNull();
            const skies = new GooseSkies(26);
            skies.launch(0, route);
            const project = restProjector(aspect);
            let seen = 0;
            let total = 0;
            for (let t = 0.6; t <= 20; t += 0.4) {
                const loc = skies.locate('out', 0, t);
                const s = loc && project(...loc.position);
                total += 1;
                if (s && s.x > 0 && s.x < 1 && s.y > 0 && s.y < 1 && outsideKeepOut(layout, s, 0.01)) seen += 1;
            }
            // Portrait leaves only the strip over the card: the flock climbs into it.
            expect(seen / total, `${W}x${H}`).toBeGreaterThan(aspect < 0.75 ? 0.7 : 0.9);
        }
    });

    it('goes up inside the near field, before the crest, and turns for the gate', () => {
        const route = planTakeoff({ layout: fallbackLayout(1920, 1080), aspect: 16 / 9 });
        expect(route.distance).toBeGreaterThanOrEqual(40);
        expect(route.distance).toBeLessThanOrEqual(80);
        expect(Math.abs(route.turn)).toBeLessThanOrEqual(60);
        const toGate = Math.atan2(PLACES.gate.x - route.x, -(PLACES.gate.z - route.z));
        expect(route.psiGate).toBeCloseTo(toGate, 9);
    });

    it('is stirred by its seed between near-equal routes, and the same seed picks the same one', () => {
        const layout = fallbackLayout(1920, 1080);
        const picks = new Set();
        for (let seed = 1; seed <= 12; seed += 1) {
            const a = planTakeoff({ layout, aspect: 16 / 9, seed });
            const b = planTakeoff({ layout, aspect: 16 / 9, seed });
            expect(a).toEqual(b);
            picks.add(`${a.bearing}/${a.distance}/${a.turn}`);
        }
        expect(picks.size).toBeGreaterThan(1);
    });

    it('reads the screen through the same lens as the theme\'s rest camera', () => {
        for (const [W, H] of LAYOUTS) {
            const aspect = W / H;
            const world = new GrainfieldsWorld({ scene: new THREE.Scene() });
            world.aspect = aspect;
            const camera = new THREE.PerspectiveCamera(40, aspect, 0.2, 90000);
            world.restCamera(camera);
            const project = restProjector(aspect);
            for (const p of [[30, 25, -80], [-400, 150, -1200], [2000, 400, -3000], [-60, 13, -50]]) {
                const ours = project(...p);
                const theirs = new THREE.Vector3(...p).project(camera);
                expect(ours.x, `${W}x${H} ${p}`).toBeCloseTo((theirs.x + 1) / 2, 6);
                expect(ours.y, `${W}x${H} ${p}`).toBeCloseTo((1 - theirs.y) / 2, 6);
            }
            expect(project(0, 12, 50)).toBeNull();
        }
    });
});

describe('the crossings', () => {
    it('cross the view now and then, over the fells\' summits, as a readable V', () => {
        const skies = new GooseSkies(26);
        const project = restProjector(16 / 9);
        for (const key of ['a', 'b']) {
            let shown = 0;
            let highest = 1;
            for (let t = 0; t < 520; t += 2) {
                const loc = skies.locate(key, 0, t, view());
                const s = loc && project(...loc.position);
                if (s && s.x > 0 && s.x < 1) {
                    shown += 1;
                    highest = Math.min(highest, s.y);
                    // Drawn at no less than the least size: a skein, not a speck.
                    const d = Math.hypot(...loc.position.map((v, k) => v - view().eye[k]));
                    expect((GOOSE_SPAN * loc.scale) / d / view().pixelAngle).toBeGreaterThan(GOOSE_MIN_PX * 0.97);
                }
            }
            expect(shown, key).toBeGreaterThan(20);
            // Up in the sky over the summits (the fells' tops stand about a quarter down the frame).
            expect(highest, key).toBeLessThan(0.24);
        }
    });

    it('moves each crossing bird smoothly, and keeps them out of sight when they are not on their run', () => {
        const skies = new GooseSkies(26);
        const p = [0, 0, 0];
        const q = [0, 0, 0];
        for (const c of skies.crossings) {
            let worst = 0;
            for (let t = 0; t < c.period * 2; t += 1 / 30) {
                for (let i = 0; i < c.n; i += 1) {
                    if (!skies.crossingBird(c, i, t, 2, p) || !skies.crossingBird(c, i, t + 1 / 30, 2, q)) continue;
                    worst = Math.max(worst, Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]));
                }
            }
            expect(worst, c.key).toBeLessThan((c.speed * 1.3) / 30);
        }
        // Culled out of sight: nothing written when the view says every bird is out of it.
        const { n } = write(skies, 64, { ...view(), cull: () => true });
        expect(n).toBe(0);
    });
});
