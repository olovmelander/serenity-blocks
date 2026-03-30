/**
 * Astral Weave reactive FX controller.
 *
 * Centralizes gameplay-driven envelopes and burst requests so the renderer can
 * update visual systems deterministically without ad hoc event-side mutations.
 */

export class AstralWeaveFXController {
    constructor() {
        this.reset();
    }

    reset() {
        this.time = 0;
        this.linePulse = 0;
        this.comboEnergy = 0;
        this.pieceLockPulse = 0;
        this.centerLensing = 0;
        this.braidVelocity = 0;
        this.starScintillation = 0;
        this.cameraImpulse = 0;
        this.pendingBursts = {
            flowShards: 0,
            dustPops: 0,
            shockwaves: 0,
            constellationFractures: 0,
        };
    }

    step(delta) {
        if (!Number.isFinite(delta) || delta <= 0) return;
        this.time += delta;
        this.linePulse = Math.max(0, this.linePulse - (delta * 1.1));
        this.comboEnergy = Math.max(0, this.comboEnergy - (delta * 0.34));
        this.pieceLockPulse = Math.max(0, this.pieceLockPulse - (delta * 2.35));
        this.centerLensing = Math.max(0, this.centerLensing - (delta * 0.72));
        this.braidVelocity = Math.max(0, this.braidVelocity - (delta * 0.42));
        this.starScintillation = Math.max(0, this.starScintillation - (delta * 0.56));
        this.cameraImpulse = Math.max(0, this.cameraImpulse - (delta * 1.35));
    }

    queueBurst(name, amount) {
        if (!(name in this.pendingBursts)) return;
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) return;
        this.pendingBursts[name] += Math.floor(value);
    }

    onPieceLock() {
        this.pieceLockPulse = Math.min(1.35, this.pieceLockPulse + 0.56);
        this.braidVelocity = Math.min(2.1, this.braidVelocity + 0.24);
        this.starScintillation = Math.min(1.45, this.starScintillation + 0.14);
        this.queueBurst('flowShards', 16);
        this.queueBurst('dustPops', 10);
        return {
            shardCount: 16,
            dustCount: 10,
            shockwaveCount: 0,
            constellationCount: 0,
        };
    }

    onLineClear(lineCount) {
        const lines = Math.max(1, Number(lineCount) || 1);
        this.linePulse = Math.min(2.4, this.linePulse + (lines * 0.46));
        this.centerLensing = Math.min(1.7, this.centerLensing + (lines * 0.22));
        this.braidVelocity = Math.min(2.9, this.braidVelocity + (lines * 0.34));
        this.starScintillation = Math.min(2.05, this.starScintillation + (lines * 0.3));
        this.cameraImpulse = Math.min(2.0, this.cameraImpulse + (lines >= 4 ? 0.82 : 0.26 * lines));

        const flowShards = 28 + (lines * 16);
        const dustPops = 16 + (lines * 10);
        let shockwaves = 0;
        if (lines >= 4) {
            shockwaves = 2;
        } else if (lines >= 2) {
            shockwaves = 1;
        }
        const constellationFractures = lines >= 4 ? 2 : 0;

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
        const combo = Math.max(1, Number(comboCount) || 1);
        this.comboEnergy = Math.min(3.3, this.comboEnergy + (combo * 0.34));
        this.centerLensing = Math.min(2.1, this.centerLensing + (combo * 0.12));
        this.braidVelocity = Math.min(3.0, this.braidVelocity + (combo * 0.26));
        this.starScintillation = Math.min(2.25, this.starScintillation + (combo * 0.22));
        this.cameraImpulse = Math.min(2.2, this.cameraImpulse + (combo >= 4 ? 0.46 : 0.14));

        const flowShards = combo >= 2 ? Math.min(22 + combo * 10, 128) : 0;
        const dustPops = combo >= 2 ? Math.min(14 + combo * 6, 88) : 0;
        const shockwaves = combo >= 3 ? 1 : 0;
        const constellationFractures = combo >= 4 ? 1 + Math.floor((combo - 4) / 3) : 0;

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
        this.pendingBursts.flowShards = 0;
        this.pendingBursts.dustPops = 0;
        this.pendingBursts.shockwaves = 0;
        this.pendingBursts.constellationFractures = 0;
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
        };
    }
}
