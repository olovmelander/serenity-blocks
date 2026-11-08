import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BREATH_WORLDS } from '../../src/ui/effects/breathing/breath-catalogue.js';
import {
    BREATH_CAUTION_TEXT, BREATH_SAFETY_VERSION, isBreathSafetyRead, isStrongPattern, isStrongSession, setBreathSafetyRead,
} from '../../src/ui/effects/breathing/breath-safety.js';
import { BreathworkSessionManager } from '../../src/ui/effects/breathwork-session-manager.js';

function memoryStorage() {
    const map = new Map();
    return {
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: (key) => map.delete(key),
    };
}

describe('breathing safety note (breath-safety.js)', () => {
    beforeEach(() => {
        vi.stubGlobal('Audio', class {
            constructor() {
                this.pause = vi.fn();
                this.play = vi.fn().mockResolvedValue();
                this.load = vi.fn();
            }
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('treats only Volcanic Fire among the twelve worlds as fast breathing', () => {
        expect(BREATH_WORLDS.filter((world) => isStrongPattern(world.pattern)).map((world) => world.id))
            .toEqual(['volcanic-fire']);
        expect(isStrongPattern([3, 0, 2, 0])).toBe(true);
        expect(isStrongPattern([3, 1, 3, 1])).toBe(false);
        expect(isStrongPattern(null)).toBe(false);
    });

    it('asks before the sessions with fast breathing or holds you end yourself, and no others', () => {
        const manager = new BreathworkSessionManager({});
        const strong = Object.entries(manager.SESSIONS)
            .filter(([, session]) => isStrongSession(session.phases)).map(([id]) => id).sort();
        expect(strong).toEqual(['BASE', 'ELIXIR', 'SUNRISE']);
        manager.destroy();
    });

    it('names the people who should not practise it, and never asks for a squeeze', () => {
        for (const words of [
            'pregnant', 'epilepsy', 'blood-pressure', 'fainting', 'water', 'driving', 'standing',
            'Not for children', 'asthma or COPD', 'a past stroke', 'Never force a hold', 'chest pain',
        ]) {
            expect(BREATH_CAUTION_TEXT).toContain(words);
        }
        const manager = new BreathworkSessionManager({});
        const prompts = Object.values(manager.SESSIONS).flatMap((session) => session.phases)
            .map((phase) => `${phase.prompt || ''} ${phase.subPrompt || ''}`);
        expect(prompts.filter((text) => /squeeze/i.test(text))).toEqual([]);
        manager.destroy();
    });

    it('remembers the current note only', () => {
        const storage = memoryStorage();
        expect(isBreathSafetyRead(storage)).toBe(false);
        storage.setItem('serenity.breathSafetyRead', 'an older note');
        expect(isBreathSafetyRead(storage)).toBe(false);
        setBreathSafetyRead(true, storage);
        expect(storage.getItem('serenity.breathSafetyRead')).toBe(BREATH_SAFETY_VERSION);
        expect(isBreathSafetyRead(storage)).toBe(true);
        setBreathSafetyRead(false, storage);
        expect(isBreathSafetyRead(storage)).toBe(false);
        expect(isBreathSafetyRead(null)).toBe(false);
    });
});
