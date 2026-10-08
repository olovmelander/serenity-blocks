import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { CHAIN_RING, KoiSchool, LEAP_GRAVITY } from '../../src/themes/koi-pond/koi-pond-school.js';
import { POND, waterDepth } from '../../src/themes/koi-pond/koi-pond-core.js';
import { KOI_LIVE_STRIDE, KOI_VARIETIES } from '../../src/themes/koi-pond/koi-pond-koi.js';
import { planGarden } from '../../src/themes/koi-pond/koi-pond-garden.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/koi-pond/koi-pond-quality.js';
import {
    REST_RIG, fallbackLayout, fovForAspect, restEye,
} from '../../src/themes/koi-pond/koi-pond-composition.js';

/** The simulation's own step, and the rocks the world hands the school. */
const DT = 1 / 60;
const ROCKS = planGarden().standing;
const HIGH = QUALITY.High.koi;

const make = (count = HIGH, seed = undefined) => new KoiSchool({ count, seed, rocks: ROCKS });
const range = (n) => Array.from({ length: n }, (_, i) => i);
const mean = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;

/** Step a school for `seconds`; `each(school, step)` runs before every step. */
function run(school, seconds, each = null) {
    const steps = Math.round(seconds / DT);
    for (let s = 0; s < steps; s++) {
        each?.(school, s);
        school.step(DT);
    }
}

/** Every number the renderer and the water read from a school. */
function snapshot(school) {
    return ['x', 'y', 'z', 'heading', 'speed', 'phase', 'amp', 'curve', 'roll', 'pitch', 'glow', 'flare', 'joined']
        .map((key) => Array.from(school[key]));
}

const inRock = (x, z) => ROCKS.some((rock) => Math.hypot(x - rock.x, z - rock.z) < rock.radius);
const inRectangle = (x, z) => x >= POND.minX && x <= POND.maxX && z >= POND.minZ && z <= POND.maxZ;

/** The picture: what the rest camera shows of the water on a 16:9 screen, and what the card hides of it. */
const { picture, behindTheCard } = (() => {
    const aspect = 16 / 9;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const eye = restEye(aspect);
    camera.position.set(eye.x, eye.y, eye.z);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const [card] = fallbackLayout(1600, 900).cards;
    const point = new THREE.Vector3();
    return {
        picture: (x, z) => {
            point.set(x, 0, z).project(camera);
            return Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1;
        },
        behindTheCard: (x, z) => {
            point.set(x, 0, z).project(camera);
            const sx = point.x * 0.5 + 0.5;
            const sy = 0.5 - point.y * 0.5;
            return sx > card.x0 && sx < card.x1 && sy > card.y0 && sy < card.y1;
        },
    };
})();

/** One of the six flights of a four-line clear, as the world asks for them. */
const quadFlight = (k) => ({ side: k % 2 ? 1 : -1, power: 1.25 + (k % 3) * 0.22, twist: k % 3 === 2 });

/** The scenarios the pond must survive with every koi in the water (the calls the world makes). */
const startleAt = (school, n, strength, reach) => {
    const side = n % 2 ? 1 : -1;
    school.startle(side * (2.4 + (n % 5) * 0.4), -2 + (n % 7) * 0.65, strength, reach);
};
const SCENARIOS = {
    'left alone': { seconds: 90, script: null },
    'frightened again and again': {
        seconds: 120,
        script: (school, s) => {
            if (s % 54 === 0) startleAt(school, s / 54, 1.25, 3.4);
        },
    },
    'sent over the water one at a time': {
        seconds: 120,
        script: (school, s) => {
            if (s >= 300 && s % 150 === 0) {
                const n = s / 150;
                school.leap({ side: n % 2 ? 1 : -1, power: 1.02 + (n % 3) * 0.12, twist: n % 5 === 0 });
            }
        },
    },
    'sent over the water six at a time': {
        seconds: 120,
        script: (school, s) => {
            // A four-line clear: the breath is held, then six go, a beat apart.
            const beat = s % 480;
            if (s < 300) return;
            if (beat === 0) school.holdBreath(0.34);
            for (let k = 0; k < 6; k++) {
                if (beat === 24 + k * 8) school.leap(quadFlight(k));
            }
        },
    },
    'drawn into a long chain and let go': {
        seconds: 150,
        script: (school, s) => {
            // One more clear every four seconds up to fourteen, then the chain breaks.
            if (s % 240 === 0 && s <= 240 * 14) school.setChain(s / 240);
            if (s === 60 * 100) school.setChain(0);
        },
    },
    'played hard: a chain with leaps and frights': {
        seconds: 180,
        script: (school, s) => {
            if (s % 54 !== 0) return;
            const n = s / 54;
            startleAt(school, n, n % 4 === 3 ? 1.25 : 0.75, n % 4 === 3 ? 3.4 : 2.2);
            if (n % 3 !== 2) return;
            const clears = (n + 1) / 3;
            school.setChain(clears % 22);
            const lines = clears % 8 === 0 ? 4 : 1 + (clears % 3);
            if (lines === 4) {
                school.holdBreath(0.34);
                for (let k = 0; k < 6; k++) school.leap({ ...quadFlight(k), delay: 0.39 + k * 0.13 });
            } else {
                for (let k = 0; k < lines; k++) {
                    school.leap({
                        side: (clears + k) % 2 ? 1 : -1, power: 1.0 + 0.12 * lines, twist: k === 2, delay: k * 0.18,
                    });
                }
            }
        },
    },
};

const watched = new Map();
/**
 * Play one scenario on a school of `count` and note, at every step, each koi that is somewhere it
 * must not be: the number of fish-steps and the first few of them, to read in a failure. Played
 * once and read by several tests.
 */
function record(name, count) {
    const key = `${name}/${count}`;
    if (watched.has(key)) return watched.get(key);
    const { seconds, script } = SCENARIOS[name];
    const school = make(count);
    const note = () => ({ fishSteps: 0, first: [] });
    const seen = {
        notFinite: 0, onTheBank: note(), inARock: note(), outsideTheRectangle: note(), events: {}, fastest: 0,
    };
    const add = (list, i, s) => {
        list.fishSteps += 1;
        if (list.first.length < 4) {
            const doing = school.airborne(i) ? 'in the air' : 'swimming';
            const at = `(${school.x[i].toFixed(2)}, ${school.z[i].toFixed(2)})`;
            list.first.push(`koi ${i} at ${(s * DT).toFixed(2)} s, ${doing} at ${at}`);
        }
    };
    const steps = Math.round(seconds / DT);
    for (let s = 0; s <= steps; s++) {
        for (let i = 0; i < count; i++) {
            const x = school.x[i];
            const z = school.z[i];
            const sum = x + z + school.y[i] + school.heading[i] + school.speed[i] + school.phase[i];
            if (!Number.isFinite(sum)) seen.notFinite += 1;
            if (!(waterDepth(x, z) > 0)) add(seen.onTheBank, i, s); // in the air too: a leap never crosses the bank
            if (inRock(x, z) && !school.airborne(i)) add(seen.inARock, i, s); // (a leap may clear a rock)
            if (!inRectangle(x, z)) add(seen.outsideTheRectangle, i, s);
            seen.fastest = Math.max(seen.fastest, school.speed[i]);
        }
        script?.(school, s);
        school.step(DT);
        for (const event of school.events) seen.events[event.type] = (seen.events[event.type] || 0) + 1;
    }
    watched.set(key, seen);
    return seen;
}
const NOWHERE = { fishSteps: 0, first: [] };

describe('koi school: who lives in the pond', () => {
    it('gives the same seed the same fish in the same places, and another seed others', () => {
        const a = make(HIGH);
        const b = make(HIGH);
        const c = make(HIGH, 99);
        expect(a.fish).toEqual(b.fish);
        expect(snapshot(a)).toEqual(snapshot(b));
        expect(c.fish).not.toEqual(a.fish);
        expect(Array.from(c.x)).not.toEqual(Array.from(a.x));
        expect(a.seed).toBe(7411);
        // The count is a whole number of fish, at least one.
        expect(new KoiSchool({ count: 3.9 }).count).toBe(3);
        expect(new KoiSchool({ count: 0 }).count).toBe(1);
        expect(new KoiSchool({ count: 3 }).rocks).toEqual([]);
    });

    it('has two big fish, a few small ones and the rest in between, each of a known variety', () => {
        const school = make(QUALITY.Extreme.koi);
        const lengths = school.fish.map((fish) => fish.length);
        expect(lengths[0]).toBeGreaterThan(1.25);
        expect(lengths[1]).toBeGreaterThan(1.25);
        expect(Math.max(...lengths.slice(2))).toBeLessThan(1.25);
        expect(lengths.filter((length) => length < 0.65).length).toBeGreaterThanOrEqual(3);
        school.fish.forEach((fish, i) => {
            expect(Number.isInteger(fish.variety), `koi ${i}`).toBe(true);
            expect(KOI_VARIETIES[fish.variety], `koi ${i}`).toBeTruthy();
            const numbers = ['length', 'seedU', 'seedV', 'fins', 'girth', 'tone', 'markBias', 'cruise', 'depth', 'bob'];
            for (const key of numbers) expect(Number.isFinite(fish[key]), `koi ${i}.${key}`).toBe(true);
            expect(fish.cruise, `koi ${i}`).toBeGreaterThan(0.1);
            expect(fish.depth, `koi ${i}`).toBeGreaterThan(0.05);
            expect(fish.side, `koi ${i}`).toBe(i % 2 === 0 ? -1 : 1);
        });
        expect(school.fish[0].variety).toBe(0); // the first is always the red and white
        // The order they answer a chain in: every rank once, the long fish first.
        const order = school.fish.map((fish) => fish.order);
        expect([...order].sort((p, q) => p - q)).toEqual(range(school.count));
        const byRank = range(school.count).sort((p, q) => order[p] - order[q]).map((i) => lengths[i]);
        for (let rank = 1; rank < byRank.length; rank++) expect(byRank[rank]).toBeLessThanOrEqual(byRank[rank - 1]);
        // A smaller school is the first fish of a larger one: a tier drops fish, it does not reshuffle them.
        const few = make(QUALITY.Minimal.koi);
        few.fish.forEach((fish, i) => expect(fish.length, `koi ${i}`).toBe(school.fish[i].length));
    });

    it.each(QUALITY_NAMES)('gives every koi of the %s tier a loop in water, off the card and the rocks', (name) => {
        const school = make(QUALITY[name].koi);
        const faults = [];
        school.fish.forEach((fish, i) => {
            let left = 0;
            let right = 0;
            for (let k = 0; k < 96; k++) {
                const point = school.lanePoint(i, (k / 96) * Math.PI * 2);
                if (point.x < 0) left += 1;
                else right += 1;
                const where = `koi ${i}'s loop at (${point.x.toFixed(2)}, ${point.z.toFixed(2)})`;
                // Deep enough to swim, clear of the strip the card floats over, off the rocks, on simulated water.
                const depth = waterDepth(point.x, point.z);
                if (!(depth > 0.35)) faults.push(`${where}: ${depth.toFixed(2)} m of water`);
                if (Math.abs(point.x) < 1.75) faults.push(`${where}: under the card`);
                if (inRock(point.x, point.z)) faults.push(`${where}: in a rock`);
                if (!inRectangle(point.x, point.z)) faults.push(`${where}: outside the simulated rectangle`);
            }
            // Its own reach: the left fish stay left of the card, the right fish right of it.
            expect(fish.side < 0 ? right : left, `koi ${i}`).toBe(0);
        });
        expect(faults).toEqual([]);
        // The two reaches are both lived in.
        expect(school.fish.filter((fish) => fish.side < 0).length).toBeGreaterThanOrEqual(Math.floor(school.count / 2));
    });

    it('starts every koi on its loop, cruising along it, under the surface', () => {
        const school = make(QUALITY.Extreme.koi);
        for (let i = 0; i < school.count; i++) {
            const fish = school.fish[i];
            const here = school.lanePoint(i, school.laneAngle[i]);
            expect(school.x[i], `koi ${i}`).toBeCloseTo(here.x, 5);
            expect(school.z[i], `koi ${i}`).toBeCloseTo(here.z, 5);
            expect(school.y[i], `koi ${i}`).toBeCloseTo(-fish.depth, 6);
            expect(school.speed[i], `koi ${i}`).toBeCloseTo(fish.cruise, 6);
            expect(school.airborne(i), `koi ${i}`).toBe(false);
            expect(waterDepth(school.x[i], school.z[i]), `koi ${i}`).toBeGreaterThan(fish.depth);
            // Heading along the loop, the way it goes round it.
            const next = school.lanePoint(i, school.laneAngle[i] + fish.laneWay * 0.05);
            const along = Math.atan2(next.z - here.z, next.x - here.x);
            expect(Math.cos(school.heading[i] - along), `koi ${i}`).toBeGreaterThan(0.9);
        }
        expect(school.events).toEqual([]);
        expect(school.chain).toBe(0);
        expect(school.time).toBe(0);
    });
});

describe('koi school: swimming', () => {
    it('is deterministic: the same calls give the same poses, step for step', () => {
        const play = (school) => {
            const frames = [];
            run(school, 20, (k, s) => {
                if (s === 200) k.leap({ side: 1, power: 1.2 });
                if (s === 260) k.leap({ side: -1, twist: true });
                if (s === 400) k.setChain(6);
                if (s === 700) k.startle(4, 0, 1, 3);
                if (s === 800) k.holdBreath(0.34);
                if (s === 1000) k.setChain(0);
                if (s % 300 === 299) frames.push(snapshot(k));
            });
            return frames;
        };
        const a = make();
        const first = play(a);
        expect(play(make())).toEqual(first);
        expect(first[0]).not.toEqual(first[1]);
        // reset() is a seek: everyone back where a new school starts, whatever came before.
        a.reset();
        expect(snapshot(a)).toEqual(snapshot(make()));
        expect(a.events).toEqual([]);
        expect(a.chain).toBe(0);
        expect(a.hush).toBe(0);
        expect(play(a)).toEqual(first);
    });

    it('does nothing in a step of no time', () => {
        const school = make();
        run(school, 2);
        const before = snapshot(school);
        const { time } = school;
        school.step(0);
        school.step(-1);
        school.step(NaN);
        expect(snapshot(school)).toEqual(before);
        expect(school.time).toBe(time);
    });

    it('keeps its koi moving: each goes round its own loop, beating its tail', () => {
        const school = make();
        const start = snapshot(school);
        const turned = new Float64Array(school.count);
        const angle = (i) => {
            const lane = school.fish[i];
            return Math.atan2((school.z[i] - lane.laneZ) / lane.laneRZ, (school.x[i] - lane.laneX) / lane.laneRX);
        };
        let last = range(school.count).map(angle);
        run(school, 60, () => {
            const now = range(school.count).map(angle);
            now.forEach((value, i) => {
                let step = value - last[i];
                if (step > Math.PI) step -= Math.PI * 2;
                if (step < -Math.PI) step += Math.PI * 2;
                turned[i] += step;
            });
            last = now;
        });
        for (let i = 0; i < school.count; i++) {
            // The way it was dealt, and a fair part of a lap in a minute.
            expect(turned[i] * school.fish[i].laneWay, `koi ${i}`).toBeGreaterThan(1);
            expect(school.speed[i], `koi ${i}`).toBeGreaterThan(0.05);
            expect(school.speed[i], `koi ${i}`).toBeLessThan(1.5);
            expect(school.phase[i], `koi ${i}`).toBeGreaterThan(start[5][i] + 60); // the tail never stops
            expect(school.y[i], `koi ${i}`).toBeLessThan(0);
            expect(school.y[i], `koi ${i}`).toBeGreaterThan(-1);
            expect(Math.abs(school.roll[i]), `koi ${i}`).toBeLessThanOrEqual(0.4);
        }
        expect(school.time).toBeCloseTo(60, 3);
    });

    it('tells the world what happened in a step, and forgets it in the next', () => {
        const school = make();
        const kinds = new Set();
        let total = 0;
        run(school, 30, (k, s) => {
            if (s === 600) k.leap({ side: -1 });
            if (s === 660) k.leap({ side: 1 });
            for (const event of k.events) {
                kinds.add(event.type);
                total += 1;
                expect(['breach', 'splash', 'kiss']).toContain(event.type);
                expect(Number.isFinite(event.x + event.z + event.power)).toBe(true);
                expect(event.power).toBeGreaterThan(0);
                expect(event.index).toBeGreaterThanOrEqual(0);
                expect(event.index).toBeLessThan(k.count);
            }
            // The list is this step's alone.
            expect(k.events.length).toBeLessThanOrEqual(k.count);
        });
        expect(kinds.has('breach')).toBe(true);
        expect(kinds.has('splash')).toBe(true);
        expect(total).toBeGreaterThanOrEqual(4);
        expect(school.events).toEqual([]);
    });

    it('now and then brings a koi up to kiss the surface, on every tier', () => {
        // "A fish now and then comes up to kiss the surface": a few times in five quiet minutes, not a patter.
        const quiet = [];
        for (const name of QUALITY_NAMES) {
            const school = make(QUALITY[name].koi);
            let kisses = 0;
            let highest = -Infinity;
            run(school, 300, (k) => {
                for (const event of k.events) if (event.type === 'kiss') kisses += 1;
                for (let i = 0; i < k.count; i++) highest = Math.max(highest, k.y[i]);
            });
            const nearest = `no koi came nearer the surface than ${highest.toFixed(3)} m`;
            if (kisses < 3) quiet.push(`${name}: ${kisses} kisses in five minutes; ${nearest}`);
            expect(kisses, name).toBeLessThan(school.count * 40);
        }
        expect(quiet).toEqual([]);
    }, 120000);

    it('writes a pose of twelve numbers a koi for the renderer', () => {
        const school = make();
        run(school, 5);
        const live = new Float32Array(school.count * KOI_LIVE_STRIDE + 3).fill(-9);
        school.writeLive(live);
        expect(KOI_LIVE_STRIDE).toBe(12);
        for (let i = 0; i < school.count; i++) {
            const o = i * KOI_LIVE_STRIDE;
            expect(Array.from(live.subarray(o, o + KOI_LIVE_STRIDE)), `koi ${i}`).toEqual([
                school.x[i], school.y[i], school.z[i], school.heading[i], school.phase[i], school.amp[i],
                school.curve[i], school.pitch[i], school.roll[i], school.glow[i], school.flare[i], 1,
            ]);
        }
        // Nothing past the last fish is touched.
        expect(Array.from(live.subarray(school.count * KOI_LIVE_STRIDE))).toEqual([-9, -9, -9]);
    });

    it('presses on the water where each koi swims near the surface: six numbers an entry', () => {
        const school = make();
        run(school, 12);
        const wakes = new Float32Array(school.count * 6).fill(-9);
        const written = school.writeWakes(wakes, DT);
        expect(written).toBeGreaterThan(0);
        expect(written).toBeLessThanOrEqual(school.count);
        // A koi deep down does not mark the surface.
        const shallow = range(school.count).filter((i) => 1 - (-school.y[i] - 0.04) / 0.42 > 0.02);
        expect(written).toBe(shallow.length);
        shallow.forEach((i, n) => {
            const [x, z, push, radius, light, lightRadius] = wakes.subarray(n * 6, n * 6 + 6);
            // Just behind the shoulders: within half a body of the fish.
            expect(Math.hypot(x - school.x[i], z - school.z[i]), `koi ${i}`).toBeLessThan(school.fish[i].length * 0.5);
            expect(push, `koi ${i}`).toBeGreaterThanOrEqual(0);
            expect(push, `koi ${i}`).toBeLessThan(0.01); // metres a step: a press, not a blow
            expect(radius, `koi ${i}`).toBeGreaterThan(0.05);
            expect(radius, `koi ${i}`).toBeLessThan(0.4);
            expect(light, `koi ${i}`).toBe(0); // no chain: no light in the water
            expect(lightRadius, `koi ${i}`).toBeGreaterThan(0);
        });
        expect(Array.from(wakes.subarray(written * 6)).every((value) => value === -9)).toBe(true);
        // The old four-number layout is still written when asked for.
        const narrow = new Float32Array(school.count * 4).fill(-9);
        expect(school.writeWakes(narrow, DT, 4)).toBe(written);
        expect(Array.from(narrow.subarray(0, 4))).toEqual(Array.from(wakes.subarray(0, 4)));
        // A faster koi presses harder; a step of no time presses not at all.
        const still = new Float32Array(school.count * 6);
        school.writeWakes(still, 0);
        expect(range(written).every((n) => still[n * 6 + 2] === 0)).toBe(true);
    });
});

describe('koi school: what the game asks of it', () => {
    it('frightens the koi near a splash, and only those, away from it', () => {
        const school = make();
        const calm = make();
        run(school, 12);
        run(calm, 12);
        const x = school.x[3] + 0.3;
        const z = school.z[3];
        const reach = 3.4;
        const from = (k, i) => Math.hypot(k.x[i] - x, k.z[i] - z);
        const near = range(school.count).filter((i) => from(school, i) <= reach);
        const far = range(school.count).filter((i) => from(school, i) > reach);
        expect(near.length).toBeGreaterThan(2);
        expect(far.length).toBeGreaterThan(2);
        school.startle(x, z, 1.25, reach);
        for (const i of far) expect(school.fear[i], `koi ${i}`).toBe(0);
        for (const i of near) {
            expect(school.fear[i], `koi ${i}`).toBeGreaterThan(0);
            expect(school.fear[i], `koi ${i}`).toBeLessThanOrEqual(1.4);
            // It means to go straight away from where the thing fell.
            const gap = Math.max(from(school, i), 0.05);
            const away = [(school.x[i] - x) / gap, (school.z[i] - z) / gap];
            expect(school.fleeX[i], `koi ${i}`).toBeCloseTo(away[0], 5);
            expect(school.fleeZ[i], `koi ${i}`).toBeCloseTo(away[1], 5);
        }
        // The nearest is the most afraid; a weaker fright never calms a stronger one.
        expect(school.fear[3]).toBe(Math.max(...school.fear));
        const fear = school.fear[3];
        school.startle(x, z, 0.2, reach);
        expect(school.fear[3]).toBe(fear);
        // A second later they are further from it than they would have been, and faster.
        run(school, 1);
        run(calm, 1);
        const gained = near.map((i) => from(school, i) - from(calm, i));
        expect(mean(gained)).toBeGreaterThan(0.1);
        expect(gained[near.indexOf(3)]).toBeGreaterThan(0.15);
        expect(mean(near.map((i) => school.speed[i]))).toBeGreaterThan(mean(near.map((i) => calm.speed[i])) * 1.2);
        // The fright passes.
        run(school, 6);
        expect(Math.max(...school.fear)).toBe(0);
    });

    it('sends a koi over the water: a run, a breach, an arc, a splash', () => {
        const school = make();
        run(school, 10);
        const index = school.leap({ side: -1, power: 1 });
        expect(index).toBeGreaterThanOrEqual(0);
        expect(school.x[index]).toBeLessThan(0); // from the reach it was asked of
        expect(school.airborne(index)).toBe(false); // it runs up first
        const log = [];
        let peak = -Infinity;
        let airSteps = 0;
        let lit = 0;
        run(school, 6, (k, s) => {
            for (const event of k.events) if (event.index === index && event.type !== 'kiss') log.push({ ...event, s });
            if (k.airborne(index)) {
                airSteps += 1;
                peak = Math.max(peak, k.y[index]);
                lit = Math.max(lit, k.glow[index]);
            }
        });
        expect(log.map((event) => event.type)).toEqual(['breach', 'splash']);
        const [breach, splash] = log;
        // It leaves the water within a breath of being asked...
        expect(breach.s * DT).toBeGreaterThan(0.2);
        expect(breach.s * DT).toBeLessThan(1.5);
        // ...clears it by most of its own length, lit, for about as long as its gravity allows...
        expect(peak).toBeGreaterThan(0.6);
        expect(peak).toBeLessThan(2.5);
        expect(lit).toBeGreaterThanOrEqual(0.5);
        expect(airSteps).toBe(splash.s - breach.s);
        expect(airSteps * DT).toBeCloseTo(2 * Math.sqrt((2 * peak) / LEAP_GRAVITY), 0);
        // ...and comes down a couple of metres on, in water deep enough to take it.
        const flown = Math.hypot(splash.x - breach.x, splash.z - breach.z);
        expect(flown).toBeGreaterThan(1.8);
        expect(flown).toBeLessThan(3.2);
        expect(waterDepth(breach.x, breach.z)).toBeGreaterThan(0.3);
        expect(waterDepth(splash.x, splash.z)).toBeGreaterThan(0.3);
        expect(breach.power).toBeGreaterThan(0);
        expect(splash.power).toBeGreaterThan(0);
        // Afterwards it swims again.
        expect(school.airborne(index)).toBe(false);
        expect(school.y[index]).toBeLessThan(0);
        expect(school.mode[index]).toBe(0);
    });

    it('leaps higher for more power, turns over in the air when asked, and waits when told to', () => {
        const flight = (options) => {
            const school = make();
            run(school, 10);
            const index = school.leap({ side: 1, ...options });
            const out = {
                index, peak: -Infinity, roll: 0, breach: null,
            };
            run(school, 6, (k, s) => {
                if (k.airborne(index)) {
                    out.peak = Math.max(out.peak, k.y[index]);
                    out.roll = Math.max(out.roll, Math.abs(k.roll[index]));
                    if (out.breach === null) out.breach = s * DT;
                }
            });
            return out;
        };
        const low = flight({ power: 0.6 });
        const plain = flight({ power: 1 });
        const high = flight({ power: 1.6 });
        expect(plain.index).toBe(low.index); // the same fish is the best placed each time
        expect(plain.peak).toBeGreaterThan(low.peak + 0.1);
        expect(high.peak).toBeGreaterThan(plain.peak + 0.1);
        // Nonsense power is held to what a koi can do.
        expect(flight({ power: 1e6 }).peak).toBeLessThan(4);
        expect(flight({ power: -5 }).peak).toBeGreaterThan(0.2);
        expect(plain.roll).toBeLessThan(0.6);
        expect(flight({ power: 1, twist: true }).roll).toBeGreaterThan(Math.PI); // at least half a turn
        // (A second's wait, then the run-up, which is never shorter than 0.38 s.)
        expect(flight({ power: 1, delay: 1 }).breach).toBeGreaterThan(1.37);
        expect(plain.breach).toBeLessThan(1.37);
    });

    it('picks a koi from the side it is asked for, a different one each time, and says when none can go', () => {
        const school = make();
        run(school, 10);
        const left = school.leap({ side: -1 });
        const right = school.leap({ side: 1 });
        const any = school.leap();
        expect(school.x[left]).toBeLessThan(0);
        expect(school.x[right]).toBeGreaterThan(0);
        expect(new Set([left, right, any]).size).toBe(3);
        // Ask for more than there are: every koi goes at most once, then the answer is no.
        const sent = new Set([left, right, any]);
        let refused = 0;
        for (let k = 0; k < school.count + 4; k++) {
            const index = school.leap();
            if (index < 0) refused += 1;
            else {
                expect(sent.has(index)).toBe(false);
                sent.add(index);
            }
        }
        expect(refused).toBeGreaterThanOrEqual(4);
        expect(sent.size).toBeLessThanOrEqual(school.count);
        // All of them come down again and can be asked again.
        run(school, 8);
        expect(range(school.count).some((i) => school.airborne(i))).toBe(false);
        expect(school.leap()).toBeGreaterThanOrEqual(0);
    });

    it('brings every leaping koi down in water it can swim in, clear of the rocks, on every tier', () => {
        // A calm school, one leap every two seconds from alternate reaches: the gentlest the game ever asks.
        const dry = [];
        for (const name of QUALITY_NAMES) {
            const school = make(QUALITY[name].koi);
            let splashes = 0;
            run(school, 130, (k, s) => {
                if (s >= 300 && s % 120 === 0) {
                    const n = s / 120;
                    k.leap({ side: n % 2 ? 1 : -1, power: 0.9 + (n % 4) * 0.15, twist: n % 5 === 0 });
                }
                for (const event of k.events) {
                    if (event.type !== 'splash') continue;
                    splashes += 1;
                    const at = `(${event.x.toFixed(2)}, ${event.z.toFixed(2)})`;
                    const depth = waterDepth(event.x, event.z);
                    const shallow = `came down at ${at} in ${depth.toFixed(2)} m of water`;
                    if (!(depth > 0.2)) dry.push(`${name}: koi ${event.index} ${shallow}`);
                    if (inRock(event.x, event.z)) dry.push(`${name}: koi ${event.index} came down on a rock at ${at}`);
                }
            });
            expect(splashes, name).toBeGreaterThan(50);
        }
        expect(dry).toEqual([]);
    });

    it('brings every leaping koi down inside the picture', () => {
        // "It must come down in water it can swim in, in the picture, not behind the card."
        const school = make();
        const lost = [];
        const hidden = [];
        let splashes = 0;
        run(school, 130, (k, s) => {
            if (s >= 300 && s % 120 === 0) {
                const n = s / 120;
                k.leap({ side: n % 2 ? 1 : -1, power: 0.9 + (n % 4) * 0.15, twist: n % 5 === 0 });
            }
            for (const event of k.events) {
                if (event.type !== 'splash') continue;
                splashes += 1;
                const where = `(${event.x.toFixed(2)}, ${event.z.toFixed(2)})`;
                if (!picture(event.x, event.z)) lost.push(where);
                if (behindTheCard(event.x, event.z)) hidden.push(where);
            }
        });
        expect(splashes).toBeGreaterThan(50);
        expect({ splashesBehindTheCard: hidden.length, first: hidden.slice(0, 6) })
            .toEqual({ splashesBehindTheCard: 0, first: [] });
        expect({ splashesOutsideA16by9Frame: lost.length, of: splashes, first: lost.slice(0, 6) })
            .toEqual({ splashesOutsideA16by9Frame: 0, of: splashes, first: [] });
    });

    it('draws the koi into one ring round the board as a chain grows, the big ones first', () => {
        const school = make();
        run(school, 10);
        const rest = mean(Array.from(school.speed));
        const joined = () => range(school.count).filter((i) => school.joined[i] > 0.5);
        // One clear is not a chain.
        school.setChain(1);
        run(school, 6);
        expect(joined()).toEqual([]);
        expect(Math.max(...school.glow)).toBe(0);
        // Two: the longest fish leave their lanes, alight.
        school.setChain(2);
        run(school, 8);
        const leaders = joined();
        expect(leaders.length).toBeGreaterThan(0);
        expect(leaders.length).toBeLessThan(school.count / 2);
        expect(leaders.map((i) => school.fish[i].order).sort((p, q) => p - q)).toEqual(range(leaders.length));
        for (const i of leaders) expect(school.glow[i], `koi ${i}`).toBeGreaterThan(0.2);
        const others = range(school.count).filter((k) => !leaders.includes(k));
        for (const i of others) expect(school.glow[i], `koi ${i}`).toBe(0);
        // More with every step...
        school.setChain(5);
        run(school, 8);
        const more = joined();
        expect(more.length).toBeGreaterThan(leaders.length);
        for (const i of leaders) expect(more).toContain(i);
        const middling = mean(more.map((i) => school.speed[i]));
        const dim = mean(more.map((i) => school.glow[i]));
        // ...until the whole school swims the ring: round the card, all the same way, faster and brighter.
        school.setChain(9);
        const onRing = (i) => [
            (school.x[i] - CHAIN_RING.x) / CHAIN_RING.radiusX, (school.z[i] - CHAIN_RING.z) / CHAIN_RING.radiusZ,
        ];
        const ringAngle = (i) => Math.atan2(onRing(i)[1], onRing(i)[0]);
        const turned = new Float64Array(school.count);
        let last = null;
        run(school, 40, (k, s) => {
            if (s < 60 * 20) return; // let them gather first
            const now = range(k.count).map(ringAngle);
            if (last) {
                now.forEach((value, i) => {
                    let step = value - last[i];
                    if (step > Math.PI) step -= Math.PI * 2;
                    if (step < -Math.PI) step += Math.PI * 2;
                    turned[i] += step;
                });
            }
            last = now;
        });
        expect(joined()).toHaveLength(school.count);
        const way = Math.sign(turned[0]);
        for (let i = 0; i < school.count; i++) {
            const out = Math.hypot(...onRing(i));
            expect(out, `koi ${i}`).toBeGreaterThan(0.35);
            expect(out, `koi ${i}`).toBeLessThan(1.9);
            // A good part of a lap in twenty seconds, the same way round as the rest.
            expect(turned[i] * way, `koi ${i}`).toBeGreaterThan(2);
            expect(school.glow[i], `koi ${i}`).toBeGreaterThan(0.9);
        }
        expect(mean(Array.from(school.speed))).toBeGreaterThan(middling);
        expect(middling).toBeGreaterThan(rest);
        expect(mean(Array.from(school.glow))).toBeGreaterThan(dim);
        // Alight, they pour light into the water behind them.
        const wakes = new Float32Array(school.count * 6);
        const written = school.writeWakes(wakes, DT);
        expect(written).toBe(school.count);
        expect(range(written).every((n) => wakes[n * 6 + 4] > 0)).toBe(true);
        // A longer chain asks no more than the whole school.
        school.setChain(40);
        run(school, 2);
        expect(joined()).toHaveLength(school.count);

        // The chain breaks: back to their lanes, the light gone.
        school.setChain(0);
        run(school, 25);
        expect(joined()).toEqual([]);
        expect(Math.max(...school.glow)).toBeLessThan(0.01);
        expect(Math.max(...school.joined)).toBeLessThan(0.01);
        expect(mean(Array.from(school.speed))).toBeLessThan(middling);
        // Nonsense is no chain.
        school.setChain(-3);
        expect(school.chain).toBe(0);
        school.setChain(2.6);
        expect(school.chain).toBe(3);
    });

    it('holds the school all but still for a breath, then lets it go', () => {
        for (const hold of [0.34, 1.5]) {
            const school = make();
            const free = make();
            run(school, 12);
            run(free, 12);
            const before = range(school.count).map((i) => [school.x[i], school.z[i]]);
            school.holdBreath(hold);
            expect(school.hush).toBe(hold);
            school.holdBreath(0.1); // a shorter hold never cuts a longer one short
            expect(school.hush).toBe(hold);
            run(school, hold);
            run(free, hold);
            // Slower than they would have been, and they have barely moved.
            const held = mean(Array.from(school.speed));
            expect(held).toBeLessThan(mean(Array.from(free.speed)) * (hold > 1 ? 0.35 : 0.8));
            const moved = mean(before.map(([x, z], i) => Math.hypot(school.x[i] - x, school.z[i] - z)));
            const wouldHave = mean(before.map(([x, z], i) => Math.hypot(free.x[i] - x, free.z[i] - z)));
            expect(moved).toBeLessThan(wouldHave);
            expect(school.hush).toBeLessThan(0.02);
            // A few seconds on they swim as before.
            run(school, 4);
            run(free, 4);
            expect(school.hush).toBe(0);
            expect(mean(Array.from(school.speed))).toBeGreaterThan(held * 1.2);
            expect(mean(Array.from(school.speed))).toBeCloseTo(mean(Array.from(free.speed)), 1);
        }
    });
});

describe('koi school: every koi stays in the water', () => {
    /** Where no koi may ever be: up the bank, inside a standing rock, off the water the waves are simulated on. */
    const where = (seen) => ({
        onTheBank: seen.onTheBank, inARock: seen.inARock, outsideTheRectangle: seen.outsideTheRectangle,
    });
    const NEVER = { onTheBank: NOWHERE, inARock: NOWHERE, outsideTheRectangle: NOWHERE };
    const events = Object.keys(SCENARIOS).filter((name) => name !== 'left alone');

    it.each(QUALITY_NAMES)('left alone, the %s tier keeps every koi in the water and off the rocks', (tier) => {
        expect(where(record('left alone', QUALITY[tier].koi))).toEqual(NEVER);
    });

    it.each(events)('%s: no koi is ever on the bank, in a rock or off the simulated water', (name) => {
        expect(where(record(name, HIGH))).toEqual(NEVER);
    });

    it('played hard, the smallest school stays in the water too', () => {
        expect(where(record('played hard: a chain with leaps and frights', QUALITY.Minimal.koi))).toEqual(NEVER);
    });

    it('never produces a number that is not one, and never moves a koi faster than a koi can sprint', () => {
        for (const name of Object.keys(SCENARIOS)) {
            const seen = record(name, HIGH);
            expect(seen.notFinite, name).toBe(0);
            expect(seen.fastest, name).toBeLessThan(10); // metres a second: it sprints, it does not teleport
        }
    });

    it('plays what it says: the scenarios really leap, chain and frighten', () => {
        expect(record('left alone', HIGH).events.breach ?? 0).toBe(0);
        expect(record('sent over the water one at a time', HIGH).events.splash).toBeGreaterThan(30);
        expect(record('sent over the water six at a time', HIGH).events.splash).toBeGreaterThan(60);
        expect(record('played hard: a chain with leaps and frights', HIGH).events.splash).toBeGreaterThan(100);
    });
});
