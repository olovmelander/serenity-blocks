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
 *   t-spin        a spinning garland beside the board
 *   perfect clear / level up   the whole evening exhales: light, rings, wind, petals, wings
 */

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
const SPECIES_SLOTS = 8;
const SPECIES_DECAY = 0.85;
const CROWN_HOLD_SECONDS = 2.6;
const CROWN_RELEASE_RATE = 0.85;
const FRONT_SECONDS = 2.2;
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
    constructor({ quality = 'High', rng = Math.random } = {}) {
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
        this.envelopes = Object.fromEntries(ENVELOPE_KEYS.map((key) => [key, 0]));
        this.species = new Float32Array(SPECIES_SLOTS);
        /** How brightly each of the seven lanterns on the maypole burns. */
        this.bouquet = new Float32Array(SUMMER_BOUQUET_KINDS);
        this.front = {
            active: false, age: 0, direction: 1, strength: 0,
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
        this.waveSerial = 0;
        this.waveCursor = 0;
        this.streak = 0;
        this.clearedSinceLock = false;
        this.pendingDrop = 0;
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
        this.species.fill(0);
        this.bouquet.fill(0);
        for (const key of ENVELOPE_KEYS) this.envelopes[key] = 0;
        Object.assign(this.front, {
            active: false, age: 0, direction: 1, strength: 0,
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

    excite(values) {
        for (const key of ENVELOPE_KEYS) {
            const value = Number.isFinite(values[key]) ? clamp(values[key], 0, 1) : 0;
            this.envelopes[key] = Math.max(this.envelopes[key], value);
        }
    }

    /** Call on one flower kind (or, with SUMMER_MIXED, on all seven). */
    call(flower, amount) {
        const level = clamp(amount, 0, 1);
        if (flower === SUMMER_MIXED) {
            for (let kind = 0; kind < SUMMER_BOUQUET_KINDS; kind += 1) {
                this.species[kind] = Math.max(this.species[kind], level);
            }
        } else if (flower >= 0 && flower < SPECIES_SLOTS) {
            this.species[flower] = Math.max(this.species[flower], level);
        }
    }

    /** Claim a free slot, or the one furthest through its life. */
    emit(kind, {
        side = 0, column = 0.5, row = 0.3, strength = 0.5, lines = 0, duration = 1, flower = SUMMER_MIXED,
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

    sweep(strength) {
        this.sweeps += 1;
        Object.assign(this.front, {
            active: true, age: 0, direction: this.sweeps % 2 === 0 ? -1 : 1, strength: clamp(strength, 0, 1),
        });
    }

    raiseCrown(level) {
        this.crownTarget = Math.max(this.crownTarget, clamp(level, 0, 1));
        this.crownHold = CROWN_HOLD_SECONDS;
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
        return true;
    }

    onPieceLock(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        this.settled = false;
        // A lock that follows a lock without a clear between them ends the streak.
        if (!this.clearedSinceLock) this.streak = 0;
        this.clearedSinceLock = false;
        const place = boardPlace(payload);
        const flower = summerFlowerForPiece(payload.piece);
        const drop = this.pendingDrop;
        this.pendingDrop = 0;
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
        if (!this.clearedSinceLock) {
            this.clearedSinceLock = true;
            this.streak += 1;
        }
        const row = clearedRow(event.detail) ?? boardPlace(event.detail)?.row ?? 0.2;
        const four = lines >= 4;
        this.excite({
            gust: 0.28 + lines * 0.14,
            warmth: 0.14 + lines * 0.11 + (four ? 0.3 : 0),
            shafts: 0.14 + lines * 0.13 + (four ? 0.3 : 0),
            glow: 0.2 + lines * 0.11,
            shimmer: 0.4 + lines * 0.15,
            flock: four ? 1 : 0,
            flutter: 0.2 + lines * 0.2,
        });
        this.call(SUMMER_MIXED, 0.3 + lines * 0.16);
        const strength = 0.36 + lines * 0.16;
        // Petals are blown out of both sides of the board at the height of the cleared rows.
        this.emit('clear', {
            side: -1, row, strength, lines, duration: 1.5 + lines * 0.12,
        });
        this.emit('clear', {
            side: 1, row, strength, lines, duration: 1.5 + lines * 0.12,
        });
        // One broad ring from under the whole row, and from two lines a second on its heels.
        this.ripple(0.5, row, 1.1 + lines * 0.36);
        this.gust(0.5, 0.9 + lines * 0.4);
        if (lines >= 2) {
            this.ripple(lines % 2 === 0 ? 0.12 : 0.88, row, 0.7 + lines * 0.2);
            this.sweep(0.3 + lines * 0.17);
        }
        if (four) {
            this.emit('rise', {
                row: 0, strength: 1, lines, duration: 2.8,
            });
        }
        if (this.streak >= 2) this.raiseCrown(1 - Math.exp(-(this.streak - 1) * 0.3));
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
        this.call(SUMMER_MIXED, 0.4 + growth * 0.6);
        this.raiseCrown(0.3 + growth * 0.7);
        this.emit('combo', {
            row: 0.1, strength: 0.4 + growth * 0.6, lines: event.count, duration: 1.4,
        });
        this.ripple(this.random(), 0.05, 0.7 + growth * 0.9);
        this.gust(this.random(), 0.8 + growth);
        return true;
    }

    onTSpin(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        const place = boardPlace(payload);
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

    onBackToBack() {
        if (this.disposed) return false;
        this.excite({
            warmth: 0.5, glow: 0.7, shafts: 0.45, shimmer: 0.6,
        });
        this.raiseCrown(Math.max(this.crownTarget, 0.55));
        return true;
    }

    onPerfectClear() {
        if (this.disposed) return false;
        this.settled = false;
        this.excite({
            gust: 0.9, warmth: 1, shafts: 1, glow: 1, shimmer: 1, flock: 1, flutter: 1,
        });
        this.call(SUMMER_MIXED, 1);
        this.emit('rise', {
            row: 0, strength: 1, lines: 4, duration: 3.4,
        });
        this.emit('bouquet', { strength: 1, duration: 2.6 });
        this.ripple(0.5, 0.1, 2.6);
        this.ripple(0.5, 0.5, 1.6);
        this.gust(0.5, 2.8);
        this.sweep(1);
        this.raiseCrown(0.85);
        return true;
    }

    onLevelUp() {
        if (this.disposed) return false;
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
        this.streak = 0;
        this.front.active = false;
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
        if (this.front.active) {
            this.front.age += dt;
            if (this.front.age >= FRONT_SECONDS) this.front.active = false;
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
        const { front } = this;
        const travel = clamp(front.age / FRONT_SECONDS, 0, 1);
        return {
            ...this.envelopes,
            epoch: this.epoch,
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
            front: front.active ? {
                // -1.4 .. 1.4 across the view, in the direction of travel.
                position: (travel * 2.8 - 1.4) * front.direction,
                direction: front.direction,
                strength: front.strength * Math.sin(Math.PI * Math.min(1, travel * 1.15)),
            } : null,
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
