/**
 * @fileoverview Waves Theme - Serene underwater scene with floating wave particles
 */

import { BaseTheme } from '../base-theme.js';
import { WAVES_TETROMINOS } from './waves-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

/**
 * Waves Theme
 * Features:
 * - Floating wave particles with organic movement
 * - Smooth animations and transitions
 * - Dynamic combo effects with ripples, tides, and swells
 */
export default class WavesTheme extends BaseTheme {
    constructor() {
        super('waves');
        this.eventUnsubscribers = [];
        this.currentComboLevel = 0;

        // Quality presets for performance scaling
        this.qualityPresets = {
            'Minimal': {
                maxRipples: 2,
                maxBubbles: 8,
                maxWaveSwells: 1,
                comboEffectScale: 0.4,
                maxComboOrbs: 8,
                bloomParticleCap: 3,
                maxBloomSize: 550,
                maxMaelstromRings: 2,
                maxMaelstromSize: 400,
                comboPressureDamping: 0.16,
                minComboScale: 0.3,
            },
            'Low': {
                maxRipples: 3,
                maxBubbles: 12,
                maxWaveSwells: 2,
                comboEffectScale: 0.55,
                maxComboOrbs: 12,
                bloomParticleCap: 4,
                maxBloomSize: 700,
                maxMaelstromRings: 3,
                maxMaelstromSize: 520,
                comboPressureDamping: 0.14,
                minComboScale: 0.35,
            },
            'Medium': {
                maxRipples: 5,
                maxBubbles: 20,
                maxWaveSwells: 3,
                comboEffectScale: 0.72,
                maxComboOrbs: 16,
                bloomParticleCap: 5,
                maxBloomSize: 850,
                maxMaelstromRings: 4,
                maxMaelstromSize: 680,
                comboPressureDamping: 0.12,
                minComboScale: 0.38,
            },
            'High': {
                maxRipples: 7,
                maxBubbles: 28,
                maxWaveSwells: 4,
                comboEffectScale: 0.88,
                maxComboOrbs: 22,
                bloomParticleCap: 6,
                maxBloomSize: 1000,
                maxMaelstromRings: 5,
                maxMaelstromSize: 820,
                comboPressureDamping: 0.1,
                minComboScale: 0.42,
            },
            'Ultra': {
                maxRipples: 9,
                maxBubbles: 34,
                maxWaveSwells: 6,
                comboEffectScale: 0.96,
                maxComboOrbs: 26,
                bloomParticleCap: 7,
                maxBloomSize: 1120,
                maxMaelstromRings: 6,
                maxMaelstromSize: 940,
                comboPressureDamping: 0.09,
                minComboScale: 0.46,
            },
            'Extreme': {
                maxRipples: 12,
                maxBubbles: 45,
                maxWaveSwells: 8,
                comboEffectScale: 1.15,
                maxComboOrbs: 35,
                bloomParticleCap: 9,
                maxBloomSize: 1350,
                maxMaelstromRings: 8,
                maxMaelstromSize: 1100,
                comboPressureDamping: 0.08,
                minComboScale: 0.5,
            }
        };

        // Apply quality preset based on settings
        const quality = (typeof window !== 'undefined' && window.settings?.graphicsQuality) || 'High';
        this.activeQuality = this.qualityPresets[quality] || this.qualityPresets['High'];

        // Combo performance guardrails
        this.comboEffectCooldownMs = 260; // Throttle back-to-back combo FX
        this.lastComboEffectTime = 0;
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    async createScene() {
        // Create wave particles
        const particleContainer = this.getContainer('waves-particles');
        if (particleContainer && particleContainer.children.length === 0) {
            for (let i = 0; i < 30; i++) {
                const particle = document.createElement('div');
                particle.className = 'wave-particle';
                const size = Math.random() * 2.5 + 1;
                particle.style.width = `${size}px`;
                particle.style.height = `${size}px`;
                particle.style.setProperty('--x-start', `${Math.random() * 100}vw`);
                particle.style.setProperty('--y-start', `${Math.random() * 100}vh`);
                particle.style.setProperty('--x-end', `${Math.random() * 100}vw`);
                particle.style.setProperty('--y-end', `${Math.random() * 100}vh`);
                particle.style.animationDelay = `-${Math.random() * 15}s`;
                particleContainer.appendChild(particle);
            }
        }

        // Setup event listeners for combo effects
        this.setupEventListeners();
    }

    /**
     * Setup event listeners for combo effects
     */
    setupEventListeners() {
        // Clean up existing listeners
        this.teardownEventListeners();

        // Listen for line clear events
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount, data.comboCount || 0);
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
     * Teardown event listeners
     */
    teardownEventListeners() {
        if (!this.eventUnsubscribers.length) return;

        this.eventUnsubscribers.forEach((unsubscribe) => {
            try {
                unsubscribe?.();
            } catch (error) {
                console.error('[WavesTheme] Failed to remove event listener', error);
            }
        });

        this.eventUnsubscribers = [];
    }

    /**
     * React to line clears with wave effects
     */
    onLineClear(lineCount, comboCount = 0) {
        // Create bubble burst from center
        this.createBubbleBurst(lineCount * 6);

        // Brighten existing wave particles
        this.brightenWaveParticles(lineCount);

        // Create current surge for big clears
        if (lineCount >= 2) {
            this.createCurrentSurge(lineCount);
        }

        // Create wave flash for large clears
        if (lineCount >= 3) {
            this.createWaveFlash(lineCount);
        }
    }

    /**
     * React to combos with intensified wave effects
     */
    onCombo(comboCount) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const throttled = now - this.lastComboEffectTime < this.comboEffectCooldownMs;
        this.lastComboEffectTime = now;

        this.currentComboLevel = comboCount;
        const comboScale = this.getComboPerformanceScale(comboCount, throttled);

        // Intensify the ocean ambiance
        this.intensifyOceanGlow(comboCount, comboScale);

        // Create floating bubbles
        this.spawnComboOrbBubbles(comboCount * 4, comboScale, comboCount);

        // Medium combo effects - tidal surge
        if (comboCount >= 3) {
            this.createTidalSurge(comboCount, comboScale);
        }

        // High combo effects - maelstrom swirl
        if (comboCount >= 5) {
            this.createMaelstromSwirl(comboCount, comboScale);
        }

        // Epic combo effects - oceanic bloom
        if (comboCount >= 8) {
            this.createOceanicBloom(comboCount, comboScale);
        }

        // Reset theme after combo effects complete
        this.scheduleThemeReset(comboCount, comboScale);
    }

    /**
     * Scale down expensive combo visuals as combo counts climb or when throttled
     */
    getComboPerformanceScale(comboCount = 0, throttled = false) {
        const baseScale = this.activeQuality.comboEffectScale || 1;
        const pressure = Math.max(0, comboCount - 3);
        const pressureDamping = this.activeQuality.comboPressureDamping ?? 0.1;
        const minScale = this.activeQuality.minComboScale ?? 0.4;
        const pressureScale = Math.max(minScale, 1 - pressure * pressureDamping); // Fall off as combos rise
        const throttleScale = throttled ? 0.65 : 1;
        return Math.max(minScale, baseScale * pressureScale * throttleScale);
    }

    /**
     * Schedule theme reset after combo effects finish
     */
    scheduleThemeReset(comboCount, comboScale = 1) {
        // Clear any existing reset timeout
        if (this.resetTimeout) {
            clearTimeout(this.resetTimeout);
        }

        // Calculate reset delay based on combo level (longer combos need more time)
        const baseDelay = comboCount >= 8 ? 4200 : comboCount >= 5 ? 3200 : 2200;
        const resetDelay = baseDelay * (0.85 + 0.25 * comboScale);

        this.resetTimeout = setTimeout(() => {
            this.resetTheme();
        }, resetDelay);
    }

    /**
     * Reset theme to default state
     */
    resetTheme() {
        const theme = document.getElementById('waves-theme');
        if (!theme) return;

        // Smoothly transition back to default
        theme.style.transition = 'filter 0.6s ease-out, opacity 0.6s ease-out';
        theme.style.filter = '';

        // Remove any lingering combo elements to fully clear the scene
        this.clearComboArtifacts();

        // Reset combo level
        this.currentComboLevel = 0;
        this.resetTimeout = null;
    }

    /**
     * Clear lingering combo VFX so the theme fully normalizes
     */
    clearComboArtifacts() {
        const theme = document.getElementById('waves-theme');
        if (!theme) return;

        const cleanupSelectors = [
            '.wave-combo-bubble',
            '.wave-combo-ripple',
            '.wave-combo-ring',
            '.wave-tidal-swell',
            '.wave-maelstrom',
            '.wave-oceanic-bloom',
            '.wave-combo-orb',
            '.wave-soft-ripple',
            '.wave-subtle-bubble',
            '.wave-flash-glow',
        ];

        cleanupSelectors.forEach((selector) => {
            theme.querySelectorAll(selector).forEach((node) => node.remove());
        });
    }

    /**
     * React to piece locks with subtle wave effects
     */
    onPieceLock(piece) {
        // Gentle bubble spawn (20% chance)
        if (Math.random() < 0.2) {
            this.spawnSingleBubble();
        }

        // Soft ripple (15% chance)
        if (Math.random() < 0.15) {
            this.createSoftRipple();
        }
    }

    /**
     * Create burst of rising bubbles
     */
    createBubbleBurst(count) {
        const theme = document.getElementById('waves-theme');
        if (!theme) return;

        const scaledCount = Math.min(
            Math.floor(count * this.activeQuality.comboEffectScale),
            this.activeQuality.maxBubbles
        );

        for (let i = 0; i < scaledCount; i++) {
            setTimeout(() => {
                const bubble = document.createElement('div');
                bubble.className = 'wave-combo-bubble';
                bubble.style.position = 'absolute';
                bubble.style.width = `${Math.random() * 12 + 4}px`;
                bubble.style.height = bubble.style.width;
                bubble.style.borderRadius = '50%';
                bubble.style.background = 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.9), rgba(100,200,255,0.6))';
                bubble.style.boxShadow = '0 0 10px rgba(100,200,255,0.8), inset -2px -2px 4px rgba(255,255,255,0.5)';
                bubble.style.left = `${40 + Math.random() * 20}%`;
                bubble.style.bottom = `${20 + Math.random() * 20}%`;
                bubble.style.opacity = '0';
                bubble.style.pointerEvents = 'none';
                bubble.style.zIndex = '10';

                // Animate bubble rising
                const startX = parseFloat(bubble.style.left);
                const sway = (Math.random() - 0.5) * 20;
                const duration = 1500 + Math.random() * 1000;

                bubble.style.transition = `all ${duration}ms ease-out`;
                theme.appendChild(bubble);

                requestAnimationFrame(() => {
                    bubble.style.opacity = '0.8';
                    bubble.style.bottom = `${80 + Math.random() * 20}%`;
                    bubble.style.left = `${startX + sway}%`;
                    bubble.style.transform = `scale(${1 + Math.random() * 0.5})`;
                });

                setTimeout(() => bubble.remove(), duration);
            }, i * 30);
        }
    }

    /**
     * Create expanding wave ripples
     */
    createWaveRipples(intensity) {
        const theme = document.getElementById('waves-theme');
        if (!theme) return;

        const rippleCount = Math.min(
            Math.floor((intensity + 1) * this.activeQuality.comboEffectScale),
            this.activeQuality.maxRipples
        );

        for (let i = 0; i < rippleCount; i++) {
            setTimeout(() => {
                const ripple = document.createElement('div');
                ripple.className = 'wave-combo-ripple';
                ripple.style.position = 'absolute';
                ripple.style.left = '50%';
                ripple.style.top = '50%';
                ripple.style.width = '20px';
                ripple.style.height = '20px';
                ripple.style.border = `2px solid rgba(100, 200, 255, ${0.7 - i * 0.15})`;
                ripple.style.borderRadius = '50%';
                ripple.style.transform = 'translate(-50%, -50%)';
                ripple.style.pointerEvents = 'none';
                ripple.style.zIndex = '9';
                ripple.style.boxShadow = `0 0 20px rgba(100, 200, 255, 0.6)`;

                theme.appendChild(ripple);

                const maxSize = 800 + intensity * 200;
                const duration = 2000 + i * 300;

                ripple.style.transition = `all ${duration}ms ease-out`;
                requestAnimationFrame(() => {
                    ripple.style.width = `${maxSize}px`;
                    ripple.style.height = `${maxSize}px`;
                    ripple.style.opacity = '0';
                });

                setTimeout(() => ripple.remove(), duration);
            }, i * 200);
        }
    }

    /**
     * Brighten existing wave particles
     */
    brightenWaveParticles(intensity) {
        const particleContainer = this.getContainer('waves-particles');
        if (!particleContainer) return;

        const particles = particleContainer.querySelectorAll('.wave-particle');
        particles.forEach((particle) => {
            particle.style.transition = 'filter 0.5s ease-out, transform 0.5s ease-out';
            particle.style.filter = `brightness(${2 + intensity * 0.5}) drop-shadow(0 0 ${8 + intensity * 4}px rgba(100,200,255,0.8))`;
            particle.style.transform = `scale(${1.2 + intensity * 0.15})`;

            setTimeout(() => {
                particle.style.filter = '';
                particle.style.transform = '';
            }, 500);
        });
    }

    /**
     * Create current surge effect (wave particles flow in one direction)
     */
    createCurrentSurge(intensity) {
        const particleContainer = this.getContainer('waves-particles');
        if (!particleContainer) return;

        const particles = particleContainer.querySelectorAll('.wave-particle');
        const direction = Math.random() < 0.5 ? 1 : -1;
        const surge = intensity * 3 * direction;

        particles.forEach((particle, index) => {
            setTimeout(() => {
                particle.style.transition = 'transform 1.2s ease-in-out';
                const currentTransform = particle.style.transform || '';
                particle.style.transform = `${currentTransform} translateX(${surge}vw)`;

                setTimeout(() => {
                    particle.style.transform = currentTransform;
                }, 1200);
            }, index * 20);
        });
    }

    /**
     * Create wave flash effect
     */
    createWaveFlash(intensity) {
        const theme = document.getElementById('waves-theme');
        if (!theme) return;

        const flash = document.createElement('div');
        flash.className = 'wave-flash-glow';
        flash.style.position = 'absolute';
        flash.style.inset = '0';
        flash.style.background = 'radial-gradient(circle at center, rgba(100,200,255,0.3), transparent 70%)';
        flash.style.opacity = '0';
        flash.style.pointerEvents = 'none';
        flash.style.zIndex = '15';
        flash.style.mixBlendMode = 'screen';

        theme.appendChild(flash);

        flash.style.transition = 'opacity 0.15s ease-out';
        requestAnimationFrame(() => {
            flash.style.opacity = `${Math.min(intensity * 0.15, 0.5)}`;
        });

        setTimeout(() => {
            flash.style.transition = 'opacity 0.4s ease-out';
            flash.style.opacity = '0';
            setTimeout(() => flash.remove(), 400);
        }, 150);
    }

    /**
     * Create expanding combo ripples
     */
    createComboRipples(comboCount) {
        const theme = document.getElementById('waves-theme');
        if (!theme) return;

        const rippleCount = Math.min(comboCount, this.activeQuality.maxRipples);

        for (let i = 0; i < rippleCount; i++) {
            setTimeout(() => {
                const ripple = document.createElement('div');
                ripple.className = 'wave-combo-ring';
                ripple.style.position = 'absolute';
                ripple.style.left = '50%';
                ripple.style.top = '50%';
                ripple.style.width = '50px';
                ripple.style.height = '50px';
                ripple.style.border = `3px solid rgba(80, 220, 255, ${0.8 - i * 0.1})`;
                ripple.style.borderRadius = '50%';
                ripple.style.transform = 'translate(-50%, -50%)';
                ripple.style.pointerEvents = 'none';
                ripple.style.zIndex = '12';
                ripple.style.boxShadow = `0 0 30px rgba(80, 220, 255, ${0.9 - i * 0.1})`;

                theme.appendChild(ripple);

                const maxSize = 1000 + comboCount * 100;
                const duration = 2500;

                ripple.style.transition = `all ${duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
                requestAnimationFrame(() => {
                    ripple.style.width = `${maxSize}px`;
                    ripple.style.height = `${maxSize}px`;
                    ripple.style.opacity = '0';
                });

                setTimeout(() => ripple.remove(), duration);
            }, i * 150);
        }
    }

    /**
     * Intensify ocean glow
     */
    intensifyOceanGlow(comboCount, comboScale = 1) {
        const theme = document.getElementById('waves-theme');
        if (!theme) return;

        const originalFilter = theme.style.filter || '';
        theme.style.transition = 'filter 0.8s ease-in-out';
        const brightness = 1.1 + comboCount * 0.05 * comboScale;
        const saturation = 100 + comboCount * 10 * comboScale;
        const hue = comboCount * 2 * comboScale;
        theme.style.filter = `brightness(${brightness}) saturate(${saturation}%) hue-rotate(${hue}deg)`;

        setTimeout(() => {
            theme.style.filter = originalFilter;
        }, 800 + comboCount * 100);
    }

    /**
     * Spawn floating orb-like bubbles for combos
     */
    spawnComboOrbBubbles(count, comboScale = 1, comboCount = 0) {
        const theme = document.getElementById('waves-theme');
        if (!theme) return;

        const pressure = Math.max(0, comboCount - 5);
        const densityFalloff = 1 - Math.min(0.5, pressure * 0.12);
        const maxOrbs = this.activeQuality.maxComboOrbs
            || Math.max(4, Math.floor(this.activeQuality.maxBubbles * comboScale));
        const scaledCount = Math.min(
            Math.max(1, Math.floor(count * comboScale * densityFalloff)),
            maxOrbs
        );

        for (let i = 0; i < scaledCount; i++) {
            setTimeout(() => {
                const orb = document.createElement('div');
                orb.className = 'wave-combo-orb';
                orb.style.position = 'absolute';
                const size = Math.random() * 14 + 8;
                orb.style.width = `${size}px`;
                orb.style.height = `${size}px`;
                orb.style.borderRadius = '50%';
                orb.style.background = 'radial-gradient(circle at 35% 35%, rgba(200,240,255,0.95), rgba(80,180,255,0.7))';
                orb.style.boxShadow = '0 0 20px rgba(100,200,255,0.9), inset -3px -3px 6px rgba(255,255,255,0.6)';
                orb.style.left = `${Math.random() * 100}%`;
                orb.style.top = `${Math.random() * 100}%`;
                orb.style.opacity = '0';
                orb.style.pointerEvents = 'none';
                orb.style.zIndex = '11';

                theme.appendChild(orb);

                const duration = (1800 + Math.random() * 1200) * (0.8 + 0.4 * comboScale);
                const drift = (Math.random() - 0.5) * 30 * comboScale;

                orb.style.transition = `all ${duration}ms ease-in-out`;
                requestAnimationFrame(() => {
                    orb.style.opacity = '0.9';
                    orb.style.transform = `translate(${drift}vw, -20vh) scale(${1.5 + Math.random() * comboScale})`;
                });

                setTimeout(() => {
                    orb.style.opacity = '0';
                    setTimeout(() => orb.remove(), 300);
                }, duration - 300);
            }, i * 50);
        }
    }

    /**
     * Create tidal surge effect (medium combo)
     */
    createTidalSurge(comboCount, comboScale = 1) {
        const theme = document.getElementById('waves-theme');
        if (!theme) return;

        const swellCount = Math.min(Math.floor(comboCount / 2), this.activeQuality.maxWaveSwells);
        const effectiveSwells = Math.max(1, Math.round(swellCount * comboScale));

        for (let i = 0; i < effectiveSwells; i++) {
            const swell = document.createElement('div');
            swell.className = 'wave-tidal-swell';
            swell.style.position = 'absolute';
            swell.style.left = '0';
            swell.style.bottom = `${i * 15}%`;
            swell.style.width = '100%';
            swell.style.height = '200px';
            swell.style.background = 'linear-gradient(to top, rgba(80,180,255,0.3), transparent)';
            swell.style.opacity = '0';
            swell.style.pointerEvents = 'none';
            swell.style.zIndex = '8';
            swell.style.filter = 'blur(20px)';

            theme.appendChild(swell);

            const duration = (2000 + i * 500) * (0.8 + 0.4 * comboScale);

            swell.style.transition = `all ${duration}ms ease-in-out`;
            requestAnimationFrame(() => {
                swell.style.opacity = `${0.6 - i * 0.1 * comboScale}`;
                swell.style.transform = `translateY(-${30 * comboScale}vh)`;
            });

            setTimeout(() => {
                swell.style.opacity = '0';
                setTimeout(() => swell.remove(), 500);
            }, duration - 500);
        }
    }

    /**
     * Create maelstrom swirl effect (high combo)
     */
    createMaelstromSwirl(comboCount, comboScale = 1) {
        const theme = document.getElementById('waves-theme');
        if (!theme) return;

        const vortex = document.createElement('div');
        vortex.className = 'wave-maelstrom';
        vortex.style.position = 'absolute';
        vortex.style.left = '50%';
        vortex.style.top = '50%';
        vortex.style.width = '100px';
        vortex.style.height = '100px';
        vortex.style.transform = 'translate(-50%, -50%)';
        vortex.style.pointerEvents = 'none';
        vortex.style.zIndex = '13';

        // Create spiral effect with multiple rings
        const ringCap = this.activeQuality.maxMaelstromRings || 5;
        const ringCount = Math.max(2, Math.min(ringCap, Math.round(3 + comboScale * 2)));
        for (let i = 0; i < ringCount; i++) {
            const ring = document.createElement('div');
            ring.style.position = 'absolute';
            ring.style.inset = `${i * 10}px`;
            const thickness = Math.max(1.5, 3 - i * 0.35);
            ring.style.border = `${thickness}px solid rgba(80, 200, 255, ${0.6 - i * 0.08})`;
            ring.style.borderRadius = '50%';
            ring.style.borderTopColor = 'transparent';
            ring.style.borderLeftColor = 'transparent';
            ring.style.animation = `wave-spin-${i % 2 === 0 ? 'cw' : 'ccw'} ${(1.5 - i * 0.15) * (1 + (1 - comboScale) * 0.3)}s linear infinite`;
            vortex.appendChild(ring);
        }

        theme.appendChild(vortex);

        // Add animation keyframes if not already present
        if (!document.getElementById('wave-maelstrom-animations')) {
            const style = document.createElement('style');
            style.id = 'wave-maelstrom-animations';
            style.textContent = `
                @keyframes wave-spin-cw {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes wave-spin-ccw {
                    from { transform: rotate(360deg); }
                    to { transform: rotate(0deg); }
                }
            `;
            document.head.appendChild(style);
        }

        const duration = (2200 + Math.min(comboCount, 8) * 140) * (0.7 + 0.3 * comboScale);
        const sizeCap = this.activeQuality.maxMaelstromSize || 850;
        const targetSize = Math.min(
            sizeCap,
            (480 + comboCount * 40) * (0.7 + 0.3 * comboScale)
        );

        vortex.style.transition = `all ${duration}ms ease-out`;
        requestAnimationFrame(() => {
            vortex.style.width = `${targetSize}px`;
            vortex.style.height = `${targetSize}px`;
            vortex.style.opacity = '0';
        });

        setTimeout(() => vortex.remove(), duration);
    }

    /**
     * Create oceanic bloom effect (epic combo)
     */
    createOceanicBloom(comboCount, comboScale = 1) {
        const theme = document.getElementById('waves-theme');
        if (!theme) return;

        // Create radiant bloom from center
        const bloom = document.createElement('div');
        bloom.className = 'wave-oceanic-bloom';
        bloom.style.position = 'absolute';
        bloom.style.left = '50%';
        bloom.style.top = '50%';
        bloom.style.width = '50px';
        bloom.style.height = '50px';
        bloom.style.transform = 'translate(-50%, -50%)';
        bloom.style.background = 'radial-gradient(circle, rgba(150,230,255,0.7), rgba(80,180,255,0.3) 40%, transparent 70%)';
        bloom.style.borderRadius = '50%';
        bloom.style.pointerEvents = 'none';
        bloom.style.zIndex = '14';
        bloom.style.opacity = '0';
        bloom.style.boxShadow = '0 0 40px rgba(100,200,255,0.7)';
        bloom.style.willChange = 'transform, opacity';

        theme.appendChild(bloom);

        const bloomCap = this.activeQuality.maxBloomSize || 1050;
        const maxSize = Math.min(
            bloomCap,
            (820 + comboCount * 55) * (0.75 + 0.25 * comboScale)
        );
        const duration = 2400 * (0.85 + 0.35 * comboScale);

        bloom.style.transition = `all ${duration}ms cubic-bezier(0.19, 1, 0.22, 1)`;
        requestAnimationFrame(() => {
            bloom.style.width = `${maxSize}px`;
            bloom.style.height = `${maxSize}px`;
            bloom.style.opacity = '0.78';
        });

        setTimeout(() => {
            bloom.style.opacity = '0';
            setTimeout(() => bloom.remove(), 800);
        }, duration - 800);

        // Spawn radiating particles (performance-aware)
        const pressure = Math.max(0, comboCount - 7);
        const densityFalloff = 1 - Math.min(0.45, pressure * 0.1);
        const baseParticleCap = this.activeQuality.bloomParticleCap || 6;
        const particleCount = Math.max(
            3,
            Math.round(baseParticleCap * comboScale * densityFalloff)
        );

        for (let i = 0; i < particleCount; i++) {
            setTimeout(() => {
                const particle = document.createElement('div');
                particle.style.position = 'absolute';
                particle.style.left = '50%';
                particle.style.top = '50%';
                particle.style.width = '3px';
                particle.style.height = '3px';
                particle.style.borderRadius = '50%';
                particle.style.background = 'rgba(150,230,255,0.8)';
                particle.style.boxShadow = '0 0 10px rgba(100,200,255,0.7)';
                particle.style.pointerEvents = 'none';
                particle.style.zIndex = '14';
                particle.style.willChange = 'transform, opacity';

                theme.appendChild(particle);

                const angle = (i / particleCount) * Math.PI * 2;
                const distance = (260 + Math.random() * 140) * (0.85 + 0.35 * comboScale);
                const x = Math.cos(angle) * distance;
                const y = Math.sin(angle) * distance;

                const particleDuration = 1800 * (0.85 + 0.3 * comboScale);
                particle.style.transition = `all ${particleDuration}ms ease-out`;
                requestAnimationFrame(() => {
                    particle.style.transform = `translate(${x}px, ${y}px) scale(1.5)`;
                    particle.style.opacity = '0';
                });

                setTimeout(() => particle.remove(), particleDuration);
            }, i * 100);
        }
    }

    /**
     * Spawn a single gentle bubble
     */
    spawnSingleBubble() {
        const theme = document.getElementById('waves-theme');
        if (!theme) return;

        const bubble = document.createElement('div');
        bubble.className = 'wave-subtle-bubble';
        bubble.style.position = 'absolute';
        const size = Math.random() * 8 + 3;
        bubble.style.width = `${size}px`;
        bubble.style.height = `${size}px`;
        bubble.style.borderRadius = '50%';
        bubble.style.background = 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.7), rgba(100,200,255,0.4))';
        bubble.style.boxShadow = '0 0 8px rgba(100,200,255,0.5)';
        bubble.style.left = `${30 + Math.random() * 40}%`;
        bubble.style.bottom = `${10 + Math.random() * 20}%`;
        bubble.style.opacity = '0';
        bubble.style.pointerEvents = 'none';
        bubble.style.zIndex = '10';

        theme.appendChild(bubble);

        const duration = 2000 + Math.random() * 1500;
        const sway = (Math.random() - 0.5) * 15;

        bubble.style.transition = `all ${duration}ms ease-out`;
        requestAnimationFrame(() => {
            bubble.style.opacity = '0.6';
            bubble.style.bottom = `${70 + Math.random() * 20}%`;
            bubble.style.left = `calc(${bubble.style.left} + ${sway}px)`;
        });

        setTimeout(() => bubble.remove(), duration);
    }

    /**
     * Create a soft ripple effect
     */
    createSoftRipple() {
        const theme = document.getElementById('waves-theme');
        if (!theme) return;

        const ripple = document.createElement('div');
        ripple.className = 'wave-soft-ripple';
        ripple.style.position = 'absolute';
        ripple.style.left = `${30 + Math.random() * 40}%`;
        ripple.style.top = `${30 + Math.random() * 40}%`;
        ripple.style.width = '30px';
        ripple.style.height = '30px';
        ripple.style.border = '1px solid rgba(100, 200, 255, 0.4)';
        ripple.style.borderRadius = '50%';
        ripple.style.transform = 'translate(-50%, -50%)';
        ripple.style.pointerEvents = 'none';
        ripple.style.zIndex = '9';

        theme.appendChild(ripple);

        const duration = 1500;

        ripple.style.transition = `all ${duration}ms ease-out`;
        requestAnimationFrame(() => {
            ripple.style.width = '200px';
            ripple.style.height = '200px';
            ripple.style.opacity = '0';
        });

        setTimeout(() => ripple.remove(), duration);
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        this.teardownEventListeners();

        // Clear reset timeout
        if (this.resetTimeout) {
            clearTimeout(this.resetTimeout);
            this.resetTimeout = null;
        }

        this.clearComboArtifacts();

        super.cleanup();
    }

    /**
     * Provide Waves themed tetromino styling (aquatic glow palette)
     * @returns {Object} Waves tetromino configuration
     */
    getTetrominoConfig() {
        return WAVES_TETROMINOS;
    }
}
