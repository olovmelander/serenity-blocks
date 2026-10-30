// @ts-check
/**
 * Keep three r187's compileAsync drain from rebinding the target a caller has already let go of.
 *
 * WHY: r187's compileAsync queues one work item per object and drains the queue between the
 * caller's frames (Renderer.compileAsync). Each item runs between
 * `_beginPreCompile(item.precompilationState)`, which binds the render target and MRT the item was
 * queued under, and `_finishPreCompile()`, which binds `outputRenderTarget` / `outputMRT`: the
 * target and MRT that were bound when compileAsync was CALLED. A caller that binds a target for the
 * synchronous launch only and puts its own back at once (Spring's impostor atlas, Odyssey's compile
 * under the live loop) gets the launch target bound again after every drained item, so its next
 * frame draws into the atlas or into the post scene pass's target (sampled and written at once:
 * the 2026-08-12 device loss). Measured 2026-10-30: Spring in the playground stayed bound to
 * `spring-impostor-albedo` for good and drew every frame into it (a navy canvas).
 *
 * The FIRST item begins synchronously, inside the compileAsync call, before the caller has put its
 * binding back: what is bound when it begins is still the launch target. So "what was live when the
 * item began" is not enough.
 *
 * WHAT: when `_finishPreCompile` runs, if the binding is no longer the one `_beginPreCompile`
 * applied, someone outside the drain chose another (the caller's restore after the launch): that
 * choice stays. Otherwise the binding that was there before `_beginPreCompile` comes back. Target
 * (with cube face and mip level) and MRT are judged separately. For a caller that holds its binding
 * across the await (three's own PassNode.compileAsync) that is what three restores anyway; with
 * nothing bound and a framebuffer target in play, the canvas binding comes back as in three.
 * `_finishPreCompile` also runs before each of the drain's yields and `_beginPreCompile` after it,
 * so the binding is judged again after every yield.
 *
 * Builds of an item begun inside the call still read whatever is bound while they run: after the
 * caller's restore, its binding (three r186 read the live binding for every drained build).
 *
 * r186 has neither method: nothing is patched there.
 * Pinned by tests/unit/three-precompile-live-restore.test.js against the installed source.
 */

const PATCHED = Symbol.for('serenity.precompileLiveRestore');
/** precompilationState → { before: the binding before begin, applied: the binding begin left } */
const bindingsByState = new WeakMap();

/** @param {any} renderer */
function bindingOf(renderer) {
    return {
        renderTarget: renderer._renderTarget,
        activeCubeFace: renderer._activeCubeFace,
        activeMipmapLevel: renderer._activeMipmapLevel,
        mrt: renderer._mrt,
    };
}

/** @param {any} a @param {any} b */
function sameTarget(a, b) {
    return a.renderTarget === b.renderTarget
        && a.activeCubeFace === b.activeCubeFace
        && a.activeMipmapLevel === b.activeMipmapLevel;
}

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
 * @returns {boolean} whether the drain now keeps the caller's binding (false on r186: no hooks)
 */
export function ensurePrecompileRestoresLiveState(renderer) {
    const proto = hookOwner(renderer);
    if (!proto) return false;
    if (proto[PATCHED]) return true;
    const begin = proto._beginPreCompile;
    const finish = proto._finishPreCompile;
    if (typeof begin !== 'function' || typeof finish !== 'function') return false;
    proto._beginPreCompile = function serenityBeginPreCompile(state, ...rest) {
        const before = bindingOf(this);
        const result = begin.call(this, state, ...rest);
        if (state && typeof state === 'object') bindingsByState.set(state, { before, applied: bindingOf(this) });
        return result;
    };
    proto._finishPreCompile = function serenityFinishPreCompile(...args) {
        const state = this._precompilationState;
        const entry = state ? bindingsByState.get(state) : undefined;
        const now = entry ? bindingOf(this) : null;
        const result = finish.apply(this, args);
        if (entry && now) {
            bindingsByState.delete(state);
            const target = sameTarget(now, entry.applied) ? entry.before : now;
            if (!sameTarget(bindingOf(this), target)) {
                this.setRenderTarget(target.renderTarget, target.activeCubeFace, target.activeMipmapLevel);
            }
            const mrt = now.mrt === entry.applied.mrt ? entry.before.mrt : now.mrt;
            if (this._mrt !== mrt) this.setMRT(mrt);
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
