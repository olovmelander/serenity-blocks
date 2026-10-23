/**
 * The portal gate drawn OFF the main thread (portal-gate.worker.js runs this).
 *
 * Why (Odyssey flow audit, 2026-10-23): the gate's passage is what the player watches while the
 * orb's theme builds, and that build is main-thread work the gate cannot shorten: measured on the
 * dev laptop, Geode's createScene held the main thread 151 ms and its first frame 119 ms, Stellar
 * Drift's 214 ms, Fall's 176 + 209 ms. Drawn by main-thread rAF, the passage froze for each of
 * them. On an OffscreenCanvas in a worker it keeps streaming: the page posts each frame's
 * description (where the gate is, how open, its rim and light), the worker owns the passage's own
 * clock and travel, and when the page goes quiet for longer than GATE_WORKER_STALL_MS it keeps
 * drawing the last description on its own frames, in real time.
 *
 * Messages in: { type: 'start', id, canvas, qualityPreset, palette, flash, width, height, dpr }
 * (the canvas transferred), { type: 'frame', id, frame }, { type: 'resize', id, width, height,
 * dpr }, { type: 'stop', id }, { type: 'warm', qualityPreset } (bakes the sprites early).
 */
import { advancePortalTravel, createPortalGate, drawPortalGate } from './portal-gate.js';

/** No frame from the page for this long (about a frame and a half at 60 Hz): it is busy. */
export const GATE_WORKER_STALL_MS = 24;

/**
 * @param {object} host
 * @param {() => number} host.now  the worker's clock (ms)
 * @param {(callback: () => void) => unknown} host.requestFrame  the worker's frame callback
 * @param {() => object} host.makeCanvas  a fresh 2D-capable canvas (an OffscreenCanvas in the worker)
 */
export function createPortalGateWorkerCore({ now, requestFrame, makeCanvas }) {
    // portal-gate.js makes its sprites through document.createElement('canvas').
    const documentShim = { createElement: () => makeCanvas() };
    const runs = new Map();
    let latest = null;
    let looping = false;

    const sizeCanvas = (run) => {
        run.canvas.width = Math.max(1, Math.floor(run.width * run.dpr));
        run.canvas.height = Math.max(1, Math.floor(run.height * run.dpr));
    };

    const draw = (run, at) => {
        if (!run.frame || !run.ctx) return;
        // The passage's clock is the worker's: real time, unbroken by the page's stalls.
        run.time += Math.max(0, Math.min(100, at - run.lastDrawAt)) / 1000;
        run.lastDrawAt = at;
        const travel = advancePortalTravel(run.travelState, at, run.frame.speed ?? 1);
        run.ctx.setTransform(1, 0, 0, 1, 0, 0);
        run.ctx.clearRect(0, 0, run.canvas.width, run.canvas.height);
        drawPortalGate(run.ctx, run.gate, {
            ...run.frame,
            width: run.width,
            height: run.height,
            dpr: run.dpr,
            travel,
            time: run.time,
        });
    };

    const loop = () => {
        looping = false;
        const run = latest;
        if (!run) return;
        const at = now();
        if (at - run.lastPostAt > GATE_WORKER_STALL_MS) draw(run, at);
        looping = true;
        requestFrame(loop);
    };

    const release = (run) => {
        // Give the full-screen backing back now, not at a later GC inside the next hold.
        run.canvas.width = 1;
        run.canvas.height = 1;
        runs.delete(run.id);
        if (latest === run) latest = null;
    };

    const handle = (message = {}) => {
        if (message.type === 'warm') {
            createPortalGate({ qualityPreset: message.qualityPreset, documentRef: documentShim });
            return;
        }
        if (message.type === 'start') {
            let ctx = null;
            try {
                ctx = message.canvas?.getContext?.('2d') || null;
            } catch {
                ctx = null;
            }
            const at = now();
            const run = {
                id: message.id,
                canvas: message.canvas,
                ctx,
                gate: createPortalGate({
                    qualityPreset: message.qualityPreset, palette: message.palette, documentRef: documentShim,
                }),
                width: message.width || 1,
                height: message.height || 1,
                dpr: message.dpr || 1,
                flash: message.flash ?? 1,
                frame: null,
                time: 0,
                lastDrawAt: at,
                lastPostAt: at,
                travelState: { travel: 0, lastTravelAt: null },
            };
            if (run.canvas) sizeCanvas(run);
            runs.set(run.id, run);
            latest = run;
            if (!looping) {
                looping = true;
                requestFrame(loop);
            }
            return;
        }
        const run = runs.get(message.id);
        if (!run) return;
        if (message.type === 'frame') {
            run.frame = message.frame || null;
            run.lastPostAt = now();
            draw(run, run.lastPostAt);
        } else if (message.type === 'resize') {
            run.width = message.width || run.width;
            run.height = message.height || run.height;
            run.dpr = message.dpr || run.dpr;
            sizeCanvas(run);
            draw(run, now());
        } else if (message.type === 'stop') {
            release(run);
        }
    };

    return { handle, runs, get latest() { return latest; } };
}
