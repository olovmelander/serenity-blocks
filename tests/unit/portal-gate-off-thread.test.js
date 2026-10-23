import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { createPortalGateWorkerCore, GATE_WORKER_STALL_MS } from '../../src/rendering/transitions/portal-gate-worker-core.js';
import { resetPortalGateWorkerForTests } from '../../src/rendering/transitions/portal-gate-remote.js';
import { JourneyEntryTransition } from '../../src/rendering/transitions/JourneyEntryTransition.js';

/** A 2D context where every call succeeds and is counted (gradients come back gradient-shaped). */
function contextStub() {
    const calls = new Map();
    const gradient = { addColorStop: () => {} };
    const target = {};
    return new Proxy(target, {
        get(t, prop) {
            if (prop === 'calls') return calls;
            if (prop in t) return t[prop];
            if (typeof prop !== 'string') return undefined;
            return (...args) => {
                calls.set(prop, (calls.get(prop) || 0) + 1);
                if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return gradient;
                if (prop === 'createImageData') return { data: new Uint8ClampedArray(args[0] * args[1] * 4) };
                return undefined;
            };
        },
        set(t, prop, value) { t[prop] = value; return true; },
    });
}

function canvasStub() {
    const ctx = contextStub();
    return {
        width: 1, height: 1, ctx, getContext: () => ctx,
    };
}

function coreHarness() {
    let now = 0;
    let frames = [];
    const core = createPortalGateWorkerCore({
        now: () => now,
        requestFrame: (callback) => { frames.push(callback); },
        makeCanvas: canvasStub,
    });
    return {
        core,
        advance(ms) {
            now += ms;
            const due = frames;
            frames = [];
            due.forEach((callback) => callback());
        },
    };
}

const PASSAGE = {
    speed: 1, time: 0, center: { x: 640, y: 360 }, region: { kind: 'all' },
};

describe('the portal gate drawn off the main thread', () => {
    it('draws each frame the page posts, sized to the page', () => {
        const h = coreHarness();
        const canvas = canvasStub();
        h.core.handle({
            type: 'start', id: 1, canvas, qualityPreset: 'Low', width: 1280, height: 720, dpr: 1.5,
        });
        expect([canvas.width, canvas.height]).toEqual([1920, 1080]);
        h.core.handle({ type: 'frame', id: 1, frame: PASSAGE });
        expect(canvas.ctx.calls.get('clearRect')).toBe(1);
        expect(canvas.ctx.calls.get('drawImage')).toBeGreaterThan(0);
    });

    it('keeps the passage moving on its own clock while the page is busy', () => {
        const h = coreHarness();
        const canvas = canvasStub();
        h.core.handle({
            type: 'start', id: 1, canvas, width: 640, height: 360,
        });
        h.core.handle({ type: 'frame', id: 1, frame: PASSAGE });
        const run = h.core.latest;
        // The page keeps posting: the worker's own frames stay quiet.
        h.advance(GATE_WORKER_STALL_MS - 4);
        expect(canvas.ctx.calls.get('clearRect')).toBe(1);
        // The page stalls (a theme building): the worker draws by itself, in real time.
        const travelBefore = run.travelState.travel;
        h.advance(40);
        h.advance(40);
        h.advance(40);
        expect(canvas.ctx.calls.get('clearRect')).toBe(4);
        expect(run.travelState.travel).toBeGreaterThan(travelBefore);
        expect(run.time).toBeCloseTo((GATE_WORKER_STALL_MS - 4 + 120) / 1000, 5);
        // When the page comes back its frame's own (capped) clock does not pull time backwards.
        h.core.handle({ type: 'frame', id: 1, frame: { ...PASSAGE, time: 0.05 } });
        expect(run.time).toBeGreaterThan(0.12);
    });

    it('ignores frames for a run it does not hold, and releases a stopped run at once', () => {
        const h = coreHarness();
        const first = canvasStub();
        const second = canvasStub();
        h.core.handle({
            type: 'start', id: 1, canvas: first, width: 640, height: 360,
        });
        h.core.handle({
            type: 'start', id: 2, canvas: second, width: 640, height: 360,
        });
        h.core.handle({ type: 'frame', id: 9, frame: PASSAGE });
        expect(second.ctx.calls.get('clearRect')).toBeUndefined();
        // A replaced run's late stop still frees its full-screen backing.
        h.core.handle({ type: 'stop', id: 1 });
        expect([first.width, first.height]).toEqual([1, 1]);
        expect(h.core.latest?.id).toBe(2);
        h.core.handle({ type: 'stop', id: 2 });
        expect(h.core.latest).toBeNull();
        expect(h.core.runs.size).toBe(0);
    });
});

describe('an orb entry with the gate in a worker', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        resetPortalGateWorkerForTests();
    });

    it('hands the canvas over, posts where the gate is each frame and stops the run at the end', async () => {
        const posted = [];
        vi.stubGlobal('OffscreenCanvas', () => {});
        vi.stubGlobal('Worker', class {
            postMessage(message, transfer) { posted.push({ message, transfer }); }

            terminate() {}
        });
        let now = 0;
        let queue = [];
        const children = [];
        const offscreen = { offscreen: true };
        let pageContextAsked = false;
        const pageCanvas = {
            tagName: 'CANVAS',
            style: {},
            transferControlToOffscreen: () => offscreen,
            getContext: () => { pageContextAsked = true; return null; },
        };
        const element = (tag) => (tag === 'canvas' ? pageCanvas : {
            tagName: tag.toUpperCase(),
            style: {},
            children: [],
            setAttribute() {},
            appendChild(child) { this.children.push(child); return child; },
        });
        const body = { appendChild: (child) => { children.push(child); child.parentNode = body; }, removeChild: () => {} };
        const transition = new JourneyEntryTransition({
            documentRef: { body, createElement: element },
            windowRef: {
                innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2, addEventListener() {}, removeEventListener() {},
            },
            performanceRef: { now: () => now },
            requestAnimationFrameRef: (callback) => { queue.push(callback); return queue.length; },
            cancelAnimationFrameRef: () => {},
        });
        const done = transition.play({
            anchor: { x: 0.4, y: 0.4, radius: 0.1 },
            timings: {
                ignitionDelayMs: 10, blackoutStartMs: 20, blackoutFullMs: 40, revealDurationMs: 30, maxBlackoutHoldMs: 500,
            },
            callbacks: { onBlackoutReached: async () => true },
        });
        for (let i = 0; i < 60 && !transition.activeRun?.finishing; i += 1) {
            now += 16;
            const due = queue;
            const at = now;
            queue = [];
            due.forEach((callback) => callback(at));
            // eslint-disable-next-line no-await-in-loop
            await Promise.resolve();
        }
        await expect(done).resolves.toMatchObject({ success: true });

        const start = posted.find(({ message }) => message.type === 'start');
        expect(start.message).toMatchObject({ width: 1280, height: 720, dpr: 2 });
        expect(start.transfer).toEqual([offscreen]);
        const frames = posted.filter(({ message }) => message.type === 'frame');
        expect(frames.length).toBeGreaterThan(3);
        expect(frames.every(({ message }) => message.frame.direction === 1)).toBe(true);
        expect(frames.some(({ message }) => message.frame.region.kind === 'all')).toBe(true);
        // The page never draws the gate itself, nor sizes the canvas it handed over.
        expect(pageContextAsked).toBe(false);
        expect(pageCanvas.width).toBeUndefined();
        expect(posted.at(-1).message).toMatchObject({ type: 'stop', id: start.message.id });
    });
});
