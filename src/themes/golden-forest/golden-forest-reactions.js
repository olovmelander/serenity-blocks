/**
 * Golden Forest — how the lake answers the game.
 *
 * A pure, seconds-based director: gameplay events become a small set of decaying light and
 * wind envelopes, bounded "emitters" described in board space (which side of the board,
 * how high, how strong) and rings to drop on the water. GoldenForestWorld turns them into
 * fireflies, ripples and light; nothing here touches the scene, so the same director runs
 * in tests, the playground and the game.
 *
 * The language (every event has a shape of its own, and the big ones are made of the small):
 *   lock          a ring on the water where the piece landed and a puff of fireflies from
 *                 the board edge beside it
 *   hard drop     the lake is struck: a crown of drops leaps beside the board, catches the
 *                 sun and falls back (`flurries`: droplets)
 *   line clear    the sun reaches in: every line opens one shaft of the fan of rays through
 *                 the trees (`beams`), with twin jets of fireflies blown out of both sides at
 *                 the cleared rows and a broad ring; from two lines a front of wind crosses
 *                 the forest
 *   four lines    the whole sunburst (`burst`), a great wave of gold that crosses the lake
 *                 from the board to the far shore (`waves`), the spruces breathing out their
 *                 pollen where the wind goes through them (`flurries`: pollen), the lake
 *                 breathing out light and the cranes going up
 *   combo/streak  the shores are gilded: the sun's light spreads round the lake from its own
 *                 bearing, crown by crown, as far as the combo has built (the river's height);
 *                 fireflies gather into a river that winds around the board, and ribbons of
 *                 light unfurl across the sky
 *   twist         the water is wound up: a spiral on the lake where the piece turned
 *                 (`swirls`) and a helix of sparks climbing out of it (`flurries`: helix)
 *   back-to-back  the sun pours gold down its path on the water: a pulse of it runs the
 *                 road from the far shore to your feet (`roads`), more for every one in a row
 *   perfect clear the crown: all of four lines, every shore gilded at once, gold falling
 *                 through the whole air (`flurries`: goldfall) and a skein of cranes called
 *                 across the sun (`flights`)
 *   level up      the hour turns: the cloud races for a moment (`rush`), a skein crosses the
 *                 sun, a gentler wave goes out
 *   game over     the evening after: the wind dies, the fireflies settle and the light sinks
 *                 toward the blue hour (`dusk`), stays a while and comes back (at once with the
 *                 next piece played)
 *
 * It BUILDS rather than pops (src/themes/shared/gameplay-surge.js). Every envelope is a Swell:
 * a new event adds to what is still lit and never restarts it, so a weak lock after a quad can
 * only lift the light, and rapid locks raise the wind instead of shaking the trees. Wind fronts
 * run to completion in slots, all with the prevailing wind; one that cannot get a slot joins the
 * youngest still crossing. A GameplaySurge reads how hot play runs (`level`, `fever`, `stage`):
 * the world spends it on the evening wind, the fireflies falling into step, the sun pouring in.
 */
import { GameplaySurge, SURGE_WEIGHTS, Swell } from '../shared/gameplay-surge.js';

export const GOLDEN_FOREST_REACTION_LIMITS = Object.freeze({
    Minimal: 4,
    Low: 6,
    Medium: 8,
    High: 12,
    Ultra: 14,
    Extreme: 16,
});

const DECAY_RATES = Object.freeze({
    gust: 1.4,
    warmth: 0.75,
    shafts: 0.9,
    glow: 1.1,
    shimmer: 0.8,
    flock: 0.32,
});
const ENVELOPE_KEYS = Object.keys(DECAY_RATES);
/**
 * Each envelope accumulates (a Swell: one event reads exactly as it always did, a second adds to
 * what is left of the first); the reading is capped at 1 and what is stored at 1.4, so after a
 * frenzy the light lingers a moment and then falls away like any other.
 */
const envelopeSwell = (rate) => new Swell({
    release: 1 / rate, ceiling: 1, knee: 1, headroom: 1.4,
});
const VORTEX_HOLD_SECONDS = 2.6;
const VORTEX_RELEASE_RATE = 0.85;
const FRONT_SECONDS = 2.2;
/** Wind fronts crossing at once; another joins the youngest still crossing. */
export const GOLDEN_FOREST_FRONT_SLOTS = 3;
/** How fast a front that was joined eases up to its new strength (or away at game over). */
const FRONT_EASE = 3;
/** The prevailing wind: every front rolls across the lake the way the breeze blows. */
const FRONT_DIRECTION = 1;
/** Emitters do their work early in their lives (the director spawns within these windows). */
const WORK_SECONDS = Object.freeze({
    lock: 0.25, splash: 0.22, clear: 0.75, rise: 1.5, spin: 1.1, combo: 0,
});
const RING_QUEUE = 8;
/** Shafts of the fan cleared lines can hold open at once (the lens draws as many). */
export const GOLDEN_FOREST_BEAM_SLOTS = 8;
/**
 * The fan: the directions a shaft can take from the sun on screen, in degrees clockwise from
 * the right (the lens mirrors them when the sun stands right of the frame's middle), in the
 * order lines open them: the long diagonals over the open water and the sky first.
 */
export const GOLDEN_FOREST_FAN = Object.freeze([62, 24, -14, 85, 40, 8, 115, -40, 150, -75]);
/** A shaft's life: seconds to open, to stand, and to fall to 1/e. */
const BEAM = Object.freeze({
    rise: 0.1, hold: 0.55, release: 1.0, sharp: [300, 210],
});
/** A shaft gives its slot to a new one only once it is down to this share of its own light. */
const BEAM_SPENT = 0.25;
/** Seconds between two hard drops' bursts of drops at the least. */
const DROPLET_GAP = 0.4;
/** Bursts of drops, pollen, sparks and gold waiting for the world to throw them. */
const FLURRY_QUEUE = 12;
export const GOLDEN_FOREST_FLURRIES = Object.freeze(['droplets', 'pollen', 'helix', 'goldfall']);
/** Seconds a great wave, a spiral and a pulse on the sun's road each last. */
export const GOLDEN_FOREST_TRACK_SECONDS = Object.freeze({ waves: 9, swirls: 4.6, roads: 3.4 });
/** Great waves and spirals the lake carries at once, pulses on the sun's road, and the share of
 * its life past which a mark is faint enough to give its slot up. */
export const GOLDEN_FOREST_TRACK_SLOTS = Object.freeze({ waves: 3, swirls: 3, roads: 2 });
/**
 * A great wave and a spiral run down with their age, so they are faint by seven tenths of it.
 * A pulse on the road is a bell (it swells as it nears the eye and is at its brightest then):
 * it is faint only in its last moments.
 */
const TRACK_SPENT = Object.freeze({ waves: 0.7, swirls: 0.7, roads: 0.95 });
/**
 * The evening after a game: how fast it falls, how long it stays, how slowly the light comes
 * back by itself after that, and how fast the next piece lifts it (rates per second, seconds).
 * It is a moment, not a state: the lake behind the menus is not left dim until the next game.
 */
export const GOLDEN_FOREST_DUSK = Object.freeze({
    fall: 0.45, hold: 14, dawn: 0.22, lift: 1.4,
});
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

export class GoldenForestReactions {
    constructor({ quality = 'High', rng = Math.random } = {}) {
        const requestedQuality = typeof quality === 'string' ? quality.toLowerCase() : '';
        this.quality = Object.keys(GOLDEN_FOREST_REACTION_LIMITS)
            .find((tier) => tier.toLowerCase() === requestedQuality)
            || (requestedQuality === 'med' ? 'Medium' : 'High');
        this.maxEmitters = GOLDEN_FOREST_REACTION_LIMITS[this.quality];
        this.rng = typeof rng === 'function' ? rng : Math.random;
        this.emitters = Array.from({ length: this.maxEmitters }, (_, id) => ({ id }));
        this.rings = Array.from({ length: RING_QUEUE }, () => ({
            serial: -1, column: 0.5, row: 0, strength: 0,
        }));
        this.swells = Object.fromEntries(ENVELOPE_KEYS.map((key) => [key, envelopeSwell(DECAY_RATES[key])]));
        this.fronts = Array.from({ length: GOLDEN_FOREST_FRONT_SLOTS }, () => ({
            active: false, age: 0, direction: FRONT_DIRECTION, strength: 0, target: 0, serial: -1,
        }));
        /** The perfect clear's crown and the back-to-back's gold: each new one adds to the last. */
        this.crown = new Swell({
            attack: 0.12, release: 2.4, ceiling: 1.2, knee: 0.9,
        });
        this.gold = new Swell({
            attack: 0.2, release: 2.8, ceiling: 1.5, knee: 1,
        });
        /** The sunburst of a great clear, and the cloud's rush as a level turns the hour on. */
        this.burst = new Swell({
            attack: 0.22, release: 2.1, ceiling: 1, knee: 0.85,
        });
        this.rush = new Swell({
            attack: 0.45, release: 1.7, ceiling: 1, knee: 0.9,
        });
        /** The shafts of the fan held open, the bursts waiting to be thrown, and the lake's tracks. */
        this.beams = Array.from({ length: GOLDEN_FOREST_BEAM_SLOTS }, () => ({
            active: false, angle: 0, sharp: 120, strength: 0, age: 0, serial: -1, sway: 0,
        }));
        this.flurries = Array.from({ length: FLURRY_QUEUE }, () => ({
            serial: -1, kind: 'droplets', column: 0.5, row: 0, side: 0, strength: 0,
        }));
        const tracks = (kind) => Array.from({ length: GOLDEN_FOREST_TRACK_SLOTS[kind] }, () => ({
            serial: -1, active: false, age: 0, strength: 0, column: 0.5, row: 0, turn: 1,
        }));
        this.tracks = { waves: tracks('waves'), swirls: tracks('swirls'), roads: tracks('roads') };
        /** How hot play runs, on this director's clock (sampled once per update). */
        this.surge = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
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
        this.ringSerial = 0;
        this.ringCursor = 0;
        this.streak = 0;
        this.clearedSinceLock = false;
        this.pendingDrop = 0;
        this.pendingHard = false;
        this.depth = 1;
        this.vortex = 0;
        this.vortexTarget = 0;
        this.vortexHold = 0;
        this.sweeps = 0;
        this.settled = false;
        this.fanCursor = 0;
        this.beamSerial = 0;
        this.flurrySerial = 0;
        this.flurryCursor = 0;
        this.trackSerial = 0;
        this.flights = 0;
        this.lastDroplets = -Infinity;
        this.b2bChain = 0;
        this.lastB2b = -Infinity;
        this.dusk = 0;
        this.duskTarget = 0;
        this.duskHold = 0;
        this.duskRate = GOLDEN_FOREST_DUSK.lift;
        this.burst.reset();
        this.rush.reset();
        for (const beam of this.beams) {
            Object.assign(beam, {
                active: false, angle: 0, sharp: 120, strength: 0, age: 0, serial: -1, sway: 0,
            });
        }
        for (const flurry of this.flurries) {
            Object.assign(flurry, {
                serial: -1, kind: 'droplets', column: 0.5, row: 0, side: 0, strength: 0,
            });
        }
        for (const list of Object.values(this.tracks)) {
            for (const track of list) {
                Object.assign(track, {
                    serial: -1, active: false, age: 0, strength: 0, column: 0.5, row: 0, turn: 1,
                });
            }
        }
        for (const key of ENVELOPE_KEYS) this.swells[key].reset();
        for (const front of this.fronts) {
            Object.assign(front, {
                active: false, age: 0, direction: FRONT_DIRECTION, strength: 0, target: 0, serial: -1,
            });
        }
        this.crown.reset();
        this.gold.reset();
        this.surge.reset();
        Object.assign(this.heat, {
            punch: 0, level: 0, fever: 0, stage: 0,
        });
        for (const ring of this.rings) {
            Object.assign(ring, {
                serial: -1, column: 0.5, row: 0, strength: 0,
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

    /**
     * Claim a free slot, else the one with the least of its work left (an emitter does its work
     * early: a jet that has thrown its sparks only lingers), the furthest through its life on a tie.
     */
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
            age: 0,
            duration,
            seed: this.random(),
        });
        this.serial += 1;
        this.cursor = (selected + 1) % this.maxEmitters;
        return this.emitters[selected];
    }

    /**
     * How strong play's rings are as it runs hot: they come thick and fast then, and each a little
     * gentler interferes across the water instead of stacking into one pale disc in front of the
     * eye. The perfect clear's and the level-up's rings stay whole: they are the release.
     */
    ringScale() {
        return 1 - 0.45 * this.heat.level;
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

    /**
     * Send a front of wind across the forest with the prevailing breeze. It takes a free slot and
     * runs to the far side; when every slot is crossing, it joins the youngest (which eases up to
     * the stronger of the two, and a little more): no front is ever restarted or cut.
     */
    sweep(strength) {
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
        if (free) {
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

    /** How bright a shaft stands at its age: it opens quickly, stands, and falls away. */
    static beamLight(beam) {
        const opened = 1 - Math.exp(-beam.age / BEAM.rise);
        const fallen = Math.exp(-Math.max(0, beam.age - BEAM.hold) / BEAM.release);
        return clamp(beam.strength * opened * fallen, 0, 1);
    }

    /**
     * Open `count` shafts of the fan, each on the next direction round it (so line after line
     * the sun reaches somewhere new). A shaft takes a free slot, else the one with the least
     * light left, and that only once it is nearly out: a shaft still bright is never cut or
     * re-aimed for a new one (the new one is let go).
     */
    openBeams(count, strength) {
        const wanted = clamp(Math.floor(count), 0, GOLDEN_FOREST_BEAM_SLOTS);
        const value = clamp(strength, 0, 1);
        for (let n = 0; n < wanted && value > 0; n += 1) {
            let selected = null;
            let least = Infinity;
            for (const beam of this.beams) {
                const left = beam.active ? GoldenForestReactions.beamLight(beam) : -1;
                // A shaft still opening or standing, or still giving a good share of its light, keeps
                // its slot: re-aimed, it would snap to a new direction in the lens. The new one is let go.
                const bright = beam.active && (beam.age < BEAM.hold || left > beam.strength * BEAM_SPENT);
                const held = bright ? 2 : left;
                if (held < least) {
                    least = held;
                    selected = beam;
                }
            }
            if (!selected || least >= 2) return;
            const angle = GOLDEN_FOREST_FAN[this.fanCursor % GOLDEN_FOREST_FAN.length] + (this.random() - 0.5) * 9;
            this.fanCursor += 1;
            Object.assign(selected, {
                active: true,
                angle: (angle * Math.PI) / 180,
                // The more lines, the broader each shaft.
                sharp: BEAM.sharp[0] + (BEAM.sharp[1] - BEAM.sharp[0]) * clamp((wanted - 1) / 2, 0, 1),
                strength: value,
                age: 0,
                serial: this.beamSerial,
                // It leans a few degrees as it stands, one way or the other.
                sway: (this.random() - 0.5) * 0.09,
            });
            this.beamSerial += 1;
        }
    }

    /** Ask the world to throw a burst (drops, pollen, a helix of sparks, falling gold). */
    flurry(kind, {
        column = 0.5, row = 0, side = 0, strength = 1,
    } = {}) {
        const entry = this.flurries[this.flurryCursor];
        entry.serial = this.flurrySerial;
        entry.kind = kind;
        entry.column = clamp(column, 0, 1);
        entry.row = clamp(row, 0, 1);
        entry.side = side;
        entry.strength = clamp(strength, 0, 1.5);
        this.flurrySerial += 1;
        this.flurryCursor = (this.flurryCursor + 1) % FLURRY_QUEUE;
        return entry;
    }

    /**
     * Start one of the lake's tracks (a great wave, a spiral, a pulse on the sun's road) in a
     * free slot, else in place of the one furthest through its life if that one is nearly spent.
     */
    track(kind, {
        strength = 1, column = 0.5, row = 0, turn = 1,
    } = {}) {
        const list = this.tracks[kind];
        let selected = null;
        let oldest = list[0];
        for (const entry of list) {
            if (!entry.active) {
                selected = entry;
                break;
            }
            if (entry.age > oldest.age) oldest = entry;
        }
        if (!selected) {
            // Every slot is running: the oldest gives its up only once it is nearly spent. A mark
            // still plain on the water is never cut for a new one (the new one is let go: null).
            if (oldest.age < GOLDEN_FOREST_TRACK_SECONDS[kind] * TRACK_SPENT[kind]) return null;
            selected = oldest;
        }
        Object.assign(selected, {
            serial: this.trackSerial,
            active: true,
            age: 0,
            strength: clamp(strength, 0, 1.5),
            column: clamp(column, 0, 1),
            row: clamp(row, 0, 1),
            turn: turn < 0 ? -1 : 1,
        });
        this.trackSerial += 1;
        return selected;
    }

    /** Raise the river. It never pulls down a river already running higher than it asks for. */
    raiseVortex(level) {
        this.vortexTarget = Math.max(this.vortexTarget, clamp(level, 0, 1), this.vortex);
        this.vortexHold = VORTEX_HOLD_SECONDS;
    }

    /**
     * Play has begun again: the evening after a game lifts at once. The theme calls this for
     * every piece that locks, whatever the effects settings say (the ring a lock sends out is an
     * effect; the light coming back is not), so a new game is never played in the dusk.
     */
    wake() {
        if (this.disposed) return false;
        this.duskTarget = 0;
        this.duskHold = 0;
        this.duskRate = GOLDEN_FOREST_DUSK.lift;
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

    onPieceLock(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        this.settled = false;
        // The next evening's play has begun: the light comes back.
        this.wake();
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
            gust: 0.1 + drop * 0.14, warmth: 0.025 + drop * 0.05, glow: 0.07 + drop * 0.1, shimmer: 0.12 + drop * 0.2,
        });
        let side = 0;
        if (place) side = place.column < 0.5 ? -1 : 1;
        this.emit('lock', {
            side, column, row, strength: 0.26 + drop * 0.5, duration: 1.1,
        });
        this.ripple(column, row, (0.55 + drop * 0.9) * this.ringScale());
        if (drop > 0.3) {
            this.emit('splash', {
                side, column, row, strength: drop, duration: 0.9,
            });
            // The lake is struck: drops leap beside the board. Nearly every piece is dropped hard,
            // so this is the lightest of the bursts: at most one in DROPLET_GAP seconds, and fewer
            // drops the hotter play runs (as the rings go gentler), so it never becomes a fountain.
            if (this.time - this.lastDroplets >= DROPLET_GAP) {
                this.lastDroplets = this.time;
                this.flurry('droplets', {
                    column, row, side: side || (this.serial % 2 === 0 ? -1 : 1), strength: drop * this.ringScale(),
                });
            }
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
            this.surge.punch.hit(W.punch.wave + W.punch.lines[lines] * 0.4, this.time);
            this.surge.level.hit(W.heat.wave + W.heat.lines[lines] * 0.25, this.time);
        }
        const row = clearedRow(event.detail) ?? boardPlace(event.detail)?.row ?? 0.2;
        const four = lines >= 4;
        // Each wave of a cascade builds on the last: stronger jets, broader rings, another gust.
        const build = 1 + deep * 0.15;
        this.excite({
            gust: 0.28 + lines * 0.14 + deep * 0.06,
            warmth: 0.14 + lines * 0.11 + (four ? 0.3 : 0),
            shafts: 0.14 + lines * 0.13 + (four ? 0.3 : 0),
            glow: (0.2 + lines * 0.11) * build,
            shimmer: 0.4 + lines * 0.15,
            flock: four ? 1 : 0,
        });
        const strength = Math.min(1, (0.36 + lines * 0.16) * build);
        // Fireflies are blown out of both sides of the board at the height of the cleared rows.
        this.emit('clear', {
            side: -1, row, strength, lines, duration: 1.5 + lines * 0.12,
        });
        this.emit('clear', {
            side: 1, row, strength, lines, duration: 1.5 + lines * 0.12,
        });
        // One broad ring from under the whole row, and from two lines a second on its heels.
        const calm = this.ringScale();
        this.ripple(0.5, row, (1.1 + lines * 0.36 + deep * 0.25) * calm);
        if (lines >= 2) this.ripple(lines % 2 === 0 ? 0.12 : 0.88, row, (0.7 + lines * 0.2 + deep * 0.15) * calm);
        // From two lines a front of wind crosses the forest; a cascade sends one on every wave.
        if (lines >= 2 || deep > 0) this.sweep(0.3 + lines * 0.17 + deep * 0.08);
        // The sun reaches in: a shaft of the fan for every line; four are the whole sunburst.
        if (four) {
            this.burst.hit(1, this.time);
            this.track('waves', { strength: 1, row });
            this.flurry('pollen', { strength: 1 });
            this.emit('rise', {
                row: 0, strength: 1, lines, duration: 2.8,
            });
        } else this.openBeams(lines, Math.min(1, (0.5 + lines * 0.12) * build));
        if (this.streak >= 2) this.raiseVortex(1 - Math.exp(-(this.streak - 1) * 0.3));
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
            gust: 0.36 + growth * 0.5,
            warmth: 0.26 + growth * 0.6,
            shafts: 0.3 + growth * 0.6,
            glow: 0.34 + growth * 0.66,
            shimmer: 0.5 + growth * 0.5,
        });
        this.raiseVortex(0.3 + growth * 0.7);
        this.emit('combo', {
            row: 0.1, strength: 0.4 + growth * 0.6, lines: event.count, duration: 1.4,
        });
        this.ripple(this.random(), 0.05, (0.7 + growth * 0.9) * this.ringScale());
        return true;
    }

    onTwist(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        const place = boardPlace(payload);
        // A twist that cleared lines adds its own weight to the clear just counted; one that
        // cleared nothing is a little flourish of its own.
        if (positiveCount(payload.lineCount, 4) > 0) {
            this.surge.punch.hit(SURGE_WEIGHTS.punch.twist, this.time);
            this.surge.level.hit(SURGE_WEIGHTS.heat.twist, this.time);
        } else this.surge.spin(this.time);
        this.excite({
            gust: 0.45, warmth: 0.3, shafts: 0.3, glow: 0.6, shimmer: 0.5,
        });
        const side = place && place.column >= 0.5 ? 1 : -1;
        this.emit('spin', {
            side, row: place?.row ?? 0.3, strength: 0.8, duration: 1.7,
        });
        this.ripple(place?.column ?? 0.5, place?.row ?? 0.3, 1.2 * this.ringScale());
        // The water is wound up where the piece turned, and a helix of sparks climbs out of it.
        this.track('swirls', {
            strength: 1, column: place?.column ?? 0.5, row: place?.row ?? 0.3, turn: side,
        });
        this.flurry('helix', {
            column: place?.column ?? 0.5, row: place?.row ?? 0.3, side, strength: 1,
        });
        return true;
    }

    /**
     * Back-to-back: the sun pours gold down its path on the water and the river banks up. The
     * gold is a swell of its own, so a second difficult clear in a row burns brighter than the
     * first.
     */
    onBackToBack() {
        if (this.disposed) return false;
        this.surge.punch.hit(SURGE_WEIGHTS.punch.b2b, this.time);
        this.surge.level.hit(SURGE_WEIGHTS.heat.b2b, this.time);
        this.gold.hit(1, this.time);
        this.excite({
            warmth: 0.5, glow: 0.7, shafts: 0.45, shimmer: 0.6,
        });
        this.raiseVortex(Math.max(this.vortexTarget, 0.55));
        // A pulse of gold runs the sun's road from the far shore to the near, stronger for
        // every one in a row.
        // (The game says a back-to-back happened, not how many in a row: a chain is those
        // that follow one another within a quarter of a minute.)
        if (this.time - this.lastB2b > 14) this.b2bChain = 0;
        this.lastB2b = this.time;
        this.b2bChain += 1;
        this.track('roads', { strength: Math.min(1.5, 0.75 + 0.25 * this.b2bChain) });
        return true;
    }

    /**
     * A perfect clear is the crown on the clear still playing (physics sends it after that
     * clear's last wave): the sun flares on the treetops, the ribbons ignite, the birds lift.
     * When the clear's own rising lake is still pouring off the water it is not raised again.
     */
    onPerfectClear() {
        if (this.disposed) return false;
        this.settled = false;
        this.surge.crown(this.time);
        this.crown.hit(1, this.time);
        this.excite({
            gust: 0.9, warmth: 1, shafts: 1, glow: 1, shimmer: 1, flock: 1,
        });
        const rising = this.emitters.some((emitter) => emitter.active && emitter.kind === 'rise'
            && emitter.age < WORK_SECONDS.rise);
        if (!rising) {
            this.emit('rise', {
                row: 0, strength: 1, lines: 4, duration: 3.4,
            });
        }
        this.ripple(0.5, 0.1, 2.6);
        this.ripple(0.5, 0.5, 1.6);
        this.sweep(1);
        this.raiseVortex(0.85);
        // The crown of light: the whole sunburst, a great wave (unless the clear's own is still
        // going out), gold falling through the air, pollen off every spruce, and a skein of
        // cranes called across the sun.
        this.burst.hit(1, this.time);
        this.openBeams(2, 0.9);
        const crossing = this.tracks.waves.some((wave) => wave.active && wave.age < 1.2);
        if (!crossing) this.track('waves', { strength: 1.3, row: 0 });
        this.flurry('goldfall', { strength: 1 });
        this.flurry('pollen', { strength: 1.2 });
        this.flights += 1;
        return true;
    }

    onLevelUp() {
        if (this.disposed) return false;
        this.surge.levelUp(this.time);
        this.excite({
            gust: 0.6, warmth: 0.55, shafts: 0.6, glow: 0.8, shimmer: 0.8, flock: 0.7,
        });
        this.ripple(0.5, 0.1, 1.8);
        this.sweep(0.75);
        // The hour turns: the cloud races, a gentler wave goes out, a skein crosses the sun.
        this.rush.hit(1, this.time);
        this.burst.hit(0.4, this.time);
        this.track('waves', { strength: 0.6, row: 0 });
        this.flights += 1;
        return true;
    }

    /** The session ended: let the wind die and the fireflies settle onto the water. */
    onGameOver() {
        if (this.disposed) return false;
        this.vortexTarget = 0;
        this.vortexHold = 0;
        this.streak = 0;
        // The wind dies: fronts still crossing ease away instead of snapping the trees upright.
        for (const front of this.fronts) front.target = 0;
        this.settled = true;
        this.b2bChain = 0;
        // The evening after: the light sinks toward the blue hour, stays a while, and comes
        // back by itself (or at once with the next piece played).
        this.duskTarget = 1;
        this.duskHold = GOLDEN_FOREST_DUSK.hold;
        this.duskRate = GOLDEN_FOREST_DUSK.fall;
        return true;
    }

    update(dt) {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return this.getFrame();
        this.time += dt;
        const heat = this.surge.sample(this.time);
        this.heat.punch = heat.punch;
        this.heat.level = heat.level;
        this.heat.fever = heat.fever;
        this.heat.stage = heat.stage;
        // The vortex rises quickly to its target, holds while clears keep coming, then unwinds.
        if (this.vortexHold > 0) {
            this.vortexHold = Math.max(0, this.vortexHold - dt);
            this.vortex += (this.vortexTarget - this.vortex) * (1 - Math.exp(-dt * 3.2));
        } else {
            this.vortexTarget = 0;
            this.vortex *= Math.exp(-VORTEX_RELEASE_RATE * dt);
            if (this.vortex < 0.0005) this.vortex = 0;
        }
        const ease = 1 - Math.exp(-dt * FRONT_EASE);
        for (const front of this.fronts) {
            if (!front.active) continue;
            front.age += dt;
            front.strength += (front.target - front.strength) * ease;
            if (front.age >= FRONT_SECONDS) {
                front.active = false;
                front.strength = 0;
                front.target = 0;
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
        for (const beam of this.beams) {
            if (!beam.active) continue;
            beam.age += dt;
            beam.angle += beam.sway * dt;
            if (beam.age > BEAM.hold && GoldenForestReactions.beamLight(beam) < 0.004) {
                beam.active = false;
                beam.strength = 0;
            }
        }
        for (const [kind, list] of Object.entries(this.tracks)) {
            for (const track of list) {
                if (!track.active) continue;
                track.age += dt;
                if (track.age >= GOLDEN_FOREST_TRACK_SECONDS[kind]) {
                    track.active = false;
                    track.strength = 0;
                }
            }
        }
        if (this.duskHold > 0) {
            this.duskHold = Math.max(0, this.duskHold - dt);
            if (this.duskHold === 0 && this.duskTarget > 0) {
                this.duskTarget = 0;
                this.duskRate = GOLDEN_FOREST_DUSK.dawn;
            }
        }
        this.dusk += (this.duskTarget - this.dusk) * (1 - Math.exp(-dt * this.duskRate));
        if (Math.abs(this.duskTarget - this.dusk) < 1e-4) this.dusk = this.duskTarget;
        return this.getFrame();
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
            if (crossing.active) fronts.push(GoldenForestReactions.frontFrame(crossing));
        }
        return {
            ...this.envelopes,
            epoch: this.epoch,
            vortex: this.vortex,
            // The river only whitens once it has really built.
            heat: clamp((this.vortex - 0.5) / 0.42, 0, 1),
            // Ribbons unfurl across the sky with the upper half of a combo.
            ribbons: clamp((this.vortex - 0.3) / 0.5, 0, 1),
            streak: this.streak,
            settled: this.settled,
            // The newest front; every front still crossing is in `fronts`.
            front: front.active ? GoldenForestReactions.frontFrame(front) : null,
            fronts,
            // How hot play runs (shared/gameplay-surge.js), the perfect clear's crown and the B2B gold.
            punch: this.heat.punch,
            level: this.heat.level,
            fever: this.heat.fever,
            stage: this.heat.stage,
            crown: clamp(this.crown.valueAt(this.time), 0, 1.2),
            gold: clamp(this.gold.valueAt(this.time), 0, 1.5),
            // The sunburst and the shafts single lines hold open (angle on screen, sharpness, light).
            burst: clamp(this.burst.valueAt(this.time), 0, 1),
            beams: this.beams.filter((beam) => beam.active).map((beam) => ({
                serial: beam.serial,
                angle: beam.angle,
                sharp: beam.sharp,
                strength: GoldenForestReactions.beamLight(beam),
            })),
            // A combo gilds the shores as far round the lake as its river has climbed.
            gild: clamp((this.vortex - 0.04) / 0.22, 0, 1) * (0.6 + 0.4 * this.vortex),
            gildReach: clamp(this.vortex * 1.12, 0, 1),
            // The cloud's rush as the hour turns, the evening after a game, and how many skeins
            // of cranes have been called across the sun.
            rush: clamp(this.rush.valueAt(this.time), 0, 1),
            dusk: this.dusk,
            flights: this.flights,
            // The lake's tracks still running, and the bursts asked for (a queue, by serial).
            waves: this.tracks.waves.filter((track) => track.active),
            swirls: this.tracks.swirls.filter((track) => track.active),
            roads: this.tracks.roads.filter((track) => track.active),
            flurries: this.flurries,
            rings: this.rings,
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
