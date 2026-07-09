/**
 * @fileoverview Regression tests for MechanicsMixer per-level configuration isolation.
 *
 * The hybrid engine (and this mixer) is a SINGLETON reused across every Odyssey level via
 * configure(). These tests lock in the invariant that per-level config is ISOLATED — a level's
 * `previewCount` / `levelProgression: false` override must NOT leak into the next level that omits
 * it. That isolation is currently provided by setBaseMode() clearing overrides (configureFromLevel
 * always calls it first); the tests assert A-then-B === B-alone so a future change that removes
 * that clear would be caught. (Investigating the E5 "hybridEngine.reset never called" note: the
 * mixer does NOT actually leak — setBaseMode already resets it — so no fix was needed.)
 */

import { describe, it, expect } from 'vitest';
import { MechanicsMixer } from '../../src/core/odyssey/MechanicsMixer.js';

/** Minimal Odyssey level config shape consumed by configureFromLevel. */
const level = ({ baseMode = 'standard', levelProgression = true, previewCount } = {}) => ({
    mechanics: {
        baseMode,
        speed: { levelProgression },
        pieces: previewCount !== undefined ? { previewCount } : undefined,
    },
});

/** What a mixer resolves for `mechanic` when configured with ONLY this level (no history). */
function freshValue(cfg, mechanic) {
    const m = new MechanicsMixer();
    m.configureFromLevel(cfg);
    return m.get(mechanic);
}

describe('MechanicsMixer — per-level override isolation (no cross-level leak)', () => {
    it('does NOT leak a previewCount override into the next level that omits it', () => {
        const mixer = new MechanicsMixer();
        mixer.configureFromLevel(level({ previewCount: 1 })); // level A: reduced preview
        expect(mixer.get('previewCount')).toBe(1);

        const levelB = level({}); // level B: no previewCount override
        mixer.configureFromLevel(levelB);
        // A-then-B must resolve identically to B configured on a fresh mixer.
        expect(mixer.get('previewCount')).toBe(freshValue(levelB, 'previewCount'));
        expect(mixer.get('previewCount')).not.toBe(1);
    });

    it('does NOT leak a levelProgression:false override into a normal-progression level', () => {
        const mixer = new MechanicsMixer();
        mixer.configureFromLevel(level({ levelProgression: false })); // level A: fixed speed
        expect(mixer.get('levelProgression')).toBe(false);

        const levelB = level({ levelProgression: true }); // level B: normal progression
        mixer.configureFromLevel(levelB);
        expect(mixer.get('levelProgression')).toBe(freshValue(levelB, 'levelProgression'));
        expect(mixer.get('levelProgression')).not.toBe(false);
    });

    it('still applies the CURRENT level own overrides after clearing prior ones', () => {
        const mixer = new MechanicsMixer();
        mixer.configureFromLevel(level({ previewCount: 5 }));
        mixer.configureFromLevel(level({ previewCount: 2, levelProgression: false }));
        expect(mixer.get('previewCount')).toBe(2);
        expect(mixer.get('levelProgression')).toBe(false);
    });

    it('reconfiguring the same level twice is idempotent (no accumulation)', () => {
        const a = new MechanicsMixer();
        const cfg = level({ previewCount: 3, levelProgression: false });
        a.configureFromLevel(cfg);
        const once = a.getAll();
        a.configureFromLevel(cfg);
        expect(a.getAll()).toEqual(once);
    });
});
