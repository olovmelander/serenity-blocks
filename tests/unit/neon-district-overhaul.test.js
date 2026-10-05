import * as THREE from 'three/webgpu';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import NeonDistrictTheme from '../../src/themes/neon-district/neon-district-theme.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

const themes = [];

function createTheme(initialMotion = false) {
    const windowListeners = new Map();
    const mediaListeners = new Map();
    const container = {
        appendChild: vi.fn(),
        classList: { add: vi.fn(), remove: vi.fn() },
        style: { removeProperty: vi.fn() },
    };
    const media = {
        matches: initialMotion,
        addEventListener: vi.fn((event, callback) => mediaListeners.set(event, callback)),
        removeEventListener: vi.fn((event) => mediaListeners.delete(event)),
    };
    vi.stubGlobal('document', {
        getElementById: vi.fn(() => container), querySelectorAll: vi.fn(() => []),
    });
    vi.stubGlobal('window', {
        innerWidth: 1280,
        innerHeight: 720,
        location: { search: '' },
        settings: { effectQuality: 'High' },
        matchMedia: vi.fn(() => media),
        addEventListener: vi.fn((event, callback) => windowListeners.set(event, callback)),
        removeEventListener: vi.fn((event) => windowListeners.delete(event)),
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const theme = new NeonDistrictTheme();
    theme.isActive = true;
    theme.districtEvents = {
        triggerLock: vi.fn(),
        triggerClear: vi.fn(),
        triggerCombo: vi.fn(),
        update: vi.fn(),
        setReducedMotion: vi.fn(),
        dispose: vi.fn(),
    };
    themes.push(theme);
    return {
        theme, windowListeners, mediaListeners, media,
    };
}

afterEach(() => {
    for (const theme of themes.splice(0)) {
        theme.clearEventUnsubscribers();
        theme.assets?.dispose();
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Neon District production event integration', () => {
    it('subscribes once to the canonical gameplay events and recognizes four-line clears', () => {
        const { theme } = createTheme();
        theme.setupEventListeners();
        theme.setupEventListeners();
        eventBus.emit(EVENTS.PIECE_LOCK, { type: 'T' });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4 });
        eventBus.emit(EVENTS.COMBO, { comboCount: 7 });
        expect(theme.districtEvents.triggerLock).toHaveBeenCalledTimes(1);
        expect(theme.districtEvents.triggerClear).toHaveBeenCalledExactlyOnceWith(4);
        expect(theme.districtEvents.triggerCombo).toHaveBeenCalledExactlyOnceWith(7);
        expect(theme.bloomBoost).toBeGreaterThan(0);
    });

    it('keeps malformed payloads finite and clamps line-clear intensity', () => {
        const { theme } = createTheme();
        theme.setupEventListeners();
        eventBus.emit(EVENTS.LINE_CLEAR, { lines: [17, 18, 19] });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: Infinity });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 500 });
        eventBus.emit(EVENTS.COMBO, { comboCount: NaN });
        expect(theme.districtEvents.triggerClear).toHaveBeenLastCalledWith(4);
        expect(theme.districtEvents.triggerCombo).toHaveBeenLastCalledWith(1);
        expect([theme.lightPulseIntensity, theme.bloomBoost, theme.rainIntensity,
            theme.cameraDollyZ, theme.cameraFovPulse].every(Number.isFinite)).toBe(true);
    });

    it('detaches gameplay and viewport reactions when stopped', () => {
        const { theme, windowListeners, mediaListeners } = createTheme();
        theme.setupEventListeners();
        const effects = theme.districtEvents;
        theme.stop();
        eventBus.emit(EVENTS.PIECE_LOCK, {});
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4 });
        eventBus.emit(EVENTS.COMBO, { comboCount: 7 });
        expect(effects.triggerLock).not.toHaveBeenCalled();
        expect(effects.triggerClear).not.toHaveBeenCalled();
        expect(effects.triggerCombo).not.toHaveBeenCalled();
        expect(windowListeners.size).toBe(0);
        expect(mediaListeners.size).toBe(0);
    });

    it('restores reactions when a retained scene starts again', async () => {
        const { theme } = createTheme();
        theme.scene = new THREE.Scene();
        theme.renderer = {};
        theme.sceneInitialized = true;
        theme.startAnimation = vi.fn();
        theme.setupEventListeners();
        theme.stop();
        theme.isActive = true;
        await theme.createScene();
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4 });
        expect(theme.districtEvents.triggerClear).toHaveBeenCalledExactlyOnceWith(4);
        expect(theme.startAnimation).toHaveBeenCalledTimes(1);
    });

    it('decays visual responses by elapsed time equally at 30 and 60 FPS', () => {
        const { theme: thirty } = createTheme();
        const { theme: sixty } = createTheme();
        for (const theme of [thirty, sixty]) {
            theme.bloomBoost = 0.5;
            theme.lightPulseIntensity = 1;
            theme.neonSignSurgeIntensity = 1;
            theme.rainIntensity = 2;
        }
        for (let frame = 0; frame < 30; frame += 1) thirty.updateGameplayEffects(1 / 30);
        for (let frame = 0; frame < 60; frame += 1) sixty.updateGameplayEffects(1 / 60);
        for (const property of ['bloomBoost', 'lightPulseIntensity', 'neonSignSurgeIntensity', 'rainIntensity']) {
            expect(thirty[property]).toBeCloseTo(sixty[property], 10);
        }
    });

    it('returns post-processing to its exact resting state after an event', () => {
        const { theme } = createTheme();
        theme.post = { updateParams: vi.fn(), setAberrationBoost: vi.fn() };
        theme.bloomPass = { strength: 100 };
        theme.bloomBoost = 0.5;
        for (let frame = 0; frame < 180; frame += 1) theme.updateGameplayEffects(1 / 60);
        expect(theme.bloomBoost).toBe(0);
        expect(theme.bloomPass.strength).toBe(theme.qualityPreset.bloomStrength);
        expect(theme.post.updateParams).toHaveBeenLastCalledWith({
            bloomStrength: theme.qualityPreset.bloomStrength,
            saturationAmount: theme.baseSaturationAmount,
        });
        expect(theme.post.setAberrationBoost).toHaveBeenLastCalledWith(0);
    });

    it('holds the camera still under reduced motion while preserving city event feedback', () => {
        const { theme } = createTheme(true);
        theme.camera = new THREE.PerspectiveCamera(77, 16 / 9, 1, 10000);
        theme.camera.position.set(10, 25, -100);
        theme.setupEventListeners();
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4 });
        eventBus.emit(EVENTS.COMBO, { comboCount: 7 });
        theme.updateCameraSway(1 / 60);
        expect(theme.camera.position.toArray()).toEqual(theme.cameraBasePosition.toArray());
        expect(theme.camera.fov).toBe(theme.cameraBaseFov);
        expect(theme.cameraDollyZ).toBe(0);
        expect(theme.cameraFovPulse).toBe(0);
        expect(theme.districtEvents.triggerClear).toHaveBeenCalledExactlyOnceWith(4);
        expect(theme.districtEvents.triggerCombo).toHaveBeenCalledExactlyOnceWith(7);
    });

    it('forwards changed motion preferences and blocks pointer parallax', () => {
        const { theme, windowListeners, mediaListeners } = createTheme();
        theme.cityAtmosphere = { reducedMotion: false };
        theme.setupEventListeners();
        mediaListeners.get('change')({ matches: true });
        windowListeners.get('pointermove')({ clientX: 1200, clientY: 100 });
        expect(theme.reducedMotion).toBe(true);
        expect(theme.cityAtmosphere.reducedMotion).toBe(true);
        expect(theme.districtEvents.setReducedMotion).toHaveBeenLastCalledWith(true);
        expect(theme.targetPointerX).toBe(0);
        expect(theme.targetPointerY).toBe(0);
    });

    it('resynchronizes motion preferences and post effects after an inactive change', async () => {
        const { theme, media } = createTheme();
        theme.post = { updateParams: vi.fn(), setAberrationBoost: vi.fn() };
        theme.scene = new THREE.Scene();
        theme.renderer = {};
        theme.sceneInitialized = true;
        theme.startAnimation = vi.fn();
        theme.setupEventListeners();
        theme.stop();
        media.matches = true;
        theme.isActive = true;
        await theme.createScene();
        expect(theme.reducedMotion).toBe(true);
        expect(theme.post.updateParams).toHaveBeenLastCalledWith({ aberration: 0 });
        theme.applyMotionPreference(false);
        expect(theme.post.updateParams).toHaveBeenLastCalledWith({ aberration: 0.00065 });
    });
});
