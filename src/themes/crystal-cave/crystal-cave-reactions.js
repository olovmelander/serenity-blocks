/**
 * Crystal Cave — how the cave answers the game.
 *
 * A pure, seconds-based director. Gameplay events become decaying envelopes (how bright
 * each mineral family burns, how excited the whole cave is, how strongly it hums) and a
 * short list of cues described in board space (which side, how high, how strong). The
 * world turns cues into light; nothing here touches a scene, so the same director runs
 * in tests, in the playground's deterministic replay and in the game.
 *
 * The language:
 *   lock          light of the piece's colour leaves the board beside the piece and
 *                 crosses to crystals of that mineral; each one rings from root to tip.
 *                 A long hard drop sends more, and shakes glitter from the vault.
 *   line clear    a prismatic fan bursts from both sides of the board at the cleared
 *                 rows, a wave of light runs through every crystal in the cave, and new
 *                 crystals grow at the water's edge — one cluster per line. Each wave of a
 *                 cascade runs deeper, brighter and wider than the one before, in the next
 *                 colour of the spectrum.
 *   four lines    all of that twice over, the skylight flares and the vault rains light.
 *   combo/streak  crystal tips link into a lattice of beams that grows with the chain
 *                 while the stones hum; the chain is the true combo (consecutive clearing
 *                 locks), held for as long as it lives — resting hands quiet the hum, they
 *                 do not break it. When a lock clears nothing the lattice lets go, link by link.
 *   t-spin        a pinwheel of light beside the board (a small one when nothing cleared).
 *   back-to-back  the skylight opens: light pours down the chimney and glitter falls through
 *                 it to the pool, more of it and in more colours for every difficult clear in
 *                 a row.
 *   perfect clear the heart of the cave crowns the clear still crossing the hall: a wave from
 *                 the far end, the heart flares, every grown crystal rings in turn.
 *   level up      the heart of the cave answers from the far end.
 *   game over     the cave dims and what grew during play withdraws.
 *
 * Nothing restarts: waves fly side by side (CRYSTAL_CAVE_WAVE_SLOTS), the flash and the
 * excitement add to what is lit, and the shared surge (src/themes/shared/gameplay-surge.js)
 * carries how hot play runs — calm, warm, hot, fever — for the world to spend: the stones'
 * resting glow, the hum's strength, and in a fever a chorus of waves that keeps the hall
 * ringing between clears.
 */
import { ComboTracker } from '../../core/combo-tracker.js';
import { GameplaySurge, SURGE_WEIGHTS } from '../shared/gameplay-surge.js';

export const CRYSTAL_CAVE_FAMILY_COUNT = 5;
/** Tetromino → mineral family (matches the theme's piece colours). */
export const CRYSTAL_CAVE_PIECE_FAMILY = Object.freeze({
    I: 4, O: 1, T: 0, S: 3, Z: 2, J: 4, L: 0,
});
export const CRYSTAL_CAVE_MAX_CUES = 32;
/** Waves of light in flight at once (the rock and the air draw one shell each). */
export const CRYSTAL_CAVE_WAVE_SLOTS = 4;
/** Speed of the wave of light through the cave, world units per second. */
export const CRYSTAL_CAVE_WAVE_SPEED = 44;
export const CRYSTAL_CAVE_WAVE_SECONDS = 3.2;

const BOARD_COLUMNS = 10;
const BOARD_VISIBLE_ROWS = 20;
const BOARD_HIDDEN_ROWS = 4;
/** A chain unfed this long hums quieter (it holds: only a lock that clears nothing breaks it). */
const COMBO_HOLD_SECONDS = 2.8;
/** What an unfed chain keeps of its hum. */
const HUM_QUIET = 0.55;
/** How fast the hum lets go once the chain breaks (per second). */
const HUM_RELEASE = 0.9;
/** A wave this young takes the next one in instead of a second shell on top of it. */
const WAVE_MERGE_SECONDS = 0.12;
/** Delayed waves waiting for their moment. */
const PENDING_WAVES = 4;
/** What the play's heat must pass before the cave shows it: calm play looks as it always did. */
const HEAT_FLOOR = 0.15;
const DECAY = Object.freeze({
    energy: 1.45, flash: 4.2, worms: 0.75, shaft: 0.6, boost: 1.05, dim: 0.28, skylight: 0.5,
});
const GOLD = Object.freeze([1, 0.82, 0.5]);
const SPIN_VIOLET = Object.freeze([0.86, 0.5, 1]);
const SKY_BLUE = Object.freeze([0.7, 0.88, 1]);

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function unwrap(value) {
    if (!isObject(value)) return {};
    return isObject(value.detail) ? value.detail : value;
}

function positiveCount(value, maximum) {
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
        piece.shape.slice(0, 8).forEach((line, y) => {
            if (!Array.isArray(line)) return;
            line.slice(0, 8).forEach((cell, x) => {
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

/** Where on the board an event happened: column 0..1 (left to right), row 0..1 (foot to top). */
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

/** A piece's own colour as linear-ish 0..1 components, or null. */
function pieceTint(piece, target) {
    const colour = piece?.color;
    let value = null;
    if (Number.isInteger(colour) && colour >= 0 && colour <= 0xffffff) value = colour;
    else if (typeof colour === 'string' && /^#[\da-f]{6}$/i.test(colour)) value = Number.parseInt(colour.slice(1), 16);
    if (value === null) return null;
    target[0] = ((value >> 16) & 255) / 255;
    target[1] = ((value >> 8) & 255) / 255;
    target[2] = (value & 255) / 255;
    return target;
}

/**
 * What is left of a wave's strength `age` seconds out: it fades as it crosses the hall, and a
 * hot cave (`level` up to 1) carries it deeper before it lets go.
 */
function waveTail(age, level = 0) {
    const travel = clamp(age / CRYSTAL_CAVE_WAVE_SECONDS, 0, 1);
    return 1 - (travel * travel * (3 - 2 * travel)) ** (1 + clamp(level, 0, 1));
}

export class CrystalCaveReactions {
    constructor({ rng = Math.random } = {}) {
        this.rng = typeof rng === 'function' ? rng : Math.random;
        this.boost = new Float32Array(CRYSTAL_CAVE_FAMILY_COUNT);
        this.cues = Array.from({ length: CRYSTAL_CAVE_MAX_CUES }, () => ({
            type: 'none',
            side: 0,
            column: 0.5,
            row: 0.3,
            family: 0,
            strength: 0,
            lines: 0,
            count: 0,
            drop: 0,
            slot: 0,
            tinted: false,
            tint: [1, 1, 1],
        }));
        /** The true combo: consecutive clearing locks (src/core/combo-tracker.js). */
        this.tracker = new ComboTracker();
        /** How hot play runs: calm, warm, hot, fever (src/themes/shared/gameplay-surge.js). */
        this.surge = new GameplaySurge();
        this.heat = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
        this.waves = Array.from({ length: CRYSTAL_CAVE_WAVE_SLOTS }, (_, slot) => ({
            slot, active: false, age: 0, strength: 0, far: false,
        }));
        this.pendingWaves = Array.from({ length: PENDING_WAVES }, () => ({ strength: 0, far: false, delay: 0 }));
        this.flashColor = [1, 1, 1];
        this.frame = {
            energy: 0,
            resonance: 0,
            flash: 0,
            flashColor: [1, 1, 1],
            worms: 0,
            shaft: 0,
            skylight: 0,
            dim: 0,
            lattice: 0,
            combo: 0,
            streak: 0,
            punch: 0,
            level: 0,
            fever: 0,
            stage: 0,
            familyLevel: new Float32Array(CRYSTAL_CAVE_FAMILY_COUNT).fill(1),
            /** The newest wave in flight (the one a single-shell reader follows). */
            wave: {
                active: false, radius: -100, strength: 0, far: false,
            },
            /** Every wave slot, in slot order. */
            waves: Array.from({ length: CRYSTAL_CAVE_WAVE_SLOTS }, () => ({
                active: false, radius: -100, strength: 0, far: false,
            })),
        };
        this.reset();
    }

    reset() {
        this.disposed = false;
        this.time = 0;
        this.serial = 0;
        this.streak = 0;
        this.combo = 0;
        this.depth = 1;
        this.pendingDrop = 0;
        this.pendingHard = false;
        this.energy = 0;
        this.flash = 0;
        this.flashColor[0] = 1;
        this.flashColor[1] = 1;
        this.flashColor[2] = 1;
        this.worms = 0;
        this.shaft = 0;
        this.skylight = 0;
        this.dim = 0;
        this.resonance = 0;
        this.resonanceTarget = 0;
        this.fedAt = -Infinity;
        this.boost.fill(0);
        this.waves.forEach((wave) => {
            wave.active = false;
            wave.age = 0;
            wave.strength = 0;
            wave.far = false;
        });
        this.pendingWaves.forEach((pending) => {
            pending.strength = 0;
            pending.delay = 0;
        });
        this.newestWave = -1;
        this.lastWaveAt = -Infinity;
        this.chorus = 0;
        this.b2bRun = 0;
        this.b2bBroken = false;
        this.maybePlain = false;
        this.tracker.reset();
        this.surge.reset();
        this.heat.punch = 0;
        this.heat.level = 0;
        this.heat.fever = 0;
        this.heat.stage = 0;
        this.cueCount = 0;
        this.updateFrame();
    }

    random() {
        const value = this.rng();
        return Number.isFinite(value) ? clamp(value, 0, 1 - Number.EPSILON) : 0.5;
    }

    cue(type, values = {}) {
        if (this.cueCount >= CRYSTAL_CAVE_MAX_CUES) return null;
        const cue = this.cues[this.cueCount];
        this.cueCount += 1;
        cue.type = type;
        cue.side = values.side ?? 0;
        cue.column = values.column ?? 0.5;
        cue.row = values.row ?? 0.3;
        cue.family = values.family ?? 0;
        cue.strength = values.strength ?? 0.5;
        cue.lines = values.lines ?? 0;
        cue.count = values.count ?? 0;
        cue.drop = values.drop ?? 0;
        cue.slot = values.slot ?? 0;
        cue.tinted = Boolean(values.tint);
        if (values.tint) [cue.tint[0], cue.tint[1], cue.tint[2]] = values.tint;
        return cue;
    }

    /** The world calls this once it has acted on the frame's cues. */
    clearCues() {
        this.cueCount = 0;
    }

    /** The cave's excitement: a new hit lifts what is lit, and lifts it further the more there is. */
    excite(energy) {
        const hit = clamp(energy, 0, 1);
        this.energy = Math.min(1, Math.max(this.energy, hit) + Math.min(this.energy, hit) * 0.15);
    }

    lift(family, amount) {
        this.boost[family] = Math.min(2.4, this.boost[family] + amount);
    }

    liftAll(amount) {
        for (let family = 0; family < CRYSTAL_CAVE_FAMILY_COUNT; family += 1) this.lift(family, amount);
    }

    /**
     * The board's flash: a new one adds to what is still lit (a weak one never cuts a strong one)
     * and its colour joins the light by its share instead of replacing it.
     */
    light(strength, colour = null) {
        const hit = clamp(strength, 0, 1);
        if (!(hit > 0)) return;
        const share = hit / (this.flash + hit);
        for (let channel = 0; channel < 3; channel += 1) {
            const target = colour ? colour[channel] : 1;
            this.flashColor[channel] += (target - this.flashColor[channel]) * share;
        }
        this.flash = Math.min(1, Math.max(this.flash, hit) + Math.min(this.flash, hit) * 0.3);
    }

    /** A wave of light through the cave, now or after `delay` seconds; waves fly side by side. */
    sweep(strength, far = false, delay = 0) {
        const level = clamp(strength, 0, 1);
        if (!(level > 0)) return;
        if (delay > 0) {
            // The weakest waiting wave gives way when every place is taken.
            let slot = this.pendingWaves[0];
            for (const pending of this.pendingWaves) if (pending.strength < slot.strength) slot = pending;
            if (slot.strength >= level) return;
            slot.strength = level;
            slot.far = far;
            slot.delay = delay;
            return;
        }
        this.startWave(level, far, 0);
    }

    startWave(level, far, age) {
        // A wave that only just left takes this one in: one brighter shell, not two on top of each other.
        let youngest = null;
        for (const wave of this.waves) {
            if (wave.active && wave.far === far && (!youngest || wave.age < youngest.age)) youngest = wave;
        }
        if (youngest && youngest.age < WAVE_MERGE_SECONDS) {
            const held = youngest.strength;
            youngest.strength = Math.min(1, Math.max(held, level) + Math.min(held, level) * 0.3);
            for (let index = 0; index < this.cueCount; index += 1) {
                const cue = this.cues[index];
                if (cue.type === 'wave' && cue.slot === youngest.slot) cue.strength = youngest.strength;
            }
            return;
        }
        // A free slot, or the faintest wave still in flight gives way (it is far out by then).
        let chosen = this.waves[0];
        let faintest = Infinity;
        for (const wave of this.waves) {
            const left = wave.active ? wave.strength * waveTail(wave.age, this.heat.level) : -1;
            if (left < faintest) {
                faintest = left;
                chosen = wave;
            }
        }
        chosen.active = true;
        chosen.age = age;
        chosen.strength = level;
        chosen.far = far;
        this.newestWave = chosen.slot;
        this.lastWaveAt = this.time;
        this.cue('wave', { strength: level, count: far ? 1 : 0, slot: chosen.slot });
    }

    familyOf(payload) {
        const type = payload?.piece?.type ?? payload?.type;
        if (typeof type === 'string' && Object.hasOwn(CRYSTAL_CAVE_PIECE_FAMILY, type.toUpperCase())) {
            return CRYSTAL_CAVE_PIECE_FAMILY[type.toUpperCase()];
        }
        return this.serial % CRYSTAL_CAVE_FAMILY_COUNT;
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
        // The true combo: a lock that follows a lock without a clear between them breaks the chain.
        if (this.tracker.notePieceLocked() === 0) this.release();
        this.depth = 1;
        const place = boardPlace(payload);
        const drop = this.pendingDrop;
        this.pendingDrop = 0;
        this.surge.lock({ hardDrop: this.pendingHard }, this.time);
        this.pendingHard = false;
        const family = this.familyOf(payload);
        const tint = pieceTint(payload.piece, [1, 1, 1]);
        let side = this.serial % 2 === 0 ? -1 : 1;
        if (place) side = place.column < 0.5 ? -1 : 1;
        this.excite(0.1 + drop * 0.24);
        this.lift(family, 0.42 + drop * 0.5);
        this.light(0.2 + drop * 0.4, tint);
        if (drop > 0.3) this.worms = Math.max(this.worms, drop * 0.5);
        this.cue('lock', {
            side, column: place?.column ?? 0.5, row: place?.row ?? 0.1, family, strength: 0.45 + drop * 0.55, drop, tint,
        });
        this.serial += 1;
        return true;
    }

    onLineClear(countOrPayload = 1, detail = {}) {
        if (this.disposed) return false;
        const event = eventArguments(countOrPayload, detail, ['lineCount', 'lines', 'linesCleared', 'count'], 4);
        const lines = event.count;
        if (lines === 0) return false;
        // The cascade depth: the payload's own, else the COMBO event that came just before it.
        const reported = positiveCount(event.detail.cascadeCount, 12);
        const depth = Math.max(1, reported || this.depth);
        const deep = Math.min(4, depth - 1);
        const first = deep === 0;
        this.streak = this.tracker.noteLineClear();
        if (first) {
            // A difficult clear in a row is answered by B2B; a plain one ends the run (unless the
            // T-spin that comes right after it says it was one).
            if (this.maybePlain) this.b2bBroken = true;
            this.maybePlain = lines < 4;
            this.surge.clear({ lines, combo: this.streak }, this.time);
        } else {
            const W = SURGE_WEIGHTS;
            this.surge.punch.hit(W.punch.wave + W.punch.lines[lines] * 0.4, this.time);
            this.surge.level.hit(W.heat.wave + W.heat.lines[lines] * 0.25, this.time);
        }
        const four = lines >= 4;
        // Each wave of a cascade builds on the last: deeper, brighter, wider.
        const build = 1 + deep * 0.15;
        const row = clearedRow(event.detail) ?? boardPlace(event.detail)?.row ?? 0.2;
        this.excite((0.3 + lines * 0.15) * build);
        this.liftAll(0.16 + lines * 0.16);
        this.light(0.3 + lines * 0.14);
        this.worms = Math.max(this.worms, 0.3 + lines * 0.16 + deep * 0.12);
        if (lines >= 3) this.shaft = Math.max(this.shaft, four ? 1 : 0.5);
        this.sweep(0.42 + lines * 0.14 + deep * 0.1);
        if (four) this.sweep(0.9, false, 0.34);
        this.cue('clear', {
            row, lines, strength: Math.min(1.4, (0.4 + lines * 0.15) * build), count: depth,
        });
        this.cue('grow', { count: lines });
        if (four) this.cue('shower', { strength: 1 });
        if (this.streak >= 2) this.hum(1 - Math.exp(-(this.streak - 1) * 0.3), this.streak);
        return true;
    }

    /** Raise the sustained hum and the lattice that goes with it. */
    hum(level, count) {
        this.resonanceTarget = Math.max(this.resonanceTarget, clamp(level, 0, 1));
        this.fedAt = this.time;
        this.combo = Math.max(this.combo, count);
    }

    /** The chain broke: the lattice lets go (the world drops it link by link, the hum eases out). */
    release() {
        if (this.combo >= 2 && this.resonance > 0.05) this.cue('release', { strength: this.resonance, count: this.combo });
        this.streak = 0;
        this.combo = 0;
        this.resonanceTarget = 0;
        this.fedAt = -Infinity;
    }

    /** COMBO is the cascade depth: the waves of one lock, each answered more fully than the last. */
    onCombo(countOrPayload, detail = {}) {
        if (this.disposed) return false;
        const event = eventArguments(countOrPayload, detail, ['comboCount', 'combo', 'count'], 60);
        if (event.count < 2) return false;
        this.depth = Math.max(this.depth, event.count);
        const level = 1 - Math.exp(-(event.count - 1) * 0.26);
        this.excite(0.4 + level * 0.55);
        this.lift((event.count + this.serial) % CRYSTAL_CAVE_FAMILY_COUNT, 0.5 + level * 0.6);
        this.liftAll(0.1 + level * 0.25);
        this.worms = Math.max(this.worms, 0.4 + level * 0.6);
        this.hum(0.32 + level * 0.68, event.count);
        this.cue('combo', { count: event.count, strength: 0.35 + level * 0.65 });
        return true;
    }

    onTSpin(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        const place = boardPlace(payload);
        // A T-spin that cleared nothing still turns a little light; one that cleared is a full wheel.
        const cleared = positiveCount(payload.lineCount ?? payload.lines, 4) > 0
            || !(Object.hasOwn(payload, 'lineCount') || Object.hasOwn(payload, 'lines'));
        const W = SURGE_WEIGHTS;
        if (cleared) {
            this.maybePlain = false;
            this.excite(0.55);
            this.liftAll(0.3);
            this.light(0.6, SPIN_VIOLET);
            this.surge.punch.hit(W.punch.tspin, this.time);
            this.surge.level.hit(W.heat.tspin, this.time);
        } else {
            this.excite(0.25);
            this.liftAll(0.12);
            this.light(0.22, SPIN_VIOLET);
            this.surge.punch.hit(W.punch.tspin * 0.5, this.time);
            this.surge.level.hit(W.heat.tspin * 0.3, this.time);
        }
        this.cue('spin', {
            side: place && place.column >= 0.5 ? 1 : -1,
            row: place?.row ?? 0.3,
            family: this.familyOf(payload),
            strength: cleared ? 0.8 : 0.42,
        });
        return true;
    }

    /** A second difficult clear in a row: the skylight opens, wider for every one that follows. */
    onBackToBack() {
        if (this.disposed) return false;
        if (this.b2bBroken) this.b2bRun = 0;
        this.b2bBroken = false;
        this.b2bRun += 1;
        const run = Math.min(5, this.b2bRun);
        this.excite(0.5 + run * 0.05);
        this.worms = Math.max(this.worms, 0.7);
        this.skylight = Math.min(1.6, this.skylight + 0.55 + run * 0.15);
        this.light(0.3 + run * 0.05, SKY_BLUE);
        this.hum(Math.max(this.resonanceTarget, 0.55), Math.max(this.combo, 2));
        this.surge.punch.hit(SURGE_WEIGHTS.punch.b2b, this.time);
        this.surge.level.hit(SURGE_WEIGHTS.heat.b2b, this.time);
        this.cue('skyfall', { strength: Math.min(1.2, 0.6 + run * 0.12), count: run });
        return true;
    }

    /**
     * A perfect clear crowns the clear it ends (physics sends it a beat after the last wave): no
     * second wave from the board, which is still crossing the hall — the heart answers from the
     * far end, so the cave rings from both ends at once, and every grown crystal rings in turn.
     */
    onPerfectClear() {
        if (this.disposed) return false;
        this.excite(1);
        this.liftAll(1.2);
        this.light(0.85, GOLD);
        this.worms = 1;
        this.shaft = 1;
        this.skylight = Math.max(this.skylight, 0.6);
        this.sweep(1, true);
        this.cue('heart', { strength: 1 });
        this.cue('crown', { strength: 1 });
        this.cue('shower', { strength: 1 });
        this.cue('grow', { count: 6 });
        this.surge.punch.hit(SURGE_WEIGHTS.punch.perfect, this.time);
        this.surge.level.hit(SURGE_WEIGHTS.heat.perfect, this.time);
        return true;
    }

    onLevelUp() {
        if (this.disposed) return false;
        this.excite(0.65);
        this.liftAll(0.5);
        this.worms = Math.max(this.worms, 0.8);
        this.shaft = Math.max(this.shaft, 0.7);
        this.sweep(0.75, true);
        this.cue('heart', { strength: 0.6 });
        this.surge.levelUp(this.time);
        return true;
    }

    /** The session ended: the cave dims and what grew during play withdraws. */
    onGameOver() {
        if (this.disposed) return false;
        this.release();
        this.tracker.reset();
        this.b2bRun = 0;
        this.maybePlain = false;
        this.cueCount = 0;
        this.dim = 1;
        this.boost.fill(0);
        this.waves.forEach((wave) => { wave.active = false; });
        this.pendingWaves.forEach((pending) => { pending.strength = 0; });
        this.cue('wither');
        return true;
    }

    update(dt) {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return this.updateFrame();
        this.time += dt;
        this.energy *= Math.exp(-DECAY.energy * dt);
        this.flash *= Math.exp(-DECAY.flash * dt);
        this.worms *= Math.exp(-DECAY.worms * dt);
        this.shaft *= Math.exp(-DECAY.shaft * dt);
        this.skylight *= Math.exp(-DECAY.skylight * dt);
        this.dim *= Math.exp(-DECAY.dim * dt);
        for (let family = 0; family < CRYSTAL_CAVE_FAMILY_COUNT; family += 1) {
            this.boost[family] *= Math.exp(-DECAY.boost * dt);
        }
        const heat = this.surge.sample(this.time);
        this.heat.punch = heat.punch;
        this.heat.level = heat.level;
        this.heat.fever = heat.fever;
        this.heat.stage = heat.stage;
        // The hum rises quickly while the chain is fed; resting hands quiet it but the chain
        // holds (only a lock that clears nothing breaks it); once broken it eases out.
        if (this.combo > 0 || this.resonanceTarget > 0) {
            const unfed = this.time - this.fedAt > COMBO_HOLD_SECONDS;
            const goal = this.resonanceTarget * (unfed ? HUM_QUIET : 1);
            const rate = goal > this.resonance ? 3.4 : 0.8;
            this.resonance += (goal - this.resonance) * (1 - Math.exp(-dt * rate));
        } else {
            this.resonance *= Math.exp(-HUM_RELEASE * dt);
            if (this.resonance < 0.0005) this.resonance = 0;
        }
        for (const wave of this.waves) {
            if (!wave.active) continue;
            wave.age += dt;
            if (wave.age >= CRYSTAL_CAVE_WAVE_SECONDS) wave.active = false;
        }
        for (const pending of this.pendingWaves) {
            if (!(pending.strength > 0)) continue;
            pending.delay -= dt;
            if (pending.delay <= 0) {
                const { strength, far } = pending;
                pending.strength = 0;
                this.startWave(strength, far, Math.max(0, -pending.delay));
            }
        }
        // In a fever the hall sings between clears: a chorus of waves, from the board and from
        // the heart in turn, whenever the last one is a moment old.
        const { fever } = this.heat;
        if (fever > 0.4 && this.time - this.lastWaveAt > 1.7 - fever * 0.5) {
            this.chorus += 1;
            this.sweep(0.22 + fever * 0.26, this.chorus % 2 === 0);
        }
        return this.updateFrame();
    }

    updateFrame() {
        const { frame, heat } = this;
        frame.energy = this.energy < 0.00001 ? 0 : this.energy;
        // The heat of play, once past casual: the stones hum and glow with it.
        const warm = Math.max(0, heat.level - HEAT_FLOOR);
        frame.resonance = Math.max(this.resonance, Math.min(0.55, warm * 0.35 + heat.fever * 0.25));
        frame.flash = this.flash < 0.00001 ? 0 : this.flash;
        [frame.flashColor[0], frame.flashColor[1], frame.flashColor[2]] = this.flashColor;
        frame.worms = this.worms;
        frame.shaft = this.shaft;
        frame.skylight = this.skylight < 0.00001 ? 0 : this.skylight;
        frame.dim = this.dim;
        frame.lattice = this.resonance;
        frame.combo = this.combo;
        frame.streak = this.streak;
        frame.punch = heat.punch;
        frame.level = heat.level;
        frame.fever = heat.fever;
        frame.stage = heat.stage;
        const dimmed = 1 - this.dim * 0.68;
        // A little more resting glow in every stone; the build is carried by the hum, the
        // lattice and the light in motion, not by lifting every light at once.
        const glow = warm * 0.1 + heat.fever * 0.08;
        for (let family = 0; family < CRYSTAL_CAVE_FAMILY_COUNT; family += 1) {
            frame.familyLevel[family] = Math.min(3.8, (1 + this.boost[family] + this.resonance * 0.3 + glow) * dimmed);
        }
        for (let slot = 0; slot < CRYSTAL_CAVE_WAVE_SLOTS; slot += 1) {
            const wave = this.waves[slot];
            const view = frame.waves[slot];
            view.active = wave.active;
            view.radius = wave.active ? wave.age * CRYSTAL_CAVE_WAVE_SPEED : -100;
            view.strength = wave.active ? wave.strength * waveTail(wave.age, heat.level) : 0;
            view.far = wave.far;
        }
        const newest = frame.waves[this.newestWave] ?? null;
        const shown = newest?.active ? newest : null;
        frame.wave.active = Boolean(shown);
        frame.wave.radius = shown ? shown.radius : -100;
        frame.wave.strength = shown ? shown.strength : 0;
        frame.wave.far = shown ? shown.far : false;
        return frame;
    }

    getFrame() {
        return this.frame;
    }

    dispose() {
        this.disposed = true;
        this.cueCount = 0;
    }
}
