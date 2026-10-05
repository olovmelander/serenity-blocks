/**
 * Orbital feedback driven exclusively by simulation seconds. The scene owns
 * rendering and advances this director only while it is visible and running.
 * Events reuse bounded slots; comet contact and staggered launches never use
 * wall-clock timers or allocate render resources.
 */

export const STELLAR_DRIFT_REACTION_LIMITS = Object.freeze({
    Minimal: Object.freeze({ arcs: 3, comets: 1 }),
    Low: Object.freeze({ arcs: 4, comets: 1 }),
    Medium: Object.freeze({ arcs: 6, comets: 2 }),
    High: Object.freeze({ arcs: 8, comets: 3 }),
    Ultra: Object.freeze({ arcs: 10, comets: 3 }),
    Extreme: Object.freeze({ arcs: 12, comets: 4 }),
});

export const STELLAR_DRIFT_COMET_CONTACT = 0.72;

const DECAY_RATES = Object.freeze({
    rim: 1.8,
    aurora: 0.65,
    dust: 2.2,
    stars: 1.3,
    glow: 1.4,
    impact: 3.6,
});

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const EVENT_PRIORITY = Object.freeze({ lock: 0.3, clear: 1, combo: 1.4 });

/** A quick rise and lingering release give feedback shape without global flashes. */
export function stellarDriftEventEnvelope(progress) {
    const phase = Number.isFinite(progress) ? clamp(progress, 0, 1) : 0;
    const attack = clamp(phase / 0.085, 0, 1);
    const release = clamp((1 - phase) / 0.58, 0, 1);
    return attack * attack * (3 - 2 * attack) * release * release * (3 - 2 * release);
}

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

function horizontalOrigin(detail) {
    const viewportX = detail?.viewportOrigin?.x;
    if (Number.isFinite(viewportX)) return clamp(viewportX, 0, 1);
    const pieceX = detail?.piece?.x;
    if (Number.isFinite(pieceX)) return clamp((pieceX + 0.5) / 10, 0, 1);
    return null;
}

function createSlots(count) {
    return Array.from({ length: count }, (_, id) => ({ id, active: false }));
}

export class StellarDriftReactions {
    constructor({ quality = 'High', rng = Math.random } = {}) {
        this.quality = Object.keys(STELLAR_DRIFT_REACTION_LIMITS)
            .find((tier) => tier.toLowerCase() === String(quality).toLowerCase()) || 'High';
        const limits = STELLAR_DRIFT_REACTION_LIMITS[this.quality];
        this.maxArcs = limits.arcs;
        this.maxComets = limits.comets;
        this.maxQueuedEvents = (this.maxArcs + this.maxComets) * 2;
        this.rng = typeof rng === 'function' ? rng : Math.random;
        this.arcSlots = createSlots(this.maxArcs);
        this.cometSlots = createSlots(this.maxComets);
        this.pendingEvents = [];
        this.reset();
    }

    reset() {
        this.time = 0;
        this.serial = 0;
        this.arcCursor = 0;
        this.cometCursor = 0;
        this.pendingEvents.length = 0;
        this.envelopes = Object.fromEntries(Object.keys(DECAY_RATES).map((key) => [key, 0]));
        for (const slots of [this.arcSlots, this.cometSlots]) {
            for (const slot of slots) {
                Object.assign(slot, {
                    active: false,
                    angle: 0,
                    direction: 1,
                    age: 0,
                    duration: 1,
                    strength: 0,
                    seed: 0,
                    kind: 'lock',
                    impacted: false,
                });
            }
        }
    }

    random() {
        const value = Number(this.rng());
        return Number.isFinite(value) ? clamp(value, 0, 1 - Number.EPSILON) : 0.5;
    }

    excite(values) {
        for (const key of Object.keys(DECAY_RATES)) {
            const value = Number.isFinite(values[key]) ? clamp(values[key], 0, 1) : 0;
            this.envelopes[key] = Math.max(this.envelopes[key], value);
        }
    }

    makeEvent(kind, strength, duration, detail, direction = null) {
        const originX = horizontalOrigin(detail);
        const angle = originX === null
            ? this.random() * TAU
            : Math.PI * (1 - originX) + (this.random() - 0.5) * 0.12;
        const event = {
            angle: ((angle % TAU) + TAU) % TAU,
            direction: direction ?? (this.serial % 2 === 0 ? 1 : -1),
            age: 0,
            duration,
            strength,
            seed: this.random(),
            kind,
            impacted: false,
        };
        this.serial += 1;
        return event;
    }

    activate(type, event) {
        const slots = type === 'arc' ? this.arcSlots : this.cometSlots;
        const cursorKey = type === 'arc' ? 'arcCursor' : 'cometCursor';
        let selected = -1;
        let leastRetention = Infinity;
        for (let step = 0; step < slots.length; step++) {
            const index = (this[cursorKey] + step) % slots.length;
            const slot = slots[index];
            if (!slot.active) {
                selected = index;
                break;
            }
            const retention = (1 - slot.age / slot.duration) * slot.strength * EVENT_PRIORITY[slot.kind];
            if (retention < leastRetention) {
                leastRetention = retention;
                selected = index;
            }
        }
        // Rapid stacking must not erase the clear/combo choreography it just earned.
        // Equal-priority ties still rotate through the fixed pool.
        const candidate = slots[selected];
        if (event.kind === 'lock' && candidate.active
            && leastRetention > event.strength * EVENT_PRIORITY.lock) return false;
        Object.assign(slots[selected], event, { active: true });
        this[cursorKey] = (selected + 1) % slots.length;
        return true;
    }

    schedule(type, event, delay = 0) {
        if (delay <= 0) {
            this.activate(type, event);
        } else if (this.pendingEvents.length < this.maxQueuedEvents) {
            this.pendingEvents.push({ type, event, at: this.time + delay });
            this.pendingEvents.sort((a, b) => a.at - b.at);
        }
    }

    onPieceLock(detail = {}) {
        const payload = unwrap(detail);
        this.excite({
            rim: 0.18, dust: 0.23, stars: 0.12, glow: 0.07,
        });
        this.schedule('arc', this.makeEvent('lock', 0.32, 0.9, payload));
        return true;
    }

    onLineClear(countOrPayload = 1, detail = {}) {
        const event = eventArguments(countOrPayload, detail, ['lineCount', 'lines', 'linesCleared', 'count'], 4);
        const lines = event.count;
        if (lines === 0) return false;
        this.excite({
            rim: 0.2 + lines * 0.1,
            dust: 0.18 + lines * 0.1,
            stars: 0.18 + lines * 0.085,
            glow: 0.08 + lines * 0.065,
            aurora: 0.06 + lines * 0.05,
        });
        const strength = 0.36 + lines * 0.09;
        this.schedule('arc', this.makeEvent('clear', strength, 2.2, event.detail, 1));
        if (lines === 4) {
            this.schedule('arc', this.makeEvent('clear', strength * 0.88, 2.2, event.detail, -1), 0.08);
        }
        return true;
    }

    onCombo(countOrPayload, detail = {}) {
        const event = eventArguments(countOrPayload, detail, ['comboCount', 'combo', 'count'], 60);
        if (event.count < 2) return false;
        const growth = 1 - Math.exp(-(event.count - 1) * 0.18);
        this.excite({
            rim: 0.24 + growth * 0.45,
            aurora: 0.22 + growth * 0.66,
            dust: 0.2 + growth * 0.48,
            stars: 0.26 + growth * 0.45,
            glow: 0.12 + growth * 0.4,
        });
        for (let index = 0; index < 2; index++) {
            const direction = index === 0 ? 1 : -1;
            const arc = this.makeEvent('combo', 0.44 + growth * 0.42, 2.5, event.detail, direction);
            this.schedule('arc', arc, index * 0.14);
        }
        const count = Math.min(this.maxComets, 1 + Math.floor(growth * 2.95));
        for (let index = 0; index < count; index++) {
            const comet = this.makeEvent('combo', 0.4 + growth * 0.48, 2.15 + index * 0.18, event.detail);
            this.schedule('comet', comet, index * 0.24);
        }
        return true;
    }

    advance(delta) {
        for (const [key, rate] of Object.entries(DECAY_RATES)) {
            this.envelopes[key] *= Math.exp(-rate * delta);
        }
        for (const slots of [this.arcSlots, this.cometSlots]) {
            for (const slot of slots) {
                if (!slot.active) continue;
                slot.age += delta;
                if (slot.age >= slot.duration) {
                    slot.active = false;
                    slot.strength = 0;
                }
            }
        }
        this.time += delta;
    }

    nextContactTime() {
        let next = Infinity;
        for (const comet of this.cometSlots) {
            if (!comet.active || comet.impacted) continue;
            const remaining = Math.max(0, comet.duration * STELLAR_DRIFT_COMET_CONTACT - comet.age);
            next = Math.min(next, this.time + remaining);
        }
        return next;
    }

    contactComets() {
        for (const comet of this.cometSlots) {
            if (!comet.active || comet.impacted) continue;
            if (comet.age + 1e-10 < comet.duration * STELLAR_DRIFT_COMET_CONTACT) continue;
            comet.impacted = true;
            this.excite({
                impact: comet.strength * 0.7,
                rim: comet.strength * 0.62,
                dust: comet.strength * 0.52,
                glow: comet.strength * 0.24,
            });
        }
    }

    update(dt) {
        if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return this.getFrame();
        const target = this.time + dt;
        while (this.time < target) {
            const launch = this.pendingEvents[0]?.at ?? Infinity;
            const contact = this.nextContactTime();
            const boundary = Math.min(target, launch, contact);
            this.advance(Math.max(0, boundary - this.time));
            this.contactComets();
            while (this.pendingEvents.length > 0 && this.pendingEvents[0].at <= this.time + 1e-10) {
                const scheduled = this.pendingEvents.shift();
                this.activate(scheduled.type, scheduled.event);
            }
        }
        return this.getFrame();
    }

    getFrame() {
        const snapshots = (slots) => slots.filter((slot) => slot.active).map((slot) => ({
            ...slot,
            progress: clamp(slot.age / slot.duration, 0, 1),
            energy: slot.strength * stellarDriftEventEnvelope(slot.age / slot.duration),
        }));
        return {
            ...this.envelopes,
            arcs: snapshots(this.arcSlots),
            comets: snapshots(this.cometSlots).map((comet) => ({
                ...comet,
                impactProgress: STELLAR_DRIFT_COMET_CONTACT,
                impactAge: Math.max(0, comet.age - comet.duration * STELLAR_DRIFT_COMET_CONTACT),
            })),
        };
    }

    get frame() {
        return this.getFrame();
    }

    dispose() {
        this.reset();
    }
}
