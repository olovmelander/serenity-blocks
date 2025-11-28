import { BaseTheme } from '../base-theme.js';
import { SunsetSolarState } from './solar-state.js';
import { PhaserSunEmitter } from './phaser-sun-emitter.js';
import { SUNSET_TETROMINOS } from './sunset-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

// REMOVED: DUST_STAGE_COLORS - Dust particles permanently removed for performance

export default class SunsetTheme extends BaseTheme {
    constructor() {
        super('sunset');
        this.solarState = null;
        this.solarUnsubscribe = null;
        this.sunEmitter = null;
        if (this.themeContainerRef) {
            this.themeContainerRef.classList.remove('sunset-night-only');
        }
        this.themeContainerRef = null;
        this.lensStack = null;
        this.godRayContainer = null;
        this.dustContainerRef = null;
        this.currentSolarStage = null;
        this.globalFlareFactor = 1;
        this.settingsListener = null;
        this.dynamicElements = new Set();
        // REMOVED: this.flockInstances - Birds permanently removed for performance
        // REMOVED: this.pendingFlockTimeout - Birds permanently removed for performance
        // REMOVED: this.shootingStarTimeout - Shooting stars permanently removed for performance
        this.starContainerRef = null;
        this.currentStarStage = null;
        this.currentStarAlpha = 0;
        // REMOVED: All canvas star properties - using simple CSS stars
        this.performanceFlags = {
            minimalAtmosphere: false,
            solarSampleMs: 200, // Reduced from 100ms (5 FPS updates) - sufficient for slow sunset
            solarThrottleMs: 200, // Match solar sample rate
            godRayCount: 16, // Reduced from 24 to 16 for performance
            sunFlareCount: 3, // Keep multiple sun flares
            starCount: 150, // Reduced from 200 to 150
            disablePhaserEmitter: false, // Keep Phaser sun particles
            disableLensEffects: false, // Keep lens effects
        };
        this.lastSolarApply = 0;
        this.eventUnsubscribers = [];
        this.currentComboLevel = 0;
    }

    stop() {
        this.destroyDynamicSystems();
        super.stop();
    }

    cleanup() {
        super.cleanup();
    }

    destroyDynamicSystems() {
        if (this.solarState) {
            this.solarState.stop();
            this.solarState = null;
        }
        if (this.solarUnsubscribe) {
            this.solarUnsubscribe();
            this.solarUnsubscribe = null;
        }
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];
        if (this.sunEmitter) {
            this.sunEmitter.destroy();
            this.sunEmitter = null;
        }
        if (this.settingsListener && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.settingsListener);
            this.settingsListener = null;
        }
        // REMOVED: pendingFlockTimeout cleanup - Birds permanently removed for performance
        // REMOVED: shootingStarTimeout cleanup - Shooting stars permanently removed for performance
        // REMOVED: flockInstances cleanup - Birds permanently removed for performance
        this.dynamicElements.forEach((node) => {
            if (node?.parentNode) node.parentNode.removeChild(node);
        });
        this.dynamicElements.clear();
        this.themeContainerRef = null;
        this.lensStack = null;
        this.godRayContainer = null;
        this.dustContainerRef = null;
        this.currentSolarStage = null;
        this.starContainerRef = null;
        this.currentStarAlpha = 0;
        // REMOVED: Canvas star cleanup - using simple CSS stars
        this.lastSolarApply = 0;
    }

    refreshGlobalFlareFactor() {
        if (typeof window === 'undefined') return;
        const root = document.documentElement;
        const computed = getComputedStyle(root).getPropertyValue('--global-sunset-flare-strength');
        const parsed = Number.parseFloat(computed) || 1;
        this.globalFlareFactor = parsed;
        if (this.themeContainerRef) {
            const currentIntensity = Number.parseFloat(
                this.themeContainerRef.style.getPropertyValue('--sunset-solar-intensity') || '0.65',
            ) || 0.65;
            const strength = parsed * (0.65 + currentIntensity * 0.5);
            this.themeContainerRef.style.setProperty('--sunset-flare-strength', strength.toFixed(3));
        }
    }

    attachSettingsListener() {
        if (this.settingsListener || typeof window === 'undefined') return;
        this.settingsListener = (event) => {
            if (event?.detail?.sunsetFlareIntensity !== undefined) {
                this.refreshGlobalFlareFactor();
            }
        };
        window.addEventListener('settingsChanged', this.settingsListener);
    }

    ensureSunCore(sunElement) {
        if (!sunElement) return null;
        let host = sunElement.querySelector('.sunset-sun-core');
        if (!host) {
            host = document.createElement('div');
            host.className = 'sunset-sun-core';
            sunElement.appendChild(host);
            this.dynamicElements.add(host);
        }
        return host;
    }

    ensureLensStack(sunElement) {
        if (!sunElement) return null;
        let stack = sunElement.querySelector('.sunset-lens-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.className = 'sunset-lens-stack';

            const halo = document.createElement('div');
            halo.className = 'sunset-lens-halo';
            const hex = document.createElement('div');
            hex.className = 'sunset-lens-hex';
            const streak = document.createElement('div');
            streak.className = 'sunset-lens-streak';
            const ghost = document.createElement('div');
            ghost.className = 'sunset-lens-ghost';
            const spikes = document.createElement('div');
            spikes.className = 'sunset-lens-spikes';
            const bokeh = document.createElement('div');
            bokeh.className = 'sunset-lens-bokeh';

            stack.append(ghost, halo, hex, streak, spikes, bokeh);
            sunElement.appendChild(stack);
            this.dynamicElements.add(stack);
        }
        return stack;
    }

    ensureSkyOverlays(skyElement) {
        if (!skyElement) return;
        if (!skyElement.querySelector('.sunset-solar-gradient')) {
            const overlay = document.createElement('div');
            overlay.className = 'sunset-solar-gradient';
            skyElement.appendChild(overlay);
            this.dynamicElements.add(overlay);
        }
        if (!skyElement.querySelector('.sunset-noise-layer')) {
            const noise = document.createElement('div');
            noise.className = 'sunset-noise-layer';
            skyElement.appendChild(noise);
            this.dynamicElements.add(noise);
        }
        this.ensureNightVeil(skyElement);
        this.ensureCirrusLayer(skyElement);
    }

    ensureNightVeil(skyElement) {
        if (!skyElement || skyElement.querySelector('.sunset-night-veil')) return;
        const veil = document.createElement('div');
        veil.className = 'sunset-night-veil';
        skyElement.appendChild(veil);
        this.dynamicElements.add(veil);
    }

    ensureCirrusLayer(skyElement) {
        if (!skyElement || skyElement.querySelector('.sunset-cirrus-layer')) return;
        const cirrus = document.createElement('div');
        cirrus.className = 'sunset-cirrus-layer';
        skyElement.appendChild(cirrus);
        this.dynamicElements.add(cirrus);
    }

    applyMinimalPresentation() {
        if (!this.themeContainerRef) return;
        const minimal = !!this.performanceFlags?.minimalAtmosphere;
        this.themeContainerRef.classList.toggle('sunset-minimal', minimal);
        if (!minimal) {
            this.themeContainerRef.classList.remove('sunset-night-only');
            return;
        }
        // REMOVED: Cloud layers and dust particles permanently for performance
        ['sunset-sunflares']
            .forEach((id) => {
                const el = document.getElementById(id);
                this.clearElementChildren(el);
            });
        const godRays = this.themeContainerRef.querySelector('.sunset-god-rays');
        this.clearElementChildren(godRays);
        this.godRayContainer = null;
        this.dustContainerRef = null;
        const existingLens = this.themeContainerRef.querySelector('.sunset-lens-stack');
        if (existingLens?.parentNode) {
            existingLens.parentNode.removeChild(existingLens);
        }
        this.lensStack = null;
    }

    clearElementChildren(element) {
        if (!element) return;
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
    }

    initializeSolarSystems(themeContainer, sunElement) {
        if (!sunElement || !themeContainer) return;
        if (!this.solarState) {
            this.solarState = new SunsetSolarState({
                sunElement,
                themeContainer,
                sampleInterval: this.performanceFlags.solarSampleMs || undefined,
            });
            this.solarUnsubscribe = this.solarState.onUpdate((state) => this.handleSolarUpdate(state));
            this.solarState.start();
        }
        // EXTREME PERFORMANCE: Disable Phaser emitter completely
        if (!this.sunEmitter && !this.performanceFlags.disablePhaserEmitter && !this.performanceFlags.minimalAtmosphere) {
            const coreHost = this.ensureSunCore(sunElement);
            this.sunEmitter = new PhaserSunEmitter(coreHost);
            this.sunEmitter.init();
        } else if (this.sunEmitter && (this.performanceFlags.minimalAtmosphere || this.performanceFlags.disablePhaserEmitter)) {
            this.sunEmitter.destroy();
            this.sunEmitter = null;
        }
    }

    handleSolarUpdate(state) {
        if (this.isStartOverlayActive()) {
            return;
        }
        const solar = this.normalizeSolarState(state);
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const throttleWindow = this.performanceFlags.minimalAtmosphere
            ? this.performanceFlags.solarThrottleMs
            : 40;
        if (
            this.lastSolarApply
            && this.currentSolarStage === solar.stage
            && now - this.lastSolarApply < throttleWindow
        ) {
            return;
        }
        this.lastSolarApply = now;
        const flicker = 0.92 + Math.sin(performance.now() / 700) * 0.08;
        if (this.themeContainerRef) {
            const intensitySlope = solar.stage === 'day' ? 0.35 : 0.55;
            const baseline = solar.stage === 'day' ? 0.5 : 0.65;
            const flareStrength = this.globalFlareFactor * (baseline + solar.intensity * intensitySlope);
            this.themeContainerRef.style.setProperty('--sunset-ray-flicker', flicker.toFixed(3));
            this.themeContainerRef.style.setProperty('--sunset-flare-strength', flareStrength.toFixed(3));
        }
        // REMOVED: updateGodRayDynamics(solar) - Using CSS variables directly
        this.updateLensStack(solar);
        this.updateStage(solar);
        this.updateStarField(solar);
        if (this.sunEmitter) {
            this.sunEmitter.setSolarState(solar);
        }
    }

    // REMOVED: updateGodRayDynamics() - God rays now use CSS variables from solar state directly

    updateLensStack(state) {
        if (!this.lensStack || this.performanceFlags.minimalAtmosphere) return;
        this.lensStack.style.setProperty('--sunset-flare-alpha', (0.5 + state.intensity * 0.5).toFixed(3));
        this.lensStack.style.setProperty('--sunset-flare-scale', (0.85 + state.altitude * 0.45).toFixed(3));
        this.lensStack.style.setProperty('--sunset-flare-hue', `${state.hue.toFixed(1)}deg`);
        const ghostScale = 1.05 + state.intensity * 0.55;
        const ghostAlpha = 0.2 + state.intensity * 0.45;
        const spikeAlpha = Math.max(0, state.altitude - 0.15) * 0.8 + 0.2;
        const bokehAlpha = 0.25 + state.intensity * 0.35;
        const bokehOffset = 30 + state.altitude * 50;
        this.lensStack.style.setProperty('--sunset-ghost-scale', ghostScale.toFixed(3));
        this.lensStack.style.setProperty('--sunset-ghost-alpha', Math.min(1, ghostAlpha).toFixed(3));
        this.lensStack.style.setProperty('--sunset-spike-alpha', Math.min(1, spikeAlpha).toFixed(3));
        this.lensStack.style.setProperty('--sunset-bokeh-alpha', Math.min(1, bokehAlpha).toFixed(3));
        this.lensStack.style.setProperty('--sunset-bokeh-offset', `${bokehOffset.toFixed(1)}px`);
    }

    // REMOVED: updateMountainTint() - No longer needed as mountain-silhouette was removed for performance

    updateStage(state) {
        if (this.currentSolarStage === state.stage) return;
        this.currentSolarStage = state.stage;
        // REMOVED: tuneDustPalette() call - dust particles removed for performance
        // REMOVED: updateStarBehavior() call - shooting stars removed for performance

        // NIGHT-ONLY MODE: Hide heavy effects during night, show only stars
        if (this.themeContainerRef) {
            const isNight = state.stage === 'night';
            this.themeContainerRef.classList.toggle('sunset-night-only', isNight);

            // Hide/show heavy effects based on night stage
            if (isNight) {
                this.hideHeavyEffects();
            } else {
                this.showHeavyEffects();
            }
        }

        // REMOVED: Bird flock spawning - permanently removed for performance
    }

    hideHeavyEffects() {
        // PURE NIGHT MODE: Hide EVERYTHING except stars - clean starry sky only!

        // REMOVED: Dust particles permanently removed for performance

        // Hide god rays
        if (this.godRayContainer) this.godRayContainer.style.display = 'none';

        // REMOVED: Cloud layers permanently removed for performance

        // Hide sun flares
        const sunflares = document.getElementById('sunset-sunflares');
        if (sunflares) sunflares.style.display = 'none';

        // Hide the sun itself completely
        const sun = this.themeContainerRef?.querySelector('.sun');
        if (sun) sun.style.opacity = '0';

        // Hide lens stack
        if (this.lensStack) this.lensStack.style.display = 'none';

        // Hide solar gradient overlay
        const solarGradient = this.themeContainerRef?.querySelector('.sunset-solar-gradient');
        if (solarGradient) solarGradient.style.opacity = '0';

        // Hide noise layer
        const noiseLayer = this.themeContainerRef?.querySelector('.sunset-noise-layer');
        if (noiseLayer) noiseLayer.style.opacity = '0';

        // Hide cirrus clouds
        const cirrusLayer = this.themeContainerRef?.querySelector('.sunset-cirrus-layer');
        if (cirrusLayer) cirrusLayer.style.opacity = '0';

        // NOTE: mountain-silhouette removed permanently for performance

        // Disable Phaser sun emitter
        if (this.sunEmitter) {
            this.sunEmitter.setSolarState({ intensity: 0, altitude: 0 });
        }
    }

    showHeavyEffects() {
        // Restore all elements when leaving night mode

        // REMOVED: Dust particles permanently removed for performance

        // Show god rays
        if (this.godRayContainer) this.godRayContainer.style.display = '';

        // REMOVED: Cloud layers permanently removed for performance

        // Show sun flares
        const sunflares = document.getElementById('sunset-sunflares');
        if (sunflares) sunflares.style.display = '';

        // Show the sun
        const sun = this.themeContainerRef?.querySelector('.sun');
        if (sun) sun.style.opacity = '';

        // Show lens stack
        if (this.lensStack) this.lensStack.style.display = '';

        // Show solar gradient
        const solarGradient = this.themeContainerRef?.querySelector('.sunset-solar-gradient');
        if (solarGradient) solarGradient.style.opacity = '';

        // Show noise layer
        const noiseLayer = this.themeContainerRef?.querySelector('.sunset-noise-layer');
        if (noiseLayer) noiseLayer.style.opacity = '';

        // Show cirrus clouds
        const cirrusLayer = this.themeContainerRef?.querySelector('.sunset-cirrus-layer');
        if (cirrusLayer) cirrusLayer.style.opacity = '';

        // NOTE: mountain-silhouette removed permanently for performance
    }

    // REMOVED: updateStarBehavior() - Shooting stars permanently removed for performance

    updateStarField(state) {
        if (!this.starContainerRef) {
            this.starContainerRef = document.getElementById('sunset-stars');
        }
        const container = this.starContainerRef;
        if (!container) return;

        // EXTREME PERFORMANCE: Simplified star opacity calculation - use stage-based presets only
        const stageOpacityMap = {
            night: 0.95,
            'golden-hour': 0.35,
            dawn: 0.25,
            day: 0.05,
        };
        const targetOpacity = stageOpacityMap[state.stage] ?? 0.05;

        // Skip update if stage hasn't changed (most common case)
        if (this.currentStarStage === state.stage) {
            return;
        }

        this.currentStarAlpha = targetOpacity;
        this.currentStarStage = state.stage;
        container.dataset.starStage = state.stage;

        // EXTREME PERFORMANCE: Only update star alpha, remove twinkle speed updates
        if (this.themeContainerRef) {
            this.themeContainerRef.style.setProperty('--sunset-star-alpha', targetOpacity.toFixed(2));
        }
    }

    // REMOVED: tuneDustPalette() - Dust particles permanently removed for performance

    // REMOVED: spawnBirdFlock() - Bird flocks permanently removed for performance

    // REMOVED: scheduleShootingStar() - Shooting stars permanently removed for performance

    // REMOVED: spawnShootingStar() - Shooting stars permanently removed for performance

    async createScene() {
        if (this.isStartOverlayActive()) {
            if (!this.deferredSceneHandle) {
                this.deferredSceneHandle = setTimeout(() => {
                    this.deferredSceneHandle = null;
                    this.createScene();
                }, 500);
            }
            return;
        }

        const themeContainer = document.getElementById('sunset-theme');
        if (!themeContainer) return;

        this.themeContainerRef = themeContainer;

        // EXTREME PERFORMANCE: Add CSS containment for better rendering performance
        themeContainer.style.contain = 'layout style paint';
        themeContainer.style.contentVisibility = 'auto';

        this.applyMinimalPresentation();
        this.refreshGlobalFlareFactor();
        this.attachSettingsListener();

        // Remove mountain-silhouette from DOM if it exists (permanently removed for performance)
        const mountain = themeContainer.querySelector('.mountain-silhouette');
        if (mountain && mountain.parentNode) {
            mountain.parentNode.removeChild(mountain);
        }

        const sun = themeContainer.querySelector('.sun');
        if (sun) {
            this.ensureSunCore(sun);
            // EXTREME PERFORMANCE: Check both minimalAtmosphere AND disableLensEffects flags
            if (this.performanceFlags.minimalAtmosphere || this.performanceFlags.disableLensEffects) {
                // Remove existing lens stack if it exists
                const existingLens = sun.querySelector('.sunset-lens-stack');
                if (existingLens && existingLens.parentNode) {
                    existingLens.parentNode.removeChild(existingLens);
                }
                this.lensStack = null;
            } else {
                this.lensStack = this.ensureLensStack(sun);
            }
        }

        const skyLayer = themeContainer.querySelector('.sun-and-sky');
        this.ensureSkyOverlays(skyLayer);

        this.initializeSolarSystems(themeContainer, sun);

        if (!this.performanceFlags.minimalAtmosphere) {
            // REMOVED: this.buildCloudLayers() - Permanently removed for performance
            this.buildSunFlares();
            this.buildGodRays();
            // REMOVED: this.buildDustParticles() - Permanently removed for performance
            // REMOVED: this.ensureBirds() - Permanently removed for performance
        }
        // REMOVED: this.buildMountainSilhouette() - Permanently removed for performance
        this.ensureStars();
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Listen for line clear events
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive) {
                this.onLineClear(data.lineCount);
            }
        });

        // Listen for combo events
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive) {
                this.onCombo(data.comboCount);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub);
    }

    /**
     * React to line clears with subtle atmospheric shifts
     */
    onLineClear(lineCount) {
        if (this.performanceFlags.minimalAtmosphere) return;

        // 1. Gentle Sun Pulse
        this.pulseSun(lineCount * 0.5);

        // 2. Spawn Solar Embers (fewer for just lines)
        if (lineCount >= 2) {
            this.spawnSolarEmbers(lineCount * 3);
        }

        // 3. Horizon Glow for big clears
        if (lineCount >= 4) {
            this.triggerHorizonGlow(0.6);
        }
    }

    /**
     * React to combos with integrated theme effects
     */
    onCombo(comboCount) {
        if (this.performanceFlags.minimalAtmosphere) return;

        this.currentComboLevel = comboCount;

        // 1. Intensify Sun Pulse
        const pulseIntensity = Math.min(comboCount * 0.8, 4);
        this.pulseSun(pulseIntensity);

        // 2. Solar Embers rising from the horizon
        const emberCount = Math.min(comboCount * 5, 30);
        this.spawnSolarEmbers(emberCount);

        // 3. God Ray Shimmer
        this.shimmerGodRays(comboCount);

        // 4. Horizon Glow
        if (comboCount >= 3) {
            this.triggerHorizonGlow(Math.min(0.3 + comboCount * 0.1, 0.8));
        }
    }

    /**
     * Make the sun pulse gently with warmth
     */
    pulseSun(intensity) {
        const sun = this.themeContainerRef?.querySelector('.sun');
        if (!sun) return;

        // Don't interrupt if already animating intensely
        if (sun.dataset.pulsing === 'true') return;

        sun.dataset.pulsing = 'true';
        const originalTransform = sun.style.transform || '';

        // Gentle scale up
        const scale = 1 + (intensity * 0.02); // Subtle scale
        sun.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94), filter 0.4s ease-out';
        sun.style.transform = `${originalTransform} scale(${scale})`;
        sun.style.filter = `brightness(${1 + intensity * 0.1}) saturate(${1 + intensity * 0.05})`;

        setTimeout(() => {
            sun.style.transform = originalTransform;
            sun.style.filter = '';
            sun.dataset.pulsing = 'false';
        }, 400);
    }

    /**
     * Spawn rising glowing embers from the bottom
     */
    spawnSolarEmbers(count) {
        const theme = this.themeContainerRef;
        if (!theme) return;

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const ember = document.createElement('div');
                ember.className = 'solar-ember';
                ember.style.position = 'absolute';
                const size = 2 + Math.random() * 4;
                ember.style.width = `${size}px`;
                ember.style.height = `${size}px`;
                ember.style.borderRadius = '50%';

                // Warm colors: Gold, Orange, Red
                const colors = ['#ffd700', '#ff8c00', '#ff4500', '#ff6b6b'];
                const color = colors[Math.floor(Math.random() * colors.length)];

                ember.style.backgroundColor = color;
                ember.style.boxShadow = `0 0 ${size * 2}px ${color}`;
                ember.style.left = `${Math.random() * 100}%`;
                ember.style.bottom = '-10px';
                ember.style.opacity = '0';
                ember.style.pointerEvents = 'none';
                ember.style.zIndex = '10'; // In front of mountains/sky

                // Physics-ish movement
                const duration = 2 + Math.random() * 3;
                ember.style.transition = `bottom ${duration}s ease-out, opacity ${duration * 0.2}s ease-in, transform ${duration}s linear`;

                theme.appendChild(ember);

                requestAnimationFrame(() => {
                    ember.style.opacity = (0.6 + Math.random() * 0.4).toString();
                    ember.style.bottom = `${20 + Math.random() * 40}%`; // Float up 20-60%
                    const drift = (Math.random() - 0.5) * 100;
                    ember.style.transform = `translateX(${drift}px) scale(0)`; // Shrink as they rise
                });

                setTimeout(() => {
                    if (ember.parentNode) ember.parentNode.removeChild(ember);
                }, duration * 1000);
            }, i * 50);
        }
    }

    /**
     * Make god rays shimmer/brighten momentarily
     */
    shimmerGodRays(intensity) {
        if (!this.godRayContainer) return;

        const rays = Array.from(this.godRayContainer.children);
        const raysToAffect = Math.min(rays.length, Math.ceil(intensity * 2));

        // Shuffle array to pick random rays
        const shuffled = rays.sort(() => 0.5 - Math.random());

        for (let i = 0; i < raysToAffect; i++) {
            const ray = shuffled[i];
            const originalOpacity = ray.style.getPropertyValue('--ray-opacity');

            ray.style.transition = 'opacity 0.5s ease-in-out';
            // Boost opacity temporarily
            ray.style.opacity = '0.8';

            setTimeout(() => {
                ray.style.opacity = ''; // Revert to CSS variable or default
            }, 500 + Math.random() * 500);
        }
    }

    /**
     * Create a subtle horizon glow pulse
     */
    triggerHorizonGlow(opacity) {
        const theme = this.themeContainerRef;
        if (!theme) return;

        let glow = theme.querySelector('.horizon-glow-effect');
        if (!glow) {
            glow = document.createElement('div');
            glow.className = 'horizon-glow-effect';
            glow.style.position = 'absolute';
            glow.style.bottom = '0';
            glow.style.left = '0';
            glow.style.width = '100%';
            glow.style.height = '40%';
            glow.style.background = 'linear-gradient(to top, rgba(255, 200, 100, 0.4), transparent)';
            glow.style.pointerEvents = 'none';
            glow.style.zIndex = '5'; // Behind foreground elements if any
            glow.style.opacity = '0';
            glow.style.transition = 'opacity 0.5s ease-in-out';
            theme.appendChild(glow);
        }

        requestAnimationFrame(() => {
            glow.style.opacity = opacity.toString();
            setTimeout(() => {
                glow.style.opacity = '0';
            }, 600);
        });
    }

    // REMOVED: buildCloudLayers() - Cloud layers permanently removed for performance

    // REMOVED: buildMountainSilhouette() - Permanently removed for performance optimization

    buildSunFlares() {
        if (this.performanceFlags.minimalAtmosphere) {
            return;
        }
        const sunflareContainer = document.getElementById('sunset-sunflares');
        if (sunflareContainer && sunflareContainer.children.length === 0) {
            // EXTREME PERFORMANCE: Only 1 sun flare with simpler gradient (radial gradients are very expensive!)
            const flareCount = this.performanceFlags.sunFlareCount || 3;
            for (let i = 0; i < flareCount; i++) {
                const flareEl = document.createElement('div');
                flareEl.className = 'sunset-sunflare';

                // Randomize size and position slightly
                const size = 100 + Math.random() * 200;
                flareEl.style.width = `${size}px`;
                flareEl.style.height = `${size}px`;

                // Varied gradients for better look
                if (i === 0) {
                    flareEl.style.background = 'radial-gradient(circle, rgba(255, 220, 150, 0.4) 0%, rgba(255, 180, 100, 0.1) 60%, transparent 70%)';
                } else if (i === 1) {
                    flareEl.style.background = 'radial-gradient(circle, rgba(255, 255, 255, 0.3) 0%, rgba(255, 200, 150, 0.1) 50%, transparent 60%)';
                    flareEl.style.marginLeft = `${(Math.random() - 0.5) * 50}px`;
                    flareEl.style.marginTop = `${(Math.random() - 0.5) * 50}px`;
                } else {
                    flareEl.style.background = 'radial-gradient(circle, rgba(255, 150, 100, 0.2) 0%, transparent 60%)';
                    flareEl.style.width = `${size * 1.5}px`;
                    flareEl.style.height = `${size * 1.5}px`;
                }

                sunflareContainer.appendChild(flareEl);
            }
            this.registerContainer(sunflareContainer);
        }
    }

    buildGodRays() {
        if (this.performanceFlags.minimalAtmosphere) {
            return;
        }
        const godRayContainer = document.querySelector('.sunset-god-rays');

        // EXTREME PERFORMANCE: Check if god rays should be disabled (godRayCount: 0)
        const rayCount = typeof this.performanceFlags.godRayCount === 'number'
            ? this.performanceFlags.godRayCount
            : 15;

        // If rayCount is 0, clear any existing rays and skip creation
        if (rayCount === 0) {
            if (godRayContainer) {
                this.clearElementChildren(godRayContainer);
            }
            this.godRayContainer = null;
            return;
        }

        if (godRayContainer && godRayContainer.children.length === 0) {
            const angleStep = 360 / rayCount;

            for (let i = 0; i < rayCount; i++) {
                const ray = document.createElement('div');
                ray.className = 'sunset-god-ray';
                const angle = i * angleStep + (Math.random() * 4 - 2);
                const length = this.random(260, 360);
                const width = this.random(2, 4.5);
                const opacity = this.random(0.3, 0.55);

                ray.style.setProperty('--ray-angle', `${angle}deg`);
                ray.style.setProperty('--ray-length', `${length}px`);
                ray.style.setProperty('--ray-width', `${width}px`);
                ray.style.setProperty('--ray-opacity', opacity.toFixed(2));
                ray.style.willChange = 'transform, opacity'; // GPU acceleration

                godRayContainer.appendChild(ray);
            }
            this.registerContainer(godRayContainer);
        }
        this.godRayContainer = godRayContainer;
    }

    // REMOVED: buildDustParticles() - Dust particles permanently removed for performance

    // REMOVED: ensureBirds() - Birds permanently removed for performance

    ensureStars() {
        // SIMPLIFIED: Clean star rendering like galaxy theme - no canvas, no noise, just pure CSS stars
        let starsContainer = document.getElementById('sunset-stars');
        const sunAndSky = this.themeContainerRef?.querySelector('.sun-and-sky');

        if (!starsContainer) {
            starsContainer = document.createElement('div');
            starsContainer.id = 'sunset-stars';
            starsContainer.className = 'sunset-stars';
            if (sunAndSky) {
                // Insert before sun if possible, or just append (z-index will handle it)
                sunAndSky.insertBefore(starsContainer, sunAndSky.firstChild);
            } else {
                (this.themeContainerRef || document.getElementById('sunset-theme') || document.body)
                    .appendChild(starsContainer);
            }
        } else if (sunAndSky && starsContainer.parentNode !== sunAndSky) {
            // Move into sun-and-sky if not already there
            sunAndSky.insertBefore(starsContainer, sunAndSky.firstChild);
        }

        // ULTRA PERFORMANCE: Reduced star count for better performance
        if (!starsContainer.querySelector('.sunset-star')) {
            const fragment = document.createDocumentFragment();
            const starCount = this.performanceFlags.starCount || 100; // Reduced to 100 stars
            for (let i = 0; i < starCount; i++) {
                const star = document.createElement('div');
                star.className = 'sunset-star';
                const size = Math.random() * 2 + 0.5; // Simple size like galaxy theme
                star.style.width = `${size}px`;
                star.style.height = `${size}px`;
                star.style.left = `${Math.random() * 100}%`;
                star.style.top = `${Math.random() * 100}%`;
                star.style.animationDelay = `${Math.random() * 3}s`;
                fragment.appendChild(star);
            }
            starsContainer.appendChild(fragment);
        }

        this.starContainerRef = starsContainer;
    }

    // REMOVED: All canvas star rendering methods - using simple CSS stars like galaxy theme
    // - ensureStarCanvas()
    // - createStarParticles()
    // - resizeStarCanvas()
    // - startStarfieldAnimation()
    // - stopStarfieldAnimation()
    // - updateStarfieldAnimationState()
    // - renderStarField()
    // - teardownStarCanvas()

    normalizeSolarState(state = {}) {
        const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
        const safeNumber = (value, fallback) => (Number.isFinite(value) ? value : fallback);
        const altitude = clamp(safeNumber(state.altitude, 0.5), 0, 1);
        const intensity = clamp(safeNumber(state.intensity, 0.65), 0, 1.2);
        const hue = safeNumber(state.hue, 32);
        const normalizedX = clamp(safeNumber(state.normalizedX, 0.5), 0, 1);
        const normalizedY = clamp(safeNumber(state.normalizedY, 0.5), 0, 1);
        const stage = typeof state.stage === 'string' ? state.stage : 'day';
        return {
            ...state,
            altitude,
            intensity,
            hue,
            normalizedX,
            normalizedY,
            stage,
        };
    }

    isStartOverlayActive() {
        if (typeof document === 'undefined') return false;
        const { body } = document;
        if (!body) return false;
        const startModal = document.getElementById('start-modal');
        const modalVisible = !!(startModal && !startModal.classList.contains('hidden') && startModal.offsetParent !== null);
        return (
            body.classList.contains('intro-active')
            || body.classList.contains('start-modal-open')
            || body.dataset?.uiState === 'intro'
            || modalVisible
        );
    }

    /**
     * Provide Sunset themed tetromino styling (warm golden hour radiance)
     * @returns {Object} Sunset tetromino configuration
     */
    getTetrominoConfig() {
        return SUNSET_TETROMINOS;
    }
}
