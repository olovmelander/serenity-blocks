import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComboTracker, noteLockForCombo, announceCombo } from '../../src/core/combo-tracker.js';

describe('ComboTracker', () => {
    /** @type {ComboTracker} */
    let t;
    beforeEach(() => { t = new ComboTracker(); });

    /** Resolve one lock: lock, then clear `waves` cascade waves. */
    const lock = (waves = 0) => {
        t.notePieceLocked();
        const seen = [];
        for (let w = 0; w < waves; w++) seen.push(t.noteLineClear());
        return seen;
    };

    it('starts at zero', () => {
        expect(t.combo).toBe(0);
    });

    it('counts consecutive clearing locks', () => {
        expect(lock(1)).toEqual([1]);
        expect(lock(1)).toEqual([2]);
        expect(lock(1)).toEqual([3]);
    });

    it('resets after a lock that clears nothing', () => {
        lock(1);
        lock(1);
        expect(t.combo).toBe(2);

        lock(0); // chain broken; the reset lands on the next lock
        expect(lock(1)).toEqual([1]);
    });

    it('does not advance on later cascade waves of the same lock', () => {
        // One lock chaining 4 waves is a 4-deep cascade, not a 4x combo.
        expect(lock(4)).toEqual([1, 1, 1, 1]);
        expect(t.combo).toBe(1);
    });

    it('separates cascade depth from combo across locks', () => {
        lock(3); // deep cascade, first clear of the chain
        expect(t.combo).toBe(1);
        lock(1); // plain single, but consecutive
        expect(t.combo).toBe(2);
    });

    it('announces only from the second consecutive clear, once per lock', () => {
        t.notePieceLocked();
        t.noteLineClear();
        expect(t.shouldAnnounce()).toBe(false); // a lone clear is not a combo

        t.notePieceLocked();
        t.noteLineClear();
        expect(t.shouldAnnounce()).toBe(true);

        t.noteLineClear(); // later wave of the SAME lock must not re-announce
        expect(t.shouldAnnounce()).toBe(false);
    });

    it('is correct before the flash reads it (onLineClear precedes triggerFlash)', () => {
        lock(1);
        t.notePieceLocked();
        // The value the tint/multiplier sees already includes the current clear.
        expect(t.noteLineClear()).toBe(2);
    });

    it('a long chain then a miss then a clear restarts at 1', () => {
        lock(1); lock(1); lock(1); lock(1);
        expect(t.combo).toBe(4);
        lock(0);
        expect(lock(1)).toEqual([1]);
    });

    it('reset() clears the counter and the pending-lock flags', () => {
        lock(1);
        lock(1);
        t.reset();
        expect(t.combo).toBe(0);
        expect(t.shouldAnnounce()).toBe(false);
        expect(lock(1)).toEqual([1]);
    });

    it('back-to-back non-clearing locks keep the combo at zero', () => {
        lock(1);
        lock(0);
        lock(0);
        expect(t.notePieceLocked()).toBe(0);
    });
});

describe('combo effect wiring', () => {
    const makeScene = () => ({
        sharedEffects: { setComboCount: vi.fn() },
        showComboPopup: vi.fn(),
    });

    it('pushes the combo to the effect layer on every lock and clear', () => {
        const t = new ComboTracker();
        const scene = makeScene();

        noteLockForCombo(t, scene);
        announceCombo(t, scene);
        expect(scene.sharedEffects.setComboCount).toHaveBeenLastCalledWith(1);

        noteLockForCombo(t, scene);
        announceCombo(t, scene);
        expect(scene.sharedEffects.setComboCount).toHaveBeenLastCalledWith(2);
    });

    it('resets the effect layer to 0 when a chain breaks', () => {
        const t = new ComboTracker();
        const scene = makeScene();

        noteLockForCombo(t, scene); announceCombo(t, scene);
        noteLockForCombo(t, scene); announceCombo(t, scene);
        noteLockForCombo(t, scene); // this lock clears nothing
        noteLockForCombo(t, scene); // next lock: chain is broken

        expect(scene.sharedEffects.setComboCount).toHaveBeenLastCalledWith(0);
    });

    it('shows the popup from 2x, once per lock', () => {
        const t = new ComboTracker();
        const scene = makeScene();

        noteLockForCombo(t, scene); announceCombo(t, scene);
        expect(scene.showComboPopup).not.toHaveBeenCalled();

        noteLockForCombo(t, scene); announceCombo(t, scene);
        expect(scene.showComboPopup).toHaveBeenCalledTimes(1);
        expect(scene.showComboPopup).toHaveBeenCalledWith(2);

        announceCombo(t, scene); // cascade wave 2 of the same lock
        expect(scene.showComboPopup).toHaveBeenCalledTimes(1);
    });

    it('still tracks state when the popup setting is off', () => {
        const t = new ComboTracker();
        const scene = makeScene();
        const opts = { popupEnabled: false };

        noteLockForCombo(t, scene); announceCombo(t, scene, opts);
        noteLockForCombo(t, scene); announceCombo(t, scene, opts);

        expect(scene.showComboPopup).not.toHaveBeenCalled();
        // The tint/intensity state must still be correct — this is the coupling
        // bug that pinned currentComboCount for the rest of a run.
        expect(scene.sharedEffects.setComboCount).toHaveBeenLastCalledWith(2);
    });

    it('tolerates a missing board scene', () => {
        const t = new ComboTracker();
        expect(() => noteLockForCombo(t, null)).not.toThrow();
        expect(() => announceCombo(t, undefined)).not.toThrow();
        expect(t.combo).toBe(1);
    });
});
