/**
 * Nimbus Veil — the light over the cloud sea turns by the clock in every mode, and a level is one
 * mood forward on top (nimbus-veil-moods.js, NimbusWorld.applyMood). Timings are read from the
 * module.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { NimbusWorld } from '../../src/themes/nimbus-veil/nimbus-veil-world.js';
import NimbusVeilTheme from '../../src/themes/nimbus-veil/nimbus-veil-theme.js';
import { SUN } from '../../src/themes/nimbus-veil/nimbus-veil-tsl.js';
import {
    MOODS, MOOD_COUNT, MOOD_HOLD, MOOD_KEYS, MOOD_PERIOD, PRIMARY_KEYS, SECONDARY, linearHex, moodAt,
} from '../../src/themes/nimbus-veil/nimbus-veil-moods.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const world = () => new NimbusWorld({ scene: new THREE.Scene(), random: () => 0.5 }).build();
const live = (w) => MOOD_KEYS.map((key) => w.u.mood[key].value.toArray());
const pure = (k) => MOOD_KEYS.map((key) => MOODS[k][key]);
const far = (a, b) => Math.max(...a.flatMap((c, i) => c.map((v, j) => Math.abs(v - b[i][j]))));
const resting = (k) => (k + MOOD_HOLD * 0.5) * MOOD_PERIOD;
const at = (w, time, delta = 0) => w.update({ time, delta });

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('nimbus-veil moods: the palettes', () => {
    it('opens on today\'s look: mood 0 is the colours the light was authored in, with no stars', () => {
        const gold = new THREE.Color(0xffc48c);
        expect(MOODS[0].sunLight[0]).toBeCloseTo(gold.r * 1.85, 6);
        expect(MOODS[0].sunLight[2]).toBeCloseTo(gold.b * 1.85, 6);
        for (const [key, [, hex]] of Object.entries(SECONDARY)) {
            const want = Array.isArray(hex) ? linearHex(hex[0], hex[1]) : linearHex(hex);
            expect(MOODS[0][key], key).toEqual(want);
        }
        expect(MOODS[0].stars).toBe(0);
    });

    it('has 4-6 moods, each its own, every colour finite, none negative, and no green cast', () => {
        expect(MOOD_COUNT).toBeGreaterThanOrEqual(4);
        expect(MOOD_COUNT).toBeLessThanOrEqual(6);
        expect(MOOD_KEYS.length).toBe(PRIMARY_KEYS.length + Object.keys(SECONDARY).length);
        const hue = ([r, g, b]) => {
            const mx = Math.max(r, g, b);
            const d = mx - Math.min(r, g, b);
            if (d / Math.max(mx, 1e-9) < 0.08) return null;
            let h;
            if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (mx === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            return h * 60;
        };
        for (let k = 0; k < MOOD_COUNT; k++) {
            for (const key of MOOD_KEYS) {
                for (const c of MOODS[k][key]) {
                    expect(Number.isFinite(c), `${MOODS[k].name} ${key}`).toBe(true);
                    expect(c).toBeGreaterThanOrEqual(0);
                }
                const h = hue(MOODS[k][key]);
                // A shade or a mist derived from a turned hue must never come out green.
                if (h !== null) expect(h > 75 && h < 170, `${MOODS[k].name} ${key} hue ${h}`).toBe(false);
            }
            expect(far(pure(k), pure((k + 1) % MOOD_COUNT))).toBeGreaterThan(0.15);
        }
        // Some mood brings out the stars.
        expect(Math.max(...MOODS.map((m) => m.stars))).toBeGreaterThan(0.5);
    });

    it('is a mood exactly on a whole phase, and melts in between', () => {
        for (let k = 0; k < MOOD_COUNT; k++) {
            const out = moodAt(k - MOOD_COUNT * 2);
            expect(far(MOOD_KEYS.map((key) => out[key]), pure(k))).toBeLessThan(1e-12);
            expect(out.stars).toBe(MOODS[k].stars);
        }
        const half = moodAt(1.5);
        expect(far(MOOD_KEYS.map((key) => half[key]), pure(1))).toBeGreaterThan(0.01);
        expect(far(MOOD_KEYS.map((key) => half[key]), pure(2))).toBeGreaterThan(0.01);
    });
});

describe('nimbus-veil moods: the clock turns them, a level is a step on top', () => {
    // Re-pinned 2026-11-20 (the living pass): the sun used to keep its place and change colour
    // only. It now rides an arc with the hours; what still never changes is its bearing, which
    // the deck's shadows are found along.
    it('turns through every mood by the clock alone; the sun rides its arc and keeps its bearing', () => {
        const w = world();
        for (let k = 0; k < MOOD_COUNT + 1; k++) {
            at(w, resting(k));
            const mood = MOODS[k % MOOD_COUNT];
            expect(far(live(w), pure(k % MOOD_COUNT)), `mood ${k}`).toBeLessThan(1e-6);
            expect(w.u.starGain.value).toBeCloseTo(mood.stars, 9);
            const sun = w.u.sunDir.value;
            expect(sun.x).toBe(0);
            expect(sun.z).toBeLessThan(0);
            expect(THREE.MathUtils.radToDeg(Math.asin(sun.y)), `sun in mood ${k}`).toBeCloseTo(mood.sun, 6);
            expect(w.u.sunTan.value).toBeCloseTo(Math.tan(Math.asin(sun.y)), 9);
        }
        // The first mood has the sun the place was built for. It climbs to its noon, sinks through
        // the evening and stands under the sea line in the blue hour, when none of it reaches the deck.
        expect(MOODS[0].sun).toBeCloseTo(THREE.MathUtils.radToDeg(SUN.elevation), 9);
        expect(Math.max(...MOODS.map((mood) => mood.sun))).toBe(MOODS[2].sun);
        expect(MOODS[3].sun).toBeLessThan(MOODS[0].sun);
        expect(MOODS[4].sun).toBeLessThan(0);
        at(w, resting(4));
        expect(w.u.day.value).toBe(0);
        at(w, resting(0));
        expect(w.u.day.value).toBe(1);
        at(w, MOOD_HOLD * MOOD_PERIOD * 0.99);
        expect(far(live(w), pure(0))).toBeLessThan(1e-6);
        at(w, (MOOD_HOLD + (1 - MOOD_HOLD) * 0.5) * MOOD_PERIOD);
        expect(far(live(w), pure(0))).toBeGreaterThan(0.01);
        w.dispose();
    });

    it('steps one mood forward on a level, eased over a few seconds, on top of the clock', () => {
        const w = world();
        const t0 = resting(1);
        at(w, t0);
        w.setLevel(3);
        at(w, t0 + 0.1, 0.1);
        expect(far(live(w), pure(3))).toBeGreaterThan(0.01);
        let t = t0 + 0.1;
        // Fifteen seconds: the clock is still resting on mood 1 at the end.
        expect(t0 + 15.1).toBeLessThan((1 + MOOD_HOLD) * MOOD_PERIOD);
        for (let i = 0; i < 450; i++) {
            t += 1 / 30;
            at(w, t, 1 / 30);
        }
        expect(far(live(w), pure(3))).toBeLessThan(1e-3);
        // A seek snaps the level's step: the same light as a replay.
        w.seek(t);
        at(w, t);
        expect(far(live(w), pure(3))).toBeLessThan(1e-6);
        w.dispose();
    });

    it('the theme moves the light on a LEVEL_UP whatever the background-effects setting', () => {
        vi.stubGlobal('window', {
            settings: { backgroundComboEffects: false },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            location: { search: '' },
        });
        const theme = new NimbusVeilTheme();
        theme.isActive = true;
        const stub = { setLevel: vi.fn(), onLevelUp: vi.fn(), dispose: vi.fn() };
        theme.world = stub;
        theme.setupEventListeners();
        eventBus.emit(EVENTS.LEVEL_UP, { level: 3 });
        expect(stub.setLevel).toHaveBeenCalledWith(3);
        expect(stub.onLevelUp).not.toHaveBeenCalled();
        eventBus.emit(EVENTS.LEVEL_UP, {});
        expect(stub.setLevel).toHaveBeenLastCalledWith(4);
        window.settings.backgroundComboEffects = true;
        eventBus.emit(EVENTS.LEVEL_UP, { level: 5 });
        expect(stub.onLevelUp).toHaveBeenCalledTimes(1);
        theme.clearEventUnsubscribers();
    });

    it('keeps the level-up\'s own wave and burst', () => {
        const w = world();
        at(w, 10);
        w.setLevel(2);
        w.onLevelUp();
        at(w, 10.5, 0.5);
        expect(w.u.rings.some((r) => r.value.z > 0)).toBe(true);
        expect(w.sunPulse).toBeGreaterThan(0);
        expect(w.u.blaze.value.w).toBeGreaterThan(0);
        w.dispose();
    });
});
