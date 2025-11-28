/**
 * @fileoverview Lunara Theme - Mystical winter scene with twin planets, aurora, and snowy forests
 */

import { BaseTheme } from '../base-theme.js';
import { lunaraBackgroundCache } from '../../utils/cache.js';
import { LUNARA_TETROMINOS } from './lunara-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

/**
 * Lunara Theme
 * Features:
 * - Twinkling starfield
 * - Aurora-like streaks
 * - Twin planets (purple and pink) with glow effects
 * - Distant and mid-ground purple mountains
 * - Snow-covered pine trees on both sides
 */
export default class LunaraTheme extends BaseTheme {
    constructor() {
        super('lunara');
        this.comboIntensity = 0;
        this.comboTargetIntensity = 0;
        this.comboFlash = 0;
        this.comboAnimationRunning = false;
        this.eventUnsubscribers = [];
        this.pendingComboCount = 0;

        // Initialize combo particle arrays
        this.comboParticleSystems = [];
        this.comboParticleTimeouts = [];

        // Cached containers for combo-driven adjustments
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
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        // 1. Create twinkling stars (optimized count for performance)
        const starsContainer = this.getContainer('lunara-stars');
        if (starsContainer && starsContainer.children.length === 0) {
            const starCount = 100; // Reduced from 200 for better performance
            for (let i = 0; i < starCount; i++) {
                const star = document.createElement('div');
                star.className = 'lunara-star';
                const size = Math.random() * 2 + 0.5;
                star.style.width = `${size}px`;
                star.style.height = `${size}px`;
                star.style.left = `${Math.random() * 100}%`;
                star.style.top = `${Math.random() * 100}%`;
                star.style.setProperty('--twinkle-duration', `${Math.random() * 3 + 2}s`);
                star.style.setProperty('--twinkle-delay', `${Math.random() * 5}s`);
                starsContainer.appendChild(star);
            }
        }

        // 2. Create aurora-like streaks
        const auroraContainer = this.getContainer('lunara-aurora');
        if (auroraContainer && auroraContainer.children.length === 0) {
            const auroraCount = 5;
            for (let i = 0; i < auroraCount; i++) {
                const aurora = document.createElement('div');
                aurora.className = 'lunara-aurora';
                const auroraDuration = Math.random() * 10 + 15;
                aurora.style.left = `${Math.random() * 100}%`;
                aurora.style.top = `${Math.random() * 40}%`;
                aurora.style.setProperty('--aurora-duration', `${auroraDuration}s`);
                aurora.style.setProperty('--aurora-delay', `${Math.random() * 5}s`);
                aurora.dataset.baseDuration = auroraDuration;
                auroraContainer.appendChild(aurora);
            }
        }

        // 3. Create twin planets with glow
        const planetsContainer = this.getContainer('lunara-planets');
        if (planetsContainer && planetsContainer.children.length === 0) {
            const cacheKey = 'lunara-planets-canvas';

            if (lunaraBackgroundCache.has(cacheKey)) {
                const cached = lunaraBackgroundCache.get(cacheKey);
                if (cached && typeof cached === 'object') {
                    planetsContainer.style.backgroundImage = cached.image;
                    this.planetMeta = cached.meta;
                } else {
                    planetsContainer.style.backgroundImage = cached;
                    // Fallback metadata to match draw positions when cache lacks meta
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

                // Draw glow
                const glow1 = ctx.createRadialGradient(
                    planet1X,
                    planet1Y,
                    planet1Radius * 0.8,
                    planet1X,
                    planet1Y,
                    planet1Radius * 1.5,
                );
                glow1.addColorStop(0, 'rgba(200, 150, 255, 0.3)');
                glow1.addColorStop(1, 'rgba(200, 150, 255, 0)');
                ctx.fillStyle = glow1;
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw planet
                const planet1Grad = ctx.createRadialGradient(
                    planet1X - planet1Radius * 0.3,
                    planet1Y - planet1Radius * 0.3,
                    planet1Radius * 0.2,
                    planet1X,
                    planet1Y,
                    planet1Radius,
                );
                planet1Grad.addColorStop(0, '#d8b5ff');
                planet1Grad.addColorStop(0.5, '#a855f7');
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
                    planet2Radius * 1.5,
                );
                glow2.addColorStop(0, 'rgba(255, 200, 240, 0.3)');
                glow2.addColorStop(1, 'rgba(255, 200, 240, 0)');
                ctx.fillStyle = glow2;
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw planet
                const planet2Grad = ctx.createRadialGradient(
                    planet2X - planet2Radius * 0.3,
                    planet2Y - planet2Radius * 0.3,
                    planet2Radius * 0.2,
                    planet2X,
                    planet2Y,
                    planet2Radius,
                );
                planet2Grad.addColorStop(0, '#ffd4f0');
                planet2Grad.addColorStop(0.5, '#f472b6');
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
                planetsContainer.style.backgroundImage = dataURL;
            }

            this.createPlanetAnchors(planetsContainer);
        }

        // 4. Create distant mountains with caching
        const mountainsDistant = this.getContainer('lunara-mountains-distant');
        if (mountainsDistant) {
            const cacheKey = 'lunara-mountains-distant-3000x600';

            if (lunaraBackgroundCache.has(cacheKey)) {
                const cachedData = lunaraBackgroundCache.get(cacheKey);
                mountainsDistant.style.backgroundImage = cachedData.backgroundImage;
                mountainsDistant.style.backgroundSize = cachedData.backgroundSize;
            } else {
                const rng = this.seededRandom(33333);
                const canvas = document.createElement('canvas');
                canvas.width = 3000;
                canvas.height = 600;
                const ctx = canvas.getContext('2d');

                const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
                gradient.addColorStop(0, '#b794f6');
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
                mountainsDistant.style.backgroundImage = backgroundImage;
                mountainsDistant.style.backgroundSize = backgroundSize;
            }
        }

        // 5. Create mid-ground mountains
        const mountainsMid = this.getContainer('lunara-mountains-mid');
        if (mountainsMid) {
            const cacheKey = 'lunara-mountains-mid-3000x700';

            if (lunaraBackgroundCache.has(cacheKey)) {
                const cachedData = lunaraBackgroundCache.get(cacheKey);
                mountainsMid.style.backgroundImage = cachedData.backgroundImage;
                mountainsMid.style.backgroundSize = cachedData.backgroundSize;
            } else {
                const rng = this.seededRandom(44444);
                const canvas = document.createElement('canvas');
                canvas.width = 3000;
                canvas.height = 700;
                const ctx = canvas.getContext('2d');

                const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
                gradient.addColorStop(0, '#9f7aea');
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
                mountainsMid.style.backgroundImage = backgroundImage;
                mountainsMid.style.backgroundSize = backgroundSize;
            }
        }

        // 6. Create snow-covered pine trees (left side)
        const forestLeft = this.getContainer('lunara-forest-left');
        if (forestLeft && forestLeft.children.length === 0) {
            const treeCount = 8;
            for (let i = 0; i < treeCount; i++) {
                const tree = document.createElement('div');
                tree.className = 'lunara-tree';
                const height = Math.random() * 200 + 250;
                const swayDuration = Math.random() * 3 + 4;
                tree.style.height = `${height}px`;
                tree.style.left = `${i * 12}%`;
                tree.style.bottom = '0';
                tree.style.setProperty('--sway-duration', `${swayDuration}s`);
                tree.style.setProperty('--sway-delay', `${Math.random() * 2}s`);
                tree.dataset.baseSway = swayDuration;
                forestLeft.appendChild(tree);
            }
        }

        // 7. Create snow-covered pine trees (right side)
        const forestRight = this.getContainer('lunara-forest-right');
        if (forestRight && forestRight.children.length === 0) {
            const treeCount = 8;
            for (let i = 0; i < treeCount; i++) {
                const tree = document.createElement('div');
                tree.className = 'lunara-tree';
                const height = Math.random() * 200 + 250;
                const swayDuration = Math.random() * 3 + 4;
                tree.style.height = `${height}px`;
                tree.style.right = `${i * 12}%`;
                tree.style.bottom = '0';
                tree.style.setProperty('--sway-duration', `${swayDuration}s`);
                tree.style.setProperty('--sway-delay', `${Math.random() * 2}s`);
                tree.dataset.baseSway = swayDuration;
                forestRight.appendChild(tree);
            }
        }

        // Cache containers for live combo adjustments
        this.skyContainer = this.getContainer('lunara-sky');
        this.starsContainer = this.getContainer('lunara-stars');
        this.auroraContainer = this.getContainer('lunara-aurora');
        this.planetsContainer = this.getContainer('lunara-planets');
        this.mountainsDistant = mountainsDistant || this.getContainer('lunara-mountains-distant');
        this.mountainsMid = mountainsMid || this.getContainer('lunara-mountains-mid');
        this.forestLeft = forestLeft || this.getContainer('lunara-forest-left');
        this.forestRight = forestRight || this.getContainer('lunara-forest-right');
        this.snowfield = this.getContainer('lunara-snowfield');
        this.fog = this.getContainer('lunara-fog');
        this.comboLayer = this.ensureComboLayer();

        this.setupEventListeners();
        this.startComboLoop();
    }

    /**
     * Provide Lunara themed tetromino styling (moonlit alpine palette)
     * @returns {Object} Lunara tetromino configuration
     */
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

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub);
    }

    teardownEventListeners() {
        if (!this.eventUnsubscribers.length) {
            return;
        }

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

    onLineClear(lineCount, comboCount) {
        const normalizedCombo = Math.min(comboCount / 8, 1);
        const lineBoost = Math.min(lineCount / 6, 0.6);
        const targetBoost = Math.min(1, (normalizedCombo * 0.85) + (lineBoost * 0.35) + 0.1);

        this.comboTargetIntensity = Math.max(this.comboTargetIntensity, targetBoost);
        this.comboFlash = Math.min(1, this.comboFlash + 0.35 + normalizedCombo * 0.45);

        const streaksToSpawn = comboCount >= 4 ? 2 : 1;
        for (let i = 0; i < streaksToSpawn; i++) {
            this.spawnShootingStar(normalizedCombo);
        }

        if (comboCount >= 2) {
            this.spawnPlanetParticleBurst(comboCount, normalizedCombo);
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

        const brightness = 1 + energy * 0.12 + flash * 0.25;
        const saturation = 1 + energy * 0.2;
        this.skyContainer.style.filter = `saturate(${saturation}) brightness(${brightness})`;
        this.starsContainer.style.filter = `brightness(${1 + energy * 0.3 + flash * 0.4})`;
    }

    applyAuroraPulse(energy) {
        if (!this.auroraContainer) return;

        for (const aurora of this.auroraContainer.children) {
            const baseDuration = parseFloat(aurora.dataset.baseDuration || 20);
            const spedUp = Math.max(10, baseDuration * (1 - energy * 0.35));
            aurora.style.setProperty('--aurora-duration', `${spedUp}s`);
            aurora.style.opacity = `${0.6 + energy * 0.4}`;
            aurora.style.filter = `blur(${30 - energy * 8}px) drop-shadow(0 0 ${8 + energy * 16}px rgba(220, 180, 255, 0.35))`;
        }
    }

    applyPlanetGlow(energy) {
        if (!this.planetsContainer) return;

        if (energy <= 0) {
            this.planetsContainer.style.filter = '';
            this.planetsContainer.style.transform = '';
            return;
        }

        const glowRadius = 25 + energy * 30;
        const glowStrength = 0.25 + energy * 0.35;
        const scale = 1 + energy * 0.02;
        this.planetsContainer.style.filter = `brightness(${1 + energy * 0.18}) drop-shadow(0 0 ${glowRadius}px rgba(200, 150, 255, ${glowStrength}))`;
        this.planetsContainer.style.transform = `scale(${scale}) translateZ(0)`;
    }

    applyMountainGlow(energy) {
        if (this.mountainsDistant) {
            if (energy <= 0) {
                this.mountainsDistant.style.filter = '';
            } else {
                const distantGlow = 0.12 + energy * 0.15;
                this.mountainsDistant.style.filter = `brightness(${1 + energy * 0.25}) saturate(${1 + energy * 0.2}) drop-shadow(0 -10px ${20 + energy * 20}px rgba(180, 140, 255, ${distantGlow}))`;
            }
        }

        if (this.mountainsMid) {
            if (energy <= 0) {
                this.mountainsMid.style.filter = '';
            } else {
                const midGlow = 0.18 + energy * 0.2;
                this.mountainsMid.style.filter = `brightness(${1 + energy * 0.28}) saturate(${1 + energy * 0.25}) drop-shadow(0 -10px ${26 + energy * 24}px rgba(210, 170, 255, ${midGlow}))`;
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
            tree.style.filter = `drop-shadow(0 0 ${4 + energy * 8}px rgba(220, 200, 255, ${0.25 + energy * 0.35}))`;
        }
    }

    applyGroundHaze(energy) {
        if (this.snowfield) {
            if (energy <= 0) {
                this.snowfield.style.filter = '';
            } else {
                this.snowfield.style.filter = `brightness(${0.95 + energy * 0.25}) saturate(${1 + energy * 0.2})`;
            }
        }

        if (this.fog) {
            if (energy <= 0) {
                this.fog.style.opacity = '';
                this.fog.style.filter = '';
            } else {
                this.fog.style.opacity = `${0.75 + energy * 0.25}`;
                this.fog.style.filter = `drop-shadow(0 0 ${10 + energy * 18}px rgba(180, 150, 220, ${0.15 + energy * 0.25}))`;
            }
        }
    }

    spawnShootingStar(intensity) {
        const targetLayer = this.comboLayer || this.starsContainer;
        if (!targetLayer) return;

        const shootingStar = document.createElement('div');
        shootingStar.className = 'lunara-shooting-star';

        const startX = Math.random() * 70 + 10; // percent
        const startY = Math.random() * 35 + 10;
        const distance = 320 + Math.random() * 180 + intensity * 220;
        const fall = distance * (0.38 + Math.random() * 0.22);
        const angle = -16 + Math.random() * 12;

        shootingStar.style.setProperty('--start-x', `${startX}%`);
        shootingStar.style.setProperty('--start-y', `${startY}%`);
        shootingStar.style.setProperty('--distance-x', `${-distance}px`);
        shootingStar.style.setProperty('--distance-y', `${fall}px`);
        shootingStar.style.setProperty('--angle', `${angle}deg`);

        targetLayer.appendChild(shootingStar);
        setTimeout(() => shootingStar.remove(), 2400);
    }

    stop() {
        this.teardownEventListeners();
        this.comboAnimationRunning = false;
        this.comboIntensity = 0;
        this.comboTargetIntensity = 0;
        this.comboFlash = 0;
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
        this.applyComboVisuals();
    }

    lerp(start, end, t) {
        return start + (end - start) * t;
    }

    createPlanetAnchors(planetsContainer) {
        if (!planetsContainer) return;
        if (planetsContainer.querySelector('.lunara-planet-anchor')) return;

        const anchors = [
            { left: '34%', top: '20%', size: '18vw' }, // Large planet
            { left: '56%', top: '14%', size: '14vw' }, // Small planet
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
            layer.style.position = 'absolute';
            layer.style.top = '0';
            layer.style.left = '0';
            layer.style.width = '100%';
            layer.style.height = '100%';
            layer.style.pointerEvents = 'none';
            layer.style.zIndex = '11';
            layer.style.overflow = 'hidden';
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
            { color: [0.78, 0.54, 0.98], bias: 1.0 }, // Purple planet
            { color: [0.98, 0.56, 0.78], bias: 0.95 }, // Pink planet
        ];

        planets.forEach((planet, index) => {
            const { center, radius } = planet;
            const boost = planetConfigs[index] ? planetConfigs[index].bias : 1;
            const color = planetConfigs[index] ? planetConfigs[index].color : [0.86, 0.78, 1.0];
            const particleCount = Math.min(55 + comboCount * 10 * boost, 170);
            const baseRadius = radius || (Math.min(window.innerWidth, window.innerHeight) * 0.1);
            const ringRadius = baseRadius * (1.0 + intensity * 1.05); // ring centered to planet radius

            const config = {
                behavior: 'spiraling-debris',
                lifetime: 320, // frames
                minSize: 3.8,
                maxSize: 8.0,
                minAlpha: 0.65,
                maxAlpha: 1.05, // brighter steady glow
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

            // Sparkling halo (adds flicker/glow)
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
