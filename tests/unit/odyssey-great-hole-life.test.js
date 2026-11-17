/**
 * THE HOLE IS ALIVE (2026-11-17, the Odyssey masterpiece pass). The traced hole was the same
 * picture for seven orbs. Pinned here: the clock's life (knots, a stream, a flare) is continuous
 * and bounded, the hole wakes from an ember to its full blaze by progress and hands back to the
 * plain disk before the dive, its size comes up orb by orb, and the lens still builds with it.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

import {
    GREAT_HOLE_FLARE,
    GREAT_HOLE_INNER_ORBIT_SECONDS,
    GREAT_HOLE_KNOTS,
    GREAT_HOLE_STREAM,
    GREAT_HOLE_WAKE,
    greatHoleLifeAt,
    greatHoleOrbitSeconds,
    greatHoleStreamAt,
    greatHoleWakeAt,
} from '../../src/rendering/odyssey/chapter-environments/odyssey-great-hole-life.js';
import {
    GREAT_HOLE_HOLE,
    createGreatHoleLensSteps,
    getGreatHoleLifeClock,
    setGreatHoleWake,
} from '../../src/rendering/odyssey/chapter-environments/odyssey-great-hole-lens.tsl.js';
import {
    DEEP_SPACE_BEATS,
    OMEN_SPINE_ANCHOR,
    resolveOmenSpineScale,
} from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.js';
import { OMEN_SHADOW_RADIUS } from '../../src/rendering/odyssey/chapter-environments/cosmic-expanse.tsl.js';
import { GREAT_HOLE_LOCK } from '../../src/rendering/odyssey/chapter-environments/black-hole-transcendence.tsl.js';
import { runChapterSteps } from '../../src/rendering/odyssey/chapter-environments/shared/chapter-build-steps.js';
import { getActiveOdysseyChapterPositions } from '../../src/rendering/odyssey/path-utils.js';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { build } from './helpers/tsl-node-build.js';

describe('the knots circling in the disk', () => {
    it('sit inside the disk, the inner ones lapping the outer (Kepler)', () => {
        GREAT_HOLE_KNOTS.forEach((k) => {
            expect(k.radius).toBeGreaterThan(GREAT_HOLE_HOLE.DISK_INNER);
            expect(k.radius).toBeLessThan(GREAT_HOLE_HOLE.DISK_OUTER);
        });
        expect(greatHoleOrbitSeconds(3)).toBeCloseTo(GREAT_HOLE_INNER_ORBIT_SECONDS, 9);
        expect(greatHoleOrbitSeconds(12) / greatHoleOrbitSeconds(3)).toBeCloseTo(8, 9);
        // Slow enough to follow, quick enough to see: every knot is round in under two minutes.
        GREAT_HOLE_KNOTS.forEach((k) => {
            expect(greatHoleOrbitSeconds(k.radius)).toBeGreaterThan(12);
            expect(greatHoleOrbitSeconds(k.radius)).toBeLessThan(120);
        });
        // One of them is a gap, the rest are light.
        expect(GREAT_HOLE_KNOTS.filter((k) => k.gain < 0)).toHaveLength(1);
    });

    it('only ever turn forward, and breathe without a step', () => {
        let prev = greatHoleLifeAt(0).knots;
        for (let t = 0.05; t < 240; t += 0.05) {
            const now = greatHoleLifeAt(t).knots;
            for (let i = 0; i < now.length; i += 1) {
                const k = now[i];
                const turned = (((k[1] - prev[i][1]) % 1) + 1) % 1;
                expect(turned, `knot ${i} at ${t.toFixed(2)}`).toBeLessThan(0.01);
                expect(Math.abs(k[2] - prev[i][2])).toBeLessThan(0.02);
                expect(Math.abs(k[2])).toBeLessThanOrEqual(Math.abs(GREAT_HOLE_KNOTS[i].gain) + 1e-9);
                expect(k[0]).toBe(GREAT_HOLE_KNOTS[i].radius);
            }
            prev = now;
        }
    });
});

describe('the stream and the flare', () => {
    const S = GREAT_HOLE_STREAM;
    const F = GREAT_HOLE_FLARE;

    it('winds in from the rim to the inner edge, once a period', () => {
        expect(S.from).toBeLessThan(GREAT_HOLE_HOLE.DISK_OUTER);
        expect(S.to).toBeGreaterThan(GREAT_HOLE_HOLE.DISK_INNER);
        expect(greatHoleStreamAt(0.001).radius).toBeCloseTo(S.from, 2);
        expect(greatHoleStreamAt(S.fall).radius).toBeCloseTo(S.to, 6);
        let prev = S.from + 1;
        for (let t = 0; t <= S.fall; t += 0.25) {
            const { radius } = greatHoleStreamAt(t);
            expect(radius).toBeLessThanOrEqual(prev);
            prev = radius;
        }
        // The spiral's pitch is what carries `from` to `to` in `turns`.
        expect(S.from * Math.exp(-greatHoleStreamAt(1).pitch * S.turns)).toBeCloseTo(S.to, 9);
    });

    it('comes from nothing and goes to nothing: no step in its light across a whole period, or the next', () => {
        expect(S.fall + S.drain).toBeLessThan(S.period);
        expect((S.fall - F.lead) + F.rise + F.fall).toBeLessThan(S.period);
        let prev = greatHoleStreamAt(0);
        expect(prev.gain).toBe(0);
        expect(prev.flare).toBe(0);
        for (let t = 0.02; t < S.period * 2.2; t += 0.02) {
            const now = greatHoleStreamAt(t);
            expect(Math.abs(now.gain - prev.gain), `gain at ${t.toFixed(2)}`).toBeLessThan(0.02);
            expect(Math.abs(now.flare - prev.flare), `flare at ${t.toFixed(2)}`).toBeLessThan(0.01);
            expect(Math.abs(now.length - prev.length)).toBeLessThan(0.01);
            expect(now.flare).toBeGreaterThanOrEqual(0);
            expect(now.flare).toBeLessThanOrEqual(1);
            // The head's place may only jump while the thread is dark (between streams).
            if (now.gain > 1e-3 && prev.gain > 1e-3) {
                expect(Math.abs(now.radius - prev.radius)).toBeLessThan(0.05);
            }
            prev = now;
        }
    });

    it('swells the inner disk as the head lands, slowly (a swell, never a flash)', () => {
        const peak = greatHoleStreamAt(S.fall - F.lead + F.rise);
        expect(peak.flare).toBeGreaterThan(0.95);
        expect(greatHoleStreamAt(S.fall - F.lead - 0.5).flare).toBe(0);
        expect(F.rise).toBeGreaterThanOrEqual(3);
        expect(F.fall).toBeGreaterThan(F.rise);
        // Each stream enters somewhere else on the rim.
        const first = greatHoleStreamAt(1).turn;
        const second = greatHoleStreamAt(S.period + 1).turn;
        expect(Math.abs(first - second)).toBeGreaterThan(0.1);
    });
});

describe('the hole wakes orb by orb', () => {
    const cp = getActiveOdysseyChapterPositions();
    const from = cp[5] + ((cp[6] - cp[5]) * DEEP_SPACE_BEATS.hole[0]);
    const to = cp[6];
    const { levelPositionsById } = getLevelRegistry().getPresentationLayout();

    it('is an ember at its first light and the full blaze at the last orb before the mouth', () => {
        const first = greatHoleWakeAt(from, from, to);
        expect(first.wake).toBe(0);
        expect(first.heat).toBeCloseTo(GREAT_HOLE_WAKE.heat, 9);
        expect(first.gain).toBeCloseTo(GREAT_HOLE_WAKE.gain, 9);
        const last = greatHoleWakeAt(levelPositionsById[48], from, to);
        expect(last.wake).toBeGreaterThan(0.999);
        expect(last.heat).toBeCloseTo(1, 3);
        expect(last.gain).toBeCloseTo(1, 3);
        expect(last.corona).toBeCloseTo(1, 3);
        // Every orb from 42 to 48 is its own step: each warmer and brighter than the last.
        let prev = -1;
        for (let id = 42; id <= 48; id += 1) {
            const { wake } = greatHoleWakeAt(levelPositionsById[id], from, to);
            expect(wake - prev, `orb ${id}`).toBeGreaterThan(0.04);
            prev = wake;
        }
    });

    it('never dims on the way in, without a step', () => {
        let prev = greatHoleWakeAt(from - 0.01, from, to);
        for (let p = from - 0.01; p <= to + 0.01; p += 0.0002) {
            const now = greatHoleWakeAt(p, from, to);
            expect(now.heat).toBeGreaterThanOrEqual(prev.heat - 1e-12);
            expect(now.gain).toBeGreaterThanOrEqual(prev.gain - 1e-12);
            expect(now.gain - prev.gain).toBeLessThan(0.004);
            expect(Math.abs(now.life - prev.life)).toBeLessThan(0.06);
            prev = now;
        }
    });

    it('hands the clock\'s life back to the plain disk before the mouth: the dive keeps its hole', () => {
        // Alive at every orb of the approach...
        for (let id = 42; id <= 48; id += 1) {
            expect(greatHoleWakeAt(levelPositionsById[id], from, to).life, `orb ${id}`).toBeGreaterThan(0.999);
        }
        // ...and the plain disk at full blaze from just before the mouth on (chapter 7's stretch).
        const dive = greatHoleWakeAt(to - GREAT_HOLE_WAKE.lifeOut[1], from, to);
        expect(dive.life).toBe(0);
        expect(dive.heat).toBe(1);
        expect(dive.gain).toBe(1);
        expect(dive.corona).toBe(1);
        // Without a journey (a chapter that never drives it): the plain disk at full blaze.
        expect(greatHoleWakeAt(Number.NaN, from, to)).toEqual({
            wake: 1, heat: 1, gain: 1, corona: 1, life: 0,
        });
    });

    it('comes up to chapter 7\'s size over the orbs where its light shows, steady before them', () => {
        const lockScale = GREAT_HOLE_LOCK.shadowRadius / OMEN_SHADOW_RADIUS;
        const A = OMEN_SPINE_ANCHOR;
        expect(resolveOmenSpineScale(1)).toBeCloseTo(lockScale, 9);
        expect(resolveOmenSpineScale(A.approachOver[1])).toBeCloseTo(lockScale, 9);
        expect(resolveOmenSpineScale(0)).toBeCloseTo(lockScale / (1 + A.approachGain), 9);
        expect(resolveOmenSpineScale(A.approachOver[0])).toBeCloseTo(resolveOmenSpineScale(0), 9);
        let prev = 0;
        for (let t = 0; t <= 1; t += 0.002) {
            const s = resolveOmenSpineScale(t);
            expect(s).toBeGreaterThanOrEqual(prev - 1e-12);
            expect(s - prev < lockScale * 0.004 || prev === 0).toBe(true);
            prev = s;
        }
        // Still a great hole from the first frame: no more than a quarter smaller there.
        expect(A.approachGain).toBeLessThanOrEqual(0.3);
    });
});

describe('the lens with its life', () => {
    it('advances one shared clock and writes the wake', () => {
        const a = runChapterSteps(createGreatHoleLensSteps({ shadowRadius: 24, uReveal: uniform(1) }));
        const b = runChapterSteps(createGreatHoleLensSteps({ shadowRadius: 24, uReveal: uniform(1) }));
        const before = getGreatHoleLifeClock();
        a.update(null, 0.5, 1);
        const after = getGreatHoleLifeClock();
        expect(after - before).toBeCloseTo(0.5, 9);
        // The other lens updating in the same frame does not advance it again.
        b.update(null, 0.5, 1);
        expect(getGreatHoleLifeClock()).toBeCloseTo(after, 9);
        setGreatHoleWake({
            heat: 0.9, gain: 0.8, corona: 0.7, life: 1,
        });
        setGreatHoleWake({
            heat: 1, gain: 1, corona: 1, life: 0,
        });
        a.dispose();
        b.dispose();
    });

    [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]].forEach(([label, Builder]) => {
        it(`builds with the knots and the stream on High, and without them on Low (${label})`, () => {
            const high = runChapterSteps(createGreatHoleLensSteps({ shadowRadius: 24, uReveal: uniform(1) }));
            const low = runChapterSteps(createGreatHoleLensSteps({ shadowRadius: 24, uReveal: uniform(1), quality: 'low' }));
            const outHigh = build(Builder, high.mesh);
            const outLow = build(Builder, low.mesh);
            [outHigh, outLow].forEach((out) => {
                expect(out.thrown, `${out.thrown?.stack ?? ''}`).toBeUndefined();
                expect(out.heard).toEqual([]);
                expect(out.fragment).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
            });
            // The life is a tier's worth of shader: Low does not carry the knots' loop.
            expect(outHigh.fragment.length).toBeGreaterThan(outLow.fragment.length);
            high.dispose();
            low.dispose();
        }, 60_000);
    });
});
