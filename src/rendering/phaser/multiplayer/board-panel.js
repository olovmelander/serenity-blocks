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
        init(data = {}) {
            this.playerId = data.playerId ?? 1;
            this.viewport = data.viewport;
            this.label = data.playerLabel ?? `PLAYER ${this.playerId}`;
            this.getPendingGarbage = data.getPendingGarbage;
        }

        create() {
            super.create();
            this.attachGraphicsLayerAliases();
            this.applyViewport();
            this.createHud();
        }

        applyViewport() {
            const camera = this.cameras.main;
            if (this.viewport) {
                camera.setViewport(
                    this.viewport.x,
                    this.viewport.y,
                    this.viewport.width,
                    this.viewport.height,
                );
            }
            camera.setOrigin(0, 0);
            this.configureCamera();
        }

        createHud() {
            const margin = 8;
            this.labelText = this.add
                .text(margin, margin, this.label, HUD_LABEL_STYLE)
                .setDepth(90);
            this.scoreText = this.add
                .text(margin, this.labelText.y + this.labelText.height + 2, '0', HUD_VALUE_STYLE)
                .setDepth(90);
            this.linesText = this.add
                .text(
                    margin,
                    this.scoreText.y + this.scoreText.height + 2,
                    'LINES 0',
                    HUD_SECONDARY_STYLE,
                )
                .setDepth(90);
            this.garbageText = this.add
                .text(
                    margin,
                    this.linesText.y + this.linesText.height + 2,
                    'GARBAGE 0',
                    HUD_SECONDARY_STYLE,
                )
                .setDepth(90);
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
        }

        playLineClearImpact(lineCount = 1) {
            const clamped = Math.max(1, Math.min(4, lineCount));
            const qualityMultiplier = this.getQualityConfig()?.shakeMultiplier ?? 1;
            const duration = 150 + (clamped - 1) * 40;
            this.shakeCamera(clamped * qualityMultiplier, duration);
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
                        centerY
                            += (piece.y + y - this.hiddenRows) * this.blockSize + this.blockSize / 2;
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
