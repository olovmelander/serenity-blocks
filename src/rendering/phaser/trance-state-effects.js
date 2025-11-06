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
        this.auraGraphics = null;

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
        this.time = 0;

        // Create overlay gradient
        this.createOverlay();
        this.createRadiantAura();

        // Start floating particles
        this.createFloatingParticles();
        this.createGoldenSparkles();

        // Start color wave animations
        this.createColorWaves();

        // Start breathing pulse effect on board
        this.createBreathingPulse();

        // Start update loop for animated effects
        this.startUpdateLoop();

        console.log('[TranceStateEffects] Trance state started');
    }

    /**
     * Stop the trance state visual effects
     */
    stop() {
        if (!this.isActive) {
            console.log('[TranceStateEffects] Not active, skipping stop');
            return;
        }

        console.log('[TranceStateEffects] Stopping trance state...');
        this.isActive = false;

        // Stop update loop
        if (this.updateLoop) {
            this.updateLoop.remove();
            this.updateLoop = null;
        }

        // Clean up all effects with fade out
        this.fadeOutAndCleanup();
    }

    /**
     * Create a subtle overlay gradient for depth
     * NOTE: CRITICAL - Must use setScrollFactor(1) to follow camera or position relative to camera!
     * @private
     */
    createOverlay() {
        const boardWidth = this.getBoardWidth();
        const boardHeight = this.getBoardHeight();

        // Get camera position to position overlay in viewport
        const camera = this.scene.cameras?.main;
        const cameraY = camera ? camera.scrollY : 0;

        console.log('[TranceStateEffects] Creating overlay:', {
            boardWidth,
            boardHeight,
            cameraY,
            cameraWorldView: camera ? {
                x: camera.worldView.x, y: camera.worldView.y, width: camera.worldView.width, height: camera.worldView.height,
            } : 'no camera',
        });

        // Create overlay at camera's current position
        // Center position for Rectangle with default origin (0.5, 0.5)
        const overlay = this.scene.add.rectangle(
            boardWidth / 2,
            cameraY + boardHeight / 2,
            boardWidth,
            boardHeight,
            0x1a0033, // Deep purple-blue
            0, // Start invisible
        );

        // CRITICAL: Use scrollFactor 1 to follow camera, not 0!
        overlay.setScrollFactor(1, 1);
        overlay.setDepth(1000);
        overlay.setBlendMode('NORMAL');
        this.overlayRect = overlay;

        console.log('[TranceStateEffects] Overlay rectangle created:', {
            x: overlay.x,
            y: overlay.y,
            width: overlay.width,
            height: overlay.height,
            depth: overlay.depth,
            scrollFactorX: overlay.scrollFactorX,
            scrollFactorY: overlay.scrollFactorY,
        });

        this.activeGraphics.push(overlay);
        this.updateViewportAnchoredElements();

        // Add an additive golden glow layer for a warmer pause feel
        const glow = this.scene.add.rectangle(
            boardWidth / 2,
            cameraY + boardHeight / 2,
            boardWidth * 0.85,
            boardHeight * 0.85,
            0xffd88a,
            0,
        );

        glow.setScrollFactor(1, 1);
        glow.setDepth(1002);
        glow.setBlendMode('ADD');
        this.overlayGlow = glow;
        this.activeGraphics.push(glow);

        // Fade in the overlay
        const tween = this.scene.tweens.add({
            targets: overlay,
            alpha: 0.5,
            duration: 1000,
            ease: 'Sine.easeInOut',
            onComplete: () => {
                console.log('[TranceStateEffects] Overlay fade complete, alpha:', overlay.alpha);
            },
        });

        this.activeTweens.push(tween);

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
     * Create concentric aura graphics that pulsate around the board
     * @private
     */
    createRadiantAura() {
        if (!this.scene?.add?.graphics) return;

        const aura = this.scene.add.graphics();
        aura.setScrollFactor(1, 1);
        aura.setDepth(1004);
        aura.setAlpha(0);

        this.auraGraphics = aura;
        this.activeGraphics.push(aura);
        this.updateViewportAnchoredElements();

        const tween = this.scene.tweens.add({
            targets: aura,
            alpha: 0.55,
            duration: 1200,
            ease: 'Sine.easeInOut',
        });

        this.activeTweens.push(tween);
    }

    /**
     * Create floating particle emitters throughout the board
     * @private
     */
    createFloatingParticles() {
        const particleKey = this.resolveParticleTextureKey();
        if (!particleKey) return;

        const boardWidth = this.getBoardWidth();
        const boardHeight = this.getBoardHeight();
        const PhaserRef = window.Phaser;

        console.log('[TranceStateEffects] Board dimensions:', { boardWidth, boardHeight });

        if (!PhaserRef?.Geom?.Rectangle) {
            console.warn('[TranceStateEffects] Phaser.Geom.Rectangle not available');
            return;
        }

        // Get camera position
        const camera = this.scene.cameras?.main;
        const cameraY = camera ? camera.scrollY : 0;

        // Create 3 emitters for layered depth effect
        for (let layer = 0; layer < 3; layer++) {
            const emitter = createParticleEmitter(
                this.scene,
                boardWidth / 2,
                cameraY + boardHeight, // Position at camera viewport
                particleKey,
                {
                    x: { min: 0, max: boardWidth },
                    y: cameraY + boardHeight + 20,
                    speed: { min: 15 + layer * 5, max: 30 + layer * 10 },
                    angle: { min: -100, max: -80 },
                    lifespan: { min: 5000, max: 8000 },
                    frequency: 80 - layer * 15, // More frequent particles in front layers
                    alpha: { start: 0.5 - layer * 0.1, end: 0 },
                    scale: { start: 0.3 + layer * 0.2, end: 0.1 },
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
                    emitter.setScrollFactor(1, 1); // Follow camera!
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

        const viewport = this.getCameraViewport();
        const boardWidth = this.getBoardWidth();
        const boardHeight = this.getBoardHeight();
        const centerX = viewport ? viewport.centerX : boardWidth / 2;
        const centerY = viewport ? viewport.centerY : boardHeight / 2;

        const PhaserRef = window.Phaser;
        let emitZone = null;

        if (PhaserRef?.Geom?.Rectangle) {
            emitZone = new PhaserRef.Geom.Rectangle(
                centerX - viewport.width * 0.45,
                centerY - viewport.height * 0.35,
                viewport.width * 0.9,
                viewport.height * 0.7,
            );
        }

        const emitter = createParticleEmitter(
            this.scene,
            centerX,
            centerY,
            particleKey,
            {
                lifespan: { min: 2200, max: 3600 },
                speed: { min: 15, max: 45 },
                gravityY: -5,
                scale: { start: 0.7, end: 0 },
                alpha: { start: 0.95, end: 0 },
                blendMode: 'ADD',
                tint: 0xffd966,
                frequency: 110,
                quantity: 2,
                angle: { min: 200, max: 340 },
                rotate: { min: -30, max: 30 },
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
            emitter.setScrollFactor(1, 1);
        }
        if (emitter.start) {
            emitter.start();
        }

        this.activeEmitters.push({ emitter, type: 'golden', zone: emitZone });
        console.log('[TranceStateEffects] Golden sparkle emitter created');
        this.updateViewportAnchoredElements();
    }

    /**
     * Create flowing color waves across the board
     * @private
     */
    createColorWaves() {
        const boardWidth = this.getBoardWidth();
        const boardHeight = this.getBoardHeight();

        console.log('[TranceStateEffects] Creating color waves with dimensions:', { boardWidth, boardHeight });

        // Create multiple wave graphics for layering
        for (let i = 0; i < 2; i++) {
            const waveGraphics = this.scene.add.graphics();
            waveGraphics.setScrollFactor(1, 1); // Follow camera!
            waveGraphics.setDepth(1005 + i); // Higher depth
            waveGraphics.setAlpha(0);

            // Store wave parameters
            waveGraphics.setData('waveIndex', i);
            waveGraphics.setData('waveSpeed', 0.0003 + i * 0.0002);
            waveGraphics.setData('waveOffset', i * Math.PI);

            this.activeGraphics.push(waveGraphics);
            console.log('[TranceStateEffects] Wave graphics', i, 'created at depth', 1005 + i);

            // Fade in
            const tween = this.scene.tweens.add({
                targets: waveGraphics,
                alpha: 0.35, // More visible for testing
                duration: 1500,
                ease: 'Sine.easeInOut',
            });

            this.activeTweens.push(tween);
        }

        console.log('[TranceStateEffects] Color waves setup complete');
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

        // Update color waves
        this.updateColorWaves();

        // Update particle colors
        this.updateParticleColors();
    }

    /**
     * Update flowing color wave animations
     * @private
     */
    updateColorWaves() {
        const boardWidth = this.getBoardWidth();
        const boardHeight = this.getBoardHeight();

        // Get camera position for positioning waves in viewport
        const camera = this.scene.cameras?.main;
        const cameraY = camera ? camera.scrollY : 0;

        this.activeGraphics.forEach((graphics) => {
            if (!graphics.getData || !graphics.getData('waveSpeed')) return;

            const waveSpeed = graphics.getData('waveSpeed');
            const waveOffset = graphics.getData('waveOffset');

            graphics.clear();

            // Draw flowing wave pattern at camera position
            const waveCount = 5;
            const waveHeight = boardHeight / waveCount;

            for (let i = 0; i < waveCount; i++) {
                const progress = (i / waveCount + this.time * waveSpeed + waveOffset) % 1;
                const colorIndex = Math.floor(progress * this.tranceColors.length);
                const color = this.tranceColors[colorIndex % this.tranceColors.length];

                // Create sine wave effect
                const amplitude = 20;
                const frequency = 0.02;

                graphics.fillStyle(color, 0.22); // More visible
                graphics.beginPath();
                graphics.moveTo(0, cameraY + i * waveHeight);

                for (let x = 0; x <= boardWidth; x += 5) {
                    const y = cameraY + i * waveHeight
                             + Math.sin(x * frequency + this.time * waveSpeed * 10) * amplitude
                             + Math.sin(this.time * waveSpeed * 5) * amplitude * 0.5;
                    graphics.lineTo(x, y);
                }

                graphics.lineTo(boardWidth, cameraY + (i + 1) * waveHeight);
                graphics.lineTo(0, cameraY + (i + 1) * waveHeight);
                graphics.closePath();
                graphics.fillPath();
            }
        });
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
     * @private
     */
    updateViewportAnchoredElements() {
        if (!this.scene || !this.isActive) return;

        const viewport = this.getCameraViewport();
        if (!viewport) return;

        if (this.overlayRect) {
            this.overlayRect.x = viewport.centerX;
            this.overlayRect.y = viewport.centerY;

            if (this.overlayRect.width !== viewport.width || this.overlayRect.height !== viewport.height) {
                if (this.overlayRect.setSize) {
                    this.overlayRect.setSize(viewport.width, viewport.height);
                } else {
                    this.overlayRect.width = viewport.width;
                    this.overlayRect.height = viewport.height;
                }

                if (this.overlayRect.setDisplaySize) {
                    this.overlayRect.setDisplaySize(viewport.width, viewport.height);
                }
            }
        }

        if (this.pausedText) {
            this.pausedText.x = viewport.centerX;
            this.pausedText.y = viewport.y + viewport.height * 0.35;
        }

        if (this.subtitleText) {
            this.subtitleText.x = viewport.centerX;
            this.subtitleText.y = viewport.y + viewport.height * 0.42;
        }

        if (this.overlayGlow) {
            const glowWidth = viewport.width * 0.85;
            const glowHeight = viewport.height * 0.85;
            this.overlayGlow.x = viewport.centerX;
            this.overlayGlow.y = viewport.centerY;
            if (this.overlayGlow.setSize) {
                this.overlayGlow.setSize(glowWidth, glowHeight);
            }
            this.overlayGlow.width = glowWidth;
            this.overlayGlow.height = glowHeight;
            if (this.overlayGlow.setDisplaySize) {
                this.overlayGlow.setDisplaySize(glowWidth, glowHeight);
            }
        }

        this.renderAuraGraphics(viewport);

        if (this.activeEmitters.length > 0) {
            let floatingIndex = 0;
            this.activeEmitters.forEach((entry) => {
                const emitter = entry?.emitter;
                if (!emitter) {
                    return;
                }

                if (entry.type === 'golden') {
                    if (entry.zone && entry.zone.setTo) {
                        entry.zone.setTo(
                            viewport.centerX - viewport.width * 0.45,
                            viewport.centerY - viewport.height * 0.35,
                            viewport.width * 0.9,
                            viewport.height * 0.7,
                        );
                        if (emitter.emitZone) {
                            emitter.emitZone.source = entry.zone;
                        }
                    } else {
                        // Fallback: keep emitter roughly centered but sway for movement
                        const sway = Math.sin((this.time + (entry.layer || 0) * 90) * 0.0015) * 18;
                        const focusY = viewport.centerY - viewport.height * 0.15 + sway;
                        if (emitter.setPosition) {
                            emitter.setPosition(viewport.centerX, focusY);
                        } else {
                            emitter.x = viewport.centerX;
                            emitter.y = focusY;
                        }
                    }
                    return;
                }

                const emitterY = viewport.y + viewport.height + 20 + floatingIndex * 12;
                floatingIndex += 1;
                if (emitter.setPosition) {
                    emitter.setPosition(viewport.centerX, emitterY);
                } else {
                    emitter.x = viewport.centerX;
                    emitter.y = emitterY;
                }
            });
        }
    }

    /**
     * Draw concentric aura rings anchored to the viewport center
     * @param {Object} viewport
     * @private
     */
    renderAuraGraphics(viewport) {
        if (!this.auraGraphics) return;

        const maxDim = Math.max(viewport.width, viewport.height);
        const baseRadius = maxDim * 0.35;
        const shimmer = Math.sin(this.time * 0.0012) * maxDim * 0.025;

        this.auraGraphics.clear();
        const colors = [0xfff6d6, 0xffe098, 0xffc45c];

        colors.forEach((color, index) => {
            const radius = baseRadius + index * maxDim * 0.09 + shimmer * (index + 1);
            const alpha = Math.max(0.18 - index * 0.05, 0.06);
            this.auraGraphics.lineStyle(2 + index, color, alpha);
            this.auraGraphics.strokeCircle(viewport.centerX, viewport.centerY, radius);
        });

        this.auraGraphics.fillStyle(0xfff2c7, 0.08);
        this.auraGraphics.fillCircle(viewport.centerX, viewport.centerY, baseRadius * 0.9 + shimmer * 0.3);
    }

    /**
     * Get the current camera viewport dimensions in world coordinates
     * @returns {{x:number,y:number,width:number,height:number,centerX:number,centerY:number}|null}
     * @private
     */
    getCameraViewport() {
        const camera = this.scene?.cameras?.main;
        if (!camera) return null;

        const worldView = camera.worldView;
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
    fadeOutAndCleanup() {
        console.log('[TranceStateEffects] Fading out and cleaning up...');

        // Fade out all graphics
        this.activeGraphics.forEach((graphics) => {
            if (graphics && graphics.scene) {
                this.scene.tweens.add({
                    targets: graphics,
                    alpha: 0,
                    duration: 800,
                    ease: 'Sine.easeOut',
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

            this.scene.time.delayedCall(800, () => {
                destroyParticleEmitter(emitter);
            });
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
        this.auraGraphics = null;

        console.log('[TranceStateEffects] Cleanup complete');
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
        pausedText.setScrollFactor(1, 1);
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
        subtitleText.setScrollFactor(1, 1);
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
        this.stop();
        this.scene = null;
    }
}
