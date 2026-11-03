import { describe, expect, it } from 'vitest';
import {
    LEGACY_PRACTICE_KEY, PRACTICE_KEY, MIN_PRACTICE_SECONDS, readPracticeLog, recordPractice,
} from '../../src/ui/effects/breathwork-practice-log.js';
import { sukhaSessionName } from '../../src/ui/effects/breathing/breath-openings.js';

function memoryStorage() {
    const map = new Map();
    return {
        map,
        getItem: (key) => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: (key) => map.delete(key),
    };
}

describe('the guided sessions took the name Sukha: saved practice carries over', () => {
    it('reads the practice log saved under its old key, and moves it on the next session', () => {
        const storage = memoryStorage();
        const saved = {
            v: 2, count: 3, seconds: 900, last: { id: 'ELIXIR', at: 1 }, entries: [],
        };
        storage.setItem(LEGACY_PRACTICE_KEY, JSON.stringify(saved));
        expect(readPracticeLog(storage)).toMatchObject({ count: 3, seconds: 900, last: { id: 'ELIXIR' } });

        recordPractice({
            id: 'TIDE', seconds: MIN_PRACTICE_SECONDS + 240, completed: true, rounds: 1, breaths: 40, holds: [],
        }, storage, 5_000);
        expect(storage.map.has(LEGACY_PRACTICE_KEY)).toBe(false);
        expect(JSON.parse(storage.getItem(PRACTICE_KEY))).toMatchObject({ count: 4, last: { id: 'TIDE' } });
    });

    it('prefers the log under the new key when both exist', () => {
        const storage = memoryStorage();
        storage.setItem(LEGACY_PRACTICE_KEY, JSON.stringify({ v: 2, count: 1, seconds: 60, entries: [] }));
        storage.setItem(PRACTICE_KEY, JSON.stringify({ v: 2, count: 7, seconds: 600, entries: [] }));
        expect(readPracticeLog(storage).count).toBe(7);
    });

    it('names each session by its title, not its saved key', () => {
        expect(sukhaSessionName('FIRST')).toBe('Sukha First Breath');
        expect(sukhaSessionName('TIDE')).toBe('Sukha Tide');
        expect(sukhaSessionName('REST')).toBe('Sukha Nightfall');
        expect(sukhaSessionName('FLOW')).toBe('Sukha Mandala');
        expect(sukhaSessionName('BASE')).toBe('Sukha Homecoming');
        expect(sukhaSessionName('ELIXIR')).toBe('Sukha Phoenix');
    });
});
