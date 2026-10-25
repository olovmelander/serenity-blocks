import { describe, expect, it } from 'vitest';
import { AuroraDirector } from '../../src/themes/aurora/aurora-director.js';
import {
    AURORA_ARCS, CORONA_ARC_INDEX, ExcitationMap, WEATHER, arcBearing, cellLife,
} from '../../src/themes/aurora/aurora-field.js';
import { AuroraWeather, bearingForAzimuth } from '../../src/themes/aurora/aurora-weather.js';

const RESTING = AURORA_ARCS.filter((arc) => arc.index !== CORONA_ARC_INDEX);
const [MAIN, CROSS] = RESTING;

function run(weather, seconds, hz = 60, vigour = 0) {
    let elapsed = 0;
    while (elapsed < seconds - 1e-9) {
        const delta = Math.min(1 / hz, seconds - elapsed);
        weather.update(delta, vigour);
        elapsed += delta;
    }
}

function createDirector(seed = 11) {
    const excitation = new ExcitationMap();
    return new AuroraDirector({ excitation, seed });
}

function advance(director, seconds, hz = 60) {
    let elapsed = 0;
    while (elapsed < seconds - 1e-9) {
        const delta = Math.min(1 / hz, seconds - elapsed);
        director.update(delta);
        elapsed += delta;
    }
}

const lock = (x = 3, color = '#6cf5ff') => ({
    piece: {
        x, y: 18, shape: [[1, 1, 1, 1]], color,
    },
});
const clear = (lineCount = 1) => ({
    lineCount, clearedRows: Array.from({ length: lineCount }, (_, i) => 23 - i), cascadeCount: 1,
});
/** The event cells of one arc, as the march reads them: [bearing, 1/width, strength, tops]. */
const eventCells = (weather, arc) => {
    const out = [];
    for (let slot = WEATHER.ambient; slot < WEATHER.slots; slot += 1) {
        const o = (arc.index * WEATHER.slots + slot) * 4;
        out.push(Array.from(weather.cells.subarray(o, o + 4)));
    }
    return out;
};
const life = (weather, arc, bearing) => cellLife(weather.cells, arc, bearing).life;

describe('Aurora weather — a sky that is never the same curtain twice', () => {
    it('wanders on its own: every resting arc wakes in different places at different times', () => {
        const weather = new AuroraWeather();
        for (const arc of RESTING) {
            const bearings = [];
            const strengths = [];
            weather.reset();
            for (let second = 0; second < 300; second += 1) {
                run(weather, 1, 10);
                for (let slot = 0; slot < WEATHER.ambient; slot += 1) {
                    const o = (arc.index * WEATHER.slots + slot) * 4;
                    if (weather.cells[o + 2] > 0.3) bearings.push(weather.cells[o]);
                    strengths.push(weather.cells[o + 2]);
                }
            }
            // Awake stretches turn up across a wide reach of the arc, not in one place...
            expect(Math.max(...bearings) - Math.min(...bearings)).toBeGreaterThan(0.6);
            // ...and come and go: some moments the arc is quiet, some it blazes.
            expect(Math.min(...strengths)).toBeLessThan(0.02);
            expect(Math.max(...strengths)).toBeGreaterThan(0.6);
        }
    });

    it('is a pure function of the weather clock: replays exactly and ignores the frame rate', () => {
        const a = new AuroraWeather();
        const b = new AuroraWeather();
        run(a, 47, 30);
        run(b, 47, 144);
        for (const arc of RESTING) {
            for (let slot = 0; slot < WEATHER.ambient; slot += 1) {
                const o = (arc.index * WEATHER.slots + slot) * 4;
                for (let k = 0; k < 4; k += 1) expect(a.cells[o + k]).toBeCloseTo(b.cells[o + k], 4);
            }
        }
        const snapshot = Array.from(a.cells);
        a.reset();
        run(a, 47, 30);
        expect(Array.from(a.cells)).toEqual(snapshot);
    });

    it('breathes each arc\'s folds on its own beat, within bounds, and never the corona\'s', () => {
        const weather = new AuroraWeather();
        const seen = RESTING.map(() => []);
        for (let second = 0; second < 240; second += 1) {
            run(weather, 1, 10);
            RESTING.forEach((arc, i) => seen[i].push(weather.folds[arc.index]));
            expect(weather.folds[CORONA_ARC_INDEX]).toBe(1);
        }
        for (const series of seen) {
            expect(Math.min(...series)).toBeGreaterThan(0.5);
            expect(Math.max(...series)).toBeLessThan(1.5);
            expect(Math.max(...series) - Math.min(...series)).toBeGreaterThan(0.5);
        }
        // Never in step: at some moment one arc folds deep while another runs nearly straight.
        const spread = seen[0].map((value, t) => Math.abs(value - seen[1][t]));
        expect(Math.max(...spread)).toBeGreaterThan(0.4);
    });

    it('reads a cell where it stands and nowhere else, its tops split red or violet', () => {
        const weather = new AuroraWeather();
        weather.cells.fill(0);
        const o = (MAIN.index * WEATHER.slots + WEATHER.ambient) * 4;
        weather.cells.set([0.4, 1 / 0.1, 1, 0.75], o);
        const there = cellLife(weather.cells, MAIN, 0.4);
        expect(there.life).toBeCloseTo(MAIN.lively + 1, 6);
        expect(there.red).toBeCloseTo(0.75, 6);
        expect(there.blue).toBe(0);
        expect(life(weather, MAIN, 0.9)).toBeCloseTo(MAIN.lively, 6);
        // Cells are per arc, and the corona keeps its own look whatever the cells say.
        expect(life(weather, CROSS, 0.4)).toBeCloseTo(CROSS.lively, 6);
        const corona = AURORA_ARCS[CORONA_ARC_INDEX];
        expect(cellLife(weather.cells, corona, 0).life).toBe(corona.lively);
        weather.cells[o + 3] = -0.5;
        expect(cellLife(weather.cells, MAIN, 0.4).blue).toBeCloseTo(0.5, 6);
        // The bearing the shader reads is the angle along the arc from its nearest point.
        expect(arcBearing(MAIN, MAIN.distance)).toBeCloseTo(Math.PI / 4, 9);
        expect(bearingForAzimuth(MAIN, MAIN.angle + 0.3)).toBeCloseTo(0.3, 9);
        expect(bearingForAzimuth(MAIN, MAIN.angle + 3)).toBeLessThan(Math.PI / 2);
    });

    it('builds where play keeps landing: a second hit joins the first, it never restarts it', () => {
        const weather = new AuroraWeather();
        weather.wake(MAIN.index, 0.5, 0.1, 0.3);
        run(weather, 0.4);
        const once = eventCells(weather, MAIN).filter((cell) => cell[2] > 0.02);
        expect(once).toHaveLength(1);
        const level = once[0][2];
        weather.wake(MAIN.index, 0.52, 0.1, 0.05);
        run(weather, 1 / 60);
        const joined = eventCells(weather, MAIN).filter((cell) => cell[2] > 0.02);
        expect(joined).toHaveLength(1);
        expect(joined[0][2]).toBeGreaterThan(level * 0.98);
        // Quick hands ride up toward a plateau under the ceiling, not past it.
        for (let i = 0; i < 40; i += 1) {
            weather.wake(MAIN.index, 0.5, 0.1, 0.3);
            run(weather, 0.3);
        }
        const peak = eventCells(weather, MAIN).reduce((high, cell) => Math.max(high, cell[2]), 0);
        expect(peak).toBeGreaterThan(level * 2);
        expect(peak).toBeLessThanOrEqual(1.3);
    });

    it('keeps separate stretches apart, and a full arc gives up only its faintest cell', () => {
        const weather = new AuroraWeather();
        const slots = WEATHER.slots - WEATHER.ambient;
        for (let i = 0; i < slots; i += 1) weather.wake(CROSS.index, -0.9 + i * 0.6, 0.08, 0.4 + i * 0.2);
        run(weather, 0.3);
        expect(eventCells(weather, CROSS).filter((cell) => cell[2] > 0.02)).toHaveLength(slots);
        const before = eventCells(weather, CROSS).map((cell) => cell[0]);
        weather.wake(CROSS.index, 1.3, 0.08, 0.9);
        run(weather, 0.3);
        const after = eventCells(weather, CROSS).map((cell) => cell[0]);
        // Only the faintest (the first) moved to the new place; the stronger ones held.
        expect(after.filter((bearing) => Math.abs(bearing - 1.3) < 1e-6)).toHaveLength(1);
        expect(after[0]).toBeCloseTo(1.3, 6);
        for (let i = 1; i < slots; i += 1) expect(after[i]).toBeCloseTo(before[i], 6);
    });

    it('spreads a clear\'s front out along the arc and carries a surge\'s light along the sky', () => {
        const weather = new AuroraWeather();
        weather.wake(MAIN.index, 0.8, 0.15, 0.8, 0.6);
        weather.wake(CROSS.index, -0.9, 0.12, 0.6, 0, 0.7);
        run(weather, 0.05);
        const widthAt = () => 1 / eventCells(weather, MAIN).find((cell) => cell[2] > 0.02)[1];
        const travelling = () => eventCells(weather, CROSS).find((cell) => cell[2] > 0.02)[0];
        const [width0, at0] = [widthAt(), travelling()];
        run(weather, 1.5);
        expect(widthAt()).toBeGreaterThan(width0 + 0.4);
        // The spread eases off: the front slows as it reaches across the sky.
        const width1 = widthAt();
        run(weather, 1.5);
        expect(widthAt() - width1).toBeLessThan(width1 - width0);
        // The surge's light holds its pace.
        expect(travelling() - at0).toBeCloseTo(0.7 * 3, 1);
    });

    it('lets every event cell go once play stops, exactly', () => {
        const weather = new AuroraWeather();
        for (const arc of RESTING) weather.wake(arc.index, 0, 0.3, 1.2, 0.9, 0, 1);
        run(weather, 60);
        for (const arc of RESTING) for (const cell of eventCells(weather, arc)) expect(cell[2]).toBe(0);
        expect(weather.getDiagnostics().liveEvents).toBe(0);
    });
});

describe('Aurora director — play wakes the sky', () => {
    const edgeBearing = (director, arc, side) => {
        const board = director.boards[0];
        return bearingForAzimuth(arc, board.azimuth + side * board.halfWidth * 1.3);
    };

    it('a lock wakes the curtain just beside the board, and quick hands build it into a blaze', () => {
        const director = createDirector();
        const { weather } = director;
        const resting = life(weather, MAIN, edgeBearing(director, MAIN, 1));
        director.onPieceLock(lock(6));
        advance(director, 0.4);
        const once = life(weather, MAIN, edgeBearing(director, MAIN, 1));
        expect(once).toBeGreaterThan(resting + 0.05);
        expect(life(weather, CROSS, edgeBearing(director, CROSS, 1))).toBeGreaterThan(CROSS.lively);
        for (let i = 0; i < 14; i += 1) {
            director.onPieceLock(lock(i % 2 ? 6 : 1));
            advance(director, 0.4);
        }
        expect(life(weather, MAIN, edgeBearing(director, MAIN, 1))).toBeGreaterThan(once + 0.3);
    });

    it('a clear sends an awake front out along every resting arc; four lines wake the whole sky', () => {
        const director = createDirector();
        const { weather } = director;
        director.onPieceLock(lock());
        director.onLineClear(clear(2));
        advance(director, 1.2);
        for (const arc of RESTING) {
            const centre = bearingForAzimuth(arc, director.boards[0].azimuth);
            expect(life(weather, arc, centre)).toBeGreaterThan(arc.lively + 0.3);
            // Widened well past the board's own span.
            expect(life(weather, arc, centre + 0.45)).toBeGreaterThan(arc.lively + 0.1);
        }

        const quad = createDirector();
        quad.onPieceLock(lock());
        quad.onLineClear(clear(4));
        advance(quad, 1.2);
        for (const arc of RESTING) {
            const centre = bearingForAzimuth(arc, quad.boards[0].azimuth);
            const here = cellLife(quad.weather.cells, arc, centre);
            expect(here.life).toBeGreaterThan(life(weather, arc, centre));
            // The near arc breaks up violet-topped, the others red-crowned.
            if (arc === MAIN) expect(here.blue).toBeGreaterThan(here.red);
            else expect(here.red).toBeGreaterThan(here.blue);
        }
    });

    it('carries an awake stretch with each streak surge', () => {
        const director = createDirector();
        for (let i = 0; i < 3; i += 1) {
            director.onPieceLock(lock());
            director.onLineClear(clear(1));
            advance(director, 0.9);
        }
        const moving = director.weather.events.filter((cell) => cell.level > 0.05 && Math.abs(cell.pace) > 0.2);
        expect(moving.length).toBeGreaterThanOrEqual(RESTING.length);
    });

    it('stirs the weather and brings up the pulsating patches as a storm recovers, then rests exactly', () => {
        const director = createDirector();
        expect(director.pulsating).toBeGreaterThan(0);
        const resting = director.pulsating;
        [1, 1, 2, 1, 2, 2, 3, 2, 2, 3, 3, 4].forEach((lines) => {
            director.onHardDrop({ distance: 16 });
            director.onPieceLock(lock());
            director.onLineClear(clear(lines));
            advance(director, 0.64);
        });
        expect(director.heatFever).toBeGreaterThan(0);
        expect(director.weather.vigour).toBeGreaterThan(0.5);
        advance(director, 6);
        expect(director.pulsating).toBeGreaterThan(resting + 0.3);
        advance(director, 120);
        expect(director.afterglow).toBe(0);
        expect(director.pulsating).toBe(resting);
        expect(director.weather.getDiagnostics().liveEvents).toBe(0);
    });

    it('softens how far a woken stretch spreads under reduced motion, never the light itself', () => {
        const full = createDirector();
        const reduced = createDirector();
        reduced.setReducedMotion(true);
        for (const director of [full, reduced]) {
            director.onPieceLock(lock());
            director.onLineClear(clear(4));
            advance(director, 1.5);
        }
        const widest = (director) => Math.max(
            ...director.weather.events.map((cell) => (cell.level > 0.02 ? cell.width : 0)),
        );
        expect(widest(reduced)).toBeLessThan(widest(full));
        const strongest = (director) => Math.max(...director.weather.events.map((cell) => cell.level));
        expect(strongest(reduced)).toBeCloseTo(strongest(full), 6);
    });
});
