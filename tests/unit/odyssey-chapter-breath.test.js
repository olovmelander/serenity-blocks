import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    CHAPTER_BREATH, CHAPTER_BREATH_CYCLE_SECONDS, CHAPTER_BREATH_WORLDS, GUIDED_BREATHS, createChapterBreath,
    loadBreathPoster, resolveChapterBreath, resolveChapterBreathWorld,
} from '../../src/ui/odyssey/chapter-breath.js';
import { isBreathWorld } from '../../src/ui/effects/breathing/breath-catalogue.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { createOdysseyFlowDom } from '../helpers/odyssey-flow-dom.js';

const nodes = (root) => [root, ...root.children.flatMap(nodes)];
const byClass = (root, className) => nodes(root).find((node) => node.className === className);

describe('Odyssey chapter breath timing', () => {
    it('is an exhale-led cyclic sigh: in, a short top-up, then a long breath out', () => {
        expect(CHAPTER_BREATH.map((phase) => phase.id)).toEqual(['inhale', 'top-up', 'exhale', 'rest']);
        const [inhale, topUp, exhale] = CHAPTER_BREATH;
        expect(topUp.seconds).toBeLessThan(inhale.seconds);
        expect(exhale.seconds).toBeGreaterThan(inhale.seconds + topUp.seconds);
        expect(CHAPTER_BREATH_CYCLE_SECONDS).toBe(14);
    });

    it('fills the lungs smoothly, tops them up and empties them over each cycle', () => {
        expect(resolveChapterBreath(0)).toMatchObject({ breath: 1, phase: 'inhale', level: 0 });
        expect(resolveChapterBreath(2).level).toBeCloseTo(0.39, 2);
        expect(resolveChapterBreath(4)).toMatchObject({ phase: 'top-up' });
        expect(resolveChapterBreath(4).level).toBeCloseTo(0.78, 5);
        expect(resolveChapterBreath(5.5)).toMatchObject({ phase: 'exhale', level: 1 });
        expect(resolveChapterBreath(9).level).toBeCloseTo(0.5, 5);
        expect(resolveChapterBreath(13)).toMatchObject({ phase: 'rest', level: 0 });
        expect(resolveChapterBreath(14)).toMatchObject({ breath: 2, phase: 'inhale' });
        expect(resolveChapterBreath(-3)).toMatchObject({ breath: 1, phase: 'inhale' });
        expect(resolveChapterBreath(Number.NaN)).toMatchObject({ breath: 1, phase: 'inhale' });
    });

    it('marks the player rested after the guided breaths, and keeps breathing', () => {
        const end = CHAPTER_BREATH_CYCLE_SECONDS * GUIDED_BREATHS;
        expect(resolveChapterBreath(end - 0.01).rested).toBe(false);
        expect(resolveChapterBreath(end)).toMatchObject({ rested: true, breath: GUIDED_BREATHS + 1, phase: 'inhale' });
        expect(resolveChapterBreath(end * 4).rested).toBe(true);
    });
});

describe('Odyssey chapter breathing worlds', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('gives every chapter its own breathing world, by place', () => {
        const ids = CHAPTER_CONFIGS.map((chapter) => CHAPTER_BREATH_WORLDS[chapter.id]);
        expect(ids.every((id) => isBreathWorld(id))).toBe(true);
        expect(new Set(ids).size).toBe(CHAPTER_CONFIGS.length);
        expect(resolveChapterBreathWorld(2)).toEqual({
            id: 'ocean-breath',
            name: 'Ocean Tide',
            intent: 'Calm',
            accent: [120, 225, 225],
            poster: './assets/breathing/ocean-breath.webp',
        });
        expect(resolveChapterBreathWorld(99)).toBeNull();
        expect(resolveChapterBreathWorld(undefined)).toBeNull();
    });

    it('decodes a poster before reporting it can be shown', async () => {
        expect(await loadBreathPoster('./assets/breathing/ocean-breath.webp')).toBe(false);
        const created = [];
        function DecodingImage() {
            created.push(this);
            this.decode = () => (this.src.includes('missing') ? Promise.reject(new Error('404')) : Promise.resolve());
        }
        vi.stubGlobal('Image', DecodingImage);
        expect(await loadBreathPoster('./assets/breathing/ocean-breath.webp')).toBe(true);
        expect(created[0]).toMatchObject({ decoding: 'async', src: './assets/breathing/ocean-breath.webp' });
        expect(await loadBreathPoster('./assets/breathing/missing.webp')).toBe(false);
        expect(await loadBreathPoster('')).toBe(false);
        // Without decode(), load and error events decide.
        const images = [];
        function LoadingImage() { images.push(this); }
        vi.stubGlobal('Image', LoadingImage);
        const loaded = loadBreathPoster('./assets/breathing/calm-sleep.webp');
        images[0].onload();
        expect(await loaded).toBe(true);
        const failed = loadBreathPoster('./assets/breathing/missing.webp');
        images[1].onerror();
        expect(await failed).toBe(false);
    });
});

describe('Odyssey chapter breath view', () => {
    let clock = 0;
    let chimes;
    beforeEach(() => {
        vi.useFakeTimers();
        const dom = createOdysseyFlowDom();
        vi.stubGlobal('document', dom.document);
        vi.stubGlobal('window', dom.window);
        clock = 0;
        chimes = { bell: vi.fn(() => true), silence: vi.fn() };
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    const create = (options = {}) => createChapterBreath({
        chimes, now: () => clock, ...options,
    });
    const advance = (ms) => {
        // The driver measures its own frame deltas; move the clock with the timers.
        for (let elapsed = 0; elapsed < ms; elapsed += 50) {
            clock += 50;
            vi.advanceTimersByTime(50);
        }
    };

    it('guides each phase with a cue, counts breaths and rings once at the start and when rested', () => {
        const onRested = vi.fn();
        const guide = create({ onRested });
        expect(guide.role).toBe('group');
        expect(guide.ariaLabel).toBe('Breathing guide');
        expect(byClass(guide, 'ody-breath__cue').ariaLive).toBe('off');
        guide.start();
        expect(guide.dataset.running).toBe('true');
        expect(chimes.bell).toHaveBeenCalledWith('start');
        advance(4200);
        expect(guide.dataset.phase).toBe('top-up');
        expect(byClass(guide, 'ody-breath__cue').textContent).toBe('A little more');
        advance(2000);
        expect(byClass(guide, 'ody-breath__cue').textContent).toBe('Let it all go');
        advance(CHAPTER_BREATH_CYCLE_SECONDS * 1000 - 6200);
        expect(byClass(guide, 'ody-breath__count').textContent).toBe(`Breath 2 of ${GUIDED_BREATHS}`);
        advance(CHAPTER_BREATH_CYCLE_SECONDS * 1000 * (GUIDED_BREATHS - 1) + 100);
        expect(onRested).toHaveBeenCalledOnce();
        expect(guide.dataset.rested).toBe('true');
        expect(byClass(guide, 'ody-breath__count').textContent).toBe('Stay as long as you like');
        expect(chimes.bell.mock.calls).toEqual([['start'], ['round']]);
        advance(60000);
        expect(onRested).toHaveBeenCalledOnce();
        guide.dispose();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('freezes where it is while paused and resumes without skipping ahead', () => {
        const guide = create();
        guide.start();
        advance(2000);
        const held = guide.getElapsed();
        guide.pause();
        expect(guide.dataset.running).toBe('false');
        clock += 30000;
        vi.advanceTimersByTime(30000);
        expect(guide.getElapsed()).toBe(held);
        guide.resume();
        advance(500);
        expect(guide.getElapsed()).toBeGreaterThan(held);
        expect(guide.getElapsed()).toBeLessThan(held + 0.6);
        guide.dispose();
        guide.start();
        expect(guide.dataset.running).toBe('false');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('caps a long stall so a frozen tab never jumps several breaths', () => {
        const guide = create();
        guide.start();
        clock += 20000;
        vi.advanceTimersByTime(50);
        expect(guide.getElapsed()).toBeLessThanOrEqual(0.25);
        guide.dispose();
    });

    const flush = () => Array.from({ length: 6 }).reduce((chain) => chain.then(() => undefined), Promise.resolve());
    const trackStyles = () => {
        const original = document.createElement;
        document.createElement = (tagName) => {
            const node = original(tagName);
            node.style = { setProperty: vi.fn() };
            return node;
        };
    };

    it('shows the chapter\'s breathing world through the ring once its picture is decoded', async () => {
        trackStyles();
        let release;
        const loadPoster = vi.fn(() => new Promise((resolve) => { release = resolve; }));
        const guide = create({ world: resolveChapterBreathWorld(2), loadPoster });
        expect(guide.dataset.world).toBe('ocean-breath');
        expect(guide.dataset.worldReady).toBe('false');
        expect(guide.style.setProperty).toHaveBeenCalledWith('--ody-breath-accent', 'rgb(120 225 225)');
        const orb = byClass(guide, 'ody-breath__orb');
        expect(orb.children.map((node) => node.className)).toEqual([
            'ody-breath__track', 'ody-breath__glow', 'ody-breath__world', 'ody-breath__ring', 'ody-breath__core',
        ]);
        expect(byClass(guide, 'ody-breath__art').style.backgroundImage)
            .toBe('url("./assets/breathing/ocean-breath.webp")');
        // Only the name: the world's own rhythm and intent belong to the Breathing tab.
        expect(byClass(guide, 'ody-breath__world-name').textContent).toBe('Ocean Tide');
        await flush();
        expect(loadPoster).toHaveBeenCalledExactlyOnceWith('./assets/breathing/ocean-breath.webp');
        release(true);
        await flush();
        expect(guide.dataset.worldReady).toBe('true');
        guide.dispose();
    });

    it('keeps the plain light when a picture cannot be shown, and ignores one that arrives too late', async () => {
        const failed = create({
            world: resolveChapterBreathWorld(6), loadPoster: () => Promise.reject(new Error('offline')),
        });
        await flush();
        expect(failed.dataset.worldReady).toBe('false');
        failed.dispose();
        let release;
        const late = create({
            world: resolveChapterBreathWorld(8), loadPoster: () => new Promise((resolve) => { release = resolve; }),
        });
        await flush();
        late.dispose();
        release(true);
        await flush();
        expect(late.dataset.worldReady).toBe('false');
        const plain = create();
        expect(plain.dataset.world).toBeUndefined();
        expect(byClass(plain, 'ody-breath__world')).toBeUndefined();
        expect(byClass(plain, 'ody-breath__world-name')).toBeUndefined();
        plain.dispose();
    });

    it('drives its light from a single custom property and keeps a still composition under reduced motion', () => {
        const setProperty = vi.fn();
        const guide = create({ reducedMotion: true });
        guide.style.setProperty = setProperty;
        guide.start();
        advance(2000);
        expect(guide.dataset.reducedMotion).toBe('true');
        expect(setProperty).toHaveBeenCalledWith('--breath', expect.stringMatching(/^0\.\d{3}$/));
        guide.dispose();
    });
});
