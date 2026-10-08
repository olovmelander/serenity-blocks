/**
 * Forest — how the old wood answers the game.
 *
 * A pure, seconds-based director: gameplay events become a small set of decaying light and
 * wind envelopes, a level of "wakefulness" a combo builds and holds, waves of light to send
 * across the floor, bounded "emitters" described in board space (which side of the board,
 * how high, how strong), falling stars, and a summons for the firefly stag. ForestWorld
 * turns them into light, fireflies and wind; nothing here touches the scene, so the same
 * director runs in tests, the playground and the game.
 *
 * The language:
 *   lock          a wave of light runs out over the moss from where the piece landed, every
 *                 firefly it crosses flashes, the ferns bow as it passes, and a puff of
 *                 fireflies leaves the board's edge beside the piece; a long hard drop
 *                 shakes dew from the boughs
 *   line clear    twin jets of fireflies from both sides at the cleared rows and a taller,
 *                 faster wave that climbs the trunks; from two lines a second wave and a
 *                 front of wind; from three a star falls
 *   four lines    all of that, fireflies lifting off the whole floor, the moon flaring,
 *                 and the fireflies gathering into a great stag between the trees
 *   combo/streak  the forest wakes: fireflies fall into step until the whole wood flashes
 *                 in waves, garlands of them wind up the old trunks, foxfire threads spread
 *                 through the moss and the fungi light; a lock without a clear lets it sleep
 *   t-spin        a spiral flourish beside the board
 *   perfect clear / level up   the whole forest answers at once
 */

export const FOREST_REACTION_LIMITS = Object.freeze({
    Minimal: 4,
    Low: 6,
    Medium: 8,
    High: 12,
    Ultra: 14,
    Extreme: 16,
});

const DECAY_RATES = Object.freeze({
    gust: 1.4,
    moon: 0.7,
    shafts: 0.85,
    glow: 1.1,
});
const ENVELOPE_KEYS = Object.keys(DECAY_RATES);
const WAKE_HOLD_SECONDS = 2.8;
const WAKE_RELEASE_RATE = 0.55;
const FRONT_SECONDS = 2.2;
const WAVE_QUEUE = 8;
const BOARD_COLUMNS = 10;
const BOARD_VISIBLE_ROWS = 20;
const BOARD_HIDDEN_ROWS = 4;
/** The stag gathers, stands, and lets go. */
export const FOREST_STAG_TIMING = Object.freeze({ gather: 1.5, hold: 3.6, release: 1.8 });

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

export class ForestReactions {
    constructor({ quality = 'High', rng = Math.random } = {}) {
        const requestedQuality = typeof quality === 'string' ? quality.toLowerCase() : '';
        this.quality = Object.keys(FOREST_REACTION_LIMITS)
            .find((tier) => tier.toLowerCase() === requestedQuality)
            || (requestedQuality === 'med' ? 'Medium' : 'High');
        this.maxEmitters = FOREST_REACTION_LIMITS[this.quality];
        this.rng = typeof rng === 'function' ? rng : Math.random;
        this.emitters = Array.from({ length: this.maxEmitters }, (_, id) => ({ id }));
        this.waves = Array.from({ length: WAVE_QUEUE }, () => ({
            serial: -1, kind: 'lock', column: 0.5, row: 0, strength: 0, heat: 0,
        }));
        this.envelopes = Object.fromEntries(ENVELOPE_KEYS.map((key) => [key, 0]));
        this.front = {
            active: false, age: 0, direction: 1, strength: 0,
        };
        this.stag = {
            serial: 0, active: false, age: 0, hold: FOREST_STAG_TIMING.hold,
        };
        // Counts resets, so a consumer can tell a fresh run of serials from a stale one.
        this.epoch = 0;
        this.disposed = false;
        this.reset();
    }

    reset() {
        this.epoch += 1;
        this.time = 0;
        this.cursor = 0;
        this.serial = 0;
        this.waveSerial = 0;
        this.waveCursor = 0;
        this.streak = 0;
        this.clearedSinceLock = false;
        this.pendingDrop = 0;
        this.wake = 0;
        this.wakeTarget = 0;
        this.wakeHold = 0;
        this.sweeps = 0;
        this.stars = 0;
        this.settled = false;
        for (const key of ENVELOPE_KEYS) this.envelopes[key] = 0;
        Object.assign(this.front, {
            active: false, age: 0, direction: 1, strength: 0,
        });
        Object.assign(this.stag, {
            serial: 0, active: false, age: 0, hold: FOREST_STAG_TIMING.hold,
        });
        for (const wave of this.waves) {
            Object.assign(wave, {
                serial: -1, kind: 'lock', column: 0.5, row: 0, strength: 0, heat: 0,
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

    excite(values) {
        for (const key of ENVELOPE_KEYS) {
            const value = Number.isFinite(values[key]) ? clamp(values[key], 0, 1) : 0;
            this.envelopes[key] = Math.max(this.envelopes[key], value);
        }
    }

    /** Claim a free slot, or the one furthest through its life. */
    emit(kind, {
        side = 0, column = 0.5, row = 0.3, strength = 0.5, lines = 0, duration = 1,
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
            age: 0,
            duration,
            seed: this.random(),
        });
        this.serial += 1;
        this.cursor = (selected + 1) % this.maxEmitters;
        return this.emitters[selected];
    }

    /** Ask for a wave of light from the floor behind a place on the board. */
    wave(kind, column, row, strength, heat = 0) {
        const wave = this.waves[this.waveCursor];
        wave.serial = this.waveSerial;
        wave.kind = kind;
        wave.column = clamp(column, 0, 1);
        wave.row = clamp(row, 0, 1);
        wave.strength = clamp(strength, 0, 3);
        wave.heat = clamp(heat, 0, 1);
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

    raiseWake(level) {
        this.wakeTarget = Math.max(this.wakeTarget, clamp(level, 0, 1));
        this.wakeHold = WAKE_HOLD_SECONDS;
    }

    /** Call the fireflies together into the stag; `hold` is how long it stands. */
    summon(hold = FOREST_STAG_TIMING.hold) {
        this.stag.serial += 1;
        this.stag.active = true;
        this.stag.age = 0;
        this.stag.hold = Number.isNaN(Number(hold)) ? FOREST_STAG_TIMING.hold : clamp(Number(hold), 0.5, 12);
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
        const drop = this.pendingDrop;
        this.pendingDrop = 0;
        const column = place?.column ?? 0.5;
        const row = place?.row ?? 0.12;
        this.excite({
            gust: 0.08 + drop * 0.14, glow: 0.06 + drop * 0.1, shafts: 0.04 + drop * 0.08,
        });
        let side = 0;
        if (place) side = place.column < 0.5 ? -1 : 1;
        this.emit('lock', {
            side, column, row, strength: 0.26 + drop * 0.5, duration: 1.1,
        });
        this.wave(drop > 0.3 ? 'drop' : 'lock', column, row, 0.6 + drop * 0.9);
        if (drop > 0.3) {
            this.emit('dew', {
                side, column, row, strength: drop, duration: 0.7,
            });
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
            moon: 0.12 + lines * 0.1 + (four ? 0.36 : 0),
            shafts: 0.14 + lines * 0.13 + (four ? 0.3 : 0),
            glow: 0.2 + lines * 0.11,
        });
        const strength = 0.36 + lines * 0.16;
        // Fireflies are blown out of both sides of the board at the height of the cleared rows.
        this.emit('clear', {
            side: -1, row, strength, lines, duration: 1.5 + lines * 0.12,
        });
        this.emit('clear', {
            side: 1, row, strength, lines, duration: 1.5 + lines * 0.12,
        });
        // One tall wave from under the whole row, and from two lines a second on its heels.
        this.wave(four ? 'quad' : 'clear', 0.5, row, 1 + lines * 0.3, four ? 0.6 : lines * 0.1);
        if (lines >= 2) {
            this.wave('clear', lines % 2 === 0 ? 0.1 : 0.9, row, 0.6 + lines * 0.18);
            this.sweep(0.3 + lines * 0.17);
        }
        if (lines >= 3) this.stars += 1;
        if (four) {
            this.emit('rise', {
                row: 0, strength: 1, lines, duration: 2.8,
            });
            this.summon();
        }
        if (this.streak >= 2) this.raiseWake(1 - Math.exp(-(this.streak - 1) * 0.3));
        return true;
    }

    onCombo(countOrPayload, detail = {}) {
        if (this.disposed) return false;
        const event = eventArguments(countOrPayload, detail, ['comboCount', 'combo', 'count'], 60);
        if (event.count < 2) return false;
        this.settled = false;
        const growth = 1 - Math.exp(-(event.count - 1) * 0.22);
        this.excite({
            gust: 0.3 + growth * 0.5,
            moon: 0.2 + growth * 0.6,
            shafts: 0.3 + growth * 0.6,
            glow: 0.34 + growth * 0.66,
        });
        this.raiseWake(0.3 + growth * 0.7);
        this.emit('combo', {
            row: 0.1, strength: 0.4 + growth * 0.6, lines: event.count, duration: 1.4,
        });
        this.wave('combo', this.random(), 0.05, 0.7 + growth * 0.9, growth);
        return true;
    }

    onTSpin(detail = {}) {
        if (this.disposed) return false;
        const payload = unwrap(detail);
        const place = boardPlace(payload);
        this.excite({
            gust: 0.45, moon: 0.3, shafts: 0.3, glow: 0.6,
        });
        this.emit('spin', {
            side: place && place.column >= 0.5 ? 1 : -1, row: place?.row ?? 0.3, strength: 0.8, duration: 1.7,
        });
        this.wave('spin', place?.column ?? 0.5, place?.row ?? 0.3, 1.2, 0.3);
        return true;
    }

    onBackToBack() {
        if (this.disposed) return false;
        this.excite({
            moon: 0.5, glow: 0.7, shafts: 0.45,
        });
        this.raiseWake(Math.max(this.wakeTarget, 0.55));
        return true;
    }

    onPerfectClear() {
        if (this.disposed) return false;
        this.settled = false;
        this.excite({
            gust: 0.9, moon: 1, shafts: 1, glow: 1,
        });
        this.emit('rise', {
            row: 0, strength: 1, lines: 4, duration: 3.4,
        });
        this.wave('quad', 0.5, 0.1, 2.4, 1);
        this.wave('quad', 0.5, 0.6, 1.6, 0.7);
        this.sweep(1);
        this.raiseWake(0.85);
        this.stars += 2;
        this.summon(FOREST_STAG_TIMING.hold + 1.6);
        return true;
    }

    onLevelUp() {
        if (this.disposed) return false;
        this.excite({
            gust: 0.6, moon: 0.6, shafts: 0.6, glow: 0.8,
        });
        this.wave('level', 0.5, 0.1, 1.7, 0.5);
        this.sweep(0.75);
        this.stars += 1;
        return true;
    }

    /** The session ended: the wind dies, the forest goes back to sleep, the fireflies sink. */
    onGameOver() {
        if (this.disposed) return false;
        this.wakeTarget = 0;
        this.wakeHold = 0;
        this.streak = 0;
        this.front.active = false;
        // Whatever stag is standing lets go at once.
        if (this.stag.active) {
            this.stag.age = Math.max(this.stag.age, FOREST_STAG_TIMING.gather + this.stag.hold);
        }
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
        // Wakefulness rises quickly to its target, holds while clears keep coming, then ebbs.
        if (this.wakeHold > 0) {
            this.wakeHold = Math.max(0, this.wakeHold - dt);
            this.wake += (this.wakeTarget - this.wake) * (1 - Math.exp(-dt * 3.2));
        } else {
            this.wakeTarget = 0;
            this.wake *= Math.exp(-WAKE_RELEASE_RATE * dt);
            if (this.wake < 0.0005) this.wake = 0;
        }
        if (this.front.active) {
            this.front.age += dt;
            if (this.front.age >= FRONT_SECONDS) this.front.active = false;
        }
        if (this.stag.active) {
            this.stag.age += dt;
            if (this.stag.age >= FOREST_STAG_TIMING.gather + this.stag.hold + FOREST_STAG_TIMING.release) {
                this.stag.active = false;
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
        return this.getFrame();
    }

    getFrame() {
        const { front, stag } = this;
        const travel = clamp(front.age / FRONT_SECONDS, 0, 1);
        let stagFrame = null;
        if (stag.active) {
            const standing = FOREST_STAG_TIMING.gather + stag.hold;
            stagFrame = {
                serial: stag.serial,
                age: stag.age,
                // Bound while it gathers and stands; let go for the release.
                held: stag.age < standing,
                // 0 → 1 as it gathers, 1 while it stands, back to 0 as it lets go.
                presence: stag.age < standing
                    ? clamp(stag.age / FOREST_STAG_TIMING.gather, 0, 1)
                    : clamp(1 - (stag.age - standing) / FOREST_STAG_TIMING.release, 0, 1),
            };
        }
        return {
            ...this.envelopes,
            epoch: this.epoch,
            wake: this.wake,
            // The fireflies only whiten once the forest is well awake.
            heat: clamp((this.wake - 0.5) / 0.42, 0, 1),
            // How far the fireflies have fallen into step, and how fast they keep time.
            sync: clamp(this.wake * 1.2, 0, 1),
            beatRate: 0.3 + this.wake * 0.5,
            streak: this.streak,
            settled: this.settled,
            stars: this.stars,
            stag: stagFrame,
            front: front.active ? {
                // -1.4 .. 1.4 across the view, in the direction of travel.
                position: (travel * 2.8 - 1.4) * front.direction,
                direction: front.direction,
                strength: front.strength * Math.sin(Math.PI * Math.min(1, travel * 1.15)),
            } : null,
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
