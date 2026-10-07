import { COLS, ROWS, HIDDEN_ROWS } from '../../core/constants.js';
import { createBoardEffectHandlers } from '../../core/game-modes/board-effect-callbacks.js';
import { createMultiplayerBoardScene } from './multiplayer/board-panel.js';
import { applyPhaserFrameRate, phaserBoardRuntimeConfig } from './frame-rate-policy.js';

/** One render-only board observing the bot's live GameState. It never advances gameplay. */
export class OdysseyOpponentBoard {
    constructor({ deps = {}, isCurrent = () => true } = {}) {
        this.deps = deps;
        this.isCurrent = isCurrent;
        this.generation = 0;
        this.roundGeneration = 0;
        this.disposed = true;
        this.paused = false;
        this.game = null;
        this.scene = null;
        this.juice = null;
        this._settleBoot = null;
        this._settingsChanged = () => this._applySettings();
    }

    _owns(generation = this.generation, round = this.roundGeneration) {
        return !this.disposed && this.generation === generation
            && this.roundGeneration === round && this.isCurrent();
    }

    async prepare(parent, gameState) {
        this.dispose();
        if (!parent || !this.isCurrent()) return false;
        this.disposed = false;
        this.gameState = gameState;
        const { generation } = this;
        const [{ default: Phaser }, { BoardJuice }] = await Promise.all([
            import('phaser'), import('./board-juice.js'),
        ]).catch((error) => {
            if (this.generation === generation) this.dispose();
            throw error;
        });
        if (!this._owns(generation)) return false;
        const BoardScene = createMultiplayerBoardScene(Phaser);
        let finishBoot;
        let failBoot;
        const ready = new Promise((resolve, reject) => {
            finishBoot = resolve;
            failBoot = reject;
        });
        this._settleBoot = finishBoot;
        const boardScene = new BoardScene('OdysseyOpponentBoard', {
            cols: COLS, rows: ROWS, hiddenRows: HIDDEN_ROWS, blockSize: 40,
        });
        const initScene = boardScene.init.bind(boardScene);
        boardScene.init = (data = {}) => initScene({
            ...data,
            playerId: 2,
            viewport: {
                x: 0, y: 0, width: COLS * 40, height: ROWS * 40,
            },
        });
        const createScene = boardScene.create.bind(boardScene);
        boardScene.create = () => {
            if (!this._owns(generation)) {
                finishBoot(false);
                return;
            }
            try {
                createScene();
                this.scene = boardScene;
                boardScene.setWellStyle(true);
                boardScene.syncFromGameState(this.gameState);
                this._applySettings();
                finishBoot(true);
            } catch (error) {
                failBoot(error);
            }
        };
        try {
            this.game = new Phaser.Game({
                width: COLS * 40,
                height: ROWS * 40,
                parent,
                ...phaserBoardRuntimeConfig(this.deps, Phaser.WEBGL),
                transparent: true,
                banner: false,
                scale: {
                    mode: Phaser.Scale.FIT,
                    autoCenter: Phaser.Scale.CENTER_BOTH,
                    width: COLS * 40,
                    height: ROWS * 40,
                },
                scene: [boardScene],
            });
            this.game.events?.once?.('destroy', () => finishBoot(false));
            this.juice = new BoardJuice(parent.parentElement || parent);
            this._applySettings();
            globalThis.window?.addEventListener?.('settingsChanged', this._settingsChanged);
            const prepared = await ready;
            if (!prepared || !this._owns(generation)) {
                if (this.generation === generation) this.dispose();
                return false;
            }
            this._settleBoot = null;
            this._applyPauseState();
            return true;
        } catch (error) {
            if (this.generation === generation) this.dispose();
            throw error;
        }
    }

    _applySettings() {
        const settings = this.deps.settingsManager?.get?.() || {};
        if (this.gameState) {
            this.gameState.settings = { ...this.gameState.settings, reducedMotion: !!settings.reducedMotion };
        }
        this.scene?.setEffectQuality?.(settings.effectQuality || 'High');
        const reduced = settings.reducedMotion
            || globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (this.juice) {
            this.juice.disabled = this.paused || !!reduced;
            if (this.juice.disabled) this.juice.reset();
        }
        if (this.game && this.scene && settings.targetFrameRate !== undefined) {
            applyPhaserFrameRate(this.game, this.deps.frameRateController?.targetFPS ?? settings.targetFrameRate);
        }
    }

    update(gameState = this.gameState) {
        if (!this._owns()) return;
        this.gameState = gameState;
        this.scene?.syncFromGameState?.(gameState);
    }

    setPaused(paused) {
        if (!this._owns() || this.paused === Boolean(paused)) return;
        this.paused = Boolean(paused);
        this._applyPauseState();
        this._applySettings();
    }

    _applyPauseState() {
        // Sleeping before the scene exists prevents Phaser from ever reaching create().
        if (!this.scene || !this.game) return;
        this.scene?.setPresentationPaused?.(this.paused);
        if (this.paused) this.game?.loop?.sleep?.();
        else if (this.game.loop?.running === false) this.game.loop.wake?.();
    }

    resetRound(gameState = this.gameState) {
        if (!this._owns()) return;
        this.roundGeneration++;
        this.scene?.sharedEffects?.cleanup?.();
        this.scene?.sharedEffects?.clearKnockout?.();
        this.scene?.clearBoard?.();
        this.juice?.reset();
        this.update(gameState);
        this._applySettings();
    }

    /** Each round receives fresh visual callbacks; stale rounds cannot animate its replacement. */
    getVisualCallbacks() {
        const { generation } = this;
        const round = this.roundGeneration;
        const beats = createBoardEffectHandlers({
            getScene: () => this.scene,
            getJuice: () => this.juice,
        });
        const callbacks = {
            onMove: (direction) => {
                this.juice?.nudge(direction * 0.5);
            },
            onRotate: (direction) => {
                this.juice?.tilt(direction === 'left' ? -1.5 : 1.5);
                this.juice?.nudge(0, -0.5);
            },
            onHardDrop: (data) => {
                this.scene?.sharedEffects?.playHardDropEffect?.(data);
                this.juice?.dip(4);
                this.juice?.bounce();
            },
            onPieceLock: (piece) => beats.lockBeat(piece),
            triggerFlash: (rows) => beats.clearFlashBeat(rows),
            onLineClearImpact: (lines, depth) => beats.clearImpactBeat(lines, depth),
            triggerCombo: (depth) => beats.comboBeat(depth),
            triggerCascadeWave: (depth) => beats.cascadeWaveBeat(depth),
            onPerfectClear: (depth) => {
                this.scene?.sharedEffects?.playPerfectClear?.(depth);
                this.juice?.dip(2);
                this.juice?.bounce();
            },
            onTSpin: (lines) => this.scene?.sharedEffects?.playTSpinEffect?.(lines),
            onB2B: () => this.scene?.sharedEffects?.playB2BChange?.(true),
            onLevelUp: (level) => this.scene?.sharedEffects?.playLevelUp?.(level),
            onGarbageApplied: (lines) => this.scene?.sharedEffects?.playGarbageArrival?.(lines),
            onTopOut: () => this.scene?.sharedEffects?.playKnockout?.(),
            onDeath: () => this.scene?.sharedEffects?.playKnockout?.(),
            onRoundWin: (options) => this.scene?.sharedEffects?.playRoundWin?.(options),
            onVictory: (options) => this.scene?.sharedEffects?.playVictory?.(options),
        };
        return Object.fromEntries(Object.entries(callbacks).map(([name, callback]) => [
            name, (...args) => (this._owns(generation, round) ? callback(...args) : undefined),
        ]));
    }

    dispose() {
        this.generation++;
        this.roundGeneration++;
        this.disposed = true;
        this.paused = false;
        this._settleBoot?.(false);
        this._settleBoot = null;
        globalThis.window?.removeEventListener?.('settingsChanged', this._settingsChanged);
        this.juice?.destroy();
        this.juice = null;
        const { game } = this;
        this.game = null;
        this.scene = null;
        this.gameState = null;
        game?.destroy?.(true);
        // Phaser destroys on its next frame; a sleeping observer still needs that frame.
        if (game?.isRunning && game.loop?.running === false) game.loop.wake();
    }
}
