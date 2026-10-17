// @ts-check

/**
 * Waystones: a seeded road of five stops across the worlds the player has collected, on
 * the Single Player session.
 *
 * Each stop is one world under one climate (a speed, a few rule modifiers, a goal). The
 * goal met, the piece in hand is not dealt again: the road waits while the player settles
 * the stack (bank it, which raises the next ask and pays once that stop is cleared, or
 * release it), takes a charm or not, may buy a lantern back with points, and chooses the
 * next world; then the theme switches, the climate is applied and play goes on with the
 * board as they left it. A top-out spends a lantern and clears the well; the last
 * lantern ends the road. The Keeper's stop, the fifth, ends it in the light.
 *
 * One GameState lasts the whole road, so piece ids keep counting and no board is ever
 * copied between states. The road holds its world with the same scoped permission
 * Odyssey's orbs use, so Single Player's own theme changes (the "As you level up"
 * journey, the Random timer) cannot move it, and the player's theme comes back when the
 * mode is left. Nothing is recorded or saved to Records.
 *
 * The mode stays headless: it publishes its state on EVENTS.WAYSTONES_STATE and takes the
 * between-stops choices from EVENTS.WAYSTONES_COMMAND. The HUD (ui/waystones/) draws one
 * and sends the other.
 */

import { SinglePlayerMode } from './SinglePlayerMode.js';
import { GameState, restoreBoardState, spawnPiece } from '../game.js';
import { createBoardGrid, invalidateGhostCache, markBoardDirty } from '../board.js';
import {
    COLS, GAME_MODES, HIDDEN_ROWS, LEVEL_SPEEDS, LOCK_DELAY_MS,
} from '../constants.js';
import { durationMsToTicks } from '../fixed-tick-clock.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { piecePool } from '../../utils/object-pool.js';
import { ModifierStack } from '../odyssey/ModifierStack.js';
import { getThemeMeta } from '../../themes/theme-registry.js';
import {
    LONG_BREATH, OWN_MODIFIERS, goalText, modifierInfo, paceWord,
} from '../waystones/climates.js';
import { KINDLE, SWELL, charmById } from '../waystones/charms.js';
import { offerClimate, randomSeed, tollFor } from '../waystones/road.js';
import {
    RELIGHT_COST, bank, canRelight, choose, completeStop, createRun, nextOffers, offerAsk, recordStop,
    relightLantern, release, skipCharm, spendLantern, summary, takeCharm,
} from '../waystones/run.js';

/** @typedef {import('../waystones/run.js').WaystonesRun} WaystonesRun */
/** @typedef {import('../waystones/road.js').World} World */

/** The board's death veil holds this long (shared-effects playGameOver); the well clears after it. */
const LANTERN_BEAT_MS = 1600;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

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
        /** @type {WaystonesRun | null} the run whose world switch is in flight */
        this._switching = null;
        /** @type {{ stopIndex: number, forgiven: boolean } | null} the last top-out, for the panel */
        this._lastLantern = null;
        /** @type {string} the player's own theme, restored when the mode is left */
        this._homeTheme = 'forest';
        /** @type {Object | null} the scoped permission that holds the road's world */
        this._themeHold = null;
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
        // Where the player's theme goes back to: their chosen world, else the one on screen.
        const settings = this.deps.settingsManager?.get?.() || {};
        const chosen = settings.backgroundMode === 'Specific' ? settings.backgroundTheme : null;
        this._homeTheme = chosen || this.deps.themeManager?.activeThemeName || 'forest';
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
        this._switching = null;
        eventBus.emit(EVENTS.WAYSTONES_STATE, { active: false });
        await this._releaseWorld();
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
        const startWorld = this._startWorld();
        this._run = createRun({ seed: String(roadSeed), startWorld, worlds: this._worlds() });
        this._switching = null;
        this._holdWorld(startWorld.id);
        this._applyClimate();
        this._beginStop();
    }

    /**
     * Holds the road's world against Single Player's own theme changes (the "As you level
     * up" journey, the Random timer, music-linked switches): a scoped permission, as
     * Odyssey's orbs use, that only this mode's switches carry. While it stands, a switch
     * without it is refused. Ended by _releaseWorld, which restores the player's theme.
     * @param {string} worldId
     */
    _holdWorld(worldId) {
        const { themeManager } = this.deps;
        if (!themeManager?.beginOdysseyThemeScope) return null;
        /** @type {{ token: Object | null }} */
        const hold = { token: null };
        try {
            hold.token = themeManager.beginOdysseyThemeScope(worldId, {
                isCurrent: () => this.isActive !== false && this._themeHold === hold.token,
                restoreTheme: this._homeTheme,
            });
        } catch (error) {
            console.warn('[Waystones] The world could not be held:', error);
            return null;
        }
        this._themeHold = hold.token;
        return hold.token;
    }

    async _releaseWorld() {
        const token = this._themeHold;
        this._themeHold = null;
        if (!token) return;
        try {
            await this.deps.themeManager?.endOdysseyThemeScope?.(token);
        } catch (error) {
            console.warn('[Waystones] The player\'s theme did not come back:', error);
        }
    }

    /**
     * The stop's climate on the GameState: the baseline first (a stop never inherits the
     * last one's weather), then Odyssey's modifiers, then this mode's own. The result is
     * what climates.js effectiveDropMs predicts for the offer card.
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
        this._modifiers.activate(climate.modifiers.filter((id) => !OWN_MODIFIERS.includes(id)));
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

    /** Rows of blocks standing in the well: what banking would carry. A spire is not a stack. */
    _stackMaterial() {
        const grid = this.gameState?.boardGrid || [];
        let cells = 0;
        for (const row of grid) for (const cell of row) if (cell) cells += 1;
        return Math.ceil(cells / COLS);
    }

    /** A stack into the hidden rows would block the next deal: it cannot be carried. */
    _stackTooTall() {
        const grid = this.gameState?.boardGrid || [];
        return grid.slice(0, HIDDEN_ROWS).some((row) => row.some(Boolean));
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

    /** Kindle and Swell: a share of the lock's clear points, once its cascade has settled. */
    _applyScoreCharms() {
        const { gameState, _run: run } = this;
        if (!gameState || !run) return;
        const delta = gameState.score - this._scoreAtLock;
        if (delta <= 0) return;
        let share = 0;
        if (run.charms.includes('kindle') && this._lockWaves >= KINDLE.wavesAtLeast) share += KINDLE.bonusShare;
        if (run.charms.includes('swell') && this._lockMaxLines >= SWELL.linesAtLeast) share += SWELL.bonusShare;
        if (share > 0) gameState.score += Math.round(delta * share);
    }

    /** The stop is cleared: the banked stack pays, the board says so, the road waits or ends. */
    _completeStop() {
        const { gameState, _run: run } = this;
        if (!gameState || !run) return;
        completeStop(run, { material: this._stackMaterial() });
        if (run.lastPayout > 0) gameState.score += run.lastPayout;
        this.deps.soundManager?.sfxPlayer?.playLevelUp?.();
        const won = run.phase === 'ended';
        this._getBoardScene()?.sharedEffects?.playRoadBanner?.(
            won ? 'The Keeper\'s light' : `Stop ${run.stopIndex + 1} cleared`,
            won ? 'The road is walked' : 'The road waits',
        );
        this._publish();
    }

    /**
     * A top-out spends a lantern instead of ending the session. spawnPiece has marked the
     * session over and left the blocked piece in hand: both are undone first, because the
     * game loop stops drawing on isGameOver. The board's death beat plays either way; then
     * the well clears, the ask falls back to the base (the banked stack is gone), and the
     * stop goes on, or completes at once if the progress already meets the smaller ask.
     * The last lantern leaves the dead stack standing.
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
        const beatMs = gameState.isSeeking ? 0 : (this._getBoardScene()?.sharedEffects?.playGameOver?.() || 0);
        if (ended) return;
        if (beatMs > 0) await wait(Math.max(beatMs, LANTERN_BEAT_MS));
        if (this._run !== run || !this.isRunning || run.phase !== 'play') return;
        this._clearBoard();
        if (run.stop.progress >= run.stop.goal.target) {
            this._completeStop();
            return;
        }
        this._deal();
        this._publish();
    }

    _clearBoard() {
        const { gameState } = this;
        if (!gameState) return;
        restoreBoardState(gameState, { grid: createBoardGrid(), lockedPieces: [] }, { adoptBoard: true });
        markBoardDirty(gameState);
        gameState.inputQueue = null;
        const state = /** @type {any} */ (gameState);
        state.comboCount = 0;
        state.b2bActive = false;
    }

    _deal() {
        const { gameState } = this;
        if (!gameState) return;
        spawnPiece(gameState, () => this._refreshNextQueue(), () => this._handleGameOver());
        this._refreshNextQueue();
    }

    // ── Between stops ──

    /** @param {{ type?: string, charmId?: string, offer?: number, seed?: string }} command */
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
                if (this._stackTooTall() || bank(run, this._stackMaterial()) < 0) return;
                this._publish();
            } else if (type === 'release') {
                if (!release(run)) return;
                this._clearBoard();
                this._publish();
            } else if (type === 'charm') {
                if (takeCharm(run, String(command.charmId))) this._publish();
            } else if (type === 'skip-charm') {
                if (skipCharm(run)) this._publish();
            } else if (type === 'relight') {
                if (!relightLantern(run, { score: gameState.score })) return;
                gameState.score -= RELIGHT_COST;
                this._publish();
            } else if (type === 'choose') {
                this._setOut(Number(command.offer));
            }
        } else if (run.phase === 'ended' && type === 'again') {
            this._again(command.seed ? String(command.seed) : randomSeed());
        }
    }

    /**
     * Sets out for one of the next stop's worlds: the theme switches while the board
     * waits, then the climate takes hold and the next piece is dealt. The stop's world is
     * whatever the switch arrived in, so the panel never names a world the screen lacks.
     * @param {number} offerIndex
     */
    async _setOut(offerIndex) {
        const { _run: run } = this;
        if (!run) return;
        const offer = nextOffers(run)[offerIndex];
        if (!offer || !choose(run, offerIndex)) return;
        this._switching = run;
        this._publish();
        let applied = offer.world.id;
        try {
            const { themeManager } = this.deps;
            const token = this._holdWorld(offer.world.id);
            const result = await (token
                ? themeManager.switchTheme(offer.world.id, false, token)
                : themeManager?.switchTheme?.(offer.world.id));
            if (typeof result === 'string' && result) applied = result;
        } catch (error) {
            console.warn('[Waystones] The world did not change:', error);
        }
        if (this._switching === run) this._switching = null;
        if (this._run !== run || !this.isRunning || !this.gameState) return;
        if (applied !== offer.world.id) {
            console.warn(`[Waystones] Set out for ${offer.world.id}, arrived in ${applied}`);
            run.stop.world = this._world(applied);
        }
        this._applyClimate();
        this._beginStop();
        this._deal();
        this._publish();
    }

    /**
     * A new road from where the player stands, with an empty well and no score; the same
     * road again when a seed is given.
     * @param {string} seed
     */
    _again(seed) {
        const { gameState } = this;
        if (!gameState) return;
        restoreBoardState(gameState, {
            grid: createBoardGrid(), lockedPieces: [], score: 0, lines: 0, level: 1,
        }, { adoptBoard: true, statsMode: 'adopt' });
        markBoardDirty(gameState);
        gameState.inputQueue = null;
        gameState.isGameOver = false;
        this._beginRoad(seed);
        this._deal();
        this._publish();
    }

    /**
     * Mirror pool reverses the moves; nothing moves while the road waits between stops or
     * the world is changing.
     * @param {Object} command
     * @param {Object} [options]
     */
    _applyCommand(command, options = {}) {
        const { gameState, _run: run } = this;
        if (run && (run.phase !== 'play' || this._switching)) return false;
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
            pace: paceWord(climate),
            modifiers: climate.modifiers.map((id) => modifierInfo(id)).filter(Boolean),
        };
    }

    getRoadState() {
        const { gameState, _run: run } = this;
        if (!gameState || !run) return { active: false };
        const { stop } = run;
        const totals = this._stopTotals();
        const material = this._stackMaterial();
        let between = null;
        if (run.phase === 'between' && run.between) {
            const {
                banked, carriedRows, toll, autoReleased, draft, charmTaken, charmSettled,
            } = run.between;
            const nextStop = run.road.stops[run.stopIndex + 1];
            const offers = nextOffers(run);
            const tooTall = this._stackTooTall();
            const relight = canRelight(run, gameState.score);
            between = {
                settled: banked !== null,
                banked,
                autoReleased,
                stackRows: material,
                tooTall,
                canBank: banked === null && material > 0 && !tooTall,
                carriedRows,
                toll,
                tollIfBanked: tollFor(material, { tide: run.charms.includes('tide') }),
                draft: draft.map((id) => charmById(id)).filter(Boolean),
                charmTaken,
                charmSettled,
                relight: { cost: RELIGHT_COST, ...relight },
                keeperNext: Boolean(nextStop?.keeper),
                sameWorld: offers.length > 1 && offers.every((offer) => offer.world.id === offers[0].world.id),
                offers: offers.map((offer, index) => ({
                    index,
                    world: offer.world,
                    climate: this._climateView(offerClimate(offer)),
                    goalIfBanked: offerAsk(run, offer, banked === null ? material : carriedRows),
                    goalIfReleased: offerAsk(run, offer, 0),
                })),
            };
        }
        return {
            active: true,
            phase: run.phase,
            switching: this._switching === run,
            seed: run.seed,
            stopIndex: run.stopIndex,
            stopCount: run.road.stops.length,
            keeper: Boolean(run.road.stops[run.stopIndex]?.keeper),
            world: stop.world,
            climate: this._climateView(stop.climate),
            goal: { ...stop.goal, progress: stop.progress, text: goalText(stop.goal) },
            carriedRows: stop.carriedRows,
            carriedToll: stop.carriedToll,
            lastPayout: run.lastPayout,
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
