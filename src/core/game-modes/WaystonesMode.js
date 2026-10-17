// @ts-check

/**
 * Waystones: a seeded road of five stops across the worlds the player has collected, on
 * the Single Player session.
 *
 * Each stop is one world under one climate (a speed, a few rule modifiers, a goal). The
 * goal met, the piece in hand is not dealt again: the road waits while the player settles
 * the stack (bank it for a toll and a bigger ask, or release it), takes a charm or not,
 * and chooses the next world; then the theme switches, the climate is applied and play
 * goes on with the board as they left it. A top-out spends a lantern and clears the well;
 * the last lantern ends the road. The Keeper's stop, the fifth, ends it in the light.
 *
 * One GameState lasts the whole road, so piece ids keep counting and no board is ever
 * copied between states. Nothing is recorded or saved to Records.
 *
 * The mode stays headless: it publishes its state on EVENTS.WAYSTONES_STATE and takes the
 * between-stops choices from EVENTS.WAYSTONES_COMMAND. The HUD (ui/waystones/) draws one
 * and sends the other.
 */

import { SinglePlayerMode } from './SinglePlayerMode.js';
import { GameState, restoreBoardState, spawnPiece } from '../game.js';
import { createBoardGrid, invalidateGhostCache, markBoardDirty } from '../board.js';
import { GAME_MODES, LEVEL_SPEEDS, LOCK_DELAY_MS } from '../constants.js';
import { durationMsToTicks } from '../fixed-tick-clock.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { piecePool } from '../../utils/object-pool.js';
import { ModifierStack } from '../odyssey/ModifierStack.js';
import { getThemeMeta } from '../../themes/theme-registry.js';
import { LONG_BREATH, goalText, modifierInfo } from '../waystones/climates.js';
import { CURRENT, EMBER, charmById } from '../waystones/charms.js';
import { offerClimate, randomSeed, scaledGoal } from '../waystones/road.js';
import {
    bank, choose, completeStop, createRun, nextOffers, recordStop, release, skipCharm, spendLantern, summary,
    takeCharm,
} from '../waystones/run.js';

/** @typedef {import('../waystones/run.js').WaystonesRun} WaystonesRun */
/** @typedef {import('../waystones/road.js').World} World */

/** The modifiers this mode applies itself; the rest are Odyssey's ModifierStack. */
const OWN_MODIFIERS = new Set(['mist', 'long-breath']);

export class WaystonesMode extends SinglePlayerMode {
    constructor(dependencies) {
        super(dependencies);
        /** @type {WaystonesRun | null} */
        this._run = null;
        /** @type {string | null} the road's seed, when the start asked for one */
        this._roadSeed = null;
        this._modifiers = new ModifierStack();
        this._mist = false;
        this._stopStart = { score: 0, lines: 0 };
        this._cascades = 0;
        this._lockWaves = 0;
        this._lockMaxLines = 0;
        this._scoreAtLock = 0;
        this._switching = false;
        /** @type {{ stopIndex: number, forgiven: boolean } | null} the last top-out, for the panel */
        this._lastLantern = null;
        /** @type {(() => void) | null} */
        this._stopCommands = null;
    }

    getModeId() {
        return GAME_MODES.WAYSTONES;
    }

    getDisplayName() {
        return 'Waystones';
    }

    async onActivate() {
        await super.onActivate();
        this._stopCommands?.();
        this._stopCommands = eventBus.on(EVENTS.WAYSTONES_COMMAND, (command) => this._onCommand(command));
    }

    /** @param {Object} [options] roadSeed: the road to walk; otherwise the session's seed */
    async onStart(options = {}) {
        this._roadSeed = options.roadSeed != null ? String(options.roadSeed) : null;
        await super.onStart(options);
        if (!this.isRunning || !this._run) return;
        this._publish();
    }

    async onDeactivate() {
        this._stopCommands?.();
        this._stopCommands = null;
        await super.onDeactivate();
        this._run = null;
        eventBus.emit(EVENTS.WAYSTONES_STATE, { active: false });
    }

    // ── Single Player session hooks ──

    /** @param {Object} options */
    _createSessionGameState(options) {
        // The climate sets the speed; lines must not move it between stops.
        return new GameState({ ...options, disableLevelProgression: true });
    }

    /** The bag fills as usual, then the road is laid from the session's seed. */
    _dealSessionPieces() {
        super._dealSessionPieces();
        this._beginRoad();
    }

    _recordsDemos() {
        return false;
    }

    _allowsFixedTick() {
        return false;
    }

    // ── The road ──

    /** @param {string} id */
    _world(id) {
        return { id, name: getThemeMeta(id)?.displayName || id };
    }

    /** The worlds the road may offer: the collection, Forest at least. */
    _worlds() {
        const ids = this.deps.themeManager?.getAvailableThemes?.() || [];
        return (ids.length > 0 ? ids : ['forest']).map((id) => this._world(id));
    }

    _startWorld() {
        return this._world(this.deps.themeManager?.activeThemeName || 'forest');
    }

    /** @param {string} [seed] */
    _beginRoad(seed = this._roadSeed ?? undefined) {
        const roadSeed = seed ?? this._activeSession?.rngDescriptor?.seed ?? randomSeed();
        this._run = createRun({ seed: String(roadSeed), startWorld: this._startWorld(), worlds: this._worlds() });
        this._applyClimate();
        this._beginStop();
    }

    /**
     * The stop's climate on the GameState: the baseline first (a stop never inherits the
     * last one's weather), then Odyssey's modifiers, then this mode's own.
     */
    _applyClimate() {
        const { gameState, _run: run } = this;
        if (!gameState || !run) return;
        const state = /** @type {any} */ (gameState);
        const { climate } = run.stop;
        gameState.dropInterval = LEVEL_SPEEDS[Math.min(climate.level, LEVEL_SPEEDS.length) - 1];
        gameState.lockDelay = LOCK_DELAY_MS;
        gameState.lockDelayTicks = durationMsToTicks(LOCK_DELAY_MS, gameState.simTickMs);
        state.speedMultiplier = undefined;
        state.mirrorControls = false;
        state.comboMultiplierEnabled = false;
        state.comboMultiplier = 1;
        state.comboCount = 0;
        this._modifiers.clear();
        this._modifiers.activate(climate.modifiers.filter((id) => !OWN_MODIFIERS.has(id)));
        this._modifiers.applyToGameState(gameState);
        if (climate.modifiers.includes('long-breath')) {
            gameState.dropInterval = Math.round(gameState.dropInterval * LONG_BREATH.dropFactor);
            gameState.lockDelay = Math.round(LOCK_DELAY_MS * LONG_BREATH.lockFactor);
            gameState.lockDelayTicks = durationMsToTicks(gameState.lockDelay, gameState.simTickMs);
        }
        this._mist = climate.modifiers.includes('mist');
    }

    _beginStop() {
        const { gameState } = this;
        if (!gameState) return;
        this._stopStart = { score: gameState.score, lines: gameState.lines };
        this._cascades = 0;
        this._lockWaves = 0;
        this._lockMaxLines = 0;
        this._scoreAtLock = gameState.score;
        this._lastLantern = null;
    }

    /** What the board did since the stop began. */
    _stopTotals() {
        const { gameState } = this;
        return {
            lines: (gameState?.lines || 0) - this._stopStart.lines,
            score: (gameState?.score || 0) - this._stopStart.score,
            cascades: this._cascades,
        };
    }

    /** Rows of the well with anything in them: what banking would carry. */
    _stackRows() {
        const grid = this.gameState?.boardGrid || [];
        return grid.filter((row) => row.some(Boolean)).length;
    }

    _getPhysicsCallbacks() {
        const callbacks = super._getPhysicsCallbacks();
        const { gameState } = this;
        return {
            ...callbacks,
            onPieceLock: (piece) => {
                this._lockWaves = 0;
                this._lockMaxLines = 0;
                this._scoreAtLock = gameState?.score || 0;
                callbacks.onPieceLock(piece);
            },
            onLineClear: (lineCount, ...rest) => {
                this._lockWaves = Math.max(this._lockWaves, rest[3] ?? 1);
                this._lockMaxLines = Math.max(this._lockMaxLines, lineCount);
                callbacks.onLineClear(lineCount, ...rest);
            },
            // After the cascade settles: pay the charms, judge the stop, then deal on or wait.
            spawnPiece: () => {
                if (this.gameState === gameState) this._afterCascade(callbacks.spawnPiece);
            },
        };
    }

    /** @param {() => void} deal Single Player's spawn, with its game-over handling */
    _afterCascade(deal) {
        const { gameState, _run: run } = this;
        if (!gameState || !run || !this.isRunning || run.phase !== 'play') return;
        if (this._lockWaves >= 2) this._cascades += 1;
        this._applyScoreCharms();
        if (recordStop(run, this._stopTotals())) {
            this._completeStop();
            return;
        }
        deal();
        this._publish();
    }

    /** Ember and Current: a share of the lock's points, once its cascade has settled. */
    _applyScoreCharms() {
        const { gameState, _run: run } = this;
        if (!gameState || !run) return;
        const delta = gameState.score - this._scoreAtLock;
        if (delta <= 0) return;
        let share = 0;
        if (run.charms.includes('ember') && this._lockWaves >= EMBER.wavesAtLeast) share += EMBER.bonusShare;
        if (run.charms.includes('current') && this._lockMaxLines >= CURRENT.linesAtLeast) share += CURRENT.bonusShare;
        if (share > 0) gameState.score += Math.round(delta * share);
    }

    _completeStop() {
        const { _run: run } = this;
        if (!run) return;
        completeStop(run);
        this.deps.soundManager?.sfxPlayer?.playLevelUp?.();
        this._publish();
    }

    /**
     * A top-out spends a lantern instead of ending the session. spawnPiece has marked the
     * session over and left the blocked piece in hand: both are undone first, because the
     * game loop stops drawing on isGameOver. The well clears after the board's death beat
     * and the stop goes on; the last lantern leaves the dead stack standing.
     * @param {number} [expectedGeneration]
     */
    async _handleGameOver(expectedGeneration = this._activeSession?.generation) {
        const session = this._activeSession;
        if (session && expectedGeneration !== undefined && session.generation !== expectedGeneration) return;
        const { gameState, _run: run } = this;
        if (!gameState || !run || run.phase !== 'play') return;
        gameState.isGameOver = false;
        if (gameState.currentPiece) {
            piecePool.release(gameState.currentPiece);
            gameState.currentPiece = null;
            invalidateGhostCache(gameState);
        }
        const { forgiven, ended } = spendLantern(run);
        this._lastLantern = { stopIndex: run.stopIndex, forgiven };
        this._publish();
        if (ended) return;
        const beatMs = gameState.isSeeking ? 0 : this._getBoardScene()?.sharedEffects?.playGameOver?.();
        if (beatMs > 0) await new Promise((resolve) => { setTimeout(resolve, beatMs); });
        if (this._run !== run || !this.isRunning || run.phase !== 'play') return;
        this._clearBoard();
        this._deal();
        this._publish();
    }

    _clearBoard() {
        const { gameState } = this;
        if (!gameState) return;
        restoreBoardState(gameState, { grid: createBoardGrid(), lockedPieces: [] }, { adoptBoard: true });
        markBoardDirty(gameState);
        gameState.inputQueue = null;
    }

    _deal() {
        const { gameState } = this;
        if (!gameState) return;
        spawnPiece(gameState, () => this._refreshNextQueue(), () => this._handleGameOver());
        this._refreshNextQueue();
    }

    // ── Between stops ──

    /** @param {{ type?: string, charmId?: string, offer?: number }} command */
    _onCommand(command) {
        const { gameState, _run: run } = this;
        if (!this.isRunning || this.isPaused || !gameState || !run) return;
        const type = command?.type;
        if (type === 'refresh') {
            this._publish();
            return;
        }
        if (gameState.isProcessingPhysics || this._switching) return;
        if (run.phase === 'between') {
            if (type === 'bank') {
                const toll = bank(run, this._stackRows());
                if (toll < 0) return;
                gameState.score += toll;
                this._publish();
            } else if (type === 'release') {
                if (!release(run)) return;
                this._clearBoard();
                this._publish();
            } else if (type === 'charm') {
                if (takeCharm(run, String(command.charmId))) this._publish();
            } else if (type === 'skip-charm') {
                if (skipCharm(run)) this._publish();
            } else if (type === 'choose') {
                this._setOut(Number(command.offer));
            }
        } else if (run.phase === 'ended' && type === 'again') {
            this._again();
        }
    }

    /**
     * Sets out for one of the next stop's worlds: the theme switches while the board
     * waits, then the climate takes hold and the next piece is dealt.
     * @param {number} offerIndex
     */
    async _setOut(offerIndex) {
        const { _run: run } = this;
        if (!run) return;
        const offer = nextOffers(run)[offerIndex];
        if (!offer || !choose(run, offerIndex)) return;
        this._switching = true;
        this._publish();
        try {
            await this.deps.themeManager?.switchTheme?.(offer.world.id);
        } catch (error) {
            console.warn('[Waystones] The world did not change:', error);
        }
        this._switching = false;
        if (this._run !== run || !this.isRunning || !this.gameState) return;
        this._applyClimate();
        this._beginStop();
        this._deal();
        this._publish();
    }

    /** A new road from where the player stands, with an empty well and no score. */
    _again() {
        const { gameState } = this;
        if (!gameState) return;
        restoreBoardState(gameState, {
            grid: createBoardGrid(), lockedPieces: [], score: 0, lines: 0, level: 1,
        }, { adoptBoard: true, statsMode: 'adopt' });
        markBoardDirty(gameState);
        gameState.inputQueue = null;
        gameState.isGameOver = false;
        this._beginRoad(randomSeed());
        this._deal();
        this._publish();
    }

    /**
     * Mirror pool reverses the moves; nothing moves while the road waits between stops.
     * @param {Object} command
     * @param {Object} [options]
     */
    _applyCommand(command, options = {}) {
        const { gameState, _run: run } = this;
        if (run && run.phase !== 'play') return false;
        if (gameState && /** @type {any} */ (gameState).mirrorControls) {
            const { type, value } = this._normalizeCommand(command);
            if (type === 'move' && typeof value === 'number') return super._applyCommand({ type, value: -value }, options);
        }
        return super._applyCommand(command, options);
    }

    // ── What the HUD shows ──

    /** @param {import('../waystones/climates.js').Climate} climate */
    _climateView(climate) {
        return {
            id: climate.id,
            name: climate.name,
            line: climate.line,
            modifiers: climate.modifiers.map((id) => modifierInfo(id)).filter(Boolean),
        };
    }

    getRoadState() {
        const { gameState, _run: run } = this;
        if (!gameState || !run) return { active: false };
        const { stop } = run;
        const totals = this._stopTotals();
        const keel = run.charms.includes('keel');
        const stackRows = this._stackRows();
        let between = null;
        if (run.phase === 'between' && run.between) {
            const { banked, carriedRows, toll } = run.between;
            const nextStop = run.road.stops[run.stopIndex + 1];
            between = {
                settled: banked !== null,
                banked,
                stackRows,
                carriedRows,
                toll,
                tollIfBanked: stackRows * (run.charms.includes('tide') ? 120 : 60),
                draft: run.between.draft.map((id) => charmById(id)).filter(Boolean),
                charmTaken: run.between.charmTaken,
                charmSettled: run.between.charmSettled,
                offers: nextOffers(run).map((offer, index) => {
                    const climate = offerClimate(offer);
                    const terms = { keeper: Boolean(nextStop?.keeper), keel };
                    return {
                        index,
                        world: offer.world,
                        climate: this._climateView(climate),
                        goalIfBanked: scaledGoal(climate, { ...terms, carriedRows: banked === null ? stackRows : carriedRows }),
                        goalIfReleased: scaledGoal(climate, { ...terms, carriedRows: 0 }),
                    };
                }),
            };
        }
        return {
            active: true,
            phase: run.phase,
            switching: this._switching,
            seed: run.seed,
            stopIndex: run.stopIndex,
            stopCount: run.road.stops.length,
            keeper: Boolean(run.road.stops[run.stopIndex]?.keeper),
            world: stop.world,
            climate: this._climateView(stop.climate),
            goal: { ...stop.goal, progress: stop.progress, text: goalText(stop.goal) },
            carriedRows: stop.carriedRows,
            mist: this._mist,
            mirror: Boolean(/** @type {any} */ (gameState).mirrorControls),
            lanterns: run.lanterns,
            lanternsMax: run.lanternsMax,
            charms: run.charms.map((id) => charmById(id)).filter(Boolean),
            score: gameState.score,
            stopScore: totals.score,
            stopLines: totals.lines,
            stopCascades: totals.cascades,
            lastLantern: this._lastLantern,
            road: run.road.stops.map((entry) => {
                const done = run.history.find((past) => past.index === entry.index);
                let state = 'ahead';
                if (done) state = 'done';
                else if (entry.index === run.stopIndex) state = 'current';
                return {
                    index: entry.index,
                    keeper: entry.keeper,
                    state,
                    worldName: done?.world.name ?? (entry.index === run.stopIndex ? stop.world.name : null),
                };
            }),
            between,
            ended: run.phase === 'ended' ? summary(run, gameState.score) : null,
        };
    }

    _publish() {
        eventBus.emit(EVENTS.WAYSTONES_STATE, this.getRoadState());
    }
}
