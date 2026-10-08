/**
 * Chromatic Impasto — the painter's log (CPU only, three-free).
 *
 * The canvas on the GPU is a cache; this log is the painting. It holds every stroke in the order
 * the paint goes on, and a cursor through it: each frame it emits the pieces of stroke that are
 * due (chromatic-impasto-strokes.js). Replaying the log from the start rebuilds the same painting
 * after a resize, on another world after a quality change, or for a capture.
 *
 * Twist. While a chain of clears turns the canvas, the display reads the paint through a
 * rotation that grows with time (core.twistPoint). A stroke begun then is laid onto the turning
 * paint: its path is carried through the twist once, when its first piece is emitted, and the
 * angle used is kept on the stroke so a replay lays it in the same place. When the twist is baked
 * into the paint (a `bake` entry in the log), strokes still under way are carried back through it.
 */

import { KIND, twistPoint } from './chromatic-impasto-core.js';
import { emitStroke, strokeReach } from './chromatic-impasto-strokes.js';

/** Carry a stroke's geometry through a twist (angle may be negative: back through it). */
function carry(stroke, cx, cy, angle, reach, fromBase) {
    if (stroke.kind === KIND.BLOB) {
        const x = fromBase ? stroke.baseX : stroke.x;
        const y = fromBase ? stroke.baseY : stroke.y;
        [stroke.x, stroke.y] = twistPoint(x, y, cx, cy, angle, reach);
        return;
    }
    const srcL = fromBase ? stroke.baseLeft : stroke.left;
    const srcR = fromBase ? stroke.baseRight : stroke.right;
    if (stroke.left === stroke.baseLeft) {
        stroke.left = new Float32Array(stroke.baseLeft.length);
        stroke.right = new Float32Array(stroke.baseRight.length);
    }
    const p = [0, 0];
    for (let i = 0; i < stroke.nodes; i++) {
        twistPoint(srcL[i * 2], srcL[i * 2 + 1], cx, cy, angle, reach, p);
        stroke.left[i * 2] = p[0];
        stroke.left[i * 2 + 1] = p[1];
        twistPoint(srcR[i * 2], srcR[i * 2 + 1], cx, cy, angle, reach, p);
        stroke.right[i * 2] = p[0];
        stroke.right[i * 2 + 1] = p[1];
    }
}

/**
 * The painter: the ordered log of everything laid on the canvas, and the cursor through it.
 */
export class Painter {
    constructor({ maxLog = 5000 } = {}) {
        this.maxLog = maxLog;
        /** Strokes and bake entries, ordered by t0 (ties: insertion order). */
        this.log = [];
        /** Everything before this index is finished. */
        this.cursor = 0;
        /** Entries dropped from the front since the last reset (they stay in the paint). */
        this.dropped = 0;
        this.lastPaintTime = -Infinity;
        /** True when the last advance ran out of budget with paint still due. */
        this.behind = false;
        /** The moment the paint on the canvas has been dried up to (see `onAge`). */
        this.clock = -Infinity;
    }

    reset() {
        this.log.length = 0;
        this.cursor = 0;
        this.dropped = 0;
        this.lastPaintTime = -Infinity;
        this.clock = -Infinity;
    }

    /** Add a stroke or a blob. Returns it. */
    add(stroke) {
        const { log } = this;
        let i = log.length;
        while (i > this.cursor && log[i - 1].t0 > stroke.t0) i -= 1;
        if (i === log.length) log.push(stroke);
        else log.splice(i, 0, stroke);
        return stroke;
    }

    addAll(strokes) {
        for (let i = 0; i < strokes.length; i++) this.add(strokes[i]);
    }

    /** Record that the twist was baked into the paint at `time`. */
    addBake(time, cx, cy, angle, reach) {
        return this.add({
            bake: true, t0: time, cx, cy, angle, reach, done: false,
        });
    }

    /** Is any stroke under way or due by `time`? */
    busy(time) {
        const { log } = this;
        for (let i = this.cursor; i < log.length; i++) {
            if (log[i].t0 > time) return false;
            if (!log[i].done) return true;
        }
        return false;
    }

    /** Strokes not yet finished whose brush is down (their first piece has been emitted). */
    carryBack(cx, cy, angle, reach) {
        const { log } = this;
        for (let i = this.cursor; i < log.length; i++) {
            const s = log[i];
            if (!s.bake && s.warped && !s.done) carry(s, cx, cy, -angle, reach, false);
        }
    }

    /**
     * Emit everything due by `time` into `batch`.
     *
     * @param {number} time
     * @param {StrokeBatch} batch
     * @param {object} [twist]   the live twist: { cx, cy, angle, reach } (angle 0 = none)
     * @param {(entry: object) => void} [onBake]  called for each bake entry reached (the batch
     *        must be drawn first: the callee owns that)
     * @param {number} [budget=Infinity]  stop after about this many quads; the rest is laid on
     *        the next call (a long log replayed after a resize is spread over a few frames)
     * @param {(seconds: number) => void} [onAge]  called when a second or more separates one
     *        piece of paint from the next (only a replay does that): the paint already laid has
     *        had that long to dry. Frame-to-frame drying is the caller's own.
     * @returns {number} quads emitted
     */
    advance(time, batch, twist = null, onBake = null, budget = Infinity, onAge = null) {
        const { log } = this;
        let quads = 0;
        this.behind = false;
        for (let i = this.cursor; i < log.length; i++) {
            const s = log[i];
            if (s.t0 > time) break;
            if (s.done) continue;
            if (quads >= budget) {
                this.behind = true;
                break;
            }
            if (this.clock === -Infinity) this.clock = s.t0;
            else if (s.t0 - this.clock >= 1) {
                onAge?.(s.t0 - this.clock);
                this.clock = s.t0;
            }
            if (s.bake) {
                onBake?.(s);
                this.carryBack(s.cx, s.cy, s.angle, s.reach);
                s.done = true;
                continue;
            }
            if (!s.warped) {
                // First piece: lay the stroke through the twist, the recorded one on a replay.
                if (s.twist === null) {
                    s.twist = twist && twist.angle !== 0
                        ? {
                            cx: twist.cx, cy: twist.cy, angle: twist.angle, reach: twist.reach,
                        }
                        : false;
                }
                if (s.twist) carry(s, s.twist.cx, s.twist.cy, s.twist.angle, s.twist.reach, true);
                s.warped = true;
            }
            const n = emitStroke(s, strokeReach(s, time), batch);
            if (n > 0) this.lastPaintTime = Math.max(this.lastPaintTime, Math.min(time, s.t0 + s.dur));
            quads += n;
        }
        while (this.cursor < log.length && log[this.cursor].done) this.cursor += 1;
        if (!this.behind) {
            if (this.clock !== -Infinity && time - this.clock >= 1) onAge?.(time - this.clock);
            this.clock = time;
        }
        this.trim();
        return quads;
    }

    /** Forget the oldest finished entries once the log is over its limit. */
    trim() {
        if (this.log.length <= this.maxLog) return;
        const drop = Math.min(this.cursor, this.log.length - Math.floor(this.maxLog * 0.85));
        if (drop <= 0) return;
        this.log.splice(0, drop);
        this.cursor -= drop;
        this.dropped += drop;
    }

    /** Start the log over (the canvas must be cleared by the caller): the next advance replays it. */
    rewind() {
        const { log } = this;
        for (let i = 0; i < log.length; i++) {
            const s = log[i];
            s.done = false;
            if (s.bake) continue;
            s.drawn = 0;
            s.seg = 0;
            s.warped = false;
            if (s.kind === KIND.BLOB) {
                s.x = s.baseX;
                s.y = s.baseY;
            } else {
                s.left = s.baseLeft;
                s.right = s.baseRight;
                if (!(s.length > 1e-7)) s.done = true;
            }
        }
        this.cursor = 0;
        this.clock = -Infinity;
    }

    /** Remove every entry carrying `tag` (the caller rebuilds the canvas). */
    removeTagged(tag) {
        const kept = this.log.filter((s) => s.tag !== tag);
        this.log.length = 0;
        for (let i = 0; i < kept.length; i++) this.log.push(kept[i]);
        this.cursor = 0;
    }
}
