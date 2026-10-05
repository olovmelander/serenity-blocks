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
 *                 crystals grow at the water's edge — one cluster per line.
 *   four lines    all of that twice over, the skylight flares and the vault rains light.
 *   combo/streak  crystal tips link into a lattice of beams that grows with the chain
 *                 while the stones hum; when the chain breaks the lattice lets go.
 *   t-spin        a pinwheel of light beside the board.
 *   perfect clear / level up   the heart of the cave answers from the far end.
 *   game over     the cave dims and what grew during play withdraws.
 */

export const CRYSTAL_CAVE_FAMILY_COUNT = 5;
/** Tetromino → mineral family (matches the theme's piece colours). */
export const CRYSTAL_CAVE_PIECE_FAMILY = Object.freeze({
    I: 4, O: 1, T: 0, S: 3, Z: 2, J: 4, L: 0,
});
export const CRYSTAL_CAVE_MAX_CUES = 16;
/** Speed of the wave of light through the cave, world units per second. */
export const CRYSTAL_CAVE_WAVE_SPEED = 44;
export const CRYSTAL_CAVE_WAVE_SECONDS = 3.2;

const BOARD_COLUMNS = 10;
const BOARD_VISIBLE_ROWS = 20;
const BOARD_HIDDEN_ROWS = 4;
const COMBO_HOLD_SECONDS = 2.8;
const DECAY = Object.freeze({
    energy: 1.45, flash: 4.2, worms: 0.75, shaft: 0.6, boost: 1.05, dim: 0.28,
});

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

export class CrystalCaveReactions {
    constructor({ rng = Math.random } = {}) {
        this.rng = typeof rng === 'function' ? rng : Math.random;
        this.boost = new Float32Array(CRYSTAL_CAVE_FAMILY_COUNT);
        this.cues = Array.from({ length: CRYSTAL_CAVE_MAX_CUES }, () => ({
            type: 'none', side: 0, column: 0.5, row: 0.3, family: 0, strength: 0, lines: 0, count: 0, drop: 0, tinted: false, tint: [1, 1, 1],
        }));
        this.frame = {
            energy: 0,
            resonance: 0,
            flash: 0,
            flashColor: [1, 1, 1],
            worms: 0,
            shaft: 0,
            dim: 0,
            lattice: 0,
            combo: 0,
            streak: 0,
            familyLevel: new Float32Array(CRYSTAL_CAVE_FAMILY_COUNT).fill(1),
            wave: {
                active: false, radius: -100, strength: 0, far: false,
            },
        };
        this.reset();
    }

    reset() {
        this.disposed = false;
        this.time = 0;
        this.serial = 0;
        this.streak = 0;
        this.combo = 0;
        this.clearedSinceLock = false;
        this.pendingDrop = 0;
        this.energy = 0;
        this.flash = 0;
        this.flashColor = [1, 1, 1];
        this.worms = 0;
        this.shaft = 0;
        this.dim = 0;
        this.resonance = 0;
        this.resonanceTarget = 0;
        this.hold = 0;
        this.boost.fill(0);
        this.wave = {
            active: false, age: 0, strength: 0, far: false,
        };
        this.pendingWave = { strength: 0, far: false, delay: 0 };
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
        cue.tinted = Boolean(values.tint);
        if (values.tint) [cue.tint[0], cue.tint[1], cue.tint[2]] = values.tint;
        return cue;
    }

    /** The world calls this once it has acted on the frame's cues. */
    clearCues() {
        this.cueCount = 0;
    }

    excite(energy) {
        this.energy = Math.max(this.energy, clamp(energy, 0, 1));
    }

    lift(family, amount) {
        this.boost[family] = Math.min(2.4, this.boost[family] + amount);
    }

    liftAll(amount) {
        for (let family = 0; family < CRYSTAL_CAVE_FAMILY_COUNT; family += 1) this.lift(family, amount);
    }

    light(strength, colour = null) {
        if (strength < this.flash) return;
        this.flash = clamp(strength, 0, 1);
        this.flashColor = colour ? [colour[0], colour[1], colour[2]] : [1, 1, 1];
    }

    sweep(strength, far = false, delay = 0) {
        const level = clamp(strength, 0, 1);
        if (this.wave.active || delay > 0) {
            if (level >= this.pendingWave.strength) this.pendingWave = { strength: level, far, delay };
            return;
        }
        this.wave = {
            active: true, age: 0, strength: level, far,
        };
        this.cue('wave', { strength: level, count: far ? 1 : 0 });
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
        return true;
    }

    onPieceLock(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        // A lock that follows a lock without a clear between them breaks the chain.
        if (!this.clearedSinceLock) this.release();
        this.clearedSinceLock = false;
        const place = boardPlace(payload);
        const drop = this.pendingDrop;
        this.pendingDrop = 0;
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
        if (!this.clearedSinceLock) {
            this.clearedSinceLock = true;
            this.streak += 1;
        }
        const four = lines >= 4;
        const row = clearedRow(event.detail) ?? boardPlace(event.detail)?.row ?? 0.2;
        this.excite(0.3 + lines * 0.15);
        this.liftAll(0.16 + lines * 0.16);
        this.light(0.3 + lines * 0.14);
        this.worms = Math.max(this.worms, 0.3 + lines * 0.16);
        if (lines >= 3) this.shaft = Math.max(this.shaft, four ? 1 : 0.5);
        this.sweep(0.42 + lines * 0.14);
        if (four) this.sweep(0.9, false, 0.34);
        this.cue('clear', { row, lines, strength: 0.4 + lines * 0.15 });
        this.cue('grow', { count: lines });
        if (four) this.cue('shower', { strength: 1 });
        if (this.streak >= 2) this.hum(1 - Math.exp(-(this.streak - 1) * 0.3), this.streak);
        return true;
    }

    /** Raise the sustained hum and the lattice that goes with it. */
    hum(level, count) {
        this.resonanceTarget = Math.max(this.resonanceTarget, clamp(level, 0, 1));
        this.hold = COMBO_HOLD_SECONDS;
        this.combo = Math.max(this.combo, count);
    }

    /** The chain broke: the lattice lets go. */
    release() {
        if (this.combo >= 2 && this.resonance > 0.05) this.cue('release', { strength: this.resonance, count: this.combo });
        this.streak = 0;
        this.combo = 0;
        this.resonanceTarget = 0;
        this.hold = 0;
    }

    onCombo(countOrPayload, detail = {}) {
        if (this.disposed) return false;
        const event = eventArguments(countOrPayload, detail, ['comboCount', 'combo', 'count'], 60);
        if (event.count < 2) return false;
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
        this.excite(0.55);
        this.liftAll(0.3);
        this.light(0.6, [0.86, 0.5, 1]);
        this.cue('spin', {
            side: place && place.column >= 0.5 ? 1 : -1, row: place?.row ?? 0.3, family: this.familyOf(payload), strength: 0.8,
        });
        return true;
    }

    onBackToBack() {
        if (this.disposed) return false;
        this.excite(0.5);
        this.worms = Math.max(this.worms, 0.7);
        this.hum(Math.max(this.resonanceTarget, 0.55), Math.max(this.combo, 2));
        return true;
    }

    onPerfectClear() {
        if (this.disposed) return false;
        this.excite(1);
        this.liftAll(1.2);
        this.light(1);
        this.worms = 1;
        this.shaft = 1;
        // The cave answers at once from the board, and again from its heart.
        this.sweep(1);
        this.sweep(1, true, 0.7);
        this.cue('heart', { strength: 1 });
        this.cue('shower', { strength: 1 });
        this.cue('grow', { count: 6 });
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
        return true;
    }

    /** The session ended: the cave dims and what grew during play withdraws. */
    onGameOver() {
        if (this.disposed) return false;
        this.release();
        this.cueCount = 0;
        this.dim = 1;
        this.boost.fill(0);
        this.wave.active = false;
        this.pendingWave.strength = 0;
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
        this.dim *= Math.exp(-DECAY.dim * dt);
        for (let family = 0; family < CRYSTAL_CAVE_FAMILY_COUNT; family += 1) {
            this.boost[family] *= Math.exp(-DECAY.boost * dt);
        }
        // The hum rises quickly, holds while the chain is fed, then lets go.
        if (this.hold > 0) {
            this.hold = Math.max(0, this.hold - dt);
            this.resonance += (this.resonanceTarget - this.resonance) * (1 - Math.exp(-dt * 3.4));
            if (this.hold === 0) this.release();
        } else {
            this.resonance *= Math.exp(-0.75 * dt);
            if (this.resonance < 0.0005) this.resonance = 0;
        }
        if (this.wave.active) {
            this.wave.age += dt;
            if (this.wave.age >= CRYSTAL_CAVE_WAVE_SECONDS) this.wave.active = false;
        }
        if (this.pendingWave.strength > 0) {
            this.pendingWave.delay -= dt;
            if (this.pendingWave.delay <= 0 && (!this.wave.active || this.wave.age > 0.3)) {
                this.wave = {
                    active: true, age: Math.max(0, -this.pendingWave.delay), strength: this.pendingWave.strength, far: this.pendingWave.far,
                };
                this.pendingWave.strength = 0;
                this.cue('wave', { strength: this.wave.strength, count: this.wave.far ? 1 : 0 });
            }
        }
        return this.updateFrame();
    }

    updateFrame() {
        const { frame } = this;
        frame.energy = this.energy < 0.00001 ? 0 : this.energy;
        frame.resonance = this.resonance;
        frame.flash = this.flash < 0.00001 ? 0 : this.flash;
        [frame.flashColor[0], frame.flashColor[1], frame.flashColor[2]] = this.flashColor;
        frame.worms = this.worms;
        frame.shaft = this.shaft;
        frame.dim = this.dim;
        frame.lattice = this.resonance;
        frame.combo = this.combo;
        frame.streak = this.streak;
        const dimmed = 1 - this.dim * 0.68;
        for (let family = 0; family < CRYSTAL_CAVE_FAMILY_COUNT; family += 1) {
            frame.familyLevel[family] = (1 + this.boost[family] + this.resonance * 0.3) * dimmed;
        }
        const { wave } = this;
        const travel = clamp(wave.age / CRYSTAL_CAVE_WAVE_SECONDS, 0, 1);
        const tail = 1 - travel * travel * (3 - 2 * travel);
        frame.wave.active = wave.active;
        frame.wave.radius = wave.active ? wave.age * CRYSTAL_CAVE_WAVE_SPEED : -100;
        frame.wave.strength = wave.active ? wave.strength * tail : 0;
        frame.wave.far = wave.far;
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
