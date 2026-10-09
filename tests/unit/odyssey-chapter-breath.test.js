import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    CHAPTER_BREATH, CHAPTER_BREATH_CYCLE_SECONDS, GUIDED_BREATHS, createChapterBreath, resolveChapterBreath,
} from '../../src/ui/odyssey/chapter-breath.js';
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
