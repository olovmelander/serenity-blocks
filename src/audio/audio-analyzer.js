/**
 * @fileoverview Shared real-time audio analysis for theme reactivity
 * Single media-element source ownership + stable energy/beat extraction.
 */

const DEFAULT_OPTIONS = {
    fftSize: 2048,
    smoothingTimeConstant: 0.8,
    bassRangeHz: [20, 200],
    midRangeHz: [200, 2000],
    trebleRangeHz: [2000, 20000],
    energyAttackRate: 14.0,
    energyReleaseRate: 7.0,
    beatThresholdMultiplier: 1.3,
    beatSpikeMultiplier: 1.2,
    beatCooldownMs: 150,
    beatAverageRate: 4.5,
    beatAbsoluteFloor: 0.12,
    beatOverallFloor: 0.08,
};

const MEDIA_SOURCE_CACHE = new WeakMap();

function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function expSmoothing(current, target, rate, deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
        return current;
    }
    const t = 1 - Math.exp(-Math.max(0, rate) * deltaSeconds);
    return current + (target - current) * t;
}

function smoothEnvelope(current, target, deltaSeconds, attackRate, releaseRate) {
    const rate = target >= current ? attackRate : releaseRate;
    return expSmoothing(current, target, rate, deltaSeconds);
}

function averageRange(byteBuffer, startBin, endBin) {
    if (!byteBuffer || byteBuffer.length === 0) {
        return 0;
    }

    const maxBin = byteBuffer.length - 1;
    const start = Math.max(0, Math.min(maxBin, startBin));
    const end = Math.max(start, Math.min(maxBin, endBin));

    let total = 0;
    for (let i = start; i <= end; i += 1) {
        total += byteBuffer[i];
    }

    const count = end - start + 1;
    return count > 0 ? total / (count * 255) : 0;
}

function toBinRange(sampleRate, fftSize, frequencyBinCount, rangeHz) {
    const [minHz, maxHz] = rangeHz;
    const maxBin = Math.max(0, frequencyBinCount - 1);
    const nyquist = sampleRate * 0.5;
    const binHz = sampleRate / fftSize;
    const rangeStartHz = Math.max(0, Math.min(nyquist, minHz));
    const rangeEndHz = Math.max(rangeStartHz, Math.min(nyquist, maxHz));

    const start = Math.max(0, Math.min(maxBin, Math.floor(rangeStartHz / binHz)));
    const end = Math.max(start, Math.min(maxBin, Math.floor(rangeEndHz / binHz)));
    return { start, end };
}

function getOrCreateMediaSourceNode(audioContext, audioElement) {
    const cached = MEDIA_SOURCE_CACHE.get(audioElement);
    if (cached?.audioContext === audioContext && cached.sourceNode) {
        return cached.sourceNode;
    }

    if (cached?.audioContext && cached.audioContext !== audioContext) {
        return null;
    }

    const sourceNode = audioContext.createMediaElementSource(audioElement);
    MEDIA_SOURCE_CACHE.set(audioElement, { audioContext, sourceNode });
    return sourceNode;
}

export class AudioAnalyzer {
    constructor(audioContext, audioElement, options = {}) {
        if (!audioContext) {
            throw new Error('AudioAnalyzer requires an AudioContext');
        }
        if (!audioElement) {
            throw new Error('AudioAnalyzer requires an HTMLAudioElement');
        }

        this.audioContext = audioContext;
        this.audioElement = audioElement;
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.disposed = false;

        this.analyserNode = this.audioContext.createAnalyser();
        this.analyserNode.fftSize = this.options.fftSize;
        this.analyserNode.smoothingTimeConstant = this.options.smoothingTimeConstant;

        this.frequencyData = new Uint8Array(this.analyserNode.frequencyBinCount);
        this.timeDomainData = new Uint8Array(this.analyserNode.fftSize);

        this.bandBins = {
            bass: toBinRange(
                this.audioContext.sampleRate,
                this.analyserNode.fftSize,
                this.analyserNode.frequencyBinCount,
                this.options.bassRangeHz,
            ),
            mid: toBinRange(
                this.audioContext.sampleRate,
                this.analyserNode.fftSize,
                this.analyserNode.frequencyBinCount,
                this.options.midRangeHz,
            ),
            treble: toBinRange(
                this.audioContext.sampleRate,
                this.analyserNode.fftSize,
                this.analyserNode.frequencyBinCount,
                this.options.trebleRangeHz,
            ),
        };

        this.bassEnergy = 0;
        this.midEnergy = 0;
        this.trebleEnergy = 0;
        this.overallEnergy = 0;
        this.previousBassEnergy = 0;
        this.bassAverage = 0;
        this.beatDetected = false;
        this.elapsedMs = 0;
        this.lastBeatMs = -Infinity;

        this.snapshot = {
            bassEnergy: 0,
            midEnergy: 0,
            trebleEnergy: 0,
            overallEnergy: 0,
            beatDetected: false,
        };

        this.mediaSourceNode = getOrCreateMediaSourceNode(this.audioContext, this.audioElement);
        if (!this.mediaSourceNode) {
            throw new Error(
                'Audio element already bound to a different AudioContext; cannot create analyzer',
            );
        }

        this.mediaSourceNode.connect(this.analyserNode);
        this.analyserNode.connect(this.audioContext.destination);
    }

    decayEnergies(deltaSeconds) {
        this.bassEnergy = smoothEnvelope(
            this.bassEnergy,
            0,
            deltaSeconds,
            this.options.energyAttackRate,
            this.options.energyReleaseRate,
        );
        this.midEnergy = smoothEnvelope(
            this.midEnergy,
            0,
            deltaSeconds,
            this.options.energyAttackRate,
            this.options.energyReleaseRate,
        );
        this.trebleEnergy = smoothEnvelope(
            this.trebleEnergy,
            0,
            deltaSeconds,
            this.options.energyAttackRate,
            this.options.energyReleaseRate,
        );
        this.overallEnergy = smoothEnvelope(
            this.overallEnergy,
            0,
            deltaSeconds,
            this.options.energyAttackRate,
            this.options.energyReleaseRate,
        );
    }

    update(deltaTime = 1 / 60) {
        if (this.disposed || !this.analyserNode) {
            return this.getSnapshot();
        }

        const deltaSeconds = Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0;
        this.elapsedMs += deltaSeconds * 1000;

        const isPlaying = Boolean(
            this.audioElement
            && !this.audioElement.paused
            && !this.audioElement.ended,
        );

        if (!isPlaying) {
            this.beatDetected = false;
            this.decayEnergies(deltaSeconds);
            return this.getSnapshot();
        }

        this.analyserNode.getByteFrequencyData(this.frequencyData);
        this.analyserNode.getByteTimeDomainData(this.timeDomainData);

        const bassRaw = averageRange(
            this.frequencyData,
            this.bandBins.bass.start,
            this.bandBins.bass.end,
        );
        const midRaw = averageRange(
            this.frequencyData,
            this.bandBins.mid.start,
            this.bandBins.mid.end,
        );
        const trebleRaw = averageRange(
            this.frequencyData,
            this.bandBins.treble.start,
            this.bandBins.treble.end,
        );
        const overallRaw = averageRange(this.frequencyData, 0, this.frequencyData.length - 1);

        this.previousBassEnergy = this.bassEnergy;
        this.bassEnergy = smoothEnvelope(
            this.bassEnergy,
            bassRaw,
            deltaSeconds,
            this.options.energyAttackRate,
            this.options.energyReleaseRate,
        );
        this.midEnergy = smoothEnvelope(
            this.midEnergy,
            midRaw,
            deltaSeconds,
            this.options.energyAttackRate,
            this.options.energyReleaseRate,
        );
        this.trebleEnergy = smoothEnvelope(
            this.trebleEnergy,
            trebleRaw,
            deltaSeconds,
            this.options.energyAttackRate,
            this.options.energyReleaseRate,
        );
        this.overallEnergy = smoothEnvelope(
            this.overallEnergy,
            overallRaw,
            deltaSeconds,
            this.options.energyAttackRate,
            this.options.energyReleaseRate,
        );

        this.bassAverage = expSmoothing(
            this.bassAverage,
            bassRaw,
            this.options.beatAverageRate,
            deltaSeconds,
        );

        const adaptiveThreshold = Math.max(
            this.options.beatAbsoluteFloor,
            this.bassAverage * this.options.beatThresholdMultiplier,
            this.previousBassEnergy * this.options.beatSpikeMultiplier,
        );
        const cooldownElapsed = this.elapsedMs - this.lastBeatMs;
        const hasCooldown = cooldownElapsed >= this.options.beatCooldownMs;

        this.beatDetected = Boolean(
            hasCooldown
            && bassRaw > adaptiveThreshold
            && this.overallEnergy > this.options.beatOverallFloor,
        );

        if (this.beatDetected) {
            this.lastBeatMs = this.elapsedMs;
        }

        return this.getSnapshot();
    }

    getSnapshot() {
        this.snapshot.bassEnergy = this.getBassEnergy();
        this.snapshot.midEnergy = this.getMidEnergy();
        this.snapshot.trebleEnergy = this.getTrebleEnergy();
        this.snapshot.overallEnergy = this.getOverallEnergy();
        this.snapshot.beatDetected = this.getBeatDetected();
        return this.snapshot;
    }

    getBassEnergy() {
        return clamp01(this.bassEnergy);
    }

    getMidEnergy() {
        return clamp01(this.midEnergy);
    }

    getTrebleEnergy() {
        return clamp01(this.trebleEnergy);
    }

    getOverallEnergy() {
        return clamp01(this.overallEnergy);
    }

    getBeatDetected() {
        return this.beatDetected === true;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;

        try {
            if (this.mediaSourceNode && this.analyserNode) {
                this.mediaSourceNode.disconnect(this.analyserNode);
            }
        } catch (error) {
            // Ignore graph disconnect errors during teardown.
        }

        try {
            this.analyserNode?.disconnect?.();
        } catch (error) {
            // Ignore graph disconnect errors during teardown.
        }

        this.mediaSourceNode = null;
        this.analyserNode = null;
        this.frequencyData = null;
        this.timeDomainData = null;
        this.audioContext = null;
        this.audioElement = null;
    }
}
