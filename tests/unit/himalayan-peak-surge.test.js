/**
 * Himalayan Peak builds with play instead of popping and resetting: every momentary light
 * accumulates, a chain's lines keep their colours, the heat of play
 * (src/themes/shared/gameplay-surge.js) carries the mountain from calm to a fever, and the crown
 * of a perfect clear is never a second clear.
 */
import {
    beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { HimalayanPeakWorld } from '../../src/themes/himalayan-peak/himalayan-peak-world.js';
import { HimalayanPeakDirector } from '../../src/themes/himalayan-peak/himalayan-peak-director.js';
import { planMassif } from '../../src/themes/himalayan-peak/himalayan-peak-assets.js';
import { GALE_REST, HUSH_HOLD, LUNG_TA } from '../../src/themes/himalayan-peak/himalayan-peak-core.js';

let massif;
beforeAll(() => {
    massif = planMassif(96);
});

const DT = 1 / 60;

function makeWorld() {
    const scene = new THREE.Scene();
    const world = new HimalayanPeakWorld({
        scene, quality: 'High', capture: true, massif, eagle: false,
    }).build();
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 1, 60000);
    world.bindCamera(camera);
    world.setViewport(1600, 900, 16 / 9);
    return { world, camera };
}

/** Frames from `from` to `to`; `each(time)` is called after every frame. */
const step = (world, camera, from, to, each = null) => {
    let time = from;
    while (time < to - 1e-9) {
        time = Math.min(to, time + DT);
        world.updateCamera(camera, { time, delta: DT });
        world.update({ time, delta: DT }, camera);
        each?.(time);
    }
    return time;
};

/** What the eye reads off the world on a frame. */
const look = (world) => ({
    halo: world.halo,
    kick: world.kick,
    swell: world.swell,
    surge: world.surge,
    prayer: world.u.prayer.value,
    ringHalo: world.u.halo.value,
    gale: world.gale,
    dust: world.u.surge.value,
    saturation: world.getPostState().saturation,
    bloom: world.getPostState().bloomBoost,
    slide: Math.max(world.u.avalanche.value.y, world.u.avalanche.value.w),
    level: world.getState().play.level,
    fever: world.getState().play.fever,
    stage: world.getState().play.stage,
});

/** The tray's Fever, as the world hears it: twelve hard-dropped clearing locks in a row. */
const PLAN = [1, 1, 2, 1, 2, 2, 3, 2, 2, 2, 3, 4];
function playFever(world, camera, start) {
    let time = start;
    PLAN.forEach((lines, k) => {
        time = step(world, camera, time, start + k * 0.64);
        world.updateCamera(camera, { time, delta: 0 });
        world.onLock({
            u: k % 2 ? 0.8 : 0.2, rows: [18, 19], hardDrop: true, color: '#e84118',
        });
        world.onClear({
            rows: Array.from({ length: lines }, (_, i) => 19 - i), lines, combo: k + 1, cascade: 1,
        });
        world.onCombo(k + 1);
    });
    return time;
}

describe('himalayan peak: what plays on builds', () => {
    it('never lets a weaker event cut the light of a stronger one still lit', () => {
        const run = (follow) => {
            const { world, camera } = makeWorld();
            step(world, camera, 0, 1);
            world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
            const frames = [];
            let time = step(world, camera, 1, 1.9);
            if (follow) {
                // A single and a triple right after the four lines.
                world.onClear({ rows: [19], lines: 1, combo: 2 });
                time = step(world, camera, time, 2.2);
                world.onClear({ rows: [19, 18, 17], lines: 3, combo: 3 });
            } else {
                time = step(world, camera, time, 2.2);
            }
            step(world, camera, time, 5, () => frames.push(look(world)));
            const slide = world.u.avalanche.value.clone();
            world.dispose();
            return { frames, slide };
        };
        const alone = run(false);
        const followed = run(true);
        alone.frames.forEach((a, i) => {
            const b = followed.frames[i];
            for (const key of ['halo', 'swell', 'surge', 'slide', 'bloom']) {
                expect(b[key], `${key} on frame ${i}`).toBeGreaterThanOrEqual(a[key] - 1e-9);
            }
        });
        // The triple did not snatch the quad's avalanche back to the top of the face: it fell
        // into the slide still coming down and made it bigger.
        expect(followed.slide.x).toBe(alone.slide.x);
        expect(followed.slide.y).toBeGreaterThan(alone.slide.y);
    });

    it('reads a long chain hotter than its first clear, and lets it peak late', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        const samples = [];
        let time = 1;
        PLAN.forEach((lines, k) => {
            time = step(world, camera, time, 1 + k * 0.64);
            world.updateCamera(camera, { time, delta: 0 });
            world.onLock({
                u: k % 2 ? 0.8 : 0.2, rows: [18, 19], hardDrop: true, color: '#00a8ff',
            });
            world.onClear({
                rows: Array.from({ length: lines }, (_, i) => 19 - i), lines, combo: k + 1, cascade: 1,
            });
            world.onCombo(k + 1);
            time = step(world, camera, time, time + 0.3);
            samples.push(look(world));
        });
        const first = samples[0];
        const late = samples[10];
        // The heat of play has been climbing the whole chain: calm at first, a fever by the end.
        expect(first.stage).toBeLessThanOrEqual(1);
        expect(late.stage).toBe(3);
        for (const key of ['prayer', 'ringHalo', 'gale', 'dust', 'saturation', 'level', 'fever']) {
            expect(late[key], key).toBeGreaterThan(first[key] + 0.1);
        }
        // Gentle first frames: the first clear barely moves the heat of play.
        expect(first.level).toBeLessThan(0.15);
        // The lines kept their colours through the chain: they hold more than after one clear.
        expect(world.getState().held).toBeGreaterThan(0);
        world.dispose();
    });

    it('breathes back to calm when the hands rest', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        let time = playFever(world, camera, 1);
        time = step(world, camera, time, time + 1);
        expect(look(world).stage).toBeGreaterThanOrEqual(2);
        world.onCombo(0);
        step(world, camera, time, time + 16);
        const rest = look(world);
        expect(rest.level).toBeLessThan(0.02);
        expect(rest.fever).toBe(0);
        expect(rest.stage).toBe(0);
        expect(rest.prayer).toBeLessThan(0.02);
        expect(rest.ringHalo).toBeLessThan(0.02);
        expect(rest.saturation).toBeLessThan(0.01);
        expect(world.gale).toBeLessThan(GALE_REST + 0.05);
        expect(world.getState().elevation).toBeLessThan(world.getState().sunClears);
        world.dispose();
    });

    it('lets a long chain\'s lines go when it ends, and keeps them through it', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        let time = playFever(world, camera, 1);
        time = step(world, camera, time, time + 0.8);
        // (The last clear was four lines: most went; what is left goes when the chain ends.)
        const kept = world.getState().held;
        expect(kept).toBeGreaterThan(0.2);
        const thrown = world.counts.papers;
        world.onCombo(0);
        step(world, camera, time, time + 1.2);
        expect(world.getState().held).toBeLessThan(0.05);
        expect(world.counts.papers).toBeGreaterThan(thrown);
        world.dispose();
    });

    it('crowns a perfect clear without a second hush or a second four-line clear', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        const time = step(world, camera, 1, 1 + HUSH_HOLD + 0.36);
        const before = { halo: world.halo, quads: world.counts.quads, clears: world.counts.clears };
        world.onCrown();
        let breath = Infinity;
        let halo = 0;
        step(world, camera, time, time + 1, () => {
            breath = Math.min(breath, world.u.breath.value);
            halo = Math.max(halo, world.halo);
        });
        expect(breath).toBeGreaterThan(0.95);
        expect(halo).toBeGreaterThan(before.halo + 0.5);
        expect(world.counts.quads).toBe(before.quads);
        expect(world.counts.clears).toBe(before.clears);
        world.dispose();
    });

    it('only inhales for a quad once play runs hot', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        let time = playFever(world, camera, 1);
        time = step(world, camera, time, time + 0.4);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4, combo: 13 });
        let breath = Infinity;
        step(world, camera, time, time + HUSH_HOLD, () => {
            breath = Math.min(breath, world.u.breath.value);
        });
        expect(breath).toBeGreaterThan(0.6);
        world.dispose();
    });

    it('runs every wave of a cascade deeper than the one before', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        let time = 1;
        const waves = [];
        for (let depth = 1; depth <= 4; depth++) {
            world.onClear({
                rows: [19, 18], lines: 2, combo: 1, cascade: depth,
            });
            // The wave it sent down: the newest of the slots.
            const sent = world.u.waveA.reduce((a, b) => (b.value.x > a.value.x ? b : a));
            waves.push({ strength: sent.value.z, fronts: sent.value.y });
            time = step(world, camera, time, time + 0.36);
            waves[waves.length - 1].swell = world.swell;
        }
        for (let k = 1; k < waves.length; k++) {
            expect(waves[k].strength).toBeGreaterThan(waves[k - 1].strength);
            expect(waves[k].fronts).toBeGreaterThanOrEqual(waves[k - 1].fronts);
            expect(waves[k].swell).toBeGreaterThan(waves[k - 1].swell);
        }
        // Three slots: a quick chain's waves all still run down the face together.
        const born = world.u.waveA.map((slot) => slot.value.x);
        expect(born.filter((x) => x > 1.2)).toHaveLength(3);
        world.dispose();
    });

    it('answers a back-to-back with the ring and the spire in gold', () => {
        const run = (b2b) => {
            const { world, camera } = makeWorld();
            step(world, camera, 0, 1);
            world.onClear({
                rows: [19, 18], lines: 2, tspin: true, b2b,
            });
            const thrown = world.counts.papers;
            step(world, camera, 1, 1.5);
            const out = {
                halo: world.halo, papers: thrown, spark: world.u.spark.value.clone(),
            };
            world.dispose();
            return out;
        };
        const plain = run(false);
        const twice = run(true);
        expect(twice.halo).toBeGreaterThan(plain.halo + 0.25);
        expect(twice.papers).toBeGreaterThan(plain.papers);
        const gold = LUNG_TA[4];
        expect(twice.spark.x).toBeCloseTo(gold[0], 6);
        expect(twice.spark.y).toBeCloseTo(gold[1], 6);
    });

    it('turns the wind for a T-spin that cleared nothing', () => {
        const { world, camera } = makeWorld();
        step(world, camera, 0, 1);
        const { level } = world.getState().play;
        world.onSpin({ player: 0 });
        step(world, camera, 1, 1.3);
        expect(world.counts.papers).toBeGreaterThan(0);
        expect(world.u.gustA.some((slot) => slot.value.x === -1 && slot.value.w > 0)).toBe(true);
        expect(world.getState().play.level).toBeGreaterThan(level);
        world.dispose();
    });
});

describe('himalayan peak director: the moments that clear nothing new', () => {
    const T = {
        type: 'T', x: 3, y: 18, shape: [[0, 1, 0], [1, 1, 1]], color: '#9c88ff',
    };
    const make = () => {
        const calls = {
            clear: [], crown: [], spin: [],
        };
        const director = new HimalayanPeakDirector({
            sink: {
                lock() {},
                clear: (c) => calls.clear.push({ ...c, rows: [...c.rows] }),
                crown: (c) => calls.crown.push({ ...c }),
                spin: (c) => calls.spin.push({ ...c }),
                combo() {},
            },
        });
        return { director, calls };
    };

    it('crowns a perfect clear that settles in a frame of its own instead of clearing again', () => {
        const { director, calls } = make();
        director.onPieceLock({ piece: T });
        director.onLineClear({ lineCount: 4, clearedRows: [23, 22, 21, 20], cascadeCount: 1 });
        director.flush();
        director.onPerfectClear({ depth: 4 });
        director.flush();
        expect(calls.clear).toHaveLength(1);
        expect(calls.clear[0]).toMatchObject({ lines: 4, perfect: false });
        expect(calls.crown).toEqual([{ player: 0, combo: 1 }]);
        // In the same frame as its clear it rides on that clear.
        director.onPieceLock({ piece: T });
        director.onLineClear({ lineCount: 2, clearedRows: [23, 22], cascadeCount: 1 });
        director.onPerfectClear({ depth: 1 });
        director.flush();
        expect(calls.clear).toHaveLength(2);
        expect(calls.clear[1]).toMatchObject({ lines: 2, perfect: true });
        expect(calls.crown).toHaveLength(1);
    });

    it('still hears a crown as a one-line perfect clear when the sink has no crown', () => {
        const clears = [];
        const director = new HimalayanPeakDirector({ sink: { clear: (c) => clears.push({ ...c }) } });
        director.onPerfectClear({ depth: 4 });
        director.flush();
        expect(clears).toHaveLength(1);
        expect(clears[0]).toMatchObject({ lines: 1, perfect: true });
    });

    it('hands on a T-spin that cleared nothing', () => {
        const { director, calls } = make();
        director.onPieceLock({ piece: T });
        director.onTSpin({ lineCount: 0 });
        director.flush();
        expect(calls.clear).toHaveLength(0);
        expect(calls.spin).toEqual([{ player: 0 }]);
    });
});
