/**
 * The Odyssey portal gate (src/rendering/transitions/portal-gate.js) and the promises the two
 * journeys make with it: the passage's look, what each kind of frame draws, readiness only once
 * the gate covers the frame, a clock that a dropped frame slows instead of skipping, the gate
 * following the orb while it is on it, and the once-per-page warm-up.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    GATE_MAX_FRAME_STEP_MS, PORTAL_GATE_COUNTS, bakeNebulaRing, canDrawPortalGate, createPortalGate,
    deepen, drawPortalGate, parseColor, portalReach, scheduleWarmPortalGate, warmPortalGate,
} from '../../src/rendering/transitions/portal-gate.js';
import { ENTRY_GATE_COVERED_AT, JourneyEntryTransition } from '../../src/rendering/transitions/JourneyEntryTransition.js';
import { JourneyReturnTransition, RETURN_GATE_SHUT_AT } from '../../src/rendering/transitions/JourneyReturnTransition.js';

/** A 2D context that records what is drawn (enough of the API for the gate and its sprites). */
function recordingContext() {
    const calls = [];
    const ctx = {
        calls,
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        fillStyle: '#000',
        strokeStyle: '#000',
        lineWidth: 1,
        lineCap: 'butt',
        createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
    };
    ['beginPath', 'arc', 'stroke', 'fill', 'rect', 'clip', 'save', 'restore', 'setTransform', 'clearRect',
        'putImageData', 'getImageData', 'fillRect'].forEach((name) => {
        ctx[name] = (...args) => calls.push({
            name, args, alpha: ctx.globalAlpha, op: ctx.globalCompositeOperation,
        });
    });
    ctx.drawImage = (image, ...args) => calls.push({
        name: 'drawImage', image, args, alpha: ctx.globalAlpha, op: ctx.globalCompositeOperation,
    });
    return ctx;
}

/** An element that holds children (the body, a transition's root). */
function container() {
    return {
        children: [],
        style: {},
        attributes: new Map(),
        appendChild(child) {
            this.children.push(child);
            child.parentNode = this;
            return child;
        },
        removeChild(child) {
            const i = this.children.indexOf(child);
            if (i >= 0) this.children.splice(i, 1);
            child.parentNode = null;
            return child;
        },
        setAttribute(name, value) {
            this.attributes.set(name, String(value));
        },
        getAttribute(name) {
            return this.attributes.get(name) ?? null;
        },
    };
}

/** A document whose canvases have recording contexts (so the gate builds its sprites). */
function recordingDocument() {
    const body = container();
    return {
        body,
        createElement: (tag) => {
            if (tag !== 'canvas') return container();
            const ctx = recordingContext();
            return {
                width: 0,
                height: 0,
                style: {},
                ctx,
                getContext: () => ctx,
                setAttribute: () => {},
                remove() {
                    this.parentNode?.removeChild(this);
                },
            };
        },
    };
}

const PALE = {
    primary: '#8cf4ff', accent: '#a8f7ff', highlight: '#cffaff', shadow: '#2b4951',
};
const frame = (extra = {}) => ({
    width: 1600, height: 900, dpr: 1, travel: 1.3, time: 0.5, center: { x: 800, y: 450 }, ...extra,
});

describe('the portal gate', () => {
    it('scales its layers, streaks and motes with the quality preset', () => {
        const random = () => 0.5;
        const minimal = createPortalGate({ qualityPreset: 'Minimal', random, documentRef: null });
        const extreme = createPortalGate({ qualityPreset: 'Extreme', random, documentRef: null });
        expect(minimal.layers).toHaveLength(PORTAL_GATE_COUNTS.Minimal.layers);
        expect(extreme.streaks).toHaveLength(PORTAL_GATE_COUNTS.Extreme.streaks);
        expect(extreme.layers.length).toBeGreaterThan(minimal.layers.length);
        expect(extreme.motes.length).toBeGreaterThan(minimal.motes.length);
        // Without a canvas to draw sprites on, it still lays itself out and draws nothing.
        expect(minimal.sprites).toBeNull();
    });

    it('takes the clouds\' hues from the palette at a deep, saturated value', () => {
        // A pale UI cyan (lightness ~0.9) becomes a deep cyan, keeping its hue.
        const [r, g, b] = parseColor(deepen('#cffaff', 0.36, 0.72));
        expect(Math.max(r, g, b)).toBeLessThan(200);
        expect(b).toBeGreaterThan(r * 3);
        expect(g).toBeGreaterThan(r * 3);
        // A grey stays grey, at the asked lightness.
        expect(deepen('#808080', 0.3)).toBe('rgb(77, 77, 77)');
        expect(parseColor('#fa0')).toEqual([255, 170, 0]);
        expect(parseColor('rgba(8, 14, 24, 0.96)')).toEqual([8, 14, 24]);
        expect(parseColor(null)).toEqual([255, 255, 255]);
    });

    it('bakes a nebula ring: empty at the light ahead and the corners, clouded between, the same every time', () => {
        const size = 64;
        const data = bakeNebulaRing(size);
        const alpha = (x, y) => data[(y * size + x) * 4 + 3];
        expect(alpha(32, 32)).toBe(0);
        expect(alpha(0, 0)).toBe(0);
        let ring = 0;
        for (let x = 0; x < size; x++) ring += alpha(x, 16);
        expect(ring).toBeGreaterThan(0);
        expect(bakeNebulaRing(size)).toEqual(data);
    });

    it('skips contexts that cannot draw it', () => {
        expect(canDrawPortalGate(null)).toBe(false);
        expect(canDrawPortalGate({ beginPath() {}, arc() {} })).toBe(false);
        expect(drawPortalGate({ beginPath() {} }, createPortalGate({ documentRef: null }), frame())).toBe(false);
    });

    it('draws the passage additively inside an opening gate, the world darkening round it, and restores the context', () => {
        const doc = recordingDocument();
        const gate = createPortalGate({ palette: PALE, documentRef: doc, random: () => 0.4 });
        expect(gate.sprites).not.toBeNull();
        const ctx = recordingContext();
        expect(drawPortalGate(ctx, gate, frame({
            region: {
                kind: 'disc', x: 700, y: 400, r: 300,
            },
            dim: 0.6,
            rim: 1,
        }))).toBe(true);
        // The world outside the gate darkens (an even-odd fill round it) ...
        expect(ctx.calls.some((c) => c.name === 'fill' && c.args[0] === 'evenodd')).toBe(true);
        // ... the passage is clipped to the gate's circle ...
        const clip = ctx.calls.findIndex((c) => c.name === 'clip');
        expect(clip).toBeGreaterThan(-1);
        expect(ctx.calls.slice(0, clip).filter((c) => c.name === 'arc').at(-1).args.slice(0, 3)).toEqual([700, 400, 300]);
        // ... and its clouds and streaks are light added onto it.
        const sprites = ctx.calls.filter((c) => c.name === 'drawImage');
        expect(sprites.length).toBeGreaterThan(10);
        expect(sprites.every((c) => c.op === 'lighter')).toBe(true);
        // A crisp rim strokes the gate's edge.
        expect(ctx.calls.some((c) => c.name === 'stroke')).toBe(true);
        expect(ctx.globalCompositeOperation).toBe('source-over');
        expect(ctx.globalAlpha).toBe(1);
        expect(ctx.calls.filter((c) => c.name === 'save').length).toBe(ctx.calls.filter((c) => c.name === 'restore').length);
    });

    it('opens onto the scene through a hole (even-odd clip) and draws nothing once the hole passes the frame', () => {
        const doc = recordingDocument();
        const gate = createPortalGate({ palette: PALE, documentRef: doc });
        const ctx = recordingContext();
        drawPortalGate(ctx, gate, frame({
            region: {
                kind: 'hole', x: 800, y: 450, r: 200,
            },
            rim: 1,
        }));
        expect(ctx.calls.some((c) => c.name === 'clip' && c.args[0] === 'evenodd')).toBe(true);
        const wide = recordingContext();
        drawPortalGate(wide, gate, frame({
            region: {
                kind: 'hole', x: 800, y: 450, r: portalReach(1600, 900, 800, 450) + 5,
            },
        }));
        expect(wide.calls.some((c) => c.name === 'drawImage')).toBe(false);
    });

    it('keeps the arrival\'s light to what Reduce flashing allows', () => {
        const doc = recordingDocument();
        const gate = createPortalGate({ palette: PALE, documentRef: doc });
        const glow = (flash) => {
            const ctx = recordingContext();
            drawPortalGate(ctx, gate, frame({
                region: { kind: 'all' }, intensity: 0, bloom: 1, flash,
            }));
            return Math.max(...ctx.calls.filter((c) => c.name === 'drawImage' && c.image === gate.sprites.glowHot).map((c) => c.alpha));
        };
        expect(glow(1)).toBeCloseTo(0.5);
        expect(glow(0.08)).toBeCloseTo(0.04);
    });

    it('gathers light on the orb before it opens', () => {
        const doc = recordingDocument();
        const gate = createPortalGate({ palette: PALE, documentRef: doc });
        const ctx = recordingContext();
        drawPortalGate(ctx, gate, frame({
            region: {
                kind: 'disc', x: 600, y: 300, r: 0,
            },
            gather: {
                x: 600, y: 300, r: 60, t: 0.6,
            },
        }));
        // No passage yet (the gate has no size), but motes and a closing ring round the orb.
        expect(ctx.calls.some((c) => c.name === 'clip')).toBe(false);
        expect(ctx.calls.filter((c) => c.name === 'drawImage').length).toBeGreaterThan(4);
        const ring = ctx.calls.filter((c) => c.name === 'arc' && c.args[0] === 600 && c.args[1] === 300);
        expect(ring.length).toBeGreaterThan(0);
        expect(ring[0].args[2]).toBeGreaterThan(60);
    });

    it('warms once, on the page and unseen, then leaves no trace', () => {
        const doc = recordingDocument();
        const frames = [];
        const raf = (step) => frames.push(step);
        expect(warmPortalGate({ documentRef: doc, requestAnimationFrameRef: raf })).toBe(true);
        expect(doc.body.children).toHaveLength(1);
        const [canvas] = doc.body.children;
        expect(canvas.style.cssText).toContain('opacity: 0.01');
        expect(canvas.style.cssText).toContain('pointer-events: none');
        for (let i = 0; i < 6 && frames.length; i++) frames.shift()();
        expect(canvas.ctx.calls.filter((c) => c.name === 'drawImage').length).toBeGreaterThan(10);
        expect(doc.body.children).toHaveLength(0);
        expect([canvas.width, canvas.height]).toEqual([0, 0]);
        expect(warmPortalGate({ documentRef: recordingDocument(), requestAnimationFrameRef: raf })).toBe(false);
    });

    it('schedules its warm-up for an idle moment, falls back to a timer, and never throws', () => {
        const idle = vi.fn();
        scheduleWarmPortalGate({ requestIdleCallback: idle, settings: { effectQuality: 'Low' } });
        expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 4000 });
        expect(() => idle.mock.calls[0][0]()).not.toThrow();
        const timer = vi.fn();
        scheduleWarmPortalGate({ setTimeout: timer });
        expect(timer).toHaveBeenCalledWith(expect.any(Function), 1500);
        expect(() => scheduleWarmPortalGate(null)).not.toThrow();
    });
});

describe('the journeys through the gate', () => {
    afterEach(() => vi.restoreAllMocks());

    const env = () => {
        let now = 0;
        const queue = [];
        return {
            performanceRef: { now: () => now },
            requestAnimationFrameRef: (cb) => queue.push(cb),
            cancelAnimationFrameRef: () => {},
            documentRef: recordingDocument(),
            windowRef: {
                innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {},
            },
            step(ms) {
                now += ms;
                queue.splice(0).forEach((cb) => cb(now));
            },
        };
    };

    it('starts preparing only once the opening gate covers the whole frame, centred', () => {
        const harness = env();
        const transition = new JourneyEntryTransition(harness);
        const reached = vi.fn(() => new Promise(() => {}));
        transition.play({
            anchor: {
                x: 0.2, y: 0.25, radius: 0.06, onScreen: true,
            },
            palette: PALE,
            callbacks: { onBlackoutReached: reached },
        });
        const run = transition.activeRun;
        let covered = null;
        for (let i = 0; i < 120 && !run.readyTriggered; i++) {
            harness.step(16);
            if (!run.readyTriggered) {
                const gate = transition.describeGate(run, { ...transition.frameAt(run) }, 0);
                if (gate.region.kind === 'disc') covered = gate.region;
            }
        }
        expect(run.readyTriggered).toBe(true);
        // The last frame before readiness: the gate already reaches past every corner, from the middle.
        expect(covered.r).toBeGreaterThanOrEqual(portalReach(1600, 900, covered.x, covered.y) * 0.97);
        expect(Math.abs(covered.x - 800)).toBeLessThan(8);
        expect(Math.abs(covered.y - 450)).toBeLessThan(8);
        expect(ENTRY_GATE_COVERED_AT).toBeLessThan(1);
    });

    it('slows rather than skips its opening when frames are dropped', () => {
        const harness = env();
        const transition = new JourneyEntryTransition(harness);
        transition.play({ palette: PALE, callbacks: { onBlackoutReached: () => new Promise(() => {}) } });
        const run = transition.activeRun;
        harness.step(16);
        const before = run.clock.t;
        harness.step(400); // one long frame: the main thread was busy
        expect(run.clock.t - before).toBeLessThanOrEqual(GATE_MAX_FRAME_STEP_MS);
        expect(run.readyTriggered).toBe(false);
    });

    it('follows the orb while the gate is on it, keeps the last place for a hidden read, and drops a failing reader', () => {
        const harness = env();
        const transition = new JourneyEntryTransition(harness);
        let place = {
            x: 0.3, y: 0.4, radius: 0.05, onScreen: true,
        };
        transition.play({
            anchor: place,
            trackAnchor: () => place,
            palette: PALE,
            callbacks: { onBlackoutReached: () => new Promise(() => {}) },
        });
        const run = transition.activeRun;
        harness.step(16);
        place = {
            x: 0.35, y: 0.42, radius: 0.08, onScreen: true,
        };
        harness.step(16);
        expect(run.anchor).toMatchObject({ x: 0.35, y: 0.42, radius: 0.08 });
        place = {
            x: 0.9, y: 0.9, radius: 0.08, onScreen: false,
        };
        harness.step(16);
        expect(run.anchor.x).toBe(0.35);
        run.trackAnchor = () => { throw new Error('camera gone'); };
        harness.step(16);
        expect(run.trackAnchor).toBeNull();

        // An orb off screen at the click has nowhere to gather: its gate stays centred.
        const offScreen = new JourneyEntryTransition(env());
        offScreen.play({
            anchor: {
                x: 0.9, y: 0.9, radius: 0.05, onScreen: false,
            },
            trackAnchor: () => place,
            palette: PALE,
            callbacks: { onBlackoutReached: () => new Promise(() => {}) },
        });
        expect(offScreen.activeRun.trackAnchor).toBeNull();
    });

    it('coming back out, shuts the board\'s gate before the world prepares and opens the world at the finished orb', async () => {
        const harness = env();
        const transition = new JourneyReturnTransition(harness);
        let release;
        transition.play({
            departureAnchor: {
                x: 0.5, y: 0.5, radius: 0.2, onScreen: true,
            },
            palette: PALE,
            callbacks: {
                onBlackoutReached: () => new Promise((resolve) => { release = resolve; }),
            },
        });
        const run = transition.activeRun;
        // Halfway through its closing the board still shows through a gate at its middle.
        const half = transition.describeGate(run, { clock: 0, closing: RETURN_GATE_SHUT_AT * 0.5 }, 0);
        expect(half.region).toMatchObject({ kind: 'hole', x: 800, y: 450 });
        expect(half.region.r).toBeGreaterThan(100);
        for (let i = 0; i < 120 && !run.readyTriggered; i++) harness.step(16);
        expect(run.readyTriggered).toBe(true);
        // At the moment readiness fires the board's gate has shut.
        const shut = transition.describeGate(run, {
            clock: run.clock.t, closing: RETURN_GATE_SHUT_AT * 0.96,
        }, 0);
        expect(run.readyTriggered && shut.region.kind).toBe('all');
        run.readyTriggered = false;
        expect(transition.describeGate(run, {
            clock: run.clock.t, closing: RETURN_GATE_SHUT_AT * 0.96,
        }, 0).region.r).toBeLessThan(1);
        run.readyTriggered = true;
        await Promise.resolve();
        await Promise.resolve();
        release({
            arrivalAnchor: {
                x: 0.7, y: 0.3, radius: 0.05, onScreen: true,
            },
        });
        await Promise.resolve();
        await Promise.resolve();
        harness.step(16);
        harness.step(16);
        const arriving = transition.describeGate(run, { clock: run.clock.t }, 0.05);
        expect(arriving.region.kind).toBe('hole');
        expect(arriving.region.x).toBeCloseTo(0.7 * 1600);
        expect(arriving.region.y).toBeCloseTo(0.3 * 900);
    });
});
