/**
 * @fileoverview Names the render passes that three's GPU timestamp pool measures.
 *
 * WHY THIS EXISTS. three 0.185.1 retains a resolved GPU duration per render-pass uid
 * (`WebGPUTimestampQueryPool` does `timestamps.set(uid, duration)`), which is what lets the
 * Odyssey board publish a per-pass split without an A/B differential. But the uid is
 * `r:<frameCalls>:<RenderContext.id>:f<frame>` (`renderers/common/Backend.js` composes
 * `prefix + ':' + abstractRenderContext.id + ':f' + frame`, with `prefix` itself being
 * `'r:' + info.render.frameCalls`), and NEITHER half before `:f` identifies a pass:
 *
 *   - `frameCalls` is the render call's ORDINAL within the frame. It renumbers whenever the
 *     number of calls ahead of a pass changes — which the Odyssey post pipeline does routinely,
 *     when the bloom node detaches or the RCAS wrapper attaches under DRS.
 *   - `RenderContext.id` is a CACHE BUCKET keyed by `<attachmentState>-<mrt>-<callDepth>`
 *     (`renderers/common/RenderContexts.js`). Every bloom target is created with the same
 *     `{ depthBuffer: false, type: HalfFloatType }`, so all eight share ONE id; and the RCAS
 *     RTT lands in the SCENE pass's bucket whenever `sceneSamples` is 0.
 *
 * So an id-keyed reading of the split silently merges unrelated passes, and an ordinal-keyed one
 * drifts mid-run. The renderer hands out the missing identity on a public hook: it calls
 * `inspector.beginRender(uid, scene, camera, renderTarget)` two lines after building the uid.
 * The render TARGET is the pass. This module wraps that hook.
 *
 * Kept out of OdysseyBoardController so the board does not gain a second class (airbnb's
 * `max-classes-per-file`), and so the naming rules can be unit-tested without a renderer.
 */

import * as THREE from 'three/webgpu';

/**
 * A stable name for the render target a pass writes to. Resolution order is cheapest and most
 * certain first; every rule after the second can in principle be fooled by a format collision,
 * which is why the scene pass — the one worth being certain about — is matched by object
 * identity rather than by name.
 *
 * @param {?object} renderTarget - the pass's target; null for the canvas.
 * @param {?object} scene - the `scene` argument three passed; for a full-screen pass this IS
 *   the QuadMesh, which is where RTTNode's generated name lives.
 * @param {?object} scenePassTarget - the pipeline's PassNode render target, when known.
 * @returns {string}
 */
export function passLabelFor(renderTarget, scene, scenePassTarget) {
    // RenderPipeline renders its composite quad with a null target: it forces NoToneMapping and
    // the working colour space first, so three's `needsFrameBufferTarget` is false.
    if (!renderTarget) return 'canvas';
    if (scenePassTarget && renderTarget === scenePassTarget) return 'scene';

    const texName = renderTarget.texture?.name || '';
    // three's own names: 'UnrealBloomPass.bright' / '.h<i>' / '.v<i>'.
    if (texName.startsWith('UnrealBloomPass.')) return `bloom.${texName.slice(16)}`;
    if (texName === 'SharpenNode.output') return 'sharpen.rcas';
    if (texName && texName !== 'output') return texName;

    const quadName = scene?.isQuadMesh === true ? (scene.name || '') : '';
    if (quadName) return quadName.includes('RTT') ? 'sharpen.rtt' : quadName;

    // 'output' is PassNode's default texture name — a PassNode we did not build.
    if (texName === 'output') return 'pass.output';

    // Last resort. Never good; still better than an ordinal, because it at least describes
    // something intrinsic to the target rather than its position in the call order.
    return `rt:${renderTarget.width}x${renderTarget.height}`
        + `:t${renderTarget.texture?.type ?? '?'}`
        + `:${renderTarget.depthBuffer ? 'd' : '-'}:s${renderTarget.samples ?? 0}`;
}

/**
 * Build an inspector that reports `(uid, scene, renderTarget)` for every render call.
 *
 * Returns null when the installed three does not export `InspectorBase`, so a future removal
 * degrades the instrument to its raw-uid behaviour instead of throwing.
 *
 * NOTE the slot has a single owner: assigning `renderer.inspector` replaces three's default
 * InspectorBase. The playground claims it too under `?inspector=1`, but that is a different
 * entry point, and this install is gated behind `?odysseyGpuProfile=1`.
 *
 * Do NOT be tempted to use the inspector's `begin()`/`finish()` for frame boundaries: three
 * fires those around its own animation-loop callback, which is null when the board drives its
 * own requestAnimationFrame. Derive the frame from the uid instead.
 *
 * @param {(uid: string, scene: object, renderTarget: object) => void} onBeginRender
 * @returns {?object} an InspectorBase instance, or null when unsupported.
 */
export function createPassLabelInspector(onBeginRender) {
    if (typeof THREE.InspectorBase !== 'function') return null;
    if (typeof onBeginRender !== 'function') return null;

    class OdysseyPassLabelInspector extends THREE.InspectorBase {
        beginRender(uid, scene, _camera, renderTarget) {
            onBeginRender(uid, scene, renderTarget);
        }
    }

    return new OdysseyPassLabelInspector();
}
