/**
 * @fileoverview Lunara Theme - Enhanced Mystical Winter Scene
 *
 * A breathtaking mystical winter landscape featuring:
 * - Twinkling starfield with colored stars
 * - Dynamic aurora borealis with multiple layers
 * - Twin planets (purple and pink) with pulsing glow
 * - Layered mountain silhouettes with atmospheric glow
 * - Snow-covered pine trees with gentle sway
 * - Falling snowflakes
 * - Mystical fog/mist layers
 * - Combo effects (shooting stars, planet bursts, aurora flares)
 * - Piece lock effects (snowflake bursts, soft glows)
 */

import { BaseTheme } from '../base-theme.js';
import { lunaraBackgroundCache } from '../../utils/cache.js';
import { LUNARA_TETROMINOS } from './lunara-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export default class LunaraTheme extends BaseTheme {
    constructor() {
        super('lunara');
        this.comboIntensity = 0;
        this.comboTargetIntensity = 0;
        this.comboFlash = 0;
        this.comboAnimationRunning = false;
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;
        this.effectTimeouts = new Set();

        // Particle systems
        this.comboParticleSystems = [];
        this.comboParticleTimeouts = [];
        this.snowflakes = [];
        this.lockEffects = [];

        // Cached containers
        this.skyContainer = null;
        this.starsContainer = null;
        this.auroraContainer = null;
        this.planetsContainer = null;
        this.mountainsDistant = null;
        this.mountainsMid = null;
        this.forestLeft = null;
        this.forestRight = null;
        this.snowfield = null;
        this.fog = null;
        this.snowContainer = null;
        this.effectsContainer = null;

        // Animation
        this.animationTime = 0;
        this.snowAnimationId = null;

        // Quality presets
        this.qualityPresets = {
            Minimal: {
                starCount: 60,
                auroraCount: 2,
                treeCount: 5,
                snowflakeCount: 0,
                enableSnowfall: false,
                enableLockEffects: false,
                enableEnhancedAurora: false,
                shootingStarsPerCombo: 1,
                maxShootingStars: 2,
                planetBurstParticles: 30,
                lockSnowflakeCount: 0,
                lockGlowIntensity: 0,
            },
            Low: {
                starCount: 80,
                auroraCount: 3,
                treeCount: 6,
                snowflakeCount: 20,
                enableSnowfall: true,
                enableLockEffects: true,
                enableEnhancedAurora: false,
                shootingStarsPerCombo: 1,
                maxShootingStars: 3,
                planetBurstParticles: 40,
                lockSnowflakeCount: 3,
                lockGlowIntensity: 0.3,
            },
            Medium: {
                starCount: 100,
                auroraCount: 4,
                treeCount: 7,
                snowflakeCount: 40,
                enableSnowfall: true,
                enableLockEffects: true,
                enableEnhancedAurora: true,
                shootingStarsPerCombo: 2,
                maxShootingStars: 4,
                planetBurstParticles: 60,
                lockSnowflakeCount: 5,
                lockGlowIntensity: 0.5,
            },
            High: {
                starCount: 130,
                auroraCount: 5,
                treeCount: 8,
                snowflakeCount: 60,
                enableSnowfall: true,
                enableLockEffects: true,
                enableEnhancedAurora: true,
                shootingStarsPerCombo: 2,
                maxShootingStars: 5,
                planetBurstParticles: 80,
                lockSnowflakeCount: 7,
                lockGlowIntensity: 0.7,
            },
            Ultra: {
                starCount: 170,
                auroraCount: 6,
                treeCount: 9,
                snowflakeCount: 90,
                enableSnowfall: true,
                enableLockEffects: true,
                enableEnhancedAurora: true,
                shootingStarsPerCombo: 3,
                maxShootingStars: 6,
                planetBurstParticles: 100,
                lockSnowflakeCount: 10,
                lockGlowIntensity: 0.9,
            },
            Extreme: {
                starCount: 220,
                auroraCount: 8,
                treeCount: 10,
                snowflakeCount: 130,
                enableSnowfall: true,
                enableLockEffects: true,
                enableEnhancedAurora: true,
                shootingStarsPerCombo: 4,
                maxShootingStars: 8,
                planetBurstParticles: 130,
                lockSnowflakeCount: 14,
                lockGlowIntensity: 1.0,
            },
        };

        this.currentQuality = 'High';
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
        console.log(`🌙 [LunaraTheme] Applied ${quality} quality preset`);
    }

    setupQualityListener() {
        this.qualityChangeHandler = (event) => {
            if (event.detail && event.detail.effectQuality) {
                const newQuality = event.detail.effectQuality;
                if (newQuality !== this.currentQuality) {
                    this.applyQualityPreset(newQuality);
                    this.refreshQualityDependentElements();
                }
            }
        };
        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    refreshQualityDependentElements() {
        // Recreate stars
        if (this.starsContainer) {
            this.starsContainer.innerHTML = '';
            this.createStars();
        }

        // Recreate aurora
        if (this.auroraContainer) {
            this.auroraContainer.innerHTML = '';
            this.createAurora();
        }

        // Recreate snowflakes
        if (this.snowContainer) {
            this.snowContainer.innerHTML = '';
            if (this.activePreset.enableSnowfall) {
                this.createSnowfall();
            }
        }
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        const quality = this.getGraphicsQuality();
        this.applyQualityPreset(quality);
        this.setupQualityListener();

        // Cache containers
        this.skyContainer = this.getContainer('lunara-sky');
        this.starsContainer = this.getContainer('lunara-stars');
        this.auroraContainer = this.getContainer('lunara-aurora');
        this.planetsContainer = this.getContainer('lunara-planets');
        this.mountainsDistant = this.getContainer('lunara-mountains-distant');
        this.mountainsMid = this.getContainer('lunara-mountains-mid');
        this.forestLeft = this.getContainer('lunara-forest-left');
        this.forestRight = this.getContainer('lunara-forest-right');
        this.snowfield = this.getContainer('lunara-snowfield');
        this.fog = this.getContainer('lunara-fog');

        // Create elements
        this.createStars();
        this.createAurora();
        this.createPlanets();
        this.createMountains();
        this.createForests();
        this.createSnowfall();
        this.createEffectsContainer();

        this.comboLayer = this.ensureComboLayer();

        this.setupEventListeners();
        this.startComboLoop();
        this.startSnowAnimation();
    }

    createStars() {
        if (!this.starsContainer || this.starsContainer.children.length > 0) return;

        const { starCount } = this.activePreset;
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div');

            // Some stars are colored
            const isColoredStar = Math.random() < 0.15;
            star.className = isColoredStar ? 'lunara-star lunara-star-colored' : 'lunara-star';

            const size = Math.random() * 2.5 + 0.5;
            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${Math.random() * 100}%`;
            star.style.top = `${Math.random() * 60}%`;
            star.style.setProperty('--twinkle-duration', `${Math.random() * 3 + 2}s`);
            star.style.setProperty('--twinkle-delay', `${Math.random() * 5}s`);

            if (isColoredStar) {
                const colors = ['#c6fff2', '#d3b6ff', '#ffb0de', '#b7d8ff'];
                star.style.setProperty('--star-color', colors[Math.floor(Math.random() * colors.length)]);
            }

            fragment.appendChild(star);
        }

        this.starsContainer.appendChild(fragment);
    }

    createAurora() {
        if (!this.auroraContainer || this.auroraContainer.children.length > 0) return;

        const { auroraCount } = this.activePreset;
        const fragment = document.createDocumentFragment();

        // Main aurora layers
        for (let i = 0; i < auroraCount; i++) {
            const aurora = document.createElement('div');
            aurora.className = 'lunara-aurora';
            const auroraDuration = Math.random() * 10 + 15;
            aurora.style.left = `${(i / auroraCount) * 80 + Math.random() * 20}%`;
            aurora.style.top = `${5 + Math.random() * 30}%`;
            aurora.style.setProperty('--aurora-duration', `${auroraDuration}s`);
            aurora.style.setProperty('--aurora-delay', `${Math.random() * 5}s`);
            aurora.dataset.baseDuration = auroraDuration;
            fragment.appendChild(aurora);
        }

        // Enhanced secondary aurora layer
        if (this.activePreset.enableEnhancedAurora) {
            for (let i = 0; i < Math.floor(auroraCount / 2); i++) {
                const aurora = document.createElement('div');
                aurora.className = 'lunara-aurora lunara-aurora-secondary';
                const auroraDuration = Math.random() * 12 + 18;
                aurora.style.left = `${Math.random() * 100}%`;
                aurora.style.top = `${10 + Math.random() * 25}%`;
                aurora.style.setProperty('--aurora-duration', `${auroraDuration}s`);
                aurora.style.setProperty('--aurora-delay', `${Math.random() * 8}s`);
                aurora.dataset.baseDuration = auroraDuration;
                fragment.appendChild(aurora);
            }
        }

        this.auroraContainer.appendChild(fragment);
    }

    createPlanets() {
        if (!this.planetsContainer || this.planetsContainer.children.length > 0) return;

        const cacheKey = 'lunara-planets-canvas';

        if (lunaraBackgroundCache.has(cacheKey)) {
            const cached = lunaraBackgroundCache.get(cacheKey);
            if (cached && typeof cached === 'object') {
                this.planetsContainer.style.backgroundImage = cached.image;
                this.planetMeta = cached.meta;
            } else {
                this.planetsContainer.style.backgroundImage = cached;
                const width = window.innerWidth;
                const height = window.innerHeight;
                this.planetMeta = {
                    planet1: { x: width * 0.35, y: height * 0.25, radius: Math.min(width, height) * 0.2 },
                    planet2: { x: width * 0.5, y: height * 0.2, radius: Math.min(width, height) * 0.12 },
                    width,
                    height,
                };
            }
        } else {
            const canvas = document.createElement('canvas');
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            const ctx = canvas.getContext('2d');

            // Large purple planet
            const planet1X = canvas.width * 0.35;
            const planet1Y = canvas.height * 0.25;
            const planet1Radius = Math.min(canvas.width, canvas.height) * 0.2;

            // Draw outer glow
            const glow1 = ctx.createRadialGradient(
                planet1X,
                planet1Y,
                planet1Radius * 0.8,
                planet1X,
                planet1Y,
                planet1Radius * 1.8,
            );
            glow1.addColorStop(0, 'rgba(200, 150, 255, 0.35)');
            glow1.addColorStop(0.5, 'rgba(180, 120, 240, 0.15)');
            glow1.addColorStop(1, 'rgba(200, 150, 255, 0)');
            ctx.fillStyle = glow1;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw planet with enhanced gradient
            const planet1Grad = ctx.createRadialGradient(
                planet1X - planet1Radius * 0.35,
                planet1Y - planet1Radius * 0.35,
                planet1Radius * 0.15,
                planet1X,
                planet1Y,
                planet1Radius,
            );
            planet1Grad.addColorStop(0, '#e8d0ff');
            planet1Grad.addColorStop(0.3, '#d8b5ff');
            planet1Grad.addColorStop(0.6, '#a855f7');
            planet1Grad.addColorStop(1, '#6b21a8');
            ctx.fillStyle = planet1Grad;
            ctx.beginPath();
            ctx.arc(planet1X, planet1Y, planet1Radius, 0, Math.PI * 2);
            ctx.fill();

            // Smaller pink planet
            const planet2X = canvas.width * 0.5;
            const planet2Y = canvas.height * 0.2;
            const planet2Radius = Math.min(canvas.width, canvas.height) * 0.12;

            // Draw glow
            const glow2 = ctx.createRadialGradient(
                planet2X,
                planet2Y,
                planet2Radius * 0.8,
                planet2X,
                planet2Y,
                planet2Radius * 1.6,
            );
            glow2.addColorStop(0, 'rgba(255, 200, 240, 0.35)');
            glow2.addColorStop(0.5, 'rgba(255, 180, 230, 0.15)');
            glow2.addColorStop(1, 'rgba(255, 200, 240, 0)');
            ctx.fillStyle = glow2;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw planet
            const planet2Grad = ctx.createRadialGradient(
                planet2X - planet2Radius * 0.35,
                planet2Y - planet2Radius * 0.35,
                planet2Radius * 0.15,
                planet2X,
                planet2Y,
                planet2Radius,
            );
            planet2Grad.addColorStop(0, '#ffe8f5');
            planet2Grad.addColorStop(0.3, '#ffd4f0');
            planet2Grad.addColorStop(0.6, '#f472b6');
            planet2Grad.addColorStop(1, '#be185d');
            ctx.fillStyle = planet2Grad;
            ctx.beginPath();
            ctx.arc(planet2X, planet2Y, planet2Radius, 0, Math.PI * 2);
            ctx.fill();

            const dataURL = `url(${canvas.toDataURL()})`;
            this.planetMeta = {
                planet1: { x: planet1X, y: planet1Y, radius: planet1Radius },
                planet2: { x: planet2X, y: planet2Y, radius: planet2Radius },
                width: canvas.width,
                height: canvas.height,
            };
            lunaraBackgroundCache.set(cacheKey, { image: dataURL, meta: this.planetMeta });
            this.planetsContainer.style.backgroundImage = dataURL;
        }

        this.createPlanetAnchors(this.planetsContainer);
    }

    createMountains() {
        // Distant mountains
        if (this.mountainsDistant) {
            const cacheKey = 'lunara-mountains-distant-3000x600';

            if (lunaraBackgroundCache.has(cacheKey)) {
                const cachedData = lunaraBackgroundCache.get(cacheKey);
                this.mountainsDistant.style.backgroundImage = cachedData.backgroundImage;
                this.mountainsDistant.style.backgroundSize = cachedData.backgroundSize;
            } else {
                const rng = this.seededRandom(33333);
                const canvas = document.createElement('canvas');
                canvas.width = 3000;
                canvas.height = 600;
                const ctx = canvas.getContext('2d');

                const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
                gradient.addColorStop(0, '#c9a8f0');
                gradient.addColorStop(0.5, '#b794f6');
                gradient.addColorStop(1, '#9f7aea');
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.moveTo(0, canvas.height);

                for (let x = 0; x < canvas.width; x += 30) {
                    const y = canvas.height - (rng() * 200 + 150) - Math.sin(x * 0.008) * 80;
                    ctx.lineTo(x, y);
                }
                ctx.lineTo(canvas.width, canvas.height);
                ctx.closePath();
                ctx.fill();

                const backgroundImage = `url(${canvas.toDataURL()})`;
                const backgroundSize = '150% 100%';
                lunaraBackgroundCache.set(cacheKey, { backgroundImage, backgroundSize });
                this.mountainsDistant.style.backgroundImage = backgroundImage;
                this.mountainsDistant.style.backgroundSize = backgroundSize;
            }
        }

        // Mid-ground mountains
        if (this.mountainsMid) {
            const cacheKey = 'lunara-mountains-mid-3000x700';

            if (lunaraBackgroundCache.has(cacheKey)) {
                const cachedData = lunaraBackgroundCache.get(cacheKey);
                this.mountainsMid.style.backgroundImage = cachedData.backgroundImage;
                this.mountainsMid.style.backgroundSize = cachedData.backgroundSize;
            } else {
                const rng = this.seededRandom(44444);
                const canvas = document.createElement('canvas');
                canvas.width = 3000;
                canvas.height = 700;
                const ctx = canvas.getContext('2d');

                const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
                gradient.addColorStop(0, '#a88fd0');
                gradient.addColorStop(0.5, '#9f7aea');
                gradient.addColorStop(1, '#7c3aed');
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.moveTo(0, canvas.height);

                for (let x = 0; x < canvas.width; x += 25) {
                    const y = canvas.height - (rng() * 300 + 200) - Math.cos(x * 0.01) * 100;
                    ctx.lineTo(x, y);
                }
                ctx.lineTo(canvas.width, canvas.height);
                ctx.closePath();
                ctx.fill();

                const backgroundImage = `url(${canvas.toDataURL()})`;
                const backgroundSize = '150% 100%';
                lunaraBackgroundCache.set(cacheKey, { backgroundImage, backgroundSize });
                this.mountainsMid.style.backgroundImage = backgroundImage;
                this.mountainsMid.style.backgroundSize = backgroundSize;
            }
        }
    }

    createForests() {
        const { treeCount } = this.activePreset;

        // Left forest
        if (this.forestLeft && this.forestLeft.children.length === 0) {
            const fragment = document.createDocumentFragment();
            for (let i = 0; i < treeCount; i++) {
                const tree = document.createElement('div');
                tree.className = 'lunara-tree';
                const height = Math.random() * 200 + 250;
                const swayDuration = Math.random() * 3 + 4;
                tree.style.height = `${height}px`;
                tree.style.left = `${i * (100 / treeCount)}%`;
                tree.style.bottom = '0';
                tree.style.setProperty('--sway-duration', `${swayDuration}s`);
                tree.style.setProperty('--sway-delay', `${Math.random() * 2}s`);
                tree.dataset.baseSway = swayDuration;
                fragment.appendChild(tree);
            }
            this.forestLeft.appendChild(fragment);
        }

        // Right forest
        if (this.forestRight && this.forestRight.children.length === 0) {
            const fragment = document.createDocumentFragment();
            for (let i = 0; i < treeCount; i++) {
                const tree = document.createElement('div');
                tree.className = 'lunara-tree';
                const height = Math.random() * 200 + 250;
                const swayDuration = Math.random() * 3 + 4;
                tree.style.height = `${height}px`;
                tree.style.right = `${i * (100 / treeCount)}%`;
                tree.style.bottom = '0';
                tree.style.setProperty('--sway-duration', `${swayDuration}s`);
                tree.style.setProperty('--sway-delay', `${Math.random() * 2}s`);
                tree.dataset.baseSway = swayDuration;
                fragment.appendChild(tree);
            }
            this.forestRight.appendChild(fragment);
        }
    }

    createSnowfall() {
        if (!this.activePreset.enableSnowfall) return;

        // Get or create snow container
        let snowContainer = document.getElementById('lunara-snow');
        if (!snowContainer) {
            const themeContainer = document.getElementById('lunara-theme');
            if (!themeContainer) return;

            snowContainer = document.createElement('div');
            snowContainer.id = 'lunara-snow';
            snowContainer.className = 'lunara-snow-container';
            snowContainer.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 12;
                overflow: hidden;
            `;
            themeContainer.appendChild(snowContainer);
            this.registerContainer(snowContainer);
        }
        this.snowContainer = snowContainer;

        // Create snowflakes
        const count = this.activePreset.snowflakeCount;
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < count; i++) {
            const snowflake = document.createElement('div');
            snowflake.className = 'lunara-snowflake';

            const size = Math.random() * 4 + 2;
            const duration = Math.random() * 10 + 15;
            const delay = Math.random() * 15;
            const drift = (Math.random() - 0.5) * 100;

            snowflake.style.cssText = `
                position: absolute;
                left: ${Math.random() * 100}%;
                top: -10px;
                width: ${size}px;
                height: ${size}px;
                background: radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(220,230,255,0.6) 50%, transparent 100%);
                border-radius: 50%;
                animation: lunara-snowfall ${duration}s linear ${delay}s infinite;
                --drift: ${drift}px;
                opacity: ${0.4 + Math.random() * 0.5};
            `;

            fragment.appendChild(snowflake);
            this.snowflakes.push(snowflake);
        }

        snowContainer.appendChild(fragment);
    }

    createEffectsContainer() {
        const themeContainer = document.getElementById('lunara-theme');
        if (!themeContainer) return;

        let effectsContainer = document.getElementById('lunara-effects');
        if (!effectsContainer) {
            effectsContainer = document.createElement('div');
            effectsContainer.id = 'lunara-effects';
            effectsContainer.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 15;
                overflow: hidden;
            `;
            themeContainer.appendChild(effectsContainer);
            this.registerContainer(effectsContainer);
        }
        this.effectsContainer = effectsContainer;
    }

    startSnowAnimation() {
        // Snow animation is handled by CSS, but we can add dynamic effects here
    }

    getTetrominoConfig() {
        return LUNARA_TETROMINOS;
    }

    setupEventListeners() {
        this.teardownEventListeners();

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (!this.shouldProcessComboEffects()) return;
            this.handleLineClear(data);
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (!this.shouldProcessComboEffects()) return;
            this.handleCombo(data);
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (!this.shouldProcessComboEffects()) return;
            this.handlePieceLock();
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    teardownEventListeners() {
        if (!this.eventUnsubscribers.length) return;

        this.eventUnsubscribers.forEach((unsubscribe) => {
            try {
                unsubscribe?.();
            } catch (error) {
                console.error('[LunaraTheme] Failed to remove event listener', error);
            }
        });

        this.eventUnsubscribers = [];
    }

    shouldProcessComboEffects() {
        if (!this.isActive) return false;
        if (typeof window === 'undefined') return true;
        const { settings } = window;
        return settings?.backgroundComboEffects !== false;
    }

    normalizeEventPayload(payload = {}) {
        if (payload && typeof payload === 'object' && 'detail' in payload && payload.detail) {
            return payload.detail;
        }
        return payload || {};
    }

    handleLineClear(eventPayload) {
        const detail = this.normalizeEventPayload(eventPayload);
        const lineCount = detail.lineCount ?? detail.count ?? detail.lines ?? 1;
        let comboCount = detail.comboCount ?? detail.combo ?? detail.comboLevel ?? 0;

        if (!comboCount && this.pendingComboCount > 0) {
            comboCount = this.pendingComboCount;
            this.pendingComboCount = 0;
        }

        this.onLineClear(lineCount, comboCount);
    }

    handleCombo(eventPayload) {
        const detail = this.normalizeEventPayload(eventPayload);
        const comboCount = detail.comboCount ?? detail.combo ?? detail.count ?? 0;

        if (comboCount > 0) {
            this.pendingComboCount = comboCount;
        }
    }

    handlePieceLock() {
        if (!this.activePreset.enableLockEffects) return;

        // Subtle visual pulse
        this.comboFlash = Math.min(this.comboFlash + 0.05, 0.15);

        // Spawn lock snowflakes
        this.spawnLockSnowflakes();

        // Random chance for aurora flash
        if (Math.random() < 0.3) {
            this.triggerAuroraFlash();
        }
    }

    spawnLockSnowflakes() {
        if (!this.effectsContainer) return;

        const count = this.activePreset.lockSnowflakeCount;
        if (count === 0) return;

        for (let i = 0; i < count; i++) {
            const snowflake = document.createElement('div');
            snowflake.className = 'lunara-lock-snowflake';

            // Position at edges/corners
            const edge = Math.floor(Math.random() * 4);
            let x; let
                y;
            switch (edge) {
            case 0: x = Math.random() * 25; y = 30 + Math.random() * 40; break;
            case 1: x = 75 + Math.random() * 25; y = 30 + Math.random() * 40; break;
            case 2: x = Math.random() * 100; y = 60 + Math.random() * 30; break;
            default: x = Math.random() * 100; y = 70 + Math.random() * 25;
            }

            const size = Math.random() * 6 + 4;
            snowflake.style.cssText = `
                position: absolute;
                left: ${x}%;
                top: ${y}%;
                width: ${size}px;
                height: ${size}px;
                background: radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(200,220,255,0.7) 40%, transparent 70%);
                border-radius: 50%;
                animation: lunara-lock-sparkle 0.6s ease-out forwards;
                pointer-events: none;
            `;

            this.effectsContainer.appendChild(snowflake);
            this.scheduleEffectTimeout(() => snowflake.remove(), 600);
        }
    }

    triggerAuroraFlash() {
        if (!this.auroraContainer) return;

        const auroras = this.auroraContainer.children;
        if (auroras.length === 0) return;

        const randomAurora = auroras[Math.floor(Math.random() * auroras.length)];
        const originalOpacity = randomAurora.style.opacity || '0.6';

        randomAurora.style.opacity = '0.9';
        randomAurora.style.filter = 'blur(25px) drop-shadow(0 0 30px rgba(180, 255, 220, 0.5))';

        this.scheduleEffectTimeout(() => {
            randomAurora.style.opacity = originalOpacity;
            randomAurora.style.filter = '';
        }, 300);
    }

    onLineClear(lineCount, comboCount) {
        const normalizedCombo = Math.min(comboCount / 8, 1);
        const lineBoost = Math.min(lineCount / 6, 0.6);
        const targetBoost = Math.min(1, (normalizedCombo * 0.85) + (lineBoost * 0.35) + 0.1);

        this.comboTargetIntensity = Math.max(this.comboTargetIntensity, targetBoost);
        this.comboFlash = Math.min(1, this.comboFlash + 0.35 + normalizedCombo * 0.45);

        // Shooting stars
        const streaksToSpawn = Math.min(
            this.activePreset.shootingStarsPerCombo + (comboCount >= 4 ? 1 : 0),
            this.activePreset.maxShootingStars,
        );
        for (let i = 0; i < streaksToSpawn; i++) {
            this.scheduleEffectTimeout(() => this.spawnShootingStar(normalizedCombo), i * 100);
        }

        // Planet particle burst for combos
        if (comboCount >= 2) {
            this.spawnPlanetParticleBurst(comboCount, normalizedCombo);
        }

        // Aurora wave for Tetris
        if (lineCount >= 4) {
            this.triggerAuroraWave();
        }

        // Snowstorm burst for high combos
        if (comboCount >= 5) {
            this.triggerSnowstormBurst(comboCount);
        }
    }

    triggerAuroraWave() {
        if (!this.effectsContainer) return;

        const wave = document.createElement('div');
        wave.className = 'lunara-aurora-wave';
        wave.style.cssText = `
            position: absolute;
            top: 10%;
            left: 0;
            width: 100%;
            height: 30%;
            background: linear-gradient(180deg, 
                transparent 0%,
                rgba(150, 255, 200, 0.15) 30%,
                rgba(180, 200, 255, 0.2) 50%,
                rgba(200, 150, 255, 0.15) 70%,
                transparent 100%);
            animation: lunara-aurora-wave 1.5s ease-out forwards;
            pointer-events: none;
        `;

        this.effectsContainer.appendChild(wave);
        this.scheduleEffectTimeout(() => wave.remove(), 1500);
    }

    triggerSnowstormBurst(comboCount) {
        if (!this.effectsContainer) return;

        const burstCount = Math.min(10 + comboCount * 2, 30);

        for (let i = 0; i < burstCount; i++) {
            this.scheduleEffectTimeout(() => {
                if (!this.isActive) return;

                const snowflake = document.createElement('div');
                snowflake.className = 'lunara-burst-snowflake';

                const size = Math.random() * 8 + 4;
                const x = Math.random() * 100;
                const y = Math.random() * 60;
                const duration = 1 + Math.random() * 0.5;

                snowflake.style.cssText = `
                    position: absolute;
                    left: ${x}%;
                    top: ${y}%;
                    width: ${size}px;
                    height: ${size}px;
                    background: radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(200,220,255,0.8) 40%, transparent 70%);
                    border-radius: 50%;
                    animation: lunara-burst-float ${duration}s ease-out forwards;
                    pointer-events: none;
                `;

                this.effectsContainer.appendChild(snowflake);
                this.scheduleEffectTimeout(() => snowflake.remove(), duration * 1000);
            }, i * 30);
        }
    }

    startComboLoop() {
        if (this.comboAnimationRunning) return;
        this.comboAnimationRunning = true;

        const tick = () => {
            if (!this.isActive) {
                this.comboAnimationRunning = false;
                return;
            }

            this.comboTargetIntensity = Math.max(0, this.comboTargetIntensity - 0.0025);
            this.comboFlash = Math.max(0, this.comboFlash - 0.025);
            this.comboIntensity = this.lerp(this.comboIntensity, this.comboTargetIntensity, 0.08);

            this.applyComboVisuals();

            const animId = requestAnimationFrame(tick);
            this.registerAnimation(animId);
        };

        tick();
    }

    applyComboVisuals() {
        const energy = this.comboIntensity;
        const flash = this.comboFlash;
        const auroraEnergy = Math.min(1, energy + flash * 0.5);
        const glowEnergy = Math.min(1, energy * 0.8 + flash * 0.6);
        const windEnergy = Math.min(1, energy * 0.7 + flash * 0.4);

        this.applySkyMood(energy, flash);
        this.applyAuroraPulse(auroraEnergy);
        this.applyPlanetGlow(glowEnergy);
        this.applyMountainGlow(glowEnergy);
        this.applyTreeSway(windEnergy);
        this.applyGroundHaze(glowEnergy);
    }

    applySkyMood(energy, flash) {
        if (!this.skyContainer || !this.starsContainer) return;

        if (energy <= 0 && flash <= 0) {
            this.skyContainer.style.filter = '';
            this.starsContainer.style.filter = '';
            return;
        }

        const brightness = 1 + energy * 0.15 + flash * 0.3;
        const saturation = 1 + energy * 0.25;
        this.skyContainer.style.filter = `saturate(${saturation}) brightness(${brightness})`;
        this.starsContainer.style.filter = `brightness(${1 + energy * 0.35 + flash * 0.45})`;
    }

    applyAuroraPulse(energy) {
        if (!this.auroraContainer) return;

        for (const aurora of this.auroraContainer.children) {
            const baseDuration = parseFloat(aurora.dataset.baseDuration || 20);
            const spedUp = Math.max(10, baseDuration * (1 - energy * 0.35));
            aurora.style.setProperty('--aurora-duration', `${spedUp}s`);
            aurora.style.opacity = `${0.55 + energy * 0.45}`;

            if (energy > 0) {
                aurora.style.filter = `blur(${30 - energy * 10}px) drop-shadow(0 0 ${10 + energy * 20}px rgba(180, 255, 220, 0.4))`;
            } else {
                aurora.style.filter = '';
            }
        }
    }

    applyPlanetGlow(energy) {
        if (!this.planetsContainer) return;

        if (energy <= 0) {
            this.planetsContainer.style.filter = '';
            this.planetsContainer.style.transform = '';
            return;
        }

        const glowRadius = 28 + energy * 35;
        const glowStrength = 0.28 + energy * 0.4;
        const scale = 1 + energy * 0.025;
        this.planetsContainer.style.filter = `brightness(${1 + energy * 0.2}) drop-shadow(0 0 ${glowRadius}px rgba(200, 150, 255, ${glowStrength}))`;
        this.planetsContainer.style.transform = `scale(${scale}) translateZ(0)`;
    }

    applyMountainGlow(energy) {
        if (this.mountainsDistant) {
            if (energy <= 0) {
                this.mountainsDistant.style.filter = '';
            } else {
                const distantGlow = 0.15 + energy * 0.18;
                this.mountainsDistant.style.filter = `brightness(${1 + energy * 0.28}) saturate(${1 + energy * 0.22}) drop-shadow(0 -12px ${22 + energy * 22}px rgba(180, 140, 255, ${distantGlow}))`;
            }
        }

        if (this.mountainsMid) {
            if (energy <= 0) {
                this.mountainsMid.style.filter = '';
            } else {
                const midGlow = 0.2 + energy * 0.22;
                this.mountainsMid.style.filter = `brightness(${1 + energy * 0.3}) saturate(${1 + energy * 0.28}) drop-shadow(0 -12px ${28 + energy * 26}px rgba(210, 170, 255, ${midGlow}))`;
            }
        }
    }

    applyTreeSway(energy) {
        const trees = [
            ...(this.forestLeft?.children || []),
            ...(this.forestRight?.children || []),
        ];

        if (!trees.length) return;

        if (energy <= 0) {
            for (const tree of trees) {
                const baseSway = parseFloat(tree.dataset.baseSway || 5);
                tree.style.setProperty('--sway-duration', `${baseSway}s`);
                tree.style.filter = '';
            }
            return;
        }

        for (const tree of trees) {
            const baseSway = parseFloat(tree.dataset.baseSway || 5);
            const swayDuration = Math.max(2.5, baseSway * (1 - energy * 0.35));
            tree.style.setProperty('--sway-duration', `${swayDuration}s`);
            tree.style.filter = `drop-shadow(0 0 ${5 + energy * 10}px rgba(220, 200, 255, ${0.28 + energy * 0.4}))`;
        }
    }

    applyGroundHaze(energy) {
        if (this.snowfield) {
            if (energy <= 0) {
                this.snowfield.style.filter = '';
            } else {
                this.snowfield.style.filter = `brightness(${0.95 + energy * 0.28}) saturate(${1 + energy * 0.22})`;
            }
        }

        if (this.fog) {
            if (energy <= 0) {
                this.fog.style.opacity = '';
                this.fog.style.filter = '';
            } else {
                this.fog.style.opacity = `${0.75 + energy * 0.25}`;
                this.fog.style.filter = `drop-shadow(0 0 ${12 + energy * 20}px rgba(180, 150, 220, ${0.18 + energy * 0.28}))`;
            }
        }
    }

    spawnShootingStar(intensity) {
        const targetLayer = this.comboLayer || this.starsContainer;
        if (!targetLayer) return;

        const shootingStar = document.createElement('div');
        shootingStar.className = 'lunara-shooting-star';

        const startX = Math.random() * 70 + 10;
        const startY = Math.random() * 35 + 10;
        const distance = 350 + Math.random() * 200 + intensity * 250;
        const fall = distance * (0.35 + Math.random() * 0.25);
        const angle = -18 + Math.random() * 14;

        shootingStar.style.setProperty('--start-x', `${startX}%`);
        shootingStar.style.setProperty('--start-y', `${startY}%`);
        shootingStar.style.setProperty('--distance-x', `${-distance}px`);
        shootingStar.style.setProperty('--distance-y', `${fall}px`);
        shootingStar.style.setProperty('--angle', `${angle}deg`);

        targetLayer.appendChild(shootingStar);
        this.scheduleEffectTimeout(() => shootingStar.remove(), 2500);
    }

    stop() {
        this.teardownEventListeners();

        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }

        this.comboAnimationRunning = false;
        this.comboIntensity = 0;
        this.comboTargetIntensity = 0;
        this.comboFlash = 0;
        this.clearEffectTimeouts();
        this.snowflakes = [];
        this.lockEffects = [];
        this.disposeComboParticles();
        this.clearTransientEffects();
        super.stop();
    }

    resume() {
        super.resume();
        this.setupEventListeners();
        this.startComboLoop();
        return true;
    }

    clearTransientEffects() {
        const layer = this.comboLayer || this.starsContainer;
        if (layer) {
            layer.querySelectorAll('.lunara-shooting-star').forEach((node) => node.remove());
        }

        if (this.effectsContainer) {
            this.effectsContainer.innerHTML = '';
        }

        this.applyComboVisuals();
    }

    lerp(start, end, t) {
        return start + (end - start) * t;
    }

    seededRandom(seed) {
        let s = seed;
        return () => {
            s = (s * 9301 + 49297) % 233280;
            return s / 233280;
        };
    }

    createPlanetAnchors(planetsContainer) {
        if (!planetsContainer) return;
        if (planetsContainer.querySelector('.lunara-planet-anchor')) return;

        const anchors = [
            { left: '34%', top: '20%', size: '18vw' },
            { left: '56%', top: '14%', size: '14vw' },
        ];

        anchors.forEach((anchorConfig) => {
            const anchor = document.createElement('div');
            anchor.className = 'lunara-planet-anchor';
            anchor.style.position = 'absolute';
            anchor.style.left = anchorConfig.left;
            anchor.style.top = anchorConfig.top;
            anchor.style.width = anchorConfig.size;
            anchor.style.height = anchorConfig.size;
            anchor.style.pointerEvents = 'none';
            anchor.style.opacity = '0';
            planetsContainer.appendChild(anchor);
        });
    }

    ensureComboLayer() {
        const themeContainer = document.getElementById('lunara-theme');
        if (!themeContainer) return null;

        let layer = document.getElementById('lunara-combo-layer');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'lunara-combo-layer';
            layer.className = 'lunara-combo-layer';
            layer.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 11;
                overflow: hidden;
            `;
            themeContainer.appendChild(layer);
            this.registerContainer(layer);
        } else {
            this.registerContainer(layer);
        }

        return layer;
    }

    getPlanetMeta() {
        const canvasEl = this.webglRenderer?.canvas;
        const canvasRect = canvasEl?.getBoundingClientRect?.();
        const canvasW = canvasEl?.width || window.innerWidth;
        const canvasH = canvasEl?.height || window.innerHeight;

        const normalizeToCanvas = (x, y) => {
            if (!canvasRect) return { x, y };
            const normX = ((x - canvasRect.left) / canvasRect.width) * canvasW;
            const normY = ((y - canvasRect.top) / canvasRect.height) * canvasH;
            return { x: normX, y: normY };
        };

        if (this.planetMeta && this.planetMeta.width && this.planetMeta.height) {
            const scaleX = canvasW / this.planetMeta.width;
            const scaleY = canvasH / this.planetMeta.height;
            return [
                {
                    center: { x: this.planetMeta.planet1.x * scaleX, y: this.planetMeta.planet1.y * scaleY },
                    radius: this.planetMeta.planet1.radius * Math.min(scaleX, scaleY),
                },
                {
                    center: { x: this.planetMeta.planet2.x * scaleX, y: this.planetMeta.planet2.y * scaleY },
                    radius: this.planetMeta.planet2.radius * Math.min(scaleX, scaleY),
                },
            ];
        }

        const anchors = Array.from(document.querySelectorAll('.lunara-planet-anchor'));
        if (!anchors.length) {
            return [
                {
                    center: normalizeToCanvas(canvasW * 0.35, canvasH * 0.25),
                    radius: Math.min(window.innerWidth, window.innerHeight) * 0.12,
                },
                {
                    center: normalizeToCanvas(canvasW * 0.55, canvasH * 0.2),
                    radius: Math.min(window.innerWidth, window.innerHeight) * 0.08,
                },
            ];
        }

        return anchors.map((anchor) => {
            const rect = anchor.getBoundingClientRect();
            const radiusScale = canvasRect ? (canvasW / canvasRect.width) : 1;
            const radius = Math.max(rect.width, rect.height) * 0.5 * radiusScale;
            const { x, y } = normalizeToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return {
                center: { x, y },
                radius,
            };
        });
    }

    spawnPlanetParticleBurst(comboCount, intensity) {
        if (!this.webglRenderer || typeof this.webglRenderer.addCustomParticles !== 'function') return;

        const planets = this.getPlanetMeta();
        const planetConfigs = [
            { color: [0.78, 0.54, 0.98], bias: 1.0 },
            { color: [0.98, 0.56, 0.78], bias: 0.95 },
        ];

        const baseParticles = this.activePreset.planetBurstParticles;

        planets.forEach((planet, index) => {
            const { center, radius } = planet;
            const boost = planetConfigs[index] ? planetConfigs[index].bias : 1;
            const color = planetConfigs[index] ? planetConfigs[index].color : [0.86, 0.78, 1.0];
            const particleCount = Math.min(baseParticles + comboCount * 8 * boost, 170);
            const baseRadius = radius || (Math.min(window.innerWidth, window.innerHeight) * 0.1);
            const ringRadius = baseRadius * (1.0 + intensity * 1.05);

            const config = {
                behavior: 'spiraling-debris',
                lifetime: 320,
                minSize: 3.8,
                maxSize: 8.0,
                minAlpha: 0.65,
                maxAlpha: 1.05,
                radiusXRange: [ringRadius * 0.9, ringRadius * 1.05],
                radiusYRange: [ringRadius * 0.9, ringRadius * 1.05],
                speedRange: [0.01, 0.03],
                clockwiseProbability: 0.6,
                centerPoints: [center],
                zIndex: -0.05,
                color,
            };

            const system = this.webglRenderer.addCustomParticles(particleCount, config);
            if (system) {
                this.comboParticleSystems.push(system);
                const timeout = setTimeout(() => {
                    this.webglRenderer.removeParticleSystem(system);
                }, 2800);
                this.comboParticleTimeouts.push(timeout);
            }

            // Sparkling halo
            const sparkleConfig = {
                behavior: 'spiraling-debris',
                lifetime: 140,
                minSize: 3.0,
                maxSize: 6.5,
                minAlpha: 0.55,
                maxAlpha: 1.2,
                radiusXRange: [ringRadius * 0.7, ringRadius * 0.9],
                radiusYRange: [ringRadius * 0.7, ringRadius * 0.9],
                speedRange: [0.012, 0.035],
                clockwiseProbability: 0.55,
                centerPoints: [center],
                zIndex: -0.03,
                color,
            };

            const sparkleSystem = this.webglRenderer.addCustomParticles(
                Math.min(30 + comboCount * 5, 90),
                sparkleConfig,
            );
            if (sparkleSystem) {
                this.comboParticleSystems.push(sparkleSystem);
                const timeout = setTimeout(() => {
                    this.webglRenderer.removeParticleSystem(sparkleSystem);
                }, 2000);
                this.comboParticleTimeouts.push(timeout);
            }
        });
    }

    disposeComboParticles() {
        if (this.comboParticleTimeouts.length) {
            this.comboParticleTimeouts.forEach((id) => clearTimeout(id));
            this.comboParticleTimeouts = [];
        }

        if (this.webglRenderer && typeof this.webglRenderer.removeParticleSystem === 'function') {
            this.comboParticleSystems.forEach((system) => this.webglRenderer.removeParticleSystem(system));
        }
        this.comboParticleSystems = [];
    }
}
