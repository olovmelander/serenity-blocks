/**
 * AuroraDirector — gameplay in, sky out. The player plays the aurora like an instrument:
 *
 *   lock          plucks the curtain above the piece: a pair of pulses in the piece's own
 *                 colour runs outward along the arc, the stretch beside the board wakes (quick
 *                 hands build it into a blazing one), and a ring opens on the lake
 *   line clear    strums every arc: an awake front runs out along every arc from the board,
 *                 flames climb the rays, the curtains stand taller, the lake takes a wave
 *   four lines    breakup: the whole sky wakes from the board outward, red- and violet-
 *                 topped, a train of flames climbs the rays, and the corona breaks out overhead
 *   clear streak  each consecutive clear sends a surge the length of the sky, an awake
 *                 stretch riding with it, and winds the whole display up — faster rays,
 *                 deeper folds, a red crown, a pink hem
 *   cascade       each wave sends a surge out from the board and a band up the rays, each
 *                 deeper, wider and faster than the last
 *   back-to-back  the sky answers twice: a crimson wave after the strum, the crown flaring
 *   perfect clear the crown: amber standing light on every arc and in the corona overhead
 *
 * Between the cues the sky has weather of its own (aurora-weather.js): stretches of each arc
 * flare, wander and fade, so the display is never the same curtain twice. Under the weather the
 * night itself turns by the clock (aurora-hours.js): quiet, crowned, deep midnight, moonlit, the
 * blue hour; a level-up moves it an hour on as well as playing its cue.
 *
 * A geomagnetic storm builds under all of it (the shared GameplaySurge, the heat of play):
 * warm, the rays quicken and the hem and crown can burn deeper; hot, the curtains pulse with
 * every lock and the storm hue takes the green body; fever, the substorm — the corona held
 * open overhead, the body magenta under a red crown, the weather everywhere awake, a meteor
 * shower, the lake ringing. When the hands rest the storm lets go: slow pulsating bands fade
 * as the sky breathes back to green.
 *
 * Everything here is plain numbers: no three, no DOM, no timers. Bus handlers only stage
 * what happened; `update()` resolves one cue per board per frame and advances the state,
 * so the result depends on simulation time alone and replays exactly from `reset()`.
 * The owner drains `ripples`, `meteors` and `shake` after each update.
 */
import { ComboTracker } from '../../core/combo-tracker.js';
import { GameplaySurge } from '../shared/gameplay-surge.js';
import {
    AURORA_ARCS, BILLOW, CORONA_ARC_INDEX, SWEEP, arcBearing, arcCoordinateForAzimuth, arcRateForAzimuth, arcViewSpan,
} from './aurora-field.js';
import {
    PULSE_CYCLE, STORM_TINTS, parseColor, vivid,
} from './aurora-palette.js';
import { AuroraHours } from './aurora-hours.js';
import { AuroraWeather, bearingForAzimuth } from './aurora-weather.js';

/** Enough for a fever's overlapping strums (a clear asks ~21) to run their course. */
const MAX_PULSES = 96;
const MAX_RIPPLES = 8;
const MAX_METEORS = 8;
/** Slot 0 is the lone board; 1–4 are local-multiplayer players. */
const BOARD_SLOTS = 5;
const BOARD_COLUMNS = 10;
const HIDDEN_ROWS = 4;
const VISIBLE_ROWS = 20;
const RESTING_ARCS = AURORA_ARCS.filter((arc) => arc.index !== CORONA_ARC_INDEX);
const CORONA_ARC = AURORA_ARCS[CORONA_ARC_INDEX];
/** Pulses start this far out from a board's centre, in half-widths: just clear of its edge. */
const BOARD_EDGE = 1.12;
/** km/s — a far arc turns slowly in view; never chase it faster than this. */
const MAX_PULSE_SPEED = 620;
const REDUCED_MOTION_SCALE = 0.45;
const DEG = Math.PI / 180;
/** The perfect clear's crown: a deep amber that stays a colour on a magenta storm, never cream. */
const AMBER = [1.0, 0.42, 0.04];
/** A back-to-back's answer: the oxygen red of the crown, carried down the curtain. */
const CRIMSON = [1.0, 0.08, 0.26];
const TSPIN_VIOLET = [0.62, 0.36, 1.0];
/** Seconds the storm hue takes to follow a new streak step (1/e). */
const STORM_EASE = 0.6;
/** Seconds between the slow bands of a storm's recovery. */
const RECOVERY_PERIOD = 1.25;
/** How strongly the pulsating patches show on a quiet night (aurora-curtains.js). */
const RESTING_PULSATION = 0.32;
/**
 * The green the curtain body rests in, on average (the shader varies it between greenWarm and
 * greenCool, aurora-palette.js); the storm tint is steered from here.
 */
const RESTING_GREEN = [0.115, 0.94, 0.385];
/** The storm body never quite reaches full saturation, so the shader's mix stays positive. */
const STORM_SATURATION = 0.85;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const clamp01 = (value) => clamp(value, 0, 1);

/** RGB → [hue 0..6, saturation, value], written into `out`. */
function toHsv(rgb, out) {
    const [r, g, b] = rgb;
    const high = Math.max(r, g, b);
    const span = high - Math.min(r, g, b);
    let hue = 0;
    if (span > 1e-6) {
        if (high === r) hue = ((g - b) / span + 6) % 6;
        else if (high === g) hue = (b - r) / span + 2;
        else hue = (r - g) / span + 4;
    }
    out[0] = hue;
    out[1] = high > 0 ? span / high : 0;
    out[2] = high;
    return out;
}

/** [hue 0..6 (any turn), saturation, value] → RGB, written into `out`. */
function fromHsv(hue, saturation, value, out) {
    const h = ((hue % 6) + 6) % 6;
    const chroma = value * saturation;
    const x = chroma * (1 - Math.abs((h % 2) - 1));
    const base = value - chroma;
    let r = chroma;
    let g = x;
    let b = 0;
    switch (Math.floor(h)) {
    case 1: r = x; g = chroma; break;
    case 2: r = 0; g = chroma; b = x; break;
    case 3: r = 0; g = x; b = chroma; break;
    case 4: r = x; g = 0; b = chroma; break;
    case 5: r = chroma; g = 0; b = x; break;
    default: break;
    }
    out[0] = r + base;
    out[1] = g + base;
    out[2] = b + base;
    return out;
}
const RESTING_GREEN_HSV = toHsv(RESTING_GREEN, [0, 0, 0]);
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const smoothstep = (edge0, edge1, value) => {
    const t = clamp01((value - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
};
/** Exponential approach with separate rise and fall half-lives, frame-rate independent. */
const approach = (value, target, dt, riseHalfLife, fallHalfLife) => {
    const halfLife = target > value ? riseHalfLife : fallHalfLife;
    return target + (value - target) * 0.5 ** (dt / halfLife);
};

function makeBoard() {
    return {
        tracker: new ComboTracker(),
        azimuth: 0,
        halfWidth: 0.15,
        pending: false,
        lock: false,
        /** A piece locked this frame, seen or not (it counts toward the heat of play). */
        counted: false,
        dropped: false,
        hardDrop: 0,
        column: 0.5,
        hasColor: false,
        color: [0, 0, 0],
        lines: 0,
        cascade: 1,
        advanced: false,
        tspin: false,
        b2b: false,
        perfect: false,
        levelUp: false,
    };
}

function clearPending(board) {
    board.pending = false;
    board.lock = false;
    board.counted = false;
    board.dropped = false;
    board.hardDrop = 0;
    board.hasColor = false;
    board.lines = 0;
    board.cascade = 1;
    board.advanced = false;
    board.tspin = false;
    board.b2b = false;
    board.perfect = false;
    board.levelUp = false;
}

/** Board-normalised column of a locked piece (0 left … 1 right), or null without one. */
export function pieceColumn(payload) {
    const origin = payload?.viewportOrigin;
    if (origin && Number.isFinite(origin.x)) return clamp01(origin.x);
    const piece = payload?.piece;
    if (!piece || !Number.isFinite(piece.x)) return null;
    const { shape } = piece;
    if (!Array.isArray(shape)) return clamp01((piece.x + 0.5) / BOARD_COLUMNS);
    let sum = 0;
    let cells = 0;
    for (let row = 0; row < shape.length; row += 1) {
        const line = shape[row];
        if (!Array.isArray(line)) continue;
        for (let column = 0; column < line.length; column += 1) {
            if (line[column]) {
                sum += piece.x + column + 0.5;
                cells += 1;
            }
        }
    }
    return cells > 0 ? clamp01(sum / cells / BOARD_COLUMNS) : clamp01((piece.x + 0.5) / BOARD_COLUMNS);
}

/** Board-normalised row of a set of cleared rows (0 top … 1 bottom), or null. */
export function clearedRowHeight(payload) {
    const rows = payload?.clearedRows;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    let sum = 0;
    let count = 0;
    for (const row of rows) {
        if (Number.isFinite(row)) {
            sum += row;
            count += 1;
        }
    }
    return count > 0 ? clamp01((sum / count + 0.5 - HIDDEN_ROWS) / VISIBLE_ROWS) : null;
}

export class AuroraDirector {
    /**
     * @param {object} options
     * @param {import('./aurora-field.js').ExcitationMap} options.excitation map the pulses paint
     * @param {number} [options.seed]
     */
    constructor({ excitation, seed = 7919 } = {}) {
        if (!excitation?.accumulate) throw new TypeError('AuroraDirector requires an ExcitationMap');
        this.excitation = excitation;
        this.seedValue = seed >>> 0;
        this.reducedMotion = false;
        /** How much of a rhythmic pulse to show (flashScale(), ADR-0021): the owner sets it. */
        this.flashing = 1;
        this.boards = Array.from({ length: BOARD_SLOTS }, makeBoard);
        this.pulses = Array.from({ length: MAX_PULSES }, () => ({
            active: false,
            born: 0,
            life: 1,
            row: 0,
            centre: 0,
            velocity: 0,
            sigma: 20,
            amp: 0,
            shift: 0,
            red: 0,
            green: 0,
            blue: 0,
        }));
        this.ripples = Array.from({ length: MAX_RIPPLES }, () => ({
            azimuth: 0, range: 0, strength: 0, speed: 26, color: [0, 0, 0],
        }));
        this.meteors = Array.from({ length: MAX_METEORS }, () => ({
            fromAzimuth: 0, fromElevation: 0, toAzimuth: 0, toElevation: 0, duration: 1, brightness: 1, warmth: 0,
        }));
        this.arcGain = AURORA_ARCS.map((arc) => arc.gain);
        // Per arc, BILLOW.slots waves as [centre km, amplitude km, 1/width, 0].
        this.billows = new Float32Array(AURORA_ARCS.length * BILLOW.slots * 4);
        // Bands climbing the rays: each runs its course (see launchSweep).
        this.sweeps = Array.from({ length: SWEEP.slots }, () => ({
            age: Infinity, life: SWEEP.seconds, strength: 0, width: SWEEP.width,
        }));
        // What the shader reads, per band: [altitude above the border km, gain, 1/width, 0].
        this.sweepBands = new Float32Array(SWEEP.slots * 4);
        /** Where along each arc the display is awake; the march reads `weather.cells`. */
        this.weather = new AuroraWeather();
        /** The hour of the night (aurora-hours.js): the clock turns it, a level steps it on. */
        this.hours = new AuroraHours();
        /**
         * The heat of play (src/themes/shared/gameplay-surge.js), on this director's clock: the
         * geomagnetic storm that builds under the cues. Sampled once a frame into heatPunch,
         * heatLevel, heatFever and heatStage.
         */
        this.heat = new GameplaySurge();
        this.tint = [0, 0, 0, 0];
        /** The colour the storm turns the body (and the light on snow and water) this frame. */
        this.stormColor = [...RESTING_GREEN];
        this.scratchStorm = [0, 0, 0];
        this.scratchHsv = [0, 0, 0];
        this.compress = 0.3;
        this.light = [...this.hours.colours.glow];
        this.scratch = [0, 0, 0];
        this.scratchColor = [0, 0, 0];
        this.reset();
    }

    /** Rewind to a calm sky. Replaying the same events from here reproduces the same frames. */
    reset() {
        this.time = 0;
        this.seed = this.seedValue;
        this.cycle = 0;
        this.surgeDirection = 1;
        this.activity = 0;
        this.activityTarget = 0;
        this.activityHold = 0;
        this.surge = 0;
        this.heightKick = 0;
        this.crownKick = 0;
        this.fringeKick = 0;
        this.violetKick = 0;
        this.corona = 0;
        this.coronaTarget = 0;
        this.coronaHold = 0;
        this.tau = 0;
        this.rayPhase = 0;
        for (const band of this.sweeps) {
            band.age = Infinity;
            band.strength = 0;
        }
        this.sweepAltitude = -200;
        this.sweepGain = 0;
        this.stormTint = 0;
        this.stormTarget = 0;
        this.b2bCount = 0;
        this.heat.reset();
        this.heatPunch = 0;
        this.heatLevel = 0;
        this.heatFever = 0;
        this.heatStage = 0;
        this.showerClock = 0;
        this.recoveryClock = 0;
        this.afterglow = 0;
        this.lastClearAt = -Infinity;
        this.pulseLight = [0, 0, 0];
        this.tint.fill(0);
        this.rippleCount = 0;
        this.meteorCount = 0;
        this.shakeAmount = 0;
        this.shakeDuration = 0;
        this.lastCombo = 0;
        this.eventCount = 0;
        for (const board of this.boards) {
            board.tracker.reset();
            clearPending(board);
        }
        for (const pulse of this.pulses) pulse.active = false;
        this.excitation.clear();
        this.weather.reset();
        this.hours.reset();
        this.deriveOutputs();
    }

    random() {
        this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
        return this.seed / 4294967296;
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Where a board sits in the view: azimuth of its centre and half its angular width. */
    setBoard(index, azimuth, halfWidth) {
        const board = this.boards[index];
        if (!board || !Number.isFinite(azimuth) || !Number.isFinite(halfWidth)) return;
        board.azimuth = clamp(azimuth, -1.2, 1.2);
        board.halfWidth = clamp(halfWidth, 0.01, 0.8);
    }

    boardFor(payload) {
        const player = payload?.player;
        if (Number.isInteger(player) && player >= 1 && player < BOARD_SLOTS) return this.boards[player];
        return this.boards[0];
    }

    // ── intake: synchronous bus handlers stage numbers only ─────────────────────────

    /** Fires just before the PIECE_LOCK of the same piece. */
    onHardDrop(payload) {
        const board = this.boardFor(payload);
        const span = finite(payload?.endY) - finite(payload?.startY);
        board.hardDrop = Math.max(board.hardDrop, clamp(finite(payload?.distance, span), 0, 40));
        return true;
    }

    /**
     * Every lock advances the clear-streak bookkeeping. `visible: false` keeps that and
     * the piece's colour (a clear may follow) but stages no pluck of its own.
     */
    onPieceLock(payload, visible = true) {
        const board = this.boardFor(payload);
        board.tracker.notePieceLocked();
        board.counted = true;
        board.dropped = board.dropped || board.hardDrop > 0;
        if (visible) {
            board.pending = true;
            board.lock = true;
        } else {
            board.hardDrop = 0;
        }
        const column = pieceColumn(payload);
        if (column !== null) board.column = column;
        board.hasColor = parseColor(payload?.piece?.color, board.color);
        return true;
    }

    onLineClear(payload) {
        const board = this.boardFor(payload);
        const rows = Array.isArray(payload?.clearedRows) ? payload.clearedRows.length : 0;
        const lines = clamp(Math.floor(finite(Number(payload?.lineCount), rows || 1)), 0, 4);
        if (lines <= 0) return false;
        board.pending = true;
        board.lines = Math.max(board.lines, lines);
        board.cascade = Math.max(board.cascade, clamp(Math.floor(finite(payload?.cascadeCount, 1)), 1, 12));
        const before = board.tracker.combo;
        const combo = board.tracker.noteLineClear();
        if (combo > before) board.advanced = true;
        // Only clicks in Serenity mode and Odyssey's victory lap put a combo on the clear.
        const explicit = Math.floor(finite(payload?.comboCount, 0));
        if (explicit > board.tracker.combo) {
            board.tracker.combo = Math.min(60, explicit);
            board.advanced = true;
        }
        return true;
    }

    /** The bus's COMBO is cascade depth: one lock that keeps clearing as the stack settles. */
    onCascade(payload) {
        const depth = clamp(Math.floor(finite(Number(payload?.comboCount ?? payload), 0)), 0, 12);
        if (depth < 2) return false;
        const board = this.boardFor(payload);
        board.cascade = Math.max(board.cascade, depth);
        return true;
    }

    onTSpin(payload) {
        const board = this.boardFor(payload);
        board.pending = true;
        board.tspin = true;
        return true;
    }

    onBackToBack(payload) {
        this.boardFor(payload).b2b = true;
        return true;
    }

    onPerfectClear(payload) {
        const board = this.boardFor(payload);
        board.pending = true;
        board.perfect = true;
        return true;
    }

    /** A level: its cue is staged, and the night moves an hour on (eased in by update()). */
    onLevelUp(payload) {
        const board = this.boardFor(payload);
        board.pending = true;
        board.levelUp = true;
        this.hours.levelUp();
        return true;
    }

    /**
     * A level whose cue is not to play (background effects switched off): the night still moves
     * an hour on. The light is the world's own, not a reaction.
     */
    stepHours() {
        this.hours.levelUp();
    }

    /** Stand the levels' hours at `steps` at once: a restart carrying its run. */
    setHourSteps(steps) {
        this.hours.setLevelSteps(steps);
        this.deriveOutputs();
    }

    /**
     * Run over, mode stopped, or effects switched off: let the sky settle. The storm's heat
     * is left to fall on its own, so the sky breathes back instead of dropping.
     */
    calm() {
        this.activityTarget = 0;
        this.activityHold = 0;
        this.coronaTarget = 0;
        this.coronaHold = 0;
        this.lastCombo = 0;
        this.stormTarget = 0;
        this.b2bCount = 0;
        for (const board of this.boards) {
            board.tracker.reset();
            clearPending(board);
        }
    }

    // ── cues ──────────────────────────────────────────────────────────────────────

    motion() {
        return this.reducedMotion ? REDUCED_MOTION_SCALE : 1;
    }

    nextCycleColor(out) {
        const color = PULSE_CYCLE[this.cycle % PULSE_CYCLE.length];
        this.cycle += 1;
        out[0] = color[0];
        out[1] = color[1];
        out[2] = color[2];
        return out;
    }

    /**
     * Spawn one pulse; when the pool is full it takes the slot with the least light and
     * fabric left to give (a faint pulse near its end), never a strum still in full voice.
     * Allocates nothing.
     */
    spawnPulse(row, centre, velocity, life, sigma, amp, shift, color, delay = 0) {
        let chosen = this.pulses[0];
        let weakest = Infinity;
        for (const pulse of this.pulses) {
            if (!pulse.active) {
                chosen = pulse;
                break;
            }
            const progress = clamp01((this.time - pulse.born) / pulse.life);
            const left = (pulse.amp + Math.abs(pulse.shift) / BILLOW.maxAmplitude) * (1 - progress) ** 1.2;
            if (left < weakest) {
                weakest = left;
                chosen = pulse;
            }
        }
        chosen.active = true;
        chosen.born = this.time + delay;
        chosen.life = life;
        chosen.row = row;
        chosen.centre = centre;
        chosen.velocity = velocity;
        chosen.sigma = sigma;
        chosen.amp = amp;
        // `|| 0` folds the −0 a still pulse would otherwise carry.
        chosen.shift = clamp(shift, -BILLOW.maxAmplitude, BILLOW.maxAmplitude) * this.motion() || 0;
        [chosen.red, chosen.green, chosen.blue] = color;
    }

    /**
     * Launch a pulse along an arc from the point above a view azimuth. Its pace (`turn`,
     * radians of view per second) and width (`spread`, radians of view) are given in view
     * angle, so a pulse reads the same on a near arc and a far one. `direction` is +1
     * toward the right of the view, −1 toward the left, 0 to stand still.
     */
    launch(arc, azimuth, direction, turn, life, spread, amp, shift, color, delay = 0) {
        const origin = arcCoordinateForAzimuth(arc, azimuth);
        const rate = arcRateForAzimuth(arc, azimuth);
        if (origin === null || rate === null) return false;
        const velocity = direction * Math.min(MAX_PULSE_SPEED, turn * rate);
        // A billow has to stay wider than the march's sample spacing to be followed.
        const sigma = clamp(spread * rate, shift !== 0 ? 60 : 8, 150);
        this.spawnPulse(arc.index, origin, velocity, life, sigma, amp, direction * shift, color, delay);
        return true;
    }

    /**
     * Pulses leaving both edges of a board, outward: the board hides the sky behind it, so
     * a pluck starts where it can be seen. The side the piece landed on takes more of it.
     */
    pluck(arc, board, turn, life, spread, amp, shift, color, delay = 0) {
        const lean = (board.column - 0.5) * 0.7;
        const reach = board.halfWidth * BOARD_EDGE;
        this.launch(arc, board.azimuth - reach, -1, turn, life, spread, amp * (1 - lean), shift, color, delay);
        this.launch(arc, board.azimuth + reach, 1, turn, life, spread, amp * (1 + lean), shift, color, delay);
    }

    /**
     * Wake the curtain on `arc` around a view azimuth: `width` (half-width) and `spread`
     * (widening, easing off) in radians of view, `pace` (steady drift) in radians per second,
     * `tops` toward the red crown (+) or blue-violet ray tops (−). See AuroraWeather.wake.
     */
    wake(arc, azimuth, width, amount, spread = 0, pace = 0, tops = 0, delay = 0) {
        const motion = this.motion();
        return this.weather.wake(
            arc.index,
            bearingForAzimuth(arc, azimuth),
            width,
            amount,
            spread * motion,
            pace * motion,
            tops,
            delay,
        );
    }

    /** Wake the stretches just beside a board, the side the piece landed on more. */
    wakeBeside(arc, board, width, amount, tops = 0) {
        const lean = (board.column - 0.5) * 0.7;
        const reach = board.halfWidth * BOARD_EDGE + width * 0.6;
        this.wake(arc, board.azimuth - reach, width, amount * (1 - lean), 0.02, 0, tops);
        this.wake(arc, board.azimuth + reach, width, amount * (1 + lean), 0.02, 0, tops);
    }

    queueRipple(azimuth, range, strength, speed, color) {
        let ripple = null;
        if (this.rippleCount < MAX_RIPPLES) {
            ripple = this.ripples[this.rippleCount];
            this.rippleCount += 1;
        } else {
            // A crowded frame keeps its strongest rings: a stronger one takes the weakest's place.
            for (const queued of this.ripples) if (!ripple || queued.strength < ripple.strength) ripple = queued;
            if (ripple.strength >= strength) return;
        }
        ripple.azimuth = azimuth;
        ripple.range = clamp01(range);
        ripple.strength = strength;
        ripple.speed = speed;
        [ripple.color[0], ripple.color[1], ripple.color[2]] = color;
    }

    queueMeteors(count, brightness) {
        const allowed = this.reducedMotion ? Math.min(1, count) : count;
        for (let i = 0; i < allowed && this.meteorCount < MAX_METEORS; i += 1) {
            const meteor = this.meteors[this.meteorCount];
            // Meteors cross the open sky on either side, never behind the board.
            const side = this.random() < 0.5 ? -1 : 1;
            meteor.fromAzimuth = side * (11 + this.random() * 27) * DEG;
            meteor.fromElevation = (21 + this.random() * 17) * DEG;
            meteor.toAzimuth = meteor.fromAzimuth + side * (5 + this.random() * 12) * DEG;
            meteor.toElevation = Math.max(4 * DEG, meteor.fromElevation - (7 + this.random() * 10) * DEG);
            meteor.duration = 0.55 + this.random() * 0.45;
            meteor.brightness = brightness * (0.8 + this.random() * 0.5);
            meteor.warmth = this.random();
            this.meteorCount += 1;
        }
    }

    requestShake(amount, durationMs) {
        if (this.reducedMotion || amount <= this.shakeAmount) return;
        this.shakeAmount = amount;
        this.shakeDuration = durationMs;
    }

    raiseActivity(target, hold) {
        this.activityTarget = Math.max(this.activityTarget, clamp01(target));
        this.activityHold = Math.max(this.activityHold, hold);
    }

    raiseCorona(target, hold) {
        const ceiling = this.reducedMotion ? 0.5 : 1;
        this.coronaTarget = Math.max(this.coronaTarget, clamp(target, 0, ceiling));
        this.coronaHold = Math.max(this.coronaHold, hold);
    }

    /**
     * Send a band up the rays. It takes a free slot, or the weakest band in flight, and the
     * others run their course: a cascade's waves climb one above the other instead of one
     * band being yanked back to the foot of the curtain. When every band in flight is still
     * brighter than the new one, the new one lifts the faintest instead of cutting it.
     */
    launchSweep(strength, seconds = SWEEP.seconds, width = SWEEP.width, delay = 0) {
        const amount = strength * (this.reducedMotion ? 0.5 : 1);
        if (!(amount > 0)) return;
        let chosen = this.sweeps[0];
        let weakest = Infinity;
        for (const band of this.sweeps) {
            if (!(band.age < band.life)) {
                chosen = band;
                weakest = 0;
                break;
            }
            const left = band.strength * (1 - clamp01(band.age / band.life)) ** 0.8;
            if (left < weakest) {
                weakest = left;
                chosen = band;
            }
        }
        if (weakest > amount) {
            chosen.strength = Math.min(1.4, chosen.strength + amount * 0.5);
            return;
        }
        chosen.age = -Math.max(0, delay);
        chosen.life = Math.max(0.2, seconds);
        chosen.strength = amount;
        chosen.width = width;
    }

    cueLock(board, color) {
        const drop = clamp01(board.hardDrop / 16);
        // A quick hand plucks a little harder: the punch of play rides under every lock.
        const strength = Math.min(1, (0.6 + drop * 0.4) * (1 + this.heatPunch * 0.3));
        // Wide and unhurried in view terms: the pulse takes over a stretch of curtain beside
        // the board and carries its colour outward, instead of racing to the horizon.
        this.pluck(AURORA_ARCS[0], board, 0.28 + drop * 0.12, 1.5, 0.13, strength, 0, color);
        if (RESTING_ARCS[1]) this.pluck(RESTING_ARCS[1], board, 0.3, 1.4, 0.13, 0.85 * strength, 0, color, 0.05);
        // The curtain beside the board wakes; quick hands build it into a blazing stretch.
        this.wakeBeside(AURORA_ARCS[0], board, 0.1, 0.2 * strength);
        if (RESTING_ARCS[1]) this.wakeBeside(RESTING_ARCS[1], board, 0.1, 0.15 * strength);
        const azimuth = board.azimuth + (board.column - 0.5) * 2 * board.halfWidth;
        this.queueRipple(azimuth, 0.25 + drop * 0.2, 0.42 * strength, 24 + drop * 8, color);
        this.activity = Math.min(1, this.activity + 0.012);
        this.pulseLight[0] += color[0] * 0.14 * strength;
        this.pulseLight[1] += color[1] * 0.14 * strength;
        this.pulseLight[2] += color[2] * 0.14 * strength;
        // Hot play: the curtains pulse with every lock, in the rhythm of the hand.
        if (this.heatStage >= 2) this.launchSweep((0.08 + this.heatLevel * 0.22) * this.flashing, 0.7, 40);
        this.requestShake(0.0046 * (1 + this.heatPunch * 0.6), 90);
    }

    cueClear(board, color) {
        const { lines } = board;
        const { combo } = board.tracker;
        const depth = board.cascade;
        // A later wave of one lock's cascade: it builds on the waves before it.
        const wave = !board.advanced && depth >= 2;
        const boost = (board.b2b ? 1.15 : 1) * (1 + (depth - 1) * 0.12);
        const { azimuth } = board;
        const quad = lines >= 4;
        const tint = board.tspin ? TSPIN_VIOLET : color;

        // Strum: every arc takes pulses from both edges of the board, a billow that moves
        // the fabric itself, and a bloom standing in the sky around the board.
        for (const arc of RESTING_ARCS) {
            const near = arc.index === 0 ? 1 : 0.75;
            this.pluck(
                arc,
                board,
                0.3 + lines * 0.04,
                1.7 + lines * 0.12,
                0.13 + lines * 0.015,
                Math.min(1, (0.5 + lines * 0.12) * near * boost),
                0,
                tint,
            );
            this.pluck(arc, board, 0.42, 2.2, 0.17, 0, (board.tspin ? 34 : 15 + lines * 4) * near, tint);
            this.launch(arc, azimuth, 0, 0, 1.15, board.halfWidth + 0.16, 0.3 * near * boost, 0, tint);
            // An awake front runs out along the arc from the board; a bigger clear colours
            // its tall rays, the near arc violet-topped and the others red-crowned.
            let tops = 0;
            if (board.tspin) tops = -1;
            else if (lines >= 2) tops = arc.index === 0 ? -0.7 : 0.6;
            this.wake(
                arc,
                azimuth,
                board.halfWidth * 0.9,
                Math.min(1, (0.35 + lines * 0.12) * near * boost),
                0.3 + lines * 0.06,
                0,
                tops,
            );
        }
        // Flames up the rays: each cascade wave's climb brighter, faster and wider, and a
        // bigger clear sends a second flame after the first.
        const pace = 1 + (depth - 1) * 0.14;
        const flame = (0.35 + lines * 0.15) * (1 + (depth - 1) * 0.2);
        this.launchSweep(flame, SWEEP.seconds / pace, SWEEP.width * (1 + (depth - 1) * 0.18));
        if (lines >= 2) this.launchSweep(flame * 0.6, SWEEP.seconds / pace, SWEEP.width, 0.22);
        this.surge = Math.min(0.8, this.surge + (0.18 + lines * 0.07) * boost);
        this.heightKick = Math.min(0.9, this.heightKick + 0.14 + lines * 0.07);
        this.fringeKick = Math.min(1.2, this.fringeKick + lines * 0.22);
        this.crownKick = Math.min(1.2, this.crownKick + lines * 0.12);
        if (board.tspin) this.violetKick = Math.min(1.2, this.violetKick + 0.8);

        const streak = 1 - Math.exp(-(combo - 1) * 0.2);
        this.raiseActivity(
            Math.max(0.12 + lines * 0.05, streak) + (lines - 1) * 0.04 + (depth - 1) * 0.07 + (quad ? 0.18 : 0),
            1.7 + lines * 0.15,
        );
        this.queueRipple(azimuth, 0.45, (0.7 + lines * 0.15) * boost, 34, tint);
        if (lines >= 2) this.queueRipple(azimuth - board.halfWidth * 1.4, 0.2, 0.4 + lines * 0.08, 28, tint);
        if (lines >= 3) this.queueRipple(azimuth + board.halfWidth * 1.4, 0.62, 0.4 + lines * 0.08, 30, tint);
        if (lines === 3) this.queueMeteors(1, 1.4);
        // From the third wave on, a meteor more each wave.
        if (depth >= 3) this.queueMeteors(Math.min(3, depth - 2), 1.3 + Math.min(depth, 8) * 0.08);
        this.requestShake(
            Math.min(0.0205, 0.0056 * lines + Math.min(0.0082, Math.max(0, combo - 1) * 0.0018))
                * (1 + this.heatPunch * 0.3),
            120,
        );

        if (quad) {
            // Breakup: the whole sky wakes from the board outward, a train of flames climbs
            // the rays behind the strum, the corona opens overhead and the crown ignites.
            for (const arc of RESTING_ARCS) this.wake(arc, azimuth, 0.3, 1, 0.95, 0, arc.index === 0 ? -0.9 : 0.6, 0.1);
            this.launchSweep(0.7, SWEEP.seconds * 1.1, SWEEP.width * 1.2, 0.3);
            this.launchSweep(0.5, SWEEP.seconds * 1.2, SWEEP.width * 1.3, 0.6);
            this.raiseCorona(1, 1.4);
            this.crownKick = Math.min(1.2, this.crownKick + 0.6);
            this.queueMeteors(3, 1.8);
            this.requestShake(0.0225, 150);
        }
        if (board.tspin) this.requestShake(0.0133, 130);
        if (depth >= 2) this.cueWave(board, depth, tint);

        // A growing streak: each consecutive clear sends one surge the length of the sky.
        if (board.advanced && combo >= 2) this.cueStreak(combo, color);
        if (!wave) {
            // The run of difficult clears: a back-to-back counts up, anything plainer ends it.
            this.b2bCount = board.b2b ? Math.min(4, this.b2bCount + 1) : 0;
            if (board.b2b) this.cueBackToBack(board);
        }
        this.lastClearAt = this.time;
        this.pulseLight[0] += tint[0] * (0.2 + lines * 0.06);
        this.pulseLight[1] += tint[1] * (0.2 + lines * 0.06);
        this.pulseLight[2] += tint[2] * (0.2 + lines * 0.06);
    }

    /**
     * A cascade wave past the first: a surge leaves the board both ways along every arc, in
     * the storm hue a step further on each wave, faster and wider each time, and the crown
     * and the curtains climb with it — the fourth wave is plainly bigger than the second.
     */
    cueWave(board, depth, color) {
        const step = Math.min(depth, 8) - 1;
        const storm = STORM_TINTS[Math.min(STORM_TINTS.length - 1, step)];
        const blend = this.scratch;
        for (let i = 0; i < 3; i += 1) blend[i] = storm[i] * 0.55 + color[i] * 0.45;
        for (const arc of RESTING_ARCS) {
            const near = arc.index === 0 ? 1 : 0.8;
            this.pluck(
                arc,
                board,
                0.42 + step * 0.12,
                1.5 + step * 0.1,
                0.15 + step * 0.03,
                Math.min(1, (0.42 + step * 0.12) * near),
                Math.min(BILLOW.maxAmplitude, 10 + step * 6) * near,
                blend,
                0.04,
            );
            const tops = step % 2 ? -0.7 : 0.7;
            this.wake(arc, board.azimuth, 0.18, Math.min(1, 0.3 + step * 0.1), 0.4 + step * 0.08, 0, tops);
        }
        this.heightKick = Math.min(0.9, this.heightKick + 0.06 * step);
        this.crownKick = Math.min(1.2, this.crownKick + 0.06 * step);
        this.queueRipple(board.azimuth, 0.3 + 0.08 * step, 0.5 + 0.15 * step, 30 + 4 * step, blend);
    }

    /**
     * A back-to-back: the sky answers twice. A crimson wave leaves the board just after the
     * strum, a second band climbs the rays behind the first and the crown flares — more with
     * each back-to-back in a run.
     */
    cueBackToBack(board) {
        const count = this.b2bCount;
        for (const arc of RESTING_ARCS) {
            const near = arc.index === 0 ? 1 : 0.8;
            this.pluck(
                arc,
                board,
                0.36 + count * 0.04,
                1.9,
                0.16,
                Math.min(1, (0.55 + count * 0.1) * near),
                (12 + count * 4) * near,
                CRIMSON,
                0.16,
            );
            // The crimson wave wakes the sky red-crowned.
            this.wake(arc, board.azimuth, 0.2, Math.min(1, (0.4 + count * 0.1) * near), 0.35, 0, 1, 0.16);
        }
        this.launchSweep(0.3 + count * 0.12, SWEEP.seconds, SWEEP.width, 0.18);
        this.crownKick = Math.min(1.2, this.crownKick + 0.25 + count * 0.08);
        this.heightKick = Math.min(0.9, this.heightKick + 0.08 * count);
        this.queueRipple(board.azimuth, 0.55, 0.6 + count * 0.12, 32, CRIMSON);
        if (count >= 2) this.queueMeteors(Math.min(3, count - 1), 1.6);
    }

    cueStreak(combo, color) {
        this.lastCombo = combo;
        const storm = STORM_TINTS[(combo - 2) % STORM_TINTS.length];
        const blend = this.scratch;
        for (let i = 0; i < 3; i += 1) blend[i] = storm[i] * 0.65 + color[i] * 0.35;
        this.surgeDirection = -this.surgeDirection;
        const seconds = Math.max(1.5, 2.7 - Math.min(combo, 12) * 0.09);
        for (const arc of RESTING_ARCS) {
            // Alternate arcs run opposite ways, so the surges cross in mid-sky.
            const direction = arc.index % 2 === 0 ? this.surgeDirection : -this.surgeDirection;
            const [left, right] = arcViewSpan(arc);
            const from = direction > 0 ? left : right;
            const to = direction > 0 ? right : left;
            const velocity = (to - from) / seconds;
            this.spawnPulse(arc.index, from, velocity, seconds + 0.1, 58, Math.min(1, 0.6 + combo * 0.04), 0, blend);
            this.spawnPulse(arc.index, from, velocity, seconds + 0.1, 84, 0, Math.min(34, 18 + combo * 2), blend);
            // An awake stretch rides with the surge (at its pace, whatever the motion setting),
            // so the light is seen to run the length of the sky.
            const start = arcBearing(arc, from);
            this.weather.wake(
                arc.index,
                start,
                0.14,
                Math.min(0.9, 0.45 + combo * 0.04),
                0,
                (arcBearing(arc, to) - start) / seconds,
                combo % 2 === 0 ? -0.8 : 0.8,
            );
        }
        // Where the storm hue is headed; update() eases the body there.
        this.stormTarget = Math.min(STORM_TINTS.length - 1, (combo - 2) * 0.5);
        this.fringeKick = Math.min(1.2, this.fringeKick + 0.1 + combo * 0.05);
        this.crownKick = Math.min(1.2, this.crownKick + 0.05 + combo * 0.04);
        if (combo >= 3) this.queueMeteors(Math.min(3, Math.floor(combo / 3)), 1.3 + Math.min(combo, 10) * 0.07);
        if (combo >= 5) this.raiseCorona(0.3 + (combo - 5) * 0.12, 1.5);
        if (combo >= 7) this.requestShake(0.0307, 190);
    }

    /**
     * The perfect clear: the crown on whatever is still playing (physics sends it after the
     * clear's last wave, on its own). Amber light stands on every arc and in the corona
     * overhead, the crown burns, a band climbs the whole display; never a second clear. It is
     * also the storm's release: it holds a moment, then lets the sky go.
     */
    cuePerfect(board) {
        this.raiseCorona(1, 1.8);
        this.raiseActivity(1, 2);
        this.surge = Math.min(0.8, this.surge + 0.6);
        this.heightKick = Math.min(0.9, this.heightKick + 0.6);
        this.crownKick = Math.min(1.2, this.crownKick + 0.9);
        this.launchSweep(0.7, 1.1, 60);
        for (const arc of RESTING_ARCS) {
            this.launch(arc, board.azimuth, 0, 0, 2.4, 0.55, 0.9, 0, AMBER);
            this.wake(arc, board.azimuth, 0.5, 1.2, 0.6, 0, 0.9);
        }
        this.launch(CORONA_ARC, board.azimuth, 0, 0, 2.8, 0.9, 1, 0, AMBER);
        this.queueMeteors(4, 2);
        this.queueRipple(board.azimuth, 0.4, 1.2, 38, AMBER);
        this.lastClearAt = this.time;
        this.requestShake(0.0307, 190);
    }

    /** A T-spin that cleared nothing: a small violet twist in the curtain above the board. */
    cueSpin(board) {
        this.pluck(AURORA_ARCS[0], board, 0.34, 1.6, 0.15, 0.55, 22, TSPIN_VIOLET);
        this.wake(AURORA_ARCS[0], board.azimuth, 0.16, 0.4, 0.15, 0, -1);
        this.violetKick = Math.min(1.2, this.violetKick + 0.35);
        this.queueRipple(board.azimuth, 0.35, 0.45, 28, TSPIN_VIOLET);
        this.requestShake(0.0075, 110);
    }

    cueLevelUp(board) {
        this.raiseActivity(Math.max(this.activityTarget, 0.3), 1.6);
        this.launchSweep(0.6);
        for (const arc of RESTING_ARCS) this.wake(arc, board.azimuth, 0.35, 0.45, 0.5, 0, -0.5);
        this.heightKick = Math.min(0.9, this.heightKick + 0.25);
        this.queueMeteors(1, 1.5);
        this.queueRipple(board.azimuth, 0.5, 0.5, 30, PULSE_CYCLE[1]);
    }

    resolve(board) {
        const color = this.scratchColor;
        if (board.hasColor) {
            vivid(board.color, color);
        } else if (board.lines > 0 || board.lock) {
            this.nextCycleColor(color);
        }
        // A lock that clears is one event: the clear cue carries the piece's colour.
        if (board.lines > 0) this.cueClear(board, color);
        else if (board.lock) this.cueLock(board, color);
        if (board.tspin && board.lines === 0) this.cueSpin(board);
        if (board.perfect) this.cuePerfect(board);
        if (board.levelUp) this.cueLevelUp(board);
        this.feedHeat(board, this.time);
        this.eventCount += 1;
        clearPending(board);
    }

    /** What this frame's events add to the heat of play, each at its own weight. */
    feedHeat(board, at) {
        const { heat } = this;
        if (board.counted) heat.lock({ hardDrop: board.dropped }, at);
        if (board.lines > 0 && (board.advanced || board.cascade < 2)) {
            heat.clear({
                lines: board.lines,
                cascade: board.cascade,
                combo: board.tracker.combo,
                tspin: board.tspin,
                b2b: board.b2b,
                perfect: board.perfect,
            }, at);
        } else {
            // A later wave of a cascade its first wave already counted, or no clear at all.
            if (board.lines > 0) heat.wave(at);
            if (board.tspin) {
                if (board.lines > 0) heat.tspin(at);
                else heat.spin(at);
            }
            if (board.b2b && board.lines > 0) heat.b2b(at);
            if (board.perfect) heat.crown(at);
        }
        if (board.levelUp) heat.levelUp(at);
    }

    // ── simulation ────────────────────────────────────────────────────────────────

    /**
     * Advance by `dt` seconds. `clock` is the world's own time (the theme's, which a restart
     * carries): the hour of the night is read from it, so it stands where the clock says
     * whatever happened to the director. Without one, the director's own time stands in.
     */
    update(dt, clock = undefined) {
        const step = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
        this.rippleCount = 0;
        this.meteorCount = 0;
        this.shakeAmount = 0;
        this.shakeDuration = 0;
        for (const board of this.boards) {
            if (board.pending) {
                this.resolve(board);
                continue;
            }
            if (board.counted) {
                // A lock with its pluck switched off still warms the storm.
                this.heat.lock({ hardDrop: board.dropped }, this.time);
                board.counted = false;
                board.dropped = false;
            }
            if (board.hardDrop > 0) board.hardDrop = 0;
        }
        this.hours.update(step, Number.isFinite(clock) ? clock : this.time + step);
        if (step <= 0) {
            this.paint();
            this.deriveOutputs();
            return;
        }
        this.time += step;
        this.sampleHeat();
        const fever = this.heatFever;

        this.activityHold = Math.max(0, this.activityHold - step);
        if (this.activityHold <= 0) this.activityTarget = Math.max(0, this.activityTarget - step * 0.22);
        // The heat of play holds the display up while the hands stay quick; casual play (a
        // level under 0.2) leaves it to the cues alone, as it always was.
        const held = clamp01((this.heatLevel - 0.2) / 0.75) * 0.9 + fever * 0.1;
        if (held > this.activityTarget) this.activityTarget = held;
        this.activity = approach(this.activity, this.activityTarget, step, 0.28, 3.2);
        this.coronaHold = Math.max(0, this.coronaHold - step);
        if (this.coronaHold <= 0) this.coronaTarget = Math.max(0, this.coronaTarget - step * 0.7);
        // The substorm: the corona stands open overhead for as long as the fever lasts.
        if (fever > 0) this.raiseCorona(fever * 0.8, 0);
        this.corona = approach(this.corona, this.coronaTarget, step, 0.16, 0.9);
        if (this.corona < 0.0015 && this.coronaTarget === 0) this.corona = 0;
        if (this.activity < 0.0005 && this.activityTarget === 0) this.activity = 0;
        // The sky's own weather turns over faster, and swells, as the storm builds.
        this.weather.update(step, clamp01(this.activity * 0.5 + this.heatLevel * 0.3 + fever * 0.6));

        this.surge *= Math.exp(-2.2 * step);
        this.heightKick *= Math.exp(-0.9 * step);
        this.crownKick *= Math.exp(-0.6 * step);
        this.fringeKick *= Math.exp(-1.2 * step);
        this.violetKick *= Math.exp(-0.8 * step);
        for (let i = 0; i < 3; i += 1) this.pulseLight[i] *= Math.exp(-1.6 * step);
        if (this.surge < 1e-4) this.surge = 0;

        // The storm hue follows the streak and the heat (teal, blue, violet, then magenta),
        // easing there, so a new link, or a new chain, never steps the colour of the sky.
        const heatTint = this.heatLevel * 2.2 + fever * 1.2;
        const stormGoal = Math.min(STORM_TINTS.length - 1, Math.max(this.stormTarget, heatTint));
        this.stormTint = stormGoal + (this.stormTint - stormGoal) * Math.exp(-step / STORM_EASE);

        // Phases integrate their speed, so a change of pace never jumps the pattern. The
        // heat quickens the folds and the rays a little more, gently under reduced motion.
        const quicken = (this.heatLevel * 0.5 + fever * 0.7) * this.motion();
        this.tau += step * (1 + this.activity * 2.2 + this.surge * 1.5 + quicken);
        this.rayPhase += step * (0.011 + this.activity * 0.05 + this.surge * 0.06 + quicken * 0.02);

        for (const band of this.sweeps) {
            if (!(band.age < band.life)) continue;
            band.age += step;
            if (band.age >= band.life) band.strength = 0;
        }

        // Fever: a meteor shower through the substorm (sparser under reduced motion).
        if (fever > 0.3) {
            this.showerClock += step * (fever - 0.3) * 1.8 * (this.reducedMotion ? 0.4 : 1);
            while (this.showerClock >= 1) {
                this.showerClock -= 1;
                this.queueMeteors(1, 1.1 + fever * 0.5);
            }
        } else {
            this.showerClock = 0;
        }
        // Recovery: once the clears stop, slow faint bands pulse up the rays and fade with
        // the storm, as a real display does after its substorm.
        if (fever > 0.06 && this.time - this.lastClearAt > 1.2) {
            this.recoveryClock += step;
            if (this.recoveryClock >= RECOVERY_PERIOD) {
                this.recoveryClock -= RECOVERY_PERIOD;
                this.launchSweep(0.12 + fever * 0.3, 1.6, 75);
            }
        } else {
            this.recoveryClock = RECOVERY_PERIOD * 0.5;
        }
        // The aftermath: pulsating patches come up across the quiet sky while the storm
        // recovers, and fade with it.
        const recovering = fever > 0.06 && this.time - this.lastClearAt > 1.2 ? Math.min(1, 0.4 + fever * 1.5) : 0;
        this.afterglow = approach(this.afterglow, recovering, step, 1.2, 5);
        if (this.afterglow < 1e-4 && recovering === 0) this.afterglow = 0;
        this.paint();
        this.deriveOutputs();
    }

    /** Read the heat of play once a frame, on this director's clock. */
    sampleHeat() {
        const sample = this.heat.sample(this.time);
        this.heatPunch = sample.punch;
        this.heatLevel = sample.level;
        this.heatFever = sample.fever;
        this.heatStage = sample.stage;
    }

    /** Paint the live pulses into the excitation map and pick each arc's billows. */
    paint() {
        const { billows } = this;
        this.excitation.begin();
        for (let i = 0; i < billows.length; i += 4) {
            billows[i] = 0;
            billows[i + 1] = 0;
            billows[i + 2] = 0.01;
        }
        for (const pulse of this.pulses) {
            if (!pulse.active) continue;
            const age = this.time - pulse.born;
            if (age < 0) continue;
            const k = age / pulse.life;
            if (k >= 1) {
                pulse.active = false;
                continue;
            }
            const centre = pulse.centre + pulse.velocity * age;
            const sigma = pulse.sigma * (1 + k * 0.6);
            if (pulse.amp > 0) {
                const envelope = Math.min(1, age / 0.07) * (1 - k) ** 1.2 * pulse.amp;
                this.excitation.accumulate(
                    pulse.row,
                    centre,
                    sigma,
                    pulse.red * envelope,
                    pulse.green * envelope,
                    pulse.blue * envelope,
                );
            }
            if (pulse.shift !== 0) {
                // An arc carries its strongest waves; a weaker one waits its turn.
                const amplitude = pulse.shift * Math.min(1, age / 0.14) * (1 - k);
                const base = pulse.row * BILLOW.slots * 4;
                let weakest = base;
                for (let slot = 1; slot < BILLOW.slots; slot += 1) {
                    if (Math.abs(billows[base + slot * 4 + 1]) < Math.abs(billows[weakest + 1])) weakest = base + slot * 4;
                }
                if (Math.abs(amplitude) > Math.abs(billows[weakest + 1])) {
                    billows[weakest] = centre;
                    billows[weakest + 1] = amplitude;
                    billows[weakest + 2] = 1 / sigma;
                }
            }
        }
    }

    /** Everything the shaders read, derived from the state in one place. */
    deriveOutputs() {
        const a = this.activity;
        const fever = this.heatFever;
        // How deep the storm lets the colour burn: the hem and the crown reach further as the
        // heat builds, so a chain grows toward its peak instead of arriving there at once.
        const burn = smoothstep(0.3, 0.9, this.heatLevel) * 0.5 + fever * 0.5;
        // The hour of the night sets the resting display: how tall, how bright, how crowned.
        const { hours } = this;
        this.height = Math.min(2.3, hours.height + a * 0.55 + this.heightKick + fever * 0.2);
        this.sway = 1 + a * 0.25;
        this.crown = Math.min(
            0.62 + burn * 0.18 + hours.crown,
            0.14 + hours.crown + a ** 1.4 * 0.5 + this.crownKick * 0.5,
        );
        this.fringe = Math.min(
            0.55 + burn * 0.15 + hours.fringe,
            0.06 + hours.fringe + smoothstep(0.25, 0.8, a) * 0.3 + this.fringeKick * 0.6,
        );
        this.violet = Math.min(0.9, 0.12 + hours.violet + a * 0.5 + this.violetKick * 0.6);
        this.diffuse = 1 + a * 0.8;
        this.pulsating = RESTING_PULSATION + this.afterglow * 0.9;
        for (const arc of AURORA_ARCS) {
            let gain = this.corona * 0.62;
            if (arc.index !== CORONA_ARC_INDEX) {
                gain = arc.gain * hours.gain * (1 + a * (arc.index === 0 ? 0.25 : 0.6));
                // In a fever the far arc comes up behind the others.
                if (arc.index === 2) gain *= 1 + fever * 0.35;
            }
            this.arcGain[arc.index] = gain;
        }
        // The green body leans toward the storm hue as a streak builds, and further in a
        // fever: a violet-magenta substorm under its red crown. It turns round the hue circle
        // the way a storm does (green, teal, blue, violet, magenta), never straight across
        // through grey: the shader mixes its resting green toward `tint` by `tint[3]`, so
        // `tint` is set past the storm colour by just enough that the mix lands on the
        // saturated hue between (`stormColor`).
        const lower = STORM_TINTS[Math.floor(this.stormTint)];
        const upper = STORM_TINTS[Math.min(STORM_TINTS.length - 1, Math.floor(this.stormTint) + 1)];
        const mixT = this.stormTint - Math.floor(this.stormTint);
        const storm = this.scratchStorm;
        for (let i = 0; i < 3; i += 1) storm[i] = lower[i] + (upper[i] - lower[i]) * mixT;
        // Hot play already turns it a little (teal, toward blue); a fever turns it most of the way.
        const weight = Math.min(
            0.85,
            Math.max(smoothstep(0.35, 0.95, a) * 0.5, smoothstep(0.45, 0.95, this.heatLevel) * 0.45) + fever * 0.35,
        );
        const [fromHue, fromSaturation, fromValue] = RESTING_GREEN_HSV;
        const target = toHsv(storm, this.scratchHsv);
        let toHue = target[0];
        while (toHue < fromHue) toHue += 6;
        fromHsv(
            fromHue + (toHue - fromHue) * weight,
            fromSaturation + (Math.min(STORM_SATURATION, target[1]) - fromSaturation) * weight,
            fromValue + (target[2] - fromValue) * weight,
            this.stormColor,
        );
        for (let i = 0; i < 3; i += 1) {
            this.tint[i] = weight > 1e-3
                ? RESTING_GREEN[i] + (this.stormColor[i] - RESTING_GREEN[i]) / weight
                : this.stormColor[i];
        }
        this.tint[3] = weight;
        // Big bright folds compress along their own hue in the curtain buffer, a little more
        // as the storm builds, so the peak burns in colour rather than clipping to cream.
        this.compress = 0.3 + this.heatLevel * 0.15 + fever * 0.15;
        const lift = 1 + a * 1.4 + this.surge * 0.5;
        const resting = hours.colours.glow;
        for (let i = 0; i < 3; i += 1) {
            const glow = resting[i] * (1 - weight) + this.stormColor[i] * 0.09 * weight;
            this.light[i] = glow * lift + Math.min(0.2, this.pulseLight[i] * 0.07);
        }
        // The bands climbing the rays, as the shader reads them.
        let total = 0;
        let strongest = 0;
        this.sweepAltitude = -200;
        for (let i = 0; i < this.sweeps.length; i += 1) {
            const band = this.sweeps[i];
            const live = band.age >= 0 && band.age < band.life;
            const k = live ? band.age / band.life : 1;
            const gain = live ? band.strength * (1 - k) ** 0.8 : 0;
            const altitude = live ? -20 + k * 300 : -200;
            const o = i * 4;
            this.sweepBands[o] = altitude;
            this.sweepBands[o + 1] = gain;
            this.sweepBands[o + 2] = 1 / band.width;
            this.sweepBands[o + 3] = 0;
            total += gain;
            if (gain > strongest) {
                strongest = gain;
                this.sweepAltitude = altitude;
            }
        }
        this.sweepGain = total;
    }

    getDiagnostics() {
        return {
            time: this.time,
            activity: this.activity,
            corona: this.corona,
            surge: this.surge,
            combo: this.lastCombo,
            heat: {
                punch: this.heatPunch, level: this.heatLevel, fever: this.heatFever, stage: this.heatStage,
            },
            events: this.eventCount,
            weather: this.weather.getDiagnostics(),
            hour: { name: this.hours.name, phase: this.hours.phase, levelSteps: this.hours.levelSteps },
            activePulses: this.pulses.filter((pulse) => pulse.active).length,
            pulseCapacity: MAX_PULSES,
            reducedMotion: this.reducedMotion,
        };
    }
}
