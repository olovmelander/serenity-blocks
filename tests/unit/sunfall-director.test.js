import { describe, expect, it } from 'vitest';
import { SunfallDirector } from '../../src/themes/sunfall/sunfall-director.js';
import { PIECE_SWATCH_RGB, SUNFALL_TIMINGS } from '../../src/themes/sunfall/sunfall-core.js';

describe('sunfall-director', () => {
    it('initializes with clean baseline doline state and advances time', () => {
        const dir = new SunfallDirector({ level: 1 });
        const snap0 = dir.getSnapshot();
        expect(snap0.level).toBe(1);
        expect(snap0.fringeAngle).toBeCloseTo(0, 5);
        expect(snap0.rainbowStrength).toBe(0);
        expect(snap0.floodThreads).toBe(0);

        const snap1 = dir.step(0.2);
        expect(snap1.time).toBeCloseTo(0.2, 5);
    });

    it('triggers Flush on piece lock and Snap on hard drop', () => {
        const dir = new SunfallDirector({ level: 1 });
        dir.onPieceLock({ code: 'I', col: 4, row: 12 });
        let snap = dir.step(0.1);
        expect(snap.flushPulse).toBeGreaterThan(0.8);
        expect(snap.flushColor).toEqual(PIECE_SWATCH_RGB.I);

        dir.onHardDrop({
            code: 'S', col: 5, row: 14, distance: 12,
        });
        snap = dir.step(0.05);
        expect(snap.snapPulse).toBeGreaterThan(0.8);
        expect(snap.snapColor).toEqual(PIECE_SWATCH_RGB.S);
    });

    it('distinguishes 1-3 line clear Rim Shower + Row Ripening + New Growth from 4-line Cataract + Rainbow', () => {
        const dir = new SunfallDirector({ level: 1 });

        // 2-line clear -> Rim Shower, Ripening, New Growth, NO rainbow
        dir.onLineClear({ lines: 2, rows: [14, 15], codes: ['T', 'O'] });
        let snap = dir.step(0.2);
        expect(snap.showerPulse).toBeGreaterThan(0.5);
        expect(snap.ripenPulse).toBeGreaterThan(0.5);
        expect(snap.cataractPulse).toBe(0);
        expect(snap.rainbowStrength).toBe(0);
        expect(snap.newGrowthShoots.length).toBeGreaterThanOrEqual(8);

        // 4-line clear -> Cataract + delayed analytic double rainbow
        dir.resetSession();
        dir.onLineClear({ lines: 4, rows: [16, 17, 18, 19], codes: ['I', 'S', 'Z', 'L'] });

        // Early in cataract (< delay), rainbowStrength is still ramping
        snap = dir.step(0.1);
        expect(snap.cataractPulse).toBeGreaterThan(0.8);
        expect(snap.rainbowStrength).toBeLessThan(0.35);

        // After delay + rise (cataractAge ~ 0.9s), rainbowStrength peaks
        for (let i = 0; i < 4; i += 1) snap = dir.step(0.2);
        expect(snap.rainbowStrength).toBeGreaterThan(0.85);
    });

    it('drives Combo Inhale, Sevenfold (at >= 7), and Exhale on combo release', () => {
        const dir = new SunfallDirector({ level: 1 });

        dir.onCombo(4);
        let snap = dir.step(0.2);
        expect(snap.comboCount).toBe(4);
        expect(snap.comboLift).toBeGreaterThan(0.15);
        expect(snap.comboColumns).toBe(3);
        expect(snap.sevenfoldPulse).toBe(0);

        dir.onCombo(7);
        snap = dir.step(0.2);
        expect(snap.comboColumns).toBe(7);
        expect(snap.sevenfoldPulse).toBeGreaterThan(0.8);

        dir.releaseCombo(7);
        snap = dir.step(0.1);
        expect(snap.exhalePulse).toBeGreaterThan(0.8);
    });

    it('accumulates B2B Flood Threads (up to 3) + Echo and T-Spin persistent +15 deg/line fringe rotation', () => {
        const dir = new SunfallDirector({ level: 1, reducedMotion: true });

        dir.setB2B(2);
        let snap = dir.step(0.2);
        expect(snap.b2bLevel).toBe(2);
        expect(snap.floodThreads).toBeGreaterThan(0.15);
        expect(snap.echoBoost).toBeGreaterThan(0.1);

        const beforeDeg = snap.fringeDegrees;
        dir.onTSpin({ lines: 2, isMini: false });
        snap = dir.step(0.2);
        expect(snap.fringeDegrees - beforeDeg).toBeCloseTo(2 * SUNFALL_TIMINGS.tSpinTurnDeg, 2);
    });

    it('handles Perfect Clear Zenith Flush, Level Up, Game Over Over-Cloud, and Reset Session', () => {
        const dir = new SunfallDirector({ level: 1 });

        dir.onPerfectClear();
        // The zenith swings in (no jump of the beam in one frame) and peaks about a second on.
        let snap = dir.step(0.05);
        expect(snap.zenithPulse).toBeLessThan(0.3);
        for (let i = 0; i < 9; i += 1) snap = dir.step(0.1);
        expect(snap.zenithPulse).toBeGreaterThan(0.8);
        expect(snap.cloudHoleOpen).toBeGreaterThan(1.1);

        dir.onLevelUp(10);
        snap = dir.step(0.1);
        expect(snap.level).toBe(10);

        dir.onGameOver();
        for (let i = 0; i < 8; i += 1) snap = dir.step(0.25);
        expect(snap.overCloudClose).toBeGreaterThan(0.6);

        dir.resetSession();
        snap = dir.getSnapshot();
        expect(snap.overCloudClose).toBe(0);
        expect(snap.fringeAngle).toBe(0);
    });

    it('supports explicit station, weather, and fringe degree locks for playground verification', () => {
        const dir = new SunfallDirector({ level: 1 });
        dir.setStation('cloud-breath');
        dir.setWeather('shower');
        dir.setFringeDegrees(30);

        const snap = dir.getSnapshot();
        expect(snap.station.id).toBe('cloud-breath');
        expect(snap.weather.id).toBe('shower');
        expect(snap.fringeDegrees).toBeCloseTo(30, 3);
    });
});
