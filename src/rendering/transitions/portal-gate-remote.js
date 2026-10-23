/**
 * The page's side of the off-thread portal gate (portal-gate-worker-core.js has the why): one
 * module Worker per page, started early by warmPortalGateWorker() and shared by every entry and
 * return. A run hands its canvas to the worker with transferControlToOffscreen() and then posts
 * the gate's description each frame. Without a Worker, an OffscreenCanvas or the transfer (tests,
 * older engines, `?portalGateWorker=0`), or once the worker has failed, start returns null and
 * the transitions draw on the page as before.
 */

let worker = null;
let broken = false;
let nextRunId = 0;

function optedOut(windowRef = globalThis.window) {
    try {
        const raw = new URLSearchParams(windowRef?.location?.search || '').get('portalGateWorker');
        return raw === '0' || raw === 'false' || raw === 'off';
    } catch {
        return false;
    }
}

function supported(windowRef) {
    return !broken
        && typeof globalThis.Worker === 'function'
        && typeof globalThis.OffscreenCanvas === 'function'
        && !optedOut(windowRef);
}

function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./portal-gate.worker.js', import.meta.url), { type: 'module' });
    worker.onerror = (event) => {
        // From now on the gate draws on the page; a run already handed over keeps its timing.
        broken = true;
        console.warn('[PortalGate] off-thread gate failed; drawing on the page:', event?.message || event);
        try { worker?.terminate(); } catch { /* already gone */ }
        worker = null;
    };
    return worker;
}

/**
 * Start the worker and bake its sprites before the first portal (the map is up and idle).
 * @param {string} [qualityPreset]
 * @returns {boolean} whether the worker is (now) running
 */
export function warmPortalGateWorker(qualityPreset = 'High', windowRef = globalThis.window) {
    if (!supported(windowRef)) return false;
    try {
        ensureWorker().postMessage({ type: 'warm', qualityPreset });
        return true;
    } catch (error) {
        broken = true;
        console.warn('[PortalGate] off-thread gate unavailable:', error?.message || error);
        return false;
    }
}

/**
 * Warm the worker when the page is next idle, as the page's own gate warm does
 * (scheduleWarmPortalGate). Started at once it cost the map ~100-190 ms of load (its module
 * load and a new 2D raster context on the GPU process beside the board's build, measured).
 * Never throws.
 * @param {string} [qualityPreset]
 */
export function scheduleWarmPortalGateWorker(qualityPreset = 'High', windowRef = globalThis.window) {
    if (!supported(windowRef)) return;
    const warm = () => { warmPortalGateWorker(qualityPreset, windowRef); };
    if (typeof windowRef?.requestIdleCallback === 'function') windowRef.requestIdleCallback(warm, { timeout: 4000 });
    else windowRef?.setTimeout?.(warm, 1500);
}

/**
 * Hand a gate's canvas to the worker. After this the canvas belongs to the worker: the page must
 * not size it or ask it for a context.
 * @param {HTMLCanvasElement} canvas
 * @param {{qualityPreset?: string, palette?: object, flash?: number, width: number,
 *   height: number, dpr: number}} options
 * @returns {{draw: (frame: object) => void, resize: (width: number, height: number,
 *   dpr: number) => void, stop: () => void}|null} null: draw on the page instead
 */
export function startPortalGateOffThread(canvas, options = {}, windowRef = globalThis.window) {
    if (!supported(windowRef) || typeof canvas?.transferControlToOffscreen !== 'function') return null;
    let offscreen;
    try {
        ensureWorker();
        offscreen = canvas.transferControlToOffscreen();
    } catch (error) {
        console.warn('[PortalGate] could not hand the gate to its worker:', error?.message || error);
        return null;
    }
    nextRunId += 1;
    const id = nextRunId;
    const post = (message, transfer) => {
        try {
            worker?.postMessage(message, transfer);
        } catch (error) {
            console.warn('[PortalGate] gate message failed:', error?.message || error);
        }
    };
    post({
        type: 'start',
        id,
        canvas: offscreen,
        qualityPreset: options.qualityPreset || 'High',
        palette: options.palette || {},
        flash: options.flash ?? 1,
        width: options.width || 1,
        height: options.height || 1,
        dpr: options.dpr || 1,
    }, [offscreen]);
    return {
        draw: (frame) => post({ type: 'frame', id, frame }),
        resize: (width, height, dpr) => post({
            type: 'resize', id, width, height, dpr,
        }),
        stop: () => post({ type: 'stop', id }),
    };
}

/** Test seam: forget the worker and the failure latch. */
export function resetPortalGateWorkerForTests() {
    try { worker?.terminate(); } catch { /* already gone */ }
    worker = null;
    broken = false;
    nextRunId = 0;
}
