/**
 * Sakura Twilight — how the garden answers the game.
 *
 * A pure, seconds-based director: gameplay events become a small set of light and wind
 * envelopes, a few slow states (the petal stream, the constellations, the foxfire)
 * and bounded "emitters" described in board space (which side of the board, how high, how
 * strong). SakuraWorld turns emitters into petals, rings on the lake and lanterns; nothing
 * here touches the scene, so the same director runs in tests, the playground and the game.
 *
 * The language:
 *   lock          a puff of lit petals from the board edge beside the piece and a ring
 *                 across the lake from under it; the lanterns breathe (harder after a long
 *                 hard drop)
 *   line clear    twin jets of petals blown out of both sides at the cleared rows, lanterns
 *                 set afloat, the blossom lit from within; from two lines a gust front
 *                 crosses the garden
 *   four lines    hanafubuki — the crowns let go a blizzard of petals — under a flaring
 *                 moon and shooting stars; the fox leaps for the moon
 *   combo/streak  a stream of petals winds around the board and climbs; foxfire lights
 *                 one flame at a time around it, and the constellations draw themselves in
 *   cascade       each wave of one lock answers more fully than the last: another flame,
 *                 more of the sky drawn, a wider ring of petals, another front of wind
 *   t-spin        a spiral flourish beside the board and a shooting star (a smaller spiral
 *                 and a fainter star when it cleared nothing)
 *   back-to-back  the hazy moon's rainbow corona opens, brighter for every one in a row
 *   level up      sky lanterns rise from the shore
 *   perfect clear the crown on the clear still playing: the fallen petals rise, every sky
 *                 lantern lifts, the whole sky is drawn and the moon blooms (the quad's own
 *                 blizzard is not thrown a second time)
 *   game over     the wind dies and the lanterns burn low
 *
 * It BUILDS rather than pops (src/themes/shared/gameplay-surge.js). Every envelope is a Swell:
 * a new event adds to what is still lit and never restarts it, so a lock after a quad can only
 * lift the light. The gust the boughs bend under follows its envelope through a critically
 * damped spring (`sway`), so a lock leans the trees instead of jerking them. Wind fronts run to
 * the far side in slots, all with the prevailing breeze; one that finds no slot joins the
 * youngest still crossing. A slow state is never pulled down by a smaller new event. The true
 * combo comes from the lock sequence (src/core/combo-tracker.js); the bus COMBO is the cascade
 * depth, and each wave builds on the last.
 *
 * A GameplaySurge reads how hot play runs (`level`, `fever`, `stage`) and the garden spends it
 * on its own night: warm — the lanterns burn up, the first strokes of the figures appear and a
 * flame or two kindles beside the board; hot — the stream of petals winds, the foxfire gathers,
 * the fox runs with the player and stars begin to fall; fever — the night of hanami: the whole
 * sky is drawn, a meteor shower crosses it and sky lanterns lift from both shores in a steady
 * festival. When the hands rest it all breathes back to the quiet garden.
 */
import { ComboTracker } from '../../core/combo-tracker.js';
import { GameplaySurge, SURGE_WEIGHTS, Swell } from '../shared/gameplay-surge.js';

// Every handler firing in one frame (a hard-dropped lock, four lines, a combo, a T-spin,
// a perfect clear and a level-up) asks for seventeen emitters; no tier's pool is smaller,
// so none is reclaimed before the garden has played it.
export const SAKURA_REACTION_LIMITS = Object.freeze({
    Minimal: 18,
    Low: 18,
    Medium: 20,
    High: 20,
    Ultra: 22,
    Extreme: 24,
});

const DECAY_RATES = Object.freeze({
    gust: 1.5,
    glow: 1.0,
    lanterns: 1.25,
    moon: 0.7,
});
const ENVELOPE_KEYS = Object.keys(DECAY_RATES);
/**
 * Each envelope accumulates (one event reads exactly as it always did; a second adds to what is
 * left of the first). The reading is capped at 1 and what is stored at 1.4, so after a frenzy the
 * light lingers a moment and then falls away like any other.
 */
const envelopeSwell = (rate) => new Swell({
    release: 1 / rate, ceiling: 1, knee: 1, headroom: 1.4,
});
/** How quickly the boughs follow the gust (a critically damped spring, rad/s). */
const SWAY_OMEGA = 7.5;
const VORTEX_HOLD_SECONDS = 2.8;
const VORTEX_RELEASE_RATE = 0.8;
const SKY_HOLD_SECONDS = 6;
const FOXFIRE_HOLD_SECONDS = 4.5;
const FRONT_SECONDS = 2.0;
/** Wind fronts crossing at once; another joins the youngest still crossing. */
export const SAKURA_FRONT_SLOTS = 3;
/** How fast a joined front eases up to its new strength (or away at game over). */
const FRONT_EASE = 3;
/** The prevailing breeze: every front rolls across the garden the way the wind blows. */
const FRONT_DIRECTION = 1;
const MAX_FOXFIRE = 14;
const BOARD_COLUMNS = 10;
const BOARD_VISIBLE_ROWS = 20;
const BOARD_HIDDEN_ROWS = 4;
/** Emitters do their work early in their lives (the petal director spawns within these). */
const WORK_SECONDS = Object.freeze({
    lock: 0.28, clear: 0.75, shower: 1.6, spin: 1.1, rise: 1.3,
});
/** What Reduce motion leaves of the garden's movement (the wind, the fronts, the stream). */
export const SAKURA_CALM_MOTION = 0.35;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const ease = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const smooth = (low, high, value) => {
    const t = clamp((value - low) / (high - low), 0, 1);
    return t * t * (3 - 2 * t);
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

export class SakuraReactions {
    constructor({ quality = 'High', rng = Math.random } = {}) {
        const requestedQuality = typeof quality === 'string' ? quality.toLowerCase() : '';
        this.quality = Object.keys(SAKURA_REACTION_LIMITS)
            .find((tier) => tier.toLowerCase() === requestedQuality)
            || (requestedQuality === 'med' ? 'Medium' : 'High');
        this.maxEmitters = SAKURA_REACTION_LIMITS[this.quality];
        this.rng = typeof rng === 'function' ? rng : Math.random;
        this.emitters = Array.from({ length: this.maxEmitters }, (_, id) => ({ id }));
        this.swells = Object.fromEntries(ENVELOPE_KEYS.map((key) => [key, envelopeSwell(DECAY_RATES[key])]));
        this.fronts = Array.from({ length: SAKURA_FRONT_SLOTS }, () => ({
            active: false, age: 0, direction: FRONT_DIRECTION, strength: 0, target: 0, serial: -1,
        }));
        /**
         * The perfect clear's crown (the moon blooms, the figures flare) and the back-to-back's
         * corona round the hazy moon: each new one adds to what the last left.
         */
        this.crown = new Swell({
            attack: 0.15, release: 3, ceiling: 1.3, knee: 1,
        });
        this.corona = new Swell({
            attack: 0.25, release: 2.6, ceiling: 1.6, knee: 1.1,
        });
        /** The true combo: consecutive clearing locks (src/core/combo-tracker.js). */
        this.tracker = new ComboTracker();
        /** How hot play runs, on this director's clock (sampled once per update). */
        this.surge = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        /** What Reduce motion leaves of the garden's movement (1: all of it). */
        this.motion = 1;
        this.reset();
    }

    reset() {
        this.disposed = false;
        this.time = 0;
        this.cursor = 0;
        this.serial = 0;
        this.tracker.reset();
        this.streak = 0;
        this.depth = 1;
        this.pendingDrop = 0;
        this.pendingHard = false;
        this.vortex = 0;
        this.vortexTarget = 0;
        this.vortexHold = 0;
        this.constellation = 0;
        this.constellationTarget = 0;
        this.skyHold = 0;
        this.foxfire = 0;
        this.foxfireTarget = 0;
        this.foxfireHold = 0;
        this.spirit = 0;
        this.hush = 0;
        this.hushTarget = 0;
        this.sweeps = 0;
        this.leaps = 0;
        this.sway = 0;
        this.swaySpeed = 0;
        this.meteorClock = 0;
        this.festivalClock = 0;
        for (const key of ENVELOPE_KEYS) this.swells[key].reset();
        for (const front of this.fronts) {
            Object.assign(front, {
                active: false, age: 0, direction: FRONT_DIRECTION, strength: 0, target: 0, serial: -1,
            });
        }
        this.crown.reset();
        this.corona.reset();
        this.surge.reset();
        Object.assign(this.heat, {
            punch: 0, level: 0, fever: 0, stage: 0,
        });
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

    /** Reduce motion (system or Settings): the wind, fronts and stream move this much (0..1). */
    setMotion(scale) {
        this.motion = Number.isFinite(scale) ? clamp(scale, 0, 1) : 1;
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
     * early: a jet that has thrown its petals only lingers; a star or a flight acts once, on the
     * first frame the garden sees it), the furthest through its life on a tie. An emitter the
     * garden has not yet seen keeps its whole work.
     */
    emit(kind, {
        side = 0, column = 0.5, row = 0.3, strength = 0.5, lines = 0, duration = 1,
    } = {}) {
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
            let left = emitter.strength;
            if (emitter.age > 0) {
                const window = WORK_SECONDS[emitter.kind] ?? 0;
                left = window > 0 ? clamp(1 - emitter.age / window, 0, 1) * emitter.strength : 0;
            }
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
     * Send a front of wind across the garden with the prevailing breeze. It takes a free slot and
     * runs to the far side; when every slot is crossing, it joins the youngest (which eases up to
     * the stronger of the two, and a little more): no front is ever restarted, reversed or cut.
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
            if (front.active && (!newest || front.serial > newest.serial)) newest = front;
        }
        return newest || this.fronts[0];
    }

    /** Wind the stream up. It never pulls down a stream already turning higher than it asks for. */
    raiseVortex(level) {
        this.vortexTarget = Math.max(this.vortexTarget, clamp(level, 0, 1), this.vortex);
        this.vortexHold = VORTEX_HOLD_SECONDS;
    }

    /** Trace the constellations out to `level` (0..1) and keep them lit; never undraws a stroke. */
    traceSky(level) {
        this.constellationTarget = Math.max(this.constellationTarget, clamp(level, 0, 1), this.constellation);
        this.skyHold = SKY_HOLD_SECONDS;
    }

    /** Light `count` spirit flames around the board; never puts out a flame that is burning. */
    kindle(count) {
        this.foxfireTarget = Math.max(this.foxfireTarget, clamp(count, 0, MAX_FOXFIRE), this.foxfire);
        this.foxfireHold = FOXFIRE_HOLD_SECONDS;
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
        // A lock that follows a lock without a clear between them ends the streak.
        this.streak = this.tracker.notePieceLocked();
        this.depth = 1;
        // Play has resumed: the lanterns come back up.
        this.hushTarget = 0;
        const place = boardPlace(payload);
        const drop = this.pendingDrop;
        this.surge.lock({ hardDrop: this.pendingHard }, this.time);
        this.pendingDrop = 0;
        this.pendingHard = false;
        const strength = 0.26 + drop * 0.5;
        this.excite({
            gust: 0.1 + drop * 0.12, glow: 0.06 + drop * 0.06, lanterns: 0.16 + drop * 0.14, moon: drop * 0.05,
        });
        let side = 0;
        if (place) side = place.column < 0.5 ? -1 : 1;
        this.emit('lock', {
            side, column: place?.column ?? 0.5, row: place?.row ?? 0.12, strength, duration: 1.2,
        });
        return true;
    }

    onLineClear(countOrPayload = 1, detail = {}) {
        if (this.disposed) return false;
        const event = eventArguments(countOrPayload, detail, ['lineCount', 'lines', 'linesCleared', 'count'], 4);
        const lines = event.count;
        if (lines === 0) return false;
        this.streak = this.tracker.noteLineClear();
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
        // Each wave of a cascade builds on the last: stronger jets, a broader ring, another front.
        const build = 1 + deep * 0.15;
        this.excite({
            gust: 0.3 + lines * 0.14 + deep * 0.05,
            glow: 0.2 + lines * 0.12 + (four ? 0.3 : 0),
            lanterns: 0.4 + lines * 0.15,
            moon: lines * 0.08 + (four ? 0.62 : 0),
        });
        const strength = Math.min(1, (0.36 + lines * 0.16) * build);
        // (A deeper wave throws more petals: it counts as more lines, up to five.)
        const thrown = Math.min(5, lines + deep);
        // Petals are blown out of both sides of the board at the height of the cleared rows.
        this.emit('clear', {
            side: -1, row, strength, lines: thrown, duration: 1.5 + lines * 0.12,
        });
        this.emit('clear', {
            side: 1, row, strength, lines: thrown, duration: 1.5 + lines * 0.12,
        });
        // Every cleared line sets a lantern afloat.
        this.emit('floats', {
            row, strength: lines / 4, lines, duration: 0.6,
        });
        // From two lines a front of wind crosses the garden; a cascade sends one on every wave.
        if (lines >= 2 || deep > 0) this.sweep(0.3 + lines * 0.17 + deep * 0.08);
        if (lines >= 3) this.emit('star', { strength: 0.7, duration: 1.4 });
        if (four) {
            this.emit('shower', {
                row: 1, strength: 1, lines, duration: 2.8,
            });
            this.emit('star', { strength: 1, duration: 1.6 });
            this.traceSky(0.5);
            // Four lines: the fox leaps for the moon (one leap for each, never one cut short).
            this.leaps += 1;
        }
        if (this.streak >= 2) {
            const growth = 1 - Math.exp(-(this.streak - 1) * 0.3);
            this.raiseVortex(growth);
            this.traceSky(growth);
            this.kindle(this.streak - 1);
        }
        return true;
    }

    /** The bus COMBO is the cascade depth: the waves of one lock, each answered more fully. */
    onCombo(countOrPayload, detail = {}) {
        if (this.disposed) return false;
        const event = eventArguments(countOrPayload, detail, ['comboCount', 'combo', 'count'], 60);
        if (event.count < 2) return false;
        // The wave this COMBO announces clears next: its LINE_CLEAR reads the depth from here.
        this.depth = Math.max(this.depth, Math.min(12, event.count));
        const growth = 1 - Math.exp(-(event.count - 1) * 0.22);
        // (Each wave adds to the light the last left; these are its share, not a fresh peak.)
        this.excite({
            gust: 0.25 + growth * 0.35,
            glow: 0.18 + growth * 0.4,
            lanterns: 0.25 + growth * 0.45,
            moon: 0.08 + growth * 0.3,
        });
        this.raiseVortex(0.3 + growth * 0.7);
        this.traceSky(growth);
        this.kindle(event.count - 1);
        this.emit('combo', {
            row: 0.1, strength: 0.4 + growth * 0.6, lines: event.count, duration: 1.4,
        });
        if (event.count >= 5) this.emit('star', { strength: 0.6 + growth * 0.4, duration: 1.4 });
        if (event.count >= 7) {
            this.emit('lanterns', { strength: 0.3 + growth * 0.4, lines: event.count, duration: 2.2 });
        }
        return true;
    }

    onTSpin(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        const place = boardPlace(payload);
        // A T-spin that cleared lines adds its own weight to the clear just counted; one that
        // cleared nothing is a small flourish of its own.
        const cleared = positiveCount(payload.lineCount, 4) > 0 || payload.lineCount === undefined;
        if (cleared) {
            this.surge.punch.hit(SURGE_WEIGHTS.punch.tspin, this.time);
            this.surge.level.hit(SURGE_WEIGHTS.heat.tspin, this.time);
        } else this.surge.spin(this.time);
        const size = cleared ? 1 : 0.6;
        this.excite({
            gust: 0.5 * size, glow: 0.55 * size, lanterns: 0.6 * size, moon: 0.4 * size,
        });
        this.emit('spin', {
            side: place && place.column >= 0.5 ? 1 : -1, row: place?.row ?? 0.3, strength: 0.8 * size, duration: 1.7,
        });
        this.emit('star', { strength: 0.8 * size, duration: 1.4 });
        return true;
    }

    /**
     * Back-to-back: the hazy moon's rainbow corona opens. It is a swell of its own, so a second
     * difficult clear in a row opens it wider and brighter than the first.
     */
    onBackToBack() {
        if (this.disposed) return false;
        this.surge.b2b(this.time);
        this.corona.hit(1, this.time);
        this.excite({ glow: 0.5, lanterns: 0.8, moon: 0.5 });
        this.raiseVortex(Math.max(this.vortexTarget, 0.55));
        this.traceSky(Math.max(this.constellationTarget, 0.4));
        return true;
    }

    /**
     * A perfect clear is the crown on the clear still playing (physics sends it after that
     * clear's last wave): the moon blooms, the fallen petals rise, every sky lantern lifts and the
     * whole sky is drawn. The quad's own blizzard is not thrown a second time while it pours.
     */
    onPerfectClear() {
        if (this.disposed) return false;
        this.surge.crown(this.time);
        this.crown.hit(1, this.time);
        this.excite({
            gust: 1, glow: 1, lanterns: 1, moon: 1,
        });
        const showering = this.emitters.some((emitter) => emitter.active && emitter.kind === 'shower'
            && emitter.age < WORK_SECONDS.shower);
        if (!showering) {
            this.emit('shower', {
                row: 1, strength: 1, lines: 4, duration: 3.4,
            });
        }
        this.emit('rise', { strength: 1, duration: 2.6 });
        this.emit('lanterns', { strength: 1, lines: 4, duration: 3 });
        this.emit('star', { strength: 1, duration: 1.6 });
        this.sweep(1);
        this.raiseVortex(0.85);
        this.traceSky(1);
        this.kindle(MAX_FOXFIRE);
        return true;
    }

    onLevelUp() {
        if (this.disposed) return false;
        this.surge.levelUp(this.time);
        this.excite({
            gust: 0.6, glow: 0.8, lanterns: 1, moon: 0.6,
        });
        this.emit('lanterns', { strength: 0.6, lines: 2, duration: 2.6 });
        this.sweep(0.75);
        this.traceSky(Math.max(this.constellationTarget, 0.3));
        return true;
    }

    /** The session ended: let the wind die, the flames go out and the lanterns burn low. */
    onGameOver() {
        this.vortexTarget = 0;
        this.vortexHold = 0;
        this.foxfireTarget = 0;
        this.foxfireHold = 0;
        this.constellationTarget = 0;
        this.skyHold = 0;
        this.tracker.reset();
        this.streak = 0;
        // The wind dies: fronts still crossing ease away instead of snapping the trees upright.
        for (const front of this.fronts) front.target = 0;
        this.hushTarget = 1;
    }

    /** The surge's floors under the slow states: the night the garden wears as play heats. */
    floors() {
        const { level, fever } = this.heat;
        const hush = 1 - this.hushTarget;
        return {
            // The stream of petals winds from hot play and turns through a fever.
            vortex: (0.45 * smooth(0.45, 0.95, level) + 0.3 * fever) * hush,
            // The first strokes of the figures appear as play warms; a fever draws the whole sky.
            sky: (0.55 * smooth(0.2, 0.8, level) + 0.45 * fever) * hush,
            // A flame or two kindles beside the board, then the foxfire gathers round it.
            foxfire: (5 * smooth(0.25, 0.85, level) + 9 * fever) * hush,
        };
    }

    update(dt) {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return this.getFrame();
        this.time += dt;
        const heat = this.surge.sample(this.time);
        this.heat.punch = heat.punch;
        this.heat.level = heat.level;
        this.heat.fever = heat.fever;
        this.heat.stage = heat.stage;
        const floor = this.floors();
        // The stream rises quickly to its target, holds while clears keep coming, then unwinds
        // (never below what the heat of play keeps turning).
        if (this.vortexHold > 0) this.vortexHold = Math.max(0, this.vortexHold - dt);
        else this.vortexTarget = 0;
        const vortexAim = Math.max(this.vortexTarget, floor.vortex);
        if (vortexAim > this.vortex) this.vortex = ease(this.vortex, vortexAim, 3.2, dt);
        else this.vortex = Math.max(vortexAim, this.vortex * Math.exp(-VORTEX_RELEASE_RATE * dt));
        if (this.vortex < 0.0005) this.vortex = 0;
        // The figures are drawn a stroke at a time and fade long after the last clear.
        if (this.skyHold > 0) this.skyHold = Math.max(0, this.skyHold - dt);
        else this.constellationTarget = 0;
        const skyAim = Math.max(this.constellationTarget, floor.sky);
        if (skyAim > this.constellation) this.constellation = ease(this.constellation, skyAim, 1.1, dt);
        else this.constellation = Math.max(skyAim, this.constellation * Math.exp(-0.22 * dt));
        if (this.constellation < 0.0005) this.constellation = 0;
        if (this.foxfireHold > 0) this.foxfireHold = Math.max(0, this.foxfireHold - dt);
        else this.foxfireTarget = 0;
        const foxfireAim = Math.max(this.foxfireTarget, floor.foxfire);
        if (foxfireAim > this.foxfire) this.foxfire = ease(this.foxfire, foxfireAim, 5, dt);
        else this.foxfire = Math.max(foxfireAim, this.foxfire * Math.exp(-1.1 * dt));
        if (this.foxfire < 0.01) this.foxfire = 0;
        this.spirit = ease(this.spirit, Math.max(this.vortex, this.constellation * 0.7), 1.4, dt);
        if (this.spirit < 0.0005) this.spirit = 0;
        this.hush = ease(this.hush, this.hushTarget, this.hushTarget > this.hush ? 0.8 : 2.4, dt);
        if (this.hush < 0.0005) this.hush = 0;
        // The boughs follow the gust on a critically damped spring (exact for any step), so a
        // lock leans the trees rather than jerking them.
        {
            const target = this.swells.gust.valueAt(this.time);
            const decay = Math.exp(-SWAY_OMEGA * dt);
            const c1 = this.sway - target;
            const c2 = this.swaySpeed + SWAY_OMEGA * c1;
            this.sway = target + (c1 + c2 * dt) * decay;
            this.swaySpeed = (c2 - SWAY_OMEGA * (c1 + c2 * dt)) * decay;
            if (Math.abs(this.sway) < 1e-5 && Math.abs(this.swaySpeed) < 1e-4) {
                this.sway = 0;
                this.swaySpeed = 0;
            }
        }
        const frontEase = 1 - Math.exp(-dt * FRONT_EASE);
        for (const front of this.fronts) {
            if (!front.active) continue;
            front.age += dt;
            front.strength += (front.target - front.strength) * frontEase;
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
        this.celebrate(dt);
        return this.getFrame();
    }

    /**
     * The fever's showpiece, on a steady cadence (so a capture or a seek lands on the same night):
     * from hot play stars begin to fall, and in a fever they become a meteor shower while sky
     * lanterns lift from both shores — the night of hanami.
     */
    celebrate(dt) {
        const { stage, fever } = this.heat;
        const calm = 0.5 + 0.5 * this.motion;
        const meteors = stage >= 2 && this.hushTarget === 0 ? (0.3 + 1.2 * fever) * calm : 0;
        this.meteorClock = meteors > 0 ? this.meteorClock + dt * meteors : 0;
        if (this.meteorClock >= 1) {
            this.meteorClock -= Math.floor(this.meteorClock);
            this.emit('star', { strength: 0.45 + 0.4 * fever, duration: 1.2 });
        }
        const festival = fever > 0.3 && this.hushTarget === 0 ? 0.35 + 0.9 * fever : 0;
        this.festivalClock = festival > 0 ? this.festivalClock + dt * festival : 0;
        if (this.festivalClock >= 1) {
            this.festivalClock -= Math.floor(this.festivalClock);
            this.emit('festival', { strength: 0.5 + 0.5 * fever, lines: 2, duration: 1.2 });
        }
    }

    /** Where a crossing front is on screen, and how hard it pushes there. */
    frontFrame(front) {
        const travel = clamp(front.age / FRONT_SECONDS, 0, 1);
        return {
            // -1.4 .. 1.4 across the view, in the direction of travel.
            position: (travel * 2.8 - 1.4) * front.direction,
            direction: front.direction,
            strength: clamp(front.strength * Math.sin(Math.PI * Math.min(1, travel * 1.15)) * this.motion, 0, 1),
        };
    }

    getFrame() {
        const { front } = this;
        const fronts = [];
        for (const crossing of this.fronts) {
            if (crossing.active) fronts.push(this.frontFrame(crossing));
        }
        const { envelopes } = this;
        return {
            ...envelopes,
            // The wind on the petals is calmed under Reduce motion; `sway` is what bends the boughs.
            gust: envelopes.gust * this.motion,
            sway: clamp(this.sway, 0, 1) * this.motion,
            vortex: this.vortex,
            // The stream only starts to glow once it has really built.
            heat: clamp((this.vortex - 0.5) / 0.4, 0, 1),
            spirit: this.spirit,
            constellation: this.constellation,
            // Figures are faint until traced, then burn with the combo.
            figures: clamp(this.constellation * 1.6, 0, 1),
            foxfire: this.foxfire,
            hush: this.hush,
            streak: this.streak,
            // The newest front; every front still crossing is in `fronts`.
            front: front.active ? this.frontFrame(front) : null,
            fronts,
            // How hot play runs (shared/gameplay-surge.js), the perfect clear's crown, the B2B corona.
            punch: this.heat.punch,
            level: this.heat.level,
            fever: this.heat.fever,
            stage: this.heat.stage,
            crown: clamp(this.crown.valueAt(this.time), 0, 1.3),
            corona: clamp(this.corona.valueAt(this.time), 0, 1.6),
            // Four-line clears so far: the fox leaps once for each.
            leap: this.leaps,
            motion: this.motion,
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

export const SAKURA_MAX_FOXFIRE = MAX_FOXFIRE;
