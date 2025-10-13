import { createBaseBoardScene } from '../base-board-scene.js';

const HUD_LABEL_STYLE = {
    fontFamily: 'Orbitron',
    fontSize: '14px',
    color: '#00ffff',
};

const HUD_VALUE_STYLE = {
    fontFamily: 'Space Mono',
    fontSize: '16px',
    color: '#ffffff',
};

const HUD_SECONDARY_STYLE = {
    fontFamily: 'Space Mono',
    fontSize: '12px',
    color: '#a5b4fc',
};

/**
 * Create the multiplayer board scene once Phaser is ready.
 * @param {typeof Phaser} phaserLib
 */
export function createMultiplayerBoardScene(
    phaserLib = typeof window !== 'undefined' ? window.Phaser : null,
) {
    const BaseBoardScene = createBaseBoardScene(phaserLib);

    return class MultiplayerBoardScene extends BaseBoardScene {
        constructor(key) {
            super(key || 'MultiplayerBoardScene');
            console.log(`[MultiplayerBoardScene] Constructor called with key: ${key}`);
            
            // Particle systems for effects
            this.activeParticleSystems = new Set();
            this.lastImpactIntensity = 0;
            this.currentComboCount = 0; // Track current combo for enhanced effects
        }

        init(data = {}) {
            console.log(`[MultiplayerBoardScene] init() called for ${this.scene.key}`, data);
            this.playerId = data.playerId ?? 1;
            this.viewport = data.viewport;
            this.label = data.playerLabel ?? `PLAYER ${this.playerId}`;
            this.getPendingGarbage = data.getPendingGarbage;
        }

        preload() {
            console.log(`[MultiplayerBoardScene] preload() called for ${this.scene.key}`);
            super.preload();
        }

        create() {
            console.log(`[MultiplayerBoardScene] create() called for ${this.scene.key}`);
            super.create();
            this.attachGraphicsLayerAliases();
            this.applyViewport();
            this.createHud();
            console.log(`[MultiplayerBoardScene] create() complete for ${this.scene.key}`);
        }

        applyViewport() {
            const camera = this.cameras.main;
            console.log(`[MultiplayerBoardScene] applyViewport for ${this.scene.key}`, this.viewport);
            
            if (this.viewport) {
                console.log(`[MultiplayerBoardScene] Setting viewport:`, 
                    this.viewport.x, this.viewport.y, this.viewport.width, this.viewport.height);
                
                // Set the viewport (where on the canvas this camera renders)
                camera.setViewport(
                    this.viewport.x,
                    this.viewport.y,
                    this.viewport.width,
                    this.viewport.height,
                );
                
                // Each scene has its own independent world space starting at (0, 0)
                // The viewport determines WHERE on the canvas the scene renders
                const { width, height } = this.getBoardDimensions();
                
                // Set camera bounds to the full board size (including hidden rows)
                camera.setBounds(0, 0, width, height);
                
                // Position camera to show only the visible area (hide the top hidden rows)
                const { hiddenRows, blockSize } = this.boardConfig;
                const visibleHeight = height - (hiddenRows * blockSize);
                
                // Center the camera on the visible portion
                camera.centerOn(width / 2, visibleHeight / 2 + (hiddenRows * blockSize));
                
                console.log(`[MultiplayerBoardScene] Camera configured:`, 
                    'bounds:', 0, 0, width, height, 
                    'centerOn:', width / 2, visibleHeight / 2 + (hiddenRows * blockSize));
            } else {
                console.error(`[MultiplayerBoardScene] No viewport data for ${this.scene.key}!`);
            }
        }

        createHud() {
            // HUD is now handled by DOM elements in the sidebar
            // No need to render text inside the Phaser scene
            this.labelText = null;
            this.scoreText = null;
            this.linesText = null;
            this.garbageText = null;
        }

        updateHud(state) {
            if (!state) return;
            if (this.scoreText) this.scoreText.setText(state.score.toLocaleString());
            if (this.linesText) this.linesText.setText(`LINES ${state.lines}`);
            if (this.garbageText) {
                const pending = typeof state.pendingGarbage === 'number' ? state.pendingGarbage : 0;
                this.garbageText.setText(`GARBAGE ${pending}`);
            }
        }

        updateStats(stats) {
            super.updateStats?.(stats);
            this.updateHud(stats);
        }

        syncFromGameState(gameState) {
            super.syncFromGameState(gameState);
            this.updateHud({
                score: gameState?.score ?? 0,
                lines: gameState?.lines ?? 0,
                pendingGarbage: this.getPendingGarbage ? this.getPendingGarbage(gameState) : 0,
            });
        }

        triggerLineClearFlash(clearedRows) {
            if (!clearedRows || clearedRows.length === 0) return;

            const flash = this.effectsGraphics;
            clearedRows.forEach((row) => {
                const y = (row - this.hiddenRows) * this.blockSize;
                flash.fillStyle(0xffffff, 0.6);
                flash.fillRect(0, y, this.cols * this.blockSize, this.blockSize);
            });

            this.time.delayedCall(100, () => {
                this.effectsGraphics.clear();
            });
            
            // Create particle effects for cleared lines
            this.createLineClearParticles(clearedRows);
        }

        playLineClearImpact(lineCount = 1) {
            const clamped = Math.max(1, Math.min(4, lineCount));
            const qualityMultiplier = this.getQualityConfig()?.shakeMultiplier ?? 1;
            const duration = 150 + (clamped - 1) * 40;
            this.shakeCamera(clamped * qualityMultiplier, duration);
            
            // Track intensity for particle burst
            this.lastImpactIntensity = clamped;
        }
        
        createLineClearParticles(clearedRows) {
            if (!clearedRows || clearedRows.length === 0) return;
            
            // Check if particles are enabled in quality settings
            if (!this.getQualityConfig()?.particles) return;
            
            const intensity = Math.max(1, this.lastImpactIntensity || clearedRows.length);
            // Apply combo multiplier to make effects more dramatic
            const comboMultiplier = this.currentComboCount > 0 ? (1 + (this.currentComboCount * 0.5)) : 1;
            const totalIntensity = intensity * comboMultiplier;
            
            const boardWidth = this.cols * this.blockSize;
            const Phaser = window.Phaser;
            
            clearedRows.forEach((row, index) => {
                const zoneY = (row - this.hiddenRows) * this.blockSize;
                
                // Create particle emitter for this row
                const emitter = this.add.particles(0, zoneY, this.commonParticleKey, {
                    emitZone: {
                        type: 'random',
                        source: new Phaser.Geom.Rectangle(0, 0, boardWidth, this.blockSize),
                    },
                    speed: { min: 90 * comboMultiplier, max: 220 * totalIntensity },
                    angle: { min: -110, max: -70 },
                    lifespan: { min: 600, max: 1000 * Math.min(comboMultiplier, 2) },
                    quantity: 0, // Required for explode
                    alpha: { start: 0.9, end: 0 },
                    scale: { start: 0.85 * Math.min(comboMultiplier, 1.5), end: 0 },
                    gravityY: 400,
                    blendMode: 'ADD',
                    tint: this.getComboTint(this.currentComboCount, index),
                });
                
                emitter.setDepth(5);
                
                // More particles for bigger combos
                const burstAmount = Math.round(18 * totalIntensity);
                emitter.explode(burstAmount);
                
                // Clean up after animation
                this.time.delayedCall(1200, () => {
                    if (emitter) {
                        emitter.destroy();
                        this.activeParticleSystems.delete(emitter);
                    }
                });
                
                this.activeParticleSystems.add(emitter);
            });
            
            this.lastImpactIntensity = 0;
        }

        createPieceLockRipple(piece) {
            if (!piece) return;

            let centerX = 0;
            let centerY = 0;
            let blockCount = 0;

            piece.shape.forEach((row, y) => {
                row.forEach((cell, x) => {
                    if (cell > 0) {
                        centerX += (piece.x + x) * this.blockSize + this.blockSize / 2;
                        // Use world coordinates (same as blocks are drawn)
                        centerY += (piece.y + y) * this.blockSize + this.blockSize / 2;
                        blockCount++;
                    }
                });
            });

            if (blockCount === 0) return;

            centerX /= blockCount;
            centerY /= blockCount;

            const ripple = this.add.graphics();
            const colorInt = parseInt(piece.color.replace('#', ''), 16);
            const rippleData = { radius: 0, alpha: 0.6 };

            this.tweens.add({
                targets: rippleData,
                radius: this.blockSize * 3,
                alpha: 0,
                duration: 350,
                ease: 'Cubic.easeOut',
                onUpdate: () => {
                    ripple.clear();
                    ripple.lineStyle(3, colorInt, rippleData.alpha);
                    ripple.strokeCircle(centerX, centerY, rippleData.radius);
                },
                onComplete: () => {
                    ripple.destroy();
                },
            });
        }

        showComboPopup(comboCount) {
            // Store combo count for enhanced particle effects
            this.currentComboCount = comboCount;
            
            const text = this.add.text(
                (this.cols * this.blockSize) / 2,
                (this.rows * this.blockSize) / 2,
                `${comboCount}x COMBO!`,
                {
                    fontSize: '28px',
                    fontFamily: 'Orbitron',
                    color: '#fff',
                    stroke: '#000',
                    strokeThickness: 4,
                },
            );

            text.setOrigin(0.5);

            this.tweens.add({
                targets: text,
                y: text.y - 40,
                alpha: { from: 1, to: 0 },
                scale: { from: 0.8, to: 1.1 },
                duration: 700,
                ease: 'Cubic.easeOut',
                onComplete: () => text.destroy(),
            });
            
            // Trigger background explosion particles for combos
            if (comboCount >= 2) {
                this.spawnComboExplosionParticles(comboCount);
            }
        }

        /**
         * Get particle tint color based on combo count
         * @param {number} comboCount - Current combo count
         * @param {number} index - Row index for variation
         * @returns {number} Hex color value
         */
        getComboTint(comboCount, index = 0) {
            if (comboCount === 0) {
                return 0x00ffff; // Default cyan
            } else if (comboCount === 2) {
                return 0x00ff88; // Green-cyan
            } else if (comboCount === 3) {
                return 0xffaa00; // Orange
            } else if (comboCount === 4) {
                return 0xff00ff; // Magenta
            } else if (comboCount >= 5) {
                // Rainbow effect for high combos
                const colors = [0xff0000, 0xff8800, 0xffff00, 0x00ff00, 0x00ffff, 0x0088ff, 0xff00ff];
                return colors[index % colors.length];
            }
            return 0x00ffff;
        }

        /**
         * Spawn background explosion particles for combo effects
         * @param {number} comboCount - Current combo count
         */
        spawnComboExplosionParticles(comboCount) {
            if (!this.commonParticleKey) return;
            if (!this.getQualityConfig()?.particles) return;

            const boardWidth = this.cols * this.blockSize;
            const boardHeight = this.rows * this.blockSize;
            const centerX = boardWidth / 2;
            const centerY = boardHeight / 2;

            // Scale effect intensity with combo count
            const explosionIntensity = Math.min(comboCount, 8);
            const particleCount = Math.round(30 * explosionIntensity); // Slightly less for multiplayer
            const explosionSpeed = 150 + (comboCount * 30);

            // Create multiple explosion bursts for higher combos
            const burstCount = Math.min(Math.floor(comboCount / 2), 4); // Slightly less for multiplayer
            
            for (let burst = 0; burst < burstCount; burst++) {
                // Delay each burst slightly for cascade effect
                this.time.delayedCall(burst * 100, () => {
                    // Random position near center for variety
                    const offsetX = (Math.random() - 0.5) * boardWidth * 0.3;
                    const offsetY = (Math.random() - 0.5) * boardHeight * 0.3;
                    
                    const emitter = this.add.particles(
                        centerX + offsetX,
                        centerY + offsetY,
                        this.commonParticleKey,
                        {
                            speed: { min: explosionSpeed * 0.5, max: explosionSpeed },
                            angle: { min: 0, max: 360 }, // Full 360-degree explosion
                            lifespan: { min: 600, max: 1000 },
                            quantity: 0,
                            alpha: { start: 0.95, end: 0 },
                            scale: { start: 1.2 * Math.min(explosionIntensity / 4, 2), end: 0.1 },
                            gravityY: 200,
                            blendMode: 'ADD',
                            on: false,
                            tint: this.getComboTint(comboCount, burst),
                        }
                    );

                    emitter.setDepth(4); // Behind line clear particles but above board

                    // Explode with scaled particle count
                    emitter.explode(Math.round(particleCount / burstCount));

                    this.time.delayedCall(1200, () => {
                        if (emitter) {
                            emitter.destroy();
                            this.activeParticleSystems.delete(emitter);
                        }
                    });

                    this.activeParticleSystems.add(emitter);
                });
            }

            // Add extra radial burst for very high combos (5+)
            if (comboCount >= 5) {
                this.time.delayedCall(150, () => {
                    this.spawnRadialWave(comboCount);
                });
            }
        }

        /**
         * Spawn a radial wave effect for extreme combos
         * @param {number} comboCount - Current combo count
         */
        spawnRadialWave(comboCount) {
            if (!this.commonParticleKey) return;
            if (!this.getQualityConfig()?.particles) return;

            const boardWidth = this.cols * this.blockSize;
            const boardHeight = this.rows * this.blockSize;
            const centerX = boardWidth / 2;
            const centerY = boardHeight / 2;

            const ringParticleCount = Math.round(50 + (comboCount * 8)); // Slightly less for multiplayer
            const waveSpeed = 200 + (comboCount * 20);

            // Create expanding ring of particles
            for (let i = 0; i < ringParticleCount; i++) {
                const angle = (i / ringParticleCount) * Math.PI * 2;
                const dirX = Math.cos(angle);
                const dirY = Math.sin(angle);

                const emitter = this.add.particles(centerX, centerY, this.commonParticleKey, {
                    speedX: dirX * waveSpeed,
                    speedY: dirY * waveSpeed,
                    lifespan: { min: 500, max: 800 },
                    quantity: 1,
                    alpha: { start: 1, end: 0 },
                    scale: { start: 1.5, end: 0.3 },
                    gravityY: 0, // No gravity for clean ring expansion
                    blendMode: 'ADD',
                    on: false,
                    tint: this.getComboTint(comboCount, i),
                });

                emitter.setDepth(3);
                emitter.explode(1);

                this.time.delayedCall(900, () => {
                    if (emitter) {
                        emitter.destroy();
                        this.activeParticleSystems.delete(emitter);
                    }
                });

                this.activeParticleSystems.add(emitter);
            }
        }

        shutdown() {
            super.shutdown();
            this.labelText?.destroy();
            this.scoreText?.destroy();
            this.linesText?.destroy();
            this.garbageText?.destroy();
        }
    };
}
