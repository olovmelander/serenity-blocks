/**
 * AuroraDirector — gameplay in, sky out. The player plays the aurora like an instrument:
 *
 *   lock          plucks the curtain above the piece: a pair of pulses in the piece's own
 *                 colour runs outward along the arc, and a ring opens on the lake
 *   line clear    strums every arc: a bright band sweeps up the rays, the curtains stand
 *                 taller, the lake takes a wave
 *   four lines    the corona breaks out overhead, rays converging on the zenith
 *   clear streak  each consecutive clear sends a surge the length of the sky and winds the
 *                 whole display up — faster rays, deeper folds, a red crown, a pink hem
 *
 * Everything here is plain numbers: no three, no DOM, no timers. Bus handlers only stage
 * what happened; `update()` resolves one cue per board per frame and advances the state,
 * so the result depends on simulation time alone and replays exactly from `reset()`.
 * The owner drains `ripples`, `meteors` and `shake` after each update.
 */
import { ComboTracker } from '../../core/combo-tracker.js';
import {
    AURORA_ARCS, BILLOW, CORONA_ARC_INDEX, arcCoordinateForAzimuth, arcRateForAzimuth, arcViewSpan,
} from './aurora-field.js';
import {
    PULSE_CYCLE, STORM_TINTS, parseColor, vivid,
} from './aurora-palette.js';

const MAX_PULSES = 32;
const MAX_RIPPLES = 8;
const MAX_METEORS = 6;
/** Slot 0 is the lone board; 1–4 are local-multiplayer players. */
const BOARD_SLOTS = 5;
const BOARD_COLUMNS = 10;
const HIDDEN_ROWS = 4;
const VISIBLE_ROWS = 20;
const RESTING_ARCS = AURORA_ARCS.filter((arc) => arc.index !== CORONA_ARC_INDEX);
const SWEEP_SECONDS = 0.85;
/** Pulses start this far out from a board's centre, in half-widths: just clear of its edge. */
const BOARD_EDGE = 1.12;
/** km/s — a far arc turns slowly in view; never chase it faster than this. */
const MAX_PULSE_SPEED = 620;
const REDUCED_MOTION_SCALE = 0.45;
const DEG = Math.PI / 180;
const GOLD = [1.0, 0.86, 0.55];
const TSPIN_VIOLET = [0.62, 0.36, 1.0];
/** Resting light the display throws on snow and water (linear RGB). */
const BASE_LIGHT = [0.03, 0.105, 0.07];

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const clamp01 = (value) => clamp(value, 0, 1);
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
        this.tint = [0, 0, 0, 0];
        this.light = [...BASE_LIGHT];
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
        this.sweepAge = Infinity;
        this.sweepStrength = 0;
        this.sweepAltitude = -200;
        this.sweepGain = 0;
        this.stormTint = 0;
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

    onLevelUp(payload) {
        const board = this.boardFor(payload);
        board.pending = true;
        board.levelUp = true;
        return true;
    }

    /** Run over, mode stopped, or effects switched off: let the sky settle. */
    calm() {
        this.activityTarget = 0;
        this.activityHold = 0;
        this.coronaTarget = 0;
        this.coronaHold = 0;
        this.lastCombo = 0;
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

    /** Spawn one pulse; reuses the slot furthest through its life. Allocates nothing. */
    spawnPulse(row, centre, velocity, life, sigma, amp, shift, color, delay = 0) {
        let chosen = this.pulses[0];
        let furthest = -1;
        for (const pulse of this.pulses) {
            if (!pulse.active) {
                chosen = pulse;
                break;
            }
            const progress = (this.time - pulse.born) / pulse.life;
            if (progress > furthest) {
                furthest = progress;
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

    queueRipple(azimuth, range, strength, speed, color) {
        if (this.rippleCount >= MAX_RIPPLES) return;
        const ripple = this.ripples[this.rippleCount];
        ripple.azimuth = azimuth;
        ripple.range = clamp01(range);
        ripple.strength = strength;
        ripple.speed = speed;
        [ripple.color[0], ripple.color[1], ripple.color[2]] = color;
        this.rippleCount += 1;
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

    launchSweep(strength) {
        this.sweepAge = 0;
        this.sweepStrength = Math.max(this.sweepStrength, strength * (this.reducedMotion ? 0.5 : 1));
    }

    cueLock(board, color) {
        const drop = clamp01(board.hardDrop / 16);
        const strength = 0.6 + drop * 0.4;
        // Wide and unhurried in view terms: the pulse takes over a stretch of curtain beside
        // the board and carries its colour outward, instead of racing to the horizon.
        this.pluck(AURORA_ARCS[0], board, 0.28 + drop * 0.12, 1.5, 0.13, strength, 0, color);
        if (RESTING_ARCS[1]) this.pluck(RESTING_ARCS[1], board, 0.3, 1.4, 0.13, 0.85 * strength, 0, color, 0.05);
        const azimuth = board.azimuth + (board.column - 0.5) * 2 * board.halfWidth;
        this.queueRipple(azimuth, 0.25 + drop * 0.2, 0.42 * strength, 24 + drop * 8, color);
        this.activity = Math.min(1, this.activity + 0.012);
        this.pulseLight[0] += color[0] * 0.14 * strength;
        this.pulseLight[1] += color[1] * 0.14 * strength;
        this.pulseLight[2] += color[2] * 0.14 * strength;
        this.requestShake(0.0046, 90);
    }

    cueClear(board, color) {
        const { lines } = board;
        const { combo } = board.tracker;
        const boost = (board.b2b ? 1.15 : 1) * (1 + (board.cascade - 1) * 0.12);
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
        }
        this.launchSweep(0.35 + lines * 0.15);
        this.surge = Math.min(0.8, this.surge + (0.18 + lines * 0.07) * boost);
        this.heightKick = Math.min(0.9, this.heightKick + 0.14 + lines * 0.07);
        this.fringeKick = Math.min(1.2, this.fringeKick + lines * 0.22);
        this.crownKick = Math.min(1.2, this.crownKick + lines * 0.12 + (board.b2b ? 0.2 : 0));
        if (board.tspin) this.violetKick = Math.min(1.2, this.violetKick + 0.8);

        const streak = 1 - Math.exp(-(combo - 1) * 0.2);
        this.raiseActivity(
            Math.max(0.12 + lines * 0.05, streak) + (lines - 1) * 0.04 + (board.cascade - 1) * 0.07 + (quad ? 0.18 : 0),
            1.7 + lines * 0.15,
        );
        this.queueRipple(azimuth, 0.45, (0.7 + lines * 0.15) * boost, 34, tint);
        if (lines >= 2) this.queueRipple(azimuth - board.halfWidth * 1.4, 0.2, 0.4 + lines * 0.08, 28, tint);
        if (lines >= 3) this.queueRipple(azimuth + board.halfWidth * 1.4, 0.62, 0.4 + lines * 0.08, 30, tint);
        if (lines === 3 || board.cascade >= 3) this.queueMeteors(1, 1.4);
        this.requestShake(Math.min(0.0205, 0.0056 * lines + Math.min(0.0082, Math.max(0, combo - 1) * 0.0018)), 120);

        if (quad) {
            // Breakup: the corona opens overhead and the crown ignites.
            this.raiseCorona(1, 1.4);
            this.crownKick = Math.min(1.2, this.crownKick + 0.6);
            this.queueMeteors(3, 1.8);
            this.requestShake(0.0225, 150);
        }
        if (board.tspin) this.requestShake(0.0133, 130);

        // A growing streak: each consecutive clear sends one surge the length of the sky.
        if (board.advanced && combo >= 2) this.cueStreak(combo, color);
        this.pulseLight[0] += tint[0] * (0.2 + lines * 0.06);
        this.pulseLight[1] += tint[1] * (0.2 + lines * 0.06);
        this.pulseLight[2] += tint[2] * (0.2 + lines * 0.06);
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
            const velocity = ((direction > 0 ? right : left) - from) / seconds;
            this.spawnPulse(arc.index, from, velocity, seconds + 0.1, 58, Math.min(1, 0.6 + combo * 0.04), 0, blend);
            this.spawnPulse(arc.index, from, velocity, seconds + 0.1, 84, 0, Math.min(34, 18 + combo * 2), blend);
        }
        this.stormTint = Math.min(STORM_TINTS.length - 1, (combo - 2) * 0.5);
        this.fringeKick = Math.min(1.2, this.fringeKick + 0.1 + combo * 0.05);
        this.crownKick = Math.min(1.2, this.crownKick + 0.05 + combo * 0.04);
        if (combo >= 3) this.queueMeteors(Math.min(3, Math.floor(combo / 3)), 1.3 + Math.min(combo, 10) * 0.07);
        if (combo >= 5) this.raiseCorona(0.3 + (combo - 5) * 0.12, 1.5);
        if (combo >= 7) this.requestShake(0.0307, 190);
    }

    cuePerfect(board) {
        this.raiseCorona(1, 2.4);
        this.raiseActivity(1, 3);
        this.surge = Math.min(0.8, this.surge + 0.6);
        this.heightKick = Math.min(0.9, this.heightKick + 0.6);
        this.crownKick = 1.2;
        this.launchSweep(0.9);
        for (const arc of RESTING_ARCS) this.launch(arc, board.azimuth, 0, 0, 2.2, 0.55, 0.9, 0, GOLD);
        this.queueMeteors(4, 2);
        this.queueRipple(board.azimuth, 0.4, 1.2, 38, GOLD);
        this.requestShake(0.0307, 190);
    }

    cueLevelUp(board) {
        this.raiseActivity(Math.max(this.activityTarget, 0.3), 1.6);
        this.launchSweep(0.6);
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
        if (board.perfect) this.cuePerfect(board);
        if (board.levelUp) this.cueLevelUp(board);
        this.eventCount += 1;
        clearPending(board);
    }

    // ── simulation ────────────────────────────────────────────────────────────────

    update(dt) {
        const step = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
        this.rippleCount = 0;
        this.meteorCount = 0;
        this.shakeAmount = 0;
        this.shakeDuration = 0;
        for (const board of this.boards) {
            if (board.pending) this.resolve(board);
            else if (board.hardDrop > 0) board.hardDrop = 0;
        }
        if (step <= 0) {
            this.paint();
            this.deriveOutputs();
            return;
        }
        this.time += step;

        this.activityHold = Math.max(0, this.activityHold - step);
        if (this.activityHold <= 0) this.activityTarget = Math.max(0, this.activityTarget - step * 0.22);
        this.activity = approach(this.activity, this.activityTarget, step, 0.28, 3.2);
        this.coronaHold = Math.max(0, this.coronaHold - step);
        if (this.coronaHold <= 0) this.coronaTarget = Math.max(0, this.coronaTarget - step * 0.7);
        this.corona = approach(this.corona, this.coronaTarget, step, 0.16, 0.9);
        if (this.corona < 0.0015 && this.coronaTarget === 0) this.corona = 0;
        if (this.activity < 0.0005 && this.activityTarget === 0) this.activity = 0;

        this.surge *= Math.exp(-2.2 * step);
        this.heightKick *= Math.exp(-0.9 * step);
        this.crownKick *= Math.exp(-0.6 * step);
        this.fringeKick *= Math.exp(-1.2 * step);
        this.violetKick *= Math.exp(-0.8 * step);
        for (let i = 0; i < 3; i += 1) this.pulseLight[i] *= Math.exp(-1.6 * step);
        if (this.surge < 1e-4) this.surge = 0;

        // Phases integrate their speed, so a change of pace never jumps the pattern.
        this.tau += step * (1 + this.activity * 2.2 + this.surge * 1.5);
        this.rayPhase += step * (0.011 + this.activity * 0.05 + this.surge * 0.06);

        if (this.sweepAge < SWEEP_SECONDS) {
            this.sweepAge += step;
            const k = clamp01(this.sweepAge / SWEEP_SECONDS);
            this.sweepAltitude = -20 + k * 300;
            this.sweepGain = this.sweepStrength * (1 - k) ** 0.8;
            if (k >= 1) {
                this.sweepGain = 0;
                this.sweepStrength = 0;
                this.sweepAltitude = -200;
            }
        }
        this.paint();
        this.deriveOutputs();
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
        this.height = Math.min(2.3, 1 + a * 0.55 + this.heightKick);
        this.sway = 1 + a * 0.25;
        this.crown = Math.min(0.8, 0.14 + a ** 1.4 * 0.5 + this.crownKick * 0.5);
        this.fringe = Math.min(0.7, 0.06 + smoothstep(0.25, 0.8, a) * 0.3 + this.fringeKick * 0.6);
        this.violet = Math.min(0.9, 0.12 + a * 0.5 + this.violetKick * 0.6);
        this.diffuse = 1 + a * 0.8;
        for (const arc of AURORA_ARCS) {
            this.arcGain[arc.index] = arc.index === CORONA_ARC_INDEX
                ? this.corona * 0.62
                : arc.gain * (1 + a * (arc.index === 0 ? 0.25 : 0.6));
        }
        // The green body leans toward the storm tint as a streak builds.
        const lower = STORM_TINTS[Math.floor(this.stormTint)];
        const upper = STORM_TINTS[Math.min(STORM_TINTS.length - 1, Math.floor(this.stormTint) + 1)];
        const mixT = this.stormTint - Math.floor(this.stormTint);
        for (let i = 0; i < 3; i += 1) this.tint[i] = lower[i] + (upper[i] - lower[i]) * mixT;
        this.tint[3] = smoothstep(0.35, 0.95, a) * 0.5;
        const lift = 1 + a * 1.4 + this.surge * 0.5;
        for (let i = 0; i < 3; i += 1) {
            const storm = BASE_LIGHT[i] * (1 - this.tint[3]) + this.tint[i] * 0.09 * this.tint[3];
            this.light[i] = storm * lift + Math.min(0.2, this.pulseLight[i] * 0.07);
        }
    }

    getDiagnostics() {
        return {
            time: this.time,
            activity: this.activity,
            corona: this.corona,
            surge: this.surge,
            combo: this.lastCombo,
            events: this.eventCount,
            activePulses: this.pulses.filter((pulse) => pulse.active).length,
            pulseCapacity: MAX_PULSES,
            reducedMotion: this.reducedMotion,
        };
    }
}
