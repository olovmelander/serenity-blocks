/**
 * @fileoverview Sakura Twilight Theme - Beautiful sunset with cherry blossoms, falling petals, and twilight atmosphere
 */

import { BaseTheme } from '../base-theme.js';
import { sakuraTwilightTreeCache } from '../../utils/cache.js';
import { SAKURA_TWILIGHT_TETROMINOS } from './sakura-twilight-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

/**
 * Sakura Twilight Theme
 * Features:
 * - Procedurally generated cherry blossom trees with parallax layers
 * - Continuously falling cherry blossom petals
 * - Glowing paper lanterns
 * - Flying birds silhouettes
 * - Sunset gradient atmosphere
 * - Reactive petal bursts and glows on combos and line clears
 */
export default class SakuraTwilightTheme extends BaseTheme {
    constructor() {
        super('sakura-twilight');
        this.eventUnsubscribers = [];
        this.currentComboLevel = 0;
        this.eyes = [];
        this.lanterns = [];
        this.birds = [];
        this.petals = [];
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        // Define tree layers for parallax effect
        const treeLayers = [
            {
                el: document.getElementById('sakura-back'),
                trunkColor: '#8B5A5A',
                blossomColor: '#FFB7C5',
                count: 22,
                height: window.innerHeight * 0.65,
            },
            {
                el: document.getElementById('sakura-mid'),
                trunkColor: '#6B4444',
                blossomColor: '#FFA6B9',
                count: 18,
                height: window.innerHeight * 0.80,
            },
            {
                el: document.getElementById('sakura-front'),
                trunkColor: '#4A2F2F',
                blossomColor: '#FF95AD',
                count: 14,
                height: window.innerHeight,
            },
        ];

        // Helper function to draw a cherry blossom tree
        const drawSakuraTree = (ctx, x, y, len, angle, width, blossomColor, depth = 0) => {
            const maxDepth = 5;

            if (depth > maxDepth || width < 1.2 || len < 12) {
                // Draw dense blossom cluster
                const blossomCount = Math.floor(this.random(12, 20));
                for (let i = 0; i < blossomCount; i++) {
                    const offsetX = this.random(-15, 15);
                    const offsetY = this.random(-15, 15);
                    const size = this.random(6, 14);

                    ctx.beginPath();
                    ctx.arc(x + offsetX, y + offsetY, size, 0, Math.PI * 2);
                    ctx.fillStyle = blossomColor;
                    ctx.globalAlpha = this.random(0.5, 0.8);
                    ctx.fill();

                    // Add white highlights for petals
                    ctx.beginPath();
                    ctx.arc(x + offsetX, y + offsetY, size * 0.5, 0, Math.PI * 2);
                    ctx.fillStyle = '#FFF';
                    ctx.globalAlpha = this.random(0.25, 0.45);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
                return;
            }

            // Draw blossoms along branches (for denser coverage)
            if (depth > 2 && Math.random() < 0.4) {
                const midBlossoms = Math.floor(this.random(3, 6));
                for (let i = 0; i < midBlossoms; i++) {
                    const offsetX = this.random(-8, 8);
                    const offsetY = this.random(-8, 8);
                    const size = this.random(5, 10);

                    ctx.beginPath();
                    ctx.arc(x + offsetX, y + offsetY, size, 0, Math.PI * 2);
                    ctx.fillStyle = blossomColor;
                    ctx.globalAlpha = this.random(0.3, 0.6);
                    ctx.fill();

                    ctx.beginPath();
                    ctx.arc(x + offsetX, y + offsetY, size * 0.4, 0, Math.PI * 2);
                    ctx.fillStyle = '#FFF';
                    ctx.globalAlpha = this.random(0.2, 0.35);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
            }

            // Draw branch
            ctx.beginPath();
            ctx.lineWidth = width;
            ctx.moveTo(x, y);
            const x2 = x + len * Math.cos((angle * Math.PI) / 180);
            const y2 = y + len * Math.sin((angle * Math.PI) / 180);
            ctx.lineTo(x2, y2);
            ctx.stroke();

            const newLen = len * (0.70 + Math.random() * 0.12);
            const newWidth = width * 0.68;

            // Main branch
            drawSakuraTree(ctx, x2, y2, newLen, angle + this.random(-15, 15), newWidth, blossomColor, depth + 1);

            // Side branches
            if (width > 2 && depth < maxDepth - 1) {
                drawSakuraTree(
                    ctx,
                    x2,
                    y2,
                    newLen * 0.8,
                    angle + this.random(20, 50),
                    newWidth * 0.8,
                    blossomColor,
                    depth + 1
                );
                drawSakuraTree(
                    ctx,
                    x2,
                    y2,
                    newLen * 0.8,
                    angle - this.random(20, 50),
                    newWidth * 0.8,
                    blossomColor,
                    depth + 1
                );
            }
        };

        // 1. Generate cherry blossom trees with caching
        treeLayers.forEach((layer, layerIndex) => {
            if (layer.el) {
                this.registerContainer(layer.el);
                const cacheKey = `v3-${layerIndex}-${layer.trunkColor}-${layer.blossomColor}-${layer.count}-${layer.height}`;

                if (sakuraTwilightTreeCache.has(cacheKey)) {
                    const cachedData = sakuraTwilightTreeCache.get(cacheKey);
                    layer.el.style.backgroundImage = cachedData.backgroundImage;
                    layer.el.style.backgroundSize = cachedData.backgroundSize;
                } else {
                    const C_WIDTH = 2048;
                    const C_HEIGHT = layer.height;
                    const canvas = document.createElement('canvas');
                    canvas.width = C_WIDTH;
                    canvas.height = C_HEIGHT;
                    const ctx = canvas.getContext('2d');
                    ctx.strokeStyle = layer.trunkColor;
                    ctx.lineJoin = 'round';
                    ctx.lineCap = 'round';

                    // Draw ground/grass silhouette with gentle hills
                    ctx.fillStyle = '#4A3A4A';
                    ctx.beginPath();
                    ctx.moveTo(0, C_HEIGHT);
                    let groundY = C_HEIGHT * 0.92;
                    const step = 4;
                    for (let x = 0; x < C_WIDTH; x += step) {
                        groundY += (Math.random() - 0.5) * 3;
                        ctx.lineTo(x, groundY);
                    }
                    ctx.lineTo(C_WIDTH, C_HEIGHT);
                    ctx.closePath();
                    ctx.fill();

                    // Draw cherry blossom trees
                    for (let i = 0; i < layer.count; i++) {
                        const x = Math.random() * C_WIDTH;
                        const y = C_HEIGHT * (0.92 + Math.random() * 0.08);
                        const len = C_HEIGHT * (0.25 + Math.random() * 0.35);
                        const angle = -90 + this.random(-12, 12);
                        const width = 8 + Math.random() * (layer.height / 35);
                        drawSakuraTree(ctx, x, y, len, angle, width, layer.blossomColor);
                    }

                    // Add gradient fade at top
                    const fadeHeight = C_HEIGHT * 0.4;
                    const gradient = ctx.createLinearGradient(0, 0, 0, fadeHeight);
                    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
                    gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.3)');
                    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

                    ctx.globalCompositeOperation = 'destination-out';
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, C_WIDTH, fadeHeight);
                    ctx.globalCompositeOperation = 'source-over';

                    const backgroundImage = `url(${canvas.toDataURL()})`;
                    const backgroundSize = `${C_WIDTH}px ${C_HEIGHT}px`;

                    sakuraTwilightTreeCache.set(cacheKey, { backgroundImage, backgroundSize });

                    layer.el.style.backgroundImage = backgroundImage;
                    layer.el.style.backgroundSize = backgroundSize;
                }
            }
        });

        // 2. Glowing Mysterious Eyes in the forest
        const eyesContainer = this.getContainer('sakura-eyes');
        if (eyesContainer && eyesContainer.children.length === 0) {
            this.eyes = [];
            // Create pairs of glowing eyes hidden in the back layer
            for (let i = 0; i < 8; i++) {
                // Left eye
                const leftEye = document.createElement('div');
                leftEye.className = 'sakura-eye';
                const xPos = Math.random() * 95;
                const yPos = 50 + Math.random() * 35; // Lower half of screen
                leftEye.style.left = `${xPos}%`;
                leftEye.style.top = `${yPos}%`;
                leftEye.style.setProperty('--twinkle-duration', `${3 + Math.random() * 4}s`);
                leftEye.style.setProperty('--twinkle-delay', `${Math.random() * 5}s`);
                eyesContainer.appendChild(leftEye);
                this.eyes.push(leftEye);

                // Right eye (paired, 8-12px apart)
                const rightEye = document.createElement('div');
                rightEye.className = 'sakura-eye';
                rightEye.style.left = `calc(${xPos}% + ${8 + Math.random() * 4}px)`;
                rightEye.style.top = `${yPos}%`;
                rightEye.style.setProperty('--twinkle-duration', `${3 + Math.random() * 4}s`);
                rightEye.style.setProperty('--twinkle-delay', `${Math.random() * 5}s`);
                eyesContainer.appendChild(rightEye);
                this.eyes.push(rightEye);
            }
        }

        // 3. Glowing Paper Lanterns (attached to trees, moving with parallax)
        const lanternContainer = this.getContainer('sakura-lanterns');
        if (lanternContainer && lanternContainer.children.length === 0) {
            this.lanterns = [];
            // Distribute lanterns across tree layers with matching animations
            const lanternLayers = [
                { count: 4, zIndex: 3, animation: 'sakura-lantern-parallax-back 280s linear infinite' },
                { count: 4, zIndex: 5, animation: 'sakura-lantern-parallax-mid 200s linear infinite' },
                { count: 4, zIndex: 8, animation: 'sakura-lantern-parallax-front 120s linear infinite' },
            ];

            lanternLayers.forEach((layerConfig) => {
                for (let i = 0; i < layerConfig.count; i++) {
                    const lantern = document.createElement('div');
                    lantern.className = 'sakura-lantern';
                    lantern.style.left = `${Math.random() * 95}%`;
                    lantern.style.top = `${40 + Math.random() * 30}%`; // Constrained to 40-70%
                    lantern.style.zIndex = layerConfig.zIndex;
                    lantern.style.setProperty('--lantern-scale', '1');
                    lantern.style.animation = layerConfig.animation;
                    lanternContainer.appendChild(lantern);
                    this.lanterns.push(lantern);
                }
            });
        }

        // 4. Flying Birds
        const birdsContainer = this.getContainer('sakura-birds');
        if (birdsContainer && birdsContainer.children.length === 0) {
            this.birds = [];
            for (let i = 0; i < 4; i++) {
                const bird = document.createElement('div');
                bird.className = 'sakura-bird';
                bird.style.animationDelay = `-${Math.random() * 30}s`;
                bird.style.animationDuration = `${25 + Math.random() * 15}s`;
                bird.style.top = `${10 + Math.random() * 40}%`;
                birdsContainer.appendChild(bird);
                this.birds.push(bird);
            }
        }

        // 5. Falling Cherry Blossom Petals (continuous)
        const themeContainer = this.getContainer('sakura-twilight-theme');
        if (themeContainer) {
            // Clear old petals
            themeContainer.querySelectorAll('.sakura-petal').forEach((e) => e.remove());
            this.petals = [];

            // Create continuously falling petals
            for (let i = 0; i < 25; i++) {
                const petal = document.createElement('div');
                petal.className = 'sakura-petal';
                const xStart = Math.random() * 100;
                petal.style.setProperty('--x-start', `${xStart}vw`);
                petal.style.setProperty('--x-end', `${xStart + (Math.random() * 20 - 10)}vw`);
                petal.style.setProperty('--r-start', `${Math.random() * 360}deg`);
                petal.style.setProperty('--r-end', `${Math.random() * 720 - 360}deg`);
                const duration = Math.random() * 10 + 10;
                petal.style.animationDuration = `${duration}s`;
                petal.style.animationDelay = `-${Math.random() * duration}s`;
                themeContainer.appendChild(petal);
                this.petals.push(petal);
            }
        }

        // Setup event listeners for reactive effects
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Listen for line clear events
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });

        // Listen for combo events
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });

        // Listen for piece lock events
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock(data.piece);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    /**
     * React to line clears with cherry blossom effects
     */
    onLineClear(lineCount) {
        // Brighten lanterns
        this.brightenLanterns(lineCount);

        // Create petal burst
        this.createPetalBurst(lineCount * 8);

        // Spawn glowing petals
        if (lineCount >= 2) {
            this.spawnGlowingPetals(lineCount * 5);
        }

        // Create wind effect for big clears
        if (lineCount >= 3) {
            this.createWindGust(lineCount);
        }

        // Sparkle effect
        this.createSakuraSparkles(lineCount * 3);
    }

    /**
     * React to combos with intensified effects
     */
    onCombo(comboCount) {
        this.currentComboLevel = comboCount;

        // Intensify sunset glow
        this.intensifySunsetGlow(comboCount);

        // Make lanterns pulse
        this.pulseLanterns(comboCount);

        // Create magical sakura aura
        this.createSakuraAura(comboCount);

        // Spawn swirling petals
        this.spawnSwirlPetals(comboCount * 3);

        // High combo effects
        if (comboCount >= 3) {
            this.createPetalVortex(comboCount);
        }

        // Epic combo effects
        if (comboCount >= 5) {
            this.createCelestialBurst(comboCount);
        }
    }

    /**
     * React to piece locks with subtle effects
     */
    onPieceLock(piece) {
        // Gentle petal spawn (25% chance)
        if (Math.random() < 0.25) {
            this.spawnSinglePetal();
        }

        // Soft glow (15% chance)
        if (Math.random() < 0.15) {
            this.createSoftGlow();
        }
    }

    /**
     * Brighten paper lanterns
     */
    brightenLanterns(intensity) {
        const lanternsToBrighten = Math.min(Math.floor(intensity * 3), this.lanterns.length);

        for (let i = 0; i < lanternsToBrighten; i++) {
            const lantern = this.lanterns[Math.floor(Math.random() * this.lanterns.length)];
            if (lantern) {
                lantern.style.transition = 'filter 0.5s ease-out, transform 0.5s ease-out';
                lantern.style.filter = `brightness(${2 + intensity * 0.4}) drop-shadow(0 0 ${12 + intensity * 6}px #FFB347)`;
                lantern.style.setProperty('--lantern-scale', `${1.1 + intensity * 0.1}`);

                setTimeout(() => {
                    lantern.style.filter = '';
                    lantern.style.setProperty('--lantern-scale', '1');
                }, 500);
            }
        }
    }

    /**
     * Pulse lanterns on combo
     */
    pulseLanterns(comboCount) {
        this.lanterns.forEach((lantern) => {
            lantern.style.transition = 'filter 0.6s ease-in-out';
            lantern.style.filter = `brightness(${1.8 + comboCount * 0.3}) saturate(${150 + comboCount * 20}%)`;

            setTimeout(() => {
                lantern.style.filter = '';
            }, 600 + comboCount * 100);
        });
    }

    /**
     * Create burst of cherry blossom petals
     */
    createPetalBurst(count) {
        const theme = document.getElementById('sakura-twilight-theme');
        if (!theme) return;

        const colors = ['#FFB7C5', '#FFA6B9', '#FF95AD', '#FFCCD5'];

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const petal = document.createElement('div');
                petal.className = 'sakura-burst-petal';
                petal.style.position = 'absolute';
                petal.style.width = '8px';
                petal.style.height = '8px';
                petal.style.borderRadius = '50% 0% 50% 0%';
                petal.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                petal.style.left = `${45 + Math.random() * 10}%`;
                petal.style.top = `${40 + Math.random() * 20}%`;
                petal.style.opacity = '0';
                petal.style.pointerEvents = 'none';
                petal.style.zIndex = '12';
                petal.style.animation = 'petalBurst 1.5s ease-out forwards';
                petal.style.setProperty('--burst-x', `${(Math.random() - 0.5) * 200}px`);
                petal.style.setProperty('--burst-y', `${(Math.random() - 0.5) * 200}px`);
                petal.style.setProperty('--burst-rotate', `${Math.random() * 720}deg`);

                theme.appendChild(petal);

                setTimeout(() => {
                    if (petal.parentNode) {
                        petal.parentNode.removeChild(petal);
                    }
                }, 1500);
            }, i * 50);
        }
    }

    /**
     * Spawn glowing cherry blossom petals
     */
    spawnGlowingPetals(count) {
        const theme = document.getElementById('sakura-twilight-theme');
        if (!theme) return;

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const petal = document.createElement('div');
                petal.className = 'sakura-glow-petal';
                petal.style.position = 'absolute';
                petal.style.width = '10px';
                petal.style.height = '10px';
                petal.style.borderRadius = '50% 0% 50% 0%';
                petal.style.backgroundColor = '#FFB7C5';
                petal.style.boxShadow = '0 0 12px 3px rgba(255, 183, 197, 0.8)';
                petal.style.left = `${Math.random() * 100}%`;
                petal.style.top = '-20px';
                petal.style.opacity = '0';
                petal.style.pointerEvents = 'none';
                petal.style.zIndex = '11';
                petal.style.animation = `petalGlowFall ${3 + Math.random() * 2}s ease-in-out forwards`;

                theme.appendChild(petal);

                setTimeout(() => {
                    if (petal.parentNode) {
                        petal.parentNode.removeChild(petal);
                    }
                }, 5000);
            }, i * 120);
        }
    }

    /**
     * Create sakura sparkles
     */
    createSakuraSparkles(count) {
        const theme = document.getElementById('sakura-twilight-theme');
        if (!theme) return;

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const sparkle = document.createElement('div');
                sparkle.className = 'sakura-sparkle';
                sparkle.style.position = 'absolute';
                sparkle.style.fontSize = '14px';
                sparkle.style.left = `${Math.random() * 100}%`;
                sparkle.style.top = `${Math.random() * 100}%`;
                sparkle.style.opacity = '0';
                sparkle.style.pointerEvents = 'none';
                sparkle.style.zIndex = '13';
                sparkle.innerHTML = '✨';
                sparkle.style.animation = 'sakuraSparkle 1.2s ease-out forwards';
                sparkle.style.filter = 'hue-rotate(330deg)'; // Pink tint

                theme.appendChild(sparkle);

                setTimeout(() => {
                    if (sparkle.parentNode) {
                        sparkle.parentNode.removeChild(sparkle);
                    }
                }, 1200);
            }, i * 100);
        }
    }

    /**
     * Create wind gust effect
     */
    createWindGust(lineCount) {
        const theme = document.getElementById('sakura-twilight-theme');
        if (!theme) return;

        const wind = document.createElement('div');
        wind.className = 'sakura-wind';
        wind.style.position = 'absolute';
        wind.style.left = '0';
        wind.style.top = '0';
        wind.style.width = '100%';
        wind.style.height = '100%';
        wind.style.background = 'linear-gradient(90deg, transparent 0%, rgba(255, 183, 197, 0.2) 50%, transparent 100%)';
        wind.style.opacity = '0';
        wind.style.pointerEvents = 'none';
        wind.style.zIndex = '5';
        wind.style.animation = `windSweep ${1 + lineCount * 0.2}s ease-in-out forwards`;

        theme.appendChild(wind);

        setTimeout(() => {
            if (wind.parentNode) {
                wind.parentNode.removeChild(wind);
            }
        }, (1 + lineCount * 0.2) * 1000);
    }

    /**
     * Intensify sunset glow
     */
    intensifySunsetGlow(comboCount) {
        const theme = document.getElementById('sakura-twilight-theme');
        if (!theme) return;

        const saturation = 100 + Math.min(comboCount * 8, 30);
        const brightness = 100 + Math.min(comboCount * 4, 15);

        theme.style.filter = `saturate(${saturation}%) brightness(${brightness}%)`;

        setTimeout(() => {
            theme.style.filter = '';
        }, 900 + comboCount * 120);
    }

    /**
     * Create sakura aura effect
     */
    createSakuraAura(comboCount) {
        const theme = document.getElementById('sakura-twilight-theme');
        if (!theme) return;

        const aura = document.createElement('div');
        aura.className = 'sakura-aura';
        aura.style.position = 'absolute';
        aura.style.left = '50%';
        aura.style.top = '50%';
        aura.style.width = '150px';
        aura.style.height = '150px';
        aura.style.borderRadius = '50%';
        aura.style.background = 'radial-gradient(circle, rgba(255, 183, 197, 0.15) 0%, rgba(255, 179, 139, 0.08) 50%, transparent 100%)';
        aura.style.transform = 'translate(-50%, -50%) scale(0)';
        aura.style.opacity = '0.4';
        aura.style.pointerEvents = 'none';
        aura.style.zIndex = '99';
        aura.style.animation = `auraExpand ${1.5 + comboCount * 0.15}s ease-out forwards`;

        theme.appendChild(aura);

        setTimeout(() => {
            if (aura.parentNode) {
                aura.parentNode.removeChild(aura);
            }
        }, (1.5 + comboCount * 0.15) * 1000);
    }

    /**
     * Spawn swirling petals
     */
    spawnSwirlPetals(count) {
        const theme = document.getElementById('sakura-twilight-theme');
        if (!theme) return;

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const petal = document.createElement('div');
                petal.className = 'sakura-swirl-petal';
                petal.style.position = 'absolute';
                petal.style.width = '7px';
                petal.style.height = '7px';
                petal.style.borderRadius = '50% 0% 50% 0%';
                petal.style.backgroundColor = '#FFA6B9';
                petal.style.left = '50%';
                petal.style.top = '50%';
                petal.style.opacity = '0';
                petal.style.pointerEvents = 'none';
                petal.style.zIndex = '10';
                petal.style.animation = `petalSwirl ${2 + Math.random()}s ease-out forwards`;
                petal.style.setProperty('--swirl-angle', `${Math.random() * 360}deg`);
                petal.style.setProperty('--swirl-radius', `${100 + Math.random() * 150}px`);

                theme.appendChild(petal);

                setTimeout(() => {
                    if (petal.parentNode) {
                        petal.parentNode.removeChild(petal);
                    }
                }, 3000);
            }, i * 80);
        }
    }

    /**
     * Create petal vortex for high combos
     */
    createPetalVortex(comboCount) {
        const theme = document.getElementById('sakura-twilight-theme');
        if (!theme) return;

        const vortexCount = Math.min(comboCount * 4, 20);

        for (let i = 0; i < vortexCount; i++) {
            setTimeout(() => {
                const petal = document.createElement('div');
                petal.className = 'sakura-vortex-petal';
                petal.style.position = 'absolute';
                petal.style.width = '9px';
                petal.style.height = '9px';
                petal.style.borderRadius = '50% 0% 50% 0%';
                petal.style.backgroundColor = '#FF95AD';
                petal.style.boxShadow = '0 0 8px 2px rgba(255, 149, 173, 0.6)';
                petal.style.left = '50%';
                petal.style.top = '50%';
                petal.style.opacity = '0';
                petal.style.pointerEvents = 'none';
                petal.style.zIndex = '98';
                petal.style.animation = `petalVortex ${2.5}s ease-out forwards`;
                petal.style.animationDelay = `${i * 0.05}s`;

                theme.appendChild(petal);

                setTimeout(() => {
                    if (petal.parentNode) {
                        petal.parentNode.removeChild(petal);
                    }
                }, 2500);
            }, i * 50);
        }
    }

    /**
     * Create celestial burst for epic combos
     */
    createCelestialBurst(comboCount) {
        const theme = document.getElementById('sakura-twilight-theme');
        if (!theme) return;

        const burst = document.createElement('div');
        burst.className = 'sakura-celestial-burst';
        burst.style.position = 'absolute';
        burst.style.left = '50%';
        burst.style.top = '50%';
        burst.style.width = '200px';
        burst.style.height = '200px';
        burst.style.borderRadius = '50%';
        burst.style.background = 'radial-gradient(circle, rgba(255, 200, 210, 0.25) 0%, rgba(255, 183, 197, 0.15) 30%, rgba(255, 149, 173, 0.08) 60%, transparent 100%)';
        burst.style.transform = 'translate(-50%, -50%) scale(0)';
        burst.style.opacity = '0.6';
        burst.style.pointerEvents = 'none';
        burst.style.zIndex = '100';
        burst.style.animation = `celestialBurst ${1.8 + comboCount * 0.1}s ease-out forwards`;
        burst.style.mixBlendMode = 'screen';

        theme.appendChild(burst);

        setTimeout(() => {
            if (burst.parentNode) {
                burst.parentNode.removeChild(burst);
            }
        }, (1.8 + comboCount * 0.1) * 1000);
    }

    /**
     * Spawn single petal on piece lock
     */
    spawnSinglePetal() {
        const theme = document.getElementById('sakura-twilight-theme');
        if (!theme) return;

        const petal = document.createElement('div');
        petal.className = 'sakura-tiny-petal';
        petal.style.position = 'absolute';
        petal.style.width = '5px';
        petal.style.height = '5px';
        petal.style.borderRadius = '50% 0% 50% 0%';
        petal.style.backgroundColor = '#FFB7C5';
        petal.style.left = `${45 + Math.random() * 10}%`;
        petal.style.top = `${35 + Math.random() * 30}%`;
        petal.style.opacity = '1';
        petal.style.pointerEvents = 'none';
        petal.style.zIndex = '11';
        petal.style.animation = 'tinyPetalFloat 1.2s ease-out forwards';

        theme.appendChild(petal);

        setTimeout(() => {
            if (petal.parentNode) {
                petal.parentNode.removeChild(petal);
            }
        }, 1200);
    }

    /**
     * Create soft glow on piece lock
     */
    createSoftGlow() {
        const theme = document.getElementById('sakura-twilight-theme');
        if (!theme) return;

        const glow = document.createElement('div');
        glow.className = 'sakura-soft-glow';
        glow.style.position = 'absolute';
        glow.style.width = '40px';
        glow.style.height = '40px';
        glow.style.borderRadius = '50%';
        glow.style.background = 'radial-gradient(circle, rgba(255, 183, 197, 0.5) 0%, transparent 70%)';
        glow.style.left = `${45 + Math.random() * 10}%`;
        glow.style.top = `${40 + Math.random() * 20}%`;
        glow.style.opacity = '0';
        glow.style.pointerEvents = 'none';
        glow.style.zIndex = '9';
        glow.style.animation = 'softGlowPulse 0.8s ease-out forwards';

        theme.appendChild(glow);

        setTimeout(() => {
            if (glow.parentNode) {
                glow.parentNode.removeChild(glow);
            }
        }, 800);
    }

    stop() {
        // Unsubscribe from all events
        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        // Reset combo level
        this.currentComboLevel = 0;

        // Clear references
        this.eyes = [];
        this.lanterns = [];
        this.birds = [];
        this.petals = [];

        super.stop();
    }

    /**
     * Provide Sakura Twilight themed tetromino styling
     * @returns {Object} Sakura Twilight tetromino configuration
     */
    getTetrominoConfig() {
        return SAKURA_TWILIGHT_TETROMINOS;
    }
}
