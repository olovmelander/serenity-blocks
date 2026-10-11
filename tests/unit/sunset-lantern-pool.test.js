/**
 * Sunset — the lanterns' lives: set down by a lock, afloat on the swell, lifted by a clear,
 * carried away by the wind toward the place the sun goes down.
 */
import { describe, expect, it } from 'vitest';
import {
    AIR_LIFE, LanternPool, MOTE_SECONDS, WATER_LIFE, moteAt,
} from '../../src/themes/sunset/sunset-lantern-pool.js';
import { seaHeight } from '../../src/themes/sunset/sunset-core.js';

const FROM = { x: -2, y: 2.8, z: -5 };
const GOLD = [1, 0.8, 0.2];

describe('sunset lanterns', () => {
    it('sends a light that lands as a lantern afloat on the swell', () => {
        const pool = new LanternPool({ capacity: 8, seed: 1 });
        const r = pool.send(10, FROM, -12, -30, GOLD);
        expect(r.t0).toBeCloseTo(10 + MOTE_SECONDS, 9);
        const st = {};
        pool.stateOf(r, 10.2, st);
        expect(st.phase).toBe('mote');
        expect(st.mote).toBeGreaterThan(0);
        expect(st.mote).toBeLessThan(1);
        pool.stateOf(r, 12, st);
        expect(st.phase).toBe('water');
        expect(st.y).toBeCloseTo(seaHeight(st.x, st.z, 12), 9);
        expect(st.glow).toBeGreaterThan(0.8);
        // It lights with a flare as the light reaches it, then settles.
        const early = pool.stateOf(r, r.t0 + 0.05, {}).glow;
        const later = pool.stateOf(r, r.t0 + 5, {}).glow;
        expect(early).toBeGreaterThan(later);
        // It drifts out from the eye, slowly.
        pool.stateOf(r, 60, st);
        expect(Math.hypot(st.x, st.z)).toBeGreaterThan(Math.hypot(-12, -30));
        expect(Math.hypot(st.x + 12, st.z + 30)).toBeLessThan(8);
        expect(pool.floating(12)).toBe(1);
        expect(pool.flying(12)).toBe(0);
    });

    it('lifts the oldest lanterns first, one after another', () => {
        const pool = new LanternPool({ capacity: 8, seed: 2 });
        const a = pool.send(1, FROM, -10, -20, GOLD);
        const b = pool.send(2, FROM, -12, -25, GOLD);
        const c = pool.send(3, FROM, -14, -28, GOLD);
        expect(pool.lift(10, 2, { gap: 0.5 })).toBe(2);
        expect(a.tr).toBe(10);
        expect(b.tr).toBe(10.5);
        expect(c.tr).toBe(Infinity);
        expect(pool.floating(11)).toBe(1);
        expect(pool.flying(11)).toBe(2);
        // A light still in flight is not lifted.
        const d = pool.send(20, FROM, -9, -18, GOLD);
        expect(pool.lift(20.1, 5)).toBe(1);
        expect(d.tr).toBe(Infinity);
    });

    it('carries a lifted lantern up and away toward the wind\'s bearing, then lets it go', () => {
        const pool = new LanternPool({ capacity: 8, seed: 3 });
        const r = pool.send(0, FROM, -8, -20, GOLD, { windAzimuth: -0.4 });
        pool.lift(5, 1);
        const st = {};
        pool.stateOf(r, 5 + 60, st);
        expect(st.phase).toBe('air');
        expect(st.y).toBeGreaterThan(40);
        // Away from the eye, toward the wind's bearing (left of the line).
        expect(Math.hypot(st.x, st.z)).toBeGreaterThan(150);
        expect(Math.atan2(st.x, -st.z)).toBeLessThan(-0.2);
        // It climbs no steeper than about one in three: it stays in the sky over the sea.
        expect(Math.atan2(st.y, Math.hypot(st.x, st.z))).toBeLessThan(0.45);
        pool.stateOf(r, 5 + AIR_LIFE + 1, st);
        expect(st.phase).toBe(null);
        pool.sweep(5 + AIR_LIFE + 1);
        expect(r.alive).toBe(false);
    });

    it('turns a T-spin\'s lanterns as they rise', () => {
        const pool = new LanternPool({ capacity: 8, seed: 4 });
        const r = pool.send(0, FROM, -8, -20, GOLD);
        pool.lift(5, 1, { spiral: 1.25 });
        expect(r.spiral).not.toBe(0);
        const xs = [6, 7, 8, 9].map((t) => pool.stateOf(r, t, {}).x);
        const plain = new LanternPool({ capacity: 8, seed: 4 });
        const q = plain.send(0, FROM, -8, -20, GOLD);
        plain.lift(5, 1);
        const qs = [6, 7, 8, 9].map((t) => plain.stateOf(q, t, {}).x);
        expect(xs.some((x, i) => Math.abs(x - qs[i]) > 0.3)).toBe(true);
    });

    it('makes room: the oldest sets out when the water is full, and a full pool reuses the longest gone', () => {
        const pool = new LanternPool({ capacity: 6, seed: 5 });
        for (let i = 0; i < 6; i += 1) pool.send(i, FROM, -8 - i, -20, GOLD);
        // No more than about half the pool floats at once: the rest have set out.
        expect(pool.floating(10)).toBeLessThanOrEqual(Math.ceil(6 * 0.55));
        expect(pool.flying(10)).toBeGreaterThan(0);
        const before = new Set(pool.records.map((r) => r.id));
        const r = pool.send(11, FROM, -9, -22, GOLD);
        expect(before.has(r.id)).toBe(false);
        expect(pool.records).toHaveLength(6);
    });

    it('gutters out on the water after its time if nothing lifts it', () => {
        const pool = new LanternPool({ capacity: 4, seed: 6 });
        const r = pool.send(0, FROM, -8, -20, GOLD);
        expect(pool.stateOf(r, WATER_LIFE * 0.5, {}).glow).toBeGreaterThan(0.5);
        expect(pool.stateOf(r, MOTE_SECONDS + WATER_LIFE + 31, {}).phase).toBe(null);
    });

    it('draws the light\'s arc from the card\'s edge to the water, above both', () => {
        const to = { x: -12, y: 0.3, z: -30 };
        const start = moteAt(FROM, to, 0, {});
        const end = moteAt(FROM, to, 1, {});
        const mid = moteAt(FROM, to, 0.5, {});
        expect(start).toEqual({ x: FROM.x, y: FROM.y, z: FROM.z });
        expect(end.x).toBeCloseTo(to.x, 9);
        expect(end.z).toBeCloseTo(to.z, 9);
        expect(mid.y).toBeGreaterThan(Math.max(FROM.y, to.y));
    });
});
