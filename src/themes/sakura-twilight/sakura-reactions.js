/**
 * Sakura Twilight — how the garden answers the game.
 *
 * A pure, seconds-based director: gameplay events become a small set of decaying light and
 * wind envelopes, a few slow states (the petal stream, the constellations, the foxfire)
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
 *                 moon and shooting stars
 *   combo/streak  a stream of petals winds around the board and climbs; foxfire lights
 *                 one flame at a time around it, and the constellations draw themselves in
 *   t-spin        a spiral flourish beside the board and a shooting star
 *   level up      sky lanterns rise from the shore
 *   perfect clear all of it at once, and the fallen petals rise from the ground
 *   game over     the wind dies and the lanterns burn low
 */

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
const VORTEX_HOLD_SECONDS = 2.8;
const VORTEX_RELEASE_RATE = 0.8;
const SKY_HOLD_SECONDS = 6;
const FOXFIRE_HOLD_SECONDS = 4.5;
const FRONT_SECONDS = 2.0;
const MAX_FOXFIRE = 14;
const BOARD_COLUMNS = 10;
const BOARD_VISIBLE_ROWS = 20;
const BOARD_HIDDEN_ROWS = 4;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const ease = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

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
        this.envelopes = Object.fromEntries(ENVELOPE_KEYS.map((key) => [key, 0]));
        this.front = {
            active: false, age: 0, direction: 1, strength: 0,
        };
        this.reset();
    }

    reset() {
        this.disposed = false;
        this.time = 0;
        this.cursor = 0;
        this.serial = 0;
        this.streak = 0;
        this.clearedSinceLock = false;
        this.pendingDrop = 0;
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
        for (const key of ENVELOPE_KEYS) this.envelopes[key] = 0;
        Object.assign(this.front, {
            active: false, age: 0, direction: 1, strength: 0,
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
    } = {}) {
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

    sweep(strength) {
        this.sweeps += 1;
        Object.assign(this.front, {
            active: true, age: 0, direction: this.sweeps % 2 === 0 ? -1 : 1, strength: clamp(strength, 0, 1),
        });
    }

    raiseVortex(level) {
        this.vortexTarget = Math.max(this.vortexTarget, clamp(level, 0, 1));
        this.vortexHold = VORTEX_HOLD_SECONDS;
    }

    /** Trace the constellations out to `level` (0..1) and keep them lit for a while. */
    traceSky(level) {
        this.constellationTarget = Math.max(this.constellationTarget, clamp(level, 0, 1));
        this.skyHold = SKY_HOLD_SECONDS;
    }

    /** Light `count` spirit flames around the board. */
    kindle(count) {
        this.foxfireTarget = Math.max(this.foxfireTarget, clamp(count, 0, MAX_FOXFIRE));
        this.foxfireHold = FOXFIRE_HOLD_SECONDS;
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
        // A lock that follows a lock without a clear between them ends the streak.
        if (!this.clearedSinceLock) this.streak = 0;
        this.clearedSinceLock = false;
        // Play has resumed: the lanterns come back up.
        this.hushTarget = 0;
        const place = boardPlace(payload);
        const drop = this.pendingDrop;
        this.pendingDrop = 0;
        const strength = 0.26 + drop * 0.5;
        this.excite({
            gust: 0.1 + drop * 0.16, glow: 0.07 + drop * 0.1, lanterns: 0.2 + drop * 0.3, moon: drop * 0.2,
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
        if (!this.clearedSinceLock) {
            this.clearedSinceLock = true;
            this.streak += 1;
        }
        const row = clearedRow(event.detail) ?? boardPlace(event.detail)?.row ?? 0.2;
        const four = lines >= 4;
        this.excite({
            gust: 0.3 + lines * 0.14,
            glow: 0.2 + lines * 0.12 + (four ? 0.3 : 0),
            lanterns: 0.4 + lines * 0.15,
            moon: lines * 0.12 + (four ? 0.5 : 0),
        });
        const strength = 0.36 + lines * 0.16;
        // Petals are blown out of both sides of the board at the height of the cleared rows.
        this.emit('clear', {
            side: -1, row, strength, lines, duration: 1.5 + lines * 0.12,
        });
        this.emit('clear', {
            side: 1, row, strength, lines, duration: 1.5 + lines * 0.12,
        });
        // Every cleared line sets a lantern afloat.
        this.emit('floats', {
            row, strength: lines / 4, lines, duration: 0.6,
        });
        if (lines >= 2) this.sweep(0.3 + lines * 0.17);
        if (lines >= 3) this.emit('star', { strength: 0.7, duration: 1.4 });
        if (four) {
            this.emit('shower', {
                row: 1, strength: 1, lines, duration: 2.8,
            });
            this.emit('star', { strength: 1, duration: 1.6 });
            this.traceSky(0.5);
        }
        if (this.streak >= 2) {
            const growth = 1 - Math.exp(-(this.streak - 1) * 0.3);
            this.raiseVortex(growth);
            this.traceSky(growth);
            this.kindle(this.streak - 1);
        }
        return true;
    }

    onCombo(countOrPayload, detail = {}) {
        if (this.disposed) return false;
        const event = eventArguments(countOrPayload, detail, ['comboCount', 'combo', 'count'], 60);
        if (event.count < 2) return false;
        const growth = 1 - Math.exp(-(event.count - 1) * 0.22);
        this.excite({
            gust: 0.4 + growth * 0.5,
            glow: 0.3 + growth * 0.65,
            lanterns: 0.4 + growth * 0.6,
            moon: 0.2 + growth * 0.7,
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
        this.excite({
            gust: 0.5, glow: 0.55, lanterns: 0.6, moon: 0.4,
        });
        this.emit('spin', {
            side: place && place.column >= 0.5 ? 1 : -1, row: place?.row ?? 0.3, strength: 0.8, duration: 1.7,
        });
        this.emit('star', { strength: 0.8, duration: 1.4 });
        return true;
    }

    onBackToBack() {
        if (this.disposed) return false;
        this.excite({ glow: 0.7, lanterns: 0.9, moon: 0.5 });
        this.raiseVortex(Math.max(this.vortexTarget, 0.55));
        this.traceSky(Math.max(this.constellationTarget, 0.4));
        return true;
    }

    onPerfectClear() {
        if (this.disposed) return false;
        this.excite({
            gust: 0.9, glow: 1, lanterns: 1, moon: 1,
        });
        this.emit('shower', {
            row: 1, strength: 1, lines: 4, duration: 3.4,
        });
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
        this.streak = 0;
        this.front.active = false;
        this.hushTarget = 1;
    }

    update(dt) {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return this.getFrame();
        this.time += dt;
        for (const key of ENVELOPE_KEYS) {
            this.envelopes[key] *= Math.exp(-DECAY_RATES[key] * dt);
            if (this.envelopes[key] < 0.00001) this.envelopes[key] = 0;
        }
        // The stream rises quickly to its target, holds while clears keep coming, then unwinds.
        if (this.vortexHold > 0) {
            this.vortexHold = Math.max(0, this.vortexHold - dt);
            this.vortex = ease(this.vortex, this.vortexTarget, 3.2, dt);
        } else {
            this.vortexTarget = 0;
            this.vortex *= Math.exp(-VORTEX_RELEASE_RATE * dt);
            if (this.vortex < 0.0005) this.vortex = 0;
        }
        // The figures are drawn a stroke at a time and fade long after the last clear.
        if (this.skyHold > 0) {
            this.skyHold = Math.max(0, this.skyHold - dt);
            this.constellation = ease(this.constellation, this.constellationTarget, 1.1, dt);
        } else {
            this.constellationTarget = 0;
            this.constellation *= Math.exp(-0.22 * dt);
            if (this.constellation < 0.0005) this.constellation = 0;
        }
        if (this.foxfireHold > 0) {
            this.foxfireHold = Math.max(0, this.foxfireHold - dt);
            this.foxfire = ease(this.foxfire, this.foxfireTarget, 5, dt);
        } else {
            this.foxfireTarget = 0;
            this.foxfire *= Math.exp(-1.1 * dt);
            if (this.foxfire < 0.01) this.foxfire = 0;
        }
        this.spirit = ease(this.spirit, Math.max(this.vortex, this.constellation * 0.7), 1.4, dt);
        if (this.spirit < 0.0005) this.spirit = 0;
        this.hush = ease(this.hush, this.hushTarget, this.hushTarget > this.hush ? 0.8 : 2.4, dt);
        if (this.hush < 0.0005) this.hush = 0;
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
            front: front.active ? {
                // -1.4 .. 1.4 across the view, in the direction of travel.
                position: (travel * 2.8 - 1.4) * front.direction,
                direction: front.direction,
                strength: front.strength * Math.sin(Math.PI * Math.min(1, travel * 1.15)),
            } : null,
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
