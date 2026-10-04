/**
 * Simulation-time surf feedback shared by the Waves scene and its isolated bench.
 * No renderer, event bus or wall-clock timers: the owner advances this only when
 * the theme is rendering. Slots and delayed impacts stay within a quality budget.
 */

export const WAVES_REACTION_LIMITS = Object.freeze({
    Minimal: 4,
    Low: 6,
    Medium: 8,
    High: 12,
    Ultra: 14,
    Extreme: 16,
});

const DECAY_RATES = Object.freeze({
    pulse: 2.4,
    foam: 1.35,
    spray: 2.0,
    shafts: 1.15,
});

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function eventCount(value, maximum) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? clamp(Math.floor(number), 0, maximum) : 0;
}

function horizontalOrigin(detail) {
    const viewportX = detail?.viewportOrigin?.x;
    if (Number.isFinite(viewportX)) return clamp(viewportX, 0, 1);
    const pieceX = detail?.piece?.x;
    if (Number.isFinite(pieceX)) return clamp((pieceX + 0.5) / 10, 0, 1);
    return null;
}

export class WavesReactions {
    constructor({ quality = 'High', rng = Math.random } = {}) {
        this.quality = Object.keys(WAVES_REACTION_LIMITS)
            .find((tier) => tier.toLowerCase() === String(quality).toLowerCase()) || 'High';
        this.maxImpacts = WAVES_REACTION_LIMITS[this.quality];
        this.maxQueuedImpacts = this.maxImpacts * 2;
        this.rng = rng;
        this.impactSlots = Array.from({ length: this.maxImpacts }, (_, id) => ({ id, active: false }));
        this.pendingImpacts = [];
        this.reset();
    }

    reset() {
        this.time = 0;
        this.cursor = 0;
        this.serial = 0;
        this.recentAngles = [];
        this.pendingImpacts.length = 0;
        this.envelopes = {
            pulse: 0, foam: 0, spray: 0, shafts: 0,
        };
        this.surge = {
            age: 0, duration: 1.6, peak: 0, pendingPeak: 0,
        };
        for (const slot of this.impactSlots) {
            Object.assign(slot, {
                active: false,
                angle: 0,
                z: -12,
                age: 0,
                duration: 0,
                strength: 0,
                seed: 0,
                kind: 'lock',
            });
        }
    }

    random() {
        const value = Number(this.rng());
        return Number.isFinite(value) ? clamp(value, 0, 1 - Number.EPSILON) : 0.5;
    }

    excite(values) {
        for (const key of Object.keys(DECAY_RATES)) {
            this.envelopes[key] = Math.max(this.envelopes[key], clamp(values[key] || 0, 0, 1));
        }
    }

    makeImpact(strength, duration, kind, detail) {
        const originX = horizontalOrigin(detail);
        let side = this.serial % 2;
        // Looking down +Z makes world +X the left wall on screen.
        if (originX !== null) side = originX < 0.5 ? 0 : 1;
        let offset = (this.random() - 0.5) * 1.1;
        let angle = side * Math.PI + offset;
        if (this.recentAngles.some((previous) => Math.abs(Math.sin((angle - previous) / 2)) < 0.16)) {
            offset = clamp(offset + (this.serial % 2 ? -0.4 : 0.4), -0.8, 0.8);
            angle = side * Math.PI + offset;
        }
        this.recentAngles.push(angle);
        if (this.recentAngles.length > 2) this.recentAngles.shift();
        this.serial += 1;
        // All impacts are ahead of the camera (-25), on the visible outer walls.
        // Close lock splashes read at the edge; clear/combo splashes reach farther.
        const z = kind === 'lock' ? -12 + this.random() * 19 : -10 + this.random() * 35;
        return {
            angle, z, age: 0, duration, strength, seed: this.random(), kind,
        };
    }

    activateImpact(impact) {
        let index = -1;
        let oldestAge = -1;
        for (let step = 0; step < this.maxImpacts; step++) {
            const candidate = (this.cursor + step) % this.maxImpacts;
            const slot = this.impactSlots[candidate];
            if (!slot.active) {
                index = candidate;
                break;
            }
            const normalizedAge = slot.age / slot.duration;
            if (normalizedAge > oldestAge) {
                oldestAge = normalizedAge;
                index = candidate;
            }
        }
        Object.assign(this.impactSlots[index], impact, { active: true });
        this.cursor = (index + 1) % this.maxImpacts;
    }

    spawnImpacts(count, strength, duration, kind, detail) {
        for (let index = 0; index < count; index++) {
            const impact = this.makeImpact(strength, duration, kind, detail);
            if (index === 0) {
                this.activateImpact(impact);
            } else if (this.pendingImpacts.length < this.maxQueuedImpacts) {
                this.pendingImpacts.push({ at: this.time + index * 0.055, impact });
            }
        }
        this.pendingImpacts.sort((a, b) => a.at - b.at);
    }

    startSurge(strength) {
        const peak = clamp(strength, 0, 1);
        if (this.surge.peak > 0 && this.surge.age > 0) {
            // Let the visible crest finish travelling. One coalesced successor
            // starts at its zero-amplitude boundary instead of popping the wall.
            this.surge.pendingPeak = Math.max(this.surge.pendingPeak, peak);
            return;
        }
        this.surge.age = 0;
        this.surge.peak = Math.max(this.surge.peak, peak);
    }

    onPieceLock(detail = {}) {
        this.excite({ pulse: 0.16, foam: 0.08, spray: 0.18 });
        this.spawnImpacts(1, 0.45, 0.72, 'lock', detail);
        return true;
    }

    onLineClear(count = 1, detail = {}) {
        const lines = eventCount(count, 4);
        if (lines === 0) return false;
        this.excite({
            pulse: 0.18 + lines * 0.1,
            foam: 0.15 + lines * 0.115,
            spray: 0.2 + lines * 0.14,
            shafts: lines * 0.055,
        });
        this.startSurge(0.28 + lines * 0.16);
        this.spawnImpacts(lines * 2, 0.52 + lines * 0.075, 0.95, 'clear', detail);
        return true;
    }

    onCombo(count, detail = {}) {
        const combo = eventCount(count, 60);
        if (combo < 2) return false;
        const growth = 1 - Math.exp(-(combo - 1) * 0.2);
        this.excite({
            pulse: 0.24 + growth * 0.44,
            foam: 0.13 + growth * 0.6,
            spray: 0.28 + growth * 0.57,
            shafts: 0.2 + growth * 0.7,
        });
        this.startSurge(0.32 + growth * 0.65);
        this.spawnImpacts(2 + Math.floor(growth * 3), 0.55 + growth * 0.35, 1.12, 'combo', detail);
        return true;
    }

    advance(delta) {
        for (const [key, rate] of Object.entries(DECAY_RATES)) {
            this.envelopes[key] *= Math.exp(-rate * delta);
            if (this.envelopes[key] < 0.00001) this.envelopes[key] = 0;
        }
        if (this.surge.peak > 0) {
            const remaining = this.surge.duration - this.surge.age;
            if (delta < remaining) {
                this.surge.age += delta;
            } else {
                this.surge.peak = this.surge.pendingPeak;
                this.surge.pendingPeak = 0;
                this.surge.age = Math.min(this.surge.duration, Math.max(0, delta - remaining));
                if (this.surge.age >= this.surge.duration) this.surge.peak = 0;
                if (this.surge.peak === 0) this.surge.age = this.surge.duration;
            }
        }
        for (const slot of this.impactSlots) {
            if (!slot.active) continue;
            slot.age += delta;
            if (slot.age >= slot.duration) {
                slot.active = false;
                slot.strength = 0;
            }
        }
        this.time += delta;
    }

    update(dt) {
        const delta = Number(dt);
        if (!Number.isFinite(delta) || delta <= 0) return this.getFrame();
        const target = this.time + delta;
        // Advance to each queued impact's simulation time before spawning it.
        // This makes a 30 Hz frame and several 144 Hz frames yield the same result.
        while (this.pendingImpacts.length > 0 && this.pendingImpacts[0].at <= target) {
            const scheduled = this.pendingImpacts.shift();
            this.advance(Math.max(0, scheduled.at - this.time));
            this.activateImpact(scheduled.impact);
        }
        this.advance(Math.max(0, target - this.time));
        return this.getFrame();
    }

    getFrame() {
        const phase = clamp(this.surge.age / this.surge.duration, 0, 1);
        return {
            ...this.envelopes,
            surgeStrength: this.surge.peak * Math.sin(phase * Math.PI),
            surgeZ: -18 + phase * 60,
            impacts: this.impactSlots.filter((slot) => slot.active).map((slot) => ({
                ...slot,
                progress: slot.age / slot.duration,
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
