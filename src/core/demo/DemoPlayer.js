/**
 * @fileoverview Demo Player for Serenity Blocks
 * Replays demos with one authoritative simulation clock.
 */

import { seededRandom } from '../../utils/helpers.js';
import {
    updateGame, fillBag, move, rotate, softDrop, hardDrop,
} from '../game.js';
import { LEVEL_SPEEDS } from '../constants.js';
import {
    DEMO_CHECKPOINT_INTERVAL_FRAMES,
    DEMO_COMMAND_INPUT_FORMAT,
    DEMO_TICK_MS,
    LEGACY_DEMO_HIT_STOP_ENABLED,
} from './DemoRecorder.js';
import { clearPlayerInput } from '../player-input-state.js';
import {
    captureGameStateSnapshot,
    isStableDemoCheckpointSnapshot,
    isStableDemoCheckpointState,
    restoreGameStateSnapshot,
} from './demo-state.js';

const SPEED_CHOICES = [0.5, 1, 2, 4];
const DEMO_COMMAND_ACTIONS = new Set(['move', 'rotate', 'softDrop', 'hardDrop']);
const DEMO_ROTATION_DIRECTIONS = new Set(['left', 'right', 'flip']);

function isValidDemoCommand(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
    if (!DEMO_COMMAND_ACTIONS.has(input.a)) return false;

    const hasFrame = Object.prototype.hasOwnProperty.call(input, 'f');
    const hasTimestamp = Object.prototype.hasOwnProperty.call(input, 't');
    if (!hasFrame && !hasTimestamp) return false;
    if (hasFrame && (!Number.isFinite(input.f) || input.f < 0)) return false;
    if (hasTimestamp && (!Number.isFinite(input.t) || input.t < 0)) return false;
    if (input.q !== undefined && typeof input.q !== 'boolean') return false;

    if (input.a === 'move') return input.d === -1 || input.d === 1;
    if (input.a === 'rotate') return DEMO_ROTATION_DIRECTIONS.has(input.d);
    return input.d === undefined || input.d === null;
}

function nowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function nearestPlaybackSpeed(speed) {
    const numeric = Number(speed);
    if (!Number.isFinite(numeric)) return 1;
    const clamped = clamp(numeric, SPEED_CHOICES[0], SPEED_CHOICES[SPEED_CHOICES.length - 1]);
    return SPEED_CHOICES.reduce((best, choice) => (
        Math.abs(choice - clamped) < Math.abs(best - clamped) ? choice : best
    ), SPEED_CHOICES[0]);
}

function requestNextFrame(callback) {
    if (typeof requestAnimationFrame === 'function') {
        return requestAnimationFrame(callback);
    }
    return setTimeout(() => callback(nowMs()), 16);
}

function cancelNextFrame(id) {
    if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(id);
    } else {
        clearTimeout(id);
    }
}

export class DemoPlayer {
    constructor(dependencies) {
        this.deps = dependencies;
        this.demo = null;
        this.isPlaying = false;
        this.isPaused = false;
        this.isSeeking = false;
        this.playbackSpeed = 1.0;
        this.currentInputIndex = 0;
        this.playheadMs = 0;
        this.lastWallTime = 0;
        this.lastSimulatedTime = 0;
        this.gameState = null;
        this.animationId = null;
        this.onPlaybackEnd = null;
        this.callbacks = null;
        this.tickMs = DEMO_TICK_MS;
        this.checkpoints = [];
        this.lastCheckpointFrame = 0;
        this.seekToken = 0;
    }

    /**
     * Load a demo for playback.
     * @param {Object} demoData - The demo JSON object
     * @returns {boolean} True if loaded successfully
     */
    loadDemo(demoData) {
        if (this.isPlaying) this.stopPlayback({ notify: false });
        this.demo = null;
        this.currentInputIndex = 0;
        this.playheadMs = 0;
        this.lastSimulatedTime = 0;
        this.checkpoints = [];
        this.lastCheckpointFrame = 0;
        this.tickMs = DEMO_TICK_MS;

        if (!demoData || !Array.isArray(demoData.inputs)) {
            console.error('[DemoPlayer] Invalid demo data');
            return false;
        }
        const version = String(demoData.version ?? '1.0');
        const knownLegacyVersion = version === '1.0' || version === '2.0';
        if (!knownLegacyVersion) {
            console.error(`[DemoPlayer] Unsupported demo rules version: ${version}`);
            return false;
        }
        if (
            !demoData.initialState
            || typeof demoData.initialState !== 'object'
            || !Number.isFinite(demoData.initialState.seed)
        ) {
            console.error('[DemoPlayer] Demo is missing a finite initial seed');
            return false;
        }
        const declaredTickMs = demoData.sim?.tickMs;
        if (
            (version === '2.0' && declaredTickMs === undefined)
            || (declaredTickMs !== undefined && (
                !Number.isFinite(declaredTickMs)
                || Math.abs(declaredTickMs - DEMO_TICK_MS) > 0.0001
            ))
        ) {
            console.error(`[DemoPlayer] Unsupported simulation tick: ${declaredTickMs}`);
            return false;
        }
        const declaredInputFormat = demoData.sim?.inputFormat;
        const inputFormat = declaredInputFormat ?? DEMO_COMMAND_INPUT_FORMAT;
        if (inputFormat !== DEMO_COMMAND_INPUT_FORMAT) {
            console.error(`[DemoPlayer] Unsupported input format: ${inputFormat}`);
            return false;
        }
        if (!demoData.inputs.every(isValidDemoCommand)) {
            console.error('[DemoPlayer] Demo contains an invalid command entry');
            return false;
        }

        try {
            this.demo = this._normalizeDemo(demoData);
        } catch (error) {
            console.error('[DemoPlayer] Failed to normalize demo data:', error);
            this.demo = null;
            return false;
        }
        this.tickMs = this.demo.sim.tickMs;
        this.currentInputIndex = 0;
        this.playheadMs = 0;
        this.lastSimulatedTime = 0;
        this.checkpoints = [...(this.demo.checkpoints || [])];
        this.lastCheckpointFrame = 0;
        console.log('[DemoPlayer] Demo loaded:', this.demo.metadata);
        return true;
    }

    /**
     * Start playback.
     * @param {Object} callbacks - Game callbacks
     * @param {Object} gameState - Game state instance to use
     */
    startPlayback(callbacks, gameState) {
        if (!this.demo || !gameState) return;

        this._cancelScheduledFrame();

        this.gameState = gameState;
        this.callbacks = callbacks || {};
        this._mutedCallbacks = null;
        this.isPlaying = true;
        this.isPaused = false;
        this.isSeeking = false;
        this.playbackSpeed = 1.0;
        this.playheadMs = 0;
        this.lastWallTime = nowMs();
        this.currentInputIndex = 0;
        this.seekToken++;

        this._resetState();
        this._captureRuntimeCheckpoint(true);

        if (this.callbacks.updateStats) this.callbacks.updateStats();
        if (this.callbacks.onStart) this.callbacks.onStart();

        this._loop();
        console.log('[DemoPlayer] Playback started');
    }

    pausePlayback() {
        if (!this.isPlaying || this.isPaused) return;
        this._syncPlayhead();
        this.isPaused = true;
        if (this.gameState) this.gameState.isPaused = true;
    }

    resumePlayback() {
        if (!this.isPlaying || !this.isPaused) return;
        this.lastWallTime = nowMs();
        this.isPaused = false;
        if (this.gameState) this.gameState.isPaused = false;
    }

    /**
     * Set playback speed while preserving the current playhead.
     * @param {number} speed - Speed multiplier
     */
    setPlaybackSpeed(speed) {
        this._syncPlayhead();
        this.playbackSpeed = nearestPlaybackSpeed(speed);
        this.lastWallTime = nowMs();
        return this.playbackSpeed;
    }

    stopPlayback(options = {}) {
        const { notify = true } = options;
        this.isPlaying = false;
        this.isPaused = false;
        this.isSeeking = false;
        this.seekToken++;

        this._cancelScheduledFrame();

        if (this.gameState) {
            clearPlayerInput(this.gameState.playerInput);
            this.gameState.isReplay = false;
            this.gameState.isSeeking = false;
            this.gameState.suppressExternalInput = false;
            this.gameState.isPaused = false;
        }

        if (notify && this.onPlaybackEnd) {
            this.onPlaybackEnd();
        }
    }

    getCurrentTime() {
        this._syncPlayhead();
        return this.playheadMs || 0;
    }

    getDuration() {
        return this.demo?.metadata?.duration || 0;
    }

    async seek(targetTime) {
        if (!this.demo || !this.gameState) return;

        this._cancelScheduledFrame();
        const token = ++this.seekToken;
        const targetMs = clamp(Number(targetTime) || 0, 0, this.getDuration());
        const wasPaused = this.isPaused;

        this._syncPlayhead();
        this.isSeeking = true;
        this.gameState.isSeeking = true;
        this.gameState.isReplay = true;
        this.gameState.suppressExternalInput = true;
        this.gameState.isPaused = false;

        const checkpoint = this._findCheckpoint(targetMs);
        if (checkpoint) {
            restoreGameStateSnapshot(this.gameState, checkpoint.state, {
                seed: this.demo.initialState.seed,
                isReplay: true,
                isSeeking: true,
                suppressExternalInput: true,
                // V1/v2 demos store already-expanded accepted commands. Their
                // checkpoint input engine must stay dark or DAS repeats apply twice.
                restorePlayerInput: false,
            });
            this.currentInputIndex = checkpoint.inputIndex || 0;
            this.lastSimulatedTime = this._checkpointTime(checkpoint);
        } else {
            this._resetState();
        }

        await this._advanceTo(targetMs, { muted: true, seeking: true, token });
        if (token !== this.seekToken) return;

        this.playheadMs = targetMs;
        this.lastWallTime = nowMs();
        this.isSeeking = false;
        this.isPaused = wasPaused;
        this.gameState.isSeeking = false;
        this.gameState.isPaused = wasPaused;
        this.gameState.forceDraw = true;

        if (this.callbacks.updateStats) this.callbacks.updateStats();
        if (this.callbacks.drawCallback) this.callbacks.drawCallback();
        if (this.isPlaying && !this.isPaused) {
            this._scheduleLoop();
        }
    }

    async _loop() {
        if (!this.isPlaying) return;
        const token = this.seekToken;

        if (!this.isPaused) {
            this._syncPlayhead();
            const targetTime = clamp(this.playheadMs, 0, this.getDuration());
            const fastForward = this.playbackSpeed > 1.01;

            if (this.gameState) {
                this.gameState.isSeeking = fastForward;
            }

            await this._advanceTo(targetTime, {
                muted: fastForward,
                seeking: fastForward,
                token,
            });

            if (token !== this.seekToken || !this.isPlaying) return;

            if (this.gameState) {
                this.gameState.isSeeking = false;
            }

            if (this._hasReachedReplayEnd()) {
                this.playheadMs = Math.min(this.playheadMs, this.getDuration());
                this.stopPlayback();
                return;
            }
        }

        this._scheduleLoop();
    }

    _hasReachedReplayEnd() {
        const duration = this.getDuration();
        if (!Number.isFinite(duration) || duration <= 0) return false;
        return this.playheadMs >= duration - Math.max(1, this.tickMs);
    }

    _scheduleLoop() {
        if (!this.isPlaying || this.animationId) return;
        this.animationId = requestNextFrame(() => {
            this.animationId = null;
            this._loop();
        });
    }

    _cancelScheduledFrame() {
        if (!this.animationId) return;
        cancelNextFrame(this.animationId);
        this.animationId = null;
    }

    async _advanceTo(targetTime, options = {}) {
        const {
            muted = false,
            seeking = false,
            token = this.seekToken,
        } = options;
        const callbacks = muted || seeking ? this._getMutedCallbacks() : this.callbacks;
        const epsilon = 0.0001;

        while (this.isPlaying && token === this.seekToken && this.lastSimulatedTime + epsilon < targetTime) {
            if (this.gameState?.isGameOver) break;

            const nextInput = this.demo.inputs[this.currentInputIndex];
            const nextInputTime = nextInput ? nextInput.t : Infinity;

            if (nextInput && nextInputTime <= this.lastSimulatedTime + epsilon) {
                await this._applyInput(nextInput, callbacks, { muted: muted || seeking });
                this.currentInputIndex++;
                await this._waitForPhysics();
                this._captureRuntimeCheckpoint();
                continue;
            }

            const stepTime = Math.min(
                targetTime,
                nextInputTime,
                this.lastSimulatedTime + this.tickMs,
            );

            if (stepTime <= this.lastSimulatedTime + epsilon) {
                break;
            }

            this.gameState.isSeeking = seeking;
            updateGame(stepTime, this.gameState, callbacks);
            this.lastSimulatedTime = stepTime;
            await this._waitForPhysics();
            this._captureRuntimeCheckpoint();
        }

        while (
            this.isPlaying
            && token === this.seekToken
            && this.currentInputIndex < this.demo.inputs.length
            && this.demo.inputs[this.currentInputIndex].t <= targetTime + epsilon
        ) {
            const input = this.demo.inputs[this.currentInputIndex];
            if (input.t > this.lastSimulatedTime + epsilon) break;
            await this._applyInput(input, callbacks, { muted: muted || seeking });
            this.currentInputIndex++;
            await this._waitForPhysics();
            this._captureRuntimeCheckpoint();
        }
    }

    async _applyInput(input, callbacks, options = {}) {
        const action = input.a;
        const data = input.d;

        this._alignReplayClockForInput(input);

        if (typeof callbacks.applyCommand === 'function') {
            return callbacks.applyCommand(
                {
                    type: action,
                    value: data,
                    a: action,
                    d: data,
                },
                {
                    record: false,
                    muted: Boolean(options.muted),
                    callbacks,
                },
            );
        }

        const physicsCallbacks = callbacks.physicsCallbacks || {};
        const playDropCallback = callbacks.playDropCallback || (() => { });
        const playSoundCallback = callbacks.playSoundCallback || (() => { });
        const addTrailCallback = callbacks.addTrailCallback || (() => { });

        switch (action) {
        case 'move':
            return move(this.gameState, data, playSoundCallback, addTrailCallback);
        case 'rotate':
            return rotate(this.gameState, data, playSoundCallback, addTrailCallback);
        case 'softDrop':
            return softDrop(this.gameState, playDropCallback, physicsCallbacks);
        case 'hardDrop':
            return hardDrop(this.gameState, playDropCallback, physicsCallbacks);
        default:
            return false;
        }
    }

    _alignReplayClockForInput(input) {
        if (!this.gameState) return;

        const inputTime = Number.isFinite(input?.t) ? input.t : 0;
        const currentTime = Number.isFinite(this.gameState.simTimeMs)
            ? this.gameState.simTimeMs
            : 0;
        const alignedTime = Math.max(currentTime, inputTime);
        const tickMs = Number(this.gameState.simTickMs) || this.tickMs || DEMO_TICK_MS;
        const alignedFrame = Math.round(alignedTime / tickMs);
        const inputFrame = Number.isFinite(input?.f) ? input.f : 0;

        this.gameState.simTimeMs = alignedTime;
        this.gameState.lastTime = Math.max(
            Number.isFinite(this.gameState.lastTime) ? this.gameState.lastTime : 0,
            alignedTime,
        );
        this.gameState.simFrame = Math.max(0, inputFrame, alignedFrame);
        this.lastSimulatedTime = Math.max(this.lastSimulatedTime || 0, alignedTime);
    }

    async _waitForPhysics() {
        if (!this.gameState?.latestPhysicsPromise) return;

        try {
            await this.gameState.latestPhysicsPromise;
        } catch (error) {
            console.warn('[DemoPlayer] Physics rejected during replay:', error);
        } finally {
            this.gameState.latestPhysicsPromise = null;
            this.gameState.isProcessingPhysics = false;
            if (this.gameState.isReplay && Number.isFinite(this.gameState.simTimeMs)) {
                this.lastSimulatedTime = Math.max(
                    this.lastSimulatedTime || 0,
                    this.gameState.simTimeMs,
                );
            }
        }
    }

    _resetState() {
        if (!this.gameState || !this.demo) return;

        this.gameState.reset();
        this.gameState.simTickMs = this.tickMs;
        this.gameState.simTimeMs = 0;
        this.gameState.simFrame = 0;
        this.gameState.lastTime = 0;
        this.gameState.isReplay = true;
        this.gameState.isSeeking = false;
        this.gameState.suppressExternalInput = true;
        this.gameState.hitStopEnabled = this.demo.initialState.settings.hitStopEnabled;

        const { seed } = this.demo.initialState;
        this.gameState.randomGenerator = seededRandom(seed);

        this.gameState.level = this.demo.initialState.level || 1;
        if (Number.isFinite(this.demo.initialState.dropInterval)) {
            this.gameState.dropInterval = this.demo.initialState.dropInterval;
        } else {
            const speedIndex = Math.min(this.gameState.level - 1, LEVEL_SPEEDS.length - 1);
            this.gameState.dropInterval = LEVEL_SPEEDS[speedIndex];
        }

        fillBag(this.gameState.nextPieces, this.gameState.randomGenerator);
        if (this.callbacks.spawnPiece) {
            this.callbacks.spawnPiece();
        }

        this.currentInputIndex = 0;
        this.lastSimulatedTime = 0;
    }

    _syncPlayhead() {
        if (!this.isPlaying || this.isPaused || this.isSeeking) return;

        const now = nowMs();
        if (!this.lastWallTime) {
            this.lastWallTime = now;
            return;
        }

        const elapsed = Math.max(0, now - this.lastWallTime);
        this.playheadMs = clamp(
            this.playheadMs + (elapsed * this.playbackSpeed),
            0,
            this.getDuration(),
        );
        this.lastWallTime = now;
    }

    _captureRuntimeCheckpoint(force = false) {
        if (!this.gameState) return;
        if (!isStableDemoCheckpointState(this.gameState)) return;

        const frame = Math.max(0, Math.round((this.lastSimulatedTime || 0) / this.tickMs));
        const nextInput = this.demo.inputs[this.currentInputIndex];
        if (!force && nextInput && nextInput.f <= frame) {
            return;
        }

        if (!force && frame - this.lastCheckpointFrame < DEMO_CHECKPOINT_INTERVAL_FRAMES) {
            return;
        }

        const checkpoint = {
            f: frame,
            t: Math.round(frame * this.tickMs),
            inputIndex: this.currentInputIndex,
            state: captureGameStateSnapshot(this.gameState),
            runtime: true,
        };

        this._upsertCheckpoint(checkpoint);
        this.lastCheckpointFrame = frame;
    }

    _upsertCheckpoint(checkpoint) {
        if (!checkpoint?.state) return;

        const existingIndex = this.checkpoints.findIndex((entry) => (
            entry.f === checkpoint.f && entry.inputIndex === checkpoint.inputIndex
        ));
        if (existingIndex >= 0) {
            this.checkpoints[existingIndex] = checkpoint;
        } else {
            this.checkpoints.push(checkpoint);
        }
        this.checkpoints.sort((a, b) => (a.f - b.f) || ((a.inputIndex || 0) - (b.inputIndex || 0)));
    }

    _findCheckpoint(targetMs) {
        const targetFrame = Math.floor(targetMs / this.tickMs);
        let best = null;

        for (const checkpoint of this.checkpoints) {
            if (!checkpoint?.state || checkpoint.f > targetFrame) continue;
            if (!best || checkpoint.f > best.f || (
                checkpoint.f === best.f
                && (checkpoint.inputIndex || 0) > (best.inputIndex || 0)
            )) {
                best = checkpoint;
            }
        }

        return best;
    }

    _checkpointTime(checkpoint) {
        if (Number.isFinite(checkpoint?.state?.simTimeMs)) {
            return checkpoint.state.simTimeMs;
        }
        if (Number.isFinite(checkpoint?.t)) {
            return checkpoint.t;
        }
        return 0;
    }

    _getMutedCallbacks() {
        if (!this._mutedCallbacks) {
            const originalPhysics = this.callbacks.physicsCallbacks || {};
            const replayTiming = this.callbacks.replayTimingCallbacks || {};
            this._mutedCallbacks = {
                ...this.callbacks,
                playSoundCallback: () => { },
                playDropCallback: () => { },
                addTrailCallback: () => { },
                physicsCallbacks: {
                    ...originalPhysics,
                    onMove: () => { },
                    onRotate: () => { },
                    onLineClear: () => { },
                    onLevelUp: () => { },
                    onHardDrop: (...args) => replayTiming.onHardDrop?.(...args),
                    triggerCombo: () => { },
                    triggerCascadeWave: () => { },
                    triggerFlash: () => { },
                    onLineClearImpact: (...args) => replayTiming.onLineClearImpact?.(...args),
                    triggerBackgroundPulse: () => { },
                    onPerfectClear: (...args) => replayTiming.onPerfectClear?.(...args),
                    onPieceLock: () => { },
                    spawnPiece: originalPhysics.spawnPiece,
                },
            };
        }
        return this._mutedCallbacks;
    }

    _normalizeDemo(demoData) {
        const tickMs = Number(demoData.sim?.tickMs) || DEMO_TICK_MS;
        const declaredSettings = demoData.initialState.settings;
        const initialSettings = declaredSettings
            && typeof declaredSettings === 'object'
            && !Array.isArray(declaredSettings)
            ? declaredSettings
            : {};
        const inputs = demoData.inputs
            .map((input, index) => {
                const frame = Number.isFinite(input.f)
                    ? Math.max(0, Math.round(input.f))
                    : Math.max(0, Math.round((Number(input.t) || 0) / tickMs));
                return {
                    ...input,
                    f: frame,
                    t: Math.round(frame * tickMs),
                    a: input.a,
                    _order: index,
                };
            })
            .filter((input) => input.a)
            .sort((a, b) => (a.f - b.f) || (a._order - b._order))
            .map(({ _order, ...input }) => input);

        const lastInputFrame = inputs.reduce((max, input) => Math.max(max, input.f), 0);
        const metadataDurationFrames = Number(demoData.metadata?.durationFrames);
        const metadataDuration = Number(demoData.metadata?.duration);
        const durationFrames = Math.max(
            Number.isFinite(demoData.sim?.durationFrames) ? demoData.sim.durationFrames : 0,
            Number.isFinite(metadataDurationFrames) ? metadataDurationFrames : 0,
            Number.isFinite(metadataDuration) ? Math.round(metadataDuration / tickMs) : 0,
            lastInputFrame,
        );
        const duration = Number.isFinite(metadataDuration)
            ? Math.max(metadataDuration, Math.round(durationFrames * tickMs))
            : Math.round(durationFrames * tickMs);

        const checkpoints = Array.isArray(demoData.checkpoints)
            ? demoData.checkpoints
                .filter((checkpoint) => (
                    checkpoint?.state
                    && isStableDemoCheckpointSnapshot(checkpoint.state)
                ))
                .map((checkpoint) => {
                    const frame = Number.isFinite(checkpoint.f)
                        ? Math.max(0, Math.round(checkpoint.f))
                        : Math.max(0, Math.round((Number(checkpoint.t) || 0) / tickMs));
                    const checkpointTime = Number.isFinite(checkpoint.state?.simTimeMs)
                        ? checkpoint.state.simTimeMs
                        : Math.round(frame * tickMs);
                    const inputIndex = Number.isFinite(checkpoint.inputIndex)
                        ? checkpoint.inputIndex
                        : inputs.findIndex((input) => input.f > frame);
                    return {
                        ...checkpoint,
                        f: frame,
                        t: checkpointTime,
                        inputIndex: inputIndex < 0 ? inputs.length : inputIndex,
                    };
                })
                .sort((a, b) => (a.f - b.f) || ((a.inputIndex || 0) - (b.inputIndex || 0)))
            : [];

        return {
            ...demoData,
            version: demoData.version ?? '1.0',
            initialState: {
                ...demoData.initialState,
                settings: {
                    ...initialSettings,
                    hitStopEnabled: typeof initialSettings.hitStopEnabled === 'boolean'
                        ? initialSettings.hitStopEnabled
                        : LEGACY_DEMO_HIT_STOP_ENABLED,
                },
            },
            sim: {
                tickMs,
                startFrame: demoData.sim?.startFrame || 0,
                durationFrames,
                inputFormat: demoData.sim?.inputFormat ?? DEMO_COMMAND_INPUT_FORMAT,
            },
            inputs,
            checkpoints,
            metadata: {
                ...(demoData.metadata || {}),
                duration,
                durationFrames,
            },
        };
    }
}
