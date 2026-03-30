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
});
