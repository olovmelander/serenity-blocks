import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

const guide = { canChoose: () => true };
const collection = { isWorldOpen: vi.fn((id) => id === 'coherence'), reconcile: vi.fn(() => ({ worlds: ['ocean-breath'], sessions: ['TIDE'] })) };
const tracker = { stop: vi.fn() };
const voice = { stop: vi.fn() };

vi.mock('../../src/ui/effects/breathing/breathing-guide.js', () => ({ initBreathingGuide: vi.fn(() => guide) }));
vi.mock('../../src/ui/effects/breathing/breath-collection-store.js', () => ({ getBreathCollection: () => collection }));
vi.mock('../../src/ui/effects/breathing/breath-openings.js', () => ({ announceBreathOpenings: vi.fn() }));
vi.mock('../../src/ui/effects/breathing/breath-practice.js', () => ({ trackStandalonePractice: vi.fn(() => tracker) }));
vi.mock('../../src/ui/effects/breathing/world-voice.js', () => ({ startWorldVoice: vi.fn(() => voice) }));

const { startStandaloneBreathing } = await import('../../src/ui/effects/breathing/standalone-breathing.js');
const { trackStandalonePractice } = await import('../../src/ui/effects/breathing/breath-practice.js');
const { startWorldVoice } = await import('../../src/ui/effects/breathing/world-voice.js');
const { announceBreathOpenings } = await import('../../src/ui/effects/breathing/breath-openings.js');

afterEach(() => vi.clearAllMocks());

describe('Breathing on your own, wired into the game', () => {
    it('lets you choose found worlds, counts practice that can open more, speaks with the Voice switch, and cleans up', () => {
        const settings = { breathingVoice: true };
        const app = { settingsManager: { get: () => settings }, cleanupHandlers: [] };
        expect(startStandaloneBreathing(app)).toBe(guide);
        expect(guide.canChoose('coherence')).toBe(true);
        expect(guide.canChoose('wim-hof')).toBe(false);

        const { onRecorded } = trackStandalonePractice.mock.calls[0][0];
        onRecorded();
        expect(collection.reconcile).toHaveBeenCalledWith({ source: 'practice' });
        expect(announceBreathOpenings).toHaveBeenCalledWith({ worlds: ['ocean-breath'], sessions: ['TIDE'] });

        const { isOn } = startWorldVoice.mock.calls[0][0];
        expect(isOn()).toBe(true);
        settings.breathingVoice = false;
        expect(isOn()).toBe(false);
        delete settings.breathingVoice;
        expect(isOn()).toBe(true);

        expect(app.cleanupHandlers).toHaveLength(1);
        app.cleanupHandlers[0]();
        expect(tracker.stop).toHaveBeenCalledOnce();
        expect(voice.stop).toHaveBeenCalledOnce();
    });
});
