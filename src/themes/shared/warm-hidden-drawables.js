// @ts-check
/**
 * Reveal FX drawables parked at `visible = false` so the caller's very next real
 * render creates their GPU pipelines.
 *
 * three r185 anchors (pinned 0.185.1, read from node_modules/three/src):
 *   Renderer.js:3082  `_projectObject()` returns immediately on `visible === false`
 *   Renderer.js:3084  ...and then gates on `object.layers.test(camera.layers)`
 *   Renderer.js:966   `compileAsync()` builds its work list through that SAME traversal
 *   (r185 note: compileAsync now also updates matrices/camera and REALLY frustum-culls
 *   against the passed camera — callers must clear `frustumCulled` during a warm, as
 *   the Odyssey prewarm paths already do.)
 *
 * So a pooled FX mesh built at scene build but held invisible is skipped by
 * `compileAsync` AND by every warm render, and its pipeline is created by the
 * synchronous `device.createRenderPipeline()` inside the first GAMEPLAY frame
 * that reveals it. Dawn compiles in the GPU process, so the stall shows up as
 * BeginFrame starvation with no JS longtask and no `renderer.info.memory`
 * delta — exactly the signature measured in
 * docs/GAMEPLAY_SMOOTHNESS_INVESTIGATION_2026-08.md §10.
 *
 * This module only ever writes `visible`, `frustumCulled`,
 * `InstancedMesh.count` and `InstancedBufferGeometry.instanceCount`. None of the three is part of a render object's
 * identity — `RenderObject.getMaterialCacheKey()` skips `visible`
 * (RenderObject.js:738) — so revealing cannot change which pipeline the live
 * frame later asks for.
 *
 * IMPORTANT: a reveal must never be live across a bare
 * `renderer.compileAsync(scene, camera)` on an MRT theme. That call compiles
 * with no MRT bound (r185 targets the internal single-output framebuffer,
 * Renderer.js:909-911, and its deferred builds read live `getMRT()` = null),
 * so it bakes a one-output shader under a cache key that carries no target
 * component, which then gets reused for the two-attachment pass — the
 * documented poisoned-cache black screen. Reveal only across the theme's own
 * shipped post render.
 */

import { exemptBuildCount, withBuildBudgetExemptFor } from '../../rendering/async-render-pipelines.js';

/**
 * @param {any} object
 * @returns {boolean}
 */
function isDrawable(object) {
    return Boolean(object)
        && Boolean(object.material)
        && Boolean(object.isMesh || object.isInstancedMesh || object.isPoints
            || object.isLine || object.isSprite);
}

/**
 * Reveal every hidden drawable under `roots`.
 *
 * @param {any} roots one Object3D, or an array of them
 * @param {{camera?: any, limit?: number, onUnreachable?: (object: any, reason: string) => void}} [options]
 * @returns {{revealed: number, skipped: number, restore: () => void}}
 */
export function revealHiddenDrawables(roots, options = {}) {
    const { camera = null, limit = 128, onUnreachable = null } = options;
    const list = Array.isArray(roots) ? roots : [roots];
    /** @type {Array<{o: any, visible: boolean, frustumCulled: boolean, count: number|null, instanceCount: number|null}>} */
    const saved = [];
    const touched = new Set();
    let revealed = 0;
    let skipped = 0;

    const remember = (object) => {
        if (touched.has(object)) return;
        touched.add(object);
        saved.push({
            o: object,
            visible: object.visible,
            frustumCulled: object.frustumCulled,
            count: object.isInstancedMesh ? object.count : null,
            instanceCount: object.geometry?.isInstancedBufferGeometry ? object.geometry.instanceCount : null,
        });
    };

    // Declared outside the loop so the traversal closure is created once.
    const visitRoot = (root) => {
        root.traverse((object) => {
            if (revealed >= limit || !isDrawable(object)) return;

            // A warm the camera cannot see is a silent no-op. Report it rather
            // than quietly compiling nothing.
            if (camera && object.layers && !object.layers.test(camera.layers)) {
                skipped += 1;
                if (onUnreachable) onUnreachable(object, 'layers');
                return;
            }

            // `_projectObject` bails on the FIRST invisible ancestor, so
            // revealing the leaf alone is not enough — walk up to the declared
            // root, which also bounds the blast radius to that subtree.
            for (let node = object; node && node.isObject3D; node = node.parent) {
                remember(node);
                node.visible = true;
                if (node === root) break;
            }

            // `_frustum` / `_projScreenMatrix` are only refreshed inside
            // `_renderScene`, so a warm render culls against whatever the last
            // frame left behind.
            remember(object);
            object.frustumCulled = false;

            // A count-0 InstancedMesh yields `drawParams === null` and draws
            // nothing, so it would still not compile.
            if (object.isInstancedMesh && object.count === 0) object.count = 1;
            // Likewise a mesh on an InstancedBufferGeometry with no instances yet (Grainfields' beams).
            if (object.geometry?.isInstancedBufferGeometry && object.geometry.instanceCount === 0) {
                object.geometry.instanceCount = 1;
            }

            revealed += 1;
        });
    };

    for (const root of list) {
        if (!root || typeof root.traverse !== 'function') continue;
        visitRoot(root);
    }

    let restored = false;
    const restore = () => {
        if (restored) return;
        restored = true;
        for (let i = saved.length - 1; i >= 0; i -= 1) {
            const entry = saved[i];
            entry.o.visible = entry.visible;
            entry.o.frustumCulled = entry.frustumCulled;
            if (entry.count !== null) entry.o.count = entry.count;
            if (entry.instanceCount !== null) entry.o.geometry.instanceCount = entry.instanceCount;
        }
    };

    return { revealed, skipped, restore };
}

/**
 * Draw a theme's parked FX once through its own shipped render path, so the first gameplay
 * event that reveals them finds their pipelines built: black-hole's `warmEventPools()`, shared.
 * Call it at the end of a build, while the theme is still masked (a hidden prewarm or the
 * loading cover). The render goes through the theme's post stack, never a bare
 * `compileAsync`, so it is safe on MRT themes.
 *
 * With `settle` (the default) it draws once more after everything is put back, so the canvas
 * never holds the warm frame: a theme's first loop frame can land a vsync later, or be paced
 * out.
 *
 * @param {any} roots one Object3D, or an array of them (a theme's `getWarmupRoots()`)
 * @param {{camera?: any, render?: () => void, settle?: boolean}} [options]
 * @returns {number} drawables revealed for the warm frame
 */
export function warmParkedDrawables(roots, options = {}) {
    const { camera = null, render = null, settle = true } = options;
    const list = (Array.isArray(roots) ? roots : [roots]).filter(Boolean);
    if (!list.length || typeof render !== 'function') return 0;
    const reveal = revealHiddenDrawables(list, { camera });
    if (reveal.revealed === 0) {
        reveal.restore();
        return 0;
    }
    try {
        for (const root of list) root.updateMatrixWorld?.(true);
        render();
    } finally {
        reveal.restore();
    }
    if (settle) render();
    return reveal.revealed;
}

/**
 * warmParkedDrawables for a theme whose own build is still spreading its first builds over frames
 * (an in-play switch's hidden build: shared build budget, async-render-pipelines.js): every other
 * drawable in `scene` sits out the warm frame, so a warm with the budget off builds the parked
 * drawables and nothing else (warming Fall's squirrel inside its first frame built the whole
 * forest with it: a 250 ms task). Lights stay, so the parked materials build for the real lights.
 *
 * @param {any} scene the theme's scene
 * @param {any} roots one Object3D, or an array of them
 * @param {{camera?: any, render?: () => void, settle?: boolean}} [options]
 * @returns {number} drawables revealed for the warm frame
 */
export function warmParkedDrawablesAlone(scene, roots, options = {}) {
    const list = (Array.isArray(roots) ? roots : [roots]).filter(Boolean);
    if (!list.length) return 0;
    const own = new Set();
    for (const root of list) root.traverse?.((object) => own.add(object));
    const sidelined = [];
    scene?.traverse?.((object) => {
        if (own.has(object) || !isDrawable(object) || object.visible !== true) return;
        object.visible = false;
        sidelined.push(object);
    });
    try {
        return warmParkedDrawables(list, options);
    } finally {
        for (const object of sidelined) object.visible = true;
    }
}

/**
 * Warm a theme's parked drawables in a task of their own, just after its build: one frame through
 * the theme's shipped path with them drawn and every other drawable sitting it out
 * (warmParkedDrawablesAlone). In an in-play switch only the parked drawables are let past the build
 * budget (withBuildBudgetExemptFor), so the rest the frame meets (the post chain's passes) keeps to
 * the budget; in a task of its own, the warm never adds to the build's task. Effects parked out of
 * sight until play shows them otherwise compiled synchronously in the GPU process on their first
 * gameplay frame (37-109 ms in six themes; bench --trace-gpu, 2026-10-29).
 *
 * The parked drawables are only drawn once the frame's path reaches them: a post chain whose
 * composite the budget still defers never draws its scene pass. So in a switch the warm is tried
 * again, a frame apart, until one has built them (exemptBuildCount went up) and the next built
 * nothing more, or `tries` ran out. Without a budget session one frame builds everything.
 * Each warm render starts a node frame of its own (as three's compileAsync does): a post chain's
 * scene pass runs once per node frame, and a theme that drew its first frame inside its build had
 * spent that frame's pass, so its warm drew nothing and its effects still compiled mid-play.
 * Skipped if the theme rebuilt or let go of its renderer meanwhile.
 *
 * @param {{ renderer: any, scene: any, camera: any }} theme
 * @param {() => any[]} getRoots the parked roots, read when the warm runs
 * @param {() => void} render one frame through the theme's own path
 * @param {{settle?: boolean, tries?: number, gapMs?: number}} [options] settle: draw once more after
 *   each warm frame (warmParkedDrawables); tries and gapMs: how often and how far apart to try
 * @returns {Promise<number>} drawables revealed (0 when skipped)
 */
export function warmParkedSoon(theme, getRoots, render, { settle = true, tries = 30, gapMs = 16 } = {}) {
    const { renderer, scene, camera } = theme;
    return new Promise((resolve) => {
        let attempt = 0;
        let reached = false;
        let revealed = 0;
        const step = () => {
            if (!renderer || theme.renderer !== renderer || theme.scene !== scene || theme.camera !== camera) {
                resolve(revealed);
                return;
            }
            const roots = (getRoots() || []).filter(Boolean);
            const parked = new Set();
            for (const root of roots) root.traverse?.((object) => parked.add(object));
            const before = exemptBuildCount(renderer);
            const ownFrame = () => {
                renderer._nodes?.nodeFrame?.update?.(); // eslint-disable-line no-underscore-dangle
                render();
            };
            try {
                revealed = withBuildBudgetExemptFor(renderer, parked, () => warmParkedDrawablesAlone(scene, roots, {
                    camera,
                    render: ownFrame,
                    settle,
                }));
            } catch (error) {
                console.warn('[warm-hidden-drawables] warm frame failed:', error?.message || error);
                resolve(revealed);
                return;
            }
            const after = exemptBuildCount(renderer);
            attempt += 1;
            // No budget session: this one frame built what it drew. Nothing parked: nothing to wait for.
            if (before === null || after === null || revealed === 0) {
                resolve(revealed);
                return;
            }
            if (after > before) reached = true;
            else if (reached || attempt >= tries) {
                resolve(revealed);
                return;
            }
            setTimeout(step, gapMs);
        };
        setTimeout(step, 0);
    });
}

/**
 * Wait for submitted GPU work to complete.
 *
 * `device.createRenderPipeline()` returns to JS long before Dawn finishes
 * compiling — that asymmetry IS the measured signature. Without this fence the
 * stall merely relocates from the first line clear onto the first visible
 * frames. `queue.onSubmittedWorkDone()` is the only real GPU wait left (true on
 * r181 and r185 alike); `renderAsync` is a deprecated shim and `waitForGPU` is
 * removed-with-error in r185.
 *
 * Resolves false on timeout, on a WebGL backend, or on device loss — warming is
 * best-effort and must never be able to wedge activation.
 *
 * @param {any} renderer
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
export async function waitForSubmittedGpuWork(renderer, timeoutMs = 3000) {
    const queue = renderer?.backend?.device?.queue;
    if (typeof queue?.onSubmittedWorkDone !== 'function') return false;

    let timeoutId = null;
    try {
        return await Promise.race([
            Promise.resolve(queue.onSubmittedWorkDone()).then(() => true),
            new Promise((resolve) => {
                timeoutId = setTimeout(() => resolve(false), timeoutMs);
            }),
        ]);
    } catch (error) {
        return false;
    } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
    }
}
