import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';

import MistyLakeTheme from '../../src/themes/misty-lake/misty-lake-theme.js';
import RainyWindowTheme from '../../src/themes/rainy-window/rainy-window-theme.js';

/**
 * Misty Lake and Rainy Window run their own classic WebGL loops, and neither asked
 * BaseTheme.shouldRenderFrame(): they drew on every display refresh, ~131 times a second on the
 * 165 Hz laptop panel, at about three times the GPU power of a capped theme (theme and rendering
 * audit 2026-10: THM-180, THM-229/230, PIPE-16). Rainy Window also stepped its storm by 1/60 s a
 * frame, so on that panel it ran 2.2 times too fast, and every extra start stacked another loop
 * (PIPE-17).
 */

const VSYNC_MS = 1000 / 131.6; // what this laptop's rAF really runs at

let now = 0;
let frames = [];

function stubWindow(targetFrameRate) {
    vi.stubGlobal('window', {
        settings: { reducedMotion: false },
        serenityBlocks: { settingsManager: { get: () => ({ targetFrameRate }) } },
        matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        innerWidth: 1600,
        innerHeight: 900,
    });
}

/** Run `seconds` of display refreshes, each one firing the callbacks queued before it. */
function runVsyncs(seconds) {
    const count = Math.round((seconds * 1000) / VSYNC_MS);
    for (let i = 0; i < count; i++) {
        now += VSYNC_MS;
        const due = frames;
        frames = [];
        for (const callback of due) callback(now);
    }
}

function mistyLake() {
    const theme = Object.create(MistyLakeTheme.prototype);
    Object.assign(theme, {
        name: 'misty-lake',
        isActive: true,
        isPaused: false,
        animationIds: [],
        animationFrameId: null,
        renderFrameToken: 0,
        _themeFpsCapEnabled: true,
        clock: {
            last: null,
            getDelta() {
                const d = this.last === null ? 0 : (now - this.last) / 1000;
                this.last = now;
                return d;
            },
        },
        time: 0,
        renderer: { render: vi.fn(), info: null },
        scene: {},
        camera: {},
        water: null,
        composer: null,
        qualityPreset: { enableBloom: false, bloomStrength: 1 },
        flags: {},
    });
    for (const step of ['updateUniforms', 'animateCamera', 'animateEffects', 'updateRipples', 'updateMistBursts']) {
        theme[step] = vi.fn();
    }
    return theme;
}

function rainyWindow() {
    const theme = new RainyWindowTheme();
    Object.assign(theme, {
        isActive: true,
        _themeFpsCapEnabled: true,
        renderer: { render: vi.fn() },
        scene: {},
        camera: new THREE.PerspectiveCamera(60, 16 / 9, 1, 20000),
        nextLightningTime: Infinity,
        nextDipTime: Infinity,
    });
    return theme;
}

describe('the classic WebGL themes draw at the Target Frame Rate', () => {
    beforeEach(() => {
        now = 0;
        frames = [];
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        vi.stubGlobal('requestAnimationFrame', (callback) => frames.push(callback));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('misty-lake: about 66 frames a second at a 60 fps target on a 131.6 Hz display, not 131', () => {
        stubWindow(60);
        const theme = mistyLake();
        theme.startRenderLoop();
        runVsyncs(4);
        const perSecond = theme.renderer.render.mock.calls.length / 4;
        expect(perSecond).toBeGreaterThan(60);
        expect(perSecond).toBeLessThan(70);
        // The skipped refreshes still keep the loop alive and the clock whole.
        expect(frames).toHaveLength(1);
        expect(theme.time).toBeCloseTo(4, 1);
    });

    it('misty-lake: draws every refresh when the Target Frame Rate is unlimited', () => {
        stubWindow(0);
        const theme = mistyLake();
        theme.startRenderLoop();
        runVsyncs(2);
        expect(theme.renderer.render.mock.calls.length).toBeGreaterThan(255);
    });

    it('misty-lake: its glow, bloom and birds keep their pace at any frame rate', () => {
        const run = (delta, steps) => {
            const theme = Object.create(MistyLakeTheme.prototype);
            Object.assign(theme, {
                time: 0,
                glowIntensity: 0,
                targetGlowIntensity: 1,
                bloomBoost: 1,
                bloomPass: { strength: 0 },
                qualityPreset: { bloomStrength: 0.5 },
                mistMaterials: [],
                mountainMaterials: [],
                treeMaterials: [],
                lilyPadMaterials: [],
                reedMaterials: [],
                birdMaterials: [{ uniforms: { uTime: { value: 0 }, uBirdPos: { value: new THREE.Vector3() } } }],
                birdData: [{
                    x: 0, y: 10, z: -50, speed: 1, phase: 0,
                }],
            });
            for (let i = 0; i < steps; i++) {
                theme.time += delta;
                theme.updateUniforms(delta);
                theme.animateEffects(delta);
            }
            return theme;
        };
        const at60 = run(1 / 60, 60);
        const at144 = run(1 / 144, 144);
        expect(at144.targetGlowIntensity).toBeCloseTo(at60.targetGlowIntensity, 6);
        expect(at144.bloomBoost).toBeCloseTo(at60.bloomBoost, 6);
        expect(at144.glowIntensity).toBeCloseTo(at60.glowIntensity, 2);
        expect(at60.birdData[0].x).toBeCloseTo(1.2, 9); // 0.02 a frame at 60 fps
        expect(at144.birdData[0].x).toBeCloseTo(1.2, 9);
    });

    it('rainy-window: about 66 frames a second at a 60 fps target, and its storm clock keeps real time', () => {
        stubWindow(60);
        const theme = rainyWindow();
        theme.animate();
        runVsyncs(4);
        const perSecond = theme.renderer.render.mock.calls.length / 4;
        expect(perSecond).toBeGreaterThan(60);
        expect(perSecond).toBeLessThan(70);
        expect(theme.time).toBeCloseTo(4, 1); // it ran 2.2 times too fast: 1/60 s a frame
        expect(theme.cameraAnimTime).toBeCloseTo(4, 1);
    });

    it('rainy-window: a second start while running adds no second loop', () => {
        stubWindow(60);
        const theme = rainyWindow();
        theme.animate();
        theme.animate(); // restartRenderLoop() or a hidden-tab resume while the loop runs
        expect(frames).toHaveLength(1);
        runVsyncs(1);
        theme.animate();
        expect(frames).toHaveLength(1);
    });

    it('rainy-window: a loop that wakes up paused ends without drawing, and a restart draws again', () => {
        stubWindow(60);
        const theme = rainyWindow();
        theme.animate();
        theme.isPaused = true;
        runVsyncs(1);
        expect(frames).toHaveLength(0);
        const drawn = theme.renderer.render.mock.calls.length;
        theme.isPaused = false;
        theme.animate();
        runVsyncs(1);
        expect(theme.renderer.render.mock.calls.length).toBeGreaterThan(drawn + 60);
    });

    it('rainy-window: a strike decays at the same pace at any frame rate', () => {
        stubWindow(60);
        const run = (delta, steps) => {
            const theme = rainyWindow();
            Object.assign(theme, {
                lightningIntensity: 3,
                skyFlashIntensity: 2,
                targetStormIntensity: 1,
                stormIntensity: 0.5,
                windStrength: 1,
            });
            for (let i = 0; i < steps; i++) theme.advance(delta);
            return theme;
        };
        const at60 = run(1 / 60, 30);
        const at144 = run(1 / 144, 72);
        for (const key of ['lightningIntensity', 'skyFlashIntensity', 'targetStormIntensity', 'windStrength']) {
            expect(at144[key]).toBeCloseTo(at60[key], 6);
        }
        // It chases a target that falls while it moves, so the step size shows in the third decimal.
        expect(at144.stormIntensity).toBeCloseTo(at60.stormIntensity, 2);
        expect(at144.time).toBeCloseTo(at60.time, 9);
    });

    it('rainy-window: the rain never lurches when the storm swells late in a session', () => {
        stubWindow(60);
        const theme = rainyWindow();
        theme.rainSystem = {
            material: {
                uniforms: { time: { value: 0 }, windStrength: { value: 0 }, lightningFlash: { value: 0 } },
            },
        };
        theme.time = 1800; // half an hour in
        theme.targetStormIntensity = 1; // a strike swells the storm
        let previous = null;
        let largest = 0;
        for (let i = 0; i < 120; i++) {
            theme.advance(1 / 60);
            const { value } = theme.rainSystem.material.uniforms.time;
            if (previous !== null) largest = Math.max(largest, Math.abs(value - previous));
            previous = value;
        }
        // At most full storm speed (1.0) for one frame: it used to be the whole clock rescaled.
        expect(largest).toBeLessThanOrEqual(1 / 60 + 1e-9);
    });
});
