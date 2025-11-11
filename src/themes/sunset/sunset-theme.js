import { BaseTheme } from '../base-theme.js';
import { SunsetSolarState } from './solar-state.js';
import { PhaserSunEmitter } from './phaser-sun-emitter.js';

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
            solarSampleMs: 500, // EXTREME: 500ms (~2 FPS) for solar updates - dramatic reduction
            solarThrottleMs: 500, // EXTREME: Match solar sample rate
            godRayCount: 0, // EXTREME: Completely disable god rays (cause FPS drop in daylight!)
            sunFlareCount: 1, // EXTREME: Only 1 sun flare (from 6 to 1 = 83% reduction!)
            starCount: 100, // ULTRA: From 200 to 100 (50% reduction!)
            disablePhaserEmitter: true, // DISABLE Phaser sun particles completely
            disableLensEffects: true, // EXTREME: Disable lens effects (biggest performance hit!)
        };
        this.lastSolarApply = 0;
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
            const flareCount = this.performanceFlags.sunFlareCount || 1;
            if (flareCount >= 1) {
                const flareEl = document.createElement('div');
                flareEl.className = 'sunset-sunflare';
                flareEl.style.width = '150px';
                flareEl.style.height = '150px';
                // Simplified gradient: only 2 stops instead of default multi-stop
                flareEl.style.background = 'radial-gradient(circle, rgba(255, 200, 100, 0.6) 0%, transparent 60%)';
                flareEl.style.marginLeft = '0px';
                flareEl.style.marginTop = '0px';
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
        if (!starsContainer) {
            starsContainer = document.createElement('div');
            starsContainer.id = 'sunset-stars';
            starsContainer.className = 'sunset-stars';
            (this.themeContainerRef || document.getElementById('sunset-theme') || document.body)
                .appendChild(starsContainer);
        } else if (this.themeContainerRef && starsContainer.parentNode !== this.themeContainerRef) {
            this.themeContainerRef.appendChild(starsContainer);
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
        const body = document.body;
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
}
