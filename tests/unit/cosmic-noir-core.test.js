/**
 * Cosmic Noir — the three-free maths the world, the director and the shaders share: the film
 * stocks' wheel (clock and level), the lighthouse's beams and cage, and the events' timing.
 *
 * Relations, not tuning numbers: constants are imported.
 */
import { describe, expect, it } from 'vitest';
import {
    CAGE, CUE_GAP, CUE_SHOW, DEG, ECHO_MAX, ECHO_SEA_MAX, ECHO_SPEED, FAR_LAMP, FILM_STOCKS, NEGATIVE_FADE,
    NEGATIVE_HOLD, PULSAR, SEA, SEA_FLOOR, SEA_TOP, STOCK_HOME, STOCK_REST, STOCK_STEP, TAU, TOWER,
    beamDirection, beamLight, cageTransmit, cueAt, echoRadius, echoSeaRadius, farLampAt, lampPose, negativeAt,
    pulsarAnchor, spinBasis, stockAt, stockName, stockPhase, stockPlace,
} from '../../src/themes/cosmic-noir/cosmic-noir-core.js';

const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const dist = (a, b) => Math.hypot(...['shadow', 'high', 'paper'].flatMap((k) => a[k].map((v, i) => v - b[k][i])));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const NAMES = FILM_STOCKS.map((s) => s.name);

describe('cosmic noir core: the film stocks', () => {
    it('tones a print without changing how bright it is, on a black paper', () => {
        expect(NAMES[STOCK_HOME]).toBe('silver');
        FILM_STOCKS.forEach((stock) => {
            expect(luma(stock.shadow), stock.name).toBeCloseTo(1, 1);
            expect(luma(stock.high), stock.name).toBeCloseTo(1, 1);
            // The deepest black is near black: noir.
            expect(luma(stock.paper), stock.name).toBeLessThan(0.004);
            expect(stock.grain).toBeGreaterThan(0);
        });
        // Every stock looks different from its neighbours on the line.
        for (let i = 1; i < FILM_STOCKS.length; i++) {
            expect(dist(FILM_STOCKS[i], FILM_STOCKS[i - 1])).toBeGreaterThan(0.05);
        }
    });

    it('drifts by the clock alone, at level 1, from its first minute', () => {
        const at0 = stockAt(stockPlace(0, 0));
        const at60 = stockAt(stockPlace(0, 60));
        expect(dist(at0, at60)).toBeGreaterThan(0.02);
        // One stock along after STOCK_STEP seconds, two after twice that.
        expect(stockName(stockPlace(0, 0))).toBe('silver');
        expect(stockName(stockPlace(0, STOCK_STEP))).toBe(NAMES[STOCK_HOME + 1]);
        expect(stockName(stockPlace(0, STOCK_STEP * 2))).toBe(NAMES[STOCK_HOME + 2]);
    });

    it('adds a level\'s step to the clock\'s: the two simply add', () => {
        for (const t of [0, 37, 140, 999]) {
            expect(stockPlace(2, t)).toBeCloseTo(stockPlace(0, t) + 2, 12);
            expect(stockPlace(0, t + STOCK_STEP)).toBeCloseTo(stockPlace(1, t), 12);
        }
        // The clock never runs backwards (a negative time is the start).
        expect(stockPlace(0, -5)).toBe(stockPlace(0, 0));
    });

    it('rests on each stock for STOCK_REST of a step at each end, and turns between', () => {
        for (let k = 0; k < 8; k++) {
            expect(stockPhase(k).mix === 0 || stockPhase(k).mix === 1, `place ${k}`).toBe(true);
            expect(stockPhase(k + STOCK_REST * 0.9).mix === 0 || stockPhase(k + STOCK_REST * 0.9).mix === 1).toBe(true);
            const mid = stockPhase(k + 0.5).mix;
            expect(mid).toBeGreaterThan(0.2);
            expect(mid).toBeLessThan(0.8);
        }
    });

    it('walks the line there and back: neighbours only, never a jump from one end to the other', () => {
        const seen = [];
        for (let k = -STOCK_HOME; k < 12; k++) seen.push(stockName(k));
        expect(seen.slice(0, 9)).toEqual(['cyanotype', 'silver', 'selenium', 'sepia', 'platinum', 'sepia',
            'selenium', 'silver', 'cyanotype']);
        // Continuous: a small step of place is a small change of toning, everywhere on the wheel.
        let worst = 0;
        let prev = stockAt(-2);
        for (let p = -2; p < 14; p += 0.002) {
            const next = stockAt(p);
            worst = Math.max(worst, dist(prev, next));
            prev = next;
        }
        expect(worst).toBeLessThan(0.02);
    });
});

describe('cosmic noir core: the lighthouse', () => {
    const basis = spinBasis();

    it('turns its beams on a cone round the spin axis, at the inclination', () => {
        expect(dot(basis.a, basis.e1)).toBeCloseTo(0, 9);
        expect(dot(basis.a, basis.e2)).toBeCloseTo(0, 9);
        for (let k = 0; k < 16; k++) {
            const b = beamDirection((k / 16) * TAU, basis);
            expect(Math.hypot(...b)).toBeCloseTo(1, 9);
            expect(Math.acos(dot(b, basis.a)) / DEG).toBeCloseTo(PULSAR.inclination, 6);
        }
        // A full turn comes round.
        const a = beamDirection(0.3, basis);
        const b = beamDirection(0.3 + TAU, basis);
        a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
    });

    it('lights both beams alike, brightest on their axis and dark well off it', () => {
        const b = beamDirection(1.1, basis);
        const back = b.map((v) => -v);
        expect(beamLight(b, b)).toBeCloseTo(1 + PULSAR.skirtShare, 9);
        expect(beamLight(back, b)).toBeCloseTo(beamLight(b, b), 9);
        let prev = Infinity;
        for (let deg = 0; deg <= 60; deg += 5) {
            const a = deg * DEG;
            const d = basis.a.map((v, i) => b[i] * Math.cos(a) + (basis.e1[i] * Math.sin(a)));
            const l = beamLight(d.map((v) => v / Math.hypot(...d)), b);
            expect(l).toBeLessThanOrEqual(prev + 1e-9);
            prev = l;
        }
        expect(prev).toBeLessThan(0.01);
    });

    it('cuts the light into bars through the slats and stops most of it at the lids', () => {
        const fill = CAGE.fillClosed;
        const across = (theta) => basis.e1.map((v, i) => v * Math.cos(theta) + basis.e2[i] * Math.sin(theta));
        const pitch = TAU / CAGE.slats;
        // Through the middle of a slat and the middle of a gap, out of the wall's side.
        const inSlat = cageTransmit(across(pitch * (fill / 2)), 0, fill, basis);
        const inGap = cageTransmit(across(pitch * ((1 + fill) / 2)), 0, fill, basis);
        expect(inSlat).toBeLessThan(0.05);
        expect(inGap).toBeGreaterThan(0.95);
        // Far out the bars blend into their average: a little less than the open share.
        const even = cageTransmit(across(pitch * (fill / 2)), 0, fill, basis, 1);
        expect(even).toBeCloseTo(cageTransmit(across(pitch * ((1 + fill) / 2)), 0, fill, basis, 1), 6);
        expect(even).toBeGreaterThan(1 - fill);
        expect(even).toBeLessThan(1);
        // Along the axis: the lid, which leaks only round its rims.
        expect(cageTransmit(basis.a, 0, fill, basis)).toBeLessThanOrEqual(CAGE.lidLeak + 1e-9);
        // The cage's own turn moves the bars.
        expect(cageTransmit(across(pitch * (fill / 2)), pitch / 2, fill, basis)).toBeGreaterThan(0.95);
    });
});

describe('cosmic noir core: the events\' timing', () => {
    it('sends an echo out fast, slowing, and never as far as the camera', () => {
        expect(echoRadius(0)).toBe(0);
        expect(echoRadius(-1)).toBe(0);
        expect((echoRadius(0.001) / 0.001)).toBeCloseTo(ECHO_SPEED, 0);
        let prev = 0;
        for (let t = 0.1; t < 8; t += 0.1) {
            const r = echoRadius(t);
            expect(r).toBeGreaterThan(prev);
            prev = r;
        }
        expect(echoRadius(1e3)).toBeLessThanOrEqual(ECHO_MAX);
        expect(ECHO_MAX).toBeLessThan(PULSAR.depth - 2);
    });

    it('runs the echo\'s ring over the sea faster and further: out past the eye, toward the horizon', () => {
        expect(echoSeaRadius(0)).toBe(0);
        let prev = 0;
        for (let t = 0.1; t < 6; t += 0.1) {
            const r = echoSeaRadius(t);
            expect(r).toBeGreaterThan(prev);
            expect(r).toBeGreaterThan(echoRadius(t));
            prev = r;
        }
        expect(echoSeaRadius(1.5)).toBeGreaterThan(PULSAR.depth);
        expect(echoSeaRadius(1e3)).toBeLessThanOrEqual(ECHO_SEA_MAX);
    });

    it('flashes the far light twice a period and leaves it dark between', () => {
        let lit = 0;
        let flashes = 0;
        let on = false;
        for (let t = 0; t < FAR_LAMP.period; t += 0.01) {
            const v = farLampAt(t);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
            if (v > 0.5) lit += 0.01;
            if (v > 0.5 && !on) flashes += 1;
            on = v > 0.5;
        }
        expect(flashes).toBe(2);
        expect(lit).toBeLessThan(FAR_LAMP.period * 0.15);
        expect(farLampAt(3.3)).toBeCloseTo(farLampAt(3.3 + FAR_LAMP.period * 4), 9);
    });

    it('holds the negative, then lets it go', () => {
        expect(negativeAt(-0.01)).toBe(0);
        expect(negativeAt(0)).toBe(1);
        expect(negativeAt(NEGATIVE_HOLD * 0.9)).toBe(1);
        expect(negativeAt(NEGATIVE_HOLD + NEGATIVE_FADE)).toBeLessThan(0.15);
        expect(negativeAt(NEGATIVE_HOLD + NEGATIVE_FADE * 3)).toBeLessThan(0.01);
    });

    it('flashes two cue marks a reel change apart, each for CUE_SHOW', () => {
        const lit = [];
        for (let t = 0; t < 3; t += 0.01) if (cueAt(t) > 0) lit.push(Math.round(t * 100) / 100);
        const starts = lit.filter((t, i) => i === 0 || t - lit[i - 1] > 0.02);
        expect(starts).toHaveLength(2);
        expect(starts[1] - starts[0]).toBeCloseTo(CUE_GAP, 1);
        expect(lit.length * 0.01).toBeCloseTo(CUE_SHOW * 2, 1);
    });

    it('stands the lighthouse in a sea that lies below the eye, its lamp clear of everything', () => {
        // The eye stands at 0: the sea never reaches it, and the tower's foot stands out of the sea.
        expect(SEA_TOP).toBeLessThan(-0.5);
        expect(SEA_FLOOR).toBeLessThan(SEA.level);
        expect(SEA.level + TOWER.footLift).toBeGreaterThan(SEA_TOP - 0.3);
        // The lamp looks out over the gallery's rail, and the beam that looks down reaches the sea
        // between the rock and the eye.
        const down = 90 - PULSAR.inclination;
        expect(down).toBeGreaterThan(20);
        const reach = (PULSAR.height - SEA.level) / Math.tan(down * DEG);
        expect(reach).toBeGreaterThan(TOWER.footRadius * 3);
        expect(reach).toBeLessThan(PULSAR.depth);
    });

    it('turns the camera so the lamp hangs exactly at its anchor, over a level horizon below it', () => {
        for (const aspect of [1.33, 16 / 9, 2.4, 9 / 19.5]) {
            const a = pulsarAnchor(aspect);
            const { yaw, pitch, horizon } = lampPose(a.x, a.y, a.vFov, aspect);
            // The camera's frame for that turn and tilt (no roll).
            const f = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
            const r = [Math.cos(yaw), 0, Math.sin(yaw)];
            const up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
            const lamp = [0, PULSAR.height, -PULSAR.depth];
            const tanV = Math.tan((a.vFov * DEG) / 2);
            const ahead = dot(lamp, f);
            expect(ahead).toBeGreaterThan(0);
            expect(0.5 + dot(lamp, r) / ahead / (tanV * aspect) / 2, `x at ${aspect}`).toBeCloseTo(a.x, 6);
            expect(0.5 - dot(lamp, up) / ahead / tanV / 2, `y at ${aspect}`).toBeCloseTo(a.y, 6);
            expect(horizon).toBeGreaterThan(a.y + 0.2);
            expect(horizon).toBeLessThan(0.85);
        }
    });

    it('hangs the lantern beside the board on a landscape screen, above it on an upright phone', () => {
        for (const aspect of [1.33, 16 / 9, 2.1, 2.4]) {
            const a = pulsarAnchor(aspect);
            expect(a.x).toBeLessThan(0.3);
            expect(a.y).toBeGreaterThan(0.2);
            expect(a.y).toBeLessThan(0.5);
        }
        const phone = pulsarAnchor(9 / 19.5);
        expect(phone.x).toBe(0.5);
        expect(phone.y).toBeLessThan(0.2);
        expect(pulsarAnchor(NaN)).toEqual(pulsarAnchor(16 / 9));
    });
});
