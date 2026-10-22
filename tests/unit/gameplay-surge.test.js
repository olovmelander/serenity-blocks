import { describe, expect, it } from 'vitest';

import {
    GameplaySurge, SURGE_STAGES, Swell, softCeiling, surgeStage,
} from '../../src/themes/shared/gameplay-surge.js';

/**
 * The shared surge (src/themes/shared/gameplay-surge.js): a theme's reactions accumulate under
 * fast play instead of restarting, and the world can read how intense play has been.
 */

/** Sample a swell at `step` second intervals from `from` to `to`. */
function trace(swell, from, to, step = 0.01) {
    const out = [];
    for (let t = from; t <= to + 1e-9; t += step) out.push(swell.valueAt(t));
    return out;
}

describe('Swell', () => {
    it('one hit of 1 peaks at 1, after its attack, and falls away', () => {
        const s = new Swell({ attack: 0.2, release: 1 });
        s.hit(1, 0);
        const values = trace(s, 0, 6);
        const peak = Math.max(...values);
        expect(peak).toBeCloseTo(1, 2);
        const peakAt = values.indexOf(peak) * 0.01;
        expect(peakAt).toBeGreaterThan(0.2);
        expect(peakAt).toBeLessThan(0.6);
        expect(s.valueAt(0)).toBe(0);
        expect(s.valueAt(6)).toBeLessThan(0.01);
    });

    it('with no attack it is lit at once and falls exponentially', () => {
        const s = new Swell({ release: 0.5 });
        s.hit(0.8, 1);
        expect(s.valueAt(1)).toBeCloseTo(0.8, 6);
        expect(s.valueAt(1.5)).toBeCloseTo(0.8 * Math.exp(-1), 6);
        expect(s.valueAt(0.5)).toBe(0);
    });

    it('a weak hit after a strong one never cuts the light (no pop)', () => {
        const s = new Swell({ release: 0.6 });
        s.hit(0.9, 0);
        const before = s.valueAt(0.1);
        s.hit(0.3, 0.1);
        expect(s.valueAt(0.1)).toBeGreaterThan(before);
        // And never falls below what the strong hit alone would show.
        const alone = new Swell({ release: 0.6 });
        alone.hit(0.9, 0);
        for (let t = 0.1; t < 3; t += 0.05) expect(s.valueAt(t)).toBeGreaterThanOrEqual(alone.valueAt(t) - 1e-12);
    });

    it('rapid hits ride up to a plateau instead of resetting to each one', () => {
        const s = new Swell({ attack: 0.05, release: 1.5 });
        const peaks = [];
        for (let i = 0; i < 20; i += 1) {
            s.hit(0.2, i * 0.3);
            peaks.push(s.valueAt(i * 0.3 + 0.1));
        }
        // Each hit stands on the ones before it...
        for (let i = 1; i < 8; i += 1) expect(peaks[i]).toBeGreaterThan(peaks[i - 1]);
        // ...up to about amount × release / interval.
        expect(peaks[19]).toBeGreaterThan(0.8);
        expect(peaks[19]).toBeLessThan(1.25);
    });

    it('a frenzy saturates under the soft ceiling and lets go soon after it ends', () => {
        const s = new Swell({ release: 0.8, ceiling: 1, knee: 0.6 });
        for (let i = 0; i < 200; i += 1) s.hit(1, i * 0.05);
        const end = 199 * 0.05;
        expect(s.valueAt(end)).toBeLessThanOrEqual(1);
        expect(s.valueAt(end)).toBeGreaterThan(0.9);
        // Bounded memory: the glow is gone a few releases later, however long the frenzy was.
        expect(s.valueAt(end + 4)).toBeLessThan(0.05);
    });

    it('waits for a hit scheduled ahead, and is the same whatever order it is read in', () => {
        const s = new Swell({ attack: 0.1, release: 1 });
        s.hit(0.5, 0);
        s.hit(1, 2); // a quad that holds its breath first
        const at1 = s.valueAt(1);
        const alone = new Swell({ attack: 0.1, release: 1 });
        alone.hit(0.5, 0);
        expect(at1).toBeCloseTo(alone.valueAt(1), 9);
        const at3 = s.valueAt(3);
        expect(at3).toBeGreaterThan(alone.valueAt(3) + 0.3);
        // Reading out of order (a seek) gives the same numbers.
        expect(s.valueAt(1)).toBeCloseTo(at1, 12);
        expect(s.valueAt(3)).toBeCloseTo(at3, 12);
    });

    it('ignores nothing-hits and bad times, and forgets on reset', () => {
        const s = new Swell({ release: 1 });
        s.hit(0, 0);
        s.hit(-1, 0);
        s.hit(1, Number.NaN);
        expect(s.valueAt(0.5)).toBe(0);
        s.hit(1, 0);
        expect(s.valueAt(0)).toBe(1);
        s.reset();
        expect(s.valueAt(0)).toBe(0);
    });

    it('a hit stamped before the last joins it there instead of going back in time', () => {
        const s = new Swell({ release: 1 });
        s.hit(0.5, 2);
        s.valueAt(2);
        s.hit(0.5, 3);
        s.hit(0.25, 1);
        expect(s.valueAt(3)).toBeGreaterThan(0.5 * Math.exp(-1) + 0.5);
    });
});

describe('softCeiling', () => {
    it('is linear to the knee and never passes the ceiling', () => {
        expect(softCeiling(0.3, 0.6, 1)).toBe(0.3);
        expect(softCeiling(0.6, 0.6, 1)).toBe(0.6);
        expect(softCeiling(0.9, 0.6, 1)).toBeGreaterThan(0.75);
        expect(softCeiling(0.9, 0.6, 1)).toBeLessThan(0.9);
        expect(softCeiling(50, 0.6, 1)).toBeLessThanOrEqual(1);
        expect(softCeiling(5, 0.6, Infinity)).toBe(5);
    });
});

describe('surgeStage', () => {
    it('rises through calm, warm, hot and fever', () => {
        expect(SURGE_STAGES[surgeStage(0.05, 0)]).toBe('calm');
        expect(SURGE_STAGES[surgeStage(0.3, 0)]).toBe('warm');
        expect(SURGE_STAGES[surgeStage(0.6, 0.2)]).toBe('hot');
        expect(SURGE_STAGES[surgeStage(0.8, 0.7)]).toBe('fever');
    });

    it('holds an act until the reading clearly leaves it (no flicker on a threshold)', () => {
        let stage = surgeStage(0.52, 0, 0);
        expect(stage).toBe(2);
        stage = surgeStage(0.47, 0, stage);
        expect(stage).toBe(2);
        stage = surgeStage(0.38, 0, stage);
        expect(stage).toBe(1);
        stage = surgeStage(0.05, 0, 3);
        expect(stage).toBe(0);
    });
});

/**
 * Run a script of [seconds, kind, payload] through a surge as a theme would: events as their
 * time comes, a sample every frame. Returns the sample at `until` (a copy).
 */
function run(surge, script, until) {
    const events = script.slice().sort((x, y) => x[0] - y[0]);
    let next = 0;
    let last = null;
    for (let frame = 0; frame <= Math.round(until * 60); frame += 1) {
        const t = frame / 60;
        while (next < events.length && events[next][0] <= t) {
            const [at, kind, payload] = events[next];
            if (kind === 'lock') surge.lock(payload, at);
            else if (kind === 'clear') surge.clear(payload, at);
            else if (kind === 'level') surge.levelUp(at);
            next += 1;
        }
        last = { ...surge.sample(t) };
    }
    return last;
}

/** Twelve clearing locks 0.72 s apart, a cascade now and then: a long chain. */
function chainScript(count = 12) {
    const script = [];
    for (let i = 0; i < count; i += 1) {
        script.push([i * 0.72, 'lock', { hardDrop: true }]);
        script.push([i * 0.72, 'clear', { lines: 1 + (i % 3), combo: i + 1, cascade: i % 4 === 3 ? 3 : 1 }]);
    }
    return script;
}

describe('GameplaySurge', () => {
    it('casual play stays calm; a steady quick hand runs hot; a long chain lights the fever', () => {
        const casual = [];
        for (let i = 0; i < 20; i += 1) {
            casual.push([i * 1.5, 'lock', { hardDrop: false }]);
            if (i % 4 === 3) casual.push([i * 1.5, 'clear', { lines: 1, combo: 1 }]);
        }
        const calm = run(new GameplaySurge(), casual, 30);
        expect(calm.level).toBeLessThan(0.3);
        expect(calm.fever).toBeLessThan(0.05);
        expect(SURGE_STAGES[calm.stage]).toBe('calm');

        const quick = [];
        for (let i = 0; i < 30; i += 1) {
            quick.push([i * 0.5, 'lock', { hardDrop: true }]);
            if (i % 4 === 3) quick.push([i * 0.5, 'clear', { lines: 2, combo: 1 }]);
        }
        const hot = run(new GameplaySurge(), quick, 15);
        expect(hot.level).toBeGreaterThan(0.45);
        expect(hot.level).toBeLessThan(0.85);
        expect(SURGE_STAGES[hot.stage]).toBe('hot');

        const fever = run(new GameplaySurge(), chainScript(), 8);
        expect(fever.level).toBeGreaterThan(0.9);
        expect(fever.fever).toBeGreaterThan(0.7);
        expect(SURGE_STAGES[fever.stage]).toBe('fever');
    });

    it('the fever waits for sustained heat, then lets go within seconds of the hands resting', () => {
        const early = run(new GameplaySurge(), chainScript(), 2);
        expect(early.fever).toBeLessThan(0.3);
        const surge = new GameplaySurge();
        run(surge, chainScript(), 8);
        // The chain ended at 7.92 s: four seconds of rest later it is cooling, eight later gone.
        const rest = (until) => {
            let last = null;
            for (let t = 8; t <= until + 1e-9; t += 1 / 60) last = { ...surge.sample(t) };
            return last;
        };
        expect(rest(14).fever).toBeLessThan(0.5);
        expect(rest(17).fever).toBe(0);
    });

    it('builds: the sixth quick clear stands far higher than the first', () => {
        const surge = new GameplaySurge();
        const levels = [];
        for (let i = 0; i < 6; i += 1) {
            surge.lock({ hardDrop: true }, i * 0.7);
            surge.clear({ lines: 1, combo: i + 1 }, i * 0.7);
            levels.push(surge.sample(i * 0.7 + 0.4).level);
        }
        for (let i = 1; i < levels.length; i += 1) expect(levels[i]).toBeGreaterThan(levels[i - 1]);
        expect(levels[5]).toBeGreaterThan(levels[0] * 3);
    });

    it('a lone quad from cold punches hard but barely stirs the fever', () => {
        const surge = new GameplaySurge();
        surge.clear({ lines: 4 }, 0);
        const s = surge.sample(0);
        expect(s.punch).toBeGreaterThan(0.7);
        let fever = 0;
        for (let t = 0; t < 10; t += 1 / 60) fever = Math.max(fever, surge.sample(t).fever);
        expect(fever).toBeLessThan(0.05);
    });

    it('rapid locks ride the punch on a floor instead of flickering to zero', () => {
        const surge = new GameplaySurge();
        for (let i = 0; i < 20; i += 1) surge.lock({ hardDrop: true }, i * 0.3);
        // Just before the last lock, the punch has not fallen back to nothing.
        expect(surge.sample(18 * 0.3 + 0.29).punch).toBeGreaterThan(0.15);
    });

    it('perfect clear, T-spin and back-to-back weigh more than the clear alone', () => {
        const base = new GameplaySurge();
        base.clear({ lines: 2 }, 0);
        const plain = base.sample(0.5).level;
        ['tspin', 'b2b', 'perfect'].forEach((flag) => {
            const surge = new GameplaySurge();
            surge.clear({ lines: 2, [flag]: true }, 0);
            expect(surge.sample(0.5).level).toBeGreaterThan(plain);
        });
    });

    it('breathes out when the hands rest, and resets for a new run', () => {
        const surge = new GameplaySurge();
        const script = [];
        for (let i = 0; i < 12; i += 1) script.push([i * 0.6, 'clear', { lines: 2, combo: i + 1 }]);
        expect(run(surge, script, 6.6).level).toBeGreaterThan(0.7);
        expect(surge.sample(26.6).level).toBeLessThan(0.05);
        expect(SURGE_STAGES[surge.sample(46.6).stage]).toBe('calm');
        surge.clear({ lines: 2, combo: 5 }, 100);
        surge.reset();
        const rest = surge.sample(100.2);
        expect(rest.level).toBe(0);
        expect(rest.punch).toBe(0);
        expect(rest.fever).toBe(0);
        expect(rest.stage).toBe(0);
    });

    it('sample() reuses one object and is a pure function of the events and the time', () => {
        const a = new GameplaySurge();
        const b = new GameplaySurge();
        [a, b].forEach((surge) => {
            surge.lock({ hardDrop: true }, 0);
            surge.clear({ lines: 3, combo: 2 }, 0.4);
        });
        const first = a.sample(1);
        expect(a.sample(1.5)).toBe(first);
        b.sample(0.7);
        expect(b.sample(1.5).level).toBeCloseTo(a.sample(1.5).level, 12);
    });
});
