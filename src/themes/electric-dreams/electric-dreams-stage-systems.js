/* eslint-disable max-classes-per-file */
import * as THREE from 'three';

const DEFAULT_TRACK_META = Object.freeze({
    bpm: 96,
    phraseBeats: 16,
    energyCurve: Object.freeze([0.24, 0.58, 0.92]),
});

const QUALITY_PROFILE = Object.freeze({
    Minimal: Object.freeze({
        ambient: 0.34, halo: 0.36, hero: 0, takeover: 0.38,
    }),
    Low: Object.freeze({
        ambient: 0.46, halo: 0.48, hero: 0, takeover: 0.46,
    }),
    Medium: Object.freeze({
        ambient: 0.68, halo: 0.72, hero: 0, takeover: 0.58,
    }),
    High: Object.freeze({
        ambient: 0.86, halo: 0.9, hero: 0.88, takeover: 0.74,
    }),
    Ultra: Object.freeze({
        ambient: 1.0, halo: 1.0, hero: 1.0, takeover: 0.86,
    }),
    Extreme: Object.freeze({
        ambient: 1.08, halo: 1.08, hero: 1.12, takeover: 1.0,
    }),
});

function clamp01(value) {
    return THREE.MathUtils.clamp(value, 0, 1);
}

function normalizeTrackKey(name) {
    if (typeof name !== 'string') return '';
    return name.replace(/\s+/g, '');
}

function toEnergyCurve(meta) {
    const fallback = DEFAULT_TRACK_META.energyCurve;
    if (!Array.isArray(meta?.energyCurve) || meta.energyCurve.length < 3) {
        return [...fallback];
    }

    return [
        clamp01(Number(meta.energyCurve[0]) || fallback[0]),
        clamp01(Number(meta.energyCurve[1]) || fallback[1]),
        clamp01(Number(meta.energyCurve[2]) || fallback[2]),
    ];
}

export class StageConductor {
    constructor({ audioManager = null, qualityName = 'High' } = {}) {
        this.audioManager = audioManager;
        this.qualityName = qualityName;
        this.profile = QUALITY_PROFILE[qualityName] || QUALITY_PROFILE.High;

        this.trackKey = '';
        this.trackMeta = { ...DEFAULT_TRACK_META };
        this.trackRefreshCooldown = 0;

        this.beatClock = 0;
        this.beatPulse = 0;
        this.barPhase = 0;
        this.phrasePhase = 0;

        this.linesCleared = 0;
        this.maxLevel = 1;
        this.eventEnergy = 0;
        this.microEnergy = 0;
        this.sessionProgress = 0;
        this.actProgress = 0;
        this.actIndex = 1;
        this.fieldTakeover = 0;
        this.boardHaloEnergy = 0;
        this.heroWindow = 0;

        this.bassEnergy = 0;
        this.midEnergy = 0;
        this.trebleEnergy = 0;
        this.overallEnergy = 0;

        this.dominantAccent = new THREE.Color(0x00ffcc);
        this.supportAccent = new THREE.Color(0xff00ff);

        this.channels = {
            beatPulse: 0,
            barPhase: 0,
            phrasePhase: 0,
            bassEnergy: 0,
            midEnergy: 0,
            trebleEnergy: 0,
            overallEnergy: 0,
            actIndex: 1,
            actProgress: 0,
            boardHaloEnergy: 0,
            fieldTakeover: 0,
            heroWindow: 0,
            dominantAccent: this.dominantAccent,
            supportAccent: this.supportAccent,
        };
    }

    setAudioManager(audioManager) {
        this.audioManager = audioManager;
    }

    setQualityName(qualityName = 'High') {
        this.qualityName = qualityName;
        this.profile = QUALITY_PROFILE[qualityName] || QUALITY_PROFILE.High;
    }

    syncTrackMeta(force = false) {
        if (!this.audioManager) return;
        if (!force && this.trackRefreshCooldown > 0) return;

        this.trackRefreshCooldown = 1.5;
        const trackKey = this.audioManager.getActualTrackKey?.()
            || this.audioManager.musicTrack
            || '';
        if (!trackKey) return;
        if (!force && trackKey === this.trackKey) return;

        this.trackKey = trackKey;
        const songs = Array.isArray(this.audioManager.songsData) ? this.audioManager.songsData : [];
        const song = songs.find((entry) => normalizeTrackKey(entry?.name) === trackKey);

        this.trackMeta = {
            bpm: Number(song?.bpm) > 0 ? Number(song.bpm) : DEFAULT_TRACK_META.bpm,
            phraseBeats: Number(song?.phraseBeats) > 0 ? Number(song.phraseBeats) : DEFAULT_TRACK_META.phraseBeats,
            energyCurve: toEnergyCurve(song),
        };
    }

    noteAccent(color, strength = 0.35) {
        if (!color?.isColor) return;
        const mixStrength = THREE.MathUtils.clamp(strength, 0.08, 0.8);
        this.supportAccent.copy(this.dominantAccent);
        this.dominantAccent.lerp(color, mixStrength);
    }

    registerPieceLock() {
        this.eventEnergy = Math.max(this.eventEnergy, 0.18);
        this.microEnergy = Math.max(this.microEnergy, 0.24);
    }

    registerLineClear({ lineCount = 1, level = null, isTetris = false } = {}) {
        this.linesCleared += Math.max(1, lineCount);
        if (Number.isFinite(level)) {
            this.maxLevel = Math.max(this.maxLevel, level);
        }
        this.eventEnergy = Math.max(this.eventEnergy, isTetris ? 0.86 : 0.4 + lineCount * 0.1);
        this.microEnergy = Math.max(this.microEnergy, 0.22 + lineCount * 0.08);
    }

    registerCombo(comboCount = 1) {
        const safeCombo = Math.max(1, comboCount);
        this.eventEnergy = Math.max(
            this.eventEnergy,
            safeCombo >= 7 ? 1 : 0.22 + safeCombo * 0.09,
        );
        this.microEnergy = Math.max(this.microEnergy, 0.2 + safeCombo * 0.05);
    }

    registerLevelUp(level = null) {
        if (Number.isFinite(level)) {
            this.maxLevel = Math.max(this.maxLevel, level);
        } else {
            this.maxLevel += 1;
        }
        this.eventEnergy = Math.max(this.eventEnergy, 0.48);
        this.microEnergy = Math.max(this.microEnergy, 0.28);
    }

    registerMicroEvent(intensity = 0.18) {
        this.microEnergy = Math.max(this.microEnergy, THREE.MathUtils.clamp(intensity, 0.06, 0.4));
    }

    update(delta, fxState = {}) {
        this.trackRefreshCooldown = Math.max(0, this.trackRefreshCooldown - delta);
        this.syncTrackMeta(false);

        const analysis = this.audioManager?.getAudioAnalysis
            ? this.audioManager.getAudioAnalysis(delta)
            : {
                bassEnergy: 0,
                midEnergy: 0,
                trebleEnergy: 0,
                overallEnergy: 0,
                beatDetected: false,
            };

        const bpm = this.trackMeta.bpm || DEFAULT_TRACK_META.bpm;
        const phraseBeats = this.trackMeta.phraseBeats || DEFAULT_TRACK_META.phraseBeats;
        const previousBeatIndex = Math.floor(this.beatClock);
        this.beatClock += delta * (bpm / 60);
        const beatWrapped = Math.floor(this.beatClock) !== previousBeatIndex;

        this.barPhase = (this.beatClock / 4) % 1;
        this.phrasePhase = (this.beatClock / phraseBeats) % 1;
        this.beatPulse *= 0.9 ** (delta * 60);

        const audioBeatStrength = clamp01(
            (analysis.bassEnergy ?? 0) * 0.62
                + (analysis.midEnergy ?? 0) * 0.24
                + (analysis.trebleEnergy ?? 0) * 0.14,
        );
        if (beatWrapped || analysis.beatDetected) {
            this.beatPulse = Math.max(this.beatPulse, 0.52 + audioBeatStrength * 0.4);
        }

        this.bassEnergy += ((analysis.bassEnergy ?? 0) - this.bassEnergy) * 0.1;
        this.midEnergy += ((analysis.midEnergy ?? 0) - this.midEnergy) * 0.1;
        this.trebleEnergy += ((analysis.trebleEnergy ?? 0) - this.trebleEnergy) * 0.1;
        this.overallEnergy += ((analysis.overallEnergy ?? 0) - this.overallEnergy) * 0.08;

        this.eventEnergy *= 0.94 ** (delta * 60);
        this.microEnergy *= 0.9 ** (delta * 60);

        const baseSessionProgress = clamp01(
            (this.linesCleared / 72)
                + Math.max(0, this.maxLevel - 1) * 0.035,
        );
        this.sessionProgress += (baseSessionProgress - this.sessionProgress) * 0.03;

        const shortTermLift = clamp01(
            (fxState.stageHeat ?? 0) * 0.26
                + (fxState.comboPeak ?? 0) * 0.16
                + (fxState.surgeState ?? 0) * 0.22
                + (fxState.lineSurge ?? 0) * 0.16
                + this.eventEnergy * 0.16,
        );

        const targetActProgress = clamp01(this.sessionProgress + shortTermLift);
        this.actProgress += (targetActProgress - this.actProgress) * 0.025;
        if (this.actProgress >= 0.7) {
            this.actIndex = 3;
        } else if (this.actProgress >= 0.25) {
            this.actIndex = 2;
        } else {
            this.actIndex = 1;
        }

        const curve = this.trackMeta.energyCurve || DEFAULT_TRACK_META.energyCurve;
        const actEnergy = curve[Math.max(0, this.actIndex - 1)] || curve[curve.length - 1];
        const heroMoment = clamp01(
            (fxState.surgeState ?? 0)
                + (fxState.lineSurge ?? 0) * ((fxState.lastLineCount ?? 0) >= 4 ? 0.66 : 0.3)
                + (fxState.comboPeak ?? 0) * ((fxState.lastComboCount ?? 0) >= 7 ? 0.68 : 0.26),
        );

        const targetFieldTakeover = clamp01(
            actEnergy * 0.18
                + this.profile.takeover * 0.18
                + (fxState.stageHeat ?? 0) * 0.35
                + heroMoment * 0.55
                + this.beatPulse * 0.04,
        );
        this.fieldTakeover += (targetFieldTakeover - this.fieldTakeover) * 0.05;

        const targetHaloEnergy = clamp01(
            0.16
                + this.profile.halo * 0.16
                + this.actProgress * 0.18
                + this.beatPulse * 0.16
                + this.eventEnergy * 0.18
                + (fxState.lockImpact ?? 0) * 0.12
                + (fxState.lineSurge ?? 0) * 0.18
                + (fxState.comboPeak ?? 0) * 0.12,
        );
        this.boardHaloEnergy += (targetHaloEnergy - this.boardHaloEnergy) * 0.08;

        const targetHeroWindow = clamp01(heroMoment + this.eventEnergy * 0.24);
        this.heroWindow += (targetHeroWindow - this.heroWindow) * 0.08;

        this.channels.beatPulse = this.beatPulse;
        this.channels.barPhase = this.barPhase;
        this.channels.phrasePhase = this.phrasePhase;
        this.channels.bassEnergy = this.bassEnergy;
        this.channels.midEnergy = this.midEnergy;
        this.channels.trebleEnergy = this.trebleEnergy;
        this.channels.overallEnergy = this.overallEnergy;
        this.channels.actIndex = this.actIndex;
        this.channels.actProgress = this.actProgress;
        this.channels.boardHaloEnergy = this.boardHaloEnergy;
        this.channels.fieldTakeover = this.fieldTakeover;
        this.channels.heroWindow = this.heroWindow;
        this.channels.dominantAccent = this.dominantAccent;
        this.channels.supportAccent = this.supportAccent;

        return this.channels;
    }

    debugSetActProgress(progress = 0) {
        const clamped = clamp01(progress);
        this.sessionProgress = clamped;
        this.actProgress = clamped;
        this.linesCleared = Math.round(clamped * 72);
        if (clamped >= 0.7) {
            this.actIndex = 3;
        } else if (clamped >= 0.25) {
            this.actIndex = 2;
        } else {
            this.actIndex = 1;
        }
    }

    reset() {
        this.beatClock = 0;
        this.beatPulse = 0;
        this.barPhase = 0;
        this.phrasePhase = 0;
        this.linesCleared = 0;
        this.maxLevel = 1;
        this.eventEnergy = 0;
        this.microEnergy = 0;
        this.sessionProgress = 0;
        this.actProgress = 0;
        this.actIndex = 1;
        this.fieldTakeover = 0;
        this.boardHaloEnergy = 0;
        this.heroWindow = 0;
        this.bassEnergy = 0;
        this.midEnergy = 0;
        this.trebleEnergy = 0;
        this.overallEnergy = 0;
        this.trackRefreshCooldown = 0;
        this.trackKey = '';
        this.trackMeta = { ...DEFAULT_TRACK_META };
        this.dominantAccent.set(0x00ffcc);
        this.supportAccent.set(0xff00ff);
    }
}

export class BoardHaloController {
    constructor() {
        this.energy = 0;
        this.ringPulse = 0;
        this.secondaryRing = 0;
        this.rowPulse = 0;
        this.takeover = 0;
        this.microTick = 0;
        this.breathPhase = Math.random() * Math.PI * 2;
        this.lineFocusY = 0;
        this.lineFocusHeight = 0.18;
        this.accent = new THREE.Color(0x62f6ff);
        this.support = new THREE.Color(0xff00ff);
    }

    setAccent(primary, secondary = null) {
        if (primary?.isColor) {
            this.accent.lerp(primary, 0.4);
        }
        if (secondary?.isColor) {
            this.support.lerp(secondary, 0.34);
        }
    }

    triggerPieceLock(primary, secondary = null) {
        this.setAccent(primary, secondary);
        this.energy = Math.max(this.energy, 0.34);
        this.ringPulse = Math.max(this.ringPulse, 0.28);
        this.microTick = Math.max(this.microTick, 0.22);
    }

    triggerLineClear({
        primary,
        secondary,
        lineCount = 1,
        bandY = 0,
        bandHeight = 0.18,
        isTetris = false,
        isBackToBack = false,
    } = {}) {
        this.setAccent(primary, secondary);
        this.energy = Math.max(this.energy, isTetris ? 0.92 : 0.44 + lineCount * 0.09);
        this.ringPulse = Math.max(this.ringPulse, isTetris ? 0.88 : 0.34 + lineCount * 0.08);
        let secondaryRing = 0.16;
        if (isBackToBack) {
            secondaryRing = 0.72;
        } else if (isTetris) {
            secondaryRing = 0.54;
        }
        this.secondaryRing = Math.max(this.secondaryRing, secondaryRing);
        this.rowPulse = Math.max(this.rowPulse, isTetris ? 1 : 0.4 + lineCount * 0.12);
        this.lineFocusY = bandY;
        this.lineFocusHeight = bandHeight;
    }

    triggerCombo(primary, secondary = null, comboCount = 1) {
        this.setAccent(primary, secondary);
        this.energy = Math.max(this.energy, comboCount >= 7 ? 0.96 : 0.38 + comboCount * 0.08);
        this.ringPulse = Math.max(this.ringPulse, comboCount >= 7 ? 0.74 : 0.24 + comboCount * 0.06);
        this.secondaryRing = Math.max(this.secondaryRing, comboCount >= 4 ? 0.34 + comboCount * 0.04 : 0.12);
        this.takeover = Math.max(this.takeover, comboCount >= 7 ? 0.94 : 0.3 + comboCount * 0.06);
    }

    triggerMicro(primary, secondary = null, intensity = 0.18) {
        this.setAccent(primary, secondary);
        this.microTick = Math.max(this.microTick, intensity);
        this.energy = Math.max(this.energy, 0.12 + intensity * 0.25);
    }

    triggerLevelUp(primary, secondary = null) {
        this.setAccent(primary, secondary);
        this.energy = Math.max(this.energy, 0.52);
        this.ringPulse = Math.max(this.ringPulse, 0.42);
        this.secondaryRing = Math.max(this.secondaryRing, 0.26);
    }

    update(delta, conductorChannels = {}, fxState = {}) {
        this.energy *= 0.92 ** (delta * 60);
        this.ringPulse *= 0.9 ** (delta * 60);
        this.secondaryRing *= 0.92 ** (delta * 60);
        this.rowPulse *= 0.9 ** (delta * 60);
        this.takeover *= 0.92 ** (delta * 60);
        this.microTick *= 0.88 ** (delta * 60);

        this.breathPhase += delta * (0.65 + (conductorChannels.beatPulse ?? 0) * 0.9);
        this.energy = Math.max(this.energy, conductorChannels.boardHaloEnergy ?? 0);
        this.takeover = Math.max(this.takeover, conductorChannels.fieldTakeover ?? 0);
        this.ringPulse = Math.max(this.ringPulse, (conductorChannels.heroWindow ?? 0) * 0.42);
        this.lineFocusHeight += (0.18 - this.lineFocusHeight) * 0.05;
        this.lineFocusY += ((fxState.lineBandY ?? 0) - this.lineFocusY) * 0.06;

        return {
            energy: this.energy,
            ringPulse: this.ringPulse,
            secondaryRing: this.secondaryRing,
            rowPulse: this.rowPulse,
            takeover: this.takeover,
            microTick: this.microTick,
            breathPhase: this.breathPhase,
            lineFocusY: this.lineFocusY,
            lineFocusHeight: this.lineFocusHeight,
            accent: this.accent,
            support: this.support,
        };
    }

    reset() {
        this.energy = 0;
        this.ringPulse = 0;
        this.secondaryRing = 0;
        this.rowPulse = 0;
        this.takeover = 0;
        this.microTick = 0;
        this.lineFocusY = 0;
        this.lineFocusHeight = 0.18;
        this.accent.set(0x62f6ff);
        this.support.set(0xff00ff);
    }
}

export class ParticleOrchestrator {
    constructor({ qualityName = 'High' } = {}) {
        this.setQualityName(qualityName);
    }

    setQualityName(qualityName = 'High') {
        this.qualityName = qualityName;
        this.profile = QUALITY_PROFILE[qualityName] || QUALITY_PROFILE.High;
    }

    getAmbientDensityMultiplier(conductorChannels = {}, stageHeat = 0, shedLevel = 0) {
        let scale = this.profile.ambient
            * (0.72 + (conductorChannels.actProgress ?? 0) * 0.18)
            * (0.84 + stageHeat * 0.18)
            * (0.92 + (conductorChannels.beatPulse ?? 0) * 0.06);
        if (shedLevel >= 3) scale *= 0.75;
        return THREE.MathUtils.clamp(scale, 0.2, 1.2);
    }

    getHeroParticleScale(conductorChannels = {}, shedLevel = 0) {
        let scale = this.profile.hero
            * (0.92 + (conductorChannels.heroWindow ?? 0) * 0.16)
            * (0.92 + (conductorChannels.actProgress ?? 0) * 0.1);
        if (shedLevel >= 6) scale *= 0.75;
        return THREE.MathUtils.clamp(scale, 0, 1.24);
    }

    getDropletMultiplier(conductorChannels = {}, shedLevel = 0) {
        let scale = 0.94 + (conductorChannels.heroWindow ?? 0) * 0.18;
        if (shedLevel >= 4) scale *= 0.65;
        return THREE.MathUtils.clamp(scale, 0.3, 1.15);
    }

    getComboStreamerMultiplier(conductorChannels = {}, shedLevel = 0) {
        let scale = 0.94 + (conductorChannels.actProgress ?? 0) * 0.08;
        if (shedLevel >= 5) scale *= 0.7;
        return THREE.MathUtils.clamp(scale, 0.4, 1.12);
    }

    shouldAllowSecondaryWakes(shedLevel = 0) {
        return shedLevel < 4;
    }

    shouldShowFarPods(shedLevel = 0) {
        return shedLevel < 2;
    }

    shouldShowSecondaryHalo(shedLevel = 0) {
        return shedLevel < 4;
    }

    getBoardHaloVisibleCount(totalCount, conductorChannels = {}, shedLevel = 0) {
        const scale = this.profile.halo
            * (0.7 + (conductorChannels.boardHaloEnergy ?? 0) * 0.34)
            * (0.92 + (conductorChannels.beatPulse ?? 0) * 0.06);
        const shedScale = shedLevel >= 4 ? 0.72 : 1;
        return Math.max(12, Math.round(totalCount * scale * shedScale));
    }

    getCenterOpenFactor(fxState = {}, conductorChannels = {}) {
        const heroWindow = conductorChannels.heroWindow ?? 0;
        const takeover = conductorChannels.fieldTakeover ?? 0;
        const minorOpen = (fxState.lockImpact ?? 0) * 0.1
            + (fxState.comboCharge ?? 0) * 0.12
            + (fxState.lineSurge ?? 0) * 0.08;
        return THREE.MathUtils.clamp(0.05 + minorOpen + heroWindow * 0.7 + takeover * 0.2, 0.05, 1);
    }
}
