import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function fixture(timeScale = 1, tweenScale = 1) {
    const scene = { time: { timeScale }, tweens: { timeScale: tweenScale } };
    const effects = new SharedEffects(scene);
    effects._reducedMotion = () => false;
    return { scene, effects };
}

describe('SharedEffects wall-clock hit-stop ownership', () => {
    it.each([[1, 1], [0.5, 1.7], [0, 0]])('restores scales%s/%s at the original delay', (timeScale, tweenScale) => {
        const { scene, effects } = fixture(timeScale, tweenScale);
        effects.triggerHitStop(50);
        effects.triggerHitStop(100); // Overlapping impacts do not extend the pause.
        expect(vi.getTimerCount()).toBe(1);
        expect(scene.time.timeScale).toBe(0.0001);
        vi.advanceTimersByTime(49);
        expect(scene.tweens.timeScale).toBe(0.0001);
        vi.advanceTimersByTime(1);
        expect(scene.time.timeScale).toBe(timeScale);
        expect(scene.tweens.timeScale).toBe(tweenScale);
        expect(effects._hitStopActive).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels and restores retired owners without touching replacement clocks', () => {
        const { scene, effects } = fixture(0.5, 1.7);
        const retiredTime = scene.time;
        const retiredTweens = scene.tweens;
        effects.triggerHitStop(100);
        const retiredRestore = effects._hitStopRestore;
        scene.time = { timeScale: 0.3 };
        scene.tweens = { timeScale: 0.8 };
        effects.cleanup();
        expect(vi.getTimerCount()).toBe(0);
        expect(retiredTime.timeScale).toBe(0.5);
        expect(retiredTweens.timeScale).toBe(1.7);
        expect(scene.time.timeScale).toBe(0.3);
        expect(scene.tweens.timeScale).toBe(0.8);
        expect(effects._hitStopActive).toBe(false);

        effects.triggerHitStop(50);
        retiredRestore(); // Even an already-queued retired callback is fenced.
        expect(effects._hitStopActive).toBe(true);
        expect(scene.time.timeScale).toBe(0.0001);
        vi.advanceTimersByTime(50);
        expect(scene.time.timeScale).toBe(0.3);
        expect(scene.tweens.timeScale).toBe(0.8);
        effects.cleanup();
    });

    it('restores a partially frozen owner if the other clock rejects writes', () => {
        const { scene, effects } = fixture();
        Object.defineProperty(scene.tweens, 'timeScale', { value: 1, writable: false });
        expect(() => effects.triggerHitStop(50)).not.toThrow();
        expect(scene.time.timeScale).toBe(1);
        expect(effects._hitStopActive).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });
});
