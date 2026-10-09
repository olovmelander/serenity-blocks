/**
 * Verdant Hills — how the hills answer the game.
 *
 * A pure, seconds-based director: gameplay events become a small set of decaying light and
 * wind envelopes, a slow wind dial, the seven kites and how high they stand, bounded
 * "emitters" described in board space (which side of the board, how high, how strong, which
 * kite), ribbons of wind to draw away from the board and gusts to send through the grass.
 * VerdantHillsWorld turns them into ribbons, seed, kites and light; nothing here touches
 * the scene, so the same director runs in tests, the playground and the game.
 *
 * The wind answers the game, and every tetromino is one of seven kites:
 *   I poppy red · O cerulean · T sunflower · S fuchsia · Z teal · J tangerine · L violet
 * (The slots are VERDANT_HILLS_PIECE_KITES; the colours are the pieces' own, see
 * verdant-hills-tetrominos.js.)
 *
 * The language:
 *   lock          a ribbon of wind curls away from the board beside the piece, a gust
 *                 spreads through the grass from the foot of the board, and the piece's own
 *                 kite goes up; a long hard drop also shakes dandelion seed into the air
 *   kites         a kite flies for as long as it has line (twenty seconds from its last
 *                 lock) and then comes down; all seven aloft at once is the kite festival:
 *                 the wind freshens, the clouds open and every kite climbs to the top of
 *                 its line
 *   line clear    ribbons stream from both sides of the board at the cleared rows, the wind
 *                 picks up and every flying kite stands higher; from two lines a front of
 *                 wind crosses the valley
 *   four lines    all of that, seed lifting off the whole hillside, the birds going up, and
 *                 the clouds open: a pool of sunlight crosses the hills
 *   combo/streak  the wind winds around the board; the whirl climbs, tightens and quickens
 *                 as cascades or consecutive clears build, and streamers unfurl in it
 *   t-spin        a spinning ribbon in the colour of the T's kite beside the board
 *   perfect clear / level up   the whole day exhales: light, wind, ribbons, wings; a
 *                 perfect clear puts all seven kites in the air
 */
import { VERDANT_HILLS_PIECE_KITES } from './verdant-hills-tetrominos.js';

export const VERDANT_HILLS_REACTION_LIMITS = Object.freeze({
    Minimal: 4,
    Low: 6,
    Medium: 8,
    High: 12,
    Ultra: 14,
    Extreme: 16,
});

export const VERDANT_HILLS_KITES = 7;
/** A kite slot for ribbons and seed that belong to no one piece. */
export const VERDANT_HILLS_MIXED = -1;
/** How long a kite stays up after the lock that launched it. */
export const VERDANT_HILLS_KITE_LINE_SECONDS = 20;

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
const WIND_HOLD_SECONDS = 1.6;
const WIND_DECAY = 0.11;
const KITE_RISE_RATE = 1.5;
const KITE_FALL_RATE = 0.45;
const KITE_TUG_DECAY = 1.8;
const HEIGHT_HOLD_SECONDS = 3.2;
const HEIGHT_RISE_RATE = 2.2;
const HEIGHT_RELEASE_RATE = 0.3;
const FESTIVAL_FLASH_DECAY = 0.55;
/** A festival can be held again once this few kites are left in the air. */
const FESTIVAL_REARM_ALOFT = 4;
const WHIRL_HOLD_SECONDS = 2.6;
const WHIRL_RISE_RATE = 3.2;
const WHIRL_RELEASE_RATE = 0.85;
const FRONT_SECONDS = 2.6;
const SUNBREAK_SECONDS = 6;
// One frame can ask for a gust from a lock, its festival, a clear, a combo, a spin, a perfect
// clear and a level-up: the queue holds them all.
const WAVE_QUEUE = 8;
// The same frame asks for a ribbon from the lock and its festival, two from the clear and a
// third for four lines, and one each from the spin, the perfect clear and the level-up.
const STREAK_QUEUE = 16;
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

/** The kite a piece flies, or VERDANT_HILLS_MIXED when the payload names none. */
export function verdantHillsKiteForPiece(piece) {
    if (!isObject(piece)) return VERDANT_HILLS_MIXED;
    for (const key of [piece.shapeKey, piece.type, piece.pieceId, piece.color]) {
        if (typeof key === 'string'
            && Object.prototype.hasOwnProperty.call(VERDANT_HILLS_PIECE_KITES, key.toUpperCase())) {
            return VERDANT_HILLS_PIECE_KITES[key.toUpperCase()];
        }
    }
    return VERDANT_HILLS_MIXED;
}

export class VerdantHillsReactions {
    constructor({ quality = 'High', rng = Math.random } = {}) {
        const requestedQuality = typeof quality === 'string' ? quality.toLowerCase() : '';
        this.quality = Object.keys(VERDANT_HILLS_REACTION_LIMITS)
            .find((tier) => tier.toLowerCase() === requestedQuality)
            || (requestedQuality === 'med' ? 'Medium' : 'High');
        this.maxEmitters = VERDANT_HILLS_REACTION_LIMITS[this.quality];
        this.rng = typeof rng === 'function' ? rng : Math.random;
        this.emitters = Array.from({ length: this.maxEmitters }, (_, id) => ({ id }));
        this.waves = Array.from({ length: WAVE_QUEUE }, () => ({ serial: -1, column: 0.5, strength: 0 }));
        this.streaks = Array.from({ length: STREAK_QUEUE }, () => ({ serial: -1 }));
        this.envelopes = Object.fromEntries(ENVELOPE_KEYS.map((key) => [key, 0]));
        /** Seconds of line each of the seven kites has left. */
        this.line = new Float32Array(VERDANT_HILLS_KITES);
        /** How far up each kite is, 0 on the grass to 1 flying. */
        this.fly = new Float32Array(VERDANT_HILLS_KITES);
        /** The jerk on each line when its piece locks. */
        this.tug = new Float32Array(VERDANT_HILLS_KITES);
        this.front = {
            active: false, age: 0, direction: 1, strength: 0,
        };
        /** The pool of sunlight that crosses the hills when the clouds open. */
        this.sunpool = { active: false, age: 0, strength: 0 };
        // Counts resets, so a consumer can tell a fresh run of serials from a stale one.
        this.epoch = 0;
        this.reset();
    }

    reset() {
        this.disposed = false;
        this.epoch += 1;
        this.time = 0;
        this.cursor = 0;
        this.serial = 0;
        this.waveSerial = 0;
        this.waveCursor = 0;
        this.streakSerial = 0;
        this.streakCursor = 0;
        // Consecutive clearing locks. (`streak` itself is the ribbon method below.)
        this.clearStreak = 0;
        this.clearedSinceLock = false;
        this.pendingDrop = 0;
        this.wind = 0;
        this.windHold = 0;
        this.height = 0;
        this.heightTarget = 0;
        this.heightHold = 0;
        this.whirl = 0;
        this.whirlTarget = 0;
        this.whirlHold = 0;
        this.festivals = 0;
        this.festivalFlash = 0;
        this.festivalArmed = true;
        this.settled = false;
        this.line.fill(0);
        this.fly.fill(0);
        this.tug.fill(0);
        for (const key of ENVELOPE_KEYS) this.envelopes[key] = 0;
        Object.assign(this.front, {
            active: false, age: 0, direction: 1, strength: 0,
        });
        Object.assign(this.sunpool, { active: false, age: 0, strength: 0 });
        for (const wave of this.waves) Object.assign(wave, { serial: -1, column: 0.5, strength: 0 });
        for (const ribbon of this.streaks) {
            Object.assign(ribbon, {
                serial: -1,
                kind: 'lock',
                side: 0,
                column: 0.5,
                row: 0.3,
                strength: 0,
                lines: 0,
                kite: VERDANT_HILLS_MIXED,
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
                kite: VERDANT_HILLS_MIXED,
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

    /** How many kites have line left. */
    get aloft() {
        let count = 0;
        for (let slot = 0; slot < VERDANT_HILLS_KITES; slot += 1) {
            if (this.line[slot] > 0) count += 1;
        }
        return count;
    }

    excite(values) {
        for (const key of ENVELOPE_KEYS) {
            const value = Number.isFinite(values[key]) ? clamp(values[key], 0, 1) : 0;
            this.envelopes[key] = Math.max(this.envelopes[key], value);
        }
    }

    /** Turn the wind dial up; it holds for a moment before it starts to drop again. */
    blow(amount) {
        const gain = Number.isFinite(amount) ? Math.max(0, amount) : 0;
        this.wind = Math.min(1, this.wind + gain);
        this.windHold = WIND_HOLD_SECONDS;
    }

    /** Put a kite in the air with a full line, or pay a flying one out again. */
    launch(slot) {
        if (!Number.isInteger(slot) || slot < 0 || slot >= VERDANT_HILLS_KITES) return false;
        this.line[slot] = VERDANT_HILLS_KITE_LINE_SECONDS;
        this.tug[slot] = 1;
        return true;
    }

    /** Lift every flying kite toward a height on its line; the highest call wins while it holds. */
    raise(level) {
        this.heightTarget = Math.max(this.heightTarget, Number.isFinite(level) ? clamp(level, 0, 1) : 0);
        this.heightHold = HEIGHT_HOLD_SECONDS;
    }

    raiseWhirl(level) {
        this.whirlTarget = Math.max(this.whirlTarget, clamp(level, 0, 1));
        this.whirlHold = WHIRL_HOLD_SECONDS;
    }

    /** Send a front of wind across the valley. It always travels with the wind. */
    sweep(strength) {
        Object.assign(this.front, {
            active: true, age: 0, direction: 1, strength: clamp(strength, 0, 1),
        });
    }

    /** Open the clouds: a pool of sunlight sets out across the hills. */
    sunbreak(strength) {
        Object.assign(this.sunpool, { active: true, age: 0, strength: clamp(strength, 0, 1) });
    }

    /** Claim a free slot, or the one furthest through its life. */
    emit(kind, {
        side = 0, column = 0.5, row = 0.3, strength = 0.5, lines = 0, duration = 1, kite = VERDANT_HILLS_MIXED,
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
            kite,
            age: 0,
            duration,
            seed: this.random(),
        });
        this.serial += 1;
        this.cursor = (selected + 1) % this.maxEmitters;
        return this.emitters[selected];
    }

    /** Ask for a gust to spread through the grass from the foot of the board. */
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
     * Ask for a ribbon of wind from a place on the board. `side` is -1 or +1 for the edge it
     * leaves from, 0 for a ribbon that belongs to neither (or to both).
     */
    streak(kind, {
        side = 0, column = 0.5, row = 0.3, strength = 0.5, lines = 0, kite = VERDANT_HILLS_MIXED,
    } = {}) {
        const ribbon = this.streaks[this.streakCursor];
        ribbon.serial = this.streakSerial;
        ribbon.kind = kind;
        ribbon.side = Math.sign(side) || 0;
        ribbon.column = clamp(column, 0, 1);
        ribbon.row = clamp(row, 0, 1);
        ribbon.strength = clamp(strength, 0, 1);
        ribbon.lines = lines;
        ribbon.kite = kite;
        this.streakSerial += 1;
        this.streakCursor = (this.streakCursor + 1) % STREAK_QUEUE;
        return ribbon;
    }

    /** Seven kites aloft at once is the kite festival. Returns true when this call began one. */
    checkFestival() {
        if (!this.festivalArmed || this.aloft < VERDANT_HILLS_KITES) return false;
        this.festivals += 1;
        this.festivalFlash = 1;
        // One festival for one sky full of kites: the next needs some of them to come down first.
        this.festivalArmed = false;
        this.excite({
            gust: 0.6, warmth: 0.7, shafts: 0.7, glow: 0.9, shimmer: 0.7, flock: 1, flutter: 1,
        });
        this.blow(0.5);
        this.raise(1);
        this.sunbreak(1);
        this.emit('festival', { strength: 1, duration: 2.6 });
        this.streak('festival', { side: 0, row: 0.6, strength: 1 });
        this.gust(0.5, 1.6);
        return true;
    }

    onHardDrop(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        const distance = Number.isFinite(payload.distance) ? payload.distance
            : (Number(payload.endY) - Number(payload.startY));
        this.pendingDrop = Number.isFinite(distance) ? clamp(distance / BOARD_VISIBLE_ROWS, 0, 1) : 0;
        return true;
    }

    onPieceLock(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        this.settled = false;
        // A lock that follows a lock without a clear between them ends the streak.
        if (!this.clearedSinceLock) this.clearStreak = 0;
        this.clearedSinceLock = false;
        const place = boardPlace(payload);
        const kite = verdantHillsKiteForPiece(payload.piece);
        const drop = this.pendingDrop;
        this.pendingDrop = 0;
        const column = place?.column ?? 0.5;
        const row = place?.row ?? 0.12;
        this.excite({
            gust: 0.08 + drop * 0.14,
            warmth: 0.02 + drop * 0.04,
            glow: 0.06 + drop * 0.1,
            shimmer: 0.14 + drop * 0.22,
            flutter: 0.1 + drop * 0.2,
        });
        this.blow(0.03 + drop * 0.05);
        // A lock that cannot be placed has no side of its own: it takes them in turn, and its
        // ribbon and its seed leave from the same one.
        let side = this.serial % 2 === 0 ? -1 : 1;
        if (place) side = place.column < 0.5 ? -1 : 1;
        this.streak('lock', {
            side, column, row, strength: 0.3 + drop * 0.5, kite,
        });
        this.emit('lock', {
            side, column, row, strength: 0.28 + drop * 0.5, duration: 1.1, kite,
        });
        this.gust(column, 0.5 + drop * 0.8);
        if (drop > 0.3) {
            this.emit('seeds', {
                side, column, row: 0, strength: drop, duration: 0.9, kite,
            });
        }
        // The piece's kite goes up, and the seventh in the air at once begins the festival.
        if (this.launch(kite)) this.checkFestival();
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
            this.clearStreak += 1;
        }
        const row = clearedRow(event.detail) ?? boardPlace(event.detail)?.row ?? 0.2;
        const four = lines >= 4;
        this.excite({
            gust: 0.28 + lines * 0.14,
            warmth: 0.12 + lines * 0.1 + (four ? 0.3 : 0),
            shafts: 0.14 + lines * 0.13 + (four ? 0.3 : 0),
            glow: 0.2 + lines * 0.11,
            shimmer: 0.4 + lines * 0.15,
            flock: four ? 1 : 0,
            flutter: 0.2 + lines * 0.2,
        });
        this.blow(0.08 + lines * 0.07);
        // Every flying kite stands higher, and higher still while the clears keep coming.
        this.raise(Math.min(1, 0.22 + lines * 0.15 + Math.max(0, this.clearStreak - 1) * 0.12));
        const strength = 0.36 + lines * 0.16;
        // The wind streams out of both sides of the board at the height of the cleared rows.
        this.emit('clear', {
            side: -1, row, strength, lines, duration: 1.5 + lines * 0.12,
        });
        this.emit('clear', {
            side: 1, row, strength, lines, duration: 1.5 + lines * 0.12,
        });
        this.streak('clear', {
            side: -1, row, strength: 0.4 + lines * 0.15, lines,
        });
        this.streak('clear', {
            side: 1, row, strength: 0.4 + lines * 0.15, lines,
        });
        this.gust(0.5, 0.9 + lines * 0.4);
        if (lines >= 2) this.sweep(0.3 + lines * 0.17);
        if (four) {
            this.emit('rise', {
                row: 0, strength: 1, lines, duration: 2.8,
            });
            this.sunbreak(1);
            this.streak('great', {
                side: 0, row, strength: 1, lines,
            });
        }
        if (this.clearStreak >= 2) this.raiseWhirl(1 - Math.exp(-(this.clearStreak - 1) * 0.3));
        return true;
    }

    onCombo(countOrPayload, detail = {}) {
        if (this.disposed) return false;
        const event = eventArguments(countOrPayload, detail, ['comboCount', 'combo', 'count'], 60);
        if (event.count < 2) return false;
        this.settled = false;
        const growth = 1 - Math.exp(-(event.count - 1) * 0.22);
        this.excite({
            gust: 0.36 + growth * 0.5,
            warmth: 0.26 + growth * 0.6,
            shafts: 0.3 + growth * 0.6,
            glow: 0.34 + growth * 0.66,
            shimmer: 0.5 + growth * 0.5,
            flutter: 0.4 + growth * 0.6,
        });
        this.blow(0.1 + growth * 0.3);
        this.raise(0.4 + growth * 0.6);
        this.raiseWhirl(0.3 + growth * 0.7);
        this.emit('combo', {
            row: 0.1, strength: 0.4 + growth * 0.6, lines: event.count, duration: 1.4,
        });
        this.gust(this.random(), 0.8 + growth);
        return true;
    }

    onTSpin(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        const place = boardPlace(payload);
        const side = place && place.column >= 0.5 ? 1 : -1;
        const row = place?.row ?? 0.3;
        this.excite({
            gust: 0.45, warmth: 0.3, shafts: 0.3, glow: 0.6, shimmer: 0.5, flutter: 0.6,
        });
        this.blow(0.2);
        this.streak('spin', {
            side, row, strength: 0.8, kite: VERDANT_HILLS_PIECE_KITES.T,
        });
        this.emit('spin', {
            side, row, strength: 0.8, duration: 1.7, kite: VERDANT_HILLS_PIECE_KITES.T,
        });
        this.gust(place?.column ?? 0.5, 1.1);
        return true;
    }

    onBackToBack() {
        if (this.disposed) return false;
        this.excite({
            warmth: 0.5, glow: 0.7, shafts: 0.45, shimmer: 0.6,
        });
        this.raiseWhirl(Math.max(this.whirlTarget, 0.55));
        this.raise(0.6);
        return true;
    }

    onPerfectClear() {
        if (this.disposed) return false;
        this.settled = false;
        this.excite({
            gust: 0.9, warmth: 1, shafts: 1, glow: 1, shimmer: 1, flock: 1, flutter: 1,
        });
        this.blow(0.6);
        this.raise(1);
        this.emit('rise', {
            row: 0, strength: 1, lines: 4, duration: 3.4,
        });
        this.streak('great', {
            side: 0, row: 0.5, strength: 1, lines: 4,
        });
        this.gust(0.5, 2.8);
        this.sweep(1);
        this.sunbreak(1);
        this.raiseWhirl(0.85);
        // An empty board flies every kite there is.
        for (let slot = 0; slot < VERDANT_HILLS_KITES; slot += 1) this.launch(slot);
        this.checkFestival();
        return true;
    }

    onLevelUp() {
        if (this.disposed) return false;
        this.excite({
            gust: 0.6, warmth: 0.55, shafts: 0.6, glow: 0.8, shimmer: 0.8, flock: 0.7, flutter: 0.8,
        });
        this.blow(0.3);
        this.raise(0.7);
        this.gust(0.5, 1.8);
        this.sweep(0.75);
        this.streak('great', {
            side: 0, row: 0.5, strength: 0.7, lines: 2,
        });
        return true;
    }

    /** The session ended: let the wind drop, the whirl unwind and the kites come down. */
    onGameOver() {
        if (this.disposed) return false;
        this.whirlTarget = 0;
        this.whirlHold = 0;
        this.clearStreak = 0;
        this.front.active = false;
        this.sunpool.active = false;
        this.line.fill(0);
        // An empty sky can fill for a festival again.
        this.festivalArmed = true;
        this.windHold = 0;
        this.heightTarget = 0;
        this.heightHold = 0;
        this.settled = true;
        return true;
    }

    update(dt) {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return this.getFrame();
        this.time += dt;
        for (const key of ENVELOPE_KEYS) {
            this.envelopes[key] *= Math.exp(-DECAY_RATES[key] * dt);
            if (this.envelopes[key] < 0.00001) this.envelopes[key] = 0;
        }
        // The wind dial holds where the last event left it, then drops slowly.
        if (this.windHold > 0) {
            this.windHold = Math.max(0, this.windHold - dt);
        } else {
            this.wind *= Math.exp(-WIND_DECAY * dt);
            if (this.wind < 0.0005) this.wind = 0;
        }
        // A kite goes up briskly while it has line and sinks slowly once it has run out.
        const slack = Math.exp(-KITE_TUG_DECAY * dt);
        for (let slot = 0; slot < VERDANT_HILLS_KITES; slot += 1) {
            this.line[slot] = Math.max(0, this.line[slot] - dt);
            const target = this.line[slot] > 0 ? 1 : 0;
            const rate = target > this.fly[slot] ? KITE_RISE_RATE : KITE_FALL_RATE;
            this.fly[slot] += (target - this.fly[slot]) * (1 - Math.exp(-dt * rate));
            if (target === 0 && this.fly[slot] < 0.0005) this.fly[slot] = 0;
            this.tug[slot] *= slack;
            if (this.tug[slot] < 0.0005) this.tug[slot] = 0;
        }
        if (!this.festivalArmed && this.aloft <= FESTIVAL_REARM_ALOFT) this.festivalArmed = true;
        this.festivalFlash *= Math.exp(-FESTIVAL_FLASH_DECAY * dt);
        if (this.festivalFlash < 0.0005) this.festivalFlash = 0;
        // The kites climb to the height asked of them, hold it while events keep coming, then sink.
        if (this.heightHold > 0) {
            this.heightHold = Math.max(0, this.heightHold - dt);
            this.height += (this.heightTarget - this.height) * (1 - Math.exp(-dt * HEIGHT_RISE_RATE));
        } else {
            this.heightTarget = 0;
            this.height *= Math.exp(-HEIGHT_RELEASE_RATE * dt);
            if (this.height < 0.0005) this.height = 0;
        }
        // The whirl winds up quickly to its target, holds while clears keep coming, then unwinds.
        if (this.whirlHold > 0) {
            this.whirlHold = Math.max(0, this.whirlHold - dt);
            this.whirl += (this.whirlTarget - this.whirl) * (1 - Math.exp(-dt * WHIRL_RISE_RATE));
        } else {
            this.whirlTarget = 0;
            this.whirl *= Math.exp(-WHIRL_RELEASE_RATE * dt);
            if (this.whirl < 0.0005) this.whirl = 0;
        }
        if (this.front.active) {
            this.front.age += dt;
            if (this.front.age >= FRONT_SECONDS) this.front.active = false;
        }
        if (this.sunpool.active) {
            this.sunpool.age += dt;
            if (this.sunpool.age >= SUNBREAK_SECONDS) this.sunpool.active = false;
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

    getFrame() {
        const { front, sunpool } = this;
        const travel = clamp(front.age / FRONT_SECONDS, 0, 1);
        const progress = clamp(sunpool.age / SUNBREAK_SECONDS, 0, 1);
        return {
            ...this.envelopes,
            epoch: this.epoch,
            wind: this.wind,
            whirl: this.whirl,
            // The whirl only brightens once it has really built.
            heat: clamp((this.whirl - 0.5) / 0.42, 0, 1),
            // Streamers unfurl around the board with the upper half of a combo.
            streamers: clamp((this.whirl - 0.3) / 0.5, 0, 1),
            streak: this.clearStreak,
            settled: this.settled,
            kites: this.fly,
            kiteTug: this.tug,
            height: this.height,
            aloft: this.aloft,
            festival: this.festivalFlash,
            festivals: this.festivals,
            front: front.active ? {
                // -1.4 .. 1.4 across the view, downwind.
                position: travel * 2.8 - 1.4,
                direction: 1,
                strength: front.strength * Math.sin(Math.PI * Math.min(1, travel * 1.15)),
            } : null,
            sunbreak: sunpool.active ? {
                // 0 as the clouds open, 1 as the pool of light leaves the far hills.
                progress,
                strength: sunpool.strength * Math.max(0, Math.sin(Math.PI * Math.min(1, progress * 1.08))) ** 0.7,
            } : null,
            waves: this.waves,
            streaks: this.streaks,
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
