// @ts-check
/**
 * @fileoverview The lane chapter builds take while the map is on screen (perf audit 2026-10-28,
 * "chapter builds hitch the live map").
 *
 * A chapter that can be built in steps (chapter-environments/shared/chapter-build-steps.js) is
 * run here a few milliseconds per frame, one build at a time, instead of in one go: chapter 1's
 * build measured 100-250 ms of main thread, chapter 6's 25-140 ms (Node on a cloud CPU, first
 * and later builds; relative figures, not the player's machine), and every one of them that
 * landed after the reveal (the background loader, a boundary preload while scrolling, a far orb
 * picked in the navigator) was a frozen map for that long.
 *
 *  - One build at a time, oldest first; an URGENT one (the player is waiting on it: a travel's
 *    destination, the chapters on its glide) goes ahead of the rest and gets a larger share.
 *  - Each turn runs steps until its budget is spent, then waits for the next frame, so the frame
 *    in between is drawn. A step is never cut: the budget is how long a turn keeps starting them.
 *  - `canRun` says when a turn may run at all (the board parked under an orb, a glide in flight
 *    for a background build): a turn that may not run checks again a little later.
 *  - `hurry` finishes a build now, in one go: the camera is about to show that chapter, and a
 *    half-built one is never drawn (the steps' group is only handed over when it is complete).
 *  - `cancel` / `cancelAll` drop builds (the manager's teardown): their steps are closed, their
 *    promises resolve null and their `onCancel` runs.
 */

/**
 * @typedef {object} LaneBuildInfo
 * @property {number|string} key
 * @property {boolean} urgent
 */

/**
 * @typedef {object} LaneBuild
 * @property {number|string} key
 * @property {Generator<unknown, any, unknown>} steps
 * @property {boolean} urgent
 * @property {(value: any) => any} finish what the steps' result becomes (run synchronously)
 * @property {() => void} onCancel
 * @property {(value: any) => void} resolve
 * @property {(error: any) => void} reject
 * @property {Promise<any>} promise
 * @property {number} order
 */

/** How long a turn that may not run waits before asking again. */
const WAIT_MS = 120;

/**
 * The next frame, then a task: the turn runs right after that frame was produced, with the most
 * of the next frame's time ahead of it. A hidden page draws no frames (no rAF), so a timer.
 * @param {() => void} run
 * @param {number} [delayMs] when > 0, a plain timer of that length
 */
function defaultSchedule(run, delayMs = 0) {
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (delayMs > 0 || hidden || typeof requestAnimationFrame !== 'function') {
        setTimeout(run, delayMs > 0 ? delayMs : 16);
        return;
    }
    requestAnimationFrame(() => { setTimeout(run, 0); });
}

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class ChapterBuildLane {
    /**
     * @param {object} [options]
     * @param {(build: LaneBuildInfo) => boolean} [options.canRun] whether a turn may run now
     * @param {(build: LaneBuildInfo) => number} [options.budgetMs] ms a turn keeps starting steps
     * @param {() => number} [options.now]
     * @param {(run: () => void, delayMs?: number) => void} [options.schedule]
     */
    constructor(options = {}) {
        this._canRun = options.canRun ?? (() => true);
        this._budgetMs = options.budgetMs ?? (() => 4);
        this._now = options.now ?? defaultNow;
        this._schedule = options.schedule ?? defaultSchedule;
        /** @type {LaneBuild[]} */
        this._builds = [];
        this._order = 0;
        this._scheduled = false;
        this._closed = false;
    }

    /** Builds queued or running. */
    get size() {
        return this._builds.length;
    }

    /**
     * @param {number|string} key
     * @returns {boolean} whether a build of `key` is queued or running
     */
    has(key) {
        return this._builds.some((b) => b.key === key);
    }

    /**
     * Queue a build. Its promise resolves with `finish(result)` once the steps are done (in the
     * turn, or the `hurry`, that ran the last one), or null if it is cancelled; it rejects with a
     * step's error.
     * @template T
     * @param {number|string} key one build per key (a second `run` of a queued key joins the first)
     * @param {Generator<unknown, T, unknown>} steps
     * @param {object} [options]
     * @param {boolean} [options.urgent]
     * @param {(value: T) => any} [options.finish]
     * @param {() => void} [options.onCancel]
     * @returns {Promise<any>}
     */
    run(key, steps, { urgent = false, finish = (value) => value, onCancel = () => {} } = {}) {
        if (this._closed) {
            steps.return?.(undefined);
            onCancel();
            return Promise.resolve(null);
        }
        const queued = this._builds.find((b) => b.key === key);
        if (queued) {
            // One build per key: the new steps are not needed.
            steps.return?.(undefined);
            if (urgent) queued.urgent = true;
            return queued.promise;
        }
        /** @type {any} */
        const build = {
            key, steps, urgent: Boolean(urgent), finish, onCancel, order: this._order++,
        };
        build.promise = new Promise((resolve, reject) => {
            build.resolve = resolve;
            build.reject = reject;
        });
        this._builds.push(build);
        this._scheduleTurn();
        return build.promise;
    }

    /**
     * Put a queued build ahead of the background ones, with the urgent share.
     * @param {number|string} key
     * @returns {boolean} whether there was such a build
     */
    promote(key) {
        const build = this._builds.find((b) => b.key === key);
        if (!build) return false;
        build.urgent = true;
        return true;
    }

    /**
     * Finish a build now, in one go.
     * @param {number|string} key
     * @returns {boolean} whether a build was finished (its `finish` has run when this returns)
     */
    hurry(key) {
        const build = this._builds.find((b) => b.key === key);
        if (!build) return false;
        this._finishNow(build);
        return true;
    }

    /**
     * Drop a build: its steps are closed and its promise resolves null.
     * @param {number|string} key
     * @returns {boolean}
     */
    cancel(key) {
        const build = this._builds.find((b) => b.key === key);
        if (!build) return false;
        this._drop(build);
        return true;
    }

    /** Drop every build and take no more (the owner's teardown). */
    cancelAll() {
        this._closed = true;
        [...this._builds].forEach((build) => this._drop(build));
    }

    /** @private @param {LaneBuild} build */
    _drop(build) {
        this._remove(build);
        // A dropped build's cleanup failing must not stop the teardown.
        try { build.steps.return?.(undefined); } catch { /* closed regardless */ }
        try { build.onCancel(); } catch { /* best-effort */ }
        build.resolve(null);
    }

    /** @private @param {LaneBuild} build */
    _remove(build) {
        const i = this._builds.indexOf(build);
        if (i >= 0) this._builds.splice(i, 1);
    }

    /** @private The build a turn works on: the oldest urgent one, else the oldest. */
    _head() {
        let head = null;
        for (const build of this._builds) {
            if (!head) head = build;
            else if (build.urgent && !head.urgent) head = build;
            else if (build.urgent === head.urgent && build.order < head.order) head = build;
        }
        return head;
    }

    /** @private @param {number} [delayMs] */
    _scheduleTurn(delayMs = 0) {
        if (this._scheduled || this._closed || this._builds.length === 0) return;
        this._scheduled = true;
        this._schedule(() => {
            this._scheduled = false;
            this._turn();
        }, delayMs);
    }

    /** @private One turn: steps of the head build (and the next ones) until the budget is spent. */
    _turn() {
        if (this._closed) return;
        let head = this._head();
        if (!head) return;
        if (!this._canRun(head)) {
            this._scheduleTurn(WAIT_MS);
            return;
        }
        const budget = Math.max(0, Number(this._budgetMs(head)) || 0);
        const start = this._now();
        while (head) {
            if (this._step(head)) {
                head = this._head();
                if (head && !this._canRun(head)) break;
            }
            if (this._now() - start >= budget) break;
        }
        this._scheduleTurn();
    }

    /**
     * @private Run one step. @param {LaneBuild} build
     * @returns {boolean} whether the build is over (finished or failed)
     */
    _step(build) {
        let step;
        try {
            step = build.steps.next();
        } catch (error) {
            this._remove(build);
            build.reject(error);
            return true;
        }
        if (!step.done) return false;
        this._settle(build, step.value);
        return true;
    }

    /** @private @param {LaneBuild} build */
    _finishNow(build) {
        let step;
        try {
            step = build.steps.next();
            while (!step.done) step = build.steps.next();
        } catch (error) {
            this._remove(build);
            build.reject(error);
            return;
        }
        this._settle(build, step.value);
    }

    /** @private @param {LaneBuild} build @param {any} value */
    _settle(build, value) {
        this._remove(build);
        let result;
        try {
            result = build.finish(value);
        } catch (error) {
            build.reject(error);
            return;
        }
        build.resolve(result);
    }
}
