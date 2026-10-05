import { describe, expect, it } from 'vitest';
import {
    BlackHoleDirector, DIRECTOR_LIMITS, luminous, parseColor, resolveClearHeight, resolveLock,
} from '../../src/themes/black-hole/black-hole-director.js';
import { SHAKE } from '../../src/themes/shared/camera-rig.js';

const STEP = 1 / 60;
const TAU = Math.PI * 2;

const piece = (overrides = {}) => ({
    x: 3, y: 20, shape: [[0, 1, 0], [1, 1, 1]], color: '#62ffe0', ...overrides,
});

function create(seed = 7) {
    const director = new BlackHoleDirector({ seed });
    director.setBoard(0, {
        left: 0.4, right: 0.6, top: 0.1, bottom: 0.9,
    });
    return director;
}

function run(director, seconds, step = STEP) {
    const frames = Math.round(seconds / step);
    for (let frame = 0; frame < frames; frame += 1) director.update(step);
}

/** A lock that clears `lines`, resolved on the next frame. */
function clear(director, lines = 1, payload = {}) {
    director.onPieceLock({ piece: piece(), ...payload });
    director.onLineClear({
        lineCount: lines, clearedRows: [23], cascadeCount: 1, ...payload,
    });
    director.update(STEP);
}

const active = (pool) => pool.filter((entry) => entry.active);

/** Every number the world reads, for replay comparisons. */
function snapshot(director) {
    return JSON.stringify({
        outputs: [director.diskHeat, director.diskGain, director.diskRate, director.ringGain, director.jets,
            director.energy, director.flash, director.surge, director.wound, director.streak],
        infalls: director.infalls.map((entry) => [
            entry.active, entry.age, entry.u, entry.v, entry.landRadius, entry.swirl, entry.seed,
        ]),
        hotspots: director.hotspots.map((entry) => [
            entry.active, entry.azimuth, entry.radius, entry.width, entry.strength,
        ]),
        waves: director.waves.map((entry) => [entry.active, entry.radius, entry.strength]),
        ripples: director.ripples.map((entry) => [entry.active, entry.x, entry.y, entry.radius, entry.strength]),
        bursts: director.bursts.map((entry) => [entry.active, entry.age, entry.strength, entry.seed]),
    });
}

describe('Black Hole lock resolution', () => {
    it('places a piece by the centroid of its cells and reports each cell from there', () => {
        const lock = resolveLock({ piece: piece({ x: 3, y: 20 }) });
        // Cells: (4,20) (3,21) (4,21) (5,21) → centroid (4.5, 21.25) in cell centres.
        expect(lock.placed).toBe(true);
        expect(lock.x).toBeCloseTo(4.5 / 10, 6);
        expect(lock.y).toBeCloseTo((21.25 - 4) / 20, 6);
        expect(lock.cells).toHaveLength(4);
        expect(lock.cells[0]).toEqual([0, -0.75]);
        const sum = lock.cells.reduce((total, cell) => [total[0] + cell[0], total[1] + cell[1]], [0, 0]);
        expect(sum[0]).toBeCloseTo(0, 6);
        expect(sum[1]).toBeCloseTo(0, 6);
        expect(lock.color).toEqual(parseColor('#62ffe0'));
    });

    it('prefers the on-screen origin a scrolling board reports', () => {
        const lock = resolveLock({ piece: piece({ y: 480 }), viewportOrigin: { x: 0.25, y: 0.6 } });
        expect([lock.x, lock.y]).toEqual([0.25, 0.6]);
        expect(resolveClearHeight({ clearedRows: [900], viewportOrigin: { x: 0.5, y: 0.4 } })).toBe(0.4);
    });

    it('stays bounded for malformed payloads', () => {
        for (const payload of [undefined, null, {}, { piece: null }, { piece: { x: NaN, y: 2, shape: [[1]] } },
            { piece: { x: 1, y: 2, shape: 'T' } }, { piece: { x: 1, y: 2, shape: [[0, 0], [0, 0]] } }]) {
            const lock = resolveLock(payload);
            expect(lock.placed).toBe(false);
            expect([lock.x, lock.y]).toEqual([0.5, 0.5]);
            expect(lock.cells).toHaveLength(4);
            expect(lock.cells.flat().every(Number.isFinite)).toBe(true);
        }
        const wide = resolveLock({ piece: { x: 0, y: 4, shape: [Array(20).fill(1)] } });
        expect(wide.cells).toHaveLength(4);
        expect(resolveClearHeight({ clearedRows: [] })).toBeNull();
        expect(resolveClearHeight({ clearedRows: [23, 22] })).toBeCloseTo((23 - 4) / 20, 6);
    });

    it('reads piece colours as light', () => {
        expect(parseColor('#fff')).toEqual([1, 1, 1]);
        expect(parseColor('f8b24f')[0]).toBeGreaterThan(parseColor('f8b24f')[2]);
        expect(parseColor(0x0000ff)).toEqual([0, 0, 1]);
        for (const bad of ['', 'teal', '#12', null, undefined, NaN, {}]) expect(parseColor(bad)).toBeNull();
        // The darkest piece in the set still feeds the hole a visible stream of its own hue.
        const indigo = luminous(parseColor('#3a3f66'));
        expect(Math.max(...indigo)).toBeCloseTo(1, 6);
        expect(indigo[2]).toBeGreaterThan(indigo[0]);
        expect(Math.min(...indigo)).toBeGreaterThan(0.05);
    });
});

describe('Black Hole director: feeding the hole', () => {
    it('launches a stream from where the piece landed, in its colour', () => {
        const director = create();
        director.onPieceLock({ piece: piece() });
        expect(active(director.infalls)).toHaveLength(0);
        director.update(STEP);
        const [infall] = active(director.infalls);
        expect(infall.fresh).toBe(true);
        expect(infall.u).toBeCloseTo(0.4 + 0.45 * 0.2, 6);
        expect(infall.v).toBeCloseTo(0.1 + ((21.25 - 4) / 20) * 0.8, 6);
        expect(infall.cellWidth).toBeCloseTo(0.02, 6);
        expect(infall.cellHeight).toBeCloseTo(0.04, 6);
        expect(Array.from(infall.cells.slice(0, 2))).toEqual([0, -0.75]);
        expect(infall.color).toEqual(luminous(parseColor('#62ffe0')));
        expect(infall.landRadius).toBeGreaterThan(3);
        expect(infall.landRadius).toBeLessThan(10.5);
        expect(infall.swirl).toBeGreaterThan(Math.PI * 0.6);
        expect(infall.swirl).toBeLessThan(Math.PI * 1.25);
        expect(director.shakeAmount).toBe(SHAKE.LOCK[0]);
        expect(active(director.ripples)).toHaveLength(1);
        expect(director.ripples[0]).toMatchObject({ x: infall.u, y: infall.v, fromHole: false });
    });

    it('lights a hot arc where the stream lands and has the ring answer once it is all in', () => {
        const director = create();
        director.onPieceLock({ piece: piece() });
        director.update(STEP);
        const [infall] = active(director.infalls);
        // The owner resolves the launch frame and tells the director where the stream lands.
        infall.fresh = false;
        infall.landAzimuth = 1.5;
        const { duration, landRadius, color } = infall;
        run(director, duration * 0.5);
        expect(active(director.hotspots)).toHaveLength(0);
        run(director, duration * 0.2);
        const [hotspot] = active(director.hotspots);
        expect(hotspot.radius).toBeCloseTo(landRadius, 1);
        expect(hotspot.color).toBe(color);
        expect(infall.active).toBe(true);
        const ringBefore = director.ringPulse;
        run(director, duration * 0.35);
        expect(infall.active).toBe(false);
        expect(director.ringPulse).toBeGreaterThan(ringBefore);
        expect(director.counts.landings).toBe(1);
        // The arc rides its orbit with the gas, drifts inward, shears out and cools away.
        const start = { azimuth: hotspot.azimuth, radius: hotspot.radius, width: hotspot.width };
        run(director, 1);
        expect(hotspot.radius).toBeLessThan(start.radius);
        expect(hotspot.width).toBeGreaterThan(start.width);
        expect((hotspot.azimuth - start.azimuth + TAU) % TAU).toBeGreaterThan(0.05);
        run(director, 5);
        expect(active(director.hotspots)).toHaveLength(0);
        expect(hotspot.strength).toBe(0);
    });

    it('does not land a stream the owner never launched', () => {
        const director = create();
        director.onPieceLock({ piece: piece() });
        director.update(STEP);
        run(director, 2);
        // Still `fresh`: no world resolved it, so no arc is lit at a meaningless azimuth.
        expect(director.counts.landings).toBe(0);
        expect(active(director.infalls)).toHaveLength(0);
    });

    it('hits harder after a hard drop, and only for the lock that followed it', () => {
        const soft = create();
        soft.onPieceLock({ piece: piece() });
        soft.update(STEP);
        const hard = create();
        hard.onHardDrop({ distance: 16 });
        hard.onPieceLock({ piece: piece() });
        hard.update(STEP);
        expect(hard.infalls[0].strength).toBeGreaterThan(soft.infalls[0].strength);
        expect(hard.infalls[0].duration).toBeLessThan(soft.infalls[0].duration);
        expect(hard.shakeAmount).toBeGreaterThan(soft.shakeAmount);
        run(hard, 1);
        hard.onPieceLock({ piece: piece() });
        hard.update(STEP);
        expect(hard.infalls[1].strength).toBeCloseTo(soft.infalls[0].strength, 6);
    });

    it('keeps the bookkeeping but feeds nothing when the lock effect is switched off', () => {
        const director = create();
        director.onPieceLock({ piece: piece() }, false);
        director.update(STEP);
        expect(active(director.infalls)).toHaveLength(0);
        expect(active(director.ripples)).toHaveLength(0);
        expect(director.shakeAmount).toBe(0);
        // The streak still counts through invisible locks.
        director.onLineClear({ lineCount: 1 });
        director.update(STEP);
        director.onPieceLock({ piece: piece() }, false);
        director.onLineClear({ lineCount: 1 });
        director.update(STEP);
        expect(director.streak).toBe(2);
    });

    it('answers each board from its own place on screen', () => {
        const director = create();
        director.setBoard(2, {
            left: 0.7, right: 0.9, top: 0.2, bottom: 0.8,
        });
        director.onPieceLock({ piece: piece(), player: 2 });
        director.update(STEP);
        expect(director.infalls[0].u).toBeGreaterThan(0.7);
        expect(director.infalls[0].u).toBeLessThan(0.9);
        // A bad rectangle is ignored rather than collapsing the board.
        director.setBoard(2, {
            left: 0.9, right: 0.7, top: 0.2, bottom: 0.8,
        });
        director.setBoard(9, {
            left: 0, right: 1, top: 0, bottom: 1,
        });
        expect(director.boards[2].left).toBe(0.7);
    });

    it('recycles its pools instead of growing them', () => {
        const director = create();
        for (let lock = 0; lock < 40; lock += 1) {
            director.onPieceLock({ piece: piece({ x: lock % 8 }) });
            director.update(STEP);
        }
        expect(director.infalls).toHaveLength(DIRECTOR_LIMITS.infalls);
        expect(director.hotspots).toHaveLength(DIRECTOR_LIMITS.hotspots);
        expect(director.ripples).toHaveLength(DIRECTOR_LIMITS.ripples);
        expect(active(director.infalls).length).toBeLessThanOrEqual(DIRECTOR_LIMITS.infalls);
        expect(director.counts.locks).toBe(40);
    });
});

describe('Black Hole director: clears, streaks and the jets', () => {
    it('sends a pressure wave through the disk and winds it up for a clear', () => {
        const director = create();
        clear(director, 2);
        const [wave] = active(director.waves);
        expect(wave.radius).toBeLessThan(3.2);
        expect(director.diskRate).toBeGreaterThan(1.5);
        expect(director.diskHeat).toBeGreaterThan(1);
        expect(director.ringGain).toBeGreaterThan(1.5);
        expect(director.surge).toBeGreaterThan(0.3);
        // One cue: the clear's ripple and shake stand in for the lock's.
        expect(active(director.ripples)).toHaveLength(1);
        expect(director.ripples[0].x).toBeCloseTo(0.5, 6);
        expect(director.shakeAmount).toBeGreaterThan(SHAKE.LOCK[0]);
        expect(active(director.infalls)).toHaveLength(1);
        const before = wave.radius;
        run(director, 0.5);
        expect(wave.radius).toBeGreaterThan(before + 2);
        run(director, 2);
        expect(active(director.waves)).toHaveLength(0);
    });

    it('scales the response with the lines cleared', () => {
        const one = create();
        clear(one, 1);
        const three = create();
        clear(three, 3);
        expect(three.waves[0].peak).toBeGreaterThan(one.waves[0].peak);
        expect(three.diskRate).toBeGreaterThan(one.diskRate);
        expect(three.ringGain).toBeGreaterThan(one.ringGain);
        expect(three.shakeAmount).toBeGreaterThan(one.shakeAmount);
        expect(one.jets).toBe(0);
        expect(active(one.bursts)).toHaveLength(0);
    });

    it('fires the jets on four lines and lets them die down', () => {
        const director = create();
        clear(director, 4);
        // They ignite over a few frames rather than appearing whole.
        expect(director.jets).toBeGreaterThan(0);
        expect(director.jets).toBeLessThan(0.3);
        expect(active(director.bursts)).toHaveLength(1);
        expect(director.ripples.some((ripple) => ripple.active && ripple.fromHole)).toBe(true);
        expect(director.shakeAmount).toBe(SHAKE.TETRIS[0]);
        run(director, 0.5);
        expect(director.jets).toBeGreaterThan(0.98);
        run(director, 1);
        expect(director.jets).toBe(1);
        run(director, 2);
        expect(director.jets).toBe(0);
    });

    it('counts a streak in consecutive clearing locks, not in cascade depth', () => {
        const director = create();
        clear(director, 1);
        expect(director.streak).toBe(1);
        expect(active(director.bursts)).toHaveLength(0);
        // A cascade inside the same lock deepens that clear without advancing the streak.
        director.onLineClear({ lineCount: 1, cascadeCount: 2 });
        director.onCascade({ comboCount: 2 });
        director.update(STEP);
        expect(director.streak).toBe(1);
        clear(director, 1);
        expect(director.streak).toBe(2);
        expect(active(director.bursts)).toHaveLength(1);
        clear(director, 1);
        expect(director.streak).toBe(3);
    });

    it('winds the hole up with the streak and keeps the jets lit from five', () => {
        const director = create();
        const wound = [];
        for (let streak = 1; streak <= 8; streak += 1) {
            clear(director, 1);
            run(director, 0.8);
            wound.push(director.wound);
            if (streak === 4) expect(director.jets).toBe(0);
            if (streak === 5) expect(director.jets).toBeGreaterThan(0.2);
        }
        for (let i = 2; i < wound.length; i += 1) expect(wound[i]).toBeGreaterThan(wound[i - 1]);
        expect(director.wound).toBeGreaterThan(0.9);
        expect(director.diskHeat).toBeGreaterThan(1.3);
        expect(director.jets).toBeGreaterThan(0.8);
        expect(director.energy).toBeGreaterThan(0.6);
        // The eighth clear sends a wave across the whole screen from the hole itself.
        expect(director.counts.bursts).toBeGreaterThanOrEqual(7);
    });

    it('lets go when a lock clears nothing, or when the board goes quiet', () => {
        const broken = create();
        for (let streak = 0; streak < 6; streak += 1) clear(broken, 1);
        broken.onPieceLock({ piece: piece() });
        broken.update(STEP);
        broken.onPieceLock({ piece: piece() });
        broken.update(STEP);
        expect(broken.streak).toBe(0);
        run(broken, 12);
        expect(broken.wound).toBeLessThan(0.02);
        expect(broken.jets).toBe(0);

        const quiet = create();
        for (let streak = 0; streak < 6; streak += 1) clear(quiet, 1);
        run(quiet, 24);
        expect(quiet.wound).toBeLessThan(0.02);
        expect(quiet.jets).toBe(0);
    });

    it('answers a cascade wave that arrives on its own with an echo', () => {
        const director = create();
        clear(director, 1);
        run(director, 0.2);
        director.onCascade({ comboCount: 3 });
        director.update(STEP);
        expect(active(director.waves)).toHaveLength(2);
        director.onCascade({ comboCount: 1 });
        director.onCascade({});
        director.update(STEP);
        expect(active(director.waves)).toHaveLength(2);
    });

    it('marks a T-spin, a perfect clear and a level-up each in its own way', () => {
        const spin = create();
        spin.onTSpin({ lineCount: 2 });
        spin.update(STEP);
        expect(active(spin.hotspots)).toHaveLength(1);
        expect(spin.hotspots[0].color[2]).toBeGreaterThan(spin.hotspots[0].color[0]);
        expect(spin.diskRate).toBeGreaterThan(2);
        expect(spin.shakeAmount).toBe(SHAKE.TSPIN[0]);

        const perfect = create();
        perfect.onPerfectClear({ depth: 1 });
        perfect.update(STEP);
        expect(active(perfect.hotspots)).toHaveLength(3);
        expect(perfect.ringGain).toBeGreaterThan(3);
        expect(perfect.shakeAmount).toBe(SHAKE.APEX[0]);
        run(perfect, 1);
        expect(perfect.jets).toBe(1);

        const level = create();
        level.onLevelUp({ level: 2 });
        level.update(STEP);
        expect(active(level.waves)).toHaveLength(1);
        expect(level.shakeAmount).toBe(0);
        expect(level.jets).toBe(0);
    });

    it('never lets an output leave its range, however hard it is driven', () => {
        const director = create();
        for (let frame = 0; frame < 240; frame += 1) {
            director.onHardDrop({ distance: 40 });
            director.onPieceLock({ piece: piece({ x: frame % 9 }) });
            director.onLineClear({ lineCount: 4, cascadeCount: 8 });
            director.onCascade({ comboCount: 8 });
            director.onTSpin({});
            director.onPerfectClear({});
            director.onLevelUp({});
            director.update(STEP);
            expect(director.diskHeat).toBeLessThanOrEqual(1.75);
            expect(director.diskGain).toBeLessThanOrEqual(1.66);
            expect(director.diskRate).toBeLessThanOrEqual(5.71);
            expect(director.ringGain).toBeLessThanOrEqual(4.21);
            expect(director.jets).toBeLessThanOrEqual(1);
            expect(director.energy).toBeLessThanOrEqual(1);
            expect(director.flash).toBeLessThanOrEqual(1);
            for (const ripple of director.ripples) expect(ripple.strength).toBeLessThanOrEqual(0.051);
        }
    });
});

describe('Black Hole director: time and state', () => {
    it('settles to exact rest', () => {
        const director = create();
        for (let streak = 0; streak < 8; streak += 1) clear(director, 4);
        director.calm();
        run(director, 40);
        expect([director.diskHeat, director.diskGain, director.diskRate, director.ringGain]).toEqual([1, 1, 1, 1]);
        const {
            jets, energy, flash, surge, streak,
        } = director;
        expect([jets, energy, flash, surge, streak]).toEqual([0, 0, 0, 0, 0]);
        for (const pool of [director.infalls, director.hotspots, director.waves, director.ripples, director.bursts]) {
            expect(active(pool)).toHaveLength(0);
        }
    });

    it('forgets the streak when calmed', () => {
        const director = create();
        for (let streak = 0; streak < 5; streak += 1) clear(director, 1);
        director.calm();
        clear(director, 1);
        expect(director.streak).toBe(1);
    });

    it('replays exactly from reset', () => {
        const script = (director) => {
            for (let frame = 0; frame < 420; frame += 1) {
                if (frame % 50 === 5) {
                    director.onHardDrop({ distance: frame % 17 });
                    director.onPieceLock({ piece: piece({ x: frame % 7 }) });
                    if (frame % 100 === 5) director.onLineClear({ lineCount: 1 + (frame % 4), clearedRows: [22] });
                }
                if (frame === 300) director.onTSpin({});
                director.update(STEP);
            }
            return snapshot(director);
        };
        const director = create(11);
        const first = script(director);
        director.reset();
        expect(snapshot(director)).toBe(snapshot(create(11)));
        expect(script(director)).toBe(first);
        expect(script(create(11))).toBe(first);
        expect(script(create(12))).not.toBe(first);
    });

    it('lands the same picture at 30, 60 and 144 frames a second', () => {
        const at = (fps) => {
            const director = create();
            director.onPieceLock({ piece: piece() });
            director.onLineClear({ lineCount: 3, clearedRows: [23, 22, 21] });
            director.update(1 / fps);
            director.infalls[0].fresh = false;
            run(director, 1.5 - 1 / fps, 1 / fps);
            return director;
        };
        const [slow, base, fast] = [at(30), at(60), at(144)];
        for (const other of [slow, fast]) {
            expect(other.diskRate).toBeCloseTo(base.diskRate, 1);
            expect(other.diskHeat).toBeCloseTo(base.diskHeat, 2);
            expect(other.waves[0].radius).toBeCloseTo(base.waves[0].radius, 0);
            expect(other.hotspots[0].azimuth).toBeCloseTo(base.hotspots[0].azimuth, 1);
            expect(other.hotspots[0].strength).toBeCloseTo(base.hotspots[0].strength, 1);
        }
    });

    it('holds a long frame to a quarter second and ignores a bad one', () => {
        const director = create();
        director.update(10);
        expect(director.time).toBe(0.25);
        for (const bad of [NaN, -1, undefined, Infinity]) director.update(bad);
        expect(director.time).toBe(0.25);
    });

    it('keeps every event but drops shake and refraction under reduced motion', () => {
        const director = create();
        director.setReducedMotion(true);
        clear(director, 4);
        expect(director.shakeAmount).toBe(0);
        expect(active(director.ripples)).toHaveLength(0);
        expect(active(director.infalls)).toHaveLength(1);
        expect(active(director.waves)).toHaveLength(1);
        expect(director.jets).toBeGreaterThan(0);
        const full = create();
        clear(full, 4);
        expect(director.waves[0].peak).toBeLessThan(full.waves[0].peak);
        expect(director.bursts[0].strength).toBeLessThan(full.bursts[0].strength);
        // The preference is the owner's: a rewind keeps it.
        director.reset();
        expect(director.reducedMotion).toBe(true);
    });

    it('reports what it is doing', () => {
        const director = create();
        clear(director, 4);
        expect(director.getDiagnostics()).toMatchObject({
            streak: 1, infalls: 1, waves: 1, bursts: 1, counts: { locks: 1, clears: 1 },
        });
    });
});
