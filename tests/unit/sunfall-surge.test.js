/**
 * Sunfall builds with play: every event adds to what is still lit (nothing pops or resets), a
 * long chain reads hotter than its first clear, and the doline breathes back when the hands rest.
 */
import { describe, expect, it } from 'vitest';
import { SunfallDirector } from '../../src/themes/sunfall/sunfall-director.js';
import { readSunfallClear, readSunfallPiece } from '../../src/themes/sunfall/sunfall-events.js';

const DT = 1 / 60;
const run = (dir, seconds, each) => {
    let snap = dir.getSnapshot();
    const frames = Math.round(seconds / DT);
    for (let i = 0; i < frames; i += 1) {
        snap = dir.step(DT);
        each?.(snap);
    }
    return snap;
};
/** The cataract's water at mid-height, as the fall shader reads it (sunfall-water.js). */
const curtain = (snap) => {
    const age = snap.cataractAge - 0.35;
    const edge = Math.min(1, Math.max(0, age / 1.2));
    const front = edge > 0.52 ? 1 : 0;
    const pour = front * Math.min(1, snap.cataractPulse * 1.6) * (age > 0 ? 1 : 0);
    return Math.max(pour, snap.cataractHold);
};
/** A clearing lock the way the bus delivers it: the piece, then each wave. */
const clearingLock = (dir, lines, { cascade = 1, x = 3 } = {}) => {
    const piece = {
        shapeKey: 'O', shape: [[1, 1], [1, 1]], x, y: 22,
    };
    dir.onHardDrop({ ...readSunfallPiece({ piece }), distance: 14 });
    dir.onPieceLock({ ...readSunfallPiece({ piece }) });
    for (let w = 1; w <= cascade; w += 1) {
        dir.onLineClear(readSunfallClear({
            lineCount: lines, clearedRows: [23 - lines + 1, 23].slice(0, lines), cascadeCount: w,
        }));
    }
};

describe('sunfall surge', () => {
    it('feeds a cataract still pouring: a second quad never cuts the fall or the bow', () => {
        const dir = new SunfallDirector({ level: 1 });
        dir.onLineClear({ lines: 4, rows: [16, 17, 18, 19] });
        // The first fall has reached the pool: the second quad's front falls over it.
        let snap = run(dir, 2.0);
        const before = curtain(snap);
        const bowBefore = snap.rainbowStrength;
        expect(before).toBeGreaterThan(0.9);
        expect(bowBefore).toBeGreaterThan(0.5);
        dir.onLineClear({ lines: 4, rows: [16, 17, 18, 19] });
        let minWater = Infinity;
        let minBow = Infinity;
        snap = run(dir, 2.0, (s) => {
            minWater = Math.min(minWater, curtain(s));
            minBow = Math.min(minBow, s.rainbowStrength);
        });
        expect(minWater).toBeGreaterThanOrEqual(before - 0.01);
        expect(minBow).toBeGreaterThan(bowBefore * 0.95);
        // It pours longer than one quad alone would.
        expect(snap.cataractPulse).toBeGreaterThan(0.9);
    });

    it('never cuts the light with a weak event after a strong one', () => {
        const dir = new SunfallDirector({ level: 1 });
        dir.onHardDrop({
            code: 'I', u: 0.8, row: 18, distance: 16,
        });
        let snap = run(dir, 0.1);
        const right = snap.kickR;
        const shower = (dir.onLineClear({ lines: 3, rows: [17, 18, 19] }), run(dir, 0.1)).showerPulse;
        // A lock on the other side: the right curtain keeps its swing, the left one starts its own.
        dir.onPieceLock({ code: 'T', u: 0.1, row: 12 });
        snap = dir.step(DT);
        expect(snap.kickR).toBeGreaterThan(right * 0.75);
        expect(snap.kickL).toBeGreaterThan(0.2);
        // A single after a triple adds rain; it never thins it.
        dir.onLineClear({ lines: 1, rows: [19] });
        snap = dir.step(DT);
        expect(snap.showerPulse).toBeGreaterThan(shower);
    });

    it('opens the oculus fingers on fixed homes, easing, and lets them dissolve without collapsing', () => {
        const dir = new SunfallDirector({ level: 1 });
        let maxJump = 0;
        let prev = dir.comboShafts;
        const watch = (s) => {
            // While the fingers show at all (a forming chain opens its gaps unseen, at once).
            if (s.comboLift >= 0.02) maxJump = Math.max(maxJump, Math.abs(s.comboShafts - prev));
            prev = s.comboShafts;
        };
        for (let n = 0; n < 9; n += 1) {
            clearingLock(dir, 1, { x: n % 8 });
            run(dir, 0.64, watch);
        }
        expect(dir.comboColumns).toBe(7);
        // Each frame the count moves a little (a gap fades in where it lives), never a jump.
        expect(maxJump).toBeLessThan(0.25);
        // The chain ends: the fingers dissolve as the light opens, still on their ring.
        let shaftsWhileVisible = Infinity;
        let exhale = 0;
        run(dir, 6, (s) => {
            if (s.comboLift > 0.05) shaftsWhileVisible = Math.min(shaftsWhileVisible, s.comboShafts);
            exhale = Math.max(exhale, s.exhalePulse);
        });
        expect(shaftsWhileVisible).toBeGreaterThan(6.5);
        expect(exhale).toBeGreaterThan(0.8);
        expect(dir.comboLift).toBeLessThan(0.02);
    });

    it('reads a long chain hotter than its first clear, and crowns it with the late perfect clear', () => {
        const dir = new SunfallDirector({ level: 1 });
        run(dir, 1);
        clearingLock(dir, 1);
        const first = run(dir, 0.64);
        const firstLevel = first.heat.level;
        const firstShower = first.showerPulse;
        const plan = [1, 2, 1, 2, 2, 3, 2, 2, 3];
        let snap = first;
        plan.forEach((lines, n) => {
            clearingLock(dir, lines, { x: n % 8, cascade: n === 6 ? 3 : 1 });
            snap = run(dir, 0.64);
        });
        expect(snap.heat.level).toBeGreaterThan(firstLevel + 0.4);
        expect(snap.heat.fever).toBeGreaterThan(0.5);
        expect(snap.showerPulse).toBeGreaterThan(firstShower + 0.5);
        expect(snap.floodThreads).toBeGreaterThan(0.5);
        expect(snap.poolFlush).toBeGreaterThan(0.3);
        expect(snap.moteGain).toBeGreaterThan(first.moteGain + 1);

        // The quad, then its perfect clear 360 ms on: a crown on the pour, not a second one.
        clearingLock(dir, 4);
        run(dir, 0.36);
        const age = dir.cataractAge;
        const clears = dir.clearSerial;
        dir.onPerfectClear();
        snap = run(dir, 1);
        expect(dir.cataractAge).toBeCloseTo(age + 1, 3);
        expect(dir.clearSerial).toBe(clears);
        expect(snap.zenithPulse).toBeGreaterThan(0.8);
        expect(snap.rainbowStrength).toBeGreaterThan(0.8);
        // The chain is let go: the shafts open into the whole sky and the doline exhales.
        expect(snap.comboCount).toBe(0);
        expect(snap.exhalePulse).toBeGreaterThan(0.5);
    });

    it('breathes back to calm when the hands rest', () => {
        const dir = new SunfallDirector({ level: 1 });
        for (let n = 0; n < 12; n += 1) {
            clearingLock(dir, 2, { x: n % 8 });
            run(dir, 0.5);
        }
        const hot = dir.getSnapshot();
        expect(hot.heat.stage).toBeGreaterThanOrEqual(2);
        const rested = run(dir, 12);
        expect(rested.heat.level).toBeLessThan(0.1);
        expect(rested.heat.fever).toBe(0);
        expect(rested.heat.stage).toBe(0);
        expect(rested.floodThreads).toBeLessThan(0.05);
        expect(rested.showerPulse).toBeLessThan(0.05);
        expect(rested.comboLift).toBeLessThan(0.02);
        expect(rested.poolFlush).toBeLessThan(hot.poolFlush);
    });

    it('counts a hard drop and its lock as one piece, in its own colour, at its own rows', () => {
        const dir = new SunfallDirector({ level: 1 });
        const piece = {
            shapeKey: 'Z', shape: [[1, 1, 0], [0, 1, 1]], x: 6, y: 22,
        };
        dir.onHardDrop({ ...readSunfallPiece({ piece }), distance: 18 });
        dir.onPieceLock({ ...readSunfallPiece({ piece }) });
        expect(dir.lockSerial).toBe(1);
        // One hard-dropped lock's worth of punch (SURGE_WEIGHTS: 0.07 + 0.14), not two locks'.
        expect(dir.surge.punch.rawAt(dir.time)).toBeCloseTo(0.21, 5);
        const [lock] = dir.lockEvents;
        expect(lock.code).toBe('Z');
        expect(lock.u).toBeGreaterThan(0.5);
        expect(lock.cells.map((c) => c.row).sort()).toEqual([18, 18, 19, 19]);
        expect(readSunfallClear({ lineCount: 2, clearedRows: [22, 23], cascadeCount: 1 }).rows).toEqual([18, 19]);
    });

    it('answers a T-spin that clears nothing with a small turn, and a back-to-back with a thread', () => {
        const dir = new SunfallDirector({ level: 1, reducedMotion: true });
        dir.onTSpin({ lines: 0 });
        let snap = dir.step(DT);
        expect(snap.fringeDegrees).toBeCloseTo(7.5, 3);
        expect(snap.turningPulse).toBeGreaterThan(0.8);
        // A quad, then a back-to-back quad: one thread pours; a plain clear ends the chain.
        dir.onLineClear({ lines: 4 });
        dir.onB2B();
        snap = run(dir, 1.5);
        expect(snap.b2bLevel).toBe(1);
        expect(snap.floodThreads).toBeGreaterThan(0.25);
        dir.onLineClear({ lines: 1 });
        snap = run(dir, 4);
        expect(snap.b2bLevel).toBe(0);
    });
});
