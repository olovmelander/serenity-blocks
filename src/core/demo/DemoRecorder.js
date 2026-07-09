/**
 * @fileoverview Demo Recorder for Serenity Blocks
 * Captures accepted gameplay commands on the authoritative simulation frame.
 */

import { captureGameStateSnapshot, isStableDemoCheckpointState } from './demo-state.js';

export const DEMO_VERSION = '2.0';
export const DEMO_TICK_MS = 1000 / 60;
export const DEMO_CHECKPOINT_INTERVAL_FRAMES = 300;

function resolveFrame(gameState, tickMs = DEMO_TICK_MS) {
    if (Number.isFinite(gameState?.simFrame)) return Math.max(0, gameState.simFrame);
    if (Number.isFinite(gameState?.simTimeMs)) {
        return Math.max(0, Math.round(gameState.simTimeMs / tickMs));
    }
    return 0;
}

function normalizeCommand(command, data = null) {
    if (typeof command === 'string') {
        return { action: command, data, queued: false };
    }

    return {
        action: command?.a || command?.action || command?.type,
        data: command?.d ?? command?.data ?? command?.value ?? null,
        queued: Boolean(command?.q || command?.queued || command?.buffered),
    };
}

export class DemoRecorder {
    constructor() {
        this.isRecording = false;
        this.demo = null;
        this.startTime = 0;
        this.tickMs = DEMO_TICK_MS;
        this.lastCheckpointFrame = 0;
    }

    /**
     * Start recording a new demo.
     * @param {Object} gameState - Initial game state
     * @param {Object} settings - Game settings
     * @param {number} seed - RNG seed
     * @param {string} gameMode - Game mode identifier
     */
    startRecording(gameState, settings, seed, gameMode = 'single-player') {
        this.tickMs = Number(gameState?.simTickMs) || DEMO_TICK_MS;
        const simFrame = resolveFrame(gameState, this.tickMs);

        this.demo = {
            version: DEMO_VERSION,
            gameMode,
            timestamp: Date.now(),
            sim: {
                tickMs: this.tickMs,
                startFrame: simFrame,
                durationFrames: 0,
            },
            initialState: {
                seed,
                level: gameState.level,
                dropInterval: gameState.dropInterval,
                settings: this._captureSettings(settings),
                rulesVersion: DEMO_VERSION,
            },
            inputs: [],
            checkpoints: [],
            metadata: {},
        };

        this.isRecording = true;
        this.startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.lastCheckpointFrame = simFrame;
        this.recordCheckpoint(gameState, true);
        console.log('[DemoRecorder] Started recording v2');
    }

    /**
     * Record an accepted gameplay command on the current simulation frame.
     * @param {Object|string} command - Command object or legacy action name
     * @param {Object} gameState - Current game state
     */
    recordCommand(command, gameState) {
        if (!this.isRecording || !this.demo) return;

        const { action, data, queued } = normalizeCommand(command);
        if (!action) return;

        const frame = resolveFrame(gameState, this.tickMs);
        const inputEvent = {
            f: frame,
            t: Math.round(frame * this.tickMs),
            a: action,
        };

        if (data !== null && data !== undefined) {
            inputEvent.d = data;
        }
        if (queued) {
            inputEvent.q = true;
        }

        this.demo.inputs.push(inputEvent);
        this.demo.sim.durationFrames = Math.max(this.demo.sim.durationFrames || 0, frame);
        this.recordCheckpoint(gameState);
    }

    /**
     * Legacy input API retained for older call sites.
     * @param {string} action - Action name
     * @param {any} data - Action data
     * @param {Object} gameState - Optional game state
     */
    recordInput(action, data = null, gameState = null) {
        if (!gameState) {
            if (!this.isRecording || !this.demo) return;
            const timestamp = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.startTime;
            const frame = Math.max(0, Math.round(timestamp / this.tickMs));
            const inputEvent = {
                f: frame,
                t: Math.round(frame * this.tickMs),
                a: action,
            };
            if (data !== null && data !== undefined) {
                inputEvent.d = data;
            }
            this.demo.inputs.push(inputEvent);
            this.demo.sim.durationFrames = Math.max(this.demo.sim.durationFrames || 0, frame);
            return;
        }

        this.recordCommand({ a: action, d: data }, gameState);
    }

    recordCheckpoint(gameState, force = false) {
        if (!this.isRecording || !this.demo || !gameState) return;
        if (!isStableDemoCheckpointState(gameState)) return;

        const frame = resolveFrame(gameState, this.tickMs);
        if (!force && frame - this.lastCheckpointFrame < DEMO_CHECKPOINT_INTERVAL_FRAMES) {
            return;
        }

        this.demo.checkpoints.push({
            f: frame,
            t: Math.round(frame * this.tickMs),
            inputIndex: this.demo.inputs.length,
            state: captureGameStateSnapshot(gameState),
        });
        this.lastCheckpointFrame = frame;
    }

    /**
     * Stop recording and finalize demo.
     * @param {Object} finalStats - Final game statistics
     * @returns {Object} The recorded demo object
     */
    stopRecording(finalStats = {}) {
        if (!this.isRecording || !this.demo) return null;

        this.isRecording = false;

        const durationFrames = Number.isFinite(finalStats.durationFrames)
            ? finalStats.durationFrames
            : Math.max(
                this.demo.sim.durationFrames || 0,
                Number.isFinite(finalStats.durationMs)
                    ? Math.round(finalStats.durationMs / this.tickMs)
                    : 0,
            );
        const duration = Number.isFinite(finalStats.durationMs)
            ? Math.round(finalStats.durationMs)
            : Math.round(durationFrames * this.tickMs);

        this.demo.sim.durationFrames = durationFrames;
        this.demo.metadata = {
            duration,
            durationFrames,
            finalScore: finalStats.score || 0,
            linesCleared: finalStats.lines || 0,
            level: finalStats.level || 1,
            inputCount: this.demo.inputs.length,
            seed: this.demo.initialState.seed,
            ...finalStats,
        };

        console.log(`[DemoRecorder] Stopped recording. Captured ${this.demo.inputs.length} commands.`);
        return this.demo;
    }

    /**
     * Get the current demo object.
     * @returns {Object} Demo object
     */
    getDemo() {
        return this.demo;
    }

    /**
     * Capture relevant settings for replay.
     * @private
     */
    _captureSettings(settings = {}) {
        // Input-timing settings live under dasDelay/dasInterval/softDropInterval
        // (ui/settings.js DEFAULT_CONFIG) — the old das/arr keys never existed and
        // always captured undefined. Schema is redefined properly in plan §5.7.
        return {
            themeBasedTetrominos: settings.themeBasedTetrominos,
            dasDelay: settings.dasDelay,
            dasInterval: settings.dasInterval,
            softDropInterval: settings.softDropInterval,
        };
    }
}
