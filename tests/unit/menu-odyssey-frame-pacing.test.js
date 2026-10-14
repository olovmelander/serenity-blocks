import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import * as THREE from 'three';

import { IntroAnimation } from '../../src/ui/intro-animation.js';
import ThreeJSIntroRendererWebGPU from '../../src/ui/threejs-intro-renderer-webgpu.js';
import { OdysseyBoardController } from '../../src/rendering/odyssey/OdysseyBoardController.js';
import { OdysseyTslPipeline } from '../../src/rendering/odyssey/odyssey-post/odyssey-tsl-pipeline.js';

/**
 * The menu intro renderer and the Odyssey map drew on every display refresh, ~131 times a second on
 * the 165 Hz laptop panel, whatever the Target Frame Rate (theme and rendering audit 2026-10:
 * REND-02, REND-08 part 1 / ODYR-03). After a return to the menu the intro also kept drawing under
 * the Odyssey map, whose entry only hides its container (ODYR-27). Both now draw at the Target
 * Frame Rate with the themes' pacer, and what they smoothed per frame is smoothed by time.
 */

const VSYNC_MS = 1000 / 131.6; // what this laptop's rAF really runs at

let now = 0;
let frames = [];

function stubWindow(targetFrameRate) {
    vi.stubGlobal('window', {
        settings: { targetFrameRate, reducedMotion: false },
        serenityBlocks: { settingsManager: { get: () => ({ targetFrameRate }) } },
        location: { search: '' },
        matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        innerWidth: 1600,
        innerHeight: 900,
    });
}

/** Run `seconds` of display refreshes, each firing the callbacks queued before it. */
function runVsyncs(seconds, gapMs = VSYNC_MS) {
    const count = Math.round((seconds * 1000) / gapMs);
    for (let i = 0; i < count; i++) {
        now += gapMs;
        const due = frames;
        frames = [];
        for (const callback of due) callback(now);
    }
}

function classList(initial = []) {
    const set = new Set(initial);
    return { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) };
}

function menuIntro() {
    const intro = new IntroAnimation();
    intro.isAnimating = true;
    intro.container = {
        style: { display: '' },
        classList: classList(['background-only']),
        querySelector: () => null,
    };
    intro.threeRenderer = { update: vi.fn(), setAudioPulse: vi.fn() };
    intro.syncTitleBounds = vi.fn();
    return intro;
}

describe('the menu intro and the Odyssey map draw at the Target Frame Rate', () => {
    beforeEach(() => {
        now = 1000;
        frames = [];
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        vi.stubGlobal('requestAnimationFrame', (callback) => frames.push(callback));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe('menu intro', () => {
        it('draws about 66 times a second at a 60 fps target on a 131.6 Hz display, not 131', () => {
            stubWindow(60);
            const intro = menuIntro();
            intro.startRenderLoop();
            runVsyncs(4);
            const perSecond = intro.threeRenderer.update.mock.calls.length / 4;
            expect(perSecond).toBeGreaterThan(60);
            expect(perSecond).toBeLessThan(70);
        });

        it('draws every refresh with the Target Frame Rate unlimited', () => {
            stubWindow(0);
            const intro = menuIntro();
            intro.startRenderLoop();
            runVsyncs(2);
            expect(intro.threeRenderer.update.mock.calls.length).toBeGreaterThan(255);
        });

        it('draws nothing while the Odyssey map hides it, and again as soon as the menu shows it', () => {
            stubWindow(60);
            const intro = menuIntro();
            intro.startRenderLoop();
            runVsyncs(1);
            intro.container.style.display = 'none'; // OdysseyMode on entry
            const before = intro.threeRenderer.update.mock.calls.length;
            runVsyncs(3);
            expect(intro.threeRenderer.update.mock.calls.length).toBe(before);
            expect(frames).toHaveLength(1); // still ticking

            intro.container.style.display = ''; // showBackgroundOnly() on the way back
            runVsyncs(1);
            expect(intro.threeRenderer.update.mock.calls.length).toBeGreaterThan(before + 60);
        });

        it('smooths the music pulse by time, so the cap leaves its feel alone', () => {
            stubWindow(60);
            const pulseAfter = (dt, steps) => {
                const intro = new IntroAnimation();
                intro.soundManager = {
                    audioElement: { paused: false, ended: false },
                    hasAudioAnalyzer: () => true,
                    getAudioAnalysis: () => ({
                        bassEnergy: 1, midEnergy: 1, trebleEnergy: 1, beatDetected: false,
                    }),
                };
                for (let i = 0; i < steps; i++) intro.getMusicPulse(dt);
                return intro.smoothedAudioPulse;
            };
            expect(pulseAfter(1 / 120, 12)).toBeCloseTo(pulseAfter(1 / 60, 6), 9);
        });

        it('judges its quality against a Target Frame Rate under 60, not against 60', () => {
            const judged = (targetFrameRate) => {
                stubWindow(targetFrameRate);
                const renderer = Object.create(ThreeJSIntroRendererWebGPU.prototype);
                Object.assign(renderer, {
                    dynamicQualityEnabled: true,
                    frameTimes: [],
                    lastQualityCheck: 0,
                    quality: { key: 'HIGH' },
                    visualProfile: {
                        qualityBudgets: { HIGH: { key: 'HIGH' }, MEDIUM: { key: 'MEDIUM' }, LOW: { key: 'LOW' } },
                    },
                    applyQualitySettings: vi.fn(),
                });
                now = 5000;
                for (let i = 0; i < 59; i++) renderer.trackFrameTime(1 / 31);
                now += 2001; // it judges every 2 s
                renderer.trackFrameTime(1 / 31);
                return renderer.quality.key;
            };
            expect(judged(30)).toBe('HIGH'); // 31 fps is the cap, not load
            expect(judged(60)).toBe('LOW'); // 31 fps against 60 is load
        });
    });

    describe('Odyssey map', () => {
        function board() {
            const controller = new OdysseyBoardController({});
            controller.isActive = true;
            controller.clock = {
                last: null,
                getDelta() {
                    const d = this.last === null ? 0 : (now - this.last) / 1000;
                    this.last = now;
                    return d;
                },
            };
            controller.renderFrame = vi.fn();
            return controller;
        }

        it('draws about 66 times a second at a 60 fps target on a 131.6 Hz display, not 131', () => {
            stubWindow(60);
            const controller = board();
            controller.animate();
            runVsyncs(4);
            const perSecond = controller.renderFrame.mock.calls.length / 4;
            expect(perSecond).toBeGreaterThan(60);
            expect(perSecond).toBeLessThan(70);
            // Each drawn frame advances by the time since the last one drawn.
            const delta = controller.renderFrame.mock.calls.at(-1)[0];
            expect(delta).toBeCloseTo((2 * VSYNC_MS) / 1000, 3);
        });

        it('feeds the adaptive quality the slowest refresh since the last draw, not the cap', () => {
            stubWindow(60);
            const controller = board();
            controller.animate();
            runVsyncs(2);
            // Smooth refreshes: the quality sees ~7.6 ms of headroom, as it did uncapped, not 15 ms.
            const frameMs = controller.renderFrame.mock.calls.at(-1)[1];
            expect(frameMs).toBeCloseTo(VSYNC_MS, 3);
            expect(controller.frameMsEma).toBeCloseTo(VSYNC_MS, 0);

            // A 40 ms refresh (a stall) reaches it on the next drawn frame.
            const drawn = controller.renderFrame.mock.calls.length;
            runVsyncs(0.04, 40);
            runVsyncs(0.05);
            const after = controller.renderFrame.mock.calls.slice(drawn).map((call) => call[1]);
            expect(Math.max(...after)).toBeCloseTo(40, 3);
        });

        it('draws every refresh with the Target Frame Rate unlimited, and the quality sees each', () => {
            stubWindow(0);
            const controller = board();
            controller.animate();
            runVsyncs(2);
            expect(controller.renderFrame.mock.calls.length).toBeGreaterThan(255);
            const [delta, frameMs] = controller.renderFrame.mock.calls.at(-1);
            expect(frameMs).toBeCloseTo(delta * 1000, 3);
        });
    });

    describe('Odyssey post', () => {
        /** The pipeline with every `u*` uniform answering `{ value }`, so update() runs headless. */
        function pipeline() {
            const target = Object.assign(Object.create(OdysseyTslPipeline.prototype), {
                _seamBoost: 1,
                _smChapterTint: new THREE.Color(1, 1, 1),
            });
            return new Proxy(target, {
                get(t, key, receiver) {
                    if (typeof key === 'string' && /^u[A-Z]/.test(key) && !(key in t)) t[key] = { value: 0 };
                    return Reflect.get(t, key, receiver);
                },
            });
        }

        it('decays the chapter-seam bloom punch at the same pace at any frame rate', () => {
            const after = (dt, steps) => {
                const p = pipeline();
                for (let i = 0; i < steps; i++) p.update(dt, null);
                return p._seamBoost;
            };
            expect(after(1 / 120, 24)).toBeCloseTo(after(1 / 60, 12), 9);
            expect(after(1 / 60, 12)).toBeCloseTo(0.9 ** 12, 9);
        });
    });
});
