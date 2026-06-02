import { describe, expect, it } from 'vitest';
import { OdysseyDirector } from './OdysseyDirector.js';
import { OdysseyAudioReactor } from './OdysseyAudioReactor.js';
import {
    getChapterProfile,
    getActForChapter,
    getCameraProfileForChapter,
    ODYSSEY_CHAPTER_PROFILES,
    ODYSSEY_ACTS,
} from '../chapter-environments/shared/chapter-profile.js';

describe('chapter profiles', () => {
    it('declares exactly eight chapters with monotonic ids', () => {
        expect(ODYSSEY_CHAPTER_PROFILES).toHaveLength(8);
        ODYSSEY_CHAPTER_PROFILES.forEach((profile, index) => {
            expect(profile.id).toBe(index + 1);
            expect(typeof profile.name).toBe('string');
            expect(profile.atmosphere).toBeTruthy();
            expect(profile.path?.style).toBeTruthy();
            expect(profile.node?.style).toBeTruthy();
        });
    });

    it('maps chapters to the four narrative acts', () => {
        expect(getActForChapter(1)).toBe(ODYSSEY_ACTS.ORIGIN);
        expect(getActForChapter(2)).toBe(ODYSSEY_ACTS.ORIGIN);
        expect(getActForChapter(3)).toBe(ODYSSEY_ACTS.LIVING);
        expect(getActForChapter(4)).toBe(ODYSSEY_ACTS.LIVING);
        expect(getActForChapter(5)).toBe(ODYSSEY_ACTS.BEYOND);
        expect(getActForChapter(6)).toBe(ODYSSEY_ACTS.BEYOND);
        expect(getActForChapter(7)).toBe(ODYSSEY_ACTS.TRANSCENDENCE);
        expect(getActForChapter(8)).toBe(ODYSSEY_ACTS.TRANSCENDENCE);
    });

    it('falls back to chapter 1 for out-of-range ids', () => {
        expect(getChapterProfile(0).id).toBe(1);
        expect(getChapterProfile(99).id).toBe(1);
    });

    it('exposes a camera profile per chapter', () => {
        const cam = getCameraProfileForChapter(6);
        expect(cam.followDistance).toBeGreaterThan(0);
        expect(cam.fovBase).toBeGreaterThan(0);
    });
});

describe('OdysseyAudioReactor', () => {
    it('reports zeros and degrades gracefully without a sound manager', () => {
        const reactor = new OdysseyAudioReactor(null);
        const state = reactor.update(1 / 60);
        expect(state.energy).toBe(0);
        expect(state.beat).toBe(false);
        expect(state.available).toBe(false);
    });

    it('passes through and clamps a sound-manager snapshot, tracking beats', () => {
        let beat = false;
        const fakeSoundManager = {
            getAudioAnalysis: () => ({
                bassEnergy: 1.4, // intentionally out of range → should clamp
                midEnergy: 0.5,
                trebleEnergy: 0.2,
                overallEnergy: 0.6,
                beatDetected: beat,
            }),
        };
        const reactor = new OdysseyAudioReactor(fakeSoundManager);

        beat = true;
        let state = reactor.update(1 / 60);
        expect(state.bass).toBe(1); // clamped
        expect(state.energy).toBeCloseTo(0.6, 5);
        expect(state.beat).toBe(true);
        expect(state.sinceBeatMs).toBe(0);
        expect(state.available).toBe(true);

        beat = false;
        state = reactor.update(0.1);
        expect(state.beat).toBe(false);
        expect(state.sinceBeatMs).toBeCloseTo(100, 5);
    });
});

describe('OdysseyDirector', () => {
    const chapterPositions = [0, 0.13, 0.21, 0.36, 0.5, 0.65, 0.81, 0.94, 1];

    it('reports the correct active chapter at the start of the journey', () => {
        const director = new OdysseyDirector({ chapterPositions });
        const state = director.update(1 / 60, { ascentProgress: 0, audio: null });
        expect(state.activeChapter).toBe(1);
        expect(state.act).toBe(ODYSSEY_ACTS.ORIGIN);
        expect(state.inSeam).toBe(false);
    });

    it('blends atmosphere between source and target chapters inside a seam', () => {
        const director = new OdysseyDirector({ chapterPositions });
        // Sit right on a chapter boundary so seamProgress is near the middle.
        const state = director.update(1 / 60, { ascentProgress: 0.13, audio: null });
        // sky should be a blend (not exactly chapter 1 nor chapter 2 sky)
        expect(state.atmosphere.skyColor.getHex()).toBeTypeOf('number');
        expect(state.atmosphere.exposure).toBeGreaterThan(0);
        // light direction stays normalized
        expect(state.atmosphere.lightDir.length()).toBeCloseTo(1, 3);
    });

    it('raises smoothed energy toward audio energy and decays a beat pulse', () => {
        const director = new OdysseyDirector({ chapterPositions });
        const loudAudio = {
            energy: 1, bass: 1, mid: 0.5, treble: 0.3, beat: true, available: true,
        };
        // Several frames of loud audio → energy climbs from 0.
        let state;
        for (let i = 0; i < 30; i += 1) {
            state = director.update(1 / 60, { ascentProgress: 0.3, audio: loudAudio });
        }
        expect(state.energy).toBeGreaterThan(0.5);
        expect(state.beatPulse).toBe(1); // beat held high while beats keep firing

        // Silence → pulse decays below 1.
        const quietAudio = {
            energy: 0, bass: 0, mid: 0, treble: 0, beat: false, available: true,
        };
        state = director.update(0.2, { ascentProgress: 0.3, audio: quietAudio });
        expect(state.beatPulse).toBeLessThan(1);
    });

    it('records discrete navigation events for later phases', () => {
        const director = new OdysseyDirector({ chapterPositions });
        director.update(1 / 60, { ascentProgress: 0.1, audio: null });
        director.onLevelSelect(12);
        director.onBoundaryCross('2-3', 1);
        expect(director.events.lastLevelSelect.levelId).toBe(12);
        expect(director.events.lastBoundaryCross.boundaryId).toBe('2-3');
    });
});
