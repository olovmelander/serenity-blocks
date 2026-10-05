/**
 * Autumn feedback driven by simulation seconds. Events only reuse bounded data
 * slots: the scene owns its prebuilt leaf meshes and advances this while visible.
 * getFrame() returns independent snapshots so callers cannot mutate the director.
 */

export const FALL_REACTION_LIMITS = Object.freeze({
    Minimal: 4,
    Low: 6,
    Medium: 8,
    High: 12,
    Ultra: 14,
    Extreme: 16,
});

const DECAY_RATES = Object.freeze({
    gust: 1.6,
    warmth: 0.8,
    shafts: 1.05,
    glow: 1.4,
    vortex: 0.9,
});
const ENVELOPE_KEYS = Object.keys(DECAY_RATES);
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

function horizontalOrigin(detail) {
    const viewportX = detail?.viewportOrigin?.x;
    if (Number.isFinite(viewportX)) return clamp(viewportX, 0, 1);
    const pieceX = detail?.piece?.x;
    if (Number.isFinite(pieceX)) return clamp((pieceX + 0.5) / 10, 0, 1);
    return null;
}

export class FallReactions {
    constructor({ quality = 'High', rng = Math.random } = {}) {
        const requestedQuality = typeof quality === 'string' ? quality.toLowerCase() : '';
        this.quality = Object.keys(FALL_REACTION_LIMITS)
            .find((tier) => tier.toLowerCase() === requestedQuality)
            || (requestedQuality === 'med' ? 'Medium' : 'High');
        this.maxBursts = FALL_REACTION_LIMITS[this.quality];
        this.rng = typeof rng === 'function' ? rng : Math.random;
        this.burstSlots = Array.from({ length: this.maxBursts }, (_, id) => ({ id }));
        this.envelopes = Object.fromEntries(ENVELOPE_KEYS.map((key) => [key, 0]));
        this.reset();
    }

    reset() {
        this.disposed = false;
        this.time = 0;
        this.cursor = 0;
        this.serial = 0;
        for (const key of ENVELOPE_KEYS) this.envelopes[key] = 0;
        for (const slot of this.burstSlots) {
            Object.assign(slot, {
                active: false,
                age: 0,
                duration: 1,
                strength: 0,
                seed: 0,
                side: -1,
                kind: 'lock',
                originX: 0.5,
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

    spawnBurst(kind, strength, duration, detail, forcedSide = null) {
        let selected = -1;
        let oldestProgress = -1;
        for (let step = 0; step < this.maxBursts; step++) {
            const index = (this.cursor + step) % this.maxBursts;
            const slot = this.burstSlots[index];
            if (!slot.active) {
                selected = index;
                break;
            }
            const progress = slot.age / slot.duration;
            if (progress > oldestProgress) {
                oldestProgress = progress;
                selected = index;
            }
        }
        const originX = horizontalOrigin(detail);
        let side = forcedSide;
        if (side === null) {
            side = this.serial % 2 === 0 ? -1 : 1;
            if (originX !== null) side = originX < 0.5 ? -1 : 1;
        }
        Object.assign(this.burstSlots[selected], {
            active: true,
            age: 0,
            duration,
            strength,
            seed: this.random(),
            side,
            kind,
            originX: originX ?? 0.5,
        });
        this.serial += 1;
        this.cursor = (selected + 1) % this.maxBursts;
    }

    onPieceLock(detail = {}) {
        if (this.disposed) return false;
        this.excite({ gust: 0.14, warmth: 0.025, glow: 0.055 });
        this.spawnBurst('lock', 0.24, 0.82, unwrap(detail));
        return true;
    }

    onLineClear(countOrPayload = 1, detail = {}) {
        if (this.disposed) return false;
        const event = eventArguments(countOrPayload, detail, ['lineCount', 'lines', 'linesCleared', 'count'], 4);
        const lines = event.count;
        if (lines === 0) return false;
        this.excite({
            gust: 0.24 + lines * 0.105,
            warmth: 0.13 + lines * 0.09,
            shafts: 0.12 + lines * 0.13,
            glow: 0.16 + lines * 0.1,
            vortex: lines * 0.035,
        });
        const pairs = lines > 2 ? 2 : 1;
        const strength = 0.4 + lines * 0.095;
        for (let pair = 0; pair < pairs; pair++) {
            // Every clear lifts leaves from both outer edges. Seed and lifetime
            // offsets give a travelling gold wave without an unbounded queue.
            this.spawnBurst('clear', strength, 1.9 + pair * 0.18, event.detail, -1);
            this.spawnBurst('clear', strength, 2.02 + pair * 0.18, event.detail, 1);
        }
        return true;
    }

    onCombo(countOrPayload, detail = {}) {
        if (this.disposed) return false;
        const event = eventArguments(countOrPayload, detail, ['comboCount', 'combo', 'count'], 60);
        if (event.count < 2) return false;
        const growth = 1 - Math.exp(-(event.count - 1) * 0.2);
        this.excite({
            gust: 0.45 + growth * 0.5,
            warmth: 0.27 + growth * 0.63,
            shafts: 0.34 + growth * 0.6,
            glow: 0.3 + growth * 0.63,
            vortex: 0.24 + growth * 0.7,
        });
        const pairs = Math.min(Math.floor(this.maxBursts / 2), 1 + Math.floor(growth * 2.95));
        const strength = 0.62 + growth * 0.34;
        for (let pair = 0; pair < pairs; pair++) {
            this.spawnBurst('combo', strength, 2.65 + pair * 0.2, event.detail, -1);
            this.spawnBurst('combo', strength, 2.79 + pair * 0.2, event.detail, 1);
        }
        return true;
    }

    update(dt) {
        if (this.disposed || !Number.isFinite(dt) || dt <= 0) return this.getFrame();
        this.time += dt;
        for (const key of ENVELOPE_KEYS) {
            this.envelopes[key] *= Math.exp(-DECAY_RATES[key] * dt);
            if (this.envelopes[key] < 0.00001) this.envelopes[key] = 0;
        }
        for (const slot of this.burstSlots) {
            if (!slot.active) continue;
            slot.age = Math.min(slot.duration, slot.age + dt);
            if (slot.age >= slot.duration) {
                slot.active = false;
                slot.strength = 0;
            }
        }
        return this.getFrame();
    }

    getFrame() {
        return {
            ...this.envelopes,
            bursts: this.burstSlots.filter((slot) => slot.active).map((slot) => ({
                ...slot,
                progress: clamp(slot.age / slot.duration, 0, 1),
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
