/**
 * Murmuration — the living pass (2026-11): the flock's moods, the things that happen by
 * themselves, the front of light each event sends, and the figures of its biggest moments.
 * Relations, not tuning numbers.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';
import {
    FRONT, FRONT_ROWS, FrontTable, MAX_FRONTS,
} from '../../src/themes/murmuration/composition/swarm-fronts.js';
import {
    HAPPENING_LENGTH, HAPPENING_ROUND, HAPPENING_SLOT, MOODS, MOOD_KEYS, falconPath, happeningAt, meteorLine,
    moodAt, moodForm, moodPhase, stepMood,
} from '../../src/themes/murmuration/composition/swarm-moods.js';
import { SwarmShow } from '../../src/themes/murmuration/composition/swarm-show.js';
import { MIN_FIGURE_BAND, shapeLayout, skyPixel } from '../../src/themes/murmuration/composition/swarm-tiers.js';
import {
    FluidParticleSim, IMPULSE_TYPE, formRadius, formSlope,
} from '../../src/themes/murmuration/sim/fluid-particles.js';
import { generateShape } from '../../src/themes/murmuration/sim/shape-formations.js';

const FOCAL = Object.freeze({ x: 0, y: 0, z: -1.5 });
const QUAD = Object.freeze({ lines: 4, rows: [19, 18, 17, 16] });
const WIDE = Object.freeze({ halfWidth: 10.1, halfHeight: 5.68, aspect: 16 / 9 });

function makeShow(options = {}) {
    const impulses = [];
    const sim = {
        pushImpulse: vi.fn((position, strength, dir, type, wave) => {
            impulses.push({
                position: { ...position }, strength, dir, type, wave,
            });
            return impulses.length - 1;
        }),
        impulseId: vi.fn((slot) => slot + 1),
        steerImpulse: vi.fn(() => true),
        setShape: vi.fn(() => true),
        setShapeStrength: vi.fn(),
        setShapePose: vi.fn(),
        setShapeFlap: vi.fn(),
        setForm: vi.fn(),
        hasRoomBeside: vi.fn(() => options.beside === true),
    };
    const show = new SwarmShow({
        sim, focal: FOCAL, random: () => 0, ...options,
    });
    show.setFrame(WIDE);
    return { show, sim, impulses };
}

function run(show, from, seconds, rate = 60) {
    const frames = Math.round(seconds * rate);
    let time = from;
    for (let i = 0; i < frames; i += 1) {
        time += 1 / rate;
        show.update(1 / rate, time);
    }
    return time;
}

const live = (show) => show.fronts.fronts.filter((front) => front.live);

describe('murmuration fronts: the table the mote shader reads', () => {
    it('packs the live fronts to the head of the rows and frees the spent ones', () => {
        const rows = Array.from({ length: MAX_FRONTS * FRONT_ROWS }, () => new THREE.Vector4());
        const count = { value: -1 };
        const table = new FrontTable({ rows, count });
        table.update(1);
        expect(count.value).toBe(0);
        table.add({
            kind: FRONT.ring, x: 2, y: -1, speed: 5, width: 0.3, reach: 4, light: 1, life: 1,
        });
        table.add({
            kind: FRONT.beam, x: 0, y: -4, speed: 13, light: 0.8, life: 2, delay: 0.5, angle: 0.5, rgb: [1, 0.5, 0.25],
        });
        // The second is waiting for its moment: only the first is written.
        expect(table.update(1.2)).toBe(1);
        expect(count.value).toBe(1);
        expect(rows[0].toArray().slice(0, 2)).toEqual([2, -1]);
        expect(rows[0].z).toBeCloseTo(0.2, 9); // its age
        expect(rows[0].w).toBe(FRONT.ring);
        expect(rows[1].w).toBeGreaterThan(0);
        expect(table.pending()).toBe(2);
        expect(table.update(1.9)).toBe(2);
        expect(rows[FRONT_ROWS].w).toBe(FRONT.beam);
        // A beam's row of its own: its direction (a unit vector), and its glow.
        const d = rows[FRONT_ROWS + 3];
        expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 9);
        expect(d.y).toBeGreaterThan(0);
        expect(rows[FRONT_ROWS + 2].toArray().slice(0, 3)).toEqual([1, 0.5, 0.25]);
        // The ring's life is over: the beam moves up to the first rows.
        expect(table.update(2.3)).toBe(1);
        expect(rows[0].w).toBe(FRONT.beam);
        expect(table.update(9)).toBe(0);
        expect(table.pending()).toBe(0);
    });

    it('rises quickly, falls over the end of its life, and is nothing outside it', () => {
        const front = {
            light: 2, life: 1, attack: 0.05,
        };
        expect(FrontTable.envelope(front, -0.1)).toBe(0);
        expect(FrontTable.envelope(front, 0.025)).toBeCloseTo(1, 9);
        expect(FrontTable.envelope(front, 0.3)).toBe(2);
        expect(FrontTable.envelope(front, 0.8)).toBeLessThan(2);
        expect(FrontTable.envelope(front, 0.8)).toBeGreaterThan(0);
        expect(FrontTable.envelope(front, 1)).toBe(0);
    });

    it('gives a full table\'s faintest slot to a new front, and refuses a front with no light', () => {
        const table = new FrontTable();
        for (let i = 0; i < MAX_FRONTS; i += 1) {
            table.add({ kind: FRONT.ring, light: 1 + i, life: 4 });
        }
        table.update(0.5);
        expect(table.add({ kind: FRONT.ring, light: 0 })).toBeNull();
        const taken = table.add({ kind: FRONT.chevron, light: 9, life: 1 });
        expect(table.pending()).toBe(MAX_FRONTS);
        expect(taken.kind).toBe(FRONT.chevron);
        // The faintest (the first, light 1) is the one that went.
        expect(table.fronts.some((front) => front.kind === FRONT.ring && front.light === 1)).toBe(false);
    });
});

describe('murmuration moods: the flock is never one shape for long', () => {
    it('opens on the ring it has always been, and gives every mood a form and a sky of its own', () => {
        expect(MOODS[0].id).toBe('wheel');
        expect(MOODS[0].lean).toBe(0);
        expect(MOODS[0].wings).toBe(0);
        expect(moodForm(MOODS[0], 123).map(Math.abs)).toEqual([1, 0, 0, 0, 0]);
        expect(new Set(MOODS.map((mood) => mood.id)).size).toBe(MOODS.length);
        for (const key of MOOD_KEYS) {
            // No number is the same in every mood: each one is a different flock.
            expect(new Set(MOODS.map((mood) => mood[key])).size, key).toBeGreaterThan(1);
        }
    });

    it('rests on a mood, melts into the next, and goes round the wheel', () => {
        const pure = moodAt(2, {});
        for (const key of MOOD_KEYS) expect(pure[key]).toBe(MOODS[2][key]);
        const half = moodAt(2.5, {});
        for (const key of MOOD_KEYS) {
            expect(half[key]).toBeCloseTo((MOODS[2][key] + MOODS[3][key]) / 2, 9);
        }
        expect(moodAt(MOODS.length, {}).gyre).toBe(MOODS[0].gyre);
        // The clock alone turns it, in every mode; a level is one step on top.
        expect(moodPhase(0, 10)).toBe(0);
        expect(moodPhase(0, 2000)).toBeGreaterThan(5);
        expect(moodPhase(2, 10)).toBe(2);
        expect(stepMood(0, 3, 1)).toBe(2);
        // … the short way round: from the fourth mood, level 6 (the first again) is one step on.
        expect(stepMood(4, 6, 1)).toBe(5);
        expect(stepMood(0, 2, 0.25)).toBeCloseTo(0.25, 9);
    });

    it('keeps every form a wall the flock fits inside, with wings along the frame\'s free axis', () => {
        for (const mood of MOODS) {
            for (const time of [0, 37, 211, 999]) {
                const form = moodForm(mood, time, 16 / 9);
                let most = 0;
                let least = Infinity;
                for (let a = 0; a < 360; a += 3) {
                    const r = formRadius(form, Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180));
                    most = Math.max(most, r);
                    least = Math.min(least, r);
                }
                // Never past the ring it has at rest (the frame is fitted to that), never inside out.
                expect(most, mood.id).toBeLessThanOrEqual(1 + 1e-9);
                expect(least, mood.id).toBeGreaterThan(0.2);
            }
        }
        // Wide frame: the wings reach out beside the board. A phone: above and below it.
        const wings = MOODS.find((mood) => mood.id === 'wings');
        const wide = moodForm(wings, 0, 16 / 9);
        const tall = moodForm(wings, 0, 390 / 844);
        expect(formRadius(wide, 1, 0)).toBeGreaterThan(formRadius(wide, 0, 1));
        expect(formRadius(tall, 0, 1)).toBeGreaterThan(formRadius(tall, 1, 0));
    });

    it('has a slope that is the radius\'s own derivative (the gyre follows the form by it)', () => {
        const form = [0.6, 0.12, -0.07, 0.2, 0.09];
        for (let a = 0.1; a < 6.2; a += 0.37) {
            const h = 1e-5;
            const numeric = (formRadius(form, Math.cos(a + h), Math.sin(a + h))
                - formRadius(form, Math.cos(a - h), Math.sin(a - h))) / (2 * h);
            expect(formSlope(form, Math.cos(a), Math.sin(a))).toBeCloseTo(numeric, 6);
        }
    });
});

describe('murmuration happenings: what the sky and the flock do unasked', () => {
    it('is a pure function of the clock: one happening a slot, inside its slot, none twice running', () => {
        for (let slot = 0; slot < 24; slot += 1) {
            const start = slot * HAPPENING_SLOT;
            const h = happeningAt(start + 1, {});
            expect(h.slot).toBe(slot);
            expect(h.kind).toBe(HAPPENING_ROUND[slot % HAPPENING_ROUND.length]);
            expect(h.at).toBeGreaterThanOrEqual(start + 4);
            expect(h.at + h.length).toBeLessThanOrEqual(start + HAPPENING_SLOT);
            expect(h.length).toBe(HAPPENING_LENGTH[h.kind]);
            // The same answer wherever in the slot it is asked, and live only inside its window.
            const later = happeningAt(start + HAPPENING_SLOT - 0.01, {});
            expect(later.at).toBe(h.at);
            expect(later.seed).toBe(h.seed);
            expect(happeningAt(h.at + h.length / 2, {}).live).toBe(true);
            expect(happeningAt(h.at - 0.01, {}).live).toBe(false);
            expect(happeningAt(h.at + h.length + 0.01, {}).live).toBe(false);
        }
        HAPPENING_ROUND.forEach((kind, i) => {
            expect(kind).not.toBe(HAPPENING_ROUND[(i + 1) % HAPPENING_ROUND.length]);
        });
    });

    it('starts a shooting star high in the frame and lets it fall outward, on either side', () => {
        const sides = new Set();
        for (let i = 0; i < 40; i += 1) {
            const [x, y, angle] = meteorLine(i / 40 + 0.013, 16 / 9);
            sides.add(Math.sign(x));
            expect(y).toBeGreaterThan(0.344 * 0.7);
            expect(Math.abs(x)).toBeLessThan(0.344 * (16 / 9) * 0.6);
            // Down, and away from the board's column.
            expect(Math.sin(angle)).toBeLessThan(0);
            expect(Math.sign(Math.cos(angle))).toBe(Math.sign(x));
        }
        expect(sides.size).toBe(2);
    });

    it('flies the falcon one straight stoop through a wing, from above the frame to below it', () => {
        for (const seed of [0.1, 0.45, 0.8]) {
            const top = falconPath(seed, 0, WIDE, {});
            const bottom = falconPath(seed, 1, WIDE, {});
            expect(top.y).toBeGreaterThan(WIDE.halfHeight);
            expect(bottom.y).toBeLessThan(-WIDE.halfHeight);
            // Beside the board, never through its column.
            expect(Math.abs(top.x)).toBeGreaterThan(WIDE.halfWidth * 0.3);
            expect(Math.sign(top.x)).toBe(Math.sign(bottom.x));
        }
    });

    it('steers a push of its own through the flock for a stoop and lets go of it after', () => {
        const { show, sim, impulses } = makeShow();
        const slot = HAPPENING_ROUND.indexOf('falcon');
        const h = happeningAt(slot * HAPPENING_SLOT + 1, {});
        let time = run(show, h.at - 0.5, 0.4);
        expect(impulses).toHaveLength(0);
        time = run(show, time, 1.2);
        // One standing wave (it does not travel or fade by itself), steered frame by frame.
        expect(impulses).toHaveLength(1);
        expect(impulses[0].type).toBe(IMPULSE_TYPE.RADIAL);
        expect(impulses[0].wave).toMatchObject({ speed: 0, decay: 0 });
        expect(sim.steerImpulse.mock.calls.length).toBeGreaterThan(30);
        const mid = sim.steerImpulse.mock.calls.at(-1);
        expect(mid[3]).toBeGreaterThan(0);
        expect(live(show).some((front) => front.speed === 0)).toBe(true);
        run(show, time, 3);
        // Over: the last steer hands the push back at nothing.
        expect(sim.steerImpulse.mock.calls.at(-1)[3]).toBe(0);
        expect(show.getState().happening).toBeNull();
        // Under reduced motion there is no stoop at all.
        const calm = makeShow();
        calm.show.reducedMotion = true;
        run(calm.show, h.at - 0.5, 3);
        expect(calm.impulses).toHaveLength(0);
    });

    it('lands a seek inside a happening on the same sky a run shows, at any frame rate', () => {
        const slot = HAPPENING_ROUND.indexOf('shower');
        const h = happeningAt(slot * HAPPENING_SLOT + 1, {});
        const skyFor = (rate) => {
            const sky = {
                uniforms: {
                    uHeat: { value: 0 }, uPulse: { value: 0 }, uMeteorCount: { value: 0 },
                },
                meteorRows: Array.from({ length: 6 }, () => new THREE.Vector4()),
            };
            const { show } = makeShow({ sky });
            run(show, h.at - 1, 3.5, rate);
            return sky;
        };
        const a = skyFor(60);
        const b = skyFor(30);
        expect(a.uniforms.uMeteorCount.value).toBeGreaterThan(0);
        expect(b.uniforms.uMeteorCount.value).toBe(a.uniforms.uMeteorCount.value);
        for (let i = 0; i < a.uniforms.uMeteorCount.value; i += 1) {
            a.meteorRows[i].toArray().forEach((v, k) => expect(b.meteorRows[i].toArray()[k]).toBeCloseTo(v, 6));
        }
    });
});

describe('murmuration show: an instrument for every event', () => {
    it('answers each event with a front of its own shape', () => {
        const kinds = (fire) => {
            const { show } = makeShow();
            show.update(0, 1);
            fire(show);
            return show.fronts.fronts.filter((front) => front.live).map((front) => front.kind);
        };
        expect(kinds((show) => show.lock({ rows: [18] }))).toEqual([FRONT.ring]);
        expect(kinds((show) => show.lock({ rows: [18], hardDrop: true }))).toEqual([FRONT.chevron]);
        expect(kinds((show) => show.clear({ lines: 2, rows: [19, 18] }))).toEqual([FRONT.beam, FRONT.beam]);
        expect(kinds((show) => show.clear(QUAD))).toEqual([FRONT.beam, FRONT.beam, FRONT.beam, FRONT.beam]);
        expect(kinds((show) => show.spin({ rows: [18] }))).toEqual([FRONT.pinwheel]);
        expect(kinds((show) => show.clear({ lines: 1, rows: [19], twist: true })))
            .toEqual([FRONT.beam, FRONT.pinwheel]);
        expect(kinds((show) => show.clear({ lines: 1, rows: [19], b2b: true })))
            .toEqual([FRONT.beam, FRONT.answer]);
    });

    it('gives a lock\'s puff the piece\'s own colour, and holds a quick hand back', () => {
        const { show } = makeShow();
        show.update(0, 1);
        show.lock({ rows: [18], color: '#ff0000' });
        const [first] = live(show);
        expect(first.r).toBeGreaterThan(0.9);
        expect(first.g).toBeLessThan(0.05);
        // Four locks in a quarter of a second: each puff fainter than the last.
        let time = 1;
        const lights = [first.light];
        for (let i = 0; i < 3; i += 1) {
            time = run(show, time, 0.08);
            show.lock({ rows: [18], color: '#ff0000' });
            // (The newest front is the one sent last: the table hands out its free slots in order.)
            lights.push(live(show).reduce((a, b) => (b.at > a.at ? b : a)).light);
        }
        for (let i = 1; i < lights.length; i += 1) expect(lights[i]).toBeLessThan(lights[i - 1]);
        // … and a rested hand is whole again.
        time = run(show, time, 6);
        show.lock({ rows: [18], color: '#ff0000' });
        expect(live(show).at(-1).light).toBeGreaterThan(lights.at(-1));
    });

    it('sends a beam for each cleared row, at a height of its own, and brings them back for a back-to-back', () => {
        const { show } = makeShow();
        show.update(0, 1);
        show.clear({ lines: 3, rows: [19, 18, 17] });
        const beams = live(show);
        expect(beams).toHaveLength(3);
        // Three different climbs: a fan, to be counted.
        const climbs = beams.map((front) => Math.atan2(front.dy, front.dx));
        expect(new Set(climbs.map((a) => a.toFixed(3))).size).toBe(3);
        expect(Math.max(...climbs) - Math.min(...climbs)).toBeGreaterThan(0.3);
        // Struck one after another, not all at once.
        expect(new Set(beams.map((front) => front.at)).size).toBe(3);
        // The answer comes back later along the same lines, in gold.
        const b2b = makeShow();
        b2b.show.update(0, 1);
        b2b.show.clear({ lines: 2, rows: [19, 18], b2b: true });
        const out = live(b2b.show).filter((front) => front.kind === FRONT.beam);
        const back = live(b2b.show).filter((front) => front.kind === FRONT.answer);
        expect(back).toHaveLength(out.length);
        back.forEach((front, i) => {
            expect(front.at).toBeGreaterThan(out[i].at + 0.2);
            expect(front.dy).toBeCloseTo(out[i].dy, 9);
            expect(front.r).toBeGreaterThan(front.b * 2);
        });
    });

    it('spreads the great wings for four lines: the board is their body where there is room', () => {
        const beside = makeShow({ beside: true });
        beside.show.clear(QUAD);
        expect(beside.sim.setShape).toHaveBeenLastCalledWith('wings', expect.objectContaining({ layout: 'center' }));
        const narrow = makeShow({ beside: false });
        narrow.show.clear(QUAD);
        const [, opts] = narrow.sim.setShape.mock.calls.at(-1);
        expect(opts.layout).toBeUndefined();
        // They beat, and never turn; under reduced motion they beat less.
        run(beside.show, 0, 1.5);
        const [phase, swing] = beside.sim.setShapeFlap.mock.calls.at(-1);
        expect(swing).toBeGreaterThan(0.1);
        expect(phase).toBeGreaterThan(1);
        expect(beside.sim.setShapePose.mock.calls.at(-1)[0]).toBe(0);
        const calm = makeShow({ beside: true });
        calm.show.reducedMotion = true;
        calm.show.clear(QUAD);
        run(calm.show, 0, 1.5);
        expect(calm.sim.setShapeFlap.mock.calls.at(-1)[1]).toBeLessThan(swing);
        // Any other figure does not beat.
        const other = makeShow();
        other.show.clear({ lines: 3, rows: [19, 18, 17] });
        run(other.show, 0, 1);
        expect(other.sim.setShapeFlap.mock.calls.at(-1)[1]).toBe(0);
    });

    it('lights a chain\'s step as a fuse down the ribbons, and a level as a wave of colour', () => {
        const visual = {
            baseExposure: 1,
            uniforms: {
                uHeat: { value: 0 },
                uPalettePhase: { value: 0 },
                uShapeColor: { value: 0 },
                uExposure: { value: 1 },
                uFuse: { value: new THREE.Vector2() },
                uWipe: { value: new THREE.Vector3() },
                uWipeAxis: { value: new THREE.Vector2(1, 0) },
            },
        };
        const { show } = makeShow({ visual });
        let time = run(show, 0, 0.5);
        expect(visual.uniforms.uFuse.value.y).toBe(0);
        expect(visual.uniforms.uWipe.value.z).toBe(0);
        show.combo(1);
        show.combo(2);
        time = run(show, time, 0.3);
        const early = visual.uniforms.uFuse.value.clone();
        expect(early.y).toBeGreaterThan(0);
        time = run(show, time, 0.4);
        // It runs on down the ribbon, and is spent in a little over a second.
        expect(visual.uniforms.uFuse.value.x).toBeGreaterThan(early.x);
        time = run(show, time, 1);
        expect(visual.uniforms.uFuse.value.y).toBe(0);

        show.levelUp(2);
        time = run(show, time, 0.4);
        const wipe = visual.uniforms.uWipe.value.clone();
        // The motes already wear the new palette; ahead of the front the old one still shows.
        expect(visual.uniforms.uPalettePhase.value).toBe(show.palettePhaseTarget);
        expect(wipe.y).toBeGreaterThan(0);
        expect(wipe.z).toBeGreaterThan(0);
        expect(wipe.x).toBeLessThan(0);
        time = run(show, time, 1.2);
        expect(visual.uniforms.uWipe.value.x).toBeGreaterThan(wipe.x);
        run(show, time, 2);
        expect(visual.uniforms.uWipe.value.y).toBe(0);
        expect(visual.uniforms.uWipe.value.z).toBe(0);
    });

    it('sweeps the whole flock with one fold of light for a great turn, without changing its colours', () => {
        const visual = {
            baseExposure: 1,
            uniforms: {
                uHeat: { value: 0 },
                uPalettePhase: { value: 0 },
                uShapeColor: { value: 0 },
                uExposure: { value: 1 },
                uWipe: { value: new THREE.Vector3() },
                uWipeAxis: { value: new THREE.Vector2(1, 0) },
            },
        };
        const { show } = makeShow({ visual });
        const h = happeningAt(HAPPENING_ROUND.indexOf('turn') * HAPPENING_SLOT + 1, {});
        run(show, h.at - 0.3, 0.3 + h.length / 2);
        const { uWipe, uWipeAxis } = visual.uniforms;
        expect(uWipe.value.z).toBeGreaterThan(0.5);
        expect(uWipe.value.y).toBe(0);
        expect(Math.hypot(uWipeAxis.value.x, uWipeAxis.value.y)).toBeCloseTo(1, 9);
        expect(show.palettePhase).toBe(0);
    });

    it('turns the flock through its moods by the clock, and pins one when asked', () => {
        const { show, sim } = makeShow();
        run(show, 0, 1);
        expect(sim.setForm).toHaveBeenLastCalledWith(1, 0, 0, 0, 0);
        const { gyre } = show.simParams;
        show.moodHold = 3;
        run(show, 1, 0.1);
        expect(show.getState().mood).toBe(3);
        expect(show.simParams.gyre).toBeGreaterThan(gyre);
        expect(sim.setForm.mock.calls.at(-1)[0]).toBeLessThan(1);
        show.moodHold = null;
        // Left to the clock, some minutes on the flock is another shape.
        run(show, 400, 0.1);
        expect(show.getState().mood).toBeGreaterThan(2);
    });

    it('lifts the roost by itself after a while, and in a rush when a new run starts', () => {
        const { show, impulses } = makeShow();
        show.gameOver();
        let time = run(show, 0, 10);
        expect(show.isRoosting()).toBe(true);
        time = run(show, time, 8);
        expect(show.isRoosting()).toBe(false);
        expect(impulses).toHaveLength(0);
        // From the roost, the start of a run pushes the flock up from under the frame …
        show.gameOver();
        run(show, time, 3);
        show.gameStart();
        expect(show.isRoosting()).toBe(false);
        expect(impulses).toHaveLength(1);
        expect(impulses[0].position.y).toBeLessThan(-WIDE.halfHeight);
        expect(impulses[0].wave).toBeTruthy();
        // … and every start sends first light up through it.
        const dawn = live(show).at(-1);
        expect(dawn.kind).toBe(FRONT.ring);
        expect(dawn.y).toBeLessThan(-WIDE.halfHeight);
        show.gameStart();
        expect(impulses).toHaveLength(1);
    });
});

describe('murmuration figures: the wings and the roost', () => {
    const fill = (name, n, opts) => {
        const arr = new Float32Array(n * 4);
        expect(generateShape(name, arr, n, opts)).toBe(true);
        return arr;
    };

    it('unfolds the wings from the card\'s edges when the board is their body', () => {
        const frame = { halfWidth: 9, halfHeight: 4.9 };
        const arr = fill('wings', 6000, {
            layout: 'center', room: true, blocked: 2.9, frame,
        });
        let left = 0;
        let right = 0;
        let reach = 0;
        for (let i = 0; i < 6000; i += 1) {
            const x = arr[i * 4];
            const y = arr[i * 4 + 1];
            // Nothing behind the boards, nothing outside the frame the figures are fitted to.
            expect(Math.abs(x)).toBeGreaterThan(2.9);
            expect(Math.abs(x)).toBeLessThanOrEqual(frame.halfWidth);
            expect(Math.abs(y)).toBeLessThanOrEqual(frame.halfHeight);
            expect(arr[i * 4 + 3]).toBe(1);
            if (x < 0) left += 1; else right += 1;
            reach = Math.max(reach, Math.abs(x));
        }
        // A pair, alike, out to the frame's edge.
        expect(left).toBe(right);
        expect(reach).toBeGreaterThan(frame.halfWidth * 0.9);
    });

    it('draws a whole bird (a body between its wings) where the boards leave no room beside them', () => {
        const arr = fill('wings', 6000, {});
        let body = 0;
        let mirror = 0;
        for (let i = 0; i < 6000; i += 1) {
            if (Math.abs(arr[i * 4]) < 0.55) body += 1;
            mirror += arr[i * 4];
        }
        expect(body).toBeGreaterThan(600);
        // Symmetric about its own middle.
        expect(Math.abs(mirror / 6000)).toBeLessThan(0.05);
    });

    it('lays the roost along the foot of the frame it is given, edge to edge', () => {
        for (const frame of [{ halfWidth: 9, halfHeight: 4.9 }, { halfWidth: 2.4, halfHeight: 4.9 }]) {
            const arr = fill('roost', 4000, { frame });
            let low = 0;
            let minX = Infinity;
            let maxX = -Infinity;
            for (let i = 0; i < 4000; i += 1) {
                const x = arr[i * 4];
                const y = arr[i * 4 + 1];
                expect(Math.abs(x)).toBeLessThanOrEqual(frame.halfWidth);
                expect(y).toBeGreaterThanOrEqual(-frame.halfHeight);
                expect(y).toBeLessThan(0);
                if (y < -frame.halfHeight * 0.7) low += 1;
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
            }
            expect(low / 4000).toBeGreaterThan(0.8);
            expect(minX).toBeLessThan(-frame.halfWidth * 0.95);
            expect(maxX).toBeGreaterThan(frame.halfWidth * 0.95);
        }
    });

    it('stands a phone\'s figure in the band of sky above the boards, and twins it on a wide frame', () => {
        const wide = shapeLayout({ halfWidth: 10.1, halfHeight: 5.68 }, 2.9, { top: 5, bottom: -5 });
        expect(wide).toMatchObject({ twin: true, offsetY: 0, blocked: 2.9 });
        const frame = { halfWidth: 2.62, halfHeight: 5.68 };
        const phone = shapeLayout(frame, 2.4, { top: 3.9, bottom: -4.2 });
        expect(phone.twin).toBe(false);
        // Above the card's top, inside the frame, and no taller than the band.
        expect(phone.offsetY).toBeGreaterThan(3.9);
        expect(phone.offsetY + phone.halfHeight).toBeLessThan(frame.halfHeight);
        expect(phone.offsetY - phone.halfHeight).toBeGreaterThan(3.9);
        // A band too thin to draw in leaves the figure centred, as before.
        const full = shapeLayout(frame, 2.4, { top: frame.halfHeight - MIN_FIGURE_BAND * 0.5, bottom: -5.6 });
        expect(full.offsetY).toBe(0);
        // Thumbs are below on a phone: the figure goes under the boards only when there is far more room.
        const under = shapeLayout(frame, 2.4, { top: 5.2, bottom: -2 });
        expect(under.offsetY).toBeLessThan(-2);
        expect(shapeLayout(frame, 2.4).offsetY).toBe(0);
        expect(skyPixel(38, 1080)).toBeCloseTo((2 * Math.tan((19 * Math.PI) / 180)) / 1080, 12);
    });
});

describe('murmuration simulation: the form, the lift and the steered push', () => {
    it('gives a lifted figure its height, beats a winged one, and keeps a centred one where it is', () => {
        const sim = new FluidParticleSim(600, { cpu: true });
        sim.setShapeFit(2.3, 4.9);
        sim.setShapeLayout({
            twin: false, offsetY: 4.6, blocked: 2.4, halfWidth: 2.3, halfHeight: 0.5,
        });
        expect(sim.hasRoomBeside()).toBe(false);
        sim.setShape('wings', {});
        expect(sim.uShapeLift.value).toBe(4.6);
        // Fitted to the band: no taller than it.
        let tall = 0;
        for (let i = 0; i < sim.count; i += 1) tall = Math.max(tall, Math.abs(sim.targetData[i * 4 + 1]));
        expect(tall).toBeLessThan(0.5 + 0.2);
        sim.setShape('roost', { layout: 'center' });
        expect(sim.uShapeLift.value).toBe(0);
        sim.setShapeFlap(1.2, 0.2);
        expect(sim.uShapeFlap.value.toArray()).toEqual([1.2, 0.2]);
        sim.dispose();
    });

    it('lets only the impulse that was pushed be steered', () => {
        const sim = new FluidParticleSim(64, { cpu: true });
        const slot = sim.pushImpulse({ x: 1, y: 2, z: 0 }, 5, null, IMPULSE_TYPE.RADIAL, {
            radius: 0, width: 1, speed: 0, flash: 0, decay: 0,
        });
        const id = sim.impulseId(slot);
        expect(sim.steerImpulse(slot, id, { x: 3, y: -1, z: 0 }, 9)).toBe(true);
        expect(sim._impulsePositions[slot].value.toArray()).toEqual([3, -1, 0, 9]);
        // It stands: no decay, no travel.
        sim.decayImpulses(0.5);
        expect(sim._impulsePositions[slot].value.w).toBe(9);
        expect(sim._impulseWaves[slot].value.x).toBe(0);
        // Let go, the slot is free; whoever takes it cannot be steered by the old hand.
        expect(sim.steerImpulse(slot, id, { x: 0, y: 0, z: 0 }, 0)).toBe(true);
        const next = sim.pushImpulse({ x: 0, y: 0, z: 0 }, 2, null, IMPULSE_TYPE.RADIAL);
        expect(next).toBe(slot);
        expect(sim.steerImpulse(slot, id, { x: 7, y: 7, z: 7 }, 4)).toBe(false);
        expect(sim._impulsePositions[slot].value.w).toBe(2);
        sim.dispose();
    });

    it('keeps the flock inside a parted form and fills both of its wings (CPU twin)', () => {
        const sim = new FluidParticleSim(1500, {
            cpu: true, focalRadius: 9.5, gravityStrength: 0.65, turbulence: 0.6,
        });
        sim.setExtent(9.5, 4.5, 4.4);
        sim.reset();
        const form = moodForm(MOODS.find((mood) => mood.id === 'wings'), 0, 16 / 9);
        sim.setForm(...form);
        let time = 0;
        for (let i = 0; i < 60 * 25; i += 1) {
            time += 1 / 60;
            sim.update(1 / 60, time, { turbulence: 0.6, gyre: 0.26 });
            sim.stepCPU();
        }
        let left = 0;
        let right = 0;
        let stray = 0;
        let counted = 0;
        for (let i = 0; i < sim.count; i += 1) {
            const x = sim.positionData[i * 4];
            const y = sim.positionData[i * 4 + 1];
            expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
            counted += 1;
            if (x < -2.5) left += 1;
            if (x > 2.5) right += 1;
            // Above and below the board the form is a thin bridge: few motes stand tall there.
            if (Math.abs(x) < 2.5 && Math.abs(y) > 3.6) stray += 1;
        }
        expect(left / counted).toBeGreaterThan(0.2);
        expect(right / counted).toBeGreaterThan(0.2);
        expect(stray / counted).toBeLessThan(0.06);
        sim.dispose();
    });
});
