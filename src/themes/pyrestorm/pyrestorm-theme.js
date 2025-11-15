import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { PYRESTORM_TETROMINOS } from './pyrestorm-tetrominos.js';

export default class PyrestormTheme extends BaseTheme {
    constructor() {
        super('pyrestorm');

        // Canvas references
        this.effectsCanvas = null;
        this.effectsCtx = null;

        // Animation state
        this.animationTime = 0;
        this.eventUnsubscribers = [];

        // Combo effects arrays
        this.eruptionBursts = [];
        this.flameGeysers = [];
        this.moltenSparkles = [];
        this.lightningBolts = [];
        this.emberSwarms = [];
        this.lavaBursts = []; // Volcanic lava bursts from peaks

        // Effect intensities
        this.volcanoGlowIntensity = 0;
        this.heatIntensity = 0;
        this.comboMultiplier = 1.0;
        this.comboCooldownMs = 220;
        this.lastEffectEventTime = 0;

        // Frame timing for adaptive throttling
        this.lastFrameTime = 0;
        this.frameTimeAccumulator = 0;
        this.frameTimeCount = 0;
        this.averageFrameTime = 16.67;

        // Mountain layer references for glow effects
        this.mountainLayers = [];
        this.lavaRiversContainer = null;
        this.embersContainer = null;
        this.smokeContainer = null;

        // Performance limits - optimized for better FPS
        this.MAX_BURSTS = 3;
        this.MAX_GEYSERS = 5;
        this.MAX_SPARKLES = 80;
        this.MAX_LIGHTNING = 2;
        this.MAX_SWARMS = 40;
        this.MAX_LAVA_BURSTS = 4;

        // Graphics quality state
        this.qualityChangeHandler = null;
        this.qualityPresets = {
            'Low': {
                lavaRivers: 4,
                emberCount: 60,
                smokePlumes: 6,
                maxBursts: 2,
                maxGeysers: 3,
                maxSparkles: 50,
                maxLightning: 1,
                maxSwarms: 20,
                maxLavaBursts: 2,
            },
            'Medium': {
                lavaRivers: 6,
                emberCount: 90,
                smokePlumes: 10,
                maxBursts: 3,
                maxGeysers: 4,
                maxSparkles: 70,
                maxLightning: 2,
                maxSwarms: 30,
                maxLavaBursts: 3,
            },
            'High': {
                lavaRivers: 8,
                emberCount: 120,
                smokePlumes: 15,
                maxBursts: 3,
                maxGeysers: 5,
                maxSparkles: 80,
                maxLightning: 2,
                maxSwarms: 40,
                maxLavaBursts: 4,
            },
            'Ultra': {
                lavaRivers: 12,
                emberCount: 180,
                smokePlumes: 22,
                maxBursts: 5,
                maxGeysers: 7,
                maxSparkles: 110,
                maxLightning: 3,
                maxSwarms: 60,
                maxLavaBursts: 6,
            }
        };

        this.currentQuality = 'High';
        this.activePreset = this.qualityPresets['High'];
    }

    applyQualityPreset(quality) {
        if (!this.qualityPresets[quality]) {
            console.warn(`Pyrestorm: Unknown quality preset "${quality}", defaulting to High`);
            quality = 'High';
        }

        this.currentQuality = quality;
        this.activePreset = this.qualityPresets[quality];

        const preset = this.activePreset;
        this.MAX_BURSTS = preset.maxBursts;
        this.MAX_GEYSERS = preset.maxGeysers;
        this.MAX_SPARKLES = preset.maxSparkles;
        this.MAX_LIGHTNING = preset.maxLightning;
        this.MAX_SWARMS = preset.maxSwarms;
        this.MAX_LAVA_BURSTS = preset.maxLavaBursts;

        this.trimEffectCollections();

        console.log(`🔥 Pyrestorm: Applying ${quality} quality preset`);
    }

    trimEffectCollections() {
        const clamp = (collection, limit) => {
            if (!collection || typeof limit !== 'number') return;
            if (collection.length > limit) {
                collection.splice(0, collection.length - limit);
            }
        };

        clamp(this.eruptionBursts, this.MAX_BURSTS);
        clamp(this.flameGeysers, this.MAX_GEYSERS);
        clamp(this.moltenSparkles, this.MAX_SPARKLES);
        clamp(this.lightningBolts, this.MAX_LIGHTNING);
        clamp(this.emberSwarms, this.MAX_SWARMS);
        clamp(this.lavaBursts, this.MAX_LAVA_BURSTS);
    }

    shouldThrottleEffects() {
        const now = Date.now();
        const timeSinceLastEffect = now - this.lastEffectEventTime;
        const performanceDrop = this.averageFrameTime > 24;
        const sparklePressure = this.moltenSparkles.length >= this.MAX_SPARKLES * 0.85;
        const emberPressure = this.emberSwarms.length >= this.MAX_SWARMS * 0.85;
        const burstPressure = this.eruptionBursts.length >= this.MAX_BURSTS;

        return (
            performanceDrop ||
            sparklePressure ||
            emberPressure ||
            burstPressure ||
            timeSinceLastEffect < this.comboCooldownMs
        );
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    setupQualityListener() {
        if (typeof window === 'undefined') return;

        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
        }

        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (!newQuality || newQuality === this.currentQuality) return;

            this.applyQualityPreset(newQuality);
            this.refreshQualityDependentElements();
        };

        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    refreshQualityDependentElements() {
        this.createLavaRivers(true);
        this.createEmbers(true);
        this.createSmokePlumes(true);
        this.trimEffectCollections();
    }

    async createScene() {
        const quality = this.getGraphicsQuality();
        this.applyQualityPreset(quality);

        // Create all base scene elements
        this.createVolcanoes();
        this.createLavaRivers(true);
        this.createEmbers(true);
        this.createSmokePlumes(true);

        // Setup combo effects canvas
        this.setupComboEffects();

        // Setup event listeners for gameplay effects
        this.setupEventListeners();

        // Listen for graphics quality changes
        this.setupQualityListener();

        // Start animation loop
        this.animate();
    }

    createVolcanoes() {
        const volcanoContainer = this.getContainer('pyrestorm-volcano-peaks');
        if (!volcanoContainer || volcanoContainer.children.length > 0) return;

        // Create layered volcanic mountains with depth (inspired by mountain theme)
        const volcanoLayers = [
            {
                color: '#2d1810', // Distant volcanic brown
                glowColor: '#ff4500',
                height: 0.5,
                peaks: 4,
                jaggedness: 0.4,
                opacity: 0.7,
                zIndex: 1
            },
            {
                color: '#1a0f08', // Mid-distance volcanic rock
                glowColor: '#ff6b1a',
                height: 0.65,
                peaks: 6,
                jaggedness: 0.6,
                opacity: 0.85,
                zIndex: 2
            },
            {
                color: '#0a0000', // Closest darkest volcanic silhouette
                glowColor: '#ff8c00',
                height: 0.8,
                peaks: 8,
                jaggedness: 0.8,
                opacity: 1.0,
                zIndex: 3
            }
        ];

        volcanoLayers.forEach((layer, layerIndex) => {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            svg.setAttribute('viewBox', '0 0 100 60');
            svg.setAttribute('preserveAspectRatio', 'none');
            svg.style.position = 'absolute';
            svg.style.bottom = '0';
            svg.style.left = '0';
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.zIndex = layer.zIndex;
            svg.style.opacity = layer.opacity;

            // Generate volcanic peaks for this layer
            const peaks = this.generateVolcanicPeaks(layer.height, layer.peaks, layer.jaggedness);

            // Create main mountain path
            const mountainPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            mountainPath.setAttribute('d', peaks.pathData);
            mountainPath.setAttribute('fill', layer.color);
            mountainPath.setAttribute('stroke', 'none');
            svg.appendChild(mountainPath);

            // Add subtle glowing edge to suggest volcanic heat (only on front two layers)
            if (layerIndex >= 1) {
                const glowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                glowPath.setAttribute('d', peaks.pathData);
                glowPath.setAttribute('fill', 'none');
                glowPath.setAttribute('stroke', layer.glowColor);
                glowPath.setAttribute('stroke-width', '0.3');
                glowPath.setAttribute('opacity', '0.4');
                glowPath.style.filter = 'blur(1.5px)';
                svg.appendChild(glowPath);
            }

            volcanoContainer.appendChild(svg);

            // Store reference for glow effects
            this.mountainLayers.push({
                svg,
                glowColor: layer.glowColor,
                layerIndex
            });
        });
    }

    generateVolcanicPeaks(heightMultiplier, peakCount, jaggedness) {
        const peakPositions = [];
        let pathData = 'M 0 60 '; // Start at bottom left

        const baseY = 60;
        const spacing = 100 / peakCount;
        let currentX = 0;

        // Generate peaks with semi-smooth curves and volcanic edges
        for (let i = 0; i < peakCount; i++) {
            const peakX = (i + 0.5) * spacing;
            const peakHeight = (22 + Math.random() * 20) * heightMultiplier;
            const peakY = baseY - peakHeight;
            const peakWidth = spacing * (0.7 + Math.random() * 0.3);

            const leftX = peakX - peakWidth / 2;
            const rightX = peakX + peakWidth / 2;

            // Ascent to peak - use mix of curves and lines for semi-smooth look
            const ascentPoints = 2;
            for (let j = 0; j < ascentPoints; j++) {
                const progress = (j + 1) / (ascentPoints + 1);
                const x = currentX + (leftX - currentX) * progress;
                const y = baseY - (baseY - peakY) * progress * progress; // Ease curve

                // Add controlled jitter for volcanic roughness
                const jitter = (Math.random() - 0.5) * jaggedness * 3;

                if (j === 0) {
                    // Use quadratic curve for smoother transitions
                    const cpx = (currentX + x) / 2;
                    const cpy = (baseY + y) / 2 + jitter;
                    pathData += `Q ${cpx} ${cpy}, ${x} ${y + jitter} `;
                } else {
                    pathData += `L ${x + jitter} ${y + jitter} `;
                }
            }

            // Sharp peak with slight curve
            const peakJitter = (Math.random() - 0.5) * jaggedness * 1.5;
            const prePeakX = leftX + (peakX - leftX) * 0.8;
            const prePeakY = peakY + (baseY - peakY) * 0.2;
            pathData += `L ${prePeakX} ${prePeakY} `;
            pathData += `L ${peakX + peakJitter} ${peakY} `;
            peakPositions.push({ x: peakX, y: peakY });

            // Descent from peak - smoother on the way down
            const descentPoints = 2;
            for (let j = 0; j < descentPoints; j++) {
                const progress = (j + 1) / (descentPoints + 1);
                const x = peakX + (rightX - peakX) * progress;
                const y = peakY + (baseY - peakY) * progress;

                const jitter = (Math.random() - 0.5) * jaggedness * 2.5;

                if (j === descentPoints - 1) {
                    // Smooth curve into valley
                    const cpx = (x + rightX) / 2;
                    const cpy = (y + baseY) / 2 + jitter;
                    pathData += `Q ${cpx} ${cpy}, ${x + jitter} ${y + jitter} `;
                } else {
                    pathData += `L ${x + jitter} ${y + jitter} `;
                }
            }

            currentX = rightX;
        }

        // Close path
        pathData += 'L 100 60 Z';

        return { pathData, peakPositions };
    }

    updateMountainGlow() {
        // Apply volcanic glow to mountain layers with increasing intensity from back to front

        this.mountainLayers.forEach(({ svg, glowColor, layerIndex }) => {
            if (this.volcanoGlowIntensity > 0) {
                // Intensity increases for closer layers
                const layerMultiplier = layerIndex === 0 ? 6 : layerIndex === 1 ? 10 : 15;
                const glowBlur = this.volcanoGlowIntensity * layerMultiplier;

                // Brightest layers get double drop-shadow for extra intensity
                if (layerIndex >= 2) {
                    svg.style.filter = `drop-shadow(0 0 ${glowBlur}px ${glowColor}) drop-shadow(0 0 ${glowBlur * 0.6}px ${glowColor})`;
                } else if (layerIndex === 1) {
                    svg.style.filter = `drop-shadow(0 0 ${glowBlur}px ${glowColor}) drop-shadow(0 0 ${glowBlur * 0.4}px ${glowColor})`;
                } else {
                    svg.style.filter = `drop-shadow(0 0 ${glowBlur}px ${glowColor})`;
                }
            } else {
                svg.style.filter = '';
            }
        });
    }

    createLavaRivers(force = false) {
        if (!this.lavaRiversContainer) {
            this.lavaRiversContainer = this.getContainer('pyrestorm-lava-rivers');
        }

        const lavaRiversContainer = this.lavaRiversContainer;
        if (!lavaRiversContainer) return;
        if (!force && lavaRiversContainer.children.length > 0) return;

        lavaRiversContainer.textContent = '';

        // Position behind front mountains (z-index 3) and in front of mid mountains (z-index 2)
        lavaRiversContainer.style.zIndex = '2.5';

        const riverCount = this.activePreset?.lavaRivers ?? 8;
        const spacing = riverCount > 1 ? 100 / (riverCount - 1) : 0;

        for (let i = 0; i < riverCount; i++) {
            const river = document.createElement('div');
            river.className = 'pyrestorm-lava-river';
            const left = riverCount > 1 ? Math.min(100, spacing * i) : 50;
            river.style.left = `${left}%`;
            river.style.setProperty('--flow-speed', `${10 + Math.random() * 10}s`);
            river.style.animationDelay = `${Math.random() * 5}s`;
            river.style.width = `${100 + Math.random() * 100}px`;

            // Add lava splashes
            const splashCount = 2 + Math.floor(Math.random() * 3);
            for (let j = 0; j < splashCount; j++) {
                const splash = document.createElement('div');
                splash.className = 'pyrestorm-lava-splash';
                splash.style.left = `${Math.random() * 100}%`;
                splash.style.bottom = `${20 + Math.random() * 40}%`;
                splash.style.setProperty('--splash-duration', `${2 + Math.random() * 3}s`);
                splash.style.setProperty('--splash-delay', `${Math.random() * 4}s`);
                river.appendChild(splash);
            }

            lavaRiversContainer.appendChild(river);
        }
    }

    createForegroundRocks() {
        const rocksContainer = this.getContainer('pyrestorm-foreground-rocks');
        if (!rocksContainer || rocksContainer.children.length > 0) return;

        const rockCount = 6;
        const rockPositions = [5, 18, 35, 55, 72, 88];

        for (let i = 0; i < rockCount; i++) {
            const rock = document.createElement('div');
            rock.className = 'pyrestorm-rock';
            const width = 80 + Math.random() * 120;
            const height = 100 + Math.random() * 150;
            rock.style.width = `${width}px`;
            rock.style.height = `${height}px`;
            rock.style.left = `${rockPositions[i]}%`;

            // Add glowing cracks
            const crackCount = 1 + Math.floor(Math.random() * 3);
            for (let j = 0; j < crackCount; j++) {
                const crack = document.createElement('div');
                crack.className = 'pyrestorm-rock-crack';
                crack.style.top = `${20 + Math.random() * 60}%`;
                crack.style.setProperty('--crack-duration', `${3 + Math.random() * 3}s`);
                crack.style.setProperty('--crack-delay', `${Math.random() * 4}s`);
                rock.appendChild(crack);
            }

            rocksContainer.appendChild(rock);
        }
    }

    createEmbers(force = false) {
        if (!this.embersContainer) {
            this.embersContainer = this.getContainer('pyrestorm-embers');
        }

        const embersContainer = this.embersContainer;
        if (!embersContainer) return;
        if (!force && embersContainer.children.length > 0) return;

        embersContainer.textContent = '';

        const emberCount = this.activePreset?.emberCount ?? 100;

        for (let i = 0; i < emberCount; i++) {
            const ember = document.createElement('div');
            ember.className = 'pyrestorm-ember';
            const size = 2 + Math.random() * 4;
            ember.style.width = `${size}px`;
            ember.style.height = `${size}px`;
            ember.style.left = `${Math.random() * 100}%`;
            ember.style.bottom = `${Math.random() * 30}%`;
            ember.style.setProperty('--ember-duration', `${8 + Math.random() * 12}s`);
            ember.style.setProperty('--ember-delay', `${Math.random() * 10}s`);
            ember.style.setProperty('--ember-drift', `${-50 + Math.random() * 100}px`);
            embersContainer.appendChild(ember);
        }
    }

    createSmokePlumes(force = false) {
        if (!this.smokeContainer) {
            this.smokeContainer = this.getContainer('pyrestorm-smoke');
        }

        const smokeContainer = this.smokeContainer;
        if (!smokeContainer) return;
        if (!force && smokeContainer.children.length > 0) return;

        smokeContainer.textContent = '';

        const smokeCount = this.activePreset?.smokePlumes ?? 15;

        for (let i = 0; i < smokeCount; i++) {
            const smoke = document.createElement('div');
            smoke.className = 'pyrestorm-smoke-plume';
            smoke.style.left = `${Math.random() * 100}%`;
            smoke.style.bottom = `${Math.random() * 40}%`;
            const width = 150 + Math.random() * 200;
            const height = 250 + Math.random() * 150;
            smoke.style.width = `${width}px`;
            smoke.style.height = `${height}px`;
            smoke.style.setProperty('--smoke-duration', `${12 + Math.random() * 15}s`);
            smoke.style.setProperty('--smoke-delay', `${Math.random() * 12}s`);
            smoke.style.setProperty('--smoke-drift', `${-100 + Math.random() * 200}px`);
            smokeContainer.appendChild(smoke);
        }
    }

    setupComboEffects() {
        const themeContainer = this.getContainer('pyrestorm-theme');
        if (!themeContainer) return;

        // Create canvas for combo effects
        let canvas = themeContainer.querySelector('.pyrestorm-effects-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.className = 'pyrestorm-effects-canvas';
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '100';
            themeContainer.appendChild(canvas);
        }

        this.effectsCanvas = canvas;
        this.effectsCtx = canvas.getContext('2d', { alpha: true });

        // Size canvas
        const resizeEffectsCanvas = () => {
            if (!this.effectsCanvas || !themeContainer) return;
            const rect = themeContainer.getBoundingClientRect();
            this.effectsCanvas.width = rect.width;
            this.effectsCanvas.height = rect.height;
        };
        resizeEffectsCanvas();
        window.addEventListener('resize', resizeEffectsCanvas);
    }

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleLineClear(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleCombo(data);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub);
    }

    handleLineClear(data = {}) {
        const lineCount = Math.max(1, data.lineCount ?? data.count ?? 1);
        const throttled = this.shouldThrottleEffects();
        this.lastEffectEventTime = Date.now();

        // Increase volcanic activity
        const intensityScale = throttled ? 0.6 : 1;
        this.volcanoGlowIntensity = Math.min(1, this.volcanoGlowIntensity + 0.3 * lineCount * intensityScale);
        this.heatIntensity = Math.min(1, this.heatIntensity + 0.3 * lineCount * intensityScale);

        // Create eruption bursts from volcano peaks
        this.createEruptionBursts(lineCount, throttled);

        // Removed lava waves - user didn't like the blue line effect

        // Create molten sparkles (reduced for performance)
        const sparkleCount = Math.max(4, Math.floor(lineCount * (throttled ? 6 : 10)));
        this.createMoltenSparkles(sparkleCount, throttled);

        this.trimEffectCollections();
    }

    handleCombo(data = {}) {
        const comboCount = Math.max(0, data.comboCount ?? data.combo ?? data.count ?? 0);
        const throttled = this.shouldThrottleEffects();
        this.lastEffectEventTime = Date.now();

        this.comboMultiplier = Math.min(1 + comboCount * 0.25, 3.0);
        const comboScale = throttled ? 0.7 : 1;
        this.volcanoGlowIntensity = Math.min(1, 0.5 + comboCount * 0.15 * comboScale);
        this.heatIntensity = Math.min(1, 0.5 + comboCount * 0.15 * comboScale);

        // Create ember swarms (reduced for performance)
        if (comboCount >= 2) {
            this.createEmberSwarm(Math.min(comboCount, 4), throttled);
        }

        // Create lava bursts from mountain peaks for high combos
        if (comboCount >= 4 && (!throttled || (comboCount >= 6 && Math.random() < 0.35))) {
            this.createLavaBurst(throttled);
        }

        // Create extra sparkles (reduced for performance)
        const extraSparkles = Math.max(4, comboCount * (throttled ? 5 : 8));
        this.createMoltenSparkles(extraSparkles, throttled);

        this.trimEffectCollections();
    }

    createEruptionBursts(lineCount, throttled = false) {
        if (!this.effectsCanvas || this.eruptionBursts.length >= this.MAX_BURSTS) return;

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;
        const volcanoY = height * 0.75; // Position at volcano peaks

        // Fire colors: bright yellow, orange, red
        const colors = ['#ffdc00', '#ff6b1a', '#ff4500', '#ffa500', '#ff0000'];
        const burstCount = Math.min(Math.max(1, lineCount), this.MAX_BURSTS - this.eruptionBursts.length);

        for (let i = 0; i < burstCount; i++) {
            const x = Math.random() * width;
            const color = colors[Math.floor(Math.random() * colors.length)];
            let particleCount = Math.floor(10 + Math.random() * 12);
            if (throttled) {
                particleCount = Math.max(6, Math.floor(particleCount * 0.6));
            }

            const particles = [];
            for (let j = 0; j < particleCount; j++) {
                const angle = Math.random() * Math.PI - Math.PI / 2; // Upward burst
                const speedBase = (Math.random() * 3 + 2) * Math.min(this.comboMultiplier, 2.0);
                const speed = throttled ? speedBase * 0.8 : speedBase;
                particles.push({
                    x: x,
                    y: volcanoY,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    life: 1.0,
                    size: Math.random() * 3 + 2,
                    trail: [],
                });
            }

            this.eruptionBursts.push({
                particles,
                color,
                life: 1.0,
                maxLife: 1.5 + Math.random() * 0.5,
            });
        }
    }

    createFlameGeysers(count) {
        if (!this.effectsCanvas || this.flameGeysers.length >= this.MAX_GEYSERS) return;

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;
        const colors = ['#ffdc00', '#ff9500', '#ff6b1a', '#ff4500'];
        const geyserCount = Math.min(count * 2, this.MAX_GEYSERS - this.flameGeysers.length);

        for (let i = 0; i < geyserCount; i++) {
            const x = Math.random() * width;
            const y = height * 0.6 + Math.random() * height * 0.3;
            const color = colors[Math.floor(Math.random() * colors.length)];

            this.flameGeysers.push({
                x,
                y,
                height: 100 + Math.random() * 200,
                width: 30 + Math.random() * 50,
                life: 1.0,
                maxLife: 0.8 + Math.random() * 0.4,
                color,
                intensity: Math.random() * 0.5 + 0.5,
            });
        }
    }

    createMoltenSparkles(count, throttled = false) {
        if (!this.effectsCanvas) return;
        if (this.moltenSparkles.length >= this.MAX_SPARKLES) {
            this.moltenSparkles.splice(0, Math.floor(this.MAX_SPARKLES * 0.3));
        }

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;
        const colors = ['#ffdc00', '#ffcc00', '#ffa500', '#ff6347'];
        let sparkleCount = Math.min(count, this.MAX_SPARKLES);
        if (throttled) {
            sparkleCount = Math.floor(sparkleCount * 0.6);
        }
        const capacity = Math.max(this.MAX_SPARKLES - this.moltenSparkles.length, 0);
        sparkleCount = Math.max(0, Math.min(sparkleCount, capacity));
        if (sparkleCount <= 0) return;

        for (let i = 0; i < sparkleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const baseSpeed = (Math.random() * 2 + 1) * this.comboMultiplier;
            const speed = throttled ? baseSpeed * 0.8 : baseSpeed;
            const color = colors[Math.floor(Math.random() * colors.length)];

            this.moltenSparkles.push({
                x: width / 2 + (Math.random() - 0.5) * width * 0.5,
                y: height * 0.6,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 2, // Upward bias
                life: 1.0,
                maxLife: Math.random() * 0.8 + 0.6,
                size: Math.random() * 3 + 1,
                color,
                glow: Math.random() * 15 + 10,
                twinkle: Math.random() * Math.PI * 2,
            });
        }
    }

    createLavaBurst(throttled = false) {
        if (!this.effectsCanvas || this.lavaBursts.length >= this.MAX_LAVA_BURSTS) return;

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;

        // Create lava bursts from mountain peaks
        const colors = ['#ff4500', '#ff6b1a', '#ff8c00'];
        const burstX = Math.random() * width;
        const burstY = height * 0.75; // Mountain peak area

        const particles = [];
        let particleCount = 15 + Math.floor(Math.random() * 10);
        if (throttled) {
            particleCount = Math.max(8, Math.floor(particleCount * 0.6));
        }

        for (let i = 0; i < particleCount; i++) {
            // Create fountain-like spray
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.4;
            const speed = Math.random() * 4 + 3;
            const color = colors[Math.floor(Math.random() * colors.length)];

            particles.push({
                x: burstX,
                y: burstY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1.0,
                size: Math.random() * 6 + 3,
                color,
            });
        }

        this.lavaBursts.push({
            particles,
            life: 1.0,
            maxLife: 1.2,
        });
    }

    createLightningStrike() {
        if (!this.effectsCanvas || this.lightningBolts.length >= this.MAX_LIGHTNING) return;

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;

        // Create jagged lightning path
        const segments = [];
        const startX = Math.random() * width;
        const startY = height * 0.2;
        const endX = Math.random() * width;
        const endY = height * 0.8;

        const segmentCount = 8 + Math.floor(Math.random() * 6);

        for (let i = 0; i <= segmentCount; i++) {
            const progress = i / segmentCount;
            const targetX = startX + (endX - startX) * progress;
            const targetY = startY + (endY - startY) * progress;

            const jitterX = (Math.random() - 0.5) * 60;
            const jitterY = (Math.random() - 0.5) * 40;

            segments.push({
                x: i === segmentCount ? endX : targetX + jitterX,
                y: i === segmentCount ? endY : targetY + jitterY,
            });
        }

        // Use red-orange fire lightning color
        this.lightningBolts.push({
            segments,
            life: 1.0,
            maxLife: 0.3,
            color: '#ff4500', // Bright orange-red fire
            width: 3 + Math.random() * 3,
        });
    }

    createEmberSwarm(comboCount, throttled = false) {
        if (!this.effectsCanvas) return;
        if (this.emberSwarms.length >= this.MAX_SWARMS) {
            this.emberSwarms.splice(0, Math.floor(this.MAX_SWARMS * 0.3));
        }

        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;
        const centerX = width / 2;
        const centerY = height / 2;
        const colors = ['#ffdc00', '#ff6b1a', '#ff4500', '#ffa500'];
        // Reduced particle count for better performance
        let particleCount = Math.min(comboCount * 6, this.MAX_SWARMS);
        if (throttled) {
            particleCount = Math.max(4, Math.floor(particleCount * 0.6));
        }
        const capacity = Math.max(this.MAX_SWARMS - this.emberSwarms.length, 0);
        particleCount = Math.max(0, Math.min(particleCount, capacity));
        if (particleCount <= 0) return;

        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const baseSpeed = (Math.random() * 2.5 + 1.5) * Math.min(this.comboMultiplier, 2.0);
            const speed = throttled ? baseSpeed * 0.85 : baseSpeed;
            const color = colors[Math.floor(Math.random() * colors.length)];

            this.emberSwarms.push({
                x: centerX,
                y: centerY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1.0,
                maxLife: Math.random() * 1.0 + 0.6,
                size: Math.random() * 5 + 2,
                color,
                glow: Math.random() * 20 + 10,
                pulse: Math.random() * Math.PI * 2,
            });
        }
    }

    updateEffects(delta) {
        // Update eruption bursts
        for (let i = this.eruptionBursts.length - 1; i >= 0; i--) {
            const burst = this.eruptionBursts[i];
            burst.life -= delta / burst.maxLife;

            burst.particles.forEach(p => {
                // Store trail (reduced for performance)
                if (p.trail.length < 3) {
                    p.trail.push({ x: p.x, y: p.y, life: 1.0 });
                }
                p.trail.forEach(t => t.life -= delta * 3);
                p.trail = p.trail.filter(t => t.life > 0);

                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.15; // Gravity
                p.vx *= 0.99; // Air resistance
                p.life -= delta / burst.maxLife;
            });

            if (burst.life <= 0) {
                this.eruptionBursts.splice(i, 1);
            }
        }

        // Update molten sparkles
        for (let i = this.moltenSparkles.length - 1; i >= 0; i--) {
            const s = this.moltenSparkles[i];
            s.x += s.vx;
            s.y += s.vy;
            s.vy += 0.1; // Gravity
            s.twinkle += 0.1;
            s.life -= delta / s.maxLife;

            if (s.life <= 0) {
                this.moltenSparkles.splice(i, 1);
            }
        }

        // Update lightning bolts
        for (let i = this.lightningBolts.length - 1; i >= 0; i--) {
            const bolt = this.lightningBolts[i];
            bolt.life -= delta / bolt.maxLife;

            if (bolt.life <= 0) {
                this.lightningBolts.splice(i, 1);
            }
        }

        // Update ember swarms
        for (let i = this.emberSwarms.length - 1; i >= 0; i--) {
            const e = this.emberSwarms[i];
            e.x += e.vx;
            e.y += e.vy;
            e.vy += 0.05; // Slight gravity
            e.pulse += 0.15;
            e.life -= delta / e.maxLife;

            if (e.life <= 0) {
                this.emberSwarms.splice(i, 1);
            }
        }

        // Update lava bursts
        for (let i = this.lavaBursts.length - 1; i >= 0; i--) {
            const burst = this.lavaBursts[i];
            burst.life -= delta / burst.maxLife;

            burst.particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.2; // Gravity
                p.vx *= 0.98; // Air resistance
                p.life -= delta / burst.maxLife;
            });

            if (burst.life <= 0) {
                this.lavaBursts.splice(i, 1);
            }
        }

        // Decay intensities
        if (this.volcanoGlowIntensity > 0) {
            this.volcanoGlowIntensity *= 0.93;
            if (this.volcanoGlowIntensity < 0.01) this.volcanoGlowIntensity = 0;
        }

        if (this.heatIntensity > 0) {
            this.heatIntensity *= 0.93;
            if (this.heatIntensity < 0.01) this.heatIntensity = 0;
        }
    }

    renderEffects() {
        if (!this.effectsCanvas || !this.effectsCtx) return;

        const ctx = this.effectsCtx;
        const width = this.effectsCanvas.width;
        const height = this.effectsCanvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Render eruption bursts with trails (optimized)
        this.eruptionBursts.forEach(burst => {
            // Set burst color once
            ctx.fillStyle = burst.color;

            burst.particles.forEach(p => {
                // Draw trail without shadow for performance
                p.trail.forEach((t, idx) => {
                    const alpha = t.life * burst.life * (idx / p.trail.length);
                    ctx.globalAlpha = alpha * 0.6;
                    ctx.beginPath();
                    ctx.arc(t.x, t.y, p.size * 0.4, 0, Math.PI * 2);
                    ctx.fill();
                });

                // Draw particle with minimal shadow
                const alpha = p.life * burst.life;
                ctx.globalAlpha = alpha;
                ctx.shadowBlur = 8;
                ctx.shadowColor = burst.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            });

            // Reset shadow
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
        });

        // Render molten sparkles with twinkle effect (optimized)
        // Only use shadow on some sparkles for performance
        this.moltenSparkles.forEach((s, idx) => {
            const twinkleScale = 0.7 + Math.sin(s.twinkle) * 0.3;
            const alpha = s.life * twinkleScale;

            ctx.globalAlpha = alpha;
            ctx.fillStyle = s.color;

            // Only add shadow to every 3rd sparkle for performance
            if (idx % 3 === 0) {
                ctx.shadowBlur = s.glow * 0.5;
                ctx.shadowColor = s.color;
            }

            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size * twinkleScale, 0, Math.PI * 2);
            ctx.fill();

            if (idx % 3 === 0) {
                ctx.shadowBlur = 0;
            }
        });
        ctx.globalAlpha = 1;

        // Render lightning bolts (simplified for performance)
        this.lightningBolts.forEach(bolt => {
            const alpha = Math.min(1, bolt.life * 3); // Quick flash

            ctx.globalAlpha = alpha;
            ctx.strokeStyle = bolt.color;
            ctx.lineWidth = bolt.width;
            ctx.shadowBlur = 15; // Reduced shadow
            ctx.shadowColor = bolt.color;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            ctx.beginPath();
            bolt.segments.forEach((seg, idx) => {
                if (idx === 0) {
                    ctx.moveTo(seg.x, seg.y);
                } else {
                    ctx.lineTo(seg.x, seg.y);
                }
            });
            ctx.stroke();
        });
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;

        // Render ember swarms with pulse effect (optimized)
        // Only use shadow on some embers for performance
        this.emberSwarms.forEach((e, idx) => {
            const pulseScale = 0.8 + Math.sin(e.pulse) * 0.2;
            const alpha = e.life;

            ctx.globalAlpha = alpha;
            ctx.fillStyle = e.color;

            // Only add shadow to every 4th ember for performance
            if (idx % 4 === 0) {
                ctx.shadowBlur = e.glow * pulseScale * 0.6;
                ctx.shadowColor = e.color;
            }

            ctx.beginPath();
            ctx.arc(e.x, e.y, e.size * pulseScale, 0, Math.PI * 2);
            ctx.fill();

            if (idx % 4 === 0) {
                ctx.shadowBlur = 0;
            }
        });
        ctx.globalAlpha = 1;

        // Render lava bursts (volcanic fountain effect)
        this.lavaBursts.forEach(burst => {
            burst.particles.forEach(p => {
                const alpha = p.life * burst.life;
                ctx.globalAlpha = alpha;
                ctx.fillStyle = p.color;
                ctx.shadowBlur = 10;
                ctx.shadowColor = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            });
        });
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
    }

    animate(timestamp) {
        if (!this.isActive || !this.effectsCanvas || !this.effectsCtx) return;

        if (typeof timestamp !== 'number') {
            timestamp = (typeof performance !== 'undefined' && typeof performance.now === 'function')
                ? performance.now()
                : Date.now();
        }

        if (this.lastFrameTime === 0) {
            this.lastFrameTime = timestamp;
        }

        const deltaMs = timestamp - this.lastFrameTime;
        const deltaSeconds = Math.min(deltaMs / 1000, 0.05);
        this.lastFrameTime = timestamp;

        this.frameTimeAccumulator += deltaMs;
        this.frameTimeCount += 1;
        if (this.frameTimeCount >= 30) {
            this.averageFrameTime = this.frameTimeAccumulator / this.frameTimeCount;
            this.frameTimeAccumulator = 0;
            this.frameTimeCount = 0;
        }

        this.animationTime += deltaSeconds;

        // Update mountain glow for combo effects
        this.updateMountainGlow();

        // Update and render combo effects
        this.updateEffects(deltaSeconds);
        this.renderEffects();

        // Continue animation loop
        const animId = requestAnimationFrame((nextTimestamp) => this.animate(nextTimestamp));
        this.registerAnimation(animId);
    }

    stop() {
        if (this.qualityChangeHandler && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }

        // Unsubscribe from events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Clear all effects
        this.eruptionBursts = [];
        this.flameGeysers = [];
        this.moltenSparkles = [];
        this.lightningBolts = [];
        this.emberSwarms = [];
        this.lavaBursts = [];

        // Reset intensities
        this.volcanoGlowIntensity = 0;
        this.heatIntensity = 0;
        this.comboMultiplier = 1.0;
        this.lastEffectEventTime = 0;
        this.lastFrameTime = 0;
        this.frameTimeAccumulator = 0;
        this.frameTimeCount = 0;
        this.averageFrameTime = 16.67;

        // Clear effects canvas
        if (this.effectsCanvas && this.effectsCtx) {
            this.effectsCtx.clearRect(0, 0, this.effectsCanvas.width, this.effectsCanvas.height);
        }

        // Clear references
        this.effectsCanvas = null;
        this.effectsCtx = null;
        this.mountainLayers = [];

        super.stop();
    }

    /**
     * Provide molten themed tetromino styling to match Pyrestorm visuals
     * @returns {Object} Pyrestorm tetromino configuration
     */
    getTetrominoConfig() {
        return PYRESTORM_TETROMINOS;
    }
}
