import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createJourneyFlowOverlay } from '../../src/ui/odyssey/JourneyFlowOverlay.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';

function eventTarget(properties = {}) {
    const listeners = new Map();
    return {
        ...properties,
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
        dispatch(type, properties = {}) {
            const event = { target: this, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...properties };
            listeners.get(type)?.forEach((listener) => listener(event));
            return event;
        },
        listenerCount() { return [...listeners.values()].reduce((sum, group) => sum + group.size, 0); },
    };
}

function createElement(tagName) {
    return eventTarget({
        tagName,
        children: [],
        dataset: {},
        style: { setProperty: vi.fn() },
        textContent: '',
        className: '',
        hidden: false,
        isConnected: true,
        appendChild(child) { this.children.push(child); return child; },
        remove() { this.isConnected = false; },
        focus() { document.activeElement = this; },
    });
}
function nodes(element) { return [element, ...element.children.flatMap(nodes)]; }
function action(modal, name) { return nodes(modal).find((node) => node.dataset.flowAction === name); }
function markup(modal) { return nodes(modal).map((node) => node.textContent).join(' '); }
function createOverlay(options = {}) {
    return createJourneyFlowOverlay({
        level: getLevelById(1), nextLevel: getLevelById(2), results: { stars: 2 }, ...options,
    });
}

describe('Odyssey journey flow overlay', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('document', eventTarget({
            createElement,
            activeElement: null,
            hidden: false,
            hasFocus: vi.fn(() => true),
        }));
        vi.stubGlobal('window', eventTarget());
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('briefly celebrates and advances once without another confirmation', () => {
        const onChoose = vi.fn();
        const modal = createOverlay({ onChoose });
        expect(markup(modal)).toContain('Orb 1 · Complete');
        expect(markup(modal)).toContain(getLevelById(2).name);
        expect(nodes(modal).find((node) => node.role === 'img').ariaLabel).toBe('2 of 3 stars earned');
        vi.advanceTimersByTime(2599);
        expect(onChoose).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        action(modal, 'next').dispatch('click');
        action(modal, 'map').dispatch('click');
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('next');
        modal.dispose();
    });

    it('never auto-advances when the player has disabled it', () => {
        const onChoose = vi.fn();
        const modal = createOverlay({ onChoose, autoContinue: false });
        vi.advanceTimersByTime(100000);
        expect(onChoose).not.toHaveBeenCalled();
        expect(action(modal, 'pause').hidden).toBe(true);
        action(modal, 'next').dispatch('click');
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('next');
        modal.dispose();
    });

    it('gives unlimited reading time when enlarged content pushes Pause below the viewport', () => {
        const onChoose = vi.fn();
        window.innerHeight = 600;
        const modal = createOverlay({ onChoose });
        action(modal, 'pause').getBoundingClientRect = () => ({ top: 650, bottom: 694 });
        vi.advanceTimersByTime(10000);
        expect(onChoose).not.toHaveBeenCalled();
        expect(modal.dataset.autoRunning).toBe('false');
        expect(markup(modal)).toContain('Paused to give you time to read.');
        action(modal, 'next').dispatch('click');
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('next');
        modal.dispose();
    });

    it('holds an active countdown if a resize moves Pause out of view', () => {
        const onChoose = vi.fn();
        window.innerHeight = 800;
        const modal = createOverlay({ onChoose });
        action(modal, 'pause').getBoundingClientRect = () => ({ top: 650, bottom: 694 });
        vi.advanceTimersByTime(500);
        expect(modal.dataset.autoRunning).toBe('true');
        window.innerHeight = 400;
        window.dispatch('resize');
        vi.advanceTimersByTime(10000);
        expect(onChoose).not.toHaveBeenCalled();
        expect(modal.dataset.autoRunning).toBe('false');
        modal.dispose();
    });

    it('keeps the next goal and changed rules in the same composition through preparation', async () => {
        const onChoose = vi.fn();
        const onTransit = vi.fn();
        const modal = createOverlay({ onChoose });
        const goal = nodes(modal).find((node) => node.className === 'ody-flow__goal');
        const changes = nodes(modal).find((node) => node.className === 'ody-flow__changes');
        expect(goal.textContent).toBe('Trigger 3 cascades');
        expect(markup(changes)).toContain('falling blocks clear again');
        action(modal, 'next').dispatch('click');
        expect(modal.beginTransit({ onChoose: onTransit })).toBe(true);
        expect(nodes(modal)).toContain(goal);
        expect(nodes(modal)).toContain(changes);
        expect(modal.dataset.continuation).toBe('true');
        expect(action(modal, 'pause').hidden).toBe(false);
        expect(nodes(modal).find((node) => node.type === 'checkbox').disabled).toBe(true);
        const covered = modal.cover();
        await vi.advanceTimersByTimeAsync(100);
        expect(await covered).toBe(true);
        action(modal, 'map').dispatch('click');
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('next');
        expect(onTransit).toHaveBeenCalledExactlyOnceWith('map');
        modal.dispose();
    });

    it('can deliberately pause preparation for reading without needing to leave the window', async () => {
        const modal = createOverlay({ autoContinue: false });
        action(modal, 'next').dispatch('click');
        modal.beginTransit();
        action(modal, 'pause').dispatch('click');
        const ready = vi.fn();
        const waiting = modal.waitUntilVisible().then(ready);
        await vi.advanceTimersByTimeAsync(10000);
        expect(ready).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(action(modal, 'resume'));
        action(modal, 'resume').dispatch('click');
        await waiting;
        expect(ready).toHaveBeenCalledWith(true);
        modal.dispose();
    });

    it('keeps the same briefing and live controls through scenic emergence, travel and entry', async () => {
        const onTransit = vi.fn();
        const modal = createOverlay();
        const goal = nodes(modal).find((node) => node.className === 'ody-flow__goal');
        const changes = nodes(modal).find((node) => node.className === 'ody-flow__changes');
        action(modal, 'next').dispatch('click');
        modal.beginTransit({ onChoose: onTransit });
        for (const stage of ['emerging', 'travel', 'entering']) {
            expect(modal.setScenic(stage)).toBe(true);
            expect(modal.dataset.worldStage).toBe(stage);
            expect(modal.inert).toBe(false);
            expect(action(modal, 'pause').hidden).toBe(false);
            expect(action(modal, 'map').hidden).toBe(false);
            expect(nodes(modal)).toContain(goal);
            expect(nodes(modal)).toContain(changes);
        }
        action(modal, 'pause').dispatch('click');
        expect(modal.dataset.visibilityHeld).toBe('true');
        const held = modal.waitUntilVisible();
        action(modal, 'resume').dispatch('click');
        expect(await held).toBe(true);
        expect(markup(modal)).toContain('Entering your next orb…');
        expect(modal.inert).toBe(false);
        document.dispatch('keydown', { key: 'Escape' });
        expect(onTransit).toHaveBeenCalledExactlyOnceWith('map');
        modal.dispose();
    });

    it('automatically holds overflowing scenic text once and respects Resume across later stages and resizes', async () => {
        const modal = createOverlay({ variant: 'transit' });
        const content = nodes(modal).find((node) => node.className === 'ody-flow__content');
        content.clientHeight = 240;
        content.scrollHeight = 520;
        modal.setScenic('emerging');
        await vi.advanceTimersByTimeAsync(0);
        expect(modal.dataset.visibilityHeld).toBe('true');
        expect(document.activeElement).toBe(action(modal, 'resume'));
        expect(markup(modal)).toContain('Journey paused to give you time to read.');
        const held = modal.waitUntilVisible();
        action(modal, 'resume').dispatch('click');
        expect(await held).toBe(true);
        modal.setScenic('travel');
        window.dispatch('resize');
        await vi.advanceTimersByTimeAsync(0);
        expect(modal.dataset.visibilityHeld).toBe('false');
        expect(await modal.waitUntilVisible()).toBe(true);
        expect(markup(modal)).toContain('Following the path to your next orb…');
        modal.dispose();
    });

    it('holds on a scenic resize that makes previously fitting content scroll', async () => {
        const modal = createOverlay({ variant: 'transit' });
        const content = nodes(modal).find((node) => node.className === 'ody-flow__content');
        content.clientHeight = 360;
        content.scrollHeight = 300;
        modal.setScenic('travel');
        await vi.advanceTimersByTimeAsync(0);
        expect(modal.dataset.visibilityHeld).not.toBe('true');
        content.clientHeight = 200;
        window.dispatch('resize');
        expect(modal.dataset.visibilityHeld).toBe('true');
        modal.dispose();
    });

    it('preserves final Ready input ownership and leaves scenic presentation on cancellation', async () => {
        const modal = createOverlay({ variant: 'transit' });
        modal.setScenic('entering');
        const revealing = modal.reveal();
        expect(modal.inert).toBe(true);
        await vi.advanceTimersByTimeAsync(360);
        expect(await revealing).toBe(true);
        window.dispatch('blur');
        expect(modal.dataset.visibilityHeld).toBe('true');
        expect(modal.inert).toBe(false);
        modal.retainCover();
        expect(modal.dataset.worldStage).toBeUndefined();
        expect(modal.dataset.retained).toBe('true');
        expect(modal.setScenic('travel')).toBe(false);
        expect(await modal.waitUntilVisible()).toBe(false);
        modal.dispose();
    });

    it('keeps a reduced-motion world seek opaque through entry until the final reveal', async () => {
        const modal = createOverlay({ variant: 'transit', reducedMotion: true });
        modal.setScenic('travel');
        expect(modal.dataset.scenicCovered).toBeUndefined();
        const cover = modal.cover();
        expect(modal.dataset.scenicCovered).toBe('true');
        await vi.advanceTimersByTimeAsync(100);
        expect(await cover).toBe(true);
        modal.setScenic('entering');
        expect(modal.dataset.scenicCovered).toBe('true');
        expect(modal.inert).toBe(false);
        const reveal = modal.reveal();
        expect(modal.dataset.revealing).toBe('true');
        expect(modal.inert).toBe(true);
        await vi.advanceTimersByTimeAsync(100);
        expect(await reveal).toBe(true);
        modal.setScenic(false);
        expect(modal.dataset.scenicCovered).toBeUndefined();
        modal.dispose();
    });

    it('restores ordinary transit presentation and never changes chapter arrival through the scenic API', () => {
        const modal = createOverlay({ variant: 'transit' });
        modal.setScenic('travel');
        expect(modal.setScenic(false)).toBe(true);
        expect(modal.dataset.worldStage).toBeUndefined();
        expect(markup(modal)).toContain('Preparing your next orb…');
        expect(modal.setScenic('unknown')).toBe(false);
        modal.dispose();
        const chapter = createOverlay({ variant: 'chapter' });
        expect(chapter.setScenic('travel')).toBe(false);
        expect(chapter.dataset.worldStage).toBeUndefined();
        expect(action(chapter, 'next').textContent).toBe('Begin chapter');
        chapter.dispose();
    });

    it('holds after Pause and lets the player deliberately continue', () => {
        const onChoose = vi.fn();
        const modal = createOverlay({ onChoose });
        vi.advanceTimersByTime(2000);
        action(modal, 'pause').dispatch('click');
        vi.advanceTimersByTime(10000);
        expect(onChoose).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(action(modal, 'next'));
        expect(action(modal, 'next').textContent).toBe('Continue now');
        expect(action(modal, 'pause').disabled).toBe(true);
        action(modal, 'next').dispatch('click');
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('next');
        modal.dispose();
    });

    it('persists preference changes while holding the current celebration', () => {
        const onChoose = vi.fn();
        const onAutoContinueChange = vi.fn();
        const modal = createOverlay({ onChoose, onAutoContinueChange });
        const checkbox = nodes(modal).find((node) => node.type === 'checkbox');
        checkbox.checked = false;
        checkbox.dispatch('change');
        checkbox.checked = true;
        checkbox.dispatch('change');
        vi.advanceTimersByTime(10000);
        expect(onAutoContinueChange.mock.calls).toEqual([[false], [true]]);
        expect(onChoose).not.toHaveBeenCalled();
        modal.dispose();
    });

    it('holds if focus moves to secondary actions or a pointer interaction starts', () => {
        const onChoose = vi.fn();
        const modal = createOverlay({ onChoose });
        modal.dispatch('focusin', { target: action(modal, 'details') });
        vi.advanceTimersByTime(10000);
        expect(onChoose).not.toHaveBeenCalled();
        modal.dispose();
        const second = createOverlay({ onChoose });
        second.dispatch('pointerdown');
        vi.advanceTimersByTime(10000);
        expect(onChoose).not.toHaveBeenCalled();
        second.dispose();
    });

    it('never skips the chapter reveal, even with auto-continue enabled', () => {
        const onChoose = vi.fn();
        const modal = createOverlay({
            variant: 'chapter', nextLevel: getLevelById(6), chapter: CHAPTER_CONFIGS[1], onChoose,
        });
        expect(markup(modal)).toContain(CHAPTER_CONFIGS[1].name);
        expect(markup(modal)).toContain(CHAPTER_CONFIGS[1].narrative.intro);
        expect(markup(modal)).toContain('Clear 20 lines');
        expect(nodes(modal).some((node) => node.type === 'checkbox')).toBe(false);
        vi.advanceTimersByTime(100000);
        expect(onChoose).not.toHaveBeenCalled();
        action(modal, 'next').dispatch('click');
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('next');
        modal.dispose();
    });

    it('morphs the same completion owner into an untimed chapter and keeps Map above its next entry', async () => {
        const onCompletion = vi.fn();
        const onChapter = vi.fn();
        const onEntry = vi.fn();
        const modal = createOverlay({
            nextLevel: getLevelById(6), chapter: CHAPTER_CONFIGS[1], onChoose: onCompletion,
        });
        const narrative = nodes(modal).find((node) => node.className === 'ody-flow__narrative');
        expect(narrative.hidden).toBe(true);
        const listeners = document.listenerCount();
        action(modal, 'next').dispatch('click');
        modal.beginTransit({ onChoose: onEntry });
        modal.setScenic('travel');
        expect(action(modal, 'pause').hidden).toBe(false);
        expect(narrative.hidden).toBe(true);
        window.dispatch('blur');
        expect(modal.showChapter({ onChoose: onChapter })).toBe(true);
        expect(modal.dataset.variant).toBe('chapter');
        expect(modal.dataset.worldStage).toBeUndefined();
        expect(narrative.hidden).toBe(false);
        expect(action(modal, 'next').hidden).toBe(true);
        action(modal, 'resume').dispatch('click');
        expect(action(modal, 'next').textContent).toBe('Begin chapter');
        expect(action(modal, 'next').hidden).toBe(false);
        await vi.advanceTimersByTimeAsync(100000);
        expect(onChapter).not.toHaveBeenCalled();
        expect(document.listenerCount()).toBe(listeners);
        action(modal, 'next').dispatch('click');
        expect(onChapter).toHaveBeenCalledExactlyOnceWith('next');
        modal.beginTransit({ onChoose: onEntry });
        expect(modal.setScenic('entering')).toBe(true);
        expect(modal.dataset.worldStage).toBe('entering');
        expect(narrative.hidden).toBe(true);
        expect(action(modal, 'pause').hidden).toBe(false);
        action(modal, 'map').dispatch('click');
        expect(onEntry).toHaveBeenCalledExactlyOnceWith('map');
        modal.dispose();
    });

    it('removes a reduced-motion seek cover only when the settled chapter is presented', async () => {
        const modal = createOverlay({
            variant: 'transit', reducedMotion: true, nextLevel: getLevelById(6), chapter: CHAPTER_CONFIGS[1],
        });
        modal.setScenic('travel');
        const cover = modal.cover();
        await vi.advanceTimersByTimeAsync(100);
        expect(await cover).toBe(true);
        expect(modal.dataset.scenicCovered).toBe('true');
        expect(nodes(modal).find((node) => node.className === 'ody-flow__narrative').hidden).toBe(true);
        modal.showChapter();
        expect(modal.dataset.scenicCovered).toBeUndefined();
        expect(modal.dataset.covered).toBe('false');
        expect(nodes(modal).find((node) => node.className === 'ody-flow__narrative').hidden).toBe(false);
        modal.dispose();
    });

    it('requires an uninterrupted visible fade after blur during the overlapping board reveal', async () => {
        const modal = createOverlay({ variant: 'transit' });
        modal.setScenic('entering');
        const settled = vi.fn();
        const reveal = modal.reveal().then(settled);
        await vi.advanceTimersByTimeAsync(180);
        window.dispatch('blur');
        await vi.advanceTimersByTimeAsync(1000);
        expect(settled).not.toHaveBeenCalled();
        action(modal, 'resume').dispatch('click');
        await vi.advanceTimersByTimeAsync(359);
        expect(settled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await reveal;
        expect(settled).toHaveBeenCalledExactlyOnceWith(true);
        expect(modal.inert).toBe(true);
        modal.dispose();
    });

    it('stops background auto-advance and requires deliberate resume after returning', async () => {
        const onChoose = vi.fn();
        const modal = createOverlay({ onChoose });
        vi.advanceTimersByTime(1000);
        document.hidden = true;
        document.dispatch('visibilitychange');
        const settled = vi.fn();
        const ready = modal.waitUntilVisible().then(settled);
        document.hidden = false;
        document.dispatch('visibilitychange');
        vi.advanceTimersByTime(10000);
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();
        expect(onChoose).not.toHaveBeenCalled();
        action(modal, 'resume').dispatch('click');
        await ready;
        expect(settled).toHaveBeenCalledWith(true);
        expect(onChoose).not.toHaveBeenCalled();
        action(modal, 'next').dispatch('click');
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('next');
        modal.dispose();
    });

    it('detects an already hidden tab and ignores resume until it is visible', async () => {
        document.hidden = true;
        const modal = createOverlay({ variant: 'transit' });
        const settled = vi.fn();
        const ready = modal.waitUntilVisible().then(settled);
        action(modal, 'resume').dispatch('click');
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();
        document.hidden = false;
        action(modal, 'resume').dispatch('click');
        await ready;
        expect(settled).toHaveBeenCalledWith(true);
        modal.dispose();
    });

    it('holds on window blur independently of tab visibility', async () => {
        const modal = createOverlay({ variant: 'transit' });
        window.dispatch('blur');
        expect(action(modal, 'resume').hidden).toBe(false);
        modal.setStatus('A scene is warming');
        expect(markup(modal)).toContain('Journey paused.');
        const wait = modal.waitUntilVisible();
        modal.dispose();
        expect(await wait).toBe(false);
    });

    it('can resume a visibility wait after a chapter choice has already fired', async () => {
        const onChoose = vi.fn();
        const modal = createOverlay({ variant: 'chapter', onChoose });
        action(modal, 'next').dispatch('click');
        document.hidden = true;
        const ready = modal.waitUntilVisible();
        expect(action(modal, 'resume').hidden).toBe(false);
        document.hidden = false;
        action(modal, 'resume').dispatch('click');
        expect(await ready).toBe(true);
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('next');
        modal.dispose();
    });

    it('keeps chapter presence ownership through entry and enables one Map cancellation', async () => {
        const onChoose = vi.fn();
        const modal = createOverlay({
            variant: 'chapter', nextLevel: getLevelById(6), chapter: CHAPTER_CONFIGS[1], onChoose,
        });
        action(modal, 'next').dispatch('click');
        expect(modal.beginTransit()).toBe(true);
        expect(modal.beginTransit()).toBe(false);
        expect(modal.dataset.variant).toBe('transit');
        expect(modal.dataset.covered).toBe('true');
        expect(action(modal, 'next').hidden).toBe(true);
        expect(nodes(modal).find((node) => node.className === 'ody-flow__title').textContent)
            .toBe(getLevelById(6).name);
        expect(nodes(modal).find((node) => node.className === 'ody-flow__narrative').hidden).toBe(true);
        window.dispatch('blur');
        const ready = modal.waitUntilVisible();
        action(modal, 'resume').dispatch('click');
        expect(await ready).toBe(true);
        expect(action(modal, 'next').hidden).toBe(true);
        document.dispatch('keydown', { key: 'Escape' });
        action(modal, 'map').dispatch('click');
        expect(onChoose.mock.calls).toEqual([['next'], ['map']]);
        modal.dispose();
    });

    it('records a quick blur and resume even when the ready gate has not polled yet', () => {
        const modal = createOverlay({ variant: 'transit' });
        const generation = modal.visibilityGeneration;
        window.dispatch('blur');
        action(modal, 'resume').dispatch('click');
        expect(modal.dataset.visibilityHeld).toBe('false');
        expect(modal.visibilityGeneration).toBeGreaterThan(generation);
        const resumedGeneration = modal.visibilityGeneration;
        document.hidden = true;
        document.dispatch('visibilitychange');
        expect(modal.visibilityGeneration).toBeGreaterThan(resumedGeneration);
        modal.dispose();
    });

    it('consumes gameplay and menu keys during the transparent ready cue but preserves Escape', async () => {
        const onChoose = vi.fn();
        const modal = createOverlay({ variant: 'transit', onChoose });
        const revealed = modal.reveal();
        await vi.advanceTimersByTimeAsync(360);
        expect(await revealed).toBe(true);
        for (const key of ['Enter', ' ', 'Tab', 'p', 'ArrowDown']) {
            const event = document.dispatch('keydown', { key, stopImmediatePropagation: vi.fn() });
            expect(event.preventDefault).toHaveBeenCalledOnce();
            expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
        }
        expect(onChoose).not.toHaveBeenCalled();
        document.dispatch('keydown', { key: 'Escape' });
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('map');
        modal.dispose();
    });

    it('covers preparation and retains visibility ownership after the reveal', async () => {
        const modal = createOverlay({ variant: 'transit' });
        const covered = modal.cover();
        expect(modal.dataset.covered).toBe('true');
        await vi.advanceTimersByTimeAsync(420);
        expect(await covered).toBe(true);
        modal.setStatus('Ready');
        expect(markup(modal)).toContain('Ready');
        const revealed = modal.reveal();
        expect(modal.dataset.revealing).toBe('true');
        expect(modal.inert).toBe(true);
        await vi.advanceTimersByTimeAsync(360);
        expect(await revealed).toBe(true);
        expect(modal.isConnected).toBe(true);
        expect(modal.dataset.revealed).toBe('true');
        window.dispatch('blur');
        expect(modal.dataset.visibilityHeld).toBe('true');
        expect(modal.inert).toBe(false);
        const resumed = modal.waitUntilVisible();
        action(modal, 'resume').dispatch('click');
        expect(await resumed).toBe(true);
        expect(modal.inert).toBe(true);
        modal.dispose();
        expect(document.listenerCount()).toBe(0);
        expect(window.listenerCount()).toBe(0);
    });

    it('resolves outstanding cover, reveal and visibility waits false on cancellation', async () => {
        const modal = createOverlay({ variant: 'transit' });
        const cover = modal.cover();
        const reveal = modal.reveal();
        document.hidden = true;
        const visible = modal.waitUntilVisible();
        modal.dispose();
        modal.dispose();
        expect(await Promise.all([cover, reveal, visible])).toEqual([false, false, false]);
        expect(await modal.cover()).toBe(false);
        expect(await modal.waitUntilVisible()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        expect(document.listenerCount()).toBe(0);
        expect(window.listenerCount()).toBe(0);
    });

    it('uses a short dissolve without changing progression rules for reduced motion', async () => {
        const modal = createOverlay({ variant: 'transit', reducedMotion: true });
        const covered = modal.cover();
        await vi.advanceTimersByTimeAsync(100);
        expect(await covered).toBe(true);
        expect(modal.dataset.reducedMotion).toBe('true');
        const reveal = modal.reveal();
        await vi.advanceTimersByTimeAsync(100);
        expect(await reveal).toBe(true);
        modal.dispose();
    });

    it('retains an opaque cover during cancellation without allowing stale continuations', async () => {
        const onChoose = vi.fn();
        const modal = createOverlay({ variant: 'transit', onChoose });
        const cover = modal.cover();
        const reveal = modal.reveal();
        document.hidden = true;
        const visible = modal.waitUntilVisible();
        modal.retainCover();
        expect(await Promise.all([cover, reveal, visible])).toEqual([false, false, false]);
        expect(modal.isConnected).toBe(true);
        expect(modal.dataset.retained).toBe('true');
        expect(modal.dataset.covered).toBe('true');
        expect(modal.dataset.revealing).toBe('false');
        expect(modal.dataset.visibilityHeld).toBe('false');
        expect(modal.inert).toBe(false);
        expect(action(modal, 'map').disabled).toBe(true);
        action(modal, 'map').dispatch('click');
        expect(onChoose).not.toHaveBeenCalled();
        modal.setStatus('A stale preparation completed');
        expect(markup(modal)).toContain('Returning to the map…');
        expect(await modal.cover()).toBe(false);
        expect(await modal.reveal()).toBe(false);
        expect(await modal.waitUntilVisible()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        expect(document.listenerCount()).toBe(0);
        modal.dispose();
        expect(modal.isConnected).toBe(false);
    });

    it('ignores held activation keys and leaves focused buttons in charge of Enter', () => {
        const onChoose = vi.fn();
        const modal = createOverlay({ onChoose });
        const held = document.dispatch('keydown', { key: 'Enter', repeat: true });
        expect(held.preventDefault).toHaveBeenCalledOnce();
        document.dispatch('keydown', { key: ' ' });
        expect(onChoose).not.toHaveBeenCalled();
        action(modal, 'details').focus();
        const enter = document.dispatch('keydown', { key: 'Enter' });
        expect(enter.preventDefault).not.toHaveBeenCalled();
        action(modal, 'details').dispatch('click');
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('details');
        modal.dispose();
    });

    it('traps Tab, holds auto-advance while navigating, and cancels via Escape', () => {
        const onChoose = vi.fn();
        const modal = createOverlay({ onChoose });
        const checkbox = nodes(modal).find((node) => node.type === 'checkbox');
        checkbox.focus();
        const forward = document.dispatch('keydown', { key: 'Tab' });
        expect(forward.preventDefault).toHaveBeenCalledOnce();
        expect(document.activeElement).toBe(action(modal, 'next'));
        document.dispatch('keydown', { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(checkbox);
        vi.advanceTimersByTime(10000);
        expect(onChoose).not.toHaveBeenCalled();
        document.dispatch('keydown', { key: 'Escape' });
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('map');
        modal.dispose();
    });

    it('keeps Map cancellation available during preparation', () => {
        const onChoose = vi.fn();
        const modal = createOverlay({ variant: 'transit', onChoose });
        expect(action(modal, 'next').hidden).toBe(true);
        action(modal, 'map').dispatch('click');
        action(modal, 'map').dispatch('click');
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('map');
        modal.dispose();
    });
});
