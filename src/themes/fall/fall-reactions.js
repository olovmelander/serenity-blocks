/**
 * Fall — how the grove answers the game.
 *
 * A pure, seconds-based director: gameplay events become a small set of light and wind
 * envelopes, a train of gust fronts, a leaf vortex, and bounded "emitters" described in board
 * space (which side of the board, how high, how strong). FallWorld turns them into leaves,
 * force fields, wind and light; nothing here touches the scene, so the same director runs in
 * tests, the playground and the game.
 *
 * The language:
 *   lock          a puff of leaves from the board edge beside the piece (harder after a
 *                 long hard drop)
 *   line clear    twin jets of leaves blown out of both sides at the cleared rows, a gust
 *                 front crossing the forest, warmer light
 *   four lines    all of that, a canopy shower and a sunburst through the trees
 *   cascade       every wave builds on the last: stronger jets, another front rolling through
 *                 the grove behind the one before, a bigger ring of leaves into the vortex
 *   combo         a leaf vortex winding around the board; it climbs, speeds up and finally
 *                 glows like embers as consecutive clears build (the true combo,
 *                 src/core/combo-tracker.js)
 *   twist        a spiral flourish beside the board (a twist that clears nothing too)
 *   back-to-back  the two great trees answer: both crowns let go a cascade of leaves at once,
 *                 more of them for every back-to-back in a row
 *   perfect clear the crown on the clear still playing: the sun bursts through the canopy and
 *                 the vortex lets go, flinging its leaves out over the grove
 *   level up      the whole grove exhales: a front, warmer light, lanterns and wisps
 *
 * Every event also has a form of its own, read from `frame.fx` by the grove's show
 * (fall-event-light.js, fall-event-fx.js, fall-flush.js, fall-post.js):
 *   hard drop     a thump: a ring runs out through the litter and the grass from the card's
 *                 foot, and acorns are shaken loose (`rings`, the cue `thump`)
 *   two lines     the passing front opens the canopy: a gap of brighter shafts crosses with it
 *                 (`canopy`)
 *   three lines   maple keys spin down out of the crowns, and the crowns turn their pale
 *                 undersides to the front as it passes (the cue `keys`, `canopy`)
 *   four lines    the sunburst: a fan of beams opens through the trees and a flood of light
 *                 rolls over the floor (`fan`, `flood`)
 *   combo         sparks caught in the vortex, and a ring of lantern light gathering round the
 *                 card's foot as the count grows (the cue `sparks`, `lantern`)
 *   twist         a spiral of maple keys and a ribbon of light (the cue `spiral`)
 *   back-to-back  a pulse of amber light climbs both great trunks into their crowns (`pulses`)
 *   perfect clear all of it: the floor's leaves rise in a wave running out from the board, gold
 *                 dust hangs in the air, a flock bursts from the trees (`rings` with `wave`, the
 *                 cues `dust` and `flush`)
 *   level up      the new light arrives as a front crossing the grove (`light`)
 *   game over     a moment, not a state: the wind dies and the light sinks for a breath (`hush`)
 * Cues are one-shot and numbered (a reader takes each serial once); rings, pulses, the flood and
 * the light front are functions of their own age, so nothing restarts when another arrives; a
 * full table lets the NEW one go rather than cut one in flight.
 *
 * It BUILDS rather than pops (src/themes/shared/gameplay-surge.js). The envelopes are Swells: a
 * new event adds to what is still lit and never restarts it. Fronts always travel downwind and
 * run their whole crossing; a sweep soon after the last joins it, a later one rolls in behind it
 * as a new front, so a cascade sends a train of them through the trees. A GameplaySurge reads how
 * hot play runs (`surge`: level, fever, stage) and the grove spends it through its own living
 * leaves: warm, a standing breeze rises and the light ripens; hot, the crowns begin to shed in
 * earnest, the shafts stand in the air and the leaves deepen from gold toward crimson; in a fever
 * the gale lifts the litter in rolling waves, the canopy pours leaves into a storm, the vortex
 * climbs into the crowns and burns, and the low sun turns to late amber. When the hands rest it
 * all breathes back to the quiet afternoon over a few seconds.
 */
import { ComboTracker } from '../../core/combo-tracker.js';
import { GameplaySurge, SURGE_WEIGHTS, Swell } from '../shared/gameplay-surge.js';

export const FALL_REACTION_LIMITS = Object.freeze({
    Minimal: 4,
    Low: 6,
    Medium: 8,
    High: 12,
    Ultra: 14,
    Extreme: 16,
});

const DECAY_RATES = Object.freeze({
    gust: 1.5,
    warmth: 0.75,
    shafts: 0.9,
    glow: 1.1,
});
const ENVELOPE_KEYS = Object.keys(DECAY_RATES);
/**
 * Each envelope accumulates (a Swell: one event reads as it always did, a second adds to what is
 * left of the first); past 0.8 the reading eases toward 1 instead of pinning there, and what is
 * stored is at most 1.4, so after a frenzy the light lingers a moment and then falls away.
 */
const envelopeSwell = (rate) => new Swell({
    release: 1 / rate, ceiling: 1, knee: 0.8, headroom: 1.4,
});
/**
 * The hotter play runs, the less each event's own light adds (all of it cold, 1 − this at a level
 * of 1): the sustained light of the surge carries a long chain, so its events never stack into a
 * milky wash. The wind is not held back: the gale is the point.
 */
const LIGHT_TEMPER = 0.35;
const VORTEX_HOLD_SECONDS = 2.6;
const VORTEX_RELEASE_RATE = 0.85;
/** A perfect clear lets the column go: it holds this long at most, then unwinds. */
const CROWN_HOLD_SECONDS = 0.7;
const FRONT_SECONDS = 1.9;
/** Fronts that can cross the grove at once (a cascade sends a train of them). */
export const FALL_FRONT_SLOTS = 3;
/** A sweep this soon after the youngest front set out joins it instead of starting another. */
const FRONT_JOIN_SECONDS = 0.3;
/** How fast a joined front eases up to its new strength. */
const FRONT_EASE = 4;
/** Fronts travel downwind: the way the grove's breeze blows (+x, see FallLight.uWindDir). */
const FRONT_DIRECTION = 1;
/**
 * Emitters do their work early in their lives (the leaf director spawns and lays its force fields
 * within these windows); after it they only finish their schedule. A full pool gives up the slot
 * with the least work left, so a jet or a shower is never cut mid-blow for a lock.
 */
const WORK_SECONDS = Object.freeze({
    lock: 0.28, clear: 0.75, shower: 1.4, combo: 0.05, spin: 1.1, twin: 0.7, crown: 0.75,
});
/** What reduced motion keeps of the motion the surge adds (the breeze, the storm's pace). */
export const FALL_REDUCED_MOTION = 0.35;
/** One-shot cues the frame can hold at once, and how long each stays in it (readers take a serial once). */
export const FALL_CUE_SLOTS = 16;
const CUE_SECONDS = 1;
export const FALL_CUE_KINDS = Object.freeze(['thump', 'keys', 'spiral', 'sparks', 'dust', 'flush']);
/** Rings that can run through the floor at once: a hard drop's thump, a perfect clear's wave. */
export const FALL_RING_SLOTS = 3;
/** How long a thump's ring and a perfect clear's wave run (seconds). */
export const FALL_RING_SECONDS = Object.freeze({ thump: 1.5, wave: 2.8 });
/** A hard drop shorter than this share of the board's height makes no ring; nor one this soon after the last. */
const THUMP_DROP = 0.3;
const THUMP_REST = 0.22;
/** How much of a thump is left at a full level of play (it happens on nearly every piece then). */
const THUMP_HOT = 0.55;
/** Pulses of light that can climb the two great trunks at once, and how long one takes (seconds). */
export const FALL_PULSE_SLOTS = 2;
export const FALL_PULSE_SECONDS = 2.6;
/** The flood of light a sunburst rolls over the floor, and a level's light front: seconds to cross. */
export const FALL_FLOOD_SECONDS = 2.4;
export const FALL_DAWN_SECONDS = FRONT_SECONDS;
/** How fast the ring of lantern light gathers, and how fast it goes out once the chain is over (per second). */
const LANTERN_RATES = Object.freeze({ gather: 2.4, part: 0.7 });
const BOARD_COLUMNS = 10;
const BOARD_VISIBLE_ROWS = 20;
const BOARD_HIDDEN_ROWS = 4;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const smooth = (edge0, edge1, value) => {
    const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return x * x * (3 - 2 * x);
};

function unwrap(value) {
    if (!isObject(value)) return {};
    return isObject(value.detail) ? value.detail : value;
}

function positiveCount(value, maximum) {
    // Reject booleans, arrays, objects, symbols and BigInts rather than coercing
    // malformed event payloads into a celebration or throwing from Number().
    if (typeof value !== 'number' && typeof value !== 'string') return 0;
    if (typeof value === 'string' && value.trim().length === 0) return 0;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? clamp(Math.floor(number), 0, maximum) : 0;
}

function eventArguments(value, detail, aliases, maximum) {
    const payload = isObject(value) ? unwrap(value) : unwrap(detail);
    const rawCount = isObject(value)
        ? aliases.map((key) => payload[key]).find((entry) => entry !== undefined && entry !== null)
        : value;
    return { count: positiveCount(rawCount, maximum), detail: payload };
}

/** Centre of a piece's filled cells in board cells, or null when the payload has none. */
function pieceCentre(piece) {
    if (!isObject(piece) || !Number.isFinite(piece.x) || !Number.isFinite(piece.y)) return null;
    let cells = 0;
    let column = 0;
    let row = 0;
    if (Array.isArray(piece.shape)) {
        piece.shape.forEach((line, y) => {
            if (!Array.isArray(line)) return;
            line.forEach((cell, x) => {
                if (cell > 0) {
                    cells += 1;
                    column += piece.x + x + 0.5;
                    row += piece.y + y + 0.5;
                }
            });
        });
    }
    if (cells === 0) return { column: piece.x + 0.5, row: piece.y + 0.5 };
    return { column: column / cells, row: row / cells };
}

/** Where on the board an event happened: column 0..1 (left to right), row 0..1 (bottom to top). */
function boardPlace(detail) {
    const origin = detail?.viewportOrigin;
    if (isObject(origin) && Number.isFinite(origin.x) && Number.isFinite(origin.y)) {
        return { column: clamp(origin.x, 0, 1), row: clamp(1 - origin.y, 0, 1) };
    }
    const centre = pieceCentre(detail?.piece);
    if (centre) {
        return {
            column: clamp(centre.column / BOARD_COLUMNS, 0, 1),
            row: clamp(1 - (centre.row - BOARD_HIDDEN_ROWS) / BOARD_VISIBLE_ROWS, 0, 1),
        };
    }
    return null;
}

function clearedRow(detail) {
    const rows = Array.isArray(detail?.clearedRows) ? detail.clearedRows.filter((row) => Number.isFinite(row)) : [];
    if (rows.length === 0) return null;
    const mean = rows.reduce((sum, row) => sum + row, 0) / rows.length;
    // Rows beyond a standard board (Infinity mode) carry no screen meaning.
    if (mean < 0 || mean > BOARD_HIDDEN_ROWS + BOARD_VISIBLE_ROWS) return null;
    return clamp(1 - (mean + 0.5 - BOARD_HIDDEN_ROWS) / BOARD_VISIBLE_ROWS, 0, 1);
}

export class FallReactions {
    constructor({ quality = 'High', rng = Math.random } = {}) {
        const requestedQuality = typeof quality === 'string' ? quality.toLowerCase() : '';
        this.quality = Object.keys(FALL_REACTION_LIMITS)
            .find((tier) => tier.toLowerCase() === requestedQuality)
            || (requestedQuality === 'med' ? 'Medium' : 'High');
        this.maxEmitters = FALL_REACTION_LIMITS[this.quality];
        this.rng = typeof rng === 'function' ? rng : Math.random;
        this.emitters = Array.from({ length: this.maxEmitters }, (_, id) => ({ id }));
        /** The envelopes as of the director's time (refreshed on every event and update). */
        this.envelopes = Object.fromEntries(ENVELOPE_KEYS.map((key) => [key, 0]));
        this.swells = Object.fromEntries(ENVELOPE_KEYS.map((key) => [key, envelopeSwell(DECAY_RATES[key])]));
        this.fronts = Array.from({ length: FALL_FRONT_SLOTS }, () => ({}));
        /** The true combo: consecutive clearing locks (a cascade's waves are one step). */
        this.combo = new ComboTracker();
        /** How hot play runs, on this director's clock (sampled once per update). */
        this.surge = new GameplaySurge();
        this.play = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        /** The sun bursting through the canopy on a perfect clear (frame-wide: the world applies Reduce flashing). */
        this.crown = new Swell({
            attack: 0.12, release: 1.3, ceiling: 1.2, knee: 0.9,
        });
        /** Back-to-backs in a row: each one's twin cascade from the great trees is fuller than the last. */
        this.twin = new Swell({ release: 2.5, ceiling: 2, knee: 1.4 });
        // -- the show (frame.fx): see the header --
        /** One-shot cues, a ring of them; `epoch` counts the director's own fresh starts. */
        this.cues = Array.from({ length: FALL_CUE_SLOTS }, () => ({}));
        this.epoch = 0;
        /** Rings through the floor, pulses up the two great trunks. */
        this.rings = Array.from({ length: FALL_RING_SLOTS }, () => ({}));
        this.pulses = Array.from({ length: FALL_PULSE_SLOTS }, () => ({}));
        /** The sunburst's fan of beams (frame-wide: the world applies Reduce flashing). */
        this.fan = new Swell({
            attack: 0.3, release: 1.5, ceiling: 1.12, knee: 0.9, headroom: 1.4,
        });
        /** How far the passing fronts open the canopy (a gap of shafts from two lines, pale undersides from three). */
        this.canopy = new Swell({
            attack: 0.12, release: 1.5, ceiling: 1, knee: 0.8, headroom: 1.3,
        });
        /** The floods of light over the floor (a second may roll in behind the first), and a level's light front. */
        this.floods = [{}, {}];
        this.dawns = [{}];
        /** The run ended: the light sinks for a breath and comes back. */
        this.hush = new Swell({
            attack: 0.45, release: 1.6, ceiling: 1, knee: 0.9, headroom: 1.05,
        });
        /**
         * How much of the motion the surge adds plays (the standing breeze, the storm's pace, the
         * wind's push on the trees): the theme lowers it under reduced motion.
         */
        this.motion = 1;
        this.reset();
    }

    reset() {
        this.disposed = false;
        this.time = 0;
        this.cursor = 0;
        this.serial = 0;
        this.depth = 1;
        this.pendingDrop = 0;
        this.pendingHard = false;
        this.vortex = 0;
        this.vortexTarget = 0;
        this.vortexHold = 0;
        this.sweeps = 0;
        this.combo.reset();
        for (const key of ENVELOPE_KEYS) {
            this.swells[key].reset();
            this.envelopes[key] = 0;
        }
        for (const front of this.fronts) {
            Object.assign(front, {
                active: false, age: 0, direction: FRONT_DIRECTION, strength: 0, target: 0, serial: -1,
            });
        }
        this.surge.reset();
        Object.assign(this.play, {
            punch: 0, level: 0, fever: 0, stage: 0,
        });
        this.crown.reset();
        this.twin.reset();
        this.resetShow();
        this.cueSerial = 0;
        this.cueCursor = 0;
        this.epoch += 1;
        for (const emitter of this.emitters) {
            Object.assign(emitter, {
                active: false,
                serial: -1,
                kind: 'lock',
                side: -1,
                column: 0.5,
                row: 0.3,
                strength: 0,
                lines: 0,
                age: 0,
                duration: 1,
                seed: 0,
            });
        }
    }

    /** Everything of the show at rest: no cue waiting, no ring running, no light standing. */
    resetShow() {
        for (const cue of this.cues) {
            Object.assign(cue, {
                serial: -1, kind: 'thump', side: -1, column: 0.5, row: 0, strength: 0, lines: 0, at: -Infinity,
            });
        }
        for (const ring of this.rings) {
            Object.assign(ring, {
                active: false, serial: -1, age: 0, life: 1, column: 0.5, strength: 0, wave: false,
            });
        }
        for (const pulse of this.pulses) {
            Object.assign(pulse, {
                active: false, serial: -1, age: 0, strength: 0,
            });
        }
        for (const traveller of [...this.floods, ...this.dawns]) {
            Object.assign(traveller, {
                active: false, age: 0, strength: 0, target: 0,
            });
        }
        this.fan.reset();
        this.canopy.reset();
        this.hush.reset();
        this.lantern = 0;
        this.lanternTarget = 0;
        this.lastThump = -Infinity;
        this.ringSerial = 0;
    }

    /**
     * A one-shot cue for the show (see FALL_CUE_KINDS), in board terms. The ring takes the next
     * slot: a cue is read within a frame or two, so the one it overwrites has long been taken.
     */
    cue(kind, {
        side = 0, column = 0.5, row = 0.3, strength = 1, lines = 0,
    } = {}) {
        const slot = this.cues[this.cueCursor];
        this.cueCursor = (this.cueCursor + 1) % FALL_CUE_SLOTS;
        Object.assign(slot, {
            serial: this.cueSerial,
            kind,
            side: side < 0 ? -1 : 1,
            column: clamp(column, 0, 1),
            row: clamp(row, 0, 1),
            strength: clamp(strength, 0, 1.5),
            lines,
            at: this.time,
        });
        this.cueSerial += 1;
        return slot;
    }

    /**
     * Start a ring through the floor from the card's foot at `column`. A thump takes a free slot or
     * is let go (the lightest effect is the first to give way); a perfect clear's wave always runs,
     * taking the slot furthest through its life. Returns the ring, or null when it was let go.
     */
    ring(column, strength, wave = false) {
        const value = clamp(strength, 0, 1);
        if (!(value > 0)) return null;
        let chosen = null;
        let furthest = -1;
        for (const ring of this.rings) {
            if (!ring.active) {
                chosen = ring;
                break;
            }
            const through = ring.age / ring.life;
            if (wave && !ring.wave && through > furthest) {
                furthest = through;
                chosen = ring;
            }
        }
        // (A slot still running is only ever given up to a wave, and only by a thump.)
        if (!chosen || (chosen.active && !wave)) return null;
        Object.assign(chosen, {
            active: true,
            serial: this.ringSerial,
            age: 0,
            life: wave ? FALL_RING_SECONDS.wave : FALL_RING_SECONDS.thump,
            column: clamp(column, 0, 1),
            strength: value,
            wave,
        });
        this.ringSerial += 1;
        return chosen;
    }

    /**
     * Send a traveller (a flood of light, a light front) on its way. One that set out a moment ago
     * is joined (it eases up to the stronger of the two); otherwise a free slot starts a new one;
     * with every slot crossing, the youngest is lifted. Nothing crossing is ever sent back.
     */
    static depart(slots, strength, joinWithin) {
        const value = clamp(strength, 0, 1.25);
        if (!(value > 0)) return;
        let youngest = null;
        let free = null;
        for (const slot of slots) {
            if (!slot.active) free = free || slot;
            else if (!youngest || slot.age < youngest.age) youngest = slot;
        }
        if (youngest && (youngest.age < joinWithin || !free)) {
            youngest.target = Math.max(youngest.target, value);
            return;
        }
        Object.assign(free, {
            active: true, age: 0, strength: value, target: value,
        });
    }

    /** Consecutive clearing locks (the true combo; 0 once a lock cleared nothing). */
    get streak() {
        return this.combo.combo;
    }

    random() {
        const value = this.rng();
        return Number.isFinite(value) ? clamp(value, 0, 1 - Number.EPSILON) : 0.5;
    }

    /** Read every envelope at the director's time into `envelopes`. */
    refresh() {
        for (const key of ENVELOPE_KEYS) this.envelopes[key] = this.swells[key].valueAt(this.time);
    }

    /**
     * Add to the envelopes; nothing already lit is cut or restarted. The light (not the wind) of
     * each event is tempered as play heats, so the surge's own sustained light carries a chain.
     */
    excite(values) {
        // The level of play as the events and the clock alone say (the same at any frame rate).
        const temper = 1 - LIGHT_TEMPER * Math.min(1, this.surge.level.valueAt(this.time));
        for (const key of ENVELOPE_KEYS) {
            const value = Number.isFinite(values[key]) ? clamp(values[key], 0, 1) : 0;
            this.swells[key].hit(key === 'gust' ? value : value * temper, this.time);
        }
        this.refresh();
    }

    /** A hit of play's own weight (a later cascade wave, a twist, a back-to-back) on the surge. */
    feed(punch, heat) {
        this.surge.punch.hit(punch, this.time);
        this.surge.level.hit(heat, this.time);
    }

    /** Work an emitter still has to do (0 once its working window has passed). */
    static remainingWork(emitter) {
        const window = WORK_SECONDS[emitter.kind] ?? 0.5;
        return Math.max(0, window - emitter.age) * emitter.strength;
    }

    /** Claim a free slot, or the one with the least work left (the furthest through its life on a tie). */
    emit(kind, {
        side = 0, column = 0.5, row = 0.3, strength = 0.5, lines = 0, duration = 1,
    }) {
        let selected = -1;
        let least = Infinity;
        let furthest = -1;
        for (let step = 0; step < this.maxEmitters; step += 1) {
            const index = (this.cursor + step) % this.maxEmitters;
            const emitter = this.emitters[index];
            if (!emitter.active) {
                selected = index;
                break;
            }
            const work = FallReactions.remainingWork(emitter);
            const progress = emitter.age / emitter.duration;
            if (work < least - 1e-9 || (Math.abs(work - least) <= 1e-9 && progress > furthest)) {
                least = work;
                furthest = progress;
                selected = index;
            }
        }
        Object.assign(this.emitters[selected], {
            active: true,
            serial: this.serial,
            kind,
            side: side || (this.serial % 2 === 0 ? -1 : 1),
            column: clamp(column, 0, 1),
            row: clamp(row, 0, 1),
            strength: clamp(strength, 0, 1),
            lines,
            age: 0,
            duration,
            seed: this.random(),
        });
        this.serial += 1;
        this.cursor = (selected + 1) % this.maxEmitters;
        return this.emitters[selected];
    }

    /**
     * Send a front of wind across the grove. Every front travels downwind and runs its whole
     * crossing: a sweep soon after the youngest set out joins it (it eases up to the stronger of
     * the two, and a little more); a later one rolls in behind it from the upwind edge in a free
     * slot; with every slot crossing, it joins the youngest. Nothing is restarted or reversed.
     */
    sweep(strength) {
        const value = clamp(strength, 0, 1);
        if (!(value > 0)) return;
        let youngest = null;
        let free = null;
        for (const front of this.fronts) {
            if (!front.active) {
                free = free || front;
            } else if (!youngest || front.age < youngest.age) youngest = front;
        }
        if (youngest && (youngest.age < FRONT_JOIN_SECONDS || !free)) {
            youngest.target = Math.min(1, Math.max(youngest.target, value) + 0.25 * Math.min(youngest.target, value));
            return;
        }
        this.sweeps += 1;
        Object.assign(free, {
            active: true,
            age: 0,
            direction: FRONT_DIRECTION,
            strength: value,
            target: value,
            serial: this.sweeps,
        });
    }

    raiseVortex(level) {
        this.vortexTarget = Math.max(this.vortexTarget, clamp(level, 0, 1));
        this.vortexHold = VORTEX_HOLD_SECONDS;
    }

    onHardDrop(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        const distance = Number.isFinite(payload.distance) ? payload.distance
            : (Number(payload.endY) - Number(payload.startY));
        this.pendingDrop = Number.isFinite(distance) ? clamp(distance / BOARD_VISIBLE_ROWS, 0, 1) : 0;
        this.pendingHard = true;
        return true;
    }

    onPieceLock(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        // A lock that follows a lock without a clear between them ends the combo.
        this.combo.notePieceLocked();
        this.depth = 1;
        const place = boardPlace(payload);
        const drop = this.pendingDrop;
        this.surge.lock({ hardDrop: this.pendingHard }, this.time);
        this.pendingDrop = 0;
        this.pendingHard = false;
        const strength = 0.24 + drop * 0.5;
        this.excite({ gust: 0.12 + drop * 0.16, warmth: 0.025 + drop * 0.05, glow: 0.05 + drop * 0.08 });
        let side = 0;
        if (place) side = place.column < 0.5 ? -1 : 1;
        this.emit('lock', {
            side, column: place?.column ?? 0.5, row: place?.row ?? 0.12, strength, duration: 1.1,
        });
        this.thump(place?.column ?? 0.5, side || -1, drop);
        return true;
    }

    /**
     * A long hard drop lands with a thump: a ring through the floor from under the piece, and
     * acorns shaken loose. It happens on nearly every piece of fast play, so it is the first to
     * give way: none for a short drop, none while every ring is running, less as play heats.
     */
    thump(column, side, drop) {
        if (!(drop >= THUMP_DROP) || this.time - this.lastThump < THUMP_REST) return false;
        const level = clamp(this.surge.level.valueAt(this.time), 0, 1);
        const strength = (0.35 + 0.65 * smooth(THUMP_DROP, 0.9, drop)) * (1 - (1 - THUMP_HOT) * level);
        if (!this.ring(column, strength)) return false;
        this.lastThump = this.time;
        this.cue('thump', { side, column, strength });
        return true;
    }

    onLineClear(countOrPayload = 1, detail = {}) {
        if (this.disposed) return false;
        const event = eventArguments(countOrPayload, detail, ['lineCount', 'lines', 'linesCleared', 'count'], 4);
        const lines = event.count;
        if (lines === 0) return false;
        const combo = this.combo.noteLineClear();
        // The cascade depth: the payload's own, else the COMBO event that came just before it.
        const depth = Math.max(1, positiveCount(event.detail.cascadeCount, 12) || this.depth);
        const deep = Math.min(6, depth - 1);
        if (deep === 0) this.surge.clear({ lines, combo }, this.time);
        else {
            // A later wave of the same lock: worth a wave, not a whole new clear.
            const W = SURGE_WEIGHTS;
            this.feed(W.punch.wave + W.punch.lines[lines] * 0.4, W.heat.wave + W.heat.lines[lines] * 0.25);
        }
        const row = clearedRow(event.detail) ?? boardPlace(event.detail)?.row ?? 0.2;
        const four = lines >= 4;
        // Each wave of a cascade builds on the last: stronger jets, a stronger front behind the last.
        const build = 1 + deep * 0.15;
        this.excite({
            gust: 0.3 + lines * 0.14 + deep * 0.06,
            warmth: 0.14 + lines * 0.11 + (four ? 0.3 : 0),
            shafts: 0.14 + lines * 0.13 + (four ? 0.3 : 0),
            glow: (0.16 + lines * 0.1) * build,
        });
        const strength = Math.min(1, (0.36 + lines * 0.16) * build);
        // Leaves are blown out of both sides of the board at the height of the cleared rows.
        this.emit('clear', {
            side: -1, row, strength, lines, duration: 1.5 + lines * 0.12,
        });
        this.emit('clear', {
            side: 1, row, strength, lines, duration: 1.5 + lines * 0.12,
        });
        // From two lines a front of wind crosses the grove; a cascade sends one on every wave.
        if (lines >= 2 || deep > 0) this.sweep(0.3 + lines * 0.17 + deep * 0.08);
        if (four) {
            this.emit('shower', {
                row: 1, strength: 1, lines, duration: 2.6,
            });
        }
        if (combo >= 2) {
            this.raiseVortex(1 - Math.exp(-(combo - 1) * 0.3));
            this.gather(combo);
        }
        // The show's ladder: from two lines the passing front opens the canopy; from three the
        // crowns turn pale to it and maple keys spin down; four lines are the sunburst.
        if (lines >= 2) this.canopy.hit([0, 0, 0.4, 0.75, 1][lines], this.time);
        if (lines >= 3) {
            this.cue('keys', {
                row, strength: four ? 1 : 0.6, lines,
            });
        }
        if (four) this.sunburst(1);
        return true;
    }

    /**
     * The sunburst as a form: the fan of beams opens (it accumulates; its light is tempered as play
     * heats, like every event's) and a flood of light sets out over the floor.
     */
    sunburst(strength) {
        const temper = 1 - LIGHT_TEMPER * Math.min(1, this.surge.level.valueAt(this.time));
        this.fan.hit(strength * temper, this.time);
        FallReactions.depart(this.floods, strength, 0.6);
    }

    /** The ring of lantern light at the card's foot gathers with the count (and holds with the vortex). */
    gather(count) {
        this.lanternTarget = Math.max(this.lanternTarget, 1 - Math.exp(-(Math.max(2, count) - 1) * 0.2));
    }

    onCombo(countOrPayload, detail = {}) {
        if (this.disposed) return false;
        const event = eventArguments(countOrPayload, detail, ['comboCount', 'combo', 'count'], 60);
        if (event.count < 2) return false;
        // The wave this COMBO announces clears next: its LINE_CLEAR reads the depth from here.
        this.depth = Math.max(this.depth, Math.min(12, event.count));
        const growth = 1 - Math.exp(-(event.count - 1) * 0.22);
        this.excite({
            gust: 0.4 + growth * 0.5,
            warmth: 0.26 + growth * 0.6,
            shafts: 0.3 + growth * 0.6,
            glow: 0.3 + growth * 0.65,
        });
        this.raiseVortex(0.3 + growth * 0.7);
        this.emit('combo', {
            row: 0.1, strength: 0.4 + growth * 0.6, lines: event.count, duration: 1.4,
        });
        this.gather(event.count);
        this.cue('sparks', { strength: 0.4 + growth * 0.6, lines: event.count });
        return true;
    }

    onTwist(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        const place = boardPlace(payload);
        // A twist that cleared lines adds its own weight to the clear just counted; one that
        // cleared nothing is a small flourish of its own (the spiral still plays).
        if (positiveCount(payload.lineCount, 4) > 0) this.feed(SURGE_WEIGHTS.punch.twist, SURGE_WEIGHTS.heat.twist);
        else this.surge.spin(this.time);
        this.excite({
            gust: 0.5, warmth: 0.3, shafts: 0.3, glow: 0.55,
        });
        const side = place && place.column >= 0.5 ? 1 : -1;
        this.emit('spin', {
            side, row: place?.row ?? 0.3, strength: 0.8, duration: 1.7,
        });
        this.cue('spiral', { side, row: place?.row ?? 0.3, strength: 0.8 });
        return true;
    }

    /**
     * Back-to-back, the second difficult clear in a row: the two great trees answer, both crowns
     * letting go a cascade of leaves at once. The cascades come from a swell, so a back-to-back
     * after a back-to-back throws more than the first.
     */
    onBackToBack() {
        if (this.disposed) return false;
        this.feed(SURGE_WEIGHTS.punch.b2b, SURGE_WEIGHTS.heat.b2b);
        this.twin.hit(1, this.time);
        const run = this.twin.valueAt(this.time);
        this.excite({ warmth: 0.5, glow: 0.7, shafts: 0.45 });
        this.raiseVortex(Math.max(this.vortexTarget, 0.55));
        this.emit('twin', {
            row: 1, strength: clamp(0.45 + run * 0.3, 0, 1), lines: 0, duration: 1.6,
        });
        // A pulse of amber light climbs both trunks into the crowns: a second one follows the
        // first up; with both climbing, the younger takes the new one's light.
        const strength = clamp(0.6 + run * 0.25, 0, 1);
        const free = this.pulses.find((pulse) => !pulse.active);
        if (free) {
            Object.assign(free, {
                active: true, serial: this.ringSerial, age: 0, strength,
            });
            this.ringSerial += 1;
        } else {
            const youngest = this.pulses.reduce((a, b) => (b.age < a.age ? b : a));
            youngest.strength = Math.max(youngest.strength, strength);
        }
        return true;
    }

    /**
     * A perfect clear is the crown on the clear still playing (physics sends it after that clear's
     * last wave): the sun bursts through the canopy and the vortex lets go, flinging its leaves out
     * over the grove before it unwinds. The canopy shower four lines have just started is not
     * started again; a perfect clear with none playing brings its own.
     */
    onPerfectClear() {
        if (this.disposed) return false;
        this.surge.crown(this.time);
        this.crown.hit(1, this.time);
        this.excite({
            gust: 0.9, warmth: 1, shafts: 1, glow: 1,
        });
        const showering = this.emitters.some((emitter) => emitter.active && emitter.kind === 'shower'
            && emitter.age < WORK_SECONDS.shower);
        if (!showering) {
            this.emit('shower', {
                row: 1, strength: 1, lines: 4, duration: 3.2,
            });
        }
        this.emit('crown', {
            row: 0.1, strength: 1, lines: 4, duration: 2.4,
        });
        this.sweep(1);
        // The column flares, then lets go.
        this.raiseVortex(0.85);
        this.vortexHold = Math.min(this.vortexHold, CROWN_HOLD_SECONDS);
        // The crown of the show, several seconds long: the sunburst at its fullest, the floor's
        // leaves rising in a wave that runs out from the board, the crowns turned pale and letting
        // their keys go, gold dust in the air, and a flock out of the trees.
        this.sunburst(1.2);
        this.canopy.hit(1, this.time);
        this.ring(0.5, 1, true);
        this.cue('keys', { row: 1, strength: 1, lines: 4 });
        this.cue('dust', { strength: 1 });
        this.cue('flush', { strength: 1 });
        return true;
    }

    onLevelUp() {
        if (this.disposed) return false;
        this.surge.levelUp(this.time);
        this.excite({
            gust: 0.6, warmth: 0.55, shafts: 0.6, glow: 0.8,
        });
        this.sweep(0.75);
        // The new light arrives as a front crossing the grove, with the gust (and the gap of shafts
        // the gust opens: the canopy swell at a strength that opens the shafts and no more).
        this.canopy.hit(0.42, this.time);
        FallReactions.depart(this.dawns, 1, 0.8);
        return true;
    }

    /**
     * The session ended: let the wind die and the leaves settle (the state of the run, always),
     * and, as a moment that passes, let the light sink for a breath (`effects`: the theme's gate,
     * so a state change never rides on an effect's).
     * @param {{ effects?: boolean }} [options]
     */
    onGameOver({ effects = true } = {}) {
        this.vortexTarget = 0;
        this.vortexHold = 0;
        this.lanternTarget = 0;
        this.combo.reset();
        for (const front of this.fronts) front.active = false;
        if (effects && !this.disposed) this.hush.hit(1, this.time);
    }

    /**
     * A new run: nothing of the last one's play is carried into it (its chain, its cascade, a drop
     * still pending, the vortex's hold, the run of back-to-backs), and nothing is cut either: what
     * is still in the air or in the light (leaves, the heat of play, the hush of the last run's
     * end) breathes out by itself, and the clock and the serials run on, so whoever reads the frame
     * needs no reset and no leaf pops. A light breeze goes through the grove as the run begins
     * (`effects`: the theme's gate).
     * @param {{ effects?: boolean }} [options]
     */
    onSessionStart({ effects = true } = {}) {
        if (this.disposed) return false;
        this.depth = 1;
        this.pendingDrop = 0;
        this.pendingHard = false;
        this.vortexTarget = 0;
        this.vortexHold = 0;
        this.lanternTarget = 0;
        this.combo.reset();
        this.twin.reset();
        if (effects) {
            this.excite({ gust: 0.3, glow: 0.2 });
            this.sweep(0.4);
        }
        return true;
    }

    update(dt) {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return this.getFrame();
        this.time += dt;
        Object.assign(this.play, this.surge.sample(this.time));
        this.refresh();
        // The vortex rises quickly to its target, holds while clears keep coming, then unwinds.
        if (this.vortexHold > 0) {
            this.vortexHold = Math.max(0, this.vortexHold - dt);
            this.vortex += (this.vortexTarget - this.vortex) * (1 - Math.exp(-dt * 3.2));
        } else {
            this.vortexTarget = 0;
            this.vortex *= Math.exp(-VORTEX_RELEASE_RATE * dt);
            if (this.vortex < 0.0005) this.vortex = 0;
        }
        for (const front of this.fronts) {
            if (!front.active) continue;
            front.age += dt;
            front.strength += (front.target - front.strength) * (1 - Math.exp(-dt * FRONT_EASE));
            if (front.age >= FRONT_SECONDS) front.active = false;
        }
        for (const emitter of this.emitters) {
            if (!emitter.active) continue;
            emitter.age = Math.min(emitter.duration, emitter.age + dt);
            if (emitter.age >= emitter.duration) {
                emitter.active = false;
                emitter.strength = 0;
            }
        }
        // The show: everything runs on its own age and retires at its end.
        for (const ring of this.rings) {
            if (!ring.active) continue;
            ring.age += dt;
            if (ring.age >= ring.life) ring.active = false;
        }
        for (const pulse of this.pulses) {
            if (!pulse.active) continue;
            pulse.age += dt;
            if (pulse.age >= FALL_PULSE_SECONDS) pulse.active = false;
        }
        FallReactions.cross(this.floods, dt, FALL_FLOOD_SECONDS);
        FallReactions.cross(this.dawns, dt, FALL_DAWN_SECONDS);
        // The lanterns gather while the chain holds the vortex up, and go out one by one after it.
        if (this.vortexHold <= 0) this.lanternTarget = 0;
        const rate = this.lanternTarget > this.lantern ? LANTERN_RATES.gather : LANTERN_RATES.part;
        this.lantern += (this.lanternTarget - this.lantern) * (1 - Math.exp(-dt * rate));
        if (this.lantern < 0.0005 && this.lanternTarget === 0) this.lantern = 0;
        return this.getFrame();
    }

    /** Age the travellers of one kind; each eases up to what joined it and retires at its end. */
    static cross(slots, dt, seconds) {
        for (const slot of slots) {
            if (!slot.active) continue;
            slot.age += dt;
            slot.strength += (slot.target - slot.strength) * (1 - Math.exp(-dt * FRONT_EASE));
            if (slot.age >= seconds) slot.active = false;
        }
    }

    /** A traveller as the world reads it: how far across it is (0..1) and how strong (it swells in and out). */
    static crossing(slot, seconds) {
        const travel = clamp(slot.age / seconds, 0, 1);
        return { travel, strength: slot.strength * Math.sin(Math.PI * Math.min(1, travel * 1.08)) ** 0.6 };
    }

    /** What the show reads (`frame.fx`): see the header. */
    getShow() {
        const { time } = this;
        const cues = [];
        for (const cue of this.cues) {
            const age = time - cue.at;
            if (cue.serial >= 0 && age < CUE_SECONDS) cues.push({ ...cue, age: Math.max(0, age) });
        }
        const rings = [];
        for (const ring of this.rings) {
            if (!ring.active) continue;
            rings.push({
                serial: ring.serial, age: ring.age, life: ring.life, column: ring.column, strength: ring.strength, wave: ring.wave,
            });
        }
        const pulses = [];
        for (const pulse of this.pulses) {
            if (pulse.active) pulses.push({ serial: pulse.serial, age: pulse.age, strength: pulse.strength });
        }
        const floods = [];
        for (const flood of this.floods) {
            if (flood.active) floods.push(FallReactions.crossing(flood, FALL_FLOOD_SECONDS));
        }
        const dawn = this.dawns[0].active ? FallReactions.crossing(this.dawns[0], FALL_DAWN_SECONDS) : null;
        return {
            epoch: this.epoch,
            cues,
            rings,
            pulses,
            // The sunburst's fan (frame-wide: the world applies Reduce flashing) and its floods of light.
            fan: this.fan.valueAt(time),
            floods,
            // How far the passing fronts open the canopy.
            canopy: this.canopy.valueAt(time),
            // A level's light front: -1.4 .. 1.4 across the view, downwind.
            light: dawn && { position: (dawn.travel * 2.8 - 1.4) * FRONT_DIRECTION, strength: dawn.strength },
            lantern: this.lantern,
            hush: this.hush.valueAt(time),
        };
    }

    /** One front as the world reads it: where it stands across the view and how hard it blows. */
    static frontReading(front) {
        const travel = clamp(front.age / FRONT_SECONDS, 0, 1);
        return {
            // -1.4 .. 1.4 across the view, in the direction of travel.
            position: (travel * 2.8 - 1.4) * front.direction,
            direction: front.direction,
            strength: front.strength * Math.sin(Math.PI * Math.min(1, travel * 1.15)),
        };
    }

    getFrame() {
        const { play } = this;
        const motion = Number.isFinite(this.motion) ? clamp(this.motion, 0, 1) : 1;
        const level = clamp(play.level, 0, 1);
        const fever = clamp(play.fever, 0, 1);
        // How much the grove has taken notice: nothing in casual play, all of it once play runs hot.
        const warm = smooth(0.2, 0.75, level);
        const fronts = [];
        let front = null;
        for (const slot of this.fronts) {
            if (!slot.active) continue;
            const reading = FallReactions.frontReading(slot);
            fronts.push(reading);
            if (!front || reading.strength > front.strength) front = reading;
        }
        return {
            ...this.envelopes,
            vortex: this.vortex,
            // Embers: the vortex only starts to glow once it has really built; in a fever every
            // leaf the game throws burns at its edges.
            heat: Math.max(clamp((this.vortex - 0.55) / 0.4, 0, 1), fever * 0.5),
            streak: this.streak,
            // The strongest front (for a reader that follows one) and every front crossing.
            front: front && { ...front },
            fronts,
            // How hot play runs (shared/gameplay-surge.js) and what the grove makes of it:
            surge: { ...play },
            // a standing breeze that bends the boughs further and carries the leaves sideways,
            breeze: (0.35 * level + 0.45 * fever) * motion,
            // how hard the crowns shed and the gale lifts the litter,
            storm: clamp(0.55 * smooth(0.3, 0.9, level) + 0.6 * fever, 0, 1) * (0.5 + 0.5 * motion),
            // the late, warm light that holds while the action lasts,
            ripen: clamp(0.3 * warm + 0.45 * fever, 0, 1),
            // and the leaves turning from gold toward crimson.
            turn: clamp(0.3 * warm + 0.7 * fever, 0, 1),
            // The sun bursting through on a perfect clear (frame-wide: the world applies Reduce flashing).
            crown: this.crown.valueAt(this.time),
            motion,
            // Each event's own form (the header's second list).
            fx: this.getShow(),
            emitters: this.emitters.filter((emitter) => emitter.active).map((emitter) => ({
                ...emitter,
                progress: clamp(emitter.age / emitter.duration, 0, 1),
            })),
        };
    }

    get frame() {
        return this.getFrame();
    }

    dispose() {
        this.reset();
        this.disposed = true;
    }
}
