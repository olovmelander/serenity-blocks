import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

const guide = { canChoose: () => true };
const found = new Set(['coherence', 'volcanic-fire']);
const collection = {
    isWorldOpen: vi.fn((id) => found.has(id)),
    reconcile: vi.fn(() => ({ worlds: ['ocean-breath'], sessions: ['TIDE'] })),
};
const tracker = { stop: vi.fn() };
const voice = { stop: vi.fn() };
const stored = new Map();

vi.mock('../../src/ui/effects/breathing/breathing-guide.js', () => ({ initBreathingGuide: vi.fn(() => guide) }));
vi.mock('../../src/ui/effects/breathing/breath-collection-store.js', () => ({ getBreathCollection: () => collection }));
vi.mock('../../src/ui/effects/breathing/breath-openings.js', () => ({ announceBreathOpenings: vi.fn() }));
vi.mock('../../src/ui/effects/breathing/breath-practice.js', () => ({ trackStandalonePractice: vi.fn(() => tracker) }));
vi.mock('../../src/ui/effects/breathing/world-voice.js', () => ({ startWorldVoice: vi.fn(() => voice) }));

const { startStandaloneBreathing } = await import('../../src/ui/effects/breathing/standalone-breathing.js');
const { trackStandalonePractice } = await import('../../src/ui/effects/breathing/breath-practice.js');
const { startWorldVoice } = await import('../../src/ui/effects/breathing/world-voice.js');
const { announceBreathOpenings } = await import('../../src/ui/effects/breathing/breath-openings.js');
const { BREATH_SAFETY_VERSION } = await import('../../src/ui/effects/breathing/breath-safety.js');

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    stored.clear();
});

describe('Breathing on your own, wired into the game', () => {
    it('lets you choose found worlds, counts practice that can open more, sounds with its switches, and cleans up', () => {
        const settings = { breathingVoice: true };
        const app = { settingsManager: { get: () => settings }, cleanupHandlers: [] };
        expect(startStandaloneBreathing(app)).toBe(guide);
        expect(guide.canChoose('coherence')).toBe(true);
        expect(guide.canChoose('ocean-breath')).toBe(false);

        const { onRecorded } = trackStandalonePractice.mock.calls[0][0];
        onRecorded();
        expect(collection.reconcile).toHaveBeenCalledWith({ source: 'practice' });
        expect(announceBreathOpenings).toHaveBeenCalledWith({ worlds: ['ocean-breath'], sessions: ['TIDE'] });

        const options = startWorldVoice.mock.calls[0][0];
        const { isOn } = options;
        expect(isOn()).toBe(true);
        settings.breathingVoice = false;
        expect(isOn()).toBe(false);
        delete settings.breathingVoice;
        expect(isOn()).toBe(true);
        // The breath tone is on all the time: no switch is passed for it.
        expect(options).not.toHaveProperty('tonesOn');

        expect(app.cleanupHandlers).toHaveLength(1);
        app.cleanupHandlers[0]();
        expect(tracker.stop).toHaveBeenCalledOnce();
        expect(voice.stop).toHaveBeenCalledOnce();
    });

    it('lets you choose a fast world you have found only once its safety note is read on this device', () => {
        vi.stubGlobal('window', {
            localStorage: {
                getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value),
            },
        });
        startStandaloneBreathing({ cleanupHandlers: [] });
        expect(guide.canChoose('volcanic-fire')).toBe(false);
        expect(guide.canChoose('coherence')).toBe(true);
        // A tick on the note as it was worded before does not count.
        stored.set('serenity.breathSafetyRead', '2026-11-08');
        expect(guide.canChoose('volcanic-fire')).toBe(false);
        stored.set('serenity.breathSafetyRead', BREATH_SAFETY_VERSION);
        expect(guide.canChoose('volcanic-fire')).toBe(true);
        // Read or not, a world not found yet is not yours to choose.
        found.delete('volcanic-fire');
        expect(guide.canChoose('volcanic-fire')).toBe(false);
        found.add('volcanic-fire');
    });
});
