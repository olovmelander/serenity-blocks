/**
 * Moonlit Forest reactive FX controller.
 *
 * Centralizes event-driven intensity state and deterministic envelopes so
 * visual reactions can be driven by renderer systems instead of direct DOM writes.
 */

export class MoonlitForestFXController {
    constructor() {
        this.reset();
    }

    reset() {
        this.time = 0;
        this.linePulse = 0;
        this.comboEnergy = 0;
        this.pieceLockPulse = 0;
        this.mushroomPulse = 0;
        this.moonbeamPulse = 0;
        this.wildlifePulse = 0;
        this.atmospherePulse = 0;
        this.pendingBursts = {
            fireflies: 0,
            spores: 0,
            enchantedLeaves: 0,
            wisps: 0,
            sparkles: 0,
            runes: 0,
            mist: 0,
            shootingStars: 0,
            auroraStrength: 0,
        };
    }

    step(delta) {
        if (!Number.isFinite(delta) || delta <= 0) return;
        this.time += delta;
        this.linePulse = Math.max(0, this.linePulse - (delta * 1.6));
        this.comboEnergy = Math.max(0, this.comboEnergy - (delta * 0.55));
        this.pieceLockPulse = Math.max(0, this.pieceLockPulse - (delta * 3.0));
        this.mushroomPulse = Math.max(0, this.mushroomPulse - (delta * 2.0));
        this.moonbeamPulse = Math.max(0, this.moonbeamPulse - (delta * 1.8));
        this.wildlifePulse = Math.max(0, this.wildlifePulse - (delta * 1.4));
        this.atmospherePulse = Math.max(0, this.atmospherePulse - (delta * 0.9));
    }

    queueBurst(name, amount) {
        if (!(name in this.pendingBursts)) return;
        const numeric = Number(amount);
        if (!Number.isFinite(numeric) || numeric <= 0) return;
        this.pendingBursts[name] += Math.floor(numeric);
    }

    setAuroraStrength(strength) {
        const numeric = Number(strength);
        if (!Number.isFinite(numeric) || numeric <= 0) return;
        this.pendingBursts.auroraStrength = Math.max(this.pendingBursts.auroraStrength, numeric);
    }

    onLineClear(lineCount, qualityConfig) {
        const lines = Math.max(1, Number(lineCount) || 1);
        const comboEffects = qualityConfig?.comboEffects ?? {};

        this.linePulse = Math.min(1.5, this.linePulse + (lines * 0.3));

        const fireflyMultiplier = comboEffects.fireflyMultiplier ?? 0;
        const sporesMultiplier = comboEffects.sporesMultiplier ?? 0;
        const fireflyCount = lines >= 2 ? Math.ceil(lines * 3 * fireflyMultiplier) : 0;
        const sporesCount = Math.ceil(lines * 4 * sporesMultiplier);
        const enchantedLeafCount = lines >= 3 ? lines * 2 : 0;

        this.mushroomPulse = Math.min(2.8, this.mushroomPulse + (lines * 0.5));
        this.moonbeamPulse = Math.min(2.5, this.moonbeamPulse + (lines * 0.42));
        this.atmospherePulse = Math.min(2.4, this.atmospherePulse + (lines * 0.28));

        this.queueBurst('fireflies', fireflyCount);
        this.queueBurst('spores', sporesCount);
        this.queueBurst('enchantedLeaves', enchantedLeafCount);

        return {
            mushroomIntensity: lines,
            moonbeamIntensity: lines,
            fireflyCount,
            sporesCount,
            enchantedLeafCount,
        };
    }

    onCombo(comboCount, qualityConfig) {
        const combo = Math.max(1, Number(comboCount) || 1);
        const comboEffects = qualityConfig?.comboEffects ?? {};

        this.comboEnergy = Math.min(2.5, this.comboEnergy + (combo * 0.22));

        const wispsMultiplier = comboEffects.wispsMultiplier ?? 0;
        const wispCount = Math.ceil(combo * 2 * wispsMultiplier);
        const sparkleCount = Math.min(combo * 2, 10);
        const runesCount = combo >= 4 ? Math.min(combo * 2, 8) : 0;
        const enableAurora = combo >= 3 && comboEffects.auroraEnabled === true;
        const enableShootingStars = combo >= 5 && comboEffects.shootingStarsEnabled === true;
        const shootingStarCount = enableShootingStars ? Math.min(combo, 6) : 0;

        this.wildlifePulse = Math.min(2.7, this.wildlifePulse + (combo * 0.32));
        this.mushroomPulse = Math.min(2.8, this.mushroomPulse + (combo * 0.12));
        this.moonbeamPulse = Math.min(2.5, this.moonbeamPulse + (combo * 0.16));
        this.atmospherePulse = Math.min(2.5, this.atmospherePulse + (combo * 0.3));

        this.queueBurst('wisps', wispCount);
        this.queueBurst('sparkles', sparkleCount);
        this.queueBurst('runes', runesCount);
        this.queueBurst('shootingStars', shootingStarCount);
        if (enableAurora) {
            this.setAuroraStrength(combo);
        }

        return {
            combo,
            wispCount,
            enableAurora,
            enableShootingStars,
            sparkleCount,
        };
    }

    onPieceLock(sparkleRoll = Math.random(), mistRoll = Math.random()) {
        this.pieceLockPulse = Math.min(1.0, this.pieceLockPulse + 0.4);
        this.mushroomPulse = Math.min(2.8, this.mushroomPulse + 0.15);
        this.moonbeamPulse = Math.min(2.5, this.moonbeamPulse + 0.1);
        this.atmospherePulse = Math.min(2.5, this.atmospherePulse + 0.16);

        const sparkleCount = sparkleRoll < 0.3 ? 1 : 0;
        const mistCount = mistRoll < 0.2 ? 1 : 0;

        this.queueBurst('sparkles', sparkleCount);
        this.queueBurst('mist', mistCount);

        return {
            sparkleCount,
            mistCount,
        };
    }

    drainParticleBursts() {
        const bursts = { ...this.pendingBursts };
        this.pendingBursts.fireflies = 0;
        this.pendingBursts.spores = 0;
        this.pendingBursts.enchantedLeaves = 0;
        this.pendingBursts.wisps = 0;
        this.pendingBursts.sparkles = 0;
        this.pendingBursts.runes = 0;
        this.pendingBursts.mist = 0;
        this.pendingBursts.shootingStars = 0;
        this.pendingBursts.auroraStrength = 0;
        return bursts;
    }

    getSignals() {
        return {
            linePulse: this.linePulse,
            comboEnergy: this.comboEnergy,
            pieceLockPulse: this.pieceLockPulse,
            mushroomPulse: this.mushroomPulse,
            moonbeamPulse: this.moonbeamPulse,
            wildlifePulse: this.wildlifePulse,
            atmospherePulse: this.atmospherePulse,
            time: this.time,
        };
    }
}
