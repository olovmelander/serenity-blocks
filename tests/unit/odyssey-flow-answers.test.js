/**
 * The world's answers between two orbs (src/rendering/odyssey/odyssey-flow-answers.js): the
 * finished orb's stars land, the rail lights up toward the next orb and that orb wakes; and the
 * two parts that play them (LevelNodeManager.landStars, OdysseyPathRenderer.playRipple).
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import {
    RAIL_RIPPLE, STAR_LANDING, answerOrbFinished, lightRailAhead, railRippleDurationMs, resolveRailRipple,
    starLandingPose, starLandingTotalMs,
} from '../../src/rendering/odyssey/odyssey-flow-answers.js';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { OdysseyPathRenderer } from '../../src/rendering/odyssey/OdysseyPathRenderer.js';
import { createPathGlowTSL, createPathOuterTSL } from '../../src/rendering/odyssey/odyssey-path-renderer.tsl.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';

describe('the stars landing on a finished orb', () => {
    it('drop onto their seats one after the other and settle at their own size', () => {
        // Before its turn a star is not there; the first starts at once.
        expect(starLandingPose(0, 0)).toEqual({ scale: 0, lift: STAR_LANDING.drop });
        expect(starLandingPose(STAR_LANDING.staggerMs - 1, 1).scale).toBe(0);
        expect(starLandingPose(STAR_LANDING.staggerMs + 40, 1).scale).toBeGreaterThan(0);
        // It falls (never rises) and swells past its size as it touches down.
        let last = STAR_LANDING.drop + 1;
        let peak = 0;
        for (let ms = 1; ms < STAR_LANDING.durationMs; ms += 10) {
            const pose = starLandingPose(ms, 0);
            expect(pose.lift).toBeLessThanOrEqual(last);
            last = pose.lift;
            peak = Math.max(peak, pose.scale);
        }
        expect(peak).toBeCloseTo(STAR_LANDING.swell, 1);
        expect(peak).toBeGreaterThan(1.1);
        // Landed: exactly its seat and its size, so the settled billboard pass takes over unseen.
        expect(starLandingPose(STAR_LANDING.durationMs, 0)).toEqual({ scale: 1, lift: 0 });
        expect(starLandingPose(starLandingTotalMs(), 2)).toEqual({ scale: 1, lift: 0 });
        // Short: it is seen after every orb.
        expect(starLandingTotalMs()).toBeLessThan(1000);
    });

    it('has no step a frame could show: scale and lift are continuous through the touch-down', () => {
        for (let ms = 2; ms < STAR_LANDING.durationMs; ms += 2) {
            const a = starLandingPose(ms - 2, 0);
            const b = starLandingPose(ms, 0);
            expect(Math.abs(b.scale - a.scale)).toBeLessThan(0.06);
            expect(Math.abs(b.lift - a.lift)).toBeLessThan(0.05);
        }
    });
});

describe('the ripple of light along the rail', () => {
    const ripple = (elapsed) => ({
        from: 0.2, to: 0.3, elapsed, duration: 1.5, strength: 1,
    });

    it('waits dark through its delay, runs from one orb to the next, arrives once and fades out', () => {
        expect(resolveRailRipple(ripple(-0.2), 1000)).toMatchObject({
            head: 200, strength: 0, arrived: false, done: false,
        });
        const early = resolveRailRipple(ripple(0.3), 1000);
        const late = resolveRailRipple(ripple(1.2), 1000);
        expect(early.head).toBeGreaterThan(200);
        expect(late.head).toBeGreaterThan(early.head);
        expect(late.head).toBeLessThanOrEqual(300);
        expect(early.strength).toBeGreaterThan(0.9);
        // It leaves fast and arrives gently: past half-way in the first third of its time.
        expect(resolveRailRipple(ripple(0.5), 1000).head).toBeGreaterThan(250);
        const arrived = resolveRailRipple(ripple(1.5), 1000);
        expect(arrived).toMatchObject({ head: 300, arrived: true, done: false });
        expect(arrived.strength).toBeCloseTo(1);
        const fading = resolveRailRipple(ripple(1.5 + RAIL_RIPPLE.fadeOutSeconds / 2), 1000);
        expect(fading.strength).toBeGreaterThan(0);
        expect(fading.strength).toBeLessThan(0.5);
        expect(resolveRailRipple(ripple(1.5 + RAIL_RIPPLE.fadeOutSeconds), 1000)).toMatchObject({ strength: 0, done: true });
    });

    it('runs backwards as well, and takes longer over a longer stretch, within its bounds', () => {
        const back = resolveRailRipple({
            from: 0.3, to: 0.2, elapsed: 0.6, duration: 1.5, strength: 1,
        }, 1000);
        expect(back.head).toBeLessThan(300);
        expect(back.head).toBeGreaterThanOrEqual(200);
        expect(railRippleDurationMs(0.2, 0.2, 2500)).toBe(RAIL_RIPPLE.minMs);
        expect(railRippleDurationMs(0.2, 0.2001, 2500)).toBeCloseTo(RAIL_RIPPLE.minMs, -1);
        expect(railRippleDurationMs(0.2, 0.213, 2500)).toBeGreaterThan(RAIL_RIPPLE.minMs);
        expect(railRippleDurationMs(0.2, 0.9, 2500)).toBe(RAIL_RIPPLE.maxMs);
    });

    it('is a uniform the path renderer steps on its own clock, calling the arrival once', () => {
        const renderer = new OdysseyPathRenderer({ add() {}, remove() {} });
        // No rail built yet: nothing to light.
        expect(renderer.playRipple({ from: 0.1, to: 0.2 })).toBe(false);
        const uRipple = {
            value: {
                z: 0,
                set: vi.fn(function set(x, y, z, w) {
                    Object.assign(this, {
                        x, y, z, w,
                    });
                }),
            },
        };
        renderer._chapterUniforms = { uRipple, uArc: { value: 2000 } };
        expect(renderer.playRipple({ from: 0.1, to: 0.1 })).toBe(false);
        const onArrive = vi.fn();
        expect(renderer.playRipple({
            from: 0.1, to: 0.2, durationMs: 1000, delayMs: 200, onArrive,
        })).toBe(true);
        renderer._updateRipple(0.1);
        expect(uRipple.value.z).toBe(0);
        for (let i = 0; i < 6; i++) renderer._updateRipple(0.1);
        expect(uRipple.value.z).toBeGreaterThan(0.9);
        expect(uRipple.value.x).toBeGreaterThan(200);
        expect(uRipple.value.w).toBe(1);
        expect(onArrive).not.toHaveBeenCalled();
        for (let i = 0; i < 8; i++) renderer._updateRipple(0.1);
        expect(onArrive).toHaveBeenCalledTimes(1);
        for (let i = 0; i < 8; i++) renderer._updateRipple(0.1);
        expect(renderer._ripple).toBeNull();
        renderer._updateRipple(0.1);
        expect(uRipple.value.z).toBe(0);
        // One stalled frame advances it a tenth of a second at most.
        renderer.playRipple({ from: 0.1, to: 0.2, durationMs: 1000 });
        renderer._updateRipple(5);
        expect(renderer._ripple.elapsed).toBeCloseTo(0.1);
    });
});

describe('the flow asking the world to answer', () => {
    const board = (positions = { 14: 0.18, 15: 0.19 }) => {
        const ripples = [];
        return {
            ripples,
            nodeManager: {
                landStars: vi.fn(),
                pulseNode: vi.fn(),
                getNodePathPosition: (id) => positions[id] ?? null,
            },
            pathRenderer: {
                pathCurve: { getLength: () => 2500 },
                playRipple: vi.fn((ripple) => { ripples.push(ripple); return true; }),
            },
        };
    };

    it('lands the stars and swells the orb as its gate opens, and lights the rail on a plain return', () => {
        const world = board();
        expect(answerOrbFinished(world, { finishedId: 14, nextId: 15 })).toBe(true);
        expect(world.nodeManager.landStars).toHaveBeenCalledWith(14);
        expect(world.nodeManager.pulseNode).toHaveBeenCalledWith(14, 760);
        expect(world.ripples).toHaveLength(1);
        expect(world.ripples[0]).toMatchObject({ from: 0.18, to: 0.19 });
        expect(world.ripples[0].delayMs).toBeGreaterThan(0);
        // The orb ahead wakes when the light reaches it, more gently than an orb being entered.
        world.ripples[0].onArrive();
        expect(world.nodeManager.pulseNode).toHaveBeenLastCalledWith(15, 1000, 0.12);
    });

    it('leaves the rail to the ride when the journey goes on, and lights it as the ride begins', () => {
        const world = board();
        answerOrbFinished(world, { finishedId: 14, nextId: 15, ripple: false });
        expect(world.nodeManager.landStars).toHaveBeenCalled();
        expect(world.ripples).toHaveLength(0);
        expect(lightRailAhead(world, { fromId: 14, toId: 15 })).toBe(true);
        expect(world.ripples).toHaveLength(1);
        expect(world.ripples[0].durationMs).toBeLessThan(1500);
    });

    it('does nothing under reduced motion, without a next orb, or without a world, and never throws', () => {
        const world = board();
        expect(answerOrbFinished(world, { finishedId: 14, nextId: 15, reducedMotion: true })).toBe(false);
        expect(world.nodeManager.landStars).not.toHaveBeenCalled();
        expect(lightRailAhead(world, { fromId: 14, toId: 15, reducedMotion: true })).toBe(false);
        expect(lightRailAhead(world, { fromId: 14, toId: null })).toBe(false);
        expect(lightRailAhead(world, { fromId: 14, toId: 99 })).toBe(false);
        expect(answerOrbFinished(world, { finishedId: 14, nextId: null })).toBe(true);
        expect(world.ripples).toHaveLength(0);
        expect(answerOrbFinished(null, { finishedId: 14 })).toBe(false);
        expect(answerOrbFinished({}, { finishedId: 14 })).toBe(false);
        expect(answerOrbFinished(world, { finishedId: NaN })).toBe(false);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const broken = board();
        broken.nodeManager.landStars = () => { throw new Error('disposed'); };
        expect(answerOrbFinished(broken, { finishedId: 14 })).toBe(false);
        broken.pathRenderer.playRipple = () => { throw new Error('disposed'); };
        expect(lightRailAhead(broken, { fromId: 14, toId: 15 })).toBe(false);
        warn.mockRestore();
    });
});

describe('the rail shader with the ripple in it', () => {
    // No GPU here: the node builders write the shader text, which is where a bad graph shows.
    it.each([['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]])(
        'builds for %s, the body and the glow, with nothing said and no value read before it is set',
        (language, Builder) => {
            [createPathOuterTSL, createPathGlowTSL].forEach((create) => {
                const built = create(uniform(0));
                const mesh = built.mesh ?? new THREE.Mesh(built.geometry, built.material);
                const out = build(Builder, mesh);
                expect(out.thrown, `${create.name} ${language}`).toBeUndefined();
                expect(out.heard, `${create.name} ${language}`).toEqual([]);
                expect(out.fragment.length, `${create.name} ${language}`).toBeGreaterThan(400);
                if (language === 'WGSL') expect(unassignedReads(out.fragment), create.name).toEqual([]);
            });
        },
    );
});
