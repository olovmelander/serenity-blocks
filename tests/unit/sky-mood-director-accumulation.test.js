import { describe, expect, it } from 'vitest';

import { MoodDirector } from '../../src/themes/sky-children-v2/composition/mood-director.js';

// The Sky Children V2 MoodDirector is a pure, dependency-free scalar director, so its combo
// accumulation discipline is exercised directly (no renderer). The fix under test: the big
// one-shot "startle" flashes (sunset ignite / bird-flock scatter / camera kick) must fire ONCE
// per newly-crossed combo tier (4 / 7 / 10), not on every combo event — so a long combo streak
// startles the flock at milestones and lets it re-form between, instead of re-agitating it every
// clear. The smooth glows (radiance / flare / bloom) keep scaling every link.

describe('Sky Children MoodDirector — combo milestone accumulation', () => {
    it('startles the flock only on the milestone crossings of a long streak, not every clear', () => {
        const d = new MoodDirector();
        const startledAt = [];
        for (let combo = 2; combo <= 12; combo += 1) {
            const before = d.scatter;
            d.onCombo(combo);
            if (d.scatter > before + 1e-6) startledAt.push(combo);
            // ~0.7s of decay between clears (a realistic combo cadence)
            for (let i = 0; i < 42; i += 1) d.update(1 / 60);
        }
        // Exactly 3 startles across an 11-clear streak — the tiers at combo 4, 7, 10.
        expect(startledAt).toEqual([4, 7, 10]);
    });

    it('does not re-fire startles on a repeated combo count (dedup)', () => {
        const d = new MoodDirector();
        d.onCombo(4); // tier 1 crossed → startle
        const { scatter, cameraPunch } = d;
        d.onCombo(4); // same count again → no-op
        expect(d.scatter).toBe(scatter);
        expect(d.cameraPunch).toBe(cameraPunch);
    });

    it('does not re-startle within a tier (combo climbs 4→5→6 with one startle)', () => {
        const d = new MoodDirector();
        d.onCombo(4); // tier 1 crossed
        const { scatter } = d;
        d.onCombo(5); // still tier 1
        d.onCombo(6); // still tier 1
        expect(d.scatter).toBe(scatter); // no additional scatter energy added
        expect(d._comboTier).toBe(1);
    });

    it('re-arms the milestone gate when a fresh chain starts (count drops)', () => {
        const d = new MoodDirector();
        d.onCombo(4);
        d.onCombo(7);
        expect(d._comboTier).toBe(2);
        d.onCombo(2); // combo dropped → new chain → gate re-arms
        expect(d._comboTier).toBe(0);
        d.onCombo(4); // crosses tier 1 again on the new chain
        expect(d._comboTier).toBe(1);
    });

    it('fires the sunset ignition once, only at the surge tier (7+)', () => {
        const d = new MoodDirector();
        d.onCombo(4); // tier 1 → no ignite
        expect(d.ignite).toBe(0);
        d.onCombo(7); // tier 2 crossed → ignite
        expect(d.ignite).toBeGreaterThan(0);
        const ig = d.ignite;
        d.onCombo(8); // no new tier → no re-ignite
        expect(d.ignite).toBe(ig);
    });

    it('keeps warming the light (radiance target) on every combo link', () => {
        const d = new MoodDirector();
        const t0 = d.target;
        d.onCombo(2);
        const t1 = d.target;
        d.onCombo(3); // no startle, but the smooth radiance bump still climbs
        expect(t1).toBeGreaterThan(t0);
        expect(d.target).toBeGreaterThan(t1);
    });

    it('ignores non-positive combos', () => {
        const d = new MoodDirector();
        d.onCombo(0);
        d.onCombo(-3);
        expect(d.scatter).toBe(0);
        expect(d._lastCombo).toBe(0);
    });

    it('re-arms the gate on reset() and onGameOver()', () => {
        const d = new MoodDirector();
        d.onCombo(7);
        d.reset();
        expect(d._comboTier).toBe(0);
        expect(d._lastCombo).toBe(0);

        d.onCombo(7);
        d.onGameOver();
        expect(d._comboTier).toBe(0);
        expect(d._lastCombo).toBe(0);
    });
});
