import { BaseTheme } from '../base-theme.js';
import { KOI_POND_TETROMINOS } from './koi-pond-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

/**
 * Koi Pond Theme - A serene aquatic sanctuary (Top-Down View)
 *
 * Features:
 * - Gracefully swimming koi fish viewed from above
 * - Floating lily pads with gentle bobbing
 * - Dynamic water ripples following the fish
 * - Shimmering water surface with light reflections
 * - Cherry blossom petals floating on surface
 *
 * Theme-integrated combo effects (all top-down perspective):
 * - Ripple impacts spreading outward
 * - Koi fish darting/swirling excitedly
 * - Lily pad wobbles from water disturbance
 * - Cherry blossom petal scatter
 * - Water droplet ring impacts
 * - Light glints dancing on water surface
 * - Swirling water currents
 *
 * Quality Presets: Minimal, Low, Medium, High, Ultra, Extreme
 */
export default class KoiPondTheme extends BaseTheme {
    constructor() {
        super('koi-pond');
        this.koiInstances = [];
        this.lilyPadInstances = [];
        this.lastRippleTime = 0;
        this.eventUnsubscribers = [];
        this.animationFrameId = null;
        this.effectTimeouts = new Set();

        // Graphics quality presets
        this.qualityChangeHandler = null;
        this.currentQuality = 'High';
        this.qualityPresets = {
            Minimal: {
                // Lily pads
                lilyPadCount: 3,
                lilyPadAnimationEnabled: false,

                // Koi fish
                koiCount: 3,
                koiAnimationEnabled: true,

                // Ripples
                rippleEnabled: false,
                rippleInterval: 2000,

                // Water surface
                waterShimmerEnabled: false,

                // Floating petals (ambient)
                floatingPetalCount: 0,

                // Effects
                enableComboEffects: false,
                rippleImpactCount: 0,
                koiDartCount: 0,
                lilyPadWobbleCount: 0,
                petalScatterCount: 0,
                dropletRingCount: 0,
                lightGlintCount: 0,
                waterSwirlCount: 0,

                // Performance
                animationFrameSkip: 3,
            },
            Low: {
                // Lily pads
                lilyPadCount: 4,
                lilyPadAnimationEnabled: true,

                // Koi fish
                koiCount: 4,
                koiAnimationEnabled: true,

                // Ripples
                rippleEnabled: true,
                rippleInterval: 1500,

                // Water surface
                waterShimmerEnabled: true,

                // Floating petals (ambient)
                floatingPetalCount: 5,

                // Effects
                enableComboEffects: true,
                rippleImpactCount: 2,
                koiDartCount: 1,
                lilyPadWobbleCount: 1,
                petalScatterCount: 4,
                dropletRingCount: 2,
                lightGlintCount: 4,
                waterSwirlCount: 1,

                // Performance
                animationFrameSkip: 2,
            },
            Medium: {
                // Lily pads
                lilyPadCount: 5,
                lilyPadAnimationEnabled: true,

                // Koi fish
                koiCount: 5,
                koiAnimationEnabled: true,

                // Ripples
                rippleEnabled: true,
                rippleInterval: 1000,

                // Water surface
                waterShimmerEnabled: true,

                // Floating petals (ambient)
                floatingPetalCount: 10,

                // Effects
                enableComboEffects: true,
                rippleImpactCount: 3,
                koiDartCount: 2,
                lilyPadWobbleCount: 2,
                petalScatterCount: 8,
                dropletRingCount: 4,
                lightGlintCount: 8,
                waterSwirlCount: 2,

                // Performance
                animationFrameSkip: 1,
            },
            High: {
                // Lily pads
                lilyPadCount: 6,
                lilyPadAnimationEnabled: true,

                // Koi fish
                koiCount: 7,
                koiAnimationEnabled: true,

                // Ripples
                rippleEnabled: true,
                rippleInterval: 700,

                // Water surface
                waterShimmerEnabled: true,

                // Floating petals (ambient)
                floatingPetalCount: 15,

                // Effects
                enableComboEffects: true,
                rippleImpactCount: 4,
                koiDartCount: 3,
                lilyPadWobbleCount: 3,
                petalScatterCount: 12,
                dropletRingCount: 6,
                lightGlintCount: 12,
                waterSwirlCount: 3,

                // Performance
                animationFrameSkip: 0,
            },
            Ultra: {
                // Lily pads
                lilyPadCount: 8,
                lilyPadAnimationEnabled: true,

                // Koi fish
                koiCount: 9,
                koiAnimationEnabled: true,

                // Ripples
                rippleEnabled: true,
                rippleInterval: 500,

                // Water surface
                waterShimmerEnabled: true,

                // Floating petals (ambient)
                floatingPetalCount: 20,

                // Effects
                enableComboEffects: true,
                rippleImpactCount: 5,
                koiDartCount: 4,
                lilyPadWobbleCount: 4,
                petalScatterCount: 16,
                dropletRingCount: 8,
                lightGlintCount: 16,
                waterSwirlCount: 4,

                // Performance
                animationFrameSkip: 0,
            },
            Extreme: {
                // Lily pads
                lilyPadCount: 10,
                lilyPadAnimationEnabled: true,

                // Koi fish
                koiCount: 12,
                koiAnimationEnabled: true,

                // Ripples
                rippleEnabled: true,
                rippleInterval: 400,

                // Water surface
                waterShimmerEnabled: true,

                // Floating petals (ambient)
                floatingPetalCount: 30,

                // Effects
                enableComboEffects: true,
                rippleImpactCount: 6,
                koiDartCount: 5,
                lilyPadWobbleCount: 5,
                petalScatterCount: 24,
                dropletRingCount: 10,
                lightGlintCount: 24,
                waterSwirlCount: 5,

                // Performance
                animationFrameSkip: 0,
            },
        };

        // Active preset reference
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

    /**
     * Get current graphics quality from settings
     */
    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    /**
     * Apply a graphics quality preset
     */
    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`[KoiPondTheme] Unknown quality preset "${quality}", defaulting to High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];

        if (this.isActive) {
            this.refreshQualityDependentElements();
        }

        console.log(`🐟 [KoiPondTheme] Applied ${quality} quality preset`);
    }

    /**
     * Refresh elements that depend on quality settings
     */
    refreshQualityDependentElements() {
        const lilyPadContainer = document.getElementById('lily-pads');
        if (lilyPadContainer) {
            lilyPadContainer.innerHTML = '';
            this.lilyPadInstances = [];
            this.createLilyPads();
        }

        const koiContainer = document.getElementById('koi-fish');
        if (koiContainer) {
            koiContainer.innerHTML = '';
            this.koiInstances = [];
            this.createKoiFish();
        }

        const petalContainer = document.getElementById('koi-pond-petals');
        if (petalContainer) {
            petalContainer.innerHTML = '';
            this.createFloatingPetals();
        }

        this.updateWaterShimmer();
    }

    /**
     * Setup listener for quality setting changes
     */
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

        this.createLilyPads();
        this.createKoiFish();
        this.createFloatingPetals();
        this.updateWaterShimmer();
        this.setupEventListeners();
        this.startRippleLoop();
    }

    /**
     * Create lily pads
     */
    createLilyPads() {
        const container = document.getElementById('lily-pads');
        if (!container) return;

        const preset = this.activePreset;

        for (let i = 0; i < preset.lilyPadCount; i++) {
            const pad = document.createElement('div');
            pad.className = 'lily-pad';

            if (!preset.lilyPadAnimationEnabled) {
                pad.style.animation = 'none';
            }

            const size = Math.random() * 50 + 70;
            pad.style.width = `${size}px`;
            pad.style.height = `${size}px`;
            pad.style.setProperty('--x-pos', `${10 + Math.random() * 80}vw`);
            pad.style.setProperty('--y-pos', `${10 + Math.random() * 80}vh`);
            pad.style.animationDelay = `-${Math.random() * 20}s`;

            container.appendChild(pad);
            this.lilyPadInstances.push(pad);
        }

        this.registerContainer(container);
    }

    /**
     * Create koi fish
     */
    createKoiFish() {
        const container = document.getElementById('koi-fish');
        if (!container) return;

        const preset = this.activePreset;
        const koiColors = [
            { base: '#f08c28', spots: ['#000', '#fff'] },
            { base: '#fff', spots: ['#d44d2d', '#000'] },
            { base: '#333', spots: ['#f08c28', '#fff'] },
            { base: '#f2c94c', spots: ['#fff'] },
            { base: '#ff6b6b', spots: ['#fff', '#ffd93d'] },
            { base: '#c9b037', spots: ['#8b0000', '#fff'] },
        ];

        for (let i = 0; i < preset.koiCount; i++) {
            const koi = document.createElement('div');
            koi.className = 'koi';

            const colors = koiColors[Math.floor(Math.random() * koiColors.length)];
            let spotsSvg = '';
            const spotCount = Math.floor(Math.random() * 4) + 2;
            for (let j = 0; j < spotCount; j++) {
                spotsSvg += `<circle cx="${Math.random() * 80 + 10}" cy="${Math.random() * 20 + 10}" r="${Math.random() * 6 + 4}" fill="${colors.spots[Math.floor(Math.random() * colors.spots.length)]}" opacity="${Math.random() * 0.3 + 0.6}"/>`;
            }
            const koiSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><path d="M50 0 C20 0, 0 20, 0 20 S20 40, 50 40 C80 40, 100 20, 100 20 S80 0, 50 0 Z" fill="${colors.base}"/>${spotsSvg}</svg>`;
            koi.style.backgroundImage = `url('data:image/svg+xml;utf8,${encodeURIComponent(koiSvg)}')`;

            for (let j = 1; j <= 5; j++) {
                koi.style.setProperty(`--x${j}`, `${Math.random() * 90}vw`);
                koi.style.setProperty(`--y${j}`, `${Math.random() * 90}vh`);
                koi.style.setProperty(`--r${j}`, `${Math.random() * 360}deg`);
            }

            const duration = Math.random() * 10 + 20;
            koi.style.animationDuration = `${duration}s`;
            koi.style.animationDelay = `-${Math.random() * duration}s`;

            if (!preset.koiAnimationEnabled) {
                koi.style.animation = 'none';
            }

            container.appendChild(koi);
            this.koiInstances.push(koi);
        }

        this.registerContainer(container);
    }

    /**
     * Create floating cherry blossom petals on the water surface
     */
    createFloatingPetals() {
        const container = document.getElementById('koi-pond-petals');
        if (!container) return;

        const preset = this.activePreset;

        for (let i = 0; i < preset.floatingPetalCount; i++) {
            const petal = document.createElement('div');
            petal.className = 'floating-petal';

            petal.style.left = `${Math.random() * 100}%`;
            petal.style.top = `${Math.random() * 100}%`;
            petal.style.animationDelay = `${Math.random() * 20}s`;
            petal.style.animationDuration = `${25 + Math.random() * 15}s`;
            petal.style.setProperty('--drift-x', `${(Math.random() - 0.5) * 40}vw`);
            petal.style.setProperty('--drift-y', `${(Math.random() - 0.5) * 40}vh`);
            petal.style.setProperty('--rotation', `${Math.random() * 720 - 360}deg`);

            container.appendChild(petal);
        }

        this.registerContainer(container);
    }

    updateWaterShimmer() {
        const waterSurface = document.querySelector('#koi-pond-theme .water-surface');
        if (!waterSurface) return;
        if (!this.activePreset.waterShimmerEnabled) {
            waterSurface.style.animation = 'none';
        }
    }

    startRippleLoop() {
        const rippleContainer = document.getElementById('koi-ripples');
        if (!rippleContainer) return;

        const rippleLoop = (timestamp) => {
            if (!this.isActive) return;

            const preset = this.activePreset;

            if (preset.rippleEnabled && timestamp - this.lastRippleTime > preset.rippleInterval) {
                this.lastRippleTime = timestamp;

                if (this.koiInstances.length > 0) {
                    const koi = this.koiInstances[Math.floor(Math.random() * this.koiInstances.length)];
                    const rect = koi.getBoundingClientRect();

                    if (rect.top > 0 && rect.left > 0 && rect.bottom < window.innerHeight && rect.right < window.innerWidth) {
                        const ripple = document.createElement('div');
                        ripple.className = 'koi-ripple';
                        ripple.style.left = `${rect.left + rect.width * 0.2}px`;
                        ripple.style.top = `${rect.top + rect.height / 2}px`;
                        ripple.style.width = `${rect.width * 1.5}px`;
                        ripple.style.height = `${rect.width * 1.5}px`;
                        ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
                        rippleContainer.appendChild(ripple);
                    }
                }
            }

            this.animationFrameId = requestAnimationFrame(rippleLoop);
            this.registerAnimation(this.animationFrameId);
        };

        this.animationFrameId = requestAnimationFrame(rippleLoop);
        this.registerAnimation(this.animationFrameId);
        this.registerContainer(rippleContainer);
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

    /**
     * Get a random position avoiding the center game board
     */
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
            // Tetris! Major water disturbance
            this.triggerRippleImpacts(6);
            this.triggerKoiDart(4);
            this.triggerWaterSwirls(3);
            this.triggerPetalScatter(20);
            this.triggerLightGlints(15);
            this.wobbleLilyPads(1.5);
        } else if (lineCount >= 2) {
            // Multi-line: noticeable disturbance
            this.triggerRippleImpacts(lineCount + 1);
            this.triggerKoiDart(lineCount);
            this.triggerPetalScatter(lineCount * 4);
            this.triggerDropletRings(lineCount * 2);
            this.wobbleLilyPads(1.2);
        } else {
            // Single line: subtle effect
            this.triggerRippleImpacts(2);
            this.triggerLightGlints(6);
            this.wobbleLilyPads(1.05);
        }
    }

    onCombo(comboCount) {
        const preset = this.activePreset;
        if (!preset.enableComboEffects) return;

        if (comboCount >= 8) {
            // Epic combo: Fish feeding frenzy!
            this.triggerKoiFrenzy();
            this.triggerWaterSwirls(5);
            this.triggerRippleImpacts(8);
            this.triggerPetalScatter(30);
            this.triggerLightGlints(20);
        } else if (comboCount >= 5) {
            // High combo: Excited fish
            this.triggerKoiDart(4);
            this.triggerWaterSwirls(3);
            this.triggerRippleImpacts(5);
            this.triggerPetalScatter(15);
        } else if (comboCount >= 3) {
            // Medium combo: Some activity
            this.triggerKoiDart(2);
            this.triggerRippleImpacts(3);
            this.triggerDropletRings(4);
            this.wobbleLilyPads(1.3);
        } else {
            // Low combo: Light shimmer
            this.triggerLightGlints(8);
            this.triggerRippleImpacts(2);
        }
    }

    onPieceLock() {
        if (!this.activePreset.enableComboEffects) return;

        // Very subtle lily pad wobble
        this.wobbleLilyPads(1.02);

        // Small chance for extra visual feedback
        const roll = Math.random();
        if (roll < 0.35) {
            // 35% chance: small ripple
            this.triggerPieceLockRipple();
        } else if (roll < 0.55) {
            // 20% chance: water glint
            this.triggerPieceLockGlint();
        } else if (roll < 0.65) {
            // 10% chance: petal drift
            this.triggerPieceLockPetal();
        }
    }

    /**
     * Trigger a small ripple for piece lock
     */
    triggerPieceLockRipple() {
        const container = document.getElementById('koi-pond-effects');
        if (!container) return;

        const ripple = document.createElement('div');
        ripple.className = 'piece-lock-ripple';

        const pos = this.getEdgePosition('any');
        ripple.style.left = `${pos.x}%`;
        ripple.style.top = `${pos.y}%`;

        container.appendChild(ripple);
        this.scheduleEffectTimeout(() => ripple.remove(), 800);
    }

    /**
     * Trigger a water glint for piece lock
     */
    triggerPieceLockGlint() {
        const container = document.getElementById('koi-pond-effects');
        if (!container) return;

        const glint = document.createElement('div');
        glint.className = 'piece-lock-glint';

        const pos = this.getEdgePosition('any');
        glint.style.left = `${pos.x}%`;
        glint.style.top = `${pos.y}%`;

        container.appendChild(glint);
        this.scheduleEffectTimeout(() => glint.remove(), 400);
    }

    /**
     * Trigger a single petal for piece lock
     */
    triggerPieceLockPetal() {
        const container = document.getElementById('koi-pond-effects');
        if (!container) return;

        const petal = document.createElement('div');
        petal.className = 'piece-lock-petal';

        const pos = this.getEdgePosition('any');
        petal.style.left = `${pos.x}%`;
        petal.style.top = `${pos.y}%`;
        petal.style.setProperty('--drift-x', `${(Math.random() - 0.5) * 40}px`);
        petal.style.setProperty('--drift-y', `${(Math.random() - 0.5) * 40}px`);

        container.appendChild(petal);
        this.scheduleEffectTimeout(() => petal.remove(), 1200);
    }

    // ===== TOP-DOWN COMBO EFFECTS =====

    /**
     * Trigger ripple impacts spreading outward (top-down view)
     */
    triggerRippleImpacts(count = 3) {
        const container = document.getElementById('koi-pond-effects');
        if (!container) return;

        const actualCount = Math.min(count, this.activePreset.rippleImpactCount * 2);

        for (let i = 0; i < actualCount; i++) {
            this.scheduleEffectTimeout(() => {
                const pos = this.getEdgePosition('any');

                // Create multiple concentric ripples
                for (let r = 0; r < 3; r++) {
                    this.scheduleEffectTimeout(() => {
                        const ripple = document.createElement('div');
                        ripple.className = 'impact-ripple';
                        ripple.style.left = `${pos.x}%`;
                        ripple.style.top = `${pos.y}%`;
                        container.appendChild(ripple);
                        this.scheduleEffectTimeout(() => ripple.remove(), 2000);
                    }, r * 100);
                }
            }, i * 150);
        }
    }

    /**
     * Trigger koi fish darting away (viewed from above)
     */
    triggerKoiDart(count = 2) {
        const container = document.getElementById('koi-pond-effects');
        if (!container) return;

        const actualCount = Math.min(count, this.activePreset.koiDartCount);
        const koiColors = ['#f08c28', '#fff', '#333', '#f2c94c', '#ff6b6b'];

        for (let i = 0; i < actualCount; i++) {
            this.scheduleEffectTimeout(() => {
                const dartKoi = document.createElement('div');
                dartKoi.className = 'darting-koi';

                const pos = this.getEdgePosition('any');
                dartKoi.style.left = `${pos.x}%`;
                dartKoi.style.top = `${pos.y}%`;

                const color = koiColors[Math.floor(Math.random() * koiColors.length)];
                dartKoi.style.setProperty('--koi-color', color);

                // Random dart direction
                const angle = Math.random() * 360;
                dartKoi.style.setProperty('--dart-angle', `${angle}deg`);
                dartKoi.style.setProperty('--dart-distance', `${100 + Math.random() * 150}px`);

                container.appendChild(dartKoi);

                // Add ripple trail
                this.addRippleAt(pos.x, pos.y);

                this.scheduleEffectTimeout(() => dartKoi.remove(), 800);
            }, i * 200);
        }
    }

    /**
     * Trigger koi feeding frenzy (multiple fish circling excitedly)
     */
    triggerKoiFrenzy() {
        const container = document.getElementById('koi-pond-effects');
        if (!container) return;

        const koiColors = ['#f08c28', '#fff', '#333', '#f2c94c', '#ff6b6b', '#c9b037'];
        const frenzyCount = 6;

        // Choose a frenzy center point
        const centerPos = this.getEdgePosition('corner');

        for (let i = 0; i < frenzyCount; i++) {
            this.scheduleEffectTimeout(() => {
                const koi = document.createElement('div');
                koi.className = 'frenzy-koi';

                koi.style.left = `${centerPos.x}%`;
                koi.style.top = `${centerPos.y}%`;

                const color = koiColors[Math.floor(Math.random() * koiColors.length)];
                koi.style.setProperty('--koi-color', color);
                koi.style.setProperty('--orbit-radius', `${40 + Math.random() * 60}px`);
                koi.style.setProperty('--start-angle', `${(i / frenzyCount) * 360}deg`);
                koi.style.setProperty('--orbit-direction', Math.random() > 0.5 ? '1' : '-1');

                container.appendChild(koi);
                this.scheduleEffectTimeout(() => koi.remove(), 2000);
            }, i * 100);
        }

        // Add central splash
        this.triggerRippleImpacts(3);
    }

    /**
     * Wobble lily pads from water disturbance
     */
    wobbleLilyPads(intensity = 1.2) {
        this.lilyPadInstances.forEach((pad, index) => {
            this.scheduleEffectTimeout(() => {
                pad.classList.add('lily-pad-wobble');
                pad.style.setProperty('--wobble-intensity', intensity);

                this.scheduleEffectTimeout(() => {
                    pad.classList.remove('lily-pad-wobble');
                }, 800);
            }, index * 50);
        });
    }

    /**
     * Trigger cherry blossom petals scattering on water
     */
    triggerPetalScatter(count = 10) {
        const container = document.getElementById('koi-pond-effects');
        if (!container) return;

        const actualCount = Math.min(count, this.activePreset.petalScatterCount * 2);

        for (let i = 0; i < actualCount; i++) {
            this.scheduleEffectTimeout(() => {
                const petal = document.createElement('div');
                petal.className = 'scatter-petal';

                const pos = this.getEdgePosition('any');
                petal.style.left = `${pos.x}%`;
                petal.style.top = `${pos.y}%`;

                // Random drift direction
                petal.style.setProperty('--drift-x', `${(Math.random() - 0.5) * 100}px`);
                petal.style.setProperty('--drift-y', `${(Math.random() - 0.5) * 100}px`);
                petal.style.setProperty('--rotation', `${Math.random() * 360}deg`);

                container.appendChild(petal);
                this.scheduleEffectTimeout(() => petal.remove(), 2500);
            }, i * 50);
        }
    }

    /**
     * Trigger water droplet ring impacts (like rain drops from above)
     */
    triggerDropletRings(count = 4) {
        const container = document.getElementById('koi-pond-effects');
        if (!container) return;

        const actualCount = Math.min(count, this.activePreset.dropletRingCount);

        for (let i = 0; i < actualCount; i++) {
            this.scheduleEffectTimeout(() => {
                const droplet = document.createElement('div');
                droplet.className = 'droplet-ring';

                const pos = this.getEdgePosition('any');
                droplet.style.left = `${pos.x}%`;
                droplet.style.top = `${pos.y}%`;

                container.appendChild(droplet);
                this.scheduleEffectTimeout(() => droplet.remove(), 1000);
            }, i * 100);
        }
    }

    /**
     * Trigger light glints dancing on water surface
     */
    triggerLightGlints(count = 8) {
        const container = document.getElementById('koi-pond-effects');
        if (!container) return;

        const actualCount = Math.min(count, this.activePreset.lightGlintCount * 2);

        for (let i = 0; i < actualCount; i++) {
            this.scheduleEffectTimeout(() => {
                const glint = document.createElement('div');
                glint.className = 'water-glint';

                const pos = this.getEdgePosition('any');
                glint.style.left = `${pos.x}%`;
                glint.style.top = `${pos.y}%`;

                container.appendChild(glint);
                this.scheduleEffectTimeout(() => glint.remove(), 600);
            }, i * 40);
        }
    }

    /**
     * Trigger swirling water currents (top-down spiral)
     */
    triggerWaterSwirls(count = 2) {
        const container = document.getElementById('koi-pond-effects');
        if (!container) return;

        const actualCount = Math.min(count, this.activePreset.waterSwirlCount);

        for (let i = 0; i < actualCount; i++) {
            this.scheduleEffectTimeout(() => {
                const swirl = document.createElement('div');
                swirl.className = 'water-swirl';

                const pos = this.getEdgePosition('corner');
                swirl.style.left = `${pos.x}%`;
                swirl.style.top = `${pos.y}%`;
                swirl.style.setProperty('--swirl-direction', Math.random() > 0.5 ? '1' : '-1');

                container.appendChild(swirl);
                this.scheduleEffectTimeout(() => swirl.remove(), 2000);
            }, i * 300);
        }
    }

    /**
     * Add a small ripple at a specific position
     */
    addRippleAt(x, y) {
        const container = document.getElementById('koi-pond-effects');
        if (!container) return;

        const ripple = document.createElement('div');
        ripple.className = 'small-ripple';
        ripple.style.left = `${x}%`;
        ripple.style.top = `${y}%`;
        container.appendChild(ripple);
        this.scheduleEffectTimeout(() => ripple.remove(), 1000);
    }

    getTetrominoConfig() {
        return KOI_POND_TETROMINOS;
    }

    stop() {
        if (!this.isActive) return;
        this.clearEffectTimeouts();
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];
        this.teardownQualityListener();
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        super.stop();
    }

    cleanup() {
        this.stop();
        this.koiInstances = [];
        this.lilyPadInstances = [];
        super.cleanup();
    }
}
