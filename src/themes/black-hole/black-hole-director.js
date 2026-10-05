/**
 * BlackHoleDirector — gameplay in, gravity out. The player feeds the hole:
 *
 *   lock          the piece dissolves into a stream of its own colour that spirals down
 *                 into the disk, lands as a hot arc of gas and is sheared around the hole;
 *                 space ripples where it left the board
 *   line clear    a pressure wave runs out through the disk, the gas spins up and heats,
 *                 the photon ring flares
 *   four lines    the hole fires its jets
 *   clear streak  each consecutive clearing lock throws ejecta off the inner edge and
 *                 winds the hole up — hotter, faster, brighter — until the jets stay lit
 *
 * Everything here is plain numbers: no three, no DOM, no timers. Bus handlers only stage
 * what happened; `update()` resolves one cue per board per frame and advances the state,
 * so the result depends on simulation time alone and replays exactly from `reset()`.
 * The owner reads the pools after each update and drains `shake`.
 */
import { ComboTracker } from '../../core/combo-tracker.js';
import { readLockViewportOrigin } from '../../events/lock-origin.js';
import { SHAKE, clearShake } from '../shared/camera-rig.js';

export const DIRECTOR_LIMITS = Object.freeze({
    infalls: 8,
    hotspots: 6,
    waves: 2,
    ripples: 4,
    bursts: 4,
    /** Slot 0 is the lone board; 1–4 are local-multiplayer players. */
    boards: 5,
});

const BOARD_COLUMNS = 10;
const HIDDEN_ROWS = 4;
const VISIBLE_ROWS = 20;
/** Disk radii, in Schwarzschild radii; mirrors the lens. */
const DISK_INNER = 3;
const DISK_OUTER = 10.5;
/** Seconds for the inner edge to circle the hole at rest; mirrors the world. */
const INNER_ORBIT_SECONDS = 13;
const TAU = Math.PI * 2;
const REDUCED_MOTION_SCALE = 0.45;
const GOLD = [1.0, 0.78, 0.42];
const VIOLET = [0.62, 0.4, 1.0];

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const clamp01 = (value) => clamp(value, 0, 1);
const finite = (value, fallback = 0) => (Number.isFinite(value) ? Number(value) : fallback);
/** Exponential approach with separate rise and fall half-lives, frame-rate independent. */
const approach = (value, target, dt, riseHalfLife, fallHalfLife) => {
    const halfLife = target > value ? riseHalfLife : fallHalfLife;
    const next = target + (value - target) * 0.5 ** (dt / halfLife);
    // Arrive, rather than creep toward the target for ever.
    return Math.abs(next - target) < 1e-3 ? target : next;
};
const decay = (value, dt, halfLife) => {
    const next = value * 0.5 ** (dt / halfLife);
    return next < 1e-4 ? 0 : next;
};

function createRandom(seed) {
    let state = seed >>> 0;
    return function random() {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** `#rgb`, `#rrggbb` or a 24-bit number → linear RGB, or null. */
export function parseColor(value) {
    let hex = null;
    if (typeof value === 'number' && Number.isFinite(value)) hex = Math.max(0, Math.min(0xffffff, Math.floor(value)));
    else if (typeof value === 'string') {
        const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
        if (match) {
            const digits = match[1].length === 3 ? match[1].replace(/./g, '$&$&') : match[1];
            hex = Number.parseInt(digits, 16);
        }
    }
    if (hex === null) return null;
    return [16, 8, 0].map((shift) => srgbToLinear(((hex >> shift) & 255) / 255));
}

/**
 * A piece colour as light: its hue at full strength. The darkest pieces (shadow indigo) would
 * otherwise feed the hole a stream nobody can see.
 */
export function luminous(color) {
    const peak = Math.max(color[0], color[1], color[2], 1e-4);
    const lifted = color.map((channel) => channel / peak);
    // Keep a little of the other channels so a pure primary still reads as hot gas.
    return lifted.map((channel) => 0.06 + channel * 0.94);
}

/**
 * Where a locked piece sits: its centroid in board-normalised coordinates (0…1, top-left
 * origin) and each occupied cell's offset from that centroid, in cells.
 */
export function resolveLock(payload) {
    const piece = payload?.piece;
    const cells = [];
    let x = 0.5;
    let y = 0.5;
    let placed = false;
    if (piece && Number.isFinite(piece.x) && Number.isFinite(piece.y) && Array.isArray(piece.shape)) {
        let sumX = 0;
        let sumY = 0;
        const occupied = [];
        for (let row = 0; row < Math.min(piece.shape.length, 8); row += 1) {
            const line = piece.shape[row];
            if (!Array.isArray(line)) continue;
            for (let column = 0; column < Math.min(line.length, 8); column += 1) {
                if (!line[column] || occupied.length >= 8) continue;
                occupied.push([piece.x + column + 0.5, piece.y + row + 0.5]);
                sumX += piece.x + column + 0.5;
                sumY += piece.y + row + 0.5;
            }
        }
        if (occupied.length > 0) {
            const centreX = sumX / occupied.length;
            const centreY = sumY / occupied.length;
            x = clamp01(centreX / BOARD_COLUMNS);
            y = clamp01((centreY - HIDDEN_ROWS) / VISIBLE_ROWS);
            for (const [cellX, cellY] of occupied.slice(0, 4)) cells.push([cellX - centreX, cellY - centreY]);
            placed = true;
        }
    }
    // A scrolling board (Infinity) reports where the piece landed on screen.
    const viewport = readLockViewportOrigin(payload);
    if (viewport) {
        ({ x, y } = viewport);
        placed = true;
    }
    const occupied = cells.length;
    while (cells.length < 4) cells.push(occupied > 0 ? cells[cells.length % occupied] : [0, 0]);
    return {
        x, y, cells, placed, color: parseColor(piece?.color),
    };
}

/** Board-normalised height of a set of cleared rows (0 top … 1 bottom). */
export function resolveClearHeight(payload) {
    const viewport = readLockViewportOrigin(payload);
    if (viewport) return viewport.y;
    const rows = Array.isArray(payload?.clearedRows) ? payload.clearedRows.filter(Number.isFinite) : [];
    if (rows.length === 0) return null;
    const mean = rows.reduce((sum, row) => sum + row, 0) / rows.length;
    return clamp01((mean + 0.5 - HIDDEN_ROWS) / VISIBLE_ROWS);
}

/** Pool entries at rest. `reset()` restores exactly these, so a replay starts from the same bytes. */
const idleInfall = () => ({
    active: false,
    fresh: false,
    landed: false,
    age: 0,
    duration: 1,
    u: 0.5,
    v: 0.5,
    cellWidth: 0.02,
    cellHeight: 0.04,
    color: [1, 1, 1],
    strength: 0,
    seed: 0,
    landRadius: 5,
    landAzimuth: 0,
    swirl: 3,
});
const idleHotspot = () => ({
    active: false,
    age: 0,
    life: 4,
    rise: 0.12,
    azimuth: 0,
    radius: 5,
    width: 0.3,
    strength: 0,
    peak: 0,
    color: [1, 1, 1],
});
const idleWave = () => ({
    active: false, radius: 0, speed: 5, width: 0.9, strength: 0, peak: 0,
});
const idleRipple = () => ({
    active: false, fromHole: false, x: 0.5, y: 0.5, radius: 0, speed: 0.5, reach: 0.5, strength: 0, peak: 0,
});
const idleBurst = () => ({
    active: false, age: 0, duration: 3, strength: 0, seed: 0, lift: 0,
});

function makeBoard() {
    return {
        tracker: new ComboTracker(),
        left: 0.4,
        right: 0.6,
        top: 0.1,
        bottom: 0.9,
        hardDrop: 0,
        hardDropAge: 0,
        lastY: 0.8,
        pending: false,
        lock: null,
        lockVisible: true,
        lines: 0,
        clearY: null,
        cascade: 1,
        advanced: false,
        tspin: false,
        perfect: false,
        levelUp: false,
    };
}

function clearPending(board) {
    board.pending = false;
    board.lock = null;
    board.lockVisible = true;
    board.lines = 0;
    board.clearY = null;
    board.cascade = 1;
    board.advanced = false;
    board.tspin = false;
    board.perfect = false;
    board.levelUp = false;
}

export class BlackHoleDirector {
    constructor({ seed = 1 } = {}) {
        this.seed = seed >>> 0;
        this.boards = Array.from({ length: DIRECTOR_LIMITS.boards }, makeBoard);
        this.infalls = Array.from(
            { length: DIRECTOR_LIMITS.infalls },
            () => ({ ...idleInfall(), cells: new Float32Array(8) }),
        );
        this.hotspots = Array.from({ length: DIRECTOR_LIMITS.hotspots }, idleHotspot);
        this.waves = Array.from({ length: DIRECTOR_LIMITS.waves }, idleWave);
        this.ripples = Array.from({ length: DIRECTOR_LIMITS.ripples }, idleRipple);
        this.bursts = Array.from({ length: DIRECTOR_LIMITS.bursts }, idleBurst);
        this.reducedMotion = false;
        this.reset();
    }

    /** Rewind to rest. Board placement and the motion preference are the owner's and stay. */
    reset() {
        this.random = createRandom(this.seed);
        this.time = 0;
        for (const board of this.boards) {
            board.tracker.reset();
            board.hardDrop = 0;
            board.hardDropAge = 0;
            board.lastY = 0.8;
            clearPending(board);
        }
        for (const infall of this.infalls) {
            Object.assign(infall, idleInfall());
            infall.cells.fill(0);
        }
        for (const hotspot of this.hotspots) Object.assign(hotspot, idleHotspot());
        for (const wave of this.waves) Object.assign(wave, idleWave());
        for (const ripple of this.ripples) Object.assign(ripple, idleRipple());
        for (const burst of this.bursts) Object.assign(burst, idleBurst());
        this.cursor = {
            infall: 0, hotspot: 0, wave: 0, ripple: 0, burst: 0,
        };
        /** Consecutive clearing locks on the board that last cleared. */
        this.streak = 0;
        this.streakBoard = null;
        this.sinceClear = 100;
        // Impulses: each event adds, time takes away.
        this.heatBoost = 0;
        this.rateBoost = 0;
        this.gainBoost = 0;
        this.ringPulse = 0;
        this.flash = 0;
        this.surge = 0;
        this.jetPulse = 0;
        // What the streak holds up while it lasts.
        this.wound = 0;
        this.jetHold = 0;
        // Outputs the world copies into uniforms.
        this.diskHeat = 1;
        this.diskGain = 1;
        this.diskRate = 1;
        this.ringGain = 1;
        this.jets = 0;
        this.energy = 0;
        this.shakeAmount = 0;
        this.shakeDuration = 0;
        this.counts = {
            locks: 0, clears: 0, bursts: 0, landings: 0,
        };
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /** Where a board sits on screen, as fractions of the viewport (top-left origin). */
    setBoard(slot, rect) {
        const board = this.boards[slot];
        if (!board || !rect) return;
        const {
            left, right, top, bottom,
        } = rect;
        if (![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top) return;
        board.left = left;
        board.right = right;
        board.top = top;
        board.bottom = bottom;
    }

    boardFor(payload) {
        const player = Number(payload?.player);
        const slot = Number.isInteger(player) && player >= 1 && player < DIRECTOR_LIMITS.boards ? player : 0;
        return this.boards[slot];
    }

    // ── Bus handlers: stage only ─────────────────────────────────────────────

    onHardDrop(payload) {
        const board = this.boardFor(payload);
        board.hardDrop = clamp01(finite(payload?.distance) / 16);
        board.hardDropAge = 0;
    }

    /**
     * @param {object} payload canonical PIECE_LOCK payload
     * @param {boolean} [visible] false keeps the streak bookkeeping but feeds nothing
     */
    onPieceLock(payload, visible = true) {
        const board = this.boardFor(payload);
        const carried = board.tracker.notePieceLocked();
        if (carried === 0 && board === this.streakBoard) this.streak = 0;
        board.pending = true;
        board.lock = resolveLock(payload);
        board.lockVisible = visible !== false;
        board.lastY = board.lock.y;
    }

    onLineClear(payload) {
        const board = this.boardFor(payload);
        const lines = clamp(Math.floor(finite(payload?.lineCount, 1)), 1, 4);
        const combo = board.tracker.noteLineClear();
        board.pending = true;
        board.lines = Math.max(board.lines, lines);
        board.clearY = resolveClearHeight(payload) ?? board.lastY;
        board.cascade = Math.max(board.cascade, clamp(Math.floor(finite(payload?.cascadeCount, 1)), 1, 8));
        board.advanced = true;
        this.streak = combo;
        this.streakBoard = board;
    }

    /** The bus `COMBO` event: cascade depth inside one lock, not a streak. */
    onCascade(payload) {
        const board = this.boardFor(payload);
        const depth = clamp(Math.floor(finite(payload?.comboCount, 0)), 0, 8);
        if (depth < 2) return;
        board.pending = true;
        board.cascade = Math.max(board.cascade, depth);
    }

    onTSpin(payload) {
        const board = this.boardFor(payload);
        board.pending = true;
        board.tspin = true;
    }

    onPerfectClear(payload) {
        const board = this.boardFor(payload);
        board.pending = true;
        board.perfect = true;
    }

    onLevelUp(payload) {
        const board = this.boardFor(payload);
        board.pending = true;
        board.levelUp = true;
    }

    /** Game over, mode stop, effects switched off: let the hole settle. */
    calm() {
        for (const board of this.boards) {
            board.tracker.reset();
            clearPending(board);
        }
        this.streak = 0;
        this.streakBoard = null;
        this.jetPulse = 0;
    }

    // ── Pools ────────────────────────────────────────────────────────────────

    take(pool, key) {
        const slot = this.cursor[key];
        this.cursor[key] = (slot + 1) % pool.length;
        return pool[slot];
    }

    feed(board, lock, drop) {
        const infall = this.take(this.infalls, 'infall');
        const width = board.right - board.left;
        const height = board.bottom - board.top;
        infall.active = true;
        infall.fresh = true;
        infall.landed = false;
        infall.age = 0;
        infall.duration = 1.3 - drop * 0.35;
        infall.u = board.left + lock.x * width;
        infall.v = board.top + lock.y * height;
        infall.cellWidth = width / BOARD_COLUMNS;
        infall.cellHeight = height / VISIBLE_ROWS;
        for (let cell = 0; cell < 4; cell += 1) {
            infall.cells[cell * 2] = lock.cells[cell][0];
            infall.cells[cell * 2 + 1] = lock.cells[cell][1];
        }
        infall.color = luminous(lock.color ?? GOLD);
        infall.strength = 0.6 + drop * 0.4;
        infall.seed = this.random() * 1000;
        infall.landRadius = DISK_INNER + 1.1 + this.random() * 3.6;
        // Radians swept round the hole on the way in, with the gas. The owner turns this
        // into `landAzimuth` once it knows where on the disk's clock the piece left from.
        infall.swirl = (0.62 + this.random() * 0.6) * Math.PI;
        infall.landAzimuth = infall.swirl;
        this.counts.locks += 1;
        return infall;
    }

    ignite(azimuth, radius, color, strength, life = 4.2, rise = 0.12) {
        const hotspot = this.take(this.hotspots, 'hotspot');
        hotspot.active = true;
        hotspot.age = 0;
        hotspot.life = life;
        hotspot.rise = rise;
        hotspot.azimuth = azimuth;
        hotspot.radius = radius;
        hotspot.width = 0.16;
        hotspot.peak = strength;
        hotspot.strength = strength;
        hotspot.color = color;
    }

    pressure(strength, speed = 5.4) {
        const wave = this.take(this.waves, 'wave');
        wave.active = true;
        wave.radius = DISK_INNER * 0.9;
        wave.speed = speed;
        wave.width = 0.75;
        wave.peak = strength;
        wave.strength = strength;
    }

    ripple(x, y, strength, { speed = 0.6, reach = 0.5, fromHole = false } = {}) {
        if (this.reducedMotion) return;
        const ripple = this.take(this.ripples, 'ripple');
        ripple.active = true;
        ripple.fromHole = fromHole;
        ripple.x = x;
        ripple.y = y;
        ripple.radius = 0.01;
        ripple.speed = speed;
        ripple.reach = reach;
        ripple.peak = strength;
        ripple.strength = strength;
    }

    eject(strength, lift = 0) {
        const burst = this.take(this.bursts, 'burst');
        burst.active = true;
        burst.age = 0;
        burst.duration = 2.6 + strength * 1.4;
        burst.strength = strength;
        burst.seed = this.random() * 1000;
        burst.lift = lift;
        this.counts.bursts += 1;
    }

    shake(amount, durationMs) {
        if (this.reducedMotion || !(amount > this.shakeAmount)) return;
        this.shakeAmount = amount;
        this.shakeDuration = durationMs;
    }

    // ── Cue resolution ───────────────────────────────────────────────────────

    resolve(board) {
        const scale = this.reducedMotion ? REDUCED_MOTION_SCALE : 1;
        const {
            lock, lines, cascade, tspin, perfect, levelUp,
        } = board;
        const drop = board.hardDropAge < 0.3 ? board.hardDrop : 0;
        const centreX = (board.left + board.right) / 2;

        if (lock && board.lockVisible) {
            const infall = this.feed(board, lock, drop);
            this.flash = Math.min(1, this.flash + 0.05 + drop * 0.05);
            // A clearing lock is one cue: the clear below brings the bigger ripple and shake.
            if (lines === 0) {
                this.ripple(infall.u, infall.v, 0.012 + drop * 0.014, {
                    speed: 0.5 + drop * 0.25, reach: 0.26 + drop * 0.16,
                });
                this.shake(SHAKE.LOCK[0] * (1 + drop * 0.6), SHAKE.LOCK[1]);
            }
        }

        if (lines > 0) {
            const streak = board.advanced ? board.tracker.combo : 0;
            const depth = cascade - 1;
            this.counts.clears += 1;
            this.sinceClear = 0;
            this.pressure(clamp(0.55 + lines * 0.24 + depth * 0.1, 0, 1.7) * scale);
            this.rateBoost = Math.min(3.2, this.rateBoost + 0.55 + lines * 0.3);
            this.heatBoost = Math.min(0.4, this.heatBoost + lines * 0.04 + Math.min(streak, 8) * 0.015);
            this.gainBoost = Math.min(0.45, this.gainBoost + lines * 0.06 + depth * 0.03);
            this.ringPulse = Math.min(2.6, this.ringPulse + 0.4 + lines * 0.22);
            this.flash = Math.min(1, this.flash + 0.1 + lines * 0.06);
            this.surge = Math.min(1, this.surge + 0.22 + lines * 0.13);
            const clearY = board.top + (board.clearY ?? 0.8) * (board.bottom - board.top);
            this.ripple(centreX, clearY, 0.016 + lines * 0.007, { speed: 0.75, reach: 0.5 + lines * 0.08 });
            const [amount, duration] = clearShake(lines, streak);
            this.shake(amount, duration);
            if (streak >= 2) {
                this.eject(clamp(0.3 + (streak - 2) * 0.1 + lines * 0.06, 0, 1) * scale, streak >= 6 ? 0.5 : 0.15);
            }
            if (lines >= 4) {
                this.jetPulse = Math.max(this.jetPulse, 2.6);
                this.eject(0.85 * scale, 0.35);
                this.ripple(0.5, 0.5, 0.04, { speed: 0.95, reach: 1.25, fromHole: true });
                this.shake(...SHAKE.TETRIS);
            }
            if (streak >= 8) this.ripple(0.5, 0.5, 0.03, { speed: 1.05, reach: 1.25, fromHole: true });
        }

        // A cascade wave inside the same lock: an echo of the pressure front.
        if (cascade >= 2 && lines === 0) {
            this.pressure(clamp(0.5 + cascade * 0.14, 0, 1.4) * scale, 6.2);
            this.gainBoost = Math.min(0.45, this.gainBoost + 0.06);
            this.ringPulse = Math.min(2.6, this.ringPulse + 0.3);
        }

        if (tspin) {
            // A twist: the gas whips round and a violet knot lights where it tore.
            this.rateBoost = Math.min(3.2, this.rateBoost + 1.4);
            this.ignite(this.random() * TAU, DISK_INNER + 1.4 + this.random() * 2, VIOLET, 1.1 * scale, 5);
            this.ringPulse = Math.min(2.6, this.ringPulse + 0.5);
            this.shake(...SHAKE.TSPIN);
        }

        if (perfect) {
            // The board is empty: the whole ring blooms gold and the jets answer.
            this.ringPulse = 2.6;
            this.gainBoost = 0.45;
            this.flash = Math.min(1, this.flash + 0.4);
            this.jetPulse = Math.max(this.jetPulse, 3.4);
            for (let knot = 0; knot < 3; knot += 1) {
                const azimuth = (knot / 3) * TAU + this.random();
                this.ignite(azimuth, DISK_INNER + 1 + this.random() * 3, GOLD, 1.2 * scale, 5.5);
            }
            this.eject(1 * scale, 0.6);
            this.ripple(0.5, 0.5, 0.05, { speed: 0.9, reach: 1.3, fromHole: true });
            this.shake(...SHAKE.APEX);
        }

        if (levelUp) {
            this.pressure(0.7 * scale, 3.6);
            this.ringPulse = Math.min(2.6, this.ringPulse + 0.8);
            this.rateBoost = Math.min(3.2, this.rateBoost + 0.6);
        }
        clearPending(board);
    }

    // ── Simulation ───────────────────────────────────────────────────────────

    update(dt) {
        const step = clamp(finite(dt), 0, 0.25);
        this.time += step;
        this.shakeAmount = 0;
        this.shakeDuration = 0;
        this.sinceClear += step;
        for (const board of this.boards) {
            board.hardDropAge += step;
            if (board.pending) this.resolve(board);
        }

        // A streak holds the hole wound up; it lets go when the chain breaks or goes quiet.
        const alive = this.streak >= 2 && this.sinceClear < 9 ? this.streak : 0;
        const woundTarget = clamp01((alive - 1) / 7);
        this.wound = approach(this.wound, woundTarget, step, 0.35, 1.6);
        this.jetHold = approach(this.jetHold, alive >= 5 ? clamp01(0.45 + (alive - 5) * 0.18) : 0, step, 0.5, 1.1);

        this.heatBoost = decay(this.heatBoost, step, 1.1);
        this.rateBoost = decay(this.rateBoost, step, 1.0);
        this.gainBoost = decay(this.gainBoost, step, 0.75);
        this.ringPulse = decay(this.ringPulse, step, 0.42);
        this.flash = decay(this.flash, step, 0.16);
        this.surge = decay(this.surge, step, 0.7);
        this.jetPulse = Math.max(0, this.jetPulse - step);

        this.diskRate = 1 + this.rateBoost + this.wound * 1.5;
        this.diskHeat = 1 + this.heatBoost + this.wound * 0.34;
        this.diskGain = 1 + this.gainBoost + this.wound * 0.2;
        this.ringGain = 1 + this.ringPulse + this.wound * 0.6;
        // The jets ignite over a few frames and climb, rather than appearing whole.
        const jetTarget = clamp01(Math.max(this.jetHold, Math.min(1, this.jetPulse * 1.4)));
        this.jets = approach(this.jets, jetTarget, step, 0.07, 0.03);
        this.energy = clamp01(this.wound * 0.7 + this.gainBoost * 0.9 + this.flash * 0.3 + this.jets * 0.25);

        const turnRate = (step / INNER_ORBIT_SECONDS) * this.diskRate * TAU;

        for (const infall of this.infalls) {
            if (!infall.active) continue;
            infall.age += step;
            if (!infall.landed && !infall.fresh && infall.age >= infall.duration * 0.6) {
                // The head of the stream reaches the disk: a hot arc builds as the rest arrives.
                infall.landed = true;
                const strength = 0.6 + infall.strength * 0.6;
                this.ignite(infall.landAzimuth, infall.landRadius, infall.color, strength, 4.6, infall.duration * 0.42);
                this.counts.landings += 1;
            }
            if (infall.age >= infall.duration) {
                infall.active = false;
                infall.fresh = false;
                // All of it is in: the ring answers.
                if (infall.landed) {
                    this.ringPulse = Math.min(2.6, this.ringPulse + 0.16 + infall.strength * 0.14);
                    this.gainBoost = Math.min(0.45, this.gainBoost + 0.02);
                }
            }
        }

        for (const hotspot of this.hotspots) {
            if (!hotspot.active) continue;
            hotspot.age += step;
            const life = hotspot.age / hotspot.life;
            if (life >= 1) {
                hotspot.active = false;
                hotspot.strength = 0;
                continue;
            }
            // It rides its orbit, drifts inward and shears out along it as it cools.
            hotspot.azimuth = (hotspot.azimuth + turnRate * (DISK_INNER / hotspot.radius) ** 1.5) % TAU;
            hotspot.radius = Math.max(DISK_INNER + 0.25, hotspot.radius - step * 0.2);
            hotspot.width = 0.16 + hotspot.age * 0.42;
            hotspot.strength = hotspot.peak * Math.min(1, hotspot.age / hotspot.rise) * (1 - life) ** 1.6;
        }

        for (const wave of this.waves) {
            if (!wave.active) continue;
            wave.radius += wave.speed * step;
            wave.width = 0.75 + (wave.radius - DISK_INNER) * 0.12;
            const travelled = clamp01((wave.radius - DISK_INNER) / (DISK_OUTER - DISK_INNER));
            wave.strength = wave.peak * (1 - travelled) ** 1.3;
            if (travelled >= 1) {
                wave.active = false;
                wave.strength = 0;
            }
        }

        for (const ripple of this.ripples) {
            if (!ripple.active) continue;
            ripple.radius += ripple.speed * step;
            const travelled = clamp01(ripple.radius / ripple.reach);
            ripple.strength = ripple.peak * (1 - travelled) ** 1.5;
            if (travelled >= 1) {
                ripple.active = false;
                ripple.strength = 0;
            }
        }

        for (const burst of this.bursts) {
            if (!burst.active) continue;
            burst.age += step;
            if (burst.age >= burst.duration) {
                burst.active = false;
                burst.strength = 0;
            }
        }
    }

    getDiagnostics() {
        return {
            streak: this.streak,
            wound: this.wound,
            jets: this.jets,
            diskHeat: this.diskHeat,
            diskRate: this.diskRate,
            infalls: this.infalls.filter((entry) => entry.active).length,
            hotspots: this.hotspots.filter((entry) => entry.active).length,
            waves: this.waves.filter((entry) => entry.active).length,
            ripples: this.ripples.filter((entry) => entry.active).length,
            bursts: this.bursts.filter((entry) => entry.active).length,
            counts: { ...this.counts },
        };
    }
}
