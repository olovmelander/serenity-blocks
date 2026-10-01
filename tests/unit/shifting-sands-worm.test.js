import { describe, expect, it } from 'vitest';
import {
    BREACH_RECIPES,
    IDLE_OFFSET,
    IDLE_PERIOD,
    SIGN_LEAD,
    WormDirector,
    breachPoint,
    makeBreach,
    surfaceAngle,
} from '../../src/themes/shifting-sands/shifting-sands-worm.js';

const flatGround = () => 10;

describe('shifting sands breach path', () => {
    it('meets the surface exactly at ±φ0 and peaks at b − k', () => {
        const br = makeBreach(BREACH_RECIPES.summoned, 0, flatGround);
        const p = { x: 0, y: 0, z: 0 };
        expect(breachPoint(br, -br.phi0, p).y).toBeCloseTo(br.oy, 6);
        expect(breachPoint(br, br.phi0, p).y).toBeCloseTo(br.oy, 6);
        expect(breachPoint(br, 0, p).y).toBeCloseTo(br.oy + br.b - br.k, 6);
        expect(surfaceAngle(br.b, br.k)).toBeCloseTo(br.phi0, 9);
    });

    it('seats the arch on the sand and lasts until the tail is under', () => {
        const br = makeBreach(BREACH_RECIPES.idleNear, 5, flatGround);
        expect(br.oy).toBeCloseTo(14, 6); // ground + 4
        expect(br.omega).toBeGreaterThan(0);
        expect(br.duration).toBeCloseTo((2 * br.phi0 + br.span) / br.omega, 9);
        expect(br.duration).toBeGreaterThan(8);
        expect(br.duration).toBeLessThan(25);
    });
});

describe('shifting sands worm director', () => {
    it('is closed-form in time (the same t always resolves the same worm)', () => {
        const d = new WormDirector(flatGround);
        const t = IDLE_OFFSET + SIGN_LEAD.idle + 4;
        const a = d.update(t);
        const phiA = a.phiHead;
        const breachA = a.breach; // the state object is reused; keep the breach record
        expect(breachA).not.toBeNull();
        d.update(t + 30);
        const b = d.update(t);
        expect(b.breach.t0).toBe(breachA.t0);
        expect(b.breach.ox).toBe(breachA.ox);
        expect(b.phiHead).toBeCloseTo(phiA, 9);
    });

    it('runs the idle cycle: calm, worm sign, then the breach', () => {
        const d = new WormDirector(flatGround);
        expect(d.update(1).breach).toBeNull();
        expect(d.update(1).sign).toBeNull();
        const signT = IDLE_OFFSET + SIGN_LEAD.idle * 0.5;
        expect(d.update(signT).sign).not.toBeNull();
        expect(d.update(signT).breach).toBeNull();
        const s = d.update(IDLE_OFFSET + SIGN_LEAD.idle + 2);
        expect(s.breach).not.toBeNull();
        expect(s.mounds[0].h).toBeGreaterThan(0);
        // Quiet again before the next cycle's sign.
        expect(d.update(IDLE_OFFSET + IDLE_PERIOD - 0.5).breach).toBeNull();
    });

    it('answers a summons once, after the sign races in', () => {
        const d = new WormDirector(flatGround);
        const t0 = 2;
        expect(d.summon(t0)).toBe(true);
        expect(d.summon(t0 + 0.5)).toBe(false); // already coming
        expect(d.update(t0 + SIGN_LEAD.summoned * 0.5).breach).toBeNull();
        const s = d.update(t0 + SIGN_LEAD.summoned + 1);
        expect(s.breach).toBe(d.summoned);
        expect(s.breach.R).toBe(BREACH_RECIPES.summoned.R);
        expect(s.rumble).toBeGreaterThan(0);
    });

    it('keeps idle breaches away for 20 s after a summoned one', () => {
        const d = new WormDirector(flatGround);
        const tIdle = IDLE_OFFSET + SIGN_LEAD.idle + 3; // inside the first idle breach
        d.summon(tIdle - 40); // long finished, but within 20 s of nothing
        expect(d.update(tIdle).breach).not.toBeNull();
        const d2 = new WormDirector(flatGround);
        d2.summon(tIdle - 12);
        const s = d2.update(tIdle);
        // Either still the summoned worm or nothing — never the idle one.
        expect(s.breach === null || s.breach === d2.summoned).toBe(true);
    });

    it('forgets the summons on reset', () => {
        const d = new WormDirector(flatGround);
        d.summon(3);
        d.reset();
        expect(d.summoned).toBeNull();
        expect(d.update(3 + SIGN_LEAD.summoned + 1).breach).toBeNull();
    });
});
