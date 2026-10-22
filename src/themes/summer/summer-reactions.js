/**
 * Summer — how Midsummer's Eve answers the game.
 *
 * A pure, seconds-based director: gameplay events become a small set of decaying light and
 * wind envelopes, bounded "emitters" described in board space (which side of the board, how
 * high, how strong, which flower), rings to drop on the lake and gusts to send through the
 * meadow. SummerWorld turns them into petals, seeds and light; nothing here touches the
 * scene, so the same director runs in tests, the playground and the game.
 *
 * Every tetromino is one of the seven flowers you pick on Midsummer's Eve:
 *   I poppy · O harebell · T buttercup · S oxeye daisy · Z lupine · J orange hawkweed ·
 *   L wood cranesbill
 * (No piece keeps the colour that shape usually has in other block games: the project's
 * palette gate, scripts/palette-guideline-check.mjs, wants that mapping broken, and this
 * one breaks all seven.)
 *
 * The language:
 *   lock          petals of the piece's own flower puff from the board's edge beside it, a
 *                 gust spreads through the meadow from the foot of the board and makes that
 *                 flower nod and glow wherever it grows, and a ring opens on the lake; a
 *                 long hard drop also shakes dandelion seed into the air
 *   bouquet       each new kind of flower you lock is picked for the bouquet and lights a
 *                 lantern on the maypole; the seventh kind completes it, and the maypole
 *                 throws the whole bouquet into the sky
 *   line clear    twin jets of petals blown out of both sides at the cleared rows, a broad
 *                 ring, the sun's path flaring on the water; from two lines a front of wind
 *                 crosses the meadow and the woods
 *   four lines    all of that, petals lifting off the whole meadow, a sunburst and the
 *                 swallows going up
 *   combo/streak  petals gather into a flower crown that turns around the board; it climbs,
 *                 thickens and quickens as cascades or consecutive clears build, and ribbons
 *                 unfurl around it
 *   cascade       every wave of one lock builds on the last: stronger jets, a ring further
 *                 out on the lake, and a front of wind of its own rolling after the last
 *   t-spin        a spinning garland beside the board (a T-spin that clears nothing too)
 *   back-to-back  the sun answers: a sunburst through the maypole's wreath and its road on
 *                 the water flaring, brighter for every one in a row
 *   perfect clear the crown on the clear still playing: the sunburst blazes, the maypole
 *                 throws the bouquet, the whole evening exhales (no second rising meadow)
 *   level up      the whole evening exhales: light, rings, wind, wings
 *   the hours     the night stands one hour further on with every level, and moves on by
 *                 itself as well, slowly: evening, rose hour, white night, dawn, morning,
 *                 and evening again (summer-hours.js holds their colours)
 *
 * It BUILDS rather than pops (src/themes/shared/gameplay-surge.js). Every envelope is a Swell:
 * a new event adds to what is still lit and never restarts it, so a weak lock after a quad can
 * only lift the light. Wind fronts run to the far side in slots, all with the prevailing breeze
 * off the lake; one that finds no slot joins the youngest still crossing. Emitters, lake rings
 * and meadow gusts give up the slot with the least left in it. The true combo comes from the
 * shared ComboTracker (the bus COMBO is a cascade's depth). A GameplaySurge reads how hot play
 * runs (`surge`: punch, level, fever, stage) and SummerWorld spends it on the evening: the
 * breeze freshens, the butterflies and swallows come out and quicken, the sun's road glitters,
 * the shafts thicken; in a fever the meadow rolls in waves of wind, breathes its petals into
 * the light and the maypole's lanterns run round the wreaths like the ring dance.
 */
import { ComboTracker } from '../../core/combo-tracker.js';
import { GameplaySurge, SURGE_WEIGHTS, Swell } from '../shared/gameplay-surge.js';
import {
    SUMMER_HOUR_SECONDS, SUMMER_HOUR_TURN_SECONDS, SUMMER_HOURS, summerHourForLevel, wrapSummerHour,
} from './summer-hours.js';

export const SUMMER_REACTION_LIMITS = Object.freeze({
    Minimal: 4,
    Low: 6,
    Medium: 8,
    High: 12,
    Ultra: 14,
    Extreme: 16,
});

/** Tetromino letter to flower kind (the slots of SUMMER_FLOWERS). */
export const SUMMER_PIECE_FLOWERS = Object.freeze({
    I: 4, O: 0, T: 1, S: 3, Z: 5, J: 6, L: 2,
});
export const SUMMER_BOUQUET_KINDS = 7;
/** A flower kind for petals of every colour at once. */
export const SUMMER_MIXED = -1;

const DECAY_RATES = Object.freeze({
    gust: 1.4,
    warmth: 0.75,
    shafts: 0.9,
    glow: 1.1,
    shimmer: 0.8,
    flock: 0.32,
    flutter: 0.5,
});
const ENVELOPE_KEYS = Object.keys(DECAY_RATES);
/**
 * Each envelope accumulates (a Swell: one event reads exactly as it always did, a second adds to
 * what is left of the first); the reading is capped at 1 and what is stored at 1.4, so after a
 * frenzy the light lingers a moment and then falls away like any other. The world eases what
 * MOVES the scene (the gust, the swallows, the butterflies) on top of this: SummerWorld.wear.
 */
const envelopeSwell = (rate) => new Swell({
    release: 1 / rate, ceiling: 1, knee: 1, headroom: 1.4,
});
const SPECIES_SLOTS = 8;
const SPECIES_DECAY = 0.85;
const CROWN_HOLD_SECONDS = 2.6;
const CROWN_RELEASE_RATE = 0.85;
const FRONT_SECONDS = 2.2;
/** Wind fronts crossing at once; another joins the youngest still crossing. */
export const SUMMER_FRONT_SLOTS = 3;
/** How fast a front that was joined eases up to its new strength (or away at game over). */
const FRONT_EASE = 3;
/** The prevailing breeze off the lake: every front rolls across the meadow the way it blows. */
const FRONT_DIRECTION = 1;
/** Emitters do their work early in their lives (the director spawns within these windows). */
const WORK_SECONDS = Object.freeze({
    lock: 0.25, seeds: 0.3, clear: 0.75, rise: 1.5, bouquet: 0.7, spin: 1.1, combo: 0.05,
});
/** Back-to-backs further apart than this are not one run of them. */
const B2B_RUN_SECONDS = 15;
const BOUQUET_FLASH_DECAY = 0.55;
const BOUQUET_FADE_RATE = 1.6;
const RING_QUEUE = 8;
// One frame can ask for a gust from a lock, its bouquet, a clear, a combo, a spin, a perfect
// clear and a level-up: the queue holds them all, as the ring queue holds its eight.
const WAVE_QUEUE = 8;
const BOARD_COLUMNS = 10;
const BOARD_VISIBLE_ROWS = 20;
const BOARD_HIDDEN_ROWS = 4;

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

/** The flower a piece stands for, or SUMMER_MIXED when the payload names none. */
export function summerFlowerForPiece(piece) {
    if (!isObject(piece)) return SUMMER_MIXED;
    for (const key of [piece.shapeKey, piece.type, piece.pieceId, piece.color]) {
        if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(SUMMER_PIECE_FLOWERS, key.toUpperCase())) {
            return SUMMER_PIECE_FLOWERS[key.toUpperCase()];
        }
    }
    return SUMMER_MIXED;
}

export class SummerReactions {
    constructor({ quality = 'High', rng = Math.random, hourSeconds = SUMMER_HOUR_SECONDS } = {}) {
        const requestedQuality = typeof quality === 'string' ? quality.toLowerCase() : '';
        this.quality = Object.keys(SUMMER_REACTION_LIMITS)
            .find((tier) => tier.toLowerCase() === requestedQuality)
            || (requestedQuality === 'med' ? 'Medium' : 'High');
        this.maxEmitters = SUMMER_REACTION_LIMITS[this.quality];
        this.rng = typeof rng === 'function' ? rng : Math.random;
        this.emitters = Array.from({ length: this.maxEmitters }, (_, id) => ({ id }));
        this.rings = Array.from({ length: RING_QUEUE }, () => ({
            serial: -1, column: 0.5, row: 0, strength: 0,
        }));
        this.waves = Array.from({ length: WAVE_QUEUE }, () => ({ serial: -1, column: 0.5, strength: 0 }));
        this.swells = Object.fromEntries(ENVELOPE_KEYS.map((key) => [key, envelopeSwell(DECAY_RATES[key])]));
        this.species = new Float32Array(SPECIES_SLOTS);
        /** How brightly each of the seven lanterns on the maypole burns. */
        this.bouquet = new Float32Array(SUMMER_BOUQUET_KINDS);
        this.fronts = Array.from({ length: SUMMER_FRONT_SLOTS }, () => ({
            active: false, age: 0, direction: FRONT_DIRECTION, strength: 0, target: 0, serial: -1,
        }));
        /**
         * The sun answering the hardest clears: a quad's sunburst through the maypole's wreath, a
         * back-to-back's, and the perfect clear's crown on top of whatever still burns.
         */
        this.sunburst = new Swell({
            release: 1.6, ceiling: 1, knee: 1, headroom: 1.4,
        });
        /** The true combo: consecutive clearing locks (src/core/combo-tracker.js). */
        this.combo = new ComboTracker();
        /** How hot play runs, on this director's clock (sampled once per update). */
        this.surge = new GameplaySurge();
        this.pace = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        // Counts resets, so a consumer can tell a fresh run of serials from a stale one.
        this.epoch = 0;
        // Seconds the night takes to move one hour by itself; anything else stops that clock.
        this.hourSeconds = Number.isFinite(hourSeconds) && hourSeconds > 0 ? hourSeconds : 0;
        this.hourPin = null;
        this.reset();
    }

    /** Back to rest. `keepNight` leaves the level and the hour of the night where they stand. */
    reset({ keepNight = false } = {}) {
        this.disposed = false;
        this.epoch += 1;
        this.time = 0;
        this.cursor = 0;
        this.serial = 0;
        this.ringSerial = 0;
        this.ringCursor = 0;
        this.waveSerial = 0;
        this.waveCursor = 0;
        this.combo.reset();
        this.streak = 0;
        this.pendingDrop = 0;
        this.pendingHard = false;
        /** The cascade depth of the lock now resolving (a COMBO event announces the next wave's). */
        this.depth = 1;
        this.b2bRun = 0;
        this.b2bAt = -Infinity;
        /** The fever's own wind: a clock that sends a front through the meadow every so often. */
        this.gale = 0;
        this.crown = 0;
        this.crownTarget = 0;
        this.crownHold = 0;
        this.sweeps = 0;
        this.settled = false;
        this.picked = 0;
        this.pickedCount = 0;
        this.bouquets = 0;
        this.bouquetFlash = 0;
        this.bouquetFading = false;
        if (!keepNight) {
            this.level = 1;
            // Where the night stands: the level's hour, turned to gradually, plus its own drift.
            this.hourTurn = 0;
            this.hourDrift = 0;
        }
        this.species.fill(0);
        this.bouquet.fill(0);
        for (const key of ENVELOPE_KEYS) this.swells[key].reset();
        for (const front of this.fronts) {
            Object.assign(front, {
                active: false, age: 0, direction: FRONT_DIRECTION, strength: 0, target: 0, serial: -1,
            });
        }
        this.sunburst.reset();
        this.surge.reset();
        Object.assign(this.pace, {
            punch: 0, level: 0, fever: 0, stage: 0,
        });
        for (const ring of this.rings) {
            Object.assign(ring, {
                serial: -1, column: 0.5, row: 0, strength: 0,
            });
        }
        for (const wave of this.waves) Object.assign(wave, { serial: -1, column: 0.5, strength: 0 });
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
                flower: SUMMER_MIXED,
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

    /**
     * Call on one flower kind (or, with SUMMER_MIXED, on all seven). Calls accumulate: a second
     * lock of the same flower lifts it further toward full (never past it), so a run of play
     * leaves the meadow lit in the colours it was played in.
     */
    call(flower, amount) {
        const level = clamp(amount, 0, 1);
        if (flower === SUMMER_MIXED) {
            for (let kind = 0; kind < SUMMER_BOUQUET_KINDS; kind += 1) {
                this.species[kind] += (1 - this.species[kind]) * level;
            }
        } else if (flower >= 0 && flower < SPECIES_SLOTS) {
            this.species[flower] += (1 - this.species[flower]) * level;
        }
    }

    /**
     * Claim a free slot, else the one with the least of its work left (an emitter does its work
     * early: a jet that has thrown its petals only lingers), the furthest through its life on a
     * tie. A burst still throwing petals is never cut for a new one.
     */
    emit(kind, {
        side = 0, column = 0.5, row = 0.3, strength = 0.5, lines = 0, duration = 1, flower = SUMMER_MIXED,
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
            const window = WORK_SECONDS[emitter.kind] ?? emitter.duration;
            const left = window > 0 ? clamp(1 - emitter.age / window, 0, 1) * emitter.strength : 0;
            const progress = emitter.age / emitter.duration;
            if (left < least - 1e-9 || (Math.abs(left - least) <= 1e-9 && progress > furthest)) {
                least = left;
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
            flower,
            age: 0,
            duration,
            seed: this.random(),
        });
        this.serial += 1;
        this.cursor = (selected + 1) % this.maxEmitters;
        return this.emitters[selected];
    }

    /** Ask for a ring on the water behind a place on the board. */
    ripple(column, row, strength) {
        const ring = this.rings[this.ringCursor];
        ring.serial = this.ringSerial;
        ring.column = clamp(column, 0, 1);
        ring.row = clamp(row, 0, 1);
        ring.strength = clamp(strength, 0, 3);
        this.ringSerial += 1;
        this.ringCursor = (this.ringCursor + 1) % RING_QUEUE;
        return ring;
    }

    /** Ask for a gust to spread through the meadow from the foot of the board. */
    gust(column, strength) {
        const wave = this.waves[this.waveCursor];
        wave.serial = this.waveSerial;
        wave.column = clamp(column, 0, 1);
        wave.strength = clamp(strength, 0, 3);
        this.waveSerial += 1;
        this.waveCursor = (this.waveCursor + 1) % WAVE_QUEUE;
        return wave;
    }

    /**
     * Send a front of wind across the meadow and the woods with the prevailing breeze. It takes a
     * free slot and runs to the far side; when every slot is crossing it joins the youngest (which
     * eases up to the stronger of the two, and a little more): no front is ever restarted, turned
     * round or cut, so a cascade rolls one wave of wind after another through the grass.
     */
    sweep(strength, { join = 0 } = {}) {
        const value = clamp(strength, 0, 1);
        if (!(value > 0)) return null;
        this.sweeps += 1;
        let free = null;
        let youngest = null;
        for (const front of this.fronts) {
            if (!front.active) {
                if (!free) free = front;
            } else if (!youngest || front.age < youngest.age) youngest = front;
        }
        // `join`: a front this young is the same gust of wind, made stronger (a perfect clear on
        // the quad that set it off).
        if (free && !(youngest && youngest.age < join)) {
            return Object.assign(free, {
                active: true, age: 0, direction: FRONT_DIRECTION, strength: value, target: value, serial: this.sweeps,
            });
        }
        youngest.target = Math.min(1, Math.max(youngest.target, value) + 0.25 * Math.min(youngest.target, value));
        youngest.serial = this.sweeps;
        return youngest;
    }

    /** The front most recently sent (or joined), or a resting one. */
    get front() {
        let newest = null;
        for (const front of this.fronts) {
            if (front.serial >= 0 && (!newest || front.serial > newest.serial)) newest = front;
        }
        return newest || this.fronts[0];
    }

    /** Raise the crown. It never pulls down a crown already turning higher than it asks for. */
    raiseCrown(level) {
        this.crownTarget = Math.max(this.crownTarget, clamp(level, 0, 1), this.crown);
        this.crownHold = CROWN_HOLD_SECONDS;
    }

    /** A rising meadow still lifting its petals (a quad's), or null. */
    risingMeadow() {
        return this.emitters.find((emitter) => emitter.active && emitter.kind === 'rise'
            && emitter.age < WORK_SECONDS.rise) || null;
    }

    /** Pick a flower for the bouquet; the seventh kind completes it. Returns true when it does. */
    pick(flower) {
        if (flower < 0 || flower >= SUMMER_BOUQUET_KINDS) return false;
        const bit = 1 << flower;
        if ((this.picked & bit) !== 0) return false;
        this.picked |= bit;
        this.pickedCount += 1;
        // A finished bouquet stays lit through its flash even if the next one has begun:
        // the kinds picked meanwhile are simply the lanterns that will not burn down.
        this.bouquet[flower] = 1;
        if (this.pickedCount < SUMMER_BOUQUET_KINDS) return false;
        this.picked = 0;
        this.pickedCount = 0;
        this.bouquets += 1;
        this.bouquetFlash = 1;
        this.bouquetFading = true;
        return true;
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

    /**
     * The bookkeeping of a lock without its petals (the theme calls this when lock effects are
     * off): the combo still has to know a lock that cleared nothing ended it.
     */
    noteLock() {
        if (this.disposed) return false;
        this.combo.notePieceLocked();
        this.streak = this.combo.combo;
        this.depth = 1;
        this.pendingDrop = 0;
        this.pendingHard = false;
        return true;
    }

    onPieceLock(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        this.settled = false;
        const drop = this.pendingDrop;
        const hard = this.pendingHard;
        // A lock that follows a lock without a clear between them ends the combo.
        this.noteLock();
        const place = boardPlace(payload);
        const flower = summerFlowerForPiece(payload.piece);
        this.surge.lock({ hardDrop: hard }, this.time);
        const column = place?.column ?? 0.5;
        const row = place?.row ?? 0.12;
        this.excite({
            gust: 0.08 + drop * 0.14, warmth: 0.025 + drop * 0.05, glow: 0.07 + drop * 0.1, shimmer: 0.12 + drop * 0.2,
        });
        this.call(flower, 0.62 + drop * 0.38);
        let side = 0;
        if (place) side = place.column < 0.5 ? -1 : 1;
        this.emit('lock', {
            side, column, row, strength: 0.28 + drop * 0.5, duration: 1.1, flower,
        });
        this.gust(column, 0.5 + drop * 0.8);
        this.ripple(column, row, 0.55 + drop * 0.9);
        if (drop > 0.3) {
            this.emit('seeds', {
                side, column, row: 0, strength: drop, duration: 0.9, flower,
            });
        }
        if (this.pick(flower)) {
            // Seven kinds: the maypole throws the bouquet into the evening.
            this.excite({
                gust: 0.5, warmth: 0.6, shafts: 0.55, glow: 0.85, shimmer: 0.6, flutter: 1,
            });
            this.call(SUMMER_MIXED, 1);
            this.emit('bouquet', { strength: 1, duration: 2.6 });
            this.gust(0.5, 1.5);
        }
        return true;
    }

    onLineClear(countOrPayload = 1, detail = {}) {
        if (this.disposed) return false;
        const event = eventArguments(countOrPayload, detail, ['lineCount', 'lines', 'linesCleared', 'count'], 4);
        const lines = event.count;
        if (lines === 0) return false;
        this.settled = false;
        // Only the first clearing wave of a lock counts a step of the combo; later waves are depth.
        const before = this.combo.combo;
        this.streak = this.combo.noteLineClear();
        const first = this.streak !== before;
        // The cascade depth: the payload's own, else the COMBO event that came just before it.
        const depth = Math.max(1, positiveCount(event.detail.cascadeCount, 12) || this.depth);
        const deep = Math.min(4, depth - 1);
        if (first && deep === 0) this.surge.clear({ lines, combo: this.streak }, this.time);
        else {
            // A later wave of the same lock: worth a wave, not a whole new clear.
            const W = SURGE_WEIGHTS;
            this.surge.punch.hit(W.punch.wave + W.punch.lines[lines] * 0.4, this.time);
            this.surge.level.hit(W.heat.wave + W.heat.lines[lines] * 0.25, this.time);
        }
        const row = clearedRow(event.detail) ?? boardPlace(event.detail)?.row ?? 0.2;
        const four = lines >= 4;
        // Each wave of a cascade builds on the last: stronger jets, a broader ring further out on
        // the lake, a brighter glow, and a front of wind of its own.
        const build = 1 + deep * 0.15;
        this.excite({
            gust: 0.28 + lines * 0.14 + deep * 0.06,
            warmth: 0.14 + lines * 0.11 + (four ? 0.3 : 0),
            shafts: 0.14 + lines * 0.13 + (four ? 0.3 : 0),
            glow: (0.2 + lines * 0.11) * build,
            shimmer: 0.4 + lines * 0.15,
            flock: four ? 1 : 0,
            flutter: 0.2 + lines * 0.2,
        });
        this.call(SUMMER_MIXED, 0.3 + lines * 0.16);
        const strength = Math.min(1, (0.36 + lines * 0.16) * build);
        // Petals are blown out of both sides of the board at the height of the cleared rows.
        this.emit('clear', {
            side: -1, row, strength, lines, duration: 1.5 + lines * 0.12,
        });
        this.emit('clear', {
            side: 1, row, strength, lines, duration: 1.5 + lines * 0.12,
        });
        // One broad ring from under the whole row, and from two lines a second on its heels.
        const out = Math.min(1, row + deep * 0.14);
        this.ripple(0.5, out, 1.1 + lines * 0.36 + deep * 0.25);
        this.gust(0.5, 0.9 + lines * 0.4 + deep * 0.2);
        if (lines >= 2) this.ripple(lines % 2 === 0 ? 0.12 : 0.88, out, 0.7 + lines * 0.2 + deep * 0.15);
        // From two lines a front of wind crosses the meadow; a cascade sends one on every wave.
        if (lines >= 2 || deep > 0) this.sweep(0.3 + lines * 0.17 + deep * 0.08);
        if (four) {
            // The sunburst: the evening sun flares through the maypole's wreath.
            this.sunburst.hit(0.55, this.time);
            this.emit('rise', {
                row: 0, strength: 1, lines, duration: 2.8,
            });
        }
        if (this.streak >= 2) this.raiseCrown(1 - Math.exp(-(this.streak - 1) * 0.3));
        return true;
    }

    /**
     * The bus COMBO is a cascade's depth (it comes before each wave from the second on): a turn of
     * petals around the board, a ring and a gust, all larger the deeper the cascade runs.
     */
    onCombo(countOrPayload, detail = {}) {
        if (this.disposed) return false;
        const event = eventArguments(countOrPayload, detail, ['comboCount', 'combo', 'count'], 60);
        if (event.count < 2) return false;
        this.settled = false;
        // The wave this COMBO announces clears next: its LINE_CLEAR reads the depth from here.
        this.depth = Math.max(this.depth, Math.min(12, event.count));
        const growth = 1 - Math.exp(-(event.count - 1) * 0.22);
        this.excite({
            gust: 0.36 + growth * 0.5,
            warmth: 0.26 + growth * 0.6,
            shafts: 0.3 + growth * 0.6,
            glow: 0.34 + growth * 0.66,
            shimmer: 0.5 + growth * 0.5,
            flutter: 0.4 + growth * 0.6,
        });
        this.call(SUMMER_MIXED, 0.4 + growth * 0.6);
        this.raiseCrown(0.3 + growth * 0.7);
        this.emit('combo', {
            row: 0.1, strength: 0.4 + growth * 0.6, lines: event.count, duration: 1.4,
        });
        // The deeper the cascade, the further out on the lake its ring opens.
        this.ripple(this.random(), 0.05 + 0.1 * Math.min(4, event.count - 1), 0.7 + growth * 0.9);
        this.gust(this.random(), 0.8 + growth);
        return true;
    }

    onTSpin(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        const place = boardPlace(payload);
        // A T-spin that cleared lines adds its own weight to the clear just counted; one that
        // cleared nothing is a little flourish of its own (the garland still spins).
        if (positiveCount(payload.lineCount, 4) > 0) this.surge.tspin(this.time);
        else this.surge.spin(this.time);
        this.excite({
            gust: 0.45, warmth: 0.3, shafts: 0.3, glow: 0.6, shimmer: 0.5, flutter: 0.6,
        });
        this.call(SUMMER_PIECE_FLOWERS.T, 1);
        this.emit('spin', {
            side: place && place.column >= 0.5 ? 1 : -1,
            row: place?.row ?? 0.3,
            strength: 0.8,
            duration: 1.7,
            flower: SUMMER_PIECE_FLOWERS.T,
        });
        this.ripple(place?.column ?? 0.5, place?.row ?? 0.3, 1.2);
        this.gust(place?.column ?? 0.5, 1.1);
        return true;
    }

    /**
     * Back-to-back: the sun answers. A sunburst through the maypole's wreath and its road on the
     * water flaring, each one of a run of them brighter than the last; the crown holds.
     */
    onBackToBack() {
        if (this.disposed) return false;
        this.b2bRun = this.time - this.b2bAt <= B2B_RUN_SECONDS ? this.b2bRun + 1 : 1;
        this.b2bAt = this.time;
        this.surge.b2b(this.time);
        this.sunburst.hit(0.3 + 0.12 * Math.min(4, this.b2bRun - 1), this.time);
        this.excite({
            warmth: 0.5, glow: 0.7, shafts: 0.45, shimmer: 0.6 + 0.1 * Math.min(4, this.b2bRun - 1),
        });
        this.raiseCrown(Math.max(this.crownTarget, 0.55));
        return true;
    }

    /**
     * A perfect clear is the crown on the clear still playing (physics sends it after that
     * clear's last wave): the sunburst blazes on top of the quad's, the maypole throws the
     * bouquet, the front of wind still crossing is joined, not restarted. A meadow still lifting
     * its petals from the quad is not raised a second time.
     */
    onPerfectClear() {
        if (this.disposed) return false;
        this.settled = false;
        this.surge.crown(this.time);
        this.sunburst.hit(1, this.time);
        this.excite({
            gust: 0.9, warmth: 1, shafts: 1, glow: 1, shimmer: 1, flock: 1, flutter: 1,
        });
        this.call(SUMMER_MIXED, 1);
        if (!this.risingMeadow()) {
            this.emit('rise', {
                row: 0, strength: 1, lines: 4, duration: 3.4,
            });
        }
        this.emit('bouquet', { strength: 1, duration: 2.6 });
        this.ripple(0.5, 0.1, 2.6);
        this.ripple(0.5, 0.5, 1.6);
        this.gust(0.5, 2.8);
        this.sweep(1, { join: 0.6 });
        this.raiseCrown(0.85);
        return true;
    }

    /**
     * The level the game stands at. The night turns to that level's hour over the next few
     * seconds, the short way round; no flourish (that is onLevelUp).
     */
    setLevel(level) {
        const whole = positiveCount(level, 99999);
        if (this.disposed || whole === 0) return false;
        this.level = whole;
        return true;
    }

    /** Where the night stands, to carry across a rebuild of the scene. */
    getNight() {
        return { level: this.level, hourTurn: this.hourTurn, hourDrift: this.hourDrift };
    }

    /** Take up a night that getNight() handed out; anything unusable in it is left alone. */
    restoreNight(night) {
        if (this.disposed || !isObject(night)) return false;
        this.setLevel(night.level);
        if (Number.isFinite(night.hourTurn)) this.hourTurn = wrapSummerHour(night.hourTurn);
        if (Number.isFinite(night.hourDrift)) this.hourDrift = wrapSummerHour(night.hourDrift);
        return true;
    }

    /** Hold the night at one phase (captures and tests); anything but a number lets it run. */
    pinHour(phase) {
        this.hourPin = typeof phase === 'number' && Number.isFinite(phase) ? wrapSummerHour(phase) : null;
    }

    onLevelUp(detail = {}) {
        if (this.disposed) return false;
        // The event names the level reached; one without a usable level counts as the next.
        if (!this.setLevel(unwrap(detail).level)) this.setLevel(this.level + 1);
        this.surge.levelUp(this.time);
        this.excite({
            gust: 0.6, warmth: 0.55, shafts: 0.6, glow: 0.8, shimmer: 0.8, flock: 0.7, flutter: 0.8,
        });
        this.call(SUMMER_MIXED, 0.8);
        this.ripple(0.5, 0.1, 1.8);
        this.gust(0.5, 1.8);
        this.sweep(0.75);
        return true;
    }

    /** The session ended: let the wind die and the petals settle onto the grass and the water. */
    onGameOver() {
        if (this.disposed) return false;
        this.crownTarget = 0;
        this.crownHold = 0;
        this.combo.reset();
        this.streak = 0;
        // The wind dies: fronts still crossing ease away instead of snapping the meadow upright.
        for (const front of this.fronts) front.target = 0;
        this.settled = true;
        return true;
    }

    update(dt) {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return this.getFrame();
        this.time += dt;
        // The night turns toward the level's hour by the shorter way round, and drifts on.
        const hours = SUMMER_HOURS.length;
        let turn = summerHourForLevel(this.level) - this.hourTurn;
        turn -= hours * Math.round(turn / hours);
        if (Math.abs(turn) < 0.0005) this.hourTurn = summerHourForLevel(this.level);
        else this.hourTurn = wrapSummerHour(this.hourTurn + turn * (1 - Math.exp(-dt / SUMMER_HOUR_TURN_SECONDS)));
        if (this.hourSeconds > 0) this.hourDrift = wrapSummerHour(this.hourDrift + dt / this.hourSeconds);
        const sampled = this.surge.sample(this.time);
        this.pace.punch = sampled.punch;
        this.pace.level = sampled.level;
        this.pace.fever = sampled.fever;
        this.pace.stage = sampled.stage;
        const fade = Math.exp(-SPECIES_DECAY * dt);
        for (let kind = 0; kind < SPECIES_SLOTS; kind += 1) {
            this.species[kind] *= fade;
            if (this.species[kind] < 0.0005) this.species[kind] = 0;
        }
        this.bouquetFlash *= Math.exp(-BOUQUET_FLASH_DECAY * dt);
        if (this.bouquetFlash < 0.0005) this.bouquetFlash = 0;
        if (this.bouquetFading) {
            // The lanterns of a finished bouquet hold through its flash, then burn down — all
            // but the kinds already picked for the next one.
            const burn = Math.exp(-BOUQUET_FADE_RATE * dt * (this.bouquetFlash < 0.35 ? 1 : 0));
            let burning = 0;
            for (let kind = 0; kind < SUMMER_BOUQUET_KINDS; kind += 1) {
                if ((this.picked & (1 << kind)) !== 0) this.bouquet[kind] = 1;
                else {
                    this.bouquet[kind] *= burn;
                    if (this.bouquet[kind] < 0.004) this.bouquet[kind] = 0;
                    burning += this.bouquet[kind];
                }
            }
            if (burning === 0) this.bouquetFading = false;
        }
        // The crown rises quickly to its target, holds while clears keep coming, then unwinds.
        if (this.crownHold > 0) {
            this.crownHold = Math.max(0, this.crownHold - dt);
            this.crown += (this.crownTarget - this.crown) * (1 - Math.exp(-dt * 3.2));
        } else {
            this.crownTarget = 0;
            this.crown *= Math.exp(-CROWN_RELEASE_RATE * dt);
            if (this.crown < 0.0005) this.crown = 0;
        }
        const ease = 1 - Math.exp(-dt * FRONT_EASE);
        for (const front of this.fronts) {
            if (!front.active) continue;
            front.age += dt;
            front.strength += (front.target - front.strength) * ease;
            if (front.age >= FRONT_SECONDS || (front.target === 0 && front.strength < 0.002)) {
                front.active = false;
                front.strength = 0;
                front.target = 0;
            }
        }
        this.blowGale(dt);
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

    /**
     * A fever's own wind: while it burns, a front rolls through the meadow and the birches every
     * second or two (quicker the hotter it burns), whenever a slot is free and the last has gone
     * on ahead. Events keep sending their own fronts on top.
     */
    blowGale(dt) {
        const { fever } = this.pace;
        if (this.settled || fever < 0.2) {
            this.gale = 0;
            return;
        }
        this.gale = Math.min(1, this.gale + dt * (0.45 + 0.4 * fever));
        if (this.gale < 1) return;
        let free = false;
        let youngest = Infinity;
        for (const front of this.fronts) {
            if (!front.active) free = true;
            else youngest = Math.min(youngest, front.age);
        }
        if (!free || youngest < 0.8) return;
        this.gale = 0;
        this.sweep(0.2 + 0.4 * fever);
    }

    /** Where a crossing front is on screen, and how hard it pushes there. */
    static frontFrame(front) {
        const travel = clamp(front.age / FRONT_SECONDS, 0, 1);
        return {
            // -1.4 .. 1.4 across the view, in the direction of travel.
            position: (travel * 2.8 - 1.4) * front.direction,
            direction: front.direction,
            strength: clamp(front.strength * Math.sin(Math.PI * Math.min(1, travel * 1.15)), 0, 1),
        };
    }

    getFrame() {
        const { front } = this;
        const fronts = [];
        for (const crossing of this.fronts) {
            if (crossing.active) fronts.push(SummerReactions.frontFrame(crossing));
        }
        return {
            ...this.envelopes,
            epoch: this.epoch,
            level: this.level,
            // Phase on the circle of hours (0 evening … 5 evening again).
            hour: this.hourPin ?? wrapSummerHour(this.hourTurn + this.hourDrift),
            crown: this.crown,
            // The crown only brightens once it has really built.
            heat: clamp((this.crown - 0.5) / 0.42, 0, 1),
            // Ribbons unfurl around the board with the upper half of a combo.
            ribbons: clamp((this.crown - 0.3) / 0.5, 0, 1),
            streak: this.streak,
            settled: this.settled,
            species: this.species,
            bouquet: this.bouquet,
            bouquetFlash: this.bouquetFlash,
            bouquets: this.bouquets,
            picked: this.pickedCount,
            // The newest front; every front still crossing is in `fronts`.
            front: front.active ? SummerReactions.frontFrame(front) : null,
            fronts,
            // The sun answering a quad, a back-to-back and (most of all) a perfect clear.
            sunburst: this.sunburst.valueAt(this.time),
            // How hot play runs (shared/gameplay-surge.js): SummerWorld spends it on the evening.
            surge: {
                punch: this.pace.punch, level: this.pace.level, fever: this.pace.fever, stage: this.pace.stage,
            },
            rings: this.rings,
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
