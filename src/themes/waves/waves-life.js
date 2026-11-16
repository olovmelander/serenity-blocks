/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Waves — the sea life: who is in the water right now, and where.
 *
 * Two sources of acts (waves-acts.js) are drawn together:
 *
 *   the sea's own   visits that come by the clock whatever the board does (waves-ambient.js): a
 *                   pod in the wall beside the rider, dolphins rolling through the trough, a
 *                   whale far out, flying fish, shearwaters;
 *   the board's     what play calls up (the world adds them: `add`): the pod a chain of clears
 *                   grows, a spinner for a twist, flying fish for every line, the humpback for a
 *                   perfect clear.
 *
 * Each frame every act is asked where its animal is (a closed form of the world's clock) and the
 * answers are written to the renderer (waves-fauna.js), kind by kind, as many as that kind may
 * draw. The moments an act breaks the surface are handed to the world once each, as the clock
 * passes them, so it can throw the water (waves-splash.js).
 *
 * The bodies come from the pack (waves-cast.js). Until it has arrived, and if it never does, the
 * acts still run (the world's counts and its splashes do not depend on a file) and nothing is
 * drawn.
 */
import * as THREE from 'three/webgpu';
import {
    FLUKE_REACH, KINDS, NOSE_REACH, SPECIES, actAlive, actPose, dolphinPose, emptyPose, makeLeap, surfaceTimes,
    troughRow,
} from './waves-acts.js';
import { WavesAmbient } from './waves-ambient.js';
import { createFauna, slotsFor } from './waves-fauna.js';
import { mulberry32, wavePoint } from './waves-core.js';

export {
    FLUKE_REACH, NOSE_REACH, dolphinPose, surfaceTimes,
};

/** How many dolphins a chain of `combo` clears sends over the water at once. */
export function leapersFor(combo) {
    if (combo >= 9) return 4;
    if (combo >= 7) return 3;
    if (combo >= 5) return 2;
    return combo >= 3 ? 1 : 0;
}

/** The kinds a chain's pod is made of: the leapers the board can call. */
const LEAPERS = Object.freeze(['bottlenose', 'spinner']);

export class WavesLife {
    /**
     * @param {object} p
     * @param {object} p.tier
     * @param {object} p.U
     * @param {{x: number, y: number, z: number}} p.sun   unit vector toward the sun
     * @param {{x: number, y: number, z: number}} p.eye   the rider's eye (the leaps are staged for it)
     * @param {number} [p.seed]
     * @param {boolean} [p.ambient=true]   the sea sends its own visits
     */
    constructor({
        tier, U, sun, eye, seed = 21, ambient = true,
    }) {
        this.tier = tier;
        this.U = U;
        this.sun = sun;
        this.eye = eye;
        this.seed = seed;
        this.rand = mulberry32(seed * 2749 + 1);
        /** How many of each kind may be drawn at once, and the pod a chain may call in all. */
        this.capacity = Object.fromEntries(KINDS.map((kind) => [kind, slotsFor(kind, tier)]));
        this.count = Math.max(1, tier.dolphins);
        this.ambient = ambient ? new WavesAmbient({ seed, scale: tier.life ?? 1 }) : null;
        /** The board's acts, oldest first. */
        this.acts = [];
        this.mesh = new THREE.Group();
        this.mesh.name = 'waves-life';
        this.fauna = null;
        this.airborne = 0;
        this.drawn = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
        this.last = Number.NaN;
        this._pose = emptyPose();
        this._at = emptyPose();
        this._list = [];
        this._visits = [];
    }

    /** The bodies have arrived: build what draws them. */
    attach(pack) {
        if (this.fauna || !pack?.kinds) return false;
        this.fauna = createFauna({ U: this.U, pack, tier: this.tier });
        this.mesh.add(this.fauna.mesh);
        return true;
    }

    /** A new run, or a seek: nothing the board called is left; the sea's own visits go on. */
    reset() {
        this.rand = mulberry32(this.seed * 2749 + 1);
        this.acts.length = 0;
        this.airborne = 0;
        this.last = Number.NaN;
    }

    /** Add one of the board's acts. */
    add(act) {
        this.acts.push(act);
        return act;
    }

    /**
     * Send one dolphin over the water (the board's pod).
     * @param {number} time   when it breaks the surface
     * @param {number} open   the barrel's opening (the water it leaves follows the wave)
     * @param {object} [o]
     * @param {number} [o.d]        metres ahead of the eye
     * @param {boolean} [o.hero]    throw it across the sun
     * @param {number} [o.height]   metres its back rises above where it left the water
     * @param {string} [o.kind]     which dolphin; else mostly bottlenose
     * @param {string} [o.style]    how it flies (waves-acts.js LEAP_STYLES); else by its kind
     */
    leap(time, open, {
        d = null, hero = false, height = null, kind = null, style = null, turns = null,
    } = {}) {
        const { rand } = this;
        const which = kind || (hero || rand() < 0.68 ? 'bottlenose' : 'spinner');
        const ahead = d ?? 8.5 + rand() * 7;
        // It leaves the trough at the foot of the face (where the card does not hide it), heading
        // out from the wave and a little down the line.
        // (A hero leaves near the foot, so the sun's line is always further out than it starts.)
        const row = troughRow(-0.7 - rand() * (hero ? 0.5 : 2.3), ahead);
        const from = wavePoint(row, ahead, open);
        const rise = height ?? 1.5 + rand() * 1.3;
        let vy = Math.sqrt(2 * 0.46 * rise);
        let vx = -(0.95 + rand() * 0.5);
        let vz = (rand() - 0.35) * 0.5;
        if (hero) {
            // The top of the arc on the line from the eye to the sun, at that distance.
            const reach = (from.z - this.eye.z) / this.sun.z;
            const topX = this.eye.x + this.sun.x * reach;
            const topY = this.eye.y + this.sun.y * reach;
            const climb = Math.max(1.2, topY - from.y - 0.1);
            vy = Math.sqrt(2 * 0.46 * climb);
            vx = (topX - from.x) / (vy / 0.46);
            vz = 0.06;
        }
        const roll = rand();
        let flown = style;
        if (!flown) {
            if (hero) flown = 'arc';
            else if (which === 'spinner') flown = roll < 0.7 ? 'spin' : 'arc';
            else if (roll < 0.16) flown = 'flip';
            else flown = roll < 0.3 ? 'side' : 'arc';
        }
        return this.add(makeLeap({
            kind: which,
            at: time,
            row,
            d: ahead,
            open,
            vx,
            vy,
            vz,
            metres: SPECIES[which].metres * (0.88 + rand() * 0.24),
            style: flown,
            turns: turns ?? (flown === 'spin' ? 2 + Math.floor(rand() * 3) : 1),
            phase: rand() * 6.28,
            variant: rand(),
            hero,
        }));
    }

    /** The board's leapers in the air or about to break the surface. */
    live() {
        let n = 0;
        for (let i = 0; i < this.acts.length; i += 1) {
            const act = this.acts[i];
            if (act.type === 'leap' && LEAPERS.includes(act.kind) && !act.landed) n += 1;
        }
        return n;
    }

    /** Whether the board may send one more leaper at `time` (never more than its pod at once). */
    canLeap() {
        return this.live() < this.count;
    }

    /**
     * Everything in the water at `clock`. `onEvent(act, event, pose)` is called once for each
     * moment an act breaks the surface since the last frame (never across a seek).
     */
    update(clock, open, onEvent) {
        const { fauna, drawn } = this;
        const from = this.last;
        const stepped = Number.isFinite(from) && clock >= from && clock - from < 2;
        this.last = clock;
        // The board's acts that have run their course are let go.
        let kept = 0;
        for (let i = 0; i < this.acts.length; i += 1) {
            const act = this.acts[i];
            if (clock - act.t0 <= act.life) {
                this.acts[kept] = act;
                kept += 1;
            }
        }
        this.acts.length = kept;
        const list = this._list;
        list.length = 0;
        // The board's own first: what play called is always drawn, even when its kind's slots are
        // full of the sea's own visitors (Minimal draws one whale: a perfect clear's must be it).
        for (let i = 0; i < this.acts.length; i += 1) list.push(this.acts[i]);
        if (this.ambient) {
            const visits = this.ambient.actsAt(clock, this._visits);
            for (let i = 0; i < visits.length; i += 1) list.push(visits[i]);
        }

        KINDS.forEach((kind) => {
            drawn[kind] = 0;
        });
        let airborne = 0;
        for (let i = 0; i < list.length; i += 1) {
            const act = list[i];
            const t = clock - act.t0;
            if (act.type === 'leap') {
                act.landed = t >= act.flight;
                if (t >= 0 && t <= act.flight) airborne += 1;
            }
            // The moments it breaks the surface, as the clock passes them.
            if (stepped && onEvent && act.events) {
                for (let e = 0; e < act.events.length; e += 1) {
                    const event = act.events[e];
                    const when = act.t0 + event.t;
                    if (when > from && when <= clock) onEvent(act, event, actPose(act, when, open, this._at));
                }
            }
            if (!actAlive(act, t)) continue;
            const pose = actPose(act, clock, open, this._pose);
            if (!(pose.metres > 0)) continue;
            const slot = drawn[act.kind];
            if (slot >= this.capacity[act.kind]) continue;
            drawn[act.kind] = slot + 1;
            if (fauna) fauna.set(act.kind, slot, pose);
        }
        this.airborne = airborne;
        if (fauna) fauna.commit(drawn);
    }

    dispose() {
        this.mesh.removeFromParent();
        this.fauna?.dispose();
        this.fauna = null;
        this.acts.length = 0;
    }
}
