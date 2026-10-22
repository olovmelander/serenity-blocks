/**
 * Forest — how the old wood answers the game.
 *
 * A pure, seconds-based director: gameplay events become a small set of decaying light and
 * wind envelopes, a level of "wakefulness" a combo builds and holds, waves of light to send
 * across the floor, bounded "emitters" described in board space (which side of the board,
 * how high, how strong), falling stars, and a summons for a firefly figure, with which of
 * the wood's animals it is to be. ForestWorld turns them into light, fireflies and wind;
 * nothing here touches the scene, so the same director runs in tests, the playground and
 * the game.
 *
 * The language:
 *   lock          a wave of light runs out over the moss from where the piece landed, every
 *                 firefly it crosses flashes, the ferns bow as it passes, and a puff of
 *                 fireflies leaves the board's edge beside the piece; a long hard drop
 *                 shakes dew from the boughs
 *   line clear    twin jets of fireflies from both sides at the cleared rows and a taller,
 *                 faster wave that climbs the trunks; from two lines a second wave and a
 *                 front of wind; from three a star falls
 *   four lines    all of that, fireflies lifting off the whole floor, the moon flaring,
 *                 and the fireflies gathering into one of the animals of the wood between
 *                 the trees: a stag, a moose, a bear, a wolf howling at the moon... never
 *                 the same one twice running, and every one of them before any comes back
 *   combo/streak  the forest wakes: fireflies fall into step until the whole wood flashes
 *                 in waves, garlands of them wind up the old trunks, foxfire threads spread
 *                 through the moss and the fungi light; a lock without a clear lets it sleep
 *   cascade       every wave of it builds on the last: stronger jets, a hotter, wider wave of
 *                 light, another gust
 *   t-spin        a spiral flourish beside the board (a T-spin that clears nothing too)
 *   back-to-back  the moon puts on its ice ring, twin rings of white-gold light run out over
 *                 the moss, and the whole wood blinks twice; brighter for every one in a row
 *   four lines again while an animal stands   it is fed, not replaced: the same animal stands
 *                 longer, fuller and brighter, and lifts its head in a stronger breath of light
 *   perfect clear the crown on the clear still playing: the standing animal burns white gold
 *                 and stands longest of all (called fresh only when none stands)
 *   level up      the whole forest answers at once
 *
 * It BUILDS rather than pops (src/themes/shared/gameplay-surge.js). The envelopes are Swells: a
 * new event adds to what is still lit and never restarts it, so a lock after a quad can only
 * lift the light, and rapid locks raise the wind instead of resetting it. A wind front still
 * crossing is joined, never restarted; the stars asked for fall one after another. A
 * GameplaySurge reads how hot play runs (`surge`: level, fever, stage); the forest spends it
 * through its own fireflies: warm, they quicken and brighten; hot, the wood stays awake between
 * clears and a standing breeze bows the ferns; in a fever every firefly in the wood flashes as
 * one quickening chorus, the garlands climb to the crowns, stars fall through the moonbeams and
 * an animal called then gathers sooner and fuller.
 */
import { FOREST_FIGURE_IDS } from './forest-figures.js';
import { GameplaySurge, SURGE_WEIGHTS, Swell } from '../shared/gameplay-surge.js';

export const FOREST_REACTION_LIMITS = Object.freeze({
    Minimal: 4,
    Low: 6,
    Medium: 8,
    High: 12,
    Ultra: 14,
    Extreme: 16,
});

const DECAY_RATES = Object.freeze({
    gust: 1.4,
    moon: 0.7,
    shafts: 0.85,
    glow: 1.1,
});
const ENVELOPE_KEYS = Object.keys(DECAY_RATES);
/**
 * Each envelope accumulates (a Swell: one event reads as it always did, a second adds to what is
 * left of the first); past 0.75 the reading eases toward 1 instead of pinning there, so a chain
 * still has somewhere to go, and what is stored is at most 1.4, so after a frenzy the light
 * lingers a moment and then falls away like any other.
 */
const envelopeSwell = (rate) => new Swell({
    release: 1 / rate, ceiling: 1, knee: 0.75, headroom: 1.4,
});
const WAKE_HOLD_SECONDS = 2.8;
const WAKE_RELEASE_RATE = 0.55;
/** While play runs hot the hold runs down this much slower (at a level of 1), so the wood stays awake. */
const WAKE_HOLD_HEAT = 0.75;
const FRONT_SECONDS = 2.2;
/** How fast a front that was joined eases up to its new strength. */
const FRONT_EASE = 3;
/** A front joined after this share of its crossing also sends another back across after it. */
const FRONT_LATE = 0.45;
/** The standing breeze hot play keeps in the ferns (added to the gust), at a level and a fever of 1. */
const BREEZE = Object.freeze({ level: 0.12, fever: 0.12 });
/** A back-to-back's double blink: when each blink comes after it, and how long it lasts (seconds). */
const BLINKS = Object.freeze([[0.1, 0.07], [0.5, 0.08]]);
/** Back-to-backs remembered for the blink (they are seldom closer than a second apart). */
const BLINK_SLOTS = 2;
/** How white an awake wood's fireflies burn while play is still cool (all of it when hot). */
const HEAT_COLD = 0.35;
/** Emitters do their work early in their lives (the director spawns within these windows). */
const WORK_SECONDS = Object.freeze({ rise: 1.5 });
const WAVE_QUEUE = 8;
const BOARD_COLUMNS = 10;
const BOARD_VISIBLE_ROWS = 20;
const BOARD_HIDDEN_ROWS = 4;
/** A figure gathers, stands, and lets go. */
export const FOREST_FIGURE_TIMING = Object.freeze({ gather: 1.5, hold: 3.6, release: 1.8 });
/** In a fever an animal gathers in this share less time; how full it comes, and how much a feed adds. */
const FIGURE_FEVER = Object.freeze({ quicker: 0.45, full: 0.75 });
const FIGURE_FEED = Object.freeze({ quad: 0.45, crown: 0.7 });

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

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

export class ForestReactions {
    /**
     * `rng` drives everything here; `figureRng`, when given, deals the animals instead, so
     * the game can leave which animal comes to chance while the rest follows its seed.
     */
    constructor({ quality = 'High', rng = Math.random, figureRng = null } = {}) {
        const requestedQuality = typeof quality === 'string' ? quality.toLowerCase() : '';
        this.quality = Object.keys(FOREST_REACTION_LIMITS)
            .find((tier) => tier.toLowerCase() === requestedQuality)
            || (requestedQuality === 'med' ? 'Medium' : 'High');
        this.maxEmitters = FOREST_REACTION_LIMITS[this.quality];
        this.rng = typeof rng === 'function' ? rng : Math.random;
        this.figureRng = typeof figureRng === 'function' ? figureRng : this.rng;
        this.emitters = Array.from({ length: this.maxEmitters }, (_, id) => ({ id }));
        this.waves = Array.from({ length: WAVE_QUEUE }, () => ({
            serial: -1, kind: 'lock', column: 0.5, row: 0, strength: 0, heat: 0,
        }));
        this.swells = Object.fromEntries(ENVELOPE_KEYS.map((key) => [key, envelopeSwell(DECAY_RATES[key])]));
        this.front = {
            active: false, age: 0, direction: 1, strength: 0, target: 0, queued: 0,
        };
        this.figure = {
            serial: 0,
            kind: FOREST_FIGURE_IDS[0],
            active: false,
            age: 0,
            hold: FOREST_FIGURE_TIMING.hold,
            gather: FOREST_FIGURE_TIMING.gather,
            fed: 0,
            full: 0,
        };
        /** How hot play runs, on this director's clock (sampled once per update). */
        this.surge = new GameplaySurge();
        this.play = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        /** A back-to-back's ice ring round the moon: each one in a row adds to the last. */
        this.halo = new Swell({
            attack: 0.15, release: 2.2, ceiling: 1.5, knee: 1,
        });
        /** When the last back-to-backs came and how bright their blink is (a small ring). */
        this.blinkAt = new Float64Array(BLINK_SLOTS).fill(-Infinity);
        this.blinkAmount = new Float64Array(BLINK_SLOTS);
        /**
         * How much of the motion the surge adds plays (the standing breeze): the theme lowers it
         * under reduced motion. The event answers themselves are the forest's, as before.
         */
        this.motion = 1;
        // The animals still to come this round, and one asked for by name (see `callFor`).
        this.bag = [];
        this.lastFigure = null;
        this.called = null;
        // Counts resets, so a consumer can tell a fresh run of serials from a stale one.
        this.epoch = 0;
        this.disposed = false;
        this.reset();
    }

    reset() {
        this.epoch += 1;
        this.time = 0;
        this.cursor = 0;
        this.serial = 0;
        this.waveSerial = 0;
        this.waveCursor = 0;
        this.streak = 0;
        this.clearedSinceLock = false;
        this.pendingDrop = 0;
        this.pendingHard = false;
        this.depth = 1;
        this.wake = 0;
        this.wakeTarget = 0;
        this.wakeHold = 0;
        this.sweeps = 0;
        this.stars = 0;
        this.settled = false;
        for (const key of ENVELOPE_KEYS) this.swells[key].reset();
        Object.assign(this.front, {
            active: false, age: 0, direction: 1, strength: 0, target: 0, queued: 0,
        });
        Object.assign(this.figure, {
            serial: 0,
            kind: FOREST_FIGURE_IDS[0],
            active: false,
            age: 0,
            hold: FOREST_FIGURE_TIMING.hold,
            gather: FOREST_FIGURE_TIMING.gather,
            fed: 0,
            full: 0,
        });
        this.surge.reset();
        Object.assign(this.play, {
            punch: 0, level: 0, fever: 0, stage: 0,
        });
        this.halo.reset();
        this.blinkAt.fill(-Infinity);
        this.blinkAmount.fill(0);
        this.bag.length = 0;
        this.lastFigure = null;
        for (const wave of this.waves) {
            Object.assign(wave, {
                serial: -1, kind: 'lock', column: 0.5, row: 0, strength: 0, heat: 0,
            });
        }
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

    random() {
        const value = this.rng();
        return Number.isFinite(value) ? clamp(value, 0, 1 - Number.EPSILON) : 0.5;
    }

    /** The envelopes as they read now: every event's light added to what was still lit. */
    get envelopes() {
        const values = {};
        for (const key of ENVELOPE_KEYS) values[key] = this.swells[key].valueAt(this.time);
        return values;
    }

    /** Add to the envelopes; nothing already lit is cut or restarted. */
    excite(values) {
        for (const key of ENVELOPE_KEYS) {
            const value = Number.isFinite(values[key]) ? clamp(values[key], 0, 1) : 0;
            this.swells[key].hit(value, this.time);
        }
    }

    /** A hit of play's own weight (a T-spin, a back-to-back, a later cascade wave) on the surge. */
    feed(punch, heat) {
        this.surge.punch.hit(punch, this.time);
        this.surge.level.hit(heat, this.time);
    }

    /** Claim a free slot, or the one furthest through its life. */
    emit(kind, {
        side = 0, column = 0.5, row = 0.3, strength = 0.5, lines = 0, duration = 1,
    }) {
        let selected = -1;
        let furthest = -1;
        for (let step = 0; step < this.maxEmitters; step += 1) {
            const index = (this.cursor + step) % this.maxEmitters;
            const emitter = this.emitters[index];
            if (!emitter.active) {
                selected = index;
                break;
            }
            const progress = emitter.age / emitter.duration;
            if (progress > furthest) {
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

    /** Ask for a wave of light from the floor behind a place on the board. */
    wave(kind, column, row, strength, heat = 0) {
        const wave = this.waves[this.waveCursor];
        wave.serial = this.waveSerial;
        wave.kind = kind;
        wave.column = clamp(column, 0, 1);
        wave.row = clamp(row, 0, 1);
        wave.strength = clamp(strength, 0, 3);
        wave.heat = clamp(heat, 0, 1);
        this.waveSerial += 1;
        this.waveCursor = (this.waveCursor + 1) % WAVE_QUEUE;
        return wave;
    }

    /**
     * Send a front of wind across the view. One still crossing is joined, never restarted: it
     * eases up to the stronger of the two (and a little more) and carries on; joined late in its
     * crossing, it also sends another back the other way as soon as it has gone.
     */
    sweep(strength) {
        const value = clamp(strength, 0, 1);
        if (!(value > 0)) return;
        const { front } = this;
        if (front.active) {
            front.target = Math.min(1, Math.max(front.target, value) + 0.25 * Math.min(front.target, value));
            if (front.age > FRONT_SECONDS * FRONT_LATE) front.queued = Math.max(front.queued, value);
            return;
        }
        this.launch(value);
    }

    /** A new front from the side the last one did not come from. */
    launch(strength) {
        this.sweeps += 1;
        Object.assign(this.front, {
            active: true,
            age: 0,
            direction: this.sweeps % 2 === 0 ? -1 : 1,
            strength,
            target: strength,
            queued: 0,
        });
    }

    raiseWake(level) {
        this.wakeTarget = Math.max(this.wakeTarget, clamp(level, 0, 1));
        this.wakeHold = WAKE_HOLD_SECONDS;
    }

    /**
     * Ask for one animal by name at every summons (a capture, a test); anything the wood
     * does not know, or nothing, lets them come as they will again.
     */
    callFor(kind) {
        this.called = FOREST_FIGURE_IDS.includes(kind) ? kind : null;
        return this.called;
    }

    /** A number from the generator that deals the animals. */
    chance() {
        const value = this.figureRng();
        return Number.isFinite(value) ? clamp(value, 0, 1 - Number.EPSILON) : 0.5;
    }

    /**
     * Which animal comes next: all of them in a shuffled round, so none returns before the
     * others have been, and never the same one twice running where two rounds meet.
     */
    nextFigure() {
        if (this.called) return this.called;
        if (this.bag.length === 0) {
            this.bag.push(...FOREST_FIGURE_IDS);
            for (let i = this.bag.length - 1; i > 0; i -= 1) {
                const j = Math.floor(this.chance() * (i + 1));
                [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
            }
            const next = this.bag.length - 1;
            if (next > 0 && this.bag[next] === this.lastFigure) {
                [this.bag[0], this.bag[next]] = [this.bag[next], this.bag[0]];
            }
        }
        this.lastFigure = this.bag.pop();
        return this.lastFigure;
    }

    /**
     * Call the fireflies together into an animal; `hold` is how long it stands. An animal still
     * gathering or standing is never replaced: the call feeds it instead (`crown`: a perfect
     * clear's), so the same animal stands at least `hold` from now, fuller and brighter, and
     * the director makes it lift its head. In a fever a new animal gathers sooner and comes full.
     */
    summon(hold = FOREST_FIGURE_TIMING.hold, { crown = false } = {}) {
        const wanted = Number.isNaN(Number(hold)) ? FOREST_FIGURE_TIMING.hold : clamp(Number(hold), 0.5, 12);
        const { figure } = this;
        if (figure.active && figure.age < figure.gather + figure.hold) {
            figure.hold = Math.max(figure.hold, Math.max(0, figure.age - figure.gather) + wanted);
            figure.fed += 1;
            figure.full = Math.min(1, figure.full + (crown ? FIGURE_FEED.crown : FIGURE_FEED.quad));
            return;
        }
        const { fever } = this.play;
        figure.serial += 1;
        figure.kind = this.nextFigure();
        figure.active = true;
        figure.age = 0;
        figure.hold = wanted;
        figure.gather = FOREST_FIGURE_TIMING.gather * (1 - FIGURE_FEVER.quicker * fever);
        figure.fed = 0;
        figure.full = FIGURE_FEVER.full * fever;
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
        this.settled = false;
        // A lock that follows a lock without a clear between them ends the streak.
        if (!this.clearedSinceLock) this.streak = 0;
        this.clearedSinceLock = false;
        const place = boardPlace(payload);
        const drop = this.pendingDrop;
        this.surge.lock({ hardDrop: this.pendingHard }, this.time);
        this.pendingDrop = 0;
        this.pendingHard = false;
        this.depth = 1;
        const column = place?.column ?? 0.5;
        const row = place?.row ?? 0.12;
        this.excite({
            gust: 0.08 + drop * 0.14, glow: 0.06 + drop * 0.1, shafts: 0.04 + drop * 0.08,
        });
        let side = 0;
        if (place) side = place.column < 0.5 ? -1 : 1;
        this.emit('lock', {
            side, column, row, strength: 0.26 + drop * 0.5, duration: 1.1,
        });
        this.wave(drop > 0.3 ? 'drop' : 'lock', column, row, 0.6 + drop * 0.9);
        if (drop > 0.3) {
            this.emit('dew', {
                side, column, row, strength: drop, duration: 0.7,
            });
        }
        return true;
    }

    onLineClear(countOrPayload = 1, detail = {}) {
        if (this.disposed) return false;
        const event = eventArguments(countOrPayload, detail, ['lineCount', 'lines', 'linesCleared', 'count'], 4);
        const lines = event.count;
        if (lines === 0) return false;
        this.settled = false;
        if (!this.clearedSinceLock) {
            this.clearedSinceLock = true;
            this.streak += 1;
        }
        // The cascade depth: the payload's own, else the COMBO event that came just before it.
        const depth = Math.max(1, positiveCount(event.detail.cascadeCount, 12) || this.depth);
        const deep = Math.min(4, depth - 1);
        if (deep === 0) this.surge.clear({ lines, combo: this.streak }, this.time);
        else {
            // A later wave of the same lock: worth a wave, not a whole new clear.
            const W = SURGE_WEIGHTS;
            this.feed(W.punch.wave + W.punch.lines[lines] * 0.4, W.heat.wave + W.heat.lines[lines] * 0.25);
        }
        const row = clearedRow(event.detail) ?? boardPlace(event.detail)?.row ?? 0.2;
        const four = lines >= 4;
        // Each wave of a cascade builds on the last: stronger jets, a hotter, wider wave, another gust.
        const build = 1 + deep * 0.15;
        this.excite({
            gust: 0.28 + lines * 0.14 + deep * 0.06,
            moon: 0.12 + lines * 0.1 + (four ? 0.36 : 0),
            shafts: 0.14 + lines * 0.13 + (four ? 0.3 : 0),
            glow: (0.2 + lines * 0.11) * build,
        });
        const strength = Math.min(1, (0.36 + lines * 0.16) * build);
        // Fireflies are blown out of both sides of the board at the height of the cleared rows.
        this.emit('clear', {
            side: -1, row, strength, lines, duration: 1.5 + lines * 0.12,
        });
        this.emit('clear', {
            side: 1, row, strength, lines, duration: 1.5 + lines * 0.12,
        });
        // One tall wave from under the whole row, and from two lines a second on its heels.
        this.wave(
            four ? 'quad' : 'clear',
            0.5,
            row,
            1 + lines * 0.3 + deep * 0.3,
            Math.min(1, (four ? 0.6 : lines * 0.1) + deep * 0.15),
        );
        if (lines >= 2) this.wave('clear', lines % 2 === 0 ? 0.1 : 0.9, row, 0.6 + lines * 0.18 + deep * 0.15);
        // From two lines a front of wind crosses the forest; a cascade sends one on every wave.
        if (lines >= 2 || deep > 0) this.sweep(0.3 + lines * 0.17 + deep * 0.08);
        if (lines >= 3) this.stars += 1;
        if (four) {
            this.emit('rise', {
                row: 0, strength: 1, lines, duration: 2.8,
            });
            this.summon();
        }
        if (this.streak >= 2) this.raiseWake(1 - Math.exp(-(this.streak - 1) * 0.3));
        return true;
    }

    onCombo(countOrPayload, detail = {}) {
        if (this.disposed) return false;
        const event = eventArguments(countOrPayload, detail, ['comboCount', 'combo', 'count'], 60);
        if (event.count < 2) return false;
        this.settled = false;
        const growth = 1 - Math.exp(-(event.count - 1) * 0.22);
        // The wave this COMBO announces clears next: its LINE_CLEAR reads the depth from here.
        this.depth = Math.max(this.depth, Math.min(12, event.count));
        this.excite({
            gust: 0.3 + growth * 0.5,
            moon: 0.2 + growth * 0.6,
            shafts: 0.3 + growth * 0.6,
            glow: 0.34 + growth * 0.66,
        });
        this.raiseWake(0.3 + growth * 0.7);
        this.emit('combo', {
            row: 0.1, strength: 0.4 + growth * 0.6, lines: event.count, duration: 1.4,
        });
        this.wave('combo', this.random(), 0.05, 0.7 + growth * 0.9, growth);
        return true;
    }

    onTSpin(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        const place = boardPlace(payload);
        // A T-spin that cleared lines adds its own weight to the clear just counted; one that
        // cleared nothing is a little flourish of its own (the spiral and the wave still play).
        if (positiveCount(payload.lineCount, 4) > 0) this.feed(SURGE_WEIGHTS.punch.tspin, SURGE_WEIGHTS.heat.tspin);
        else this.surge.spin(this.time);
        this.excite({
            gust: 0.45, moon: 0.3, shafts: 0.3, glow: 0.6,
        });
        this.emit('spin', {
            side: place && place.column >= 0.5 ? 1 : -1, row: place?.row ?? 0.3, strength: 0.8, duration: 1.7,
        });
        this.wave('spin', place?.column ?? 0.5, place?.row ?? 0.3, 1.2, 0.3);
        return true;
    }

    /**
     * Back-to-back: the second difficult clear in a row. The moon puts on its ice ring, twin rings
     * of white-gold light run out over the moss from under the board (a fast one and its echo),
     * and every firefly in the wood blinks twice. The ring is a swell and the blinks add up, so a
     * back-to-back after a back-to-back burns brighter than the first.
     */
    onBackToBack() {
        if (this.disposed) return false;
        this.feed(SURGE_WEIGHTS.punch.b2b, SURGE_WEIGHTS.heat.b2b);
        this.halo.hit(1, this.time);
        // The blink takes the older of its two slots, as bright as the ring now stands.
        const slot = this.blinkAt[0] <= this.blinkAt[1] ? 0 : 1;
        this.blinkAt[slot] = this.time;
        this.blinkAmount[slot] = Math.min(1.5, 0.7 + this.halo.valueAt(this.time) * 0.3);
        this.excite({
            moon: 0.5, glow: 0.7, shafts: 0.45,
        });
        this.wave('b2b', 0.5, 0.05, 1.5, 1);
        this.wave('echo', 0.5, 0.05, 1.2, 0.85);
        this.raiseWake(Math.max(this.wakeTarget, 0.55));
        return true;
    }

    /**
     * A perfect clear is the crown on the clear still playing (physics sends it after that clear's
     * last wave): an animal still gathering or standing is crowned (it burns white gold and stands
     * longest of all) rather than replaced, and the floor that four lines just lifted is not lifted
     * again. With no animal about, one is called, as before.
     */
    onPerfectClear() {
        if (this.disposed) return false;
        this.settled = false;
        this.surge.crown(this.time);
        this.excite({
            gust: 0.9, moon: 1, shafts: 1, glow: 1,
        });
        const rising = this.emitters.some((emitter) => emitter.active && emitter.kind === 'rise'
            && emitter.age < WORK_SECONDS.rise);
        if (!rising) {
            this.emit('rise', {
                row: 0, strength: 1, lines: 4, duration: 3.4,
            });
        }
        const standing = this.figure.active && this.figure.age < this.figure.gather + this.figure.hold;
        // The crown: one white-gold wave from the foot of the board (and a second from far out when
        // the floor has not just been lifted by four lines).
        this.wave('quad', 0.5, 0.1, 2.4, 1);
        if (!rising) this.wave('quad', 0.5, 0.6, 1.6, 0.7);
        this.sweep(1);
        this.raiseWake(0.85);
        this.stars += 2;
        this.summon(FOREST_FIGURE_TIMING.hold + 1.6, { crown: standing });
        return true;
    }

    onLevelUp() {
        if (this.disposed) return false;
        this.surge.levelUp(this.time);
        this.excite({
            gust: 0.6, moon: 0.6, shafts: 0.6, glow: 0.8,
        });
        this.wave('level', 0.5, 0.1, 1.7, 0.5);
        this.sweep(0.75);
        this.stars += 1;
        return true;
    }

    /** The session ended: the wind dies, the forest goes back to sleep, the fireflies sink. */
    onGameOver() {
        if (this.disposed) return false;
        this.wakeTarget = 0;
        this.wakeHold = 0;
        this.streak = 0;
        this.front.active = false;
        // Whatever figure is standing lets go at once.
        if (this.figure.active) {
            this.figure.age = Math.max(this.figure.age, this.figure.gather + this.figure.hold);
        }
        this.settled = true;
        return true;
    }

    update(dt) {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return this.getFrame();
        this.time += dt;
        const play = this.surge.sample(this.time);
        Object.assign(this.play, play);
        // Wakefulness rises quickly to its target, holds while clears keep coming, then ebbs. The
        // hotter play runs the slower the hold runs down, so a wood kept busy stays awake between
        // clears instead of sagging.
        if (this.wakeHold > 0) {
            this.wakeHold = Math.max(0, this.wakeHold - dt * (1 - WAKE_HOLD_HEAT * play.level));
            this.wake += (this.wakeTarget - this.wake) * (1 - Math.exp(-dt * 3.2));
        } else {
            this.wakeTarget = 0;
            this.wake *= Math.exp(-WAKE_RELEASE_RATE * dt);
            if (this.wake < 0.0005) this.wake = 0;
        }
        const { front } = this;
        if (front.active) {
            front.age += dt;
            front.strength += (front.target - front.strength) * (1 - Math.exp(-dt * FRONT_EASE));
            if (front.age >= FRONT_SECONDS) {
                front.active = false;
                // A front asked for late in this one's crossing comes back the other way now.
                if (front.queued > 0) this.launch(front.queued);
            }
        }
        if (this.figure.active) {
            this.figure.age += dt;
            if (this.figure.age >= this.figure.gather + this.figure.hold + FOREST_FIGURE_TIMING.release) {
                this.figure.active = false;
            }
        }
        for (const emitter of this.emitters) {
            if (!emitter.active) continue;
            emitter.age = Math.min(emitter.duration, emitter.age + dt);
            if (emitter.age >= emitter.duration) {
                emitter.active = false;
                emitter.strength = 0;
            }
        }
        return this.getFrame();
    }

    /** How hot play runs, 0..1: from a level of 0.35 to 0.9, or the fever, whichever is more. */
    warmth() {
        const { level, fever } = this.play;
        const x = clamp((level - 0.35) / 0.55, 0, 1);
        return Math.max(x * x * (3 - 2 * x), fever);
    }

    /** How bright a back-to-back's double blink is at the director's time (0 between them). */
    blink() {
        let total = 0;
        for (let i = 0; i < BLINK_SLOTS; i += 1) {
            const age = this.time - this.blinkAt[i];
            if (!(age >= 0) || age > 1.2) continue;
            for (const [at, width] of BLINKS) {
                const x = (age - at) / width;
                total += this.blinkAmount[i] * Math.exp(-x * x);
            }
        }
        return Math.min(1.5, total);
    }

    getFrame() {
        const { front, figure, play } = this;
        const travel = clamp(front.age / FRONT_SECONDS, 0, 1);
        let figureFrame = null;
        if (figure.active) {
            const standing = figure.gather + figure.hold;
            figureFrame = {
                serial: figure.serial,
                kind: figure.kind,
                age: figure.age,
                // Bound while it gathers and stands; let go for the release.
                held: figure.age < standing,
                // 0 → 1 as it gathers, 1 while it stands, back to 0 as it lets go.
                presence: figure.age < standing
                    ? clamp(figure.age / figure.gather, 0, 1)
                    : clamp(1 - (figure.age - standing) / FOREST_FIGURE_TIMING.release, 0, 1),
                // How often it has been fed while it stood, and how full and bright it stands (0..1).
                fed: figure.fed,
                full: figure.full,
            };
        }
        const motion = Number.isFinite(this.motion) ? clamp(this.motion, 0, 1) : 1;
        return {
            ...this.envelopes,
            epoch: this.epoch,
            wake: this.wake,
            // The fireflies only whiten once the forest is well awake, and burn fully white gold
            // only as play runs hot: a chain starts in firefly green and ends in gold.
            heat: clamp((this.wake - 0.5) / 0.42, 0, 1) * (HEAT_COLD + (1 - HEAT_COLD) * this.warmth()),
            // How far the fireflies have fallen into step, and how fast they keep time: a fever
            // brings every one of them into the chorus, and quickens it.
            sync: clamp(Math.max(this.wake * 1.2, play.fever * 1.1), 0, 1),
            beatRate: 0.3 + this.wake * 0.5 + play.fever * 0.35,
            // How hot play runs (shared/gameplay-surge.js), the standing breeze it keeps in the
            // ferns, the back-to-back's ring round the moon and its double blink.
            surge: { ...play },
            breeze: (BREEZE.level * play.level + BREEZE.fever * play.fever) * motion,
            halo: this.halo.valueAt(this.time),
            blink: this.blink(),
            streak: this.streak,
            settled: this.settled,
            stars: this.stars,
            figure: figureFrame,
            front: front.active ? {
                // -1.4 .. 1.4 across the view, in the direction of travel.
                position: (travel * 2.8 - 1.4) * front.direction,
                direction: front.direction,
                strength: front.strength * Math.sin(Math.PI * Math.min(1, travel * 1.15)),
            } : null,
            waves: this.waves,
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
