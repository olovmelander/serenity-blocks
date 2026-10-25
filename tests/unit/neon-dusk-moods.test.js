/**
 * Neon Dusk — the moods of the dusk turn by the clock in every mode, and a level is one mood
 * forward on top (neon-dusk-moods.js, NeonDuskWorld.applyMood). Timings are read from the module.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { NeonDuskWorld } from '../../src/themes/neon-dusk/neon-dusk-world.js';
import NeonDuskTheme from '../../src/themes/neon-dusk/neon-dusk-theme.js';
import {
    MOODS, MOOD_COUNT, MOOD_HOLD, MOOD_KEYS, MOOD_PERIOD, PRIMARY_KEYS, SECONDARY, linearHex, moodAt,
} from '../../src/themes/neon-dusk/neon-dusk-moods.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const world = () => new NeonDuskWorld({ scene: new THREE.Scene(), random: () => 0.5 }).build();
/** The live mood uniforms as plain arrays. */
const live = (w) => MOOD_KEYS.map((key) => w.u.mood[key].value.toArray());
const pure = (k) => MOOD_KEYS.map((key) => MOODS[k][key]);
/** The largest difference in any channel of any colour. */
const far = (a, b) => Math.max(...a.flatMap((c, i) => c.map((v, j) => Math.abs(v - b[i][j]))));
/** The middle of mood k's rest on the clock alone. */
const resting = (k) => (k + MOOD_HOLD * 0.5) * MOOD_PERIOD;
const at = (w, time, delta = 0) => w.update({ time, delta });

describe('neon-dusk moods: the palettes', () => {
    it('opens on today\'s look: mood 0 is the colours the dusk was authored in', () => {
        const today = new THREE.Color(0x4e2b86);
        expect(MOODS[0].hazeA[0]).toBeCloseTo(today.r, 6);
        expect(MOODS[0].hazeA[2]).toBeCloseTo(today.b, 6);
        for (const [key, [, hex]] of Object.entries(SECONDARY)) {
            const want = Array.isArray(hex) ? linearHex(hex[0], hex[1]) : linearHex(hex);
            expect(MOODS[0][key], key).toEqual(want);
        }
        expect(MOODS[0].stars).toBe(1);
    });

    it('has 4-6 moods, each clearly its own, every colour finite and none negative', () => {
        expect(MOOD_COUNT).toBeGreaterThanOrEqual(4);
        expect(MOOD_COUNT).toBeLessThanOrEqual(6);
        expect(MOOD_KEYS.length).toBe(PRIMARY_KEYS.length + Object.keys(SECONDARY).length);
        for (let k = 0; k < MOOD_COUNT; k++) {
            for (const key of MOOD_KEYS) {
                for (const c of MOODS[k][key]) {
                    expect(Number.isFinite(c), `${MOODS[k].name} ${key}`).toBe(true);
                    expect(c).toBeGreaterThanOrEqual(0);
                }
            }
            // The horizon toward the sun reads differently from the next mood's.
            expect(far(pure(k), pure((k + 1) % MOOD_COUNT))).toBeGreaterThan(0.15);
        }
    });

    it('is a mood exactly on a whole phase, and melts in between', () => {
        for (let k = 0; k < MOOD_COUNT; k++) {
            const out = moodAt(k + MOOD_COUNT * 3);
            expect(far(MOOD_KEYS.map((key) => out[key]), pure(k))).toBeLessThan(1e-12);
            expect(out.stars).toBe(MOODS[k].stars);
        }
        const half = moodAt(0.5);
        expect(far(MOOD_KEYS.map((key) => half[key]), pure(0))).toBeGreaterThan(0.01);
        expect(far(MOOD_KEYS.map((key) => half[key]), pure(1))).toBeGreaterThan(0.01);
    });
});

describe('neon-dusk moods: the clock turns them, a level is a step on top', () => {
    it('turns through every mood by the clock alone, with no level-up', () => {
        const w = world();
        for (let k = 0; k < MOOD_COUNT + 1; k++) {
            at(w, resting(k));
            expect(far(live(w), pure(k % MOOD_COUNT)), `mood ${k}`).toBeLessThan(1e-6);
        }
        // At the start it is today's look, all through the first rest.
        at(w, 0);
        expect(far(live(w), pure(0))).toBeLessThan(1e-6);
        at(w, MOOD_HOLD * MOOD_PERIOD * 0.99);
        expect(far(live(w), pure(0))).toBeLessThan(1e-6);
        // ...and then it melts toward the next.
        at(w, (MOOD_HOLD + (1 - MOOD_HOLD) * 0.5) * MOOD_PERIOD);
        expect(far(live(w), pure(0))).toBeGreaterThan(0.01);
        w.dispose();
    });

    it('steps one mood forward on a level, eased over a few seconds, on top of the clock', () => {
        const w = world();
        const t0 = resting(2);
        at(w, t0);
        expect(far(live(w), pure(2))).toBeLessThan(1e-6);
        w.setLevel(2);
        at(w, t0 + 0.1, 0.1);
        // Not yet: the step eases in.
        expect(far(live(w), pure(3))).toBeGreaterThan(0.01);
        let t = t0 + 0.1;
        for (let i = 0; i < 300; i++) {
            t += 1 / 30;
            at(w, t, 1 / 30);
        }
        expect(far(live(w), pure(3))).toBeLessThan(1e-3);
        // A level goes round the wheel the short way, and a seek lands on the same light.
        w.setLevel(1 + MOOD_COUNT);
        w.seek(t);
        at(w, t);
        expect(far(live(w), pure(2))).toBeLessThan(1e-6);
        w.dispose();
    });

    it('the theme moves the dusk on a LEVEL_UP whatever the background-effects setting', () => {
        vi.stubGlobal('window', {
            settings: { backgroundComboEffects: false },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            location: { search: '' },
        });
        const theme = new NeonDuskTheme();
        theme.isActive = true;
        const stub = { setLevel: vi.fn(), onLevelUp: vi.fn(), dispose: vi.fn() };
        theme.world = stub;
        theme.setupEventListeners();
        eventBus.emit(EVENTS.LEVEL_UP, { level: 4 });
        expect(stub.setLevel).toHaveBeenCalledWith(4);
        expect(stub.onLevelUp).not.toHaveBeenCalled();
        // With no level in the payload it counts on from the last one.
        eventBus.emit(EVENTS.LEVEL_UP, {});
        expect(stub.setLevel).toHaveBeenLastCalledWith(5);
        window.settings.backgroundComboEffects = true;
        eventBus.emit(EVENTS.LEVEL_UP, { level: 6 });
        expect(stub.onLevelUp).toHaveBeenCalledTimes(1);
        theme.clearEventUnsubscribers();
    });

    it('keeps the level-up\'s own burst: the sun swells, a halo and a floor wave leave', () => {
        const w = world();
        at(w, 10);
        w.setLevel(2);
        w.onLevelUp();
        at(w, 10.3, 0.3);
        expect(w.sunPulse).toBeGreaterThan(0.3);
        expect(w.u.holo0.value.z + w.u.holo1.value.z + w.u.holo2.value.z).toBeGreaterThan(0);
        expect(w.surge.sample(10.3).level).toBeGreaterThan(0);
        w.dispose();
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});
