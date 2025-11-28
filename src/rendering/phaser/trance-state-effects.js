/**
 * @fileoverview Trance State Effects for Infinity Mode Pause
 *
 * Creates a meditative, trance-like visual experience when the game is paused
 * in Infinity Mode. Features subtle particles, color waves, and calming animations
 * designed for a pleasant UX experience.
 *
 * IMPORTANT NOTE: The base BoardScene clears graphics every frame in its update() loop.
 * To persist visual effects, we use:
 * - Rectangle shapes (not cleared graphics) for static overlays
 * - Particle emitters (manage their own lifecycle)
 * - Text objects (not cleared)
 * - Graphics that redraw themselves in our update loop (waves)
 */

import {
    createParticleEmitter,
    destroyParticleEmitter,
} from './utils/particle-compat.js';

/**
 * TranceStateEffects - Manages trance-like visual effects during pause
 */
export class TranceStateEffects {
    /**
     * Create a new TranceStateEffects instance
     * @param {Phaser.Scene} scene - The Phaser scene that will host these effects
     */
    constructor(scene) {
        this.scene = scene;
        this.isActive = false;

        // Active effect references for cleanup
        this.activeEmitters = [];
        this.activeTweens = [];
        this.activeGraphics = [];
        this.updateLoop = null;

        // Viewport anchored references
        this.overlayRect = null;
        this.overlayGlow = null;
        this.pausedText = null;
        this.subtitleText = null;
        this.domOverlay = null;
        this.domOverlayRemovalTimer = null;
        this.bokehOrbs = [];
        this.isStopping = false;
        this.pendingDestroy = false;
        this.fadeOutDuration = 5200;
        this.domFadeDuration = 3400;

        // Animation state
        this.time = 0;
        this.colorPhase = 0;

        // Cached particle texture key
        this.particleTextureKey = null;

        // Trance colors - calm, meditative palette
        this.tranceColors = [
            0x6a5acd, // Slate blue
            0x9370db, // Medium purple
            0x8b7fbf, // Lavender
            0x5f9ea0, // Cadet blue
            0x48d1cc, // Medium turquoise
            0x87ceeb, // Sky blue
        ];

        console.log('[TranceStateEffects] Initialized');
    }

    /**
     * Start the trance state visual effects
     */
    start() {
        if (this.isActive) {
            console.log('[TranceStateEffects] Already active, skipping start');
            return;
        }

        console.log('[TranceStateEffects] Starting trance state...');
        this.isActive = true;
        this.isStopping = false;
        this.pendingDestroy = false;
        this.time = 0;

        // Create overlay gradient
        this.createOverlay();
        this.createDomOverlay();

        // Start floating particles
        this.createFloatingParticles();
        this.createGoldenSparkles();

        // Start breathing pulse effect on board
        this.createBreathingPulse();
        this.createBokehOrbs();

        // Start update loop for animated effects
        this.startUpdateLoop();

        console.log('[TranceStateEffects] Trance state started');
    }

    /**
     * Stop the trance state visual effects
     */
    stop(options = {}) {
        const { immediate = false } = options;

        if (!this.isActive && !this.isStopping) {
            console.log('[TranceStateEffects] Not active, skipping stop');
            return;
        }

        if (immediate) {
            console.log('[TranceStateEffects] Immediate stop requested');
            if (this.updateLoop) {
                this.updateLoop.remove();
                this.updateLoop = null;
            }
            this._destroyAllEffectsNow(true);
            this.isActive = false;
            this.isStopping = false;
            return;
        }

        if (this.isStopping) {
            console.log('[TranceStateEffects] Stop already in progress');
            return;
        }

        console.log('[TranceStateEffects] Stopping trance state...');
        this.isStopping = true;

        // Begin graceful fade out, then finalize cleanup
        this.fadeOutAndCleanup(() => {
            if (this.updateLoop) {
                this.updateLoop.remove();
                this.updateLoop = null;
            }

            this.isActive = false;
            this.isStopping = false;
            if (this.pendingDestroy) {
                this._destroyAllEffectsNow(false);
                this.scene = null;
                this.pendingDestroy = false;
            }
            console.log('[TranceStateEffects] Trance state fully stopped');
        });
    }

    _destroyAllEffectsNow(immediateDom = true) {
        this.activeGraphics.forEach((graphics) => {
            graphics?.destroy?.();
        });
        this.activeEmitters.forEach((entry) => {
            if (entry?.emitter) {
                destroyParticleEmitter(entry.emitter);
            }
        });
        this.activeTweens.forEach((tween) => {
            tween?.stop?.();
        });

        this.activeGraphics = [];
        this.activeEmitters = [];
        this.activeTweens = [];
        this.overlayRect = null;
        this.overlayGlow = null;
        this.pausedText = null;
        this.subtitleText = null;
        this.bokehOrbs = [];

        this.destroyDomOverlay(immediateDom);
        this.pendingDestroy = false;
    }

    /**
     * Create a subtle overlay gradient for depth
     * NOTE: CRITICAL - Must use setScrollFactor(1) to follow camera or position relative to camera!
     * @private
     */
    createOverlay() {
        const boardWidth = this.getBoardWidth();
        const boardHeight = this.getBoardHeight();

        // Get camera viewport dimensions
        const camera = this.scene.cameras?.main;
        const viewportWidth = camera ? camera.width : boardWidth;
        const viewportHeight = camera ? camera.height : boardHeight;

        console.log('[TranceStateEffects] Creating overlay:', {
            boardWidth,
            boardHeight,
            viewportWidth,
            viewportHeight,
            cameraWorldView: camera ? {
                x: camera.worldView.x, y: camera.worldView.y, width: camera.worldView.width, height: camera.worldView.height,
            } : 'no camera',
        });

        // Add an additive golden glow layer for a warmer pause feel
        const glow = this.scene.add.rectangle(
            viewportWidth / 2,
            viewportHeight / 2,
            viewportWidth * 1.5,
            viewportHeight * 1.5,
            0xffd88a,
            0,
        );

        glow.setScrollFactor(0, 0);
        glow.setDepth(-20);
        glow.setBlendMode('ADD');
        this.overlayGlow = glow;
        this.activeGraphics.push(glow);

        // Fade in the overlay
        const glowTween = this.scene.tweens.add({
            targets: glow,
            alpha: 0.22,
            duration: 1400,
            ease: 'Sine.easeInOut',
        });

        this.activeTweens.push(glowTween);
        this.updateViewportAnchoredElements();
    }

    /**
     * Create floating particle emitters throughout the board
     * @private
     */
    createFloatingParticles() {
        const particleKey = this.resolveParticleTextureKey();
        if (!particleKey) return;

        const camera = this.scene.cameras?.main;
        const viewportWidth = camera ? camera.width : this.getBoardWidth();
        const viewportHeight = camera ? camera.height : this.getBoardHeight();
        const PhaserRef = window.Phaser;

        console.log('[TranceStateEffects] Creating floating particles:', { viewportWidth, viewportHeight });

        if (!PhaserRef?.Geom?.Rectangle) {
            console.warn('[TranceStateEffects] Phaser.Geom.Rectangle not available');
            return;
        }

        // Create 3 emitters for layered depth effect with LOTS of particles
        // Positioned in screen coordinates (scrollFactor will be 0)
        for (let layer = 0; layer < 3; layer++) {
            const emitter = createParticleEmitter(
                this.scene,
                viewportWidth / 2,
                viewportHeight, // Bottom of viewport
                particleKey,
                {
                    x: { min: 0, max: viewportWidth },
                    y: viewportHeight + 20,
                    speed: { min: 20 + layer * 8, max: 45 + layer * 15 },
                    angle: { min: -110, max: -70 }, // Wider angle range for variety
                    lifespan: { min: 8000, max: 14000 }, // Much longer lifespan for more particles on screen
                    frequency: 35 - layer * 8, // Much more frequent emissions (was 80-65-50, now 35-27-19)
                    quantity: 2 + layer, // Emit multiple particles at once (2, 3, 4 per emission)
                    alpha: { start: 0.65 - layer * 0.08, end: 0 }, // More visible
                    scale: { start: 0.5 + layer * 0.25, end: 0.15 }, // Larger particles
                    blendMode: 'ADD',
                    tint: this.tranceColors[layer % this.tranceColors.length],
                },
            );

            if (emitter) {
                // Set depth - emitters might not respect setDepth in Phaser 4
                if (emitter.setDepth) {
                    emitter.setDepth(1001 + layer);
                }
                if (emitter.setScrollFactor) {
                    emitter.setScrollFactor(0, 0); // Pin to viewport!
                }

                // Start continuous emission
                if (emitter.start) {
                    emitter.start();
                }

                this.activeEmitters.push({ emitter, type: 'floating', layer });
                console.log('[TranceStateEffects] Created floating particle layer', layer, 'setDepth called with:', 1001 + layer, 'actual depth:', emitter.depth);
            } else {
                console.warn('[TranceStateEffects] Failed to create emitter for layer', layer);
            }
        }

        console.log('[TranceStateEffects] All particle emitters created, total:', this.activeEmitters.length);
        this.updateViewportAnchoredElements();
    }

    /**
     * Create glowing golden particles hovering near the board center
     * @private
     */
    createGoldenSparkles() {
        const particleKey = this.resolveParticleTextureKey();
        if (!particleKey) return;

        const camera = this.scene.cameras?.main;
        const viewportWidth = camera ? camera.width : this.getBoardWidth();
        const viewportHeight = camera ? camera.height : this.getBoardHeight();
        // Board sits slightly left inside the viewport, so bias the emitter center accordingly
        const centerX = viewportWidth / 2 - viewportWidth * 0.24;
        const centerY = viewportHeight / 2 - viewportHeight * 0.05;

        const PhaserRef = window.Phaser;
        let emitZone = null;

        if (PhaserRef?.Geom?.Rectangle) {
            const zoneWidth = viewportWidth * 0.58;
            const zoneHeight = viewportHeight * 0.85;
            emitZone = new PhaserRef.Geom.Rectangle(
                centerX - zoneWidth / 2,
                centerY - zoneHeight / 2,
                zoneWidth,
                zoneHeight,
            );
        }

        const emitter = createParticleEmitter(
            this.scene,
            centerX,
            centerY,
            particleKey,
            {
                lifespan: { min: 6200, max: 9600 },
                speed: { min: 8, max: 18 },
                gravityY: -12,
                scale: { start: 0.85, end: 0.2 },
                alpha: { start: 0.75, end: 0 },
                blendMode: 'ADD',
                tint: 0xffd966,
                frequency: 64,
                quantity: 2,
                angle: { min: 190, max: 350 },
                rotate: { min: -80, max: 80 },
                emitZone: emitZone ? { type: 'random', source: emitZone } : undefined,
            },
        );

        if (!emitter) {
            console.warn('[TranceStateEffects] Golden sparkles emitter failed to initialize');
            return;
        }

        if (emitter.setDepth) {
            emitter.setDepth(1008);
        }
        if (emitter.setScrollFactor) {
            emitter.setScrollFactor(0, 0);
        }
        if (emitter.start) {
            emitter.start();
        }

        this.activeEmitters.push({ emitter, type: 'golden', zone: emitZone });
        console.log('[TranceStateEffects] Golden sparkle emitter created');
        this.updateViewportAnchoredElements();
    }

    /**
     * Create breathing pulse effect on the board container
     * @private
     */
    createBreathingPulse() {
        // Find the camera to apply a subtle zoom effect
        const camera = this.scene.cameras?.main;

        if (!camera) {
            console.warn('[TranceStateEffects] Camera not found for breathing pulse');
            return;
        }

        console.log('[TranceStateEffects] Creating breathing pulse on camera');

        // Create gentle zoom pulse (breathing effect)
        const tween = this.scene.tweens.add({
            targets: camera,
            zoom: { from: 1.0, to: 1.005 },
            duration: 3000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        this.activeTweens.push(tween);
        console.log('[TranceStateEffects] Breathing pulse tween created on camera');
    }

    /**
     * Start the update loop for animated effects
     * @private
     */
    startUpdateLoop() {
        this.updateLoop = this.scene.time.addEvent({
            delay: 16, // ~60fps
            callback: () => this.update(),
            loop: true,
        });
    }

    /**
     * Update animated effects each frame
     * @private
     */
    update() {
        if (!this.isActive) return;

        this.updateViewportAnchoredElements();
        this.time += 16;
        this.colorPhase = (this.time * 0.001) % (Math.PI * 2);

        // Update particle colors
        this.updateParticleColors();
    }

    /**
     * Update particle emitter colors to cycle through trance palette
     * @private
     */
    updateParticleColors() {
        const colorIndex = Math.floor((this.colorPhase / (Math.PI * 2)) * this.tranceColors.length);

        let floatingIndex = 0;
        this.activeEmitters.forEach((entry) => {
            const emitter = entry?.emitter;
            if (!emitter) return;

            if (entry.type === 'golden') {
                if (emitter.tint && emitter.tint.value !== 0xffd966) {
                    emitter.tint = 0xffd966;
                }
                return;
            }

            if (emitter.tint) {
                const color = this.tranceColors[(colorIndex + floatingIndex) % this.tranceColors.length];
                if (emitter.tint.value !== color) {
                    emitter.tint = color;
                }
            }
            floatingIndex += 1;
        });
    }

    /**
     * Keep overlay, text, and emitters aligned with the current camera view
     * NOTE: With scrollFactor(0,0), elements use SCREEN coordinates, not world coordinates
     * @private
     */
    updateViewportAnchoredElements() {
        if (!this.scene || !this.isActive) return;

        const camera = this.scene.cameras?.main;
        if (!camera) return;

        // Screen dimensions (not world coordinates)
        const screenWidth = camera.width;
        const screenHeight = camera.height;
        const screenCenterX = screenWidth / 2;
        const screenCenterY = screenHeight / 2;

        if (this.pausedText) {
            this.pausedText.x = screenCenterX;
            this.pausedText.y = screenHeight * 0.35;
        }

        if (this.subtitleText) {
            this.subtitleText.x = screenCenterX;
            this.subtitleText.y = screenHeight * 0.42;
        }

        if (this.overlayGlow) {
            const glowWidth = screenWidth * 1.5;
            const glowHeight = screenHeight * 1.5;
            this.overlayGlow.x = screenCenterX;
            this.overlayGlow.y = screenCenterY;
            if (this.overlayGlow.setSize) {
                this.overlayGlow.setSize(glowWidth, glowHeight);
            }
            this.overlayGlow.width = glowWidth;
            this.overlayGlow.height = glowHeight;
            if (this.overlayGlow.setDisplaySize) {
                this.overlayGlow.setDisplaySize(glowWidth, glowHeight);
            }
        }

        if (this.activeEmitters.length > 0) {
            let floatingIndex = 0;
            this.activeEmitters.forEach((entry) => {
                const emitter = entry?.emitter;
                if (!emitter) {
                    return;
                }

                if (entry.type === 'golden') {
                    if (entry.zone && entry.zone.setTo) {
                        const zoneWidth = screenWidth * 0.58;
                        const zoneHeight = screenHeight * 0.85;
                        entry.zone.setTo(
                            (screenCenterX - screenWidth * 0.24) - zoneWidth / 2,
                            screenCenterY - zoneHeight / 2,
                            zoneWidth,
                            zoneHeight,
                        );
                        if (emitter.emitZone) {
                            emitter.emitZone.source = entry.zone;
                        }
                    } else {
                        // Fallback: keep emitter roughly centered but sway for movement
                        const sway = Math.sin((this.time + (entry.layer || 0) * 90) * 0.001) * 26;
                        const focusX = screenCenterX - screenWidth * 0.24;
                        const focusY = screenCenterY - screenHeight * 0.2 + sway;
                        if (emitter.setPosition) {
                            emitter.setPosition(focusX, focusY);
                        } else {
                            emitter.x = focusX;
                            emitter.y = focusY;
                        }
                    }
                    return;
                }

                // Floating particles emit from bottom of screen
                const emitterY = screenHeight + 20 + floatingIndex * 12;
                floatingIndex += 1;
                if (emitter.setPosition) {
                    emitter.setPosition(screenCenterX, emitterY);
                } else {
                    emitter.x = screenCenterX;
                    emitter.y = emitterY;
                }
            });
        }

        this.updateBokehOrbs(screenCenterX, screenCenterY, screenWidth, screenHeight);
    }

    /**
     * Get the current camera viewport dimensions in world coordinates
     * @returns {{x:number,y:number,width:number,height:number,centerX:number,centerY:number}|null}
     * @private
     */
    getCameraViewport() {
        const camera = this.scene?.cameras?.main;
        if (!camera) return null;

        const { worldView } = camera;
        if (worldView) {
            return {
                x: worldView.x,
                y: worldView.y,
                width: worldView.width,
                height: worldView.height,
                centerX: worldView.x + worldView.width / 2,
                centerY: worldView.y + worldView.height / 2,
            };
        }

        const zoom = camera.zoom || 1;
        const width = camera.width / zoom;
        const height = camera.height / zoom;

        return {
            x: camera.scrollX,
            y: camera.scrollY,
            width,
            height,
            centerX: camera.scrollX + width / 2,
            centerY: camera.scrollY + height / 2,
        };
    }

    /**
     * Resolve and cache a usable particle texture key
     * @private
     * @returns {string|null}
     */
    resolveParticleTextureKey() {
        if (this.particleTextureKey && this.scene.textures?.exists(this.particleTextureKey)) {
            return this.particleTextureKey;
        }

        const candidates = ['line-clear-particle', 'common-circle-4px', 'particle'];
        for (const key of candidates) {
            if (this.scene.textures && this.scene.textures.exists(key)) {
                this.particleTextureKey = key;
                console.log('[TranceStateEffects] Using particle texture:', key);
                return key;
            }
        }

        console.warn('[TranceStateEffects] No particle texture found. Tried:', candidates);
        console.warn(
            '[TranceStateEffects] Available textures:',
            this.scene.textures ? Object.keys(this.scene.textures.list) : 'textures not available',
        );
        return null;
    }

    /**
     * Fade out and clean up all effects
     * @private
     */
    fadeOutAndCleanup(onComplete) {
        console.log('[TranceStateEffects] Fading out and cleaning up...');

        // Fade out all graphics
        const fadeDuration = this.fadeOutDuration || 1000;

        this.activeGraphics.forEach((graphics, index) => {
            if (graphics && graphics.scene) {
                this.scene.tweens.add({
                    targets: graphics,
                    alpha: 0,
                    duration: fadeDuration,
                    delay: Math.min(index * 45, 250),
                    ease: 'Sine.easeInOut',
                    onComplete: () => {
                        if (graphics && graphics.destroy) {
                            graphics.destroy();
                        }
                    },
                });
            }
        });

        // Stop and fade out all emitters
        this.activeEmitters.forEach((entry) => {
            const emitter = entry?.emitter;
            if (!emitter) return;

            if (emitter.stop) {
                emitter.stop();
            }

            const delay = fadeDuration + 1400;
            if (this.scene?.time?.delayedCall) {
                this.scene.time.delayedCall(delay, () => {
                    destroyParticleEmitter(emitter);
                });
            } else {
                setTimeout(() => destroyParticleEmitter(emitter), delay);
            }
        });

        // Stop all tweens
        this.activeTweens.forEach((tween) => {
            if (tween && tween.stop) {
                tween.stop();
            }
        });

        // Clear arrays
        this.activeGraphics = [];
        this.activeEmitters = [];
        this.activeTweens = [];
        this.overlayRect = null;
        this.overlayGlow = null;
        this.pausedText = null;
        this.subtitleText = null;

        const finalize = () => {
            console.log('[TranceStateEffects] Cleanup complete');

            // Remove DOM overlay with a graceful fade
            this.destroyDomOverlay();

            if (typeof onComplete === 'function') {
                onComplete();
            }
        };

        const finalizeDelay = fadeDuration + 1600;
        if (this.scene?.time?.delayedCall) {
            this.scene.time.delayedCall(finalizeDelay, finalize);
        } else {
            setTimeout(finalize, finalizeDelay);
        }
    }

    /**
     * Create subtle text overlay indicating pause/trance state
     * @private
     */
    createTextOverlay() {
        const boardWidth = this.getBoardWidth();
        const boardHeight = this.getBoardHeight();

        // Create "PAUSED" text
        const pausedText = this.scene.add.text(
            boardWidth / 2,
            boardHeight * 0.35,
            'PAUSED',
            {
                fontSize: '42px',
                fontFamily: 'Orbitron, sans-serif',
                color: '#ffeec7',
                stroke: '#f4b945',
                strokeThickness: 3,
                alpha: 0,
            },
        );

        pausedText.setOrigin(0.5);
        pausedText.setScrollFactor(0, 0);
        pausedText.setDepth(1010); // Very high depth

        // Create subtitle text
        const subtitleText = this.scene.add.text(
            boardWidth / 2,
            boardHeight * 0.42,
            'Navigate with arrow keys • Breathe • Observe',
            {
                fontSize: '14px',
                fontFamily: 'Arial, sans-serif',
                color: '#ffe2b0',
                alpha: 0,
            },
        );

        subtitleText.setOrigin(0.5);
        subtitleText.setScrollFactor(0, 0);
        subtitleText.setDepth(1010); // Very high depth

        console.log('[TranceStateEffects] Text overlay created:', {
            pausedText: { x: pausedText.x, y: pausedText.y, depth: pausedText.depth },
            subtitleText: { x: subtitleText.x, y: subtitleText.y, depth: subtitleText.depth },
        });

        this.activeGraphics.push(pausedText);
        this.activeGraphics.push(subtitleText);
        this.pausedText = pausedText;
        this.subtitleText = subtitleText;
        this.updateViewportAnchoredElements();

        // Fade in text
        this.scene.tweens.add({
            targets: pausedText,
            alpha: 0.8,
            duration: 1200,
            ease: 'Sine.easeInOut',
        });

        this.scene.tweens.add({
            targets: subtitleText,
            alpha: 0.6,
            duration: 1500,
            ease: 'Sine.easeInOut',
        });

        // Subtle breathing animation on text
        const breathTween = this.scene.tweens.add({
            targets: [pausedText, subtitleText],
            alpha: { from: pausedText.alpha, to: 0.5 },
            duration: 3000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        this.activeTweens.push(breathTween);
    }

    /**
     * Spawn slow-moving bokeh orbs for parallax and dreaminess
     */
    createBokehOrbs() {
        this.bokehOrbs = [];
        if (!this.scene?.add?.circle) return;

        const orbCount = 6;
        for (let i = 0; i < orbCount; i += 1) {
            const radius = 60 + i * 12;
            const orb = this.scene.add.circle(0, 0, radius, 0xffffff, 0.05 + i * 0.01);
            orb.setScrollFactor(0, 0);
            orb.setDepth(1003 + i);
            orb.setBlendMode('SCREEN');
            orb.setScale(0.8 + Math.random() * 0.35);
            this.activeGraphics.push(orb);
            this.bokehOrbs.push({
                orb,
                angle: Math.random() * Math.PI * 2,
                radiusMultiplier: 0.18 + i * 0.08,
                speed: 0.00018 + Math.random() * 0.00022,
                verticalSkew: 0.35 + Math.random() * 0.2,
            });
        }
    }

    updateBokehOrbs(cx, cy, width, height) {
        if (!this.bokehOrbs || this.bokehOrbs.length === 0) return;

        this.bokehOrbs.forEach((entry, index) => {
            const { orb } = entry;
            if (!orb) return;
            entry.angle += entry.speed * 16;
            const orbitRadius = Math.min(width, height) * entry.radiusMultiplier;
            const horizontal = Math.cos(entry.angle) * orbitRadius;
            const vertical = Math.sin(entry.angle * entry.verticalSkew) * orbitRadius * 0.8;
            orb.x = cx + horizontal;
            orb.y = cy - height * 0.05 + vertical;
            const scalePulse = 0.85 + Math.sin(this.time * 0.0004 + index) * 0.12;
            orb.setScale(scalePulse);
            orb.setAlpha(0.12 + Math.sin(this.time * 0.0003 + entry.angle) * 0.05);
        });
    }

    /**
     * Create a fullscreen DOM overlay so pause effects cover the entire viewport
     * @private
     */
    createDomOverlay() {
        if (typeof document === 'undefined' || this.domOverlay) {
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'trance-overlay-root';

        const glow = document.createElement('div');
        glow.className = 'trance-overlay-glow';
        overlay.appendChild(glow);

        const particles = document.createElement('div');
        particles.className = 'trance-overlay-particles';
        overlay.appendChild(particles);

        const particleCount = 42;
        for (let i = 0; i < particleCount; i += 1) {
            const particle = document.createElement('span');
            particle.className = 'trance-particle';
            const delay = (Math.random() * 6).toFixed(2);
            const duration = (9 + Math.random() * 10).toFixed(2);
            const size = (6 + Math.random() * 16).toFixed(1);
            particle.style.setProperty('--delay', `${delay}s`);
            particle.style.setProperty('--duration', `${duration}s`);
            particle.style.setProperty('--size', `${size}px`);
            particle.style.setProperty('--left', `${(Math.random() * 100).toFixed(2)}%`);
            particle.style.setProperty('--hue', `${Math.round(38 + Math.random() * 14)}`);
            particles.appendChild(particle);
        }

        document.body.appendChild(overlay);
        this.domOverlay = overlay;

        // Fade in on next frame to allow transition
        const schedule = (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function')
            ? window.requestAnimationFrame.bind(window)
            : (cb) => setTimeout(cb, 16);
        schedule(() => {
            if (this.domOverlay) {
                this.domOverlay.classList.add('trance-overlay-visible');
            }
        });
    }

    /**
     * Remove the DOM overlay when the trance state ends
     * @param {boolean} immediate
     * @private
     */
    destroyDomOverlay(immediate = false) {
        if (!this.domOverlay) {
            return;
        }

        const overlay = this.domOverlay;
        const cleanup = () => {
            if (overlay.parentElement) {
                overlay.parentElement.removeChild(overlay);
            }
            this.domOverlay = null;
            if (this.domOverlayRemovalTimer) {
                clearTimeout(this.domOverlayRemovalTimer);
                this.domOverlayRemovalTimer = null;
            }
        };

        if (immediate) {
            cleanup();
            return;
        }

        overlay.classList.remove('trance-overlay-visible');
        overlay.classList.add('trance-overlay-exit');
        if (this.domOverlayRemovalTimer) {
            clearTimeout(this.domOverlayRemovalTimer);
        }
        const duration = this.domFadeDuration || 450;
        this.domOverlayRemovalTimer = setTimeout(cleanup, duration);
    }

    /**
     * Get board width safely
     * @private
     */
    getBoardWidth() {
        if (this.scene.cols && this.scene.blockSize) {
            return this.scene.cols * this.scene.blockSize;
        }
        // Fallback: standard board dimensions
        return 10 * 30; // 10 columns * 30px block size
    }

    /**
     * Get board height safely
     * @private
     */
    getBoardHeight() {
        if (this.scene.rows && this.scene.blockSize) {
            return this.scene.rows * this.scene.blockSize;
        }
        // Fallback: standard board dimensions
        return 20 * 30; // 20 rows * 30px block size
    }

    /**
     * Destroy the trance state effects manager
     */
    destroy() {
        if (this.isStopping) {
            this.pendingDestroy = true;
            return;
        }

        if (this.isActive) {
            this.stop({ immediate: true });
        } else {
            this._destroyAllEffectsNow(true);
        }

        this.scene = null;
    }
}
