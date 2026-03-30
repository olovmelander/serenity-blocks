import { BaseTheme } from '../base-theme.js';
import { COSMIC_CHIMES_TETROMINOS } from './cosmic-chimes-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

/**
 * Cosmic Chimes Theme - Ethereal space bells and cosmic harmony
 *
 * Performance-optimized version with:
 * - Reduced particle counts
 * - Effect throttling/cooldowns
 * - Simplified animations
 * - Active effect limiting
 */
export default class CosmicChimesTheme extends BaseTheme {
    constructor() {
        super('cosmic-chimes');
        this.eventUnsubscribers = [];
        this.chimeInstances = [];
        this.effectTimeouts = new Set();

        // Performance: Track active effects to limit DOM elements
        this.activeEffectCount = 0;
        this.maxActiveEffects = 15;

        // Performance: Cooldowns to prevent effect spam
        this.lastEffectTime = 0;
        this.effectCooldown = 100; // ms between effects

        // Graphics quality presets - OPTIMIZED for performance
        this.qualityChangeHandler = null;
        this.currentQuality = 'High';
        this.qualityPresets = {
            Minimal: {
                dustParticleCount: 15,
                dustAnimationEnabled: false,
                chimeCount: 3,
                chimeAnimationEnabled: false,
                nebulaAnimationEnabled: false,
                enableComboEffects: false,
                chimeStrikeCount: 0,
                soundWaveCount: 0,
                stardustBurstCount: 0,
                auroraWaveCount: 0,
                harmonicPulseCount: 0,
                sparkleCount: 0,
                maxActiveEffects: 5,
            },
            Low: {
                dustParticleCount: 25,
                dustAnimationEnabled: true,
                chimeCount: 5,
                chimeAnimationEnabled: true,
                nebulaAnimationEnabled: true,
                enableComboEffects: true,
                chimeStrikeCount: 1,
                soundWaveCount: 1,
                stardustBurstCount: 4,
                auroraWaveCount: 1,
                harmonicPulseCount: 2,
                sparkleCount: 3,
                maxActiveEffects: 8,
            },
            Medium: {
                dustParticleCount: 35,
                dustAnimationEnabled: true,
                chimeCount: 7,
                chimeAnimationEnabled: true,
                nebulaAnimationEnabled: true,
                enableComboEffects: true,
                chimeStrikeCount: 2,
                soundWaveCount: 1,
                stardustBurstCount: 6,
                auroraWaveCount: 1,
                harmonicPulseCount: 3,
                sparkleCount: 5,
                maxActiveEffects: 12,
            },
            High: {
                dustParticleCount: 45,
                dustAnimationEnabled: true,
                chimeCount: 9,
                chimeAnimationEnabled: true,
                nebulaAnimationEnabled: true,
                enableComboEffects: true,
                chimeStrikeCount: 2,
                soundWaveCount: 2,
                stardustBurstCount: 8,
                auroraWaveCount: 2,
                harmonicPulseCount: 4,
                sparkleCount: 6,
                maxActiveEffects: 15,
            },
            Ultra: {
                dustParticleCount: 60,
                dustAnimationEnabled: true,
                chimeCount: 12,
                chimeAnimationEnabled: true,
                nebulaAnimationEnabled: true,
                enableComboEffects: true,
                chimeStrikeCount: 3,
                soundWaveCount: 2,
                stardustBurstCount: 10,
                auroraWaveCount: 2,
                harmonicPulseCount: 5,
                sparkleCount: 8,
                maxActiveEffects: 20,
            },
            Extreme: {
                dustParticleCount: 80,
                dustAnimationEnabled: true,
                chimeCount: 14,
                chimeAnimationEnabled: true,
                nebulaAnimationEnabled: true,
                enableComboEffects: true,
                chimeStrikeCount: 3,
                soundWaveCount: 3,
                stardustBurstCount: 14,
                auroraWaveCount: 3,
                harmonicPulseCount: 6,
                sparkleCount: 10,
                maxActiveEffects: 25,
            },
        };

        this.activePreset = this.qualityPresets.High;
    }

    scheduleEffectTimeout(callback, delayMs = 0) {
        const timeoutId = window.setTimeout(() => {
            this.effectTimeouts.delete(timeoutId);
            callback();
        }, delayMs);
        this.effectTimeouts.add(timeoutId);
        return timeoutId;
    }

    clearEffectTimeouts() {
        this.effectTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
        this.effectTimeouts.clear();
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            quality = 'High';
        }
        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];
        this.maxActiveEffects = this.activePreset.maxActiveEffects;

        if (this.isActive) {
            this.refreshQualityDependentElements();
        }
        console.log(`🔔 [CosmicChimesTheme] Applied ${quality} quality preset`);
    }

    refreshQualityDependentElements() {
        const dustContainer = document.getElementById('space-dust');
        if (dustContainer) {
            dustContainer.innerHTML = '';
            this.createSpaceDust();
        }

        const chimesContainer = document.getElementById('chimes');
        if (chimesContainer) {
            chimesContainer.innerHTML = '';
            this.chimeInstances = [];
            this.createChimes();
        }

        this.updateNebulaSettings();
    }

    setupQualityListener() {
        this.teardownQualityListener();
        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (!newQuality || newQuality === this.currentQuality) return;
            this.applyQualityPreset(newQuality);
        };
        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    teardownQualityListener() {
        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }
    }

    async createScene() {
        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();
        this.createSpaceDust();
        this.createChimes();
        this.updateNebulaSettings();
        this.setupEventListeners();
    }

    createSpaceDust() {
        const dustContainer = document.getElementById('space-dust');
        if (!dustContainer) return;

        const preset = this.activePreset;
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < preset.dustParticleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'dust-particle';

            if (!preset.dustAnimationEnabled) {
                particle.style.animation = 'none';
                particle.style.opacity = '0.3';
            }

            const size = Math.random() * 2 + 1;
            particle.style.cssText = `
                width: ${size}px;
                height: ${size}px;
                --x-start: ${Math.random() * 100}vw;
                --y-start: ${Math.random() * 100}vh;
                --x-end: ${Math.random() * 100}vw;
                --y-end: ${Math.random() * 100}vh;
                animation-delay: -${Math.random() * 30}s;
            `;

            fragment.appendChild(particle);
        }

        dustContainer.appendChild(fragment);
        this.registerContainer(dustContainer);
    }

    createChimes() {
        const chimesContainer = document.getElementById('chimes');
        if (!chimesContainer) return;

        const preset = this.activePreset;
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < preset.chimeCount; i++) {
            const chime = document.createElement('div');
            chime.className = 'chime';

            if (!preset.chimeAnimationEnabled) {
                chime.style.animation = 'none';
                chime.style.opacity = '0.6';
            }

            chime.style.cssText = `
                left: ${5 + Math.random() * 90}%;
                top: ${-10 + Math.random() * 30}%;
                --r-start: ${Math.random() * 10 - 5}deg;
                --r-end: ${Math.random() * 10 - 5}deg;
                animation-delay: -${Math.random() * 12}s;
            `;

            fragment.appendChild(chime);
            this.chimeInstances.push(chime);
        }

        chimesContainer.appendChild(fragment);
        this.registerContainer(chimesContainer);
    }

    updateNebulaSettings() {
        const nebula = document.querySelector('.chime-nebula');
        if (!nebula) return;
        if (!this.activePreset.nebulaAnimationEnabled) {
            nebula.style.animation = 'none';
        }
    }

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock();
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    // Performance: Check if we can spawn more effects
    canSpawnEffect() {
        const now = performance.now();
        if (now - this.lastEffectTime < this.effectCooldown) return false;
        if (this.activeEffectCount >= this.maxActiveEffects) return false;
        this.lastEffectTime = now;
        return true;
    }

    // Performance: Track effect lifecycle
    trackEffect(element, duration) {
        this.activeEffectCount++;
        this.scheduleEffectTimeout(() => {
            element.remove();
            this.activeEffectCount = Math.max(0, this.activeEffectCount - 1);
        }, duration);
    }

    getEdgePosition(zone = 'any') {
        const regions = {
            topLeft: {
                xMin: 0, xMax: 25, yMin: 0, yMax: 30,
            },
            topRight: {
                xMin: 75, xMax: 100, yMin: 0, yMax: 30,
            },
            bottomLeft: {
                xMin: 0, xMax: 25, yMin: 70, yMax: 100,
            },
            bottomRight: {
                xMin: 75, xMax: 100, yMin: 70, yMax: 100,
            },
            leftSide: {
                xMin: 0, xMax: 20, yMin: 20, yMax: 80,
            },
            rightSide: {
                xMin: 80, xMax: 100, yMin: 20, yMax: 80,
            },
            topEdge: {
                xMin: 20, xMax: 80, yMin: 0, yMax: 15,
            },
            bottomEdge: {
                xMin: 20, xMax: 80, yMin: 85, yMax: 100,
            },
        };

        let availableRegions;
        switch (zone) {
        case 'corner': availableRegions = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']; break;
        case 'top': availableRegions = ['topLeft', 'topRight', 'topEdge']; break;
        case 'side': availableRegions = ['leftSide', 'rightSide']; break;
        default: availableRegions = Object.keys(regions);
        }

        const regionName = availableRegions[Math.floor(Math.random() * availableRegions.length)];
        const region = regions[regionName];
        return {
            x: region.xMin + Math.random() * (region.xMax - region.xMin),
            y: region.yMin + Math.random() * (region.yMax - region.yMin),
        };
    }

    // ===== COMBO EFFECT HANDLERS =====

    onLineClear(lineCount) {
        const preset = this.activePreset;
        if (!preset.enableComboEffects) return;

        if (lineCount >= 4) {
            this.triggerChimeStrike(3);
            this.triggerSoundWaves(2);
            this.triggerAuroraWave(2);
            this.triggerStardustBurst(10);
            this.pulseNebula(1.4);
        } else if (lineCount >= 2) {
            this.triggerChimeStrike(lineCount);
            this.triggerSoundWaves(1);
            this.triggerStardustBurst(lineCount * 3);
            this.pulseNebula(1.2);
        } else {
            this.triggerHarmonicPulse(2);
            this.triggerCelestialSparkles(4);
            this.pulseNebula(1.05);
        }
    }

    onCombo(comboCount) {
        const preset = this.activePreset;
        if (!preset.enableComboEffects) return;

        if (comboCount >= 8) {
            this.triggerChimeStrike(3);
            this.triggerSoundWaves(2);
            this.triggerAuroraWave(2);
            this.triggerStardustBurst(12);
            this.triggerHarmonicPulse(4);
        } else if (comboCount >= 5) {
            this.triggerChimeStrike(2);
            this.triggerSoundWaves(2);
            this.triggerAuroraWave(1);
            this.triggerStardustBurst(8);
        } else if (comboCount >= 3) {
            this.triggerChimeStrike(1);
            this.triggerHarmonicPulse(3);
            this.triggerCelestialSparkles(5);
            this.pulseNebula(1.2);
        } else {
            this.triggerHarmonicPulse(2);
            this.triggerCelestialSparkles(4);
        }
    }

    onPieceLock() {
        const preset = this.activePreset;
        if (!preset.enableComboEffects) return;

        // Only sometimes trigger visual feedback (30% chance)
        if (Math.random() < 0.3) {
            if (Math.random() < 0.5) {
                this.triggerPieceLockChime();
            } else {
                this.triggerPieceLockSparkle();
            }
        }
    }

    // ===== OPTIMIZED COMBO EFFECTS =====

    triggerChimeStrike(count = 2) {
        const container = document.getElementById('cosmic-chimes-effects');
        if (!container) return;

        const preset = this.activePreset;
        const actualCount = Math.min(count, preset.chimeStrikeCount);

        for (let i = 0; i < actualCount; i++) {
            if (!this.canSpawnEffect()) continue;

            this.scheduleEffectTimeout(() => {
                if (!this.isActive) return;

                const strike = document.createElement('div');
                strike.className = 'chime-strike';

                const pos = this.getEdgePosition('top');
                strike.style.left = `${pos.x}%`;
                strike.style.top = `${Math.min(pos.y, 25)}%`;

                container.appendChild(strike);
                this.trackEffect(strike, 1000);

                // Make a real chime glow
                if (this.chimeInstances.length > 0) {
                    const randomChime = this.chimeInstances[Math.floor(Math.random() * this.chimeInstances.length)];
                    randomChime.classList.add('chime-struck');
                    this.scheduleEffectTimeout(() => randomChime.classList.remove('chime-struck'), 600);
                }
            }, i * 180);
        }
    }

    triggerSoundWaves(count = 2) {
        const container = document.getElementById('cosmic-chimes-effects');
        if (!container) return;

        const preset = this.activePreset;
        const actualCount = Math.min(count, preset.soundWaveCount);

        for (let i = 0; i < actualCount; i++) {
            if (!this.canSpawnEffect()) continue;

            this.scheduleEffectTimeout(() => {
                if (!this.isActive) return;

                // Simplified: single ring instead of 3 nested
                const wave = document.createElement('div');
                wave.className = 'sound-wave-simple';

                const pos = this.getEdgePosition('any');
                wave.style.left = `${pos.x}%`;
                wave.style.top = `${pos.y}%`;

                container.appendChild(wave);
                this.trackEffect(wave, 1200);
            }, i * 200);
        }
    }

    triggerStardustBurst(count = 10) {
        const container = document.getElementById('cosmic-chimes-effects');
        if (!container) return;

        const preset = this.activePreset;
        const actualCount = Math.min(count, preset.stardustBurstCount);
        const colors = ['#abf4ff', '#ffe3a8', '#d8c1ff', '#98ffd8', '#ff9fd5'];

        // Batch create for performance
        const fragment = document.createDocumentFragment();
        const particles = [];

        for (let i = 0; i < actualCount; i++) {
            const dust = document.createElement('div');
            dust.className = 'stardust-burst';

            const pos = this.getEdgePosition('any');
            dust.style.cssText = `
                left: ${pos.x}%;
                top: ${pos.y}%;
                --drift-x: ${(Math.random() - 0.5) * 80}px;
                --drift-y: ${(Math.random() - 0.5) * 80}px;
                --dust-color: ${colors[Math.floor(Math.random() * colors.length)]};
                animation-delay: ${i * 30}ms;
            `;

            fragment.appendChild(dust);
            particles.push(dust);
            this.activeEffectCount++;
        }

        container.appendChild(fragment);

        // Batch cleanup
        this.scheduleEffectTimeout(() => {
            particles.forEach((p) => p.remove());
            this.activeEffectCount = Math.max(0, this.activeEffectCount - particles.length);
        }, 1200);
    }

    triggerAuroraWave(count = 2) {
        const container = document.getElementById('cosmic-chimes-effects');
        if (!container) return;

        const preset = this.activePreset;
        const actualCount = Math.min(count, preset.auroraWaveCount);

        for (let i = 0; i < actualCount; i++) {
            if (!this.canSpawnEffect()) continue;

            this.scheduleEffectTimeout(() => {
                if (!this.isActive) return;

                const aurora = document.createElement('div');
                aurora.className = 'aurora-wave';
                aurora.style.top = `${20 + Math.random() * 60}%`;
                aurora.style.setProperty('--wave-hue', `${180 + Math.random() * 120}`);

                container.appendChild(aurora);
                this.trackEffect(aurora, 2000);
            }, i * 250);
        }
    }

    triggerHarmonicPulse(count = 3) {
        const container = document.getElementById('cosmic-chimes-effects');
        if (!container) return;

        const preset = this.activePreset;
        const actualCount = Math.min(count, preset.harmonicPulseCount);

        for (let i = 0; i < actualCount; i++) {
            if (!this.canSpawnEffect()) continue;

            this.scheduleEffectTimeout(() => {
                if (!this.isActive) return;

                const pulse = document.createElement('div');
                pulse.className = 'harmonic-pulse';

                const pos = this.getEdgePosition('any');
                pulse.style.left = `${pos.x}%`;
                pulse.style.top = `${pos.y}%`;

                container.appendChild(pulse);
                this.trackEffect(pulse, 800);
            }, i * 80);
        }
    }

    triggerCelestialSparkles(count = 6) {
        const container = document.getElementById('cosmic-chimes-effects');
        if (!container) return;

        const preset = this.activePreset;
        const actualCount = Math.min(count, preset.sparkleCount);

        // Batch create
        const fragment = document.createDocumentFragment();
        const sparkles = [];

        for (let i = 0; i < actualCount; i++) {
            const sparkle = document.createElement('div');
            sparkle.className = 'celestial-sparkle';

            const pos = this.getEdgePosition('any');
            sparkle.style.cssText = `
                left: ${pos.x}%;
                top: ${pos.y}%;
                animation-delay: ${i * 40}ms;
            `;

            fragment.appendChild(sparkle);
            sparkles.push(sparkle);
            this.activeEffectCount++;
        }

        container.appendChild(fragment);

        this.scheduleEffectTimeout(() => {
            sparkles.forEach((s) => s.remove());
            this.activeEffectCount = Math.max(0, this.activeEffectCount - sparkles.length);
        }, 500);
    }

    pulseNebula(intensity = 1.1) {
        const nebula = document.querySelector('.chime-nebula');
        if (!nebula) return;

        // Use CSS class for better performance
        nebula.style.setProperty('--pulse-intensity', intensity);
        nebula.classList.add('nebula-pulse');

        this.scheduleEffectTimeout(() => {
            nebula.classList.remove('nebula-pulse');
        }, 400);
    }

    // ===== PIECE LOCK EFFECTS =====

    triggerPieceLockChime() {
        if (!this.canSpawnEffect()) return;

        const container = document.getElementById('cosmic-chimes-effects');
        if (!container) return;

        const chime = document.createElement('div');
        chime.className = 'piece-lock-chime';

        const pos = this.getEdgePosition('top');
        chime.style.left = `${pos.x}%`;
        chime.style.top = `${Math.min(pos.y, 20)}%`;

        container.appendChild(chime);
        this.trackEffect(chime, 400);
    }

    triggerPieceLockSparkle() {
        if (!this.canSpawnEffect()) return;

        const container = document.getElementById('cosmic-chimes-effects');
        if (!container) return;

        const sparkle = document.createElement('div');
        sparkle.className = 'piece-lock-sparkle-chimes';

        const pos = this.getEdgePosition('any');
        sparkle.style.left = `${pos.x}%`;
        sparkle.style.top = `${pos.y}%`;

        container.appendChild(sparkle);
        this.trackEffect(sparkle, 350);
    }

    getTetrominoConfig() {
        return COSMIC_CHIMES_TETROMINOS;
    }

    stop() {
        if (!this.isActive) return;
        this.clearEffectTimeouts();
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];
        this.teardownQualityListener();

        // Clear all active effects
        const container = document.getElementById('cosmic-chimes-effects');
        if (container) container.innerHTML = '';
        this.activeEffectCount = 0;

        super.stop();
    }

    cleanup() {
        this.stop();
        this.chimeInstances = [];
        super.cleanup();
    }
}
