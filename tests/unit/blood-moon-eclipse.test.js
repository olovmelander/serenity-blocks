import { describe, expect, it } from 'vitest';
import {
    ECLIPSE, EXPOSURE_FLOOR, eclipseOffset, lunarLight, sampleEclipse,
} from '../../src/playground/effects/blood-moon-eclipse.js';
import {
    BloodMoonRipples, RIPPLE_LIFETIME, rippleCue,
} from '../../src/playground/effects/blood-moon-ripples.js';
import { BloodMoonMeteors, METEOR } from '../../src/playground/effects/blood-moon-meteors.js';

const luminance = ([r, g, b]) => r * 0.2126 + g * 0.7152 + b * 0.0722;

describe('Blood Moon eclipse', () => {
    it('opens in totality, holds it about two thirds of the cycle, and returns to it', () => {
        const start = sampleEclipse(0);
        expect(start.totality).toBe(1);
        expect(start.exposure).toBe(1);
        expect(start.offset.x).toBeCloseTo(0);
        expect(sampleEclipse(ECLIPSE.period).offset.x).toBeCloseTo(0);
        let total = 0;
        const steps = 480;
        for (let i = 0; i < steps; i++) {
            if (sampleEclipse((i / steps) * ECLIPSE.period).totality === 1) total += 1;
        }
        expect(total / steps).toBeGreaterThan(0.55);
        expect(total / steps).toBeLessThan(0.75);
    });

    it('shows a sliver on one limb, then on the other, and stops the night down for it', () => {
        const first = sampleEclipse(ECLIPSE.period / 4);
        const second = sampleEclipse((ECLIPSE.period * 3) / 4);
        expect(first.offset.x).toBeCloseTo(ECLIPSE.sweep);
        expect(second.offset.x).toBeCloseTo(-ECLIPSE.sweep);
        for (const sliver of [first, second]) {
            expect(sliver.totality).toBeLessThan(0.9);
            expect(sliver.totality).toBeGreaterThan(0.6);
            expect(sliver.exposure).toBeLessThan(0.4);
            expect(sliver.exposure).toBeGreaterThanOrEqual(EXPOSURE_FLOOR);
        }
    });

    it('keeps the night wide open until the umbra no longer covers the face', () => {
        for (let t = 0; t <= ECLIPSE.period / 4; t += 1) {
            const state = sampleEclipse(t);
            if (state.totality === 1 && state.offset.x < 1.4) expect(state.exposure).toBe(1);
        }
    });

    it('changes exposure smoothly: no frame-to-frame jump at 60 fps', () => {
        let previous = sampleEclipse(0).exposure;
        for (let t = 1 / 60; t < ECLIPSE.period; t += 1 / 60) {
            const { exposure } = sampleEclipse(t);
            expect(Math.abs(exposure - previous)).toBeLessThan(0.01);
            previous = exposure;
        }
    });

    it('lights the umbra deep red at its heart, copper at its rim, and the penumbra with the sun', () => {
        const heart = lunarLight(0, [0, 0, 0]);
        const rim = lunarLight(ECLIPSE.umbra * 0.95, [0, 0, 0]);
        const outside = lunarLight(ECLIPSE.penumbra + 1, [0, 0, 0]);
        expect(heart[0]).toBeGreaterThan(heart[1] * 8);
        expect(luminance(rim)).toBeGreaterThan(luminance(heart) * 3);
        expect(rim[1] / rim[0]).toBeGreaterThan(heart[1] / heart[0]);
        expect(luminance(outside)).toBeGreaterThan(luminance(rim) * 50);
        // The ozone fringe: just outside the umbra the blue-green share rises.
        const fringe = lunarLight(ECLIPSE.umbra + 0.07, [0, 0, 0]);
        expect(fringe[2] / fringe[0]).toBeGreaterThan(rim[2] / rim[0]);
        // Brightness never falls toward the penumbra's edge.
        let last = 0;
        for (let s = 0; s <= ECLIPSE.penumbra + 0.5; s += 0.02) {
            const value = luminance(lunarLight(s, [0, 0, 0]));
            expect(value).toBeGreaterThanOrEqual(last - 1e-6);
            last = value;
        }
    });

    it('is a pure function of time and survives malformed time', () => {
        expect(sampleEclipse(37.5)).toEqual(sampleEclipse(37.5));
        expect(eclipseOffset(NaN)).toEqual(eclipseOffset(0));
        const out = {};
        expect(sampleEclipse(12, out)).toBe(out);
        expect(Object.values(out).flatMap((v) => (typeof v === 'object' ? Object.values(v) : [v]))
            .every(Number.isFinite)).toBe(true);
    });
});

describe('Blood Moon ripples', () => {
    it('drops one ring for a lock and more for bigger clears', () => {
        expect(rippleCue('lock')).toEqual({ count: 1, strength: 0.55 });
        expect(rippleCue('clear', { lineCount: 1 }).count).toBe(1);
        expect(rippleCue('clear', { lines: 3 }).count).toBe(2);
        expect(rippleCue('tetris').count).toBe(3);
        expect(rippleCue('perfectClear').count).toBe(4);
        expect(rippleCue('unknown')).toBeNull();
    });

    it('keeps live rings at the front, retires them after their lifetime and reuses the oldest row', () => {
        const pool = new BloodMoonRipples(3);
        const rows = Array.from({ length: 3 }, () => ({
            x: 0, y: 0, z: 0, w: 0,
        }));
        pool.add(1, 2, 0.5);
        pool.update(1);
        pool.add(3, 4, 0.8);
        pool.update(1);
        pool.add(5, 6, 1);
        expect(pool.write(rows)).toBe(3);
        pool.add(7, 8, 1);
        // The first ring (oldest) gave its row to the newest.
        const live = rows.slice(0, pool.write(rows));
        expect(live.map((r) => r.x).sort()).toEqual([3, 5, 7]);
        pool.update(RIPPLE_LIFETIME - 0.9);
        expect(pool.write(rows)).toBe(2);
        expect(rows[2].w).toBe(0);
        pool.update(5);
        expect(pool.write(rows)).toBe(0);
    });

    it('bounds strength and ignores malformed rings and time steps', () => {
        const pool = new BloodMoonRipples(2);
        pool.add(NaN, 0, 1);
        pool.add(0, 0, -1);
        expect(pool.count).toBe(0);
        pool.add(0, 0, 9);
        expect(pool.rows[0].strength).toBe(1.5);
        pool.update(NaN);
        expect(pool.rows[0].age).toBe(0);
        pool.reset();
        expect(pool.count).toBe(0);
    });
});

describe('Blood Moon meteors', () => {
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

    it('falls at most one quiet meteor per slot, the same at every look at the clock', () => {
        const meteors = new BloodMoonMeteors();
        const again = new BloodMoonMeteors();
        let lit = 0;
        let slotsWithOne = 0;
        for (let slot = 0; slot < 40; slot++) {
            let seen = false;
            for (let t = slot * METEOR.slot; t < (slot + 1) * METEOR.slot; t += 0.05) {
                const { glow } = meteors.sample(t);
                expect(glow).toBe(again.sample(t).glow);
                if (glow > 0) { lit += 0.05; seen = true; }
            }
            if (seen) slotsWithOne += 1;
        }
        expect(slotsWithOne / 40).toBeGreaterThan(0.45);
        expect(slotsWithOne / 40).toBeLessThan(0.9);
        // Each lasts about a second at most: the sky is quiet nearly all the time.
        expect(lit / slotsWithOne).toBeLessThan(1.1);
    });

    it('draws each path on a great circle inside the frame, falling and flying away from the board', () => {
        const meteors = new BloodMoonMeteors();
        meteors.spread = 0.6;
        let checked = 0;
        for (let t = 0; t < 600; t += 0.1) {
            const m = meteors.sample(t);
            if (m.glow <= 0) continue;
            checked += 1;
            expect(Math.abs(dot(m.a, m.a) - 1)).toBeLessThan(1e-6);
            expect(Math.abs(dot(m.a, m.s))).toBeLessThan(1e-6);
            expect(Math.abs(dot(m.a, m.n))).toBeLessThan(1e-6);
            expect(m.head).toBeLessThanOrEqual(m.length + 1e-9);
            expect(m.trail).toBeLessThanOrEqual(m.head + 1e-9);
            const startAz = Math.atan2(m.a[0], -m.a[2]);
            const end = m.a.map((v, i) => v * Math.cos(m.length) + m.s[i] * Math.sin(m.length));
            const endAz = Math.atan2(end[0], -end[2]);
            expect(Math.abs(startAz)).toBeLessThan(0.6);
            expect(Math.abs(endAz)).toBeLessThan(0.62);
            expect(Math.sign(endAz - startAz)).toBe(Math.sign(startAz));
            expect(end[1]).toBeLessThan(m.a[1]);
        }
        expect(checked).toBeGreaterThan(20);
    });

    it('sends a fireball on a cue that outshines and outlasts the quiet ones, then clears it', () => {
        const meteors = new BloodMoonMeteors();
        let seed = 7;
        const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        meteors.cue(10, 1.6, random);
        const mid = meteors.sample(10.8);
        expect(mid.fireball).toBe(1);
        expect(mid.glow).toBeGreaterThan(1);
        expect(meteors.sample(12.5).fireball).toBe(0);
        expect(meteors.cued).toBeNull();
        meteors.cue(NaN, 1, random);
        meteors.cue(1, 0, random);
        expect(meteors.cued).toBeNull();
    });
});

describe('Blood Moon meteors and the moon', () => {
    const avoid = { az: -0.34, el: 0.26, radius: 0.36 };
    const bearing = (d) => ({ az: Math.atan2(d[0], -d[2]), el: Math.asin(d[1]) });

    it('never starts a quiet meteor on the moon or its ember ring', () => {
        const meteors = new BloodMoonMeteors();
        meteors.avoid = avoid;
        let checked = 0;
        for (let t = 0; t < 2000; t += 0.25) {
            const m = meteors.sample(t);
            if (m.glow <= 0) continue;
            checked += 1;
            const { az, el } = bearing(m.a);
            const fromMoon = Math.hypot((az - avoid.az) * Math.cos(el), el - avoid.el);
            expect(fromMoon).toBeGreaterThanOrEqual(avoid.radius - 1e-9);
        }
        expect(checked).toBeGreaterThan(40);
    });

    it('sends every fireball across the open sky on the far side from the moon', () => {
        const meteors = new BloodMoonMeteors();
        meteors.avoid = avoid;
        let seed = 11;
        const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (let i = 0; i < 25; i++) {
            meteors.reset();
            meteors.cue(0, 1.2, random);
            expect(bearing(meteors.sample(0.5).a).az).toBeGreaterThan(0);
        }
    });
});
