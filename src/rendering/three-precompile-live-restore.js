// @ts-check
/**
 * Keep three r187's compileAsync drain from rebinding the target a caller has already let go of.
 *
 * WHY: r187's compileAsync queues one work item per object, then drains the queue AFTER it has
 * returned control, between the caller's frames (Renderer.compileAsync). Each item runs between
 * `_beginPreCompile(item.precompilationState)`, which binds the render target and MRT the item was
 * queued under, and `_finishPreCompile()`, which binds `outputRenderTarget` / `outputMRT`: the
 * target and MRT that were bound when compileAsync was CALLED, not the ones bound when the item
 * began. A caller that binds a target for the synchronous launch only and puts its own back at once
 * (Spring's impostor atlas, Odyssey's compile under the live loop) gets the launch target bound
 * again after every drained item, so its next frame draws into the atlas or into the post scene
 * pass's target (sampled and written at once: the 2026-08-12 device loss).
 *
 * WHAT: `_finishPreCompile` puts back the target (with its cube face and mip level) and the MRT
 * that were bound when the matching `_beginPreCompile` ran. For a caller that keeps its binding
 * across the await (upstream's own PassNode.compileAsync) that is what three restores anyway.
 * `_finishPreCompile` also runs before each of the drain's yields and `_beginPreCompile` after it,
 * so the state is saved again after every yield.
 *
 * r186 has neither method (its drain read the live target instead): nothing is patched there.
 * Pinned by tests/unit/three-precompile-live-restore.test.js against the installed source.
 */

const PATCHED = Symbol.for('serenity.precompileLiveRestore');
/** precompilationState → the binding that was live when it began. */
const liveByState = new WeakMap();

/**
 * The prototype that defines three's precompile hooks for `renderer`, or null (r186, a double).
 * @param {any} renderer
 * @returns {any}
 */
function hookOwner(renderer) {
    let proto = renderer ? Object.getPrototypeOf(renderer) : null;
    while (proto && !Object.prototype.hasOwnProperty.call(proto, '_finishPreCompile')) {
        proto = Object.getPrototypeOf(proto);
    }
    return proto;
}

/**
 * Patch the Renderer prototype `renderer` comes from, once (every renderer of it is covered).
 * @param {any} renderer
 * @returns {boolean} whether the drain restores the live binding (false on r186: no hooks)
 */
export function ensurePrecompileRestoresLiveState(renderer) {
    const proto = hookOwner(renderer);
    if (!proto) return false;
    if (proto[PATCHED]) return true;
    const begin = proto._beginPreCompile;
    const finish = proto._finishPreCompile;
    if (typeof begin !== 'function' || typeof finish !== 'function') return false;
    proto._beginPreCompile = function serenityBeginPreCompile(state, ...rest) {
        const live = {
            renderTarget: this._renderTarget,
            activeCubeFace: this._activeCubeFace,
            activeMipmapLevel: this._activeMipmapLevel,
            mrt: this._mrt,
        };
        const result = begin.call(this, state, ...rest);
        if (state && typeof state === 'object') liveByState.set(state, live);
        return result;
    };
    proto._finishPreCompile = function serenityFinishPreCompile(...args) {
        const state = this._precompilationState;
        const live = state ? liveByState.get(state) : undefined;
        const result = finish.apply(this, args);
        if (live) {
            liveByState.delete(state);
            if (this._renderTarget !== live.renderTarget
                || this._activeCubeFace !== live.activeCubeFace
                || this._activeMipmapLevel !== live.activeMipmapLevel) {
                this.setRenderTarget(live.renderTarget, live.activeCubeFace, live.activeMipmapLevel);
            }
            if (this._mrt !== live.mrt) this.setMRT(live.mrt);
        }
        return result;
    };
    proto[PATCHED] = { begin, finish };
    return true;
}

/**
 * Undo the patch (tests only).
 * @param {any} renderer
 */
export function resetPrecompileLiveRestoreForTests(renderer) {
    const proto = hookOwner(renderer);
    const saved = proto?.[PATCHED];
    if (!saved) return;
    proto._beginPreCompile = saved.begin;
    proto._finishPreCompile = saved.finish;
    delete proto[PATCHED];
}
