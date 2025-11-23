/**
 * @fileoverview Himalayan Peak Theme - Majestic mountain peaks with prayer flags and clouds
 */

import { BaseTheme } from '../base-theme.js';
import { himalayanPeakCache } from '../../utils/cache.js';
import { HIMALAYAN_PEAK_TETROMINOS } from './himalayan-peak-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

/**
 * Himalayan Peak Theme
 * Features:
 * - Procedurally generated mountain peaks with snow caps (WebGL layers)
 * - High-altitude clouds
 * - Traditional prayer flags
 * - Sun rays
 * - Thin air particles (WebGL)
 * - Sacred mountain combo effects (avalanches, prayer blessings, mountain spirits)
 */
export default class HimalayanPeakTheme extends BaseTheme {
    constructor() {
        super('himalayan-peak');
        this.eventUnsubscribers = [];
        this.currentComboLevel = 0;
        this.prayerFlags = [];
        this.sunRays = [];
        this.clouds = [];
        this.qualityConfig = null;
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    /**
     * Get quality setting from game settings
     */
    getQualitySetting() {
        if (typeof window !== 'undefined' && window.settings) {
            const quality = window.settings.effectQuality || 'High';
            return quality.toLowerCase();
        }
        return 'high';
    }

    /**
     * Get quality-specific configuration for Himalayan Peak
     * Balanced presets for mountain atmosphere effects
     */
    /**
     * Get quality-specific configuration for Himalayan Peak
     * Comprehensive presets covering all theme elements and combo effects
     */
    getQualityConfig(quality) {
        const configs = {
            minimal: {
                // Scene Elements
                clouds: 3,
                prayerFlags: 5,
                peaks: { back: 1, mid: 1, front: 1 },  // Mountain layer complexity
                // Combo Effect Elements (reduced for performance)
                snowParticles: 5,
                iceCrystals: 3,
                mountainSpirits: 2,
                // Combo Effect Multipliers
                comboEffects: {
                    avalancheMultiplier: 0.15,
                    spiritsMultiplier: 0.15,
                    windGustMultiplier: 0,
                    iceCrystalMultiplier: 0.15,
                    sacredSymbolsEnabled: false,
                    thunderEnabled: false,
                    eaglesEnabled: false,
                    sacredGeometryEnabled: false,
                    blizzardEnabled: false,
                },
            },
            low: {
                clouds: 5,
                prayerFlags: 8,
                peaks: { back: 1, mid: 1, front: 1 },
                snowParticles: 10,
                iceCrystals: 6,
                mountainSpirits: 4,
                comboEffects: {
                    avalancheMultiplier: 0.25,
                    spiritsMultiplier: 0.25,
                    windGustMultiplier: 0.2,
                    iceCrystalMultiplier: 0.25,
                    sacredSymbolsEnabled: false,
                    thunderEnabled: false,
                    eaglesEnabled: true,
                    sacredGeometryEnabled: false,
                    blizzardEnabled: false,
                },
            },
            medium: {
                clouds: 8,
                prayerFlags: 12,
                peaks: { back: 1, mid: 1, front: 1 },
                snowParticles: 18,
                iceCrystals: 12,
                mountainSpirits: 7,
                comboEffects: {
                    avalancheMultiplier: 0.45,
                    spiritsMultiplier: 0.45,
                    windGustMultiplier: 0.45,
                    iceCrystalMultiplier: 0.45,
                    sacredSymbolsEnabled: true,
                    thunderEnabled: true,
                    eaglesEnabled: true,
                    sacredGeometryEnabled: false,
                    blizzardEnabled: false,
                },
            },
            high: {
                clouds: 10,
                prayerFlags: 15,
                peaks: { back: 1, mid: 1, front: 1 },
                snowParticles: 28,
                iceCrystals: 18,
                mountainSpirits: 10,
                comboEffects: {
                    avalancheMultiplier: 0.6,
                    spiritsMultiplier: 0.6,
                    windGustMultiplier: 0.6,
                    iceCrystalMultiplier: 0.6,
                    sacredSymbolsEnabled: true,
                    thunderEnabled: true,
                    eaglesEnabled: true,
                    sacredGeometryEnabled: true,
                    blizzardEnabled: false,
                },
            },
            ultra: {
                clouds: 12,
                prayerFlags: 20,
                peaks: { back: 1, mid: 1, front: 1 },
                snowParticles: 40,
                iceCrystals: 25,
                mountainSpirits: 15,
                comboEffects: {
                    avalancheMultiplier: 0.8,
                    spiritsMultiplier: 0.8,
                    windGustMultiplier: 0.8,
                    iceCrystalMultiplier: 0.8,
                    sacredSymbolsEnabled: true,
                    thunderEnabled: true,
                    eaglesEnabled: true,
                    sacredGeometryEnabled: true,
                    blizzardEnabled: true,
                },
            },
            extreme: {
                clouds: 15,
                prayerFlags: 25,
                peaks: { back: 1, mid: 1, front: 1 },
                snowParticles: 55,
                iceCrystals: 35,
                mountainSpirits: 22,
                comboEffects: {
                    avalancheMultiplier: 1.0,
                    spiritsMultiplier: 1.0,
                    windGustMultiplier: 1.0,
                    iceCrystalMultiplier: 1.0,
                    sacredSymbolsEnabled: true,
                    thunderEnabled: true,
                    eaglesEnabled: true,
                    sacredGeometryEnabled: true,
                    blizzardEnabled: true,
                },
            },
        };

        return configs[quality] || configs.high;
    }

    async createScene() {
        // Get quality setting and configuration
        const qualitySetting = this.getQualitySetting();
        this.qualityConfig = this.getQualityConfig(qualitySetting);

        console.log('[HimalayanPeak] Creating scene with quality:', qualitySetting, this.qualityConfig);

        // 1. Procedural Mountains (DOM-based for correct z-indexing behind flags)
        const themeContainer = document.getElementById('himalayan-peak-theme');
        let mountainContainer = document.getElementById('himalayan-mountains');

        if (!mountainContainer && themeContainer) {
            mountainContainer = document.createElement('div');
            mountainContainer.id = 'himalayan-mountains';
            mountainContainer.style.position = 'absolute';
            mountainContainer.style.top = '0';
            mountainContainer.style.left = '0';
            mountainContainer.style.width = '100%';
            mountainContainer.style.height = '100%';
            mountainContainer.style.zIndex = '3'; // Behind clouds (4) and flags (6), in front of sun (2)
            themeContainer.appendChild(mountainContainer);
        }

        if (mountainContainer && mountainContainer.children.length === 0) {
            // Enhanced Grain Pattern Generator
            const createGrainPattern = (ctx, density = 1, opacity = 0.5, color = '#000000') => {
                const patternCanvas = document.createElement('canvas');
                patternCanvas.width = 256;
                patternCanvas.height = 256;
                const pCtx = patternCanvas.getContext('2d');
                const imageData = pCtx.createImageData(256, 256);
                const data = imageData.data;

                let r = 0, g = 0, b = 0;
                if (color.startsWith('#')) {
                    const hex = color.substring(1);
                    r = parseInt(hex.substring(0, 2), 16);
                    g = parseInt(hex.substring(2, 4), 16);
                    b = parseInt(hex.substring(4, 6), 16);
                }

                for (let i = 0; i < data.length; i += 4) {
                    if (Math.random() < density) {
                        data[i] = r;
                        data[i + 1] = g;
                        data[i + 2] = b;
                        data[i + 3] = Math.floor((opacity * 0.5 + Math.random() * opacity * 0.5) * 255);
                    } else {
                        data[i + 3] = 0;
                    }
                }
                pCtx.putImageData(imageData, 0, 0);
                return ctx.createPattern(patternCanvas, 'repeat');
            };

            const peakLayers = [
                // Layer 1: The Majestic Main Peak (Back)
                {
                    id: 'peak-back',
                    color: '#f0f4ff', // White Snow
                    shadowColor: '#6b7db3', // Indigo Shadow
                    baseHeight: 0.55,
                    amplitude: 300,
                    seed: 12345,
                    grainDensity: 0.4,
                    grainOpacity: 0.3,
                    zIndex: 1
                },
                // Layer 2: Rugged Mid-Mountain Base (Mid)
                {
                    id: 'peak-mid',
                    color: '#3a4b6b', // Dark Grey/Blue
                    shadowColor: '#1f2a40', // Darker Shadow
                    baseHeight: 0.75,
                    amplitude: 200,
                    seed: 23456,
                    grainDensity: 0.5,
                    grainOpacity: 0.5,
                    zIndex: 2
                },
                // Layer 3: Foreground Silhouette (Front)
                {
                    id: 'peak-front',
                    color: '#151a26', // Very Dark Navy
                    shadowColor: '#0a0c12', // Black
                    baseHeight: 0.9,
                    amplitude: 120,
                    seed: 34567,
                    grainDensity: 0.7,
                    grainOpacity: 0.7,
                    zIndex: 3
                }
            ];

            peakLayers.forEach((layer) => {
                const C_WIDTH = 2048;
                const C_HEIGHT = window.innerHeight > 1080 ? 1080 : window.innerHeight;

                const rng = this.seededRandom(layer.seed);
                const canvas = document.createElement('canvas');
                canvas.width = C_WIDTH;
                canvas.height = C_HEIGHT;
                canvas.style.position = 'absolute';
                canvas.style.top = '0';
                canvas.style.left = '0';
                canvas.style.width = '100%';
                canvas.style.height = '100%';
                canvas.style.zIndex = layer.zIndex;

                const ctx = canvas.getContext('2d');

                // Generate Ridge Noise
                const points = [];
                const baseH = canvas.height * layer.baseHeight;
                const amp = layer.amplitude;

                for (let x = 0; x <= C_WIDTH; x += 2) {
                    const nx = x / C_WIDTH;
                    let y = 0;

                    // Ridge Noise: 1 - abs(sin(x))
                    // Octave 1
                    y -= amp * Math.pow(1 - Math.abs(Math.sin(nx * Math.PI * 1.5 + layer.seed)), 1.2);
                    // Octave 2
                    y -= (amp * 0.4) * Math.pow(1 - Math.abs(Math.sin(nx * Math.PI * 4 + layer.seed * 2)), 1.5);
                    // Octave 3
                    y -= (amp * 0.15) * Math.pow(1 - Math.abs(Math.sin(nx * Math.PI * 10 + layer.seed * 3)), 1);

                    // Noise
                    y += (rng() - 0.5) * 20;
                    // Base Height
                    y += baseH;

                    points.push({ x, y });
                }

                // 1. Draw Main Shape
                ctx.beginPath();
                ctx.moveTo(0, canvas.height);
                points.forEach(p => ctx.lineTo(p.x, p.y));
                ctx.lineTo(C_WIDTH, canvas.height);
                ctx.closePath();
                ctx.fillStyle = layer.color;
                ctx.fill();

                // 2. Apply Base Grain
                ctx.globalCompositeOperation = 'source-atop';
                ctx.fillStyle = createGrainPattern(ctx, layer.grainDensity, layer.grainOpacity * 0.4, '#000000');
                ctx.fill();

                // 3. Slope-Based Stippled Shadows
                ctx.beginPath();
                for (let i = 0; i < points.length - 1; i++) {
                    const p1 = points[i];
                    const p2 = points[i + 1];
                    const slope = (p2.y - p1.y) / (p2.x - p1.x);

                    // Shadow on right-facing slopes (positive slope)
                    if (slope > 0.1) {
                        const shadowDepth = Math.min(500, slope * 600);
                        ctx.rect(p1.x, p1.y, (p2.x - p1.x), shadowDepth);
                    }
                }
                ctx.fillStyle = layer.shadowColor;
                ctx.fill();

                // 4. Heavy Grain on Shadows
                ctx.fillStyle = createGrainPattern(ctx, layer.grainDensity, layer.grainOpacity, '#000000');
                ctx.fill();

                // 5. Mist for Back Layer
                if (layer.id === 'peak-back') {
                    const mistGrad = ctx.createLinearGradient(0, canvas.height - 300, 0, canvas.height);
                    mistGrad.addColorStop(0, 'rgba(174, 186, 240, 0)');
                    mistGrad.addColorStop(1, 'rgba(174, 186, 240, 0.9)');
                    ctx.fillStyle = mistGrad;
                    ctx.fillRect(0, 0, C_WIDTH, canvas.height);
                }

                ctx.globalCompositeOperation = 'source-over';
                mountainContainer.appendChild(canvas);
            });
        }

        // Global Grain Overlay (for that "photo" look)
        const themeContainerForGrain = document.getElementById('himalayan-peak-theme');
        if (themeContainerForGrain && !themeContainerForGrain.querySelector('.global-grain-overlay')) {
            const grainOverlay = document.createElement('div');
            grainOverlay.className = 'global-grain-overlay';
            grainOverlay.style.position = 'absolute';
            grainOverlay.style.top = '0';
            grainOverlay.style.left = '0';
            grainOverlay.style.width = '100%';
            grainOverlay.style.height = '100%';
            grainOverlay.style.pointerEvents = 'none';
            grainOverlay.style.zIndex = '20'; // On top of everything
            grainOverlay.style.opacity = '0.15';
            // CSS-based noise
            grainOverlay.style.backgroundImage = `url('data:image/svg+xml;utf8,%3Csvg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"%3E%3Cfilter id="noiseFilter"%3E%3CfeTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch"/%3E%3C/filter%3E%3Crect width="100%25" height="100%25" filter="url(%23noiseFilter)" opacity="1"/%3E%3C/svg%3E')`;
            themeContainerForGrain.appendChild(grainOverlay);
        }

        // 2. High-altitude clouds (quality-based)
        const cloudContainer = this.getContainer('himalayan-clouds');
        if (cloudContainer && cloudContainer.children.length === 0) {
            this.clouds = [];
            for (let i = 0; i < this.qualityConfig.clouds; i++) {
                const cloud = document.createElement('div');
                cloud.className = 'himalayan-cloud';
                cloud.style.top = `${10 + Math.random() * 40}%`; // Adjusted for new mountain height
                const duration = Math.random() * 100 + 120;
                cloud.style.animationDuration = `${duration}s`;
                cloud.style.animationDelay = `-${Math.random() * duration}s`;
                cloudContainer.appendChild(cloud);
                this.clouds.push(cloud); // Store reference for effects
            }
        }

        // 3. Prayer Flags (quality-based count and distribution)
        const flagContainer = this.getContainer('himalayan-flags');
        if (flagContainer && flagContainer.children.length === 0) {
            this.prayerFlags = [];
            const strand = document.createElement('div');
            strand.className = 'himalayan-prayer-strand';
            const flagColors = ['#00a8ff', '#9c88ff', '#fbc531', '#4cd137', '#e84118'];
            const flagSpacing = Math.max(3, 90 / this.qualityConfig.prayerFlags); // Distribute evenly

            for (let i = 0; i < this.qualityConfig.prayerFlags; i++) {
                const flag = document.createElement('div');
                flag.className = 'himalayan-prayer-flag';
                flag.style.backgroundColor = flagColors[i % flagColors.length];
                flag.style.left = `${5 + i * flagSpacing}%`;
                flag.style.animationDelay = `-${i * 0.1}s`;
                strand.appendChild(flag);
                this.prayerFlags.push(flag); // Store reference for effects
            }
            flagContainer.appendChild(strand);
        }

        // 4. Thin Air Particles are now handled by WebGLRenderer

        // 5. Sun Rays - DISABLED per user request
        // const sunRayContainer = this.getContainer('himalayan-sun-rays');
        // if (sunRayContainer && sunRayContainer.children.length === 0) {
        //     this.sunRays = [];
        //     for (let i = 0; i < 25; i++) {
        //         const ray = document.createElement('div');
        //         ray.className = 'himalayan-sun-ray';
        //         ray.style.transform = `rotate(${Math.random() * 360}deg)`;
        //         ray.style.animationDelay = `-${Math.random() * 12}s`;
        //         sunRayContainer.appendChild(ray);
        //         this.sunRays.push(ray); // Store reference for effects
        //     }
        // }
        this.sunRays = []; // Initialize empty array

        // Setup event listeners for sacred mountain combo effects
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
     * React to line clears with mountain effects (quality-scaled)
     */
    onLineClear(lineCount) {
        if (!this.qualityConfig) return;

        const comboEffects = this.qualityConfig.comboEffects;

        // Trigger snow blizzard cascading down the peaks
        if (comboEffects.avalancheMultiplier > 0) {
            const blizzardIntensity = Math.ceil(lineCount * 8 * comboEffects.avalancheMultiplier);
            this.triggerSnowBlizzard(blizzardIntensity, lineCount);
        }

        // Prayer flags flutter and glow with blessings
        this.blessPrayerFlags(lineCount);

        // Ice crystals scatter (quality-scaled)
        if (comboEffects.iceCrystalMultiplier > 0) {
            const crystalCount = Math.ceil(lineCount * 5 * comboEffects.iceCrystalMultiplier);
            this.spawnIceCrystals(crystalCount);
        }

        // Intensify sun rays for big clears
        if (lineCount >= 3) {
            this.intensifySunRays(lineCount);
        }

        // Wind gust with snow for triple+ clears
        if (lineCount >= 3 && comboEffects.windGustMultiplier > 0) {
            const windIntensity = Math.ceil(lineCount * 6 * comboEffects.windGustMultiplier);
            this.createWindGust(windIntensity);
        }

        // Eagles for big line clears only (Tetris+)
        if (lineCount >= 4 && comboEffects.eaglesEnabled) {
            this.summonEagles(1);
        }
    }

    /**
     * React to combos with intense sacred mountain effects (quality-scaled)
     */
    onCombo(comboCount) {
        if (!this.qualityConfig) return;

        this.currentComboLevel = comboCount;
        const comboEffects = this.qualityConfig.comboEffects;

        // Mountain spirits rise from the peaks
        if (comboEffects.spiritsMultiplier > 0) {
            const spiritCount = Math.ceil(comboCount * 2 * comboEffects.spiritsMultiplier);
            this.summonMountainSpirits(spiritCount);
        }

        // Sacred symbols appear (Om, prayer wheel patterns)
        if (comboCount >= 2 && comboEffects.sacredSymbolsEnabled) {
            this.manifestSacredSymbols(comboCount);
        }

        // Thunder flash at mountain peaks
        if (comboCount >= 3 && comboEffects.thunderEnabled) {
            this.mountainThunder(comboCount);
        }

        // Eagles soar across the peaks for combos (only on higher combos)
        if (comboEffects.eaglesEnabled && comboCount >= 3) {
            const eagleCount = Math.min(Math.floor(comboCount / 3), 2); // 1 eagle per 3 combos, max 2
            if (eagleCount > 0) {
                this.summonEagles(eagleCount);
            }
        }

        // Sacred geometry mandala REMOVED per user request
        // if (comboCount >= 5 && comboEffects.sacredGeometryEnabled) {
        //     this.createSacredGeometry(comboCount);
        // }

        // Epic blizzard for extreme combos
        if (comboCount >= 7 && comboEffects.blizzardEnabled) {
            this.unleashBlizzard(comboCount);
        }

        // Intensify overall mountain atmosphere
        this.intensifyMountainAtmosphere(comboCount);
    }

    /**
     * React to piece locks with subtle mountain touches
     */
    onPieceLock(piece) {
        // Gentle snow particle (40% chance)
        if (Math.random() < 0.4) {
            this.spawnGentleSnowflake();
        }

        // Subtle mountain breeze (25% chance)
        if (Math.random() < 0.25) {
            this.createSubtleBreeze();
        }
    }

    /**
     * Trigger snow blizzard effect (replaces avalanche/rain)
     */
    triggerSnowBlizzard(intensity, lineCount) {
        const theme = document.getElementById('himalayan-peak-theme');
        if (!theme) return;

        // Snow layers (far to near)
        const snowLayers = [
            { zIndex: 4, speed: 0.5, size: 0.5, opacity: 0.6, blur: 1 },     // Far
            { zIndex: 6, speed: 0.8, size: 0.8, opacity: 0.8, blur: 0.5 },   // Mid
            { zIndex: 8, speed: 1.2, size: 1.2, opacity: 1.0, blur: 0 },     // Front
        ];

        snowLayers.forEach((layer) => {
            const particlesForLayer = Math.ceil(intensity * 0.5);

            for (let i = 0; i < particlesForLayer; i++) {
                setTimeout(() => {
                    const snow = document.createElement('div');
                    snow.className = 'blizzard-snow';
                    snow.style.position = 'absolute';
                    snow.style.width = `${4 * layer.size}px`;
                    snow.style.height = `${4 * layer.size}px`;
                    snow.style.borderRadius = '50%';
                    snow.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
                    snow.style.boxShadow = `0 0 ${5 * layer.size}px rgba(255, 255, 255, 0.8)`;
                    snow.style.left = `${Math.random() * 100}%`;
                    snow.style.top = '-10px'; // Start above screen
                    snow.style.opacity = '0';
                    snow.style.pointerEvents = 'none';
                    snow.style.zIndex = layer.zIndex.toString();

                    if (layer.blur > 0) {
                        snow.style.filter = `blur(${layer.blur}px)`;
                    }

                    const duration = 3 / layer.speed + Math.random() * 2;
                    snow.style.transition = `top ${duration}s linear, opacity 0.5s ease-in`;

                    // Animate
                    requestAnimationFrame(() => {
                        snow.style.opacity = layer.opacity.toString();
                        snow.style.top = '110%'; // Fall to bottom

                        // Add horizontal drift
                        const drift = (Math.random() - 0.5) * 200;
                        snow.style.transform = `translateX(${drift}px)`;
                        snow.style.transition += `, transform ${duration}s ease-in-out`;
                    });

                    theme.appendChild(snow);

                    setTimeout(() => {
                        if (snow.parentNode) {
                            snow.parentNode.removeChild(snow);
                        }
                    }, duration * 1000);
                }, i * 50);
            }
        });
    }

    /**
     * Prayer flags glow and flutter intensely with spiritual energy
     */
    blessPrayerFlags(intensity) {
        this.prayerFlags.forEach((flag, index) => {
            setTimeout(() => {
                flag.style.transition = 'filter 0.5s ease-out, transform 0.5s ease-out';
                flag.style.filter = `brightness(${1.5 + intensity * 0.3}) drop-shadow(0 0 ${8 + intensity * 3}px currentColor)`;
                flag.style.transform = `scale(${1 + intensity * 0.05}) rotateY(${intensity * 10}deg)`;

                setTimeout(() => {
                    flag.style.filter = '';
                    flag.style.transform = '';
                }, 500 + intensity * 50);
            }, index * 50);
        });
    }

    /**
     * Spawn ice crystals that twinkle and drift
     */
    spawnIceCrystals(count) {
        const theme = document.getElementById('himalayan-peak-theme');
        if (!theme) return;

        const crystalShapes = ['❄', '❅', '❆', '✦', '✧'];

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const crystal = document.createElement('div');
                crystal.className = 'ice-crystal';
                crystal.style.position = 'absolute';
                crystal.style.fontSize = `${12 + Math.random() * 12}px`;
                crystal.style.color = 'rgba(200, 230, 255, 0.9)';
                crystal.style.textShadow = '0 0 8px rgba(200, 230, 255, 0.8), 0 0 16px rgba(255, 255, 255, 0.6)';
                crystal.style.left = `${Math.random() * 100}%`;
                crystal.style.top = `${20 + Math.random() * 30}%`;
                crystal.style.opacity = '0';
                crystal.style.pointerEvents = 'none';
                crystal.style.zIndex = '7';
                crystal.textContent = crystalShapes[Math.floor(Math.random() * crystalShapes.length)];
                crystal.style.animation = `crystalTwinkle ${1.5 + Math.random()}s ease-in-out forwards`;
                crystal.style.willChange = 'transform, opacity'; // Performance optimization

                theme.appendChild(crystal);

                setTimeout(() => {
                    if (crystal.parentNode) {
                        crystal.parentNode.removeChild(crystal);
                    }
                }, 2500);
            }, i * 100);
        }
    }

    /**
     * Intensify sun rays emanating from the peak
     */
    intensifySunRays(intensity) {
        const raysToIntensify = Math.min(Math.floor(intensity * 5), this.sunRays.length);

        for (let i = 0; i < raysToIntensify; i++) {
            const ray = this.sunRays[Math.floor(Math.random() * this.sunRays.length)];
            if (ray) {
                ray.style.transition = 'opacity 0.6s ease-out, filter 0.6s ease-out';
                ray.style.opacity = '0.8';
                ray.style.filter = `brightness(${1.5 + intensity * 0.2})`;

                setTimeout(() => {
                    ray.style.opacity = '';
                    ray.style.filter = '';
                }, 600);
            }
        }
    }

    /**
     * Create powerful wind gust with layered snow particles
     */
    createWindGust(intensity) {
        const theme = document.getElementById('himalayan-peak-theme');
        if (!theme) return;

        // Wind gust overlay
        const windOverlay = document.createElement('div');
        windOverlay.className = 'wind-gust-overlay';
        windOverlay.style.position = 'absolute';
        windOverlay.style.top = '0';
        windOverlay.style.left = '0';
        windOverlay.style.width = '100%';
        windOverlay.style.height = '100%';
        windOverlay.style.background = 'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.15) 50%, transparent 100%)';
        windOverlay.style.opacity = '0';
        windOverlay.style.pointerEvents = 'none';
        windOverlay.style.zIndex = '6';
        windOverlay.style.animation = 'windGustSweep 1.2s ease-out forwards';

        theme.appendChild(windOverlay);

        // Horizontal snow particles in wind
        for (let i = 0; i < intensity; i++) {
            setTimeout(() => {
                const snowParticle = document.createElement('div');
                snowParticle.className = 'wind-snow';
                snowParticle.style.position = 'absolute';
                snowParticle.style.width = `${2 + Math.random() * 3}px`;
                snowParticle.style.height = `${2 + Math.random() * 3}px`;
                snowParticle.style.borderRadius = '50%';
                snowParticle.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
                snowParticle.style.left = '-10px';
                snowParticle.style.top = `${Math.random() * 100}%`;
                snowParticle.style.opacity = '1';
                snowParticle.style.pointerEvents = 'none';
                snowParticle.style.zIndex = '6';
                snowParticle.style.animation = 'windSnowSweep 1s linear forwards';
                snowParticle.style.willChange = 'transform'; // Performance optimization

                theme.appendChild(snowParticle);

                setTimeout(() => {
                    if (snowParticle.parentNode) {
                        snowParticle.parentNode.removeChild(snowParticle);
                    }
                }, 1000);
            }, i * 20);
        }

        setTimeout(() => {
            if (windOverlay.parentNode) {
                windOverlay.parentNode.removeChild(windOverlay);
            }
        }, 1200);
    }

    /**
     * Summon mountain spirits that rise from the peaks
     */
    summonMountainSpirits(count) {
        const theme = document.getElementById('himalayan-peak-theme');
        if (!theme) return;

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const spirit = document.createElement('div');
                spirit.className = 'mountain-spirit';
                spirit.style.position = 'absolute';
                spirit.style.width = '12px';
                spirit.style.height = '12px';
                spirit.style.borderRadius = '50%';
                spirit.style.background = 'radial-gradient(circle, rgba(200, 230, 255, 0.9) 0%, rgba(150, 200, 255, 0.6) 50%, transparent 100%)';
                spirit.style.boxShadow = '0 0 15px 5px rgba(200, 230, 255, 0.5)';
                spirit.style.left = `${20 + Math.random() * 60}%`;
                spirit.style.bottom = '0%';
                spirit.style.opacity = '0';
                spirit.style.pointerEvents = 'none';
                spirit.style.zIndex = '5';
                spirit.style.animation = `spiritRise ${3 + Math.random() * 2}s ease-out forwards`;
                spirit.style.setProperty('--spirit-drift', `${(Math.random() - 0.5) * 150}px`);
                spirit.style.willChange = 'transform, opacity'; // Performance optimization

                theme.appendChild(spirit);

                setTimeout(() => {
                    if (spirit.parentNode) {
                        spirit.parentNode.removeChild(spirit);
                    }
                }, 5000);
            }, i * 180);
        }
    }

    /**
     * Manifest sacred light orbs (subtle atmospheric energy)
     */
    manifestSacredSymbols(comboCount) {
        const theme = document.getElementById('himalayan-peak-theme');
        if (!theme) return;

        const orbCount = Math.min(comboCount * 2, 6);

        for (let i = 0; i < orbCount; i++) {
            setTimeout(() => {
                const orb = document.createElement('div');
                orb.className = 'sacred-light-orb';
                orb.style.position = 'absolute';
                orb.style.width = '20px';
                orb.style.height = '20px';
                orb.style.borderRadius = '50%';
                orb.style.background = 'radial-gradient(circle, rgba(255, 245, 220, 0.9) 0%, rgba(255, 215, 100, 0.6) 40%, transparent 100%)';
                orb.style.boxShadow = '0 0 20px 8px rgba(255, 215, 100, 0.5), 0 0 40px 12px rgba(255, 180, 50, 0.3)';
                orb.style.left = `${15 + Math.random() * 70}%`;
                orb.style.top = `${20 + Math.random() * 50}%`;
                orb.style.opacity = '0';
                orb.style.pointerEvents = 'none';
                orb.style.zIndex = '9';
                orb.style.animation = 'sacredOrbPulse 2.5s ease-in-out forwards';

                theme.appendChild(orb);

                setTimeout(() => {
                    if (orb.parentNode) {
                        orb.parentNode.removeChild(orb);
                    }
                }, 2500);
            }, i * 250);
        }
    }

    /**
     * Thunder flash illuminating the mountain peaks
     */
    mountainThunder(comboCount) {
        const theme = document.getElementById('himalayan-peak-theme');
        if (!theme) return;

        const thunderCount = Math.min(comboCount - 2, 3);

        for (let i = 0; i < thunderCount; i++) {
            setTimeout(() => {
                const flash = document.createElement('div');
                flash.className = 'mountain-thunder';
                flash.style.position = 'absolute';
                flash.style.top = '0';
                flash.style.left = '0';
                flash.style.width = '100%';
                flash.style.height = '40%';
                flash.style.background = 'radial-gradient(ellipse at 50% 0%, rgba(255, 255, 255, 0.8) 0%, rgba(200, 220, 255, 0.4) 40%, transparent 100%)';
                flash.style.opacity = '0';
                flash.style.pointerEvents = 'none';
                flash.style.zIndex = '10';
                flash.style.animation = 'thunderFlash 0.4s ease-out forwards';

                theme.appendChild(flash);

                setTimeout(() => {
                    if (flash.parentNode) {
                        flash.parentNode.removeChild(flash);
                    }
                }, 400);
            }, i * 800);
        }
    }

    /**
     * Summon eagles to soar majestically across the peaks (with animated wings)
     */
    summonEagles(count) {
        const theme = document.getElementById('himalayan-peak-theme');
        if (!theme) return;

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const eagle = document.createElement('div');
                eagle.className = 'mountain-eagle-minimal';
                eagle.style.position = 'fixed';
                eagle.style.width = '40px';
                eagle.style.height = '30px';
                eagle.style.left = '-50px';
                eagle.style.top = `${20 + Math.random() * 40}%`;
                eagle.style.opacity = '1';
                eagle.style.pointerEvents = 'none';
                eagle.style.zIndex = '99999';
                eagle.style.animation = 'eagleSoar 8s linear forwards';

                // Simple minimalistic bird silhouette - classic V-shape with small body
                eagle.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30"><g opacity="0.6"><path d="M 20 15 Q 12 10, 5 12 L 15 15 Z" fill="%23252520" stroke="none"/><path d="M 20 15 Q 28 10, 35 12 L 25 15 Z" fill="%23252520" stroke="none"/><circle cx="20" cy="15" r="2" fill="%23252520"/></g></svg>')`;
                eagle.style.backgroundSize = 'contain';
                eagle.style.backgroundRepeat = 'no-repeat';
                eagle.style.backgroundPosition = 'center';
                eagle.style.filter = 'blur(0.3px)';
                eagle.style.transformOrigin = 'center center';
                eagle.style.animation = 'eagleSoar 8s linear forwards, wingFlapMinimal 1s ease-in-out infinite';

                document.body.appendChild(eagle);

                setTimeout(() => {
                    if (eagle.parentNode) {
                        eagle.parentNode.removeChild(eagle);
                    }
                }, 8000);
            }, i * 2000);
        }
    }



    /**
     * Unleash epic blizzard for extreme combos
     */
    unleashBlizzard(comboCount) {
        const theme = document.getElementById('himalayan-peak-theme');
        if (!theme) return;

        const blizzard = document.createElement('div');
        blizzard.className = 'epic-blizzard';
        blizzard.style.position = 'absolute';
        blizzard.style.top = '0';
        blizzard.style.left = '0';
        blizzard.style.width = '100%';
        blizzard.style.height = '100%';
        blizzard.style.background = 'rgba(255, 255, 255, 0.2)';
        blizzard.style.opacity = '0';
        blizzard.style.pointerEvents = 'none';
        blizzard.style.zIndex = '12';
        blizzard.style.animation = `blizzardIntensify ${3 + comboCount * 0.3}s ease-in-out forwards`;
        blizzard.style.filter = 'blur(2px)';

        theme.appendChild(blizzard);

        // Optimized snow particles (reduced from 150 to 50 for performance)
        const snowCount = 50;
        for (let i = 0; i < snowCount; i++) {
            setTimeout(() => {
                const snow = document.createElement('div');
                snow.style.position = 'absolute';
                snow.style.width = '3px';
                snow.style.height = '3px';
                snow.style.borderRadius = '50%';
                snow.style.backgroundColor = 'rgba(255, 255, 255, 0.85)';
                snow.style.left = `${Math.random() * 100}%`;
                snow.style.top = '-10px';
                snow.style.pointerEvents = 'none';
                snow.style.animation = `blizzardSnowFall ${1 + Math.random()}s linear forwards`;
                snow.style.willChange = 'transform'; // Performance optimization
                blizzard.appendChild(snow);
            }, i * 40); // Increased delay between spawns
        }

        setTimeout(() => {
            if (blizzard.parentNode) {
                blizzard.parentNode.removeChild(blizzard);
            }
        }, (3 + comboCount * 0.3) * 1000);
    }

    /**
     * Intensify overall mountain atmosphere
     */
    intensifyMountainAtmosphere(comboCount) {
        const theme = document.getElementById('himalayan-peak-theme');
        if (!theme) return;

        const saturation = 100 + Math.min(comboCount * 12, 50);
        const brightness = 100 + Math.min(comboCount * 8, 35);

        theme.style.filter = `saturate(${saturation}%) brightness(${brightness}%)`;

        setTimeout(() => {
            theme.style.filter = '';
        }, 700 + comboCount * 100);
    }

    /**
     * Spawn gentle snowflake on piece lock
     */
    spawnGentleSnowflake() {
        const theme = document.getElementById('himalayan-peak-theme');
        if (!theme) return;

        const snowflake = document.createElement('div');
        snowflake.className = 'gentle-snowflake';
        snowflake.style.position = 'absolute';
        snowflake.style.fontSize = '10px';
        snowflake.style.color = 'rgba(240, 245, 255, 0.7)';
        snowflake.style.left = `${40 + Math.random() * 20}%`;
        snowflake.style.top = '20%';
        snowflake.style.opacity = '1';
        snowflake.style.pointerEvents = 'none';
        snowflake.style.zIndex = '6';
        snowflake.textContent = '❄';
        snowflake.style.animation = 'gentleSnowDrift 2s ease-out forwards';

        theme.appendChild(snowflake);

        setTimeout(() => {
            if (snowflake.parentNode) {
                snowflake.parentNode.removeChild(snowflake);
            }
        }, 2000);
    }

    /**
     * Create subtle mountain breeze effect
     */
    createSubtleBreeze() {
        const theme = document.getElementById('himalayan-peak-theme');
        if (!theme) return;

        const breeze = document.createElement('div');
        breeze.className = 'subtle-breeze';
        breeze.style.position = 'absolute';
        breeze.style.width = `${40 + Math.random() * 60}px`;
        breeze.style.height = '2px';
        breeze.style.background = 'linear-gradient(90deg, transparent, rgba(200, 230, 255, 0.3), transparent)';
        breeze.style.left = '0';
        breeze.style.top = `${30 + Math.random() * 40}%`;
        breeze.style.opacity = '0.6';
        breeze.style.pointerEvents = 'none';
        breeze.style.zIndex = '3';
        breeze.style.animation = 'breezeDrift 2s linear forwards';

        theme.appendChild(breeze);

        setTimeout(() => {
            if (breeze.parentNode) {
                breeze.parentNode.removeChild(breeze);
            }
        }, 2000);
    }

    stop() {
        // Unsubscribe from all events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Reset combo level
        this.currentComboLevel = 0;

        // Clear references
        this.prayerFlags = [];
        this.sunRays = [];
        this.clouds = [];

        super.stop();
    }

    /**
     * Provide Himalayan Peak themed tetromino styling (prayer flag colors & high-altitude atmosphere)
     * @returns {Object} Himalayan Peak tetromino configuration
     */
    getTetrominoConfig() {
        return HIMALAYAN_PEAK_TETROMINOS;
    }
}
