import { describe, expect, it } from 'vitest';
import { BREATH_MOODS_KEY, pickBreathMood, resolveBreathMood } from '../../src/ui/effects/breathing/stage/breath-moods.js';

function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => { data.set(key, String(value)); },
        data,
    };
}

describe('breathing world moods', () => {
    it('never shows the mood the last visit to a world showed', () => {
        const storage = memoryStorage();
        let previous = null;
        for (let i = 0; i < 40; i++) {
            const index = pickBreathMood('zen-garden', 3, { storage, random: () => (i * 0.37) % 1 });
            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThan(3);
            if (previous !== null) expect(index).not.toBe(previous);
            previous = index;
        }
        expect(JSON.parse(storage.data.get(BREATH_MOODS_KEY))['zen-garden']).toBe(previous);
    });

    it('reaches every other mood, and keeps worlds apart', () => {
        const seen = new Set();
        [0, 0.5, 0.99].forEach((roll) => {
            const storage = memoryStorage({ [BREATH_MOODS_KEY]: JSON.stringify({ 'calm-sleep': 1, coherence: 0 }) });
            seen.add(pickBreathMood('calm-sleep', 4, { storage, random: () => roll }));
            expect(JSON.parse(storage.data.get(BREATH_MOODS_KEY)).coherence).toBe(0);
        });
        expect([...seen].sort()).toEqual([0, 2, 3]);
    });

    it('works without storage, with a broken record, and with one mood', () => {
        expect(pickBreathMood('triangle', 1)).toBe(0);
        expect(pickBreathMood('triangle', 3, { storage: null, random: () => 0.7 })).toBe(2);
        const broken = memoryStorage({ [BREATH_MOODS_KEY]: '{not json' });
        expect(pickBreathMood('triangle', 3, { storage: broken, random: () => 0 })).toBe(0);
        const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
        expect(pickBreathMood('triangle', 2, { storage: full, random: () => 0.9 })).toBe(1);
    });

    it('resolves a request by index or id, and nothing for anything else', () => {
        const moods = [{ id: 'dusk' }, { id: 'snow' }];
        expect(resolveBreathMood(moods, 1)).toBe(1);
        expect(resolveBreathMood(moods, '1')).toBe(1);
        expect(resolveBreathMood(moods, 'snow')).toBe(1);
        expect(resolveBreathMood(moods, 'rain')).toBeNull();
        expect(resolveBreathMood(moods, 5)).toBeNull();
        expect(resolveBreathMood(moods, undefined)).toBeNull();
        expect(resolveBreathMood(moods, '')).toBeNull();
    });
});
