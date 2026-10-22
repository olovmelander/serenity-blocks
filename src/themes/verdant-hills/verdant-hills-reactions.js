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
 *   back-to-back  every kite on its line bows at once and two golden ribbons cross behind
 *                 the board, more of them the longer the back-to-backs run
 *   perfect clear / level up   the whole day exhales: light, wind, ribbons, wings; a
 *                 perfect clear puts all seven kites in the air
 *
 * And it BUILDS (src/themes/shared/gameplay-surge.js): nothing an event starts is restarted
 * by the next one. Fronts of wind run in three slots, each to the far side of the valley (a
 * fourth joins the youngest, which carries on stronger); a break in the clouds that is still
 * crossing is fed (it swells back to its fullest, widens and lingers) instead of closing and
 * reopening from the left; the light's envelopes add up under rapid clears instead of only
 * holding the highest. The surge's level and fever ride in every frame (`surge`): the world
 * spends them (verdant-hills-surge.js), and a fever holds the clouds open over the valley
 * until it cools. A chain that ends lets its whirl go down the wind; the game ending lets the
 * front and the sunlight fade rather than vanish. `still` is Reduce motion's share (0..1).
 */
import { GameplaySurge } from '../shared/gameplay-surge.js';
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
/** Fronts that can cross the valley at once; another joins the youngest still crossing. */
export const VERDANT_HILLS_FRONT_SLOTS = 3;
/** How fast a joined front eases to its new strength, and a front lets go when the game ends. */
const FRONT_EASE = 3;
const SUNBREAK_SECONDS = 6;
/** Where on its course the light of a break in the clouds is fullest (sin(π·1.08·p) peaks). */
const SUNBREAK_PEAK = 0.5 / 1.08;
/** How fast a fed break swells back toward its fullest (course per second), and how long it holds there. */
const SUNBREAK_REWIND = 0.22;
const SUNBREAK_HOLD = 2.4;
/** How fast a held break crosses the valley, against a plain one. */
const SUNBREAK_LINGER = 0.45;
/** How much wider each feed opens it (of the most it can widen). */
const SUNBREAK_WIDEN = 0.4;
/** A held or fed break never runs off the far side while it is lit. */
const SUNBREAK_FAR = 0.995;
/** A fever holds the clouds open from here, until the pool has crossed this far. */
const FEVER_SUNBREAK = 0.6;
const FEVER_SUNBREAK_REACH = 0.8;
/** How fast the front and the sunlight fade once the game is over (per second). */
const SETTLE_FADE = 2.2;
/** What a hit adds to an envelope already lit, of what is left below full. */
const ACCUMULATE = 0.5;
/** How fast Reduce motion's share follows the setting (per second). */
const STILL_RATE = 1;
/** A back-to-back this long after the last one starts a new run of them. */
const B2B_RUN_SECONDS = 20;
/** A chain at least this long lets its whirl go down the wind when it ends. */
const RELEASE_STREAK = 3;
// One frame can ask for a gust from a lock, its festival, a clear, a combo, a spin, a perfect
// clear and a level-up: the queue holds them all.
const WAVE_QUEUE = 8;
// The same frame asks for a ribbon from the lock and its festival, two from the clear and a
// third for four lines, and one each from the spin, the back-to-back, the perfect clear, the
// level-up and a chain that ends: the queue holds them all twice over.
const STREAK_QUEUE = 20;
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
        /** The fronts of wind crossing the valley (see sweep()). */
        this.fronts = Array.from({ length: VERDANT_HILLS_FRONT_SLOTS }, () => ({
            active: false, age: 0, direction: 1, strength: 0, target: 0, serial: -1,
        }));
        /**
         * The pool of sunlight that crosses the hills when the clouds open: `travel` is how far
         * it has crossed, `glow` where its light stands in its own course (the two go together
         * until the pool is fed), `hold` how long a feed keeps it at its fullest, `breadth` how
         * much wider than a plain one it has opened, `fade` what the end of a game has left of it.
         */
        this.sunpool = {
            active: false,
            age: 0,
            travel: 0,
            glow: 0,
            strength: 0,
            want: 0,
            breadth: 0,
            wide: 0,
            hold: 0,
            held: false,
            fade: 1,
        };
        /** How hot play runs: GameplaySurge, read once a frame into `surgeFrame`. */
        this.surge = new GameplaySurge();
        this.surgeFrame = {
            level: 0, fever: 0, stage: 0, punch: 0,
        };
        /** Reduce motion's share (0 all of the motion, 1 stilled): a setting, kept across sessions. */
        this.still = 0;
        this.stillTarget = 0;
        this.stillKnown = false;
        // Counts resets, so a consumer can tell a fresh run of serials from a stale one.
        this.epoch = 0;
        this.reset();
    }

    /** The front most recently sent (or joined), or a resting one. */
    get front() {
        let newest = null;
        for (const front of this.fronts) {
            if (front.serial >= 0 && (!newest || front.serial > newest.serial)) newest = front;
        }
        return newest || this.fronts[0];
    }

    /**
     * Reduce motion (Settings or the system): the gusts, ribbons, seed, whirl and kites calm to a
     * share of their motion. The first call settles at once; later ones ease over a second.
     */
    setStill(on) {
        this.stillTarget = on ? 1 : 0;
        if (!this.stillKnown) {
            this.stillKnown = true;
            this.still = this.stillTarget;
        }
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
        this.frontSerial = 0;
        this.b2bRun = 0;
        this.b2bAt = -Infinity;
        this.line.fill(0);
        this.fly.fill(0);
        this.tug.fill(0);
        for (const key of ENVELOPE_KEYS) this.envelopes[key] = 0;
        for (const front of this.fronts) {
            Object.assign(front, {
                active: false, age: 0, direction: 1, strength: 0, target: 0, serial: -1,
            });
        }
        Object.assign(this.sunpool, {
            active: false,
            age: 0,
            travel: 0,
            glow: 0,
            strength: 0,
            want: 0,
            breadth: 0,
            wide: 0,
            hold: 0,
            held: false,
            fade: 1,
        });
        this.surge.reset();
        Object.assign(this.surgeFrame, {
            level: 0, fever: 0, stage: 0, punch: 0,
        });
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

    /**
     * Light the envelopes. A hit never lowers one, and one already lit takes the stronger of the
     * two and a share of the other, so rapid clears warm the light step by step (alone, a hit
     * lights it exactly as high as it asks).
     */
    excite(values) {
        for (const key of ENVELOPE_KEYS) {
            const value = Number.isFinite(values[key]) ? clamp(values[key], 0, 1) : 0;
            const lit = this.envelopes[key];
            const high = Math.max(lit, value);
            this.envelopes[key] = Math.min(1, high + Math.min(lit, value) * ACCUMULATE * (1 - high));
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

    /**
     * Send a front of wind across the valley. It always travels with the wind, from the upwind
     * edge, in a slot of its own; with every slot crossing, it joins the youngest front instead,
     * which carries on and eases up to the stronger of the two and a little more. No front is
     * ever restarted or cut.
     */
    sweep(strength) {
        const asked = Number.isFinite(strength) ? clamp(strength, 0, 1) : 0;
        let free = null;
        let youngest = null;
        for (const front of this.fronts) {
            if (!front.active) {
                if (!free) free = front;
            } else if (!youngest || front.age < youngest.age) youngest = front;
        }
        if (free) {
            Object.assign(free, {
                active: true, age: 0, direction: 1, strength: asked, target: asked, serial: this.frontSerial,
            });
        } else {
            youngest.target = Math.min(1, Math.max(youngest.target, asked) + Math.min(youngest.target, asked) * 0.25);
            youngest.serial = this.frontSerial;
        }
        this.frontSerial += 1;
        return free || youngest;
    }

    /**
     * Open the clouds: a pool of sunlight sets out across the hills. If one is still crossing it
     * is fed instead: its light swells back to its fullest and holds there a while, it opens
     * wider and crosses more slowly — it never closes to open again from the left.
     */
    sunbreak(strength) {
        const asked = Number.isFinite(strength) ? clamp(strength, 0, 1) : 0;
        const pool = this.sunpool;
        if (!pool.active) {
            Object.assign(pool, {
                active: true,
                age: 0,
                travel: 0,
                glow: 0,
                strength: asked,
                want: asked,
                breadth: 0,
                wide: 0,
                hold: 0,
                held: false,
                fade: 1,
            });
            return pool;
        }
        // Brighter and wider by easing up (update()): a feed never steps the light.
        pool.want = Math.max(pool.want, asked);
        pool.wide = Math.min(1, pool.wide + asked * SUNBREAK_WIDEN);
        if (asked > 0) {
            pool.hold = Math.max(pool.hold, SUNBREAK_HOLD);
            pool.held = true;
        }
        return pool;
    }

    /**
     * The break in the clouds, one frame on. A plain one crosses in six seconds, its light
     * swelling as the clouds part and gone as it leaves the far hills. A fed one, or one a fever
     * keeps open, swells back to its fullest and lingers there, crossing slowly; once the hold
     * and the fever are over it lets go from where it stands. A fever opens one of its own (and
     * another once that one has crossed). When the game is over it fades where it is.
     */
    updateSunpool(dt, fever) {
        const pool = this.sunpool;
        const burning = fever >= FEVER_SUNBREAK && !this.settled;
        if (burning && !pool.active) this.sunbreak(0.5 + 0.5 * fever);
        if (!pool.active) return;
        pool.age += dt;
        const pace = dt / SUNBREAK_SECONDS;
        const fevered = burning && pool.travel < FEVER_SUNBREAK_REACH;
        if (fevered) {
            pool.wide = Math.max(pool.wide, fever * 0.5);
            pool.held = true;
        }
        const ease = 1 - Math.exp(-2 * dt);
        pool.strength += (pool.want - pool.strength) * ease;
        pool.breadth += (pool.wide - pool.breadth) * ease;
        if (pool.hold > 0 || fevered) {
            pool.glow = pool.glow > SUNBREAK_PEAK
                ? Math.max(SUNBREAK_PEAK, pool.glow - SUNBREAK_REWIND * dt)
                : Math.min(SUNBREAK_PEAK, pool.glow + pace);
            pool.travel = Math.min(SUNBREAK_FAR, pool.travel + pace * SUNBREAK_LINGER);
        } else {
            // A plain crossing: its course and its light go together, to the end.
            pool.glow += pace;
            pool.travel = pool.held ? Math.min(SUNBREAK_FAR, pool.travel + pace) : pool.travel + pace;
        }
        pool.hold = Math.max(0, pool.hold - dt);
        pool.fade = this.settled ? pool.fade * Math.exp(-SETTLE_FADE * dt) : Math.min(1, pool.fade + SETTLE_FADE * dt);
        if (pool.glow >= 1 || pool.fade < 0.002) pool.active = false;
    }

    /** Claim a free slot, or the one with the least left to give (strength × what remains of its life). */
    emit(kind, {
        side = 0, column = 0.5, row = 0.3, strength = 0.5, lines = 0, duration = 1, kite = VERDANT_HILLS_MIXED,
    }) {
        let selected = -1;
        let least = Infinity;
        for (let step = 0; step < this.maxEmitters; step += 1) {
            const index = (this.cursor + step) % this.maxEmitters;
            const emitter = this.emitters[index];
            if (!emitter.active) {
                selected = index;
                break;
            }
            const left = emitter.strength * (1 - emitter.age / emitter.duration);
            if (left < least) {
                least = left;
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

    /**
     * The streak's bookkeeping for a lock, and what play is worth to the surge. A lock that
     * follows a lock without a clear between them ends the streak; a long one lets its whirl go.
     */
    countLock(drop) {
        if (!this.clearedSinceLock) {
            if (this.clearStreak >= RELEASE_STREAK) this.letGo(this.clearStreak);
            this.clearStreak = 0;
        }
        this.clearedSinceLock = false;
        this.surge.lock({ hardDrop: drop > 0 }, this.time);
    }

    /**
     * A chain has ended: the whirl lets go and the wind carries what it held down the valley —
     * one long ribbon over the hills and a gust from the foot of the board, as strong as the
     * chain was long.
     */
    letGo(streak) {
        const length = clamp((streak - RELEASE_STREAK + 1) / 6, 0, 1);
        this.streak('great', {
            side: 0, row: 0.45, strength: 0.55 + 0.4 * length, lines: 1,
        });
        this.gust(0.5, 0.7 + 0.8 * length);
        this.blow(0.06 + 0.1 * length);
    }

    /**
     * A lock with the lock ripple switched off: nothing is shown for it, but it still counts —
     * it ends a streak or carries it on, and it is play the surge hears.
     */
    onQuietLock() {
        if (this.disposed) return false;
        this.settled = false;
        const drop = this.pendingDrop;
        this.pendingDrop = 0;
        this.countLock(drop);
        return true;
    }

    onPieceLock(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        this.settled = false;
        const place = boardPlace(payload);
        const kite = verdantHillsKiteForPiece(payload.piece);
        const drop = this.pendingDrop;
        this.pendingDrop = 0;
        this.countLock(drop);
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
        // Which wave of a cascade this is: each one after the first sends its own front, harder.
        const wave = positiveCount(event.detail?.cascadeCount, 12) || 1;
        // The cascade's waves are heard on COMBO (onCombo); a clear is its lines and its streak.
        this.surge.clear({ lines, combo: this.clearStreak }, this.time);
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
        if (lines >= 2 || wave >= 2) this.sweep(0.3 + lines * 0.17 + (wave - 1) * 0.1);
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
        // One more wave of a cascade: what a wave adds to the surge (its lines come with LINE_CLEAR).
        this.surge.wave(this.time);
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
        // A spin that cleared nothing is a little of one; one that cleared adds a spin's worth to its clear.
        if (positiveCount(payload.lineCount, 4) > 0) {
            this.surge.tspin(this.time);
        } else this.surge.spin(this.time);
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

    /**
     * Back-to-back: every kite on its line bows at once, as if the whole sky had been tugged, and
     * golden ribbons cross behind the board. A run of them escalates: more ribbons, a tighter
     * whirl and the kites higher with each.
     */
    onBackToBack() {
        if (this.disposed) return false;
        this.b2bRun = this.time - this.b2bAt <= B2B_RUN_SECONDS ? this.b2bRun + 1 : 1;
        this.b2bAt = this.time;
        const run = Math.min(4, this.b2bRun) - 1;
        this.surge.b2b(this.time);
        this.excite({
            warmth: 0.5 + run * 0.08, glow: 0.7 + run * 0.08, shafts: 0.45 + run * 0.08, shimmer: 0.6 + run * 0.1,
        });
        this.raiseWhirl(Math.max(this.whirlTarget, 0.55 + run * 0.1));
        this.raise(0.6 + run * 0.1);
        for (let slot = 0; slot < VERDANT_HILLS_KITES; slot += 1) {
            if (this.line[slot] > 0) this.tug[slot] = 1;
        }
        this.streak('gold', {
            side: 0, row: 0.55, strength: 0.75 + run * 0.08, lines: run + 1,
        });
        return true;
    }

    /**
     * A perfect clear crowns the clear it ends (physics sends it a moment after that clear's last
     * wave): a front of its own beside the clear's, the break in the clouds fed rather than
     * reopened, every kite in the air.
     */
    onPerfectClear() {
        if (this.disposed) return false;
        this.settled = false;
        this.surge.crown(this.time);
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
        this.surge.levelUp(this.time);
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

    /**
     * The session ended: let the wind drop, the whirl unwind and the kites come down; the fronts
     * still crossing and the sunlight fade within a second or so (see update()).
     */
    onGameOver() {
        if (this.disposed) return false;
        this.whirlTarget = 0;
        this.whirlHold = 0;
        this.clearStreak = 0;
        for (const front of this.fronts) front.target = 0;
        this.sunpool.hold = 0;
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
        // How hot play runs, on this clock: the world wears it, and a fever holds the clouds open.
        const heat = this.surge.sample(this.time);
        const surge = this.surgeFrame;
        surge.level = heat.level;
        surge.fever = heat.fever;
        surge.stage = heat.stage;
        surge.punch = heat.punch;
        const stillStep = STILL_RATE * dt;
        this.still += clamp(this.stillTarget - this.still, -stillStep, stillStep);
        // Each front runs to the far side; a joined one eases to its new strength, and once the
        // game is over every one eases away.
        const ease = 1 - Math.exp(-FRONT_EASE * dt);
        for (const front of this.fronts) {
            if (!front.active) continue;
            front.age += dt;
            front.strength += (front.target - front.strength) * ease;
            if (front.age >= FRONT_SECONDS || (this.settled && front.strength < 0.001)) {
                front.active = false;
                front.strength = 0;
            }
        }
        this.updateSunpool(dt, surge.fever);
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

    /** One front as the world sees it: where it is across the view, and how hard it pushes there. */
    static showFront(front) {
        const travel = clamp(front.age / FRONT_SECONDS, 0, 1);
        return {
            // -1.4 .. 1.4 across the view, downwind.
            position: travel * 2.8 - 1.4,
            direction: 1,
            strength: front.strength * Math.sin(Math.PI * Math.min(1, travel * 1.15)),
        };
    }

    getFrame() {
        const { sunpool } = this;
        // Every front crossing, the newest (sent or joined) first.
        const fronts = this.fronts.filter((front) => front.active)
            .sort((a, b) => b.serial - a.serial)
            .map(VerdantHillsReactions.showFront);
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
            front: fronts[0] ?? null,
            fronts,
            sunbreak: sunpool.active ? {
                // 0 as the clouds open, 1 as the pool of light leaves the far hills.
                progress: sunpool.travel,
                strength: sunpool.strength * sunpool.fade
                    * Math.max(0, Math.sin(Math.PI * Math.min(1, sunpool.glow * 1.08))) ** 0.7,
                // How much wider than a plain break feeds and a fever have opened it (0..1).
                breadth: sunpool.breadth,
            } : null,
            // How hot play runs (shared, live: read it, do not keep it).
            surge: this.surgeFrame,
            still: this.still,
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
