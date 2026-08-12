/**
 * Shared four-beat factory — the single wiring for lock / clear / combo /
 * cascade across every mode. Local MP's read is the canonical baseline.
 *
 * The factory is visual-only: no settings reads (SharedEffects gates
 * internally), no hit-stop writes, no emits, no SFX. Those contracts are what
 * keep Odyssey's fixed-tick determinism guard and the mode-owned policies safe,
 * so they are pinned here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBoardEffectHandlers } from '../../src/core/game-modes/board-effect-callbacks.js';
import { ComboTracker } from '../../src/core/combo-tracker.js';

function makeScene() {
    return {
        sharedEffects: {
            setComboCount: vi.fn(),
            showCascadeWave: vi.fn(),
        },
        createPieceLockRipple: vi.fn(),
        triggerLineClearFlash: vi.fn(),
        playLineClearImpact: vi.fn(),
        showComboPopup: vi.fn(),
    };
}

function makeJuice() {
    return { dip: vi.fn(), pulse: vi.fn(), nudge: vi.fn(), tilt: vi.fn() };
}

describe('createBoardEffectHandlers', () => {
    let scene;
    let juice;
    let fx;

    beforeEach(() => {
        scene = makeScene();
        juice = makeJuice();
        fx = createBoardEffectHandlers({ getScene: () => scene, getJuice: () => juice });
    });

    it('lockBeat: ripple + gentle juice + tracker bookkeeping on every lock', () => {
        const piece = { shape: [[1]], x: 3, y: 20 };
        fx.lockBeat(piece);
        expect(scene.createPieceLockRipple).toHaveBeenCalledWith(piece);
        expect(juice.dip).toHaveBeenCalledWith(1);
        expect(juice.pulse).toHaveBeenCalledWith(1.005);
        // bookkeeping reached the effect layer
        expect(scene.sharedEffects.setComboCount).toHaveBeenCalled();
    });

    it('clearFlashBeat: delegates the flash with the cleared rows', () => {
        fx.clearFlashBeat([20, 21]);
        expect(scene.triggerLineClearFlash).toHaveBeenCalledWith([20, 21]);
    });

    it('clearImpactBeat: impact + juice pulse scaled by line count', () => {
        fx.clearImpactBeat(4);
        expect(scene.playLineClearImpact).toHaveBeenCalledWith(4);
        expect(juice.pulse).toHaveBeenCalledWith(1 + 4 * 0.004);
    });

    it('comboBeat: popup carries the cascade depth (local-MP semantics)', () => {
        fx.comboBeat(3);
        expect(scene.showComboPopup).toHaveBeenCalledWith(3);
    });

    it('cascadeWaveBeat: routes through showCascadeWave (mega-only internally)', () => {
        fx.cascadeWaveBeat(12);
        expect(scene.sharedEffects.showCascadeWave).toHaveBeenCalledWith(12);
    });

    it('tint state escalates on consecutive clearing locks and resets on a break', () => {
        const clearLock = () => { fx.lockBeat({ shape: [[1]], x: 0, y: 20 }); fx.clearImpactBeat(1); };
        clearLock();
        clearLock();
        const calls = scene.sharedEffects.setComboCount.mock.calls.map((c) => c[0]);
        expect(calls[calls.length - 1]).toBe(2); // second consecutive clear

        fx.lockBeat({ shape: [[1]], x: 0, y: 20 }); // lock, no clear
        fx.lockBeat({ shape: [[1]], x: 0, y: 20 }); // chain broken
        const after = scene.sharedEffects.setComboCount.mock.calls.map((c) => c[0]);
        expect(after[after.length - 1]).toBe(0);
    });

    it('never opens the popup from the tracker — the popup is the cascade beat', () => {
        fx.lockBeat({ shape: [[1]], x: 0, y: 20 });
        fx.clearImpactBeat(1);
        fx.lockBeat({ shape: [[1]], x: 0, y: 20 });
        fx.clearImpactBeat(1); // a true 2x combo — but no popup from here
        expect(scene.showComboPopup).not.toHaveBeenCalled();
    });

    it('uses an injected tracker and exposes it for lifecycle resets', () => {
        const tracker = new ComboTracker();
        const owned = createBoardEffectHandlers({ getScene: () => scene, comboTracker: tracker });
        expect(owned.comboTracker).toBe(tracker);
        owned.lockBeat({ shape: [[1]], x: 0, y: 20 });
        owned.clearImpactBeat(1);
        expect(tracker.combo).toBe(1);
        tracker.reset();
        expect(tracker.combo).toBe(0);
    });

    it('reads no settings — gating belongs to SharedEffects', () => {
        // Tripwire: the factory must be safe inside Odyssey's fixed-tick lane,
        // whose determinism guard asserts the timing path consults no settings.
        const settingsSpy = vi.fn(() => ({}));
        globalThis.window = globalThis.window || {};
        const prev = globalThis.window.settingsManager;
        globalThis.window.settingsManager = { get: settingsSpy };
        try {
            fx.lockBeat({ shape: [[1]], x: 0, y: 20 });
            fx.clearFlashBeat([20]);
            fx.clearImpactBeat(2);
            fx.comboBeat(2);
            fx.cascadeWaveBeat(3);
            expect(settingsSpy).not.toHaveBeenCalled();
        } finally {
            globalThis.window.settingsManager = prev;
        }
    });

    it('tolerates missing scene and juice at every beat', () => {
        const bare = createBoardEffectHandlers({ getScene: () => null });
        expect(() => {
            bare.lockBeat({ shape: [[1]], x: 0, y: 20 });
            bare.clearFlashBeat([20]);
            bare.clearImpactBeat(1);
            bare.comboBeat(2);
            bare.cascadeWaveBeat(11);
        }).not.toThrow();
    });
});
