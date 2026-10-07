import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { JourneyEntryTransition } from '../../src/rendering/transitions/JourneyEntryTransition.js';

function createCanvasContextStub() {
    return {
        setTransform: vi.fn(),
        clearRect: vi.fn(),
        scale: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        globalAlpha: 1,
        fillStyle: '#ffffff',
    };
}

function createElementStub(tagName) {
    const element = {
        tagName: tagName.toUpperCase(),
        children: [],
        style: {},
        attributes: new Map(),
        className: '',
        parentNode: null,
        appendChild(child) {
            child.parentNode = this;
            this.children.push(child);
            return child;
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) {
                this.children.splice(index, 1);
                child.parentNode = null;
            }
            return child;
        },
        setAttribute(name, value) {
            this.attributes.set(name, String(value));
        },
        getAttribute(name) {
            return this.attributes.get(name) ?? null;
        },
        querySelector(selector) {
            return querySelectorInTree(this, selector);
        },
    };

    if (tagName === 'canvas') {
        element.getContext = () => createCanvasContextStub();
    }

    return element;
}

function matchesSelector(element, selector) {
    if (selector.startsWith('.')) {
        return element.className.split(/\s+/).includes(selector.slice(1));
    }

    return false;
}

function querySelectorInTree(root, selector) {
    for (const child of root.children) {
        if (matchesSelector(child, selector)) {
            return child;
        }

        const nestedMatch = querySelectorInTree(child, selector);
        if (nestedMatch) {
            return nestedMatch;
        }
    }

    return null;
}

function createDomHarness() {
    const body = createElementStub('body');
    const document = {
        body,
        createElement: (tagName) => createElementStub(tagName),
        querySelector: (selector) => querySelectorInTree(body, selector),
    };
    const window = {
        innerWidth: 1280,
        innerHeight: 720,
        devicePixelRatio: 1,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    };

    return {
        document,
        window,
    };
}

function createRafHarness() {
    let now = 0;
    let nextId = 1;
    let queue = [];
    const cancelled = new Set();

    return {
        performance: {
            now: () => now,
        },
        requestAnimationFrame: (callback) => {
            const id = nextId++;
            queue.push({ id, callback });
            return id;
        },
        cancelAnimationFrame: (id) => {
            cancelled.add(id);
        },
        step(ms = 16) {
            now += ms;
            const callbacks = queue;
            queue = [];
            callbacks.forEach(({ id, callback }) => {
                if (!cancelled.has(id)) {
                    callback(now);
                }
                cancelled.delete(id);
            });
        },
        async flushUntil(predicate, {
            stepMs = 16,
            maxSteps = 120,
        } = {}) {
            let steps = 0;
            while (!predicate() && steps < maxSteps) {
                this.step(stepMs);
                // These yields intentionally allow transition callback promises
                // to settle between synthetic RAF ticks.
                // eslint-disable-next-line no-await-in-loop
                await Promise.resolve();
                // eslint-disable-next-line no-await-in-loop
                await Promise.resolve();
                steps += 1;
            }
        },
    };
}

describe('JourneyEntryTransition', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('runs blackout before reveal and waits for readiness before completing', async () => {
        const harness = createRafHarness();
        const dom = createDomHarness();
        const transition = new JourneyEntryTransition({
            documentRef: dom.document,
            windowRef: dom.window,
            performanceRef: harness.performance,
            requestAnimationFrameRef: harness.requestAnimationFrame,
            cancelAnimationFrameRef: harness.cancelAnimationFrame,
        });

        const order = [];
        let releaseReadiness = null;
        const readinessGate = new Promise((resolve) => {
            releaseReadiness = resolve;
        });

        const playPromise = transition.play({
            anchor: { x: 0.42, y: 0.38, radius: 0.12 },
            timings: {
                ignitionDelayMs: 10,
                blackoutStartMs: 20,
                blackoutFullMs: 40,
                revealDurationMs: 30,
                particleDecayMs: 30,
                maxBlackoutHoldMs: 200,
            },
            callbacks: {
                onBlackoutReached: async () => {
                    order.push('blackout');
                    await readinessGate;
                    return true;
                },
                onRevealStart: async () => {
                    order.push('reveal');
                },
                onPlayable: async () => {
                    order.push('playable');
                    const root = dom.document.querySelector('.journey-entry-transition');
                    expect(root?.style.pointerEvents).toBe('none');
                },
                onComplete: async () => {
                    order.push('complete');
                },
            },
        });

        await harness.flushUntil(() => order.includes('blackout'), { stepMs: 10, maxSteps: 8 });
        expect(order).toEqual(['blackout']);

        harness.step(40);
        expect(order).toEqual(['blackout']);

        releaseReadiness();
        await Promise.resolve();
        await Promise.resolve();

        await harness.flushUntil(() => order.includes('reveal'), { stepMs: 10, maxSteps: 8 });
        await harness.flushUntil(() => order.includes('playable'), { stepMs: 10, maxSteps: 8 });
        await harness.flushUntil(() => order.includes('complete'), { stepMs: 10, maxSteps: 8 });

        await expect(playPromise).resolves.toMatchObject({ success: true, aborted: false });
        expect(order).toEqual(['blackout', 'reveal', 'playable', 'complete']);
        expect(dom.document.querySelector('.journey-entry-transition')).toBeNull();
    });

    it('aborts cleanly when gameplay preparation fails under blackout', async () => {
        const harness = createRafHarness();
        const dom = createDomHarness();
        const transition = new JourneyEntryTransition({
            documentRef: dom.document,
            windowRef: dom.window,
            performanceRef: harness.performance,
            requestAnimationFrameRef: harness.requestAnimationFrame,
            cancelAnimationFrameRef: harness.cancelAnimationFrame,
        });

        const abortReasons = [];
        const playPromise = transition.play({
            timings: {
                ignitionDelayMs: 10,
                blackoutStartMs: 20,
                blackoutFullMs: 40,
                revealDurationMs: 30,
                particleDecayMs: 30,
                maxBlackoutHoldMs: 200,
            },
            callbacks: {
                onBlackoutReached: async () => false,
                onAbort: async (result) => {
                    abortReasons.push(result.reason);
                },
            },
        });

        await harness.flushUntil(() => abortReasons.length > 0, { stepMs: 10, maxSteps: 12 });

        await expect(playPromise).resolves.toMatchObject({
            success: false,
            aborted: true,
            reason: 'blackout-callback-rejected',
        });
        expect(abortReasons).toEqual(['blackout-callback-rejected']);
        expect(dom.document.querySelector('.journey-entry-transition')).toBeNull();
    });

    it('keeps the blackout visually alive during a longer readiness hold instead of revealing early', async () => {
        const harness = createRafHarness();
        const dom = createDomHarness();
        const transition = new JourneyEntryTransition({
            documentRef: dom.document,
            windowRef: dom.window,
            performanceRef: harness.performance,
            requestAnimationFrameRef: harness.requestAnimationFrame,
            cancelAnimationFrameRef: harness.cancelAnimationFrame,
        });

        const order = [];
        let releaseReadiness = null;
        const readinessGate = new Promise((resolve) => {
            releaseReadiness = resolve;
        });

        const playPromise = transition.play({
            timings: {
                ignitionDelayMs: 10,
                blackoutStartMs: 20,
                blackoutFullMs: 40,
                revealDurationMs: 30,
                particleDecayMs: 30,
                maxBlackoutHoldMs: 4000,
            },
            callbacks: {
                onBlackoutReached: async () => {
                    order.push('blackout');
                    await readinessGate;
                    return true;
                },
                onRevealStart: async () => {
                    order.push('reveal');
                },
                onPlayable: async () => {
                    order.push('playable');
                },
                onComplete: async () => {
                    order.push('complete');
                },
            },
        });

        await harness.flushUntil(() => order.includes('blackout'), { stepMs: 10, maxSteps: 8 });
        await harness.flushUntil(() => harness.performance.now() >= 2300, { stepMs: 50, maxSteps: 60 });

        const root = dom.document.querySelector('.journey-entry-transition');
        expect(root).not.toBeNull();
        expect(order).toEqual(['blackout']);
        expect(Number.parseFloat(root.children[3].style.opacity || '0')).toBeGreaterThan(0.15);

        releaseReadiness();
        await Promise.resolve();
        await Promise.resolve();

        await harness.flushUntil(() => order.includes('reveal'), { stepMs: 10, maxSteps: 12 });
        await harness.flushUntil(() => order.includes('playable'), { stepMs: 10, maxSteps: 12 });
        await harness.flushUntil(() => order.includes('complete'), { stepMs: 10, maxSteps: 12 });
        await expect(playPromise).resolves.toMatchObject({ success: true, aborted: false });
    });

    it('aborts the older run when a new play request starts immediately', async () => {
        const harness = createRafHarness();
        const dom = createDomHarness();
        const transition = new JourneyEntryTransition({
            documentRef: dom.document,
            windowRef: dom.window,
            performanceRef: harness.performance,
            requestAnimationFrameRef: harness.requestAnimationFrame,
            cancelAnimationFrameRef: harness.cancelAnimationFrame,
        });

        const firstPromise = transition.play({
            callbacks: {
                onAbort: vi.fn(),
            },
        });

        const secondPromise = transition.play({
            timings: {
                ignitionDelayMs: 10,
                blackoutStartMs: 20,
                blackoutFullMs: 40,
                revealDurationMs: 30,
                particleDecayMs: 30,
                maxBlackoutHoldMs: 200,
            },
            callbacks: {
                onBlackoutReached: async () => true,
            },
        });

        await expect(firstPromise).resolves.toMatchObject({
            success: false,
            aborted: true,
            reason: 'replaced',
        });

        await harness.flushUntil(() => dom.document.querySelector('.journey-entry-transition') !== null, {
            stepMs: 10,
            maxSteps: 2,
        });
        await harness.flushUntil(() => transition.activeRun?.revealTriggered, { stepMs: 10, maxSteps: 12 });
        await harness.flushUntil(() => !transition.activeRun, { stepMs: 10, maxSteps: 12 });

        await expect(secondPromise).resolves.toMatchObject({ success: true, aborted: false });
    });

    it.each(['setting', 'OS'])('uses only a dark opacity fade for reduced motion from %s', async (preference) => {
        const harness = createRafHarness();
        const dom = createDomHarness();
        dom.window.matchMedia = vi.fn(() => ({ matches: preference === 'OS' }));
        const transition = new JourneyEntryTransition({
            documentRef: dom.document,
            windowRef: dom.window,
            performanceRef: harness.performance,
            requestAnimationFrameRef: harness.requestAnimationFrame,
            cancelAnimationFrameRef: harness.cancelAnimationFrame,
        });
        const order = [];
        let releaseReadiness;
        const readiness = new Promise((resolve) => { releaseReadiness = resolve; });
        const playPromise = transition.play({
            reducedMotion: preference === 'setting',
            callbacks: {
                onBlackoutReached: () => {
                    order.push('blackout');
                    return readiness;
                },
                onRevealStart: () => { order.push('reveal'); },
                onPlayable: () => { order.push('playable'); },
                onComplete: () => { order.push('complete'); },
            },
        });
        const run = transition.activeRun;
        expect(run.reducedMotion).toBe(true);
        expect(run.dom.root.getAttribute('data-reduced-motion')).toBe('true');
        expect(run.dom.root.children).toEqual([run.dom.veil]);
        expect(run.dom.veil.style.cssText).toContain('background: #05070d');
        expect(run.dom.canvas).toBeUndefined();
        expect(run.particles).toEqual([]);

        // The fade is gradual, but gameplay preparation cannot start while uncovered.
        harness.step(110);
        expect(Number(run.dom.veil.style.opacity)).toBeCloseTo(0.5);
        expect(order).toEqual([]);
        await harness.flushUntil(() => order.includes('blackout'), { stepMs: 10 });
        harness.step(500);
        const heldStyles = { ...run.dom.veil.style };
        harness.step(500);
        expect(run.dom.veil.style).toEqual(heldStyles);
        expect(run.dom.veil.style.opacity).toBe('1');
        expect(order).toEqual(['blackout']);

        releaseReadiness({ arrivalAnchor: { x: 0.71, y: 0.34 } });
        await harness.flushUntil(() => order.includes('reveal'), { stepMs: 10 });
        harness.step(110);
        expect(Number(run.dom.veil.style.opacity)).toBeGreaterThan(0);
        expect(Number(run.dom.veil.style.opacity)).toBeLessThan(1);
        await harness.flushUntil(() => order.includes('complete'), { stepMs: 10 });
        await expect(playPromise).resolves.toMatchObject({ success: true, aborted: false });
        expect(order).toEqual(['blackout', 'reveal', 'playable', 'complete']);
        expect(dom.document.body.children).toEqual([]);
    });

    it('does not reveal an aborted reduced-motion run when preparation settles late', async () => {
        const harness = createRafHarness();
        const dom = createDomHarness();
        const transition = new JourneyEntryTransition({
            documentRef: dom.document,
            windowRef: dom.window,
            performanceRef: harness.performance,
            requestAnimationFrameRef: harness.requestAnimationFrame,
            cancelAnimationFrameRef: harness.cancelAnimationFrame,
        });
        let releaseReadiness;
        const readiness = new Promise((resolve) => { releaseReadiness = resolve; });
        const onRevealStart = vi.fn();
        const onComplete = vi.fn();
        const onAbort = vi.fn();
        const playPromise = transition.play({
            reducedMotion: true,
            callbacks: {
                onBlackoutReached: () => readiness, onRevealStart, onComplete, onAbort,
            },
        });
        await harness.flushUntil(() => transition.activeRun?.readyTriggered, { stepMs: 20 });
        transition.abort('mode-deactivated');
        await expect(playPromise).resolves.toMatchObject({ reason: 'mode-deactivated', success: false });
        releaseReadiness(true);
        await harness.flushUntil(() => false, { stepMs: 100, maxSteps: 8 });
        expect(onAbort).toHaveBeenCalledTimes(1);
        expect(onRevealStart).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
        expect(dom.document.body.children).toEqual([]);
    });

    it('keeps the replacement resize listener when the previous abort finishes', async () => {
        const harness = createRafHarness();
        const dom = createDomHarness();
        const transition = new JourneyEntryTransition({
            documentRef: dom.document,
            windowRef: dom.window,
            performanceRef: harness.performance,
            requestAnimationFrameRef: harness.requestAnimationFrame,
            cancelAnimationFrameRef: harness.cancelAnimationFrame,
        });
        const firstPromise = transition.play();
        const secondPromise = transition.play();
        const secondRun = transition.activeRun;
        await expect(firstPromise).resolves.toMatchObject({ reason: 'replaced' });
        expect(transition.activeRun).toBe(secondRun);
        expect(dom.window.removeEventListener).not.toHaveBeenCalled();
        dom.window.innerWidth = 700;
        transition.onResize();
        expect(secondRun.dom.canvas.width).toBe(700);
        transition.abort('test-finished');
        await secondPromise;
        expect(dom.window.removeEventListener).toHaveBeenCalledTimes(1);
    });

    it('reports a synchronous preparation exception and disposes the cover', async () => {
        const harness = createRafHarness();
        const dom = createDomHarness();
        const transition = new JourneyEntryTransition({
            documentRef: dom.document,
            windowRef: dom.window,
            performanceRef: harness.performance,
            requestAnimationFrameRef: harness.requestAnimationFrame,
            cancelAnimationFrameRef: harness.cancelAnimationFrame,
        });
        const error = new Error('preparation failed');
        const onAbort = vi.fn();
        const playPromise = transition.play({
            reducedMotion: true,
            callbacks: {
                onBlackoutReached: () => { throw error; },
                onAbort,
            },
        });
        await harness.flushUntil(() => onAbort.mock.calls.length > 0, { stepMs: 20 });
        await expect(playPromise).resolves.toMatchObject({
            success: false, reason: 'blackout-callback-error', error,
        });
        expect(onAbort).toHaveBeenCalledTimes(1);
        expect(dom.document.body.children).toEqual([]);
    });

    it('settles a rejected completion callback without leaking its promise or cover', async () => {
        const harness = createRafHarness();
        const dom = createDomHarness();
        const transition = new JourneyEntryTransition({
            documentRef: dom.document,
            windowRef: dom.window,
            performanceRef: harness.performance,
            requestAnimationFrameRef: harness.requestAnimationFrame,
            cancelAnimationFrameRef: harness.cancelAnimationFrame,
        });
        const error = new Error('completion failed');
        const playPromise = transition.play({
            reducedMotion: true,
            callbacks: { onComplete: async () => { throw error; } },
        });
        await harness.flushUntil(() => !transition.activeRun, { stepMs: 20 });
        await expect(playPromise).resolves.toMatchObject({
            success: false, reason: 'complete-callback-error', error,
        });
        expect(dom.document.body.children).toEqual([]);
    });
});
