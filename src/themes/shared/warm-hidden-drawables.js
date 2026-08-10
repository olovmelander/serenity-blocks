// @ts-check
/**
 * Reveal FX drawables parked at `visible = false` so the caller's very next real
 * render creates their GPU pipelines.
 *
 * three r181 anchors (pinned 0.181.2, read from node_modules/three/src):
 *   Renderer.js:2761  `_projectObject()` returns immediately on `visible === false`
 *   Renderer.js:2763  ...and then gates on `object.layers.test(camera.layers)`
 *   Renderer.js:895   `compileAsync()` builds its work list through that SAME traversal
 *
 * So a pooled FX mesh built at scene build but held invisible is skipped by
 * `compileAsync` AND by every warm render, and its pipeline is created by the
 * synchronous `device.createRenderPipeline()` inside the first GAMEPLAY frame
 * that reveals it. Dawn compiles in the GPU process, so the stall shows up as
 * BeginFrame starvation with no JS longtask and no `renderer.info.memory`
 * delta — exactly the signature measured in
 * docs/GAMEPLAY_SMOOTHNESS_INVESTIGATION_2026-08.md §10.
 *
 * This module only ever writes `visible`, `frustumCulled` and
 * `InstancedMesh.count`. None of the three is part of a render object's
 * identity — `RenderObject.getMaterialCacheKey()` skips `visible`
 * (RenderObject.js:691) — so revealing cannot change which pipeline the live
 * frame later asks for.
 *
 * IMPORTANT: a reveal must never be live across a bare
 * `renderer.compileAsync(scene, camera)` on an MRT theme. That call binds no
 * render target (Renderer.js:861), so it bakes a one-output shader under a
 * cache key that carries no target component, which then gets reused for the
 * two-attachment pass — the documented poisoned-cache black screen. Reveal only
 * across the theme's own shipped post render.
 */

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
    /** @type {Array<{o: any, visible: boolean, frustumCulled: boolean, count: number|null}>} */
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
        }
    };

    return { revealed, skipped, restore };
}

/**
 * Wait for submitted GPU work to complete.
 *
 * `device.createRenderPipeline()` returns to JS long before Dawn finishes
 * compiling — that asymmetry IS the measured signature. Without this fence the
 * stall merely relocates from the first line clear onto the first visible
 * frames. `queue.onSubmittedWorkDone()` is the only real GPU wait left in r181;
 * `renderAsync` / `waitForGPU` are deprecated no-ops.
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
