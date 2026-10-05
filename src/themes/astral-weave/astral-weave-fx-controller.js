/**
 * Astral Weave's event language: a stitch, a travelling ripple, a bloom crown,
 * and a slower aurora charge. All envelopes use elapsed seconds, never frames.
 */

export const ASTRAL_WEAVE_BURST_LIMITS = Object.freeze({
    flowShards: 160,
    dustPops: 96,
    shockwaves: 3,
    constellationFractures: 3,
});
const BURST_NAMES = Object.keys(ASTRAL_WEAVE_BURST_LIMITS);

const DECAY_RATES = Object.freeze({
    linePulse: 1.45,
    comboEnergy: 0.58,
    pieceLockPulse: 5.6,
    centerLensing: 1.9,
    braidVelocity: 1.1,
    starScintillation: 1.55,
    cameraImpulse: 8,
    weaveCharge: 0.38,
    crownPulse: 1.25,
    eventHue: 0.65,
});
const DECAY_ENTRIES = Object.entries(DECAY_RATES);
const BURST_EXPIRY_SECONDS = 0.4;

function eventCount(value, maximum) {
    const count = Number(value);
    return Number.isFinite(count) ? Math.min(maximum, Math.max(1, Math.floor(count))) : 1;
}

export class AstralWeaveFXController {
    constructor() {
        this.reset();
    }

    reset() {
        this.time = 0;
        Object.keys(DECAY_RATES).forEach((name) => { this[name] = 0; });
        this.lineWaveAge = 1.65;
        this.lineWaveDuration = 1.65;
        this.burstQueuedAt = 0;
        this.hasPendingBursts = false;
        this.pendingBursts = {
            flowShards: 0, dustPops: 0, shockwaves: 0, constellationFractures: 0,
        };
    }

    step(delta) {
        if (!Number.isFinite(delta) || delta <= 0) return;
        this.time += delta;
        for (const [name, rate] of DECAY_ENTRIES) {
            this[name] *= Math.exp(-delta * rate);
            if (this[name] < 0.00001) this[name] = 0;
        }
        this.lineWaveAge = Math.min(this.lineWaveDuration, this.lineWaveAge + delta);
        // One-shot particles are an impact, not a delayed replay after a stall.
        if (this.hasPendingBursts && this.time - this.burstQueuedAt > BURST_EXPIRY_SECONDS) {
            for (const name of BURST_NAMES) this.pendingBursts[name] = 0;
            this.hasPendingBursts = false;
        }
    }

    queueBurst(name, amount) {
        if (!Object.hasOwn(ASTRAL_WEAVE_BURST_LIMITS, name)) return;
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) return;
        const count = Math.floor(value);
        if (count === 0) return;
        this.pendingBursts[name] = Math.min(
            ASTRAL_WEAVE_BURST_LIMITS[name],
            this.pendingBursts[name] + count,
        );
        this.burstQueuedAt = this.time;
        this.hasPendingBursts = true;
    }

    onPieceLock() {
        this.pieceLockPulse = Math.min(0.85, this.pieceLockPulse + 0.38);
        this.braidVelocity = Math.min(1.5, this.braidVelocity + 0.08);
        this.starScintillation = Math.min(1.25, this.starScintillation + 0.08);
        this.weaveCharge = Math.min(1, this.weaveCharge + 0.035);
        this.queueBurst('flowShards', 8);
        this.queueBurst('dustPops', 4);
        return {
            shardCount: 8, dustCount: 4, shockwaveCount: 0, constellationCount: 0,
        };
    }

    onLineClear(lineCount) {
        const lines = eventCount(lineCount, 4);
        const isTetris = lines === 4;
        this.linePulse = Math.min(1.65, this.linePulse + 0.2 + lines * 0.22);
        this.centerLensing = Math.min(0.65, this.centerLensing + lines * 0.08);
        this.braidVelocity = Math.min(1.8, this.braidVelocity + lines * 0.17);
        this.starScintillation = Math.min(1.45, this.starScintillation + lines * 0.16);
        this.cameraImpulse = Math.min(0.2, this.cameraImpulse + (isTetris ? 0.065 : 0.01 * lines));
        this.weaveCharge = Math.min(1, this.weaveCharge + 0.1 + lines * 0.1);
        this.eventHue = Math.max(this.eventHue, isTetris ? 0.88 : 0.2 + lines * 0.08);
        this.lineWaveAge = 0;
        this.lineWaveDuration = isTetris ? 1.85 : 1.65;
        if (isTetris) this.crownPulse = Math.min(1, this.crownPulse + 0.85);

        const flowShards = 16 + lines * 10;
        const dustPops = 8 + lines * 5;
        const shockwaves = 1;
        const constellationFractures = isTetris ? 1 : 0;
        this.queueBurst('flowShards', flowShards);
        this.queueBurst('dustPops', dustPops);
        this.queueBurst('shockwaves', shockwaves);
        this.queueBurst('constellationFractures', constellationFractures);
        return {
            shardCount: flowShards,
            dustCount: dustPops,
            shockwaveCount: shockwaves,
            constellationCount: constellationFractures,
        };
    }

    onCombo(comboCount) {
        const combo = eventCount(comboCount, 12);
        const strongCombo = combo >= 4;
        this.comboEnergy = Math.min(2.4, this.comboEnergy + 0.12 + combo * 0.12);
        this.centerLensing = Math.min(0.65, this.centerLensing + combo * 0.025);
        this.braidVelocity = Math.min(1.8, this.braidVelocity + combo * 0.09);
        this.starScintillation = Math.min(1.45, this.starScintillation + combo * 0.08);
        this.cameraImpulse = Math.min(0.2, this.cameraImpulse + (strongCombo ? 0.035 : 0));
        this.weaveCharge = Math.min(1, this.weaveCharge + 0.1 + combo * 0.075);
        this.eventHue = Math.max(this.eventHue, Math.min(1, 0.3 + combo * 0.06));
        if (strongCombo) this.crownPulse = Math.min(1, this.crownPulse + 0.55 + combo * 0.045);

        const flowShards = combo >= 2 ? Math.min(12 + combo * 6, 72) : 0;
        const dustPops = combo >= 2 ? Math.min(8 + combo * 3, 40) : 0;
        const shockwaves = combo >= 3 ? 1 : 0;
        const constellationFractures = strongCombo ? 1 : 0;
        this.queueBurst('flowShards', flowShards);
        this.queueBurst('dustPops', dustPops);
        this.queueBurst('shockwaves', shockwaves);
        this.queueBurst('constellationFractures', constellationFractures);
        return {
            combo,
            shardCount: flowShards,
            dustCount: dustPops,
            shockwaveCount: shockwaves,
            constellationCount: constellationFractures,
        };
    }

    drainBursts() {
        const bursts = { ...this.pendingBursts };
        for (const name of BURST_NAMES) this.pendingBursts[name] = 0;
        this.hasPendingBursts = false;
        return bursts;
    }

    getSignals() {
        return {
            time: this.time,
            linePulse: this.linePulse,
            comboEnergy: this.comboEnergy,
            pieceLockPulse: this.pieceLockPulse,
            centerLensing: this.centerLensing,
            braidVelocity: this.braidVelocity,
            starScintillation: this.starScintillation,
            cameraImpulse: this.cameraImpulse,
            weaveCharge: this.weaveCharge,
            crownPulse: this.crownPulse,
            stitchPulse: this.pieceLockPulse,
            lineWaveProgress: this.lineWaveAge / this.lineWaveDuration,
            eventHue: this.eventHue,
        };
    }
}
