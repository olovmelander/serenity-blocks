import {
    GameState, applyGarbage, fillBag, hardDrop, move, rotate, softDrop, spawnPiece, updateGame,
} from '../game.js';
import { MultiPlayerState } from '../multi-player-state.js';
import { PuzzleBotController } from '../ai/puzzle-bot-controller.js';
import { bindLegacySessionRng } from '../session-rng.js';
import { seededRandom } from '../../utils/helpers.js';
import { fenceOdysseyPhysicsCallbacks } from './odyssey-level-session.js';

/** A two-board match driven by Odyssey's existing FrameRateController. No DOM or timer ownership. */
export class OdysseyBotMatch {
    constructor(session, {
        seed, isActive, onRoundStart = () => {}, onPieceSpawn = () => {}, onAttack = () => {},
    }) {
        this.session = session;
        this.isActive = isActive;
        this.onRoundStart = onRoundStart;
        this.onPieceSpawn = onPieceSpawn;
        this.seed = seed;
        this.stopped = false;
        this.paused = false;
        this.round = 1;
        this.roundGeneration = 1;
        this.roundActive = true;
        this.transition = null;
        this.intermissionMs = 0;
        this.pendingDeaths = new Set();
        this.deathAttackers = new Map();
        this.botTimeMs = 0;
        this.completedScore = 0;
        this.presentation = {};
        this.visualCallbacks = [{}, {}];
        this.targetFrags = session.levelConfig.mechanics.versus.fragsToWin;
        this.difficulty = session.levelConfig.mechanics.versus.botDifficulty;
        this.botName = session.levelConfig.mechanics.versus.botName || 'Challenger';

        this.multiplayer = new MultiPlayerState(2);
        const human = session.gameState;
        const bot = new GameState({ disableLevelProgression: true });
        this.multiplayer.players = [human, bot];
        this.multiplayer.matchConfig = {
            ...this.multiplayer.matchConfig,
            endCondition: 'frags',
            endConditionValue: this.targetFrags,
            levelProgression: false,
        };
        this.multiplayer.onAttack = onAttack;
        this.players = this.multiplayer.players;
        this.players.forEach((state, index) => this._configurePlayer(state, index, seed));
        this.botCallbacks = this._callbacksFor(1);
        this.bot = new PuzzleBotController({
            playerIndex: 1,
            playerState: bot,
            difficulty: this.difficulty,
            rng: seededRandom((seed ^ 0x85ebca6b) >>> 0),
            actions: {
                moveLeft: () => this._moveBot(-1),
                moveRight: () => this._moveBot(1),
                rotateLeft: () => this._rotateBot('left'),
                rotateRight: () => this._rotateBot('right'),
                rotateFlip: () => this._rotateBot('flip'),
                softDrop: () => softDrop(bot, null, this.botCallbacks),
                hardDrop: () => {
                    if (!bot.currentPiece) return false;
                    hardDrop(bot, null, this.botCallbacks);
                    return true;
                },
            },
        });
    }

    _configurePlayer(state, index, seed) {
        const { speed } = this.session.levelConfig.mechanics;
        state.disableGarbage = false;
        state.disableLevelProgression = true;
        state.level = speed.startLevel || 1;
        state.dropInterval = speed.fixedDropInterval || 1000;
        state.suppressExternalInput = index === 1;
        state.isPaused = this.paused;
        bindLegacySessionRng(state, seed);
    }

    prepareBot() {
        const bot = this.players[1];
        fillBag(bot.nextPieces, bot.randomGenerator);
        spawnPiece(bot, null, () => this.markTopOut(1));
    }

    /** Inject visual-only observers; the match retains all gameplay ownership. */
    setPresentation(presentation) {
        this.presentation = presentation;
        this._refreshVisualCallbacks();
    }

    _refreshVisualCallbacks() {
        this.visualCallbacks = [
            this.presentation.getHumanCallbacks?.() || {},
            this.presentation.getBotCallbacks?.() || {},
        ];
        this.botCallbacks = this._callbacksFor(1, this.visualCallbacks[1]);
    }

    _callVisual(index, name, ...args) {
        if (this.stopped || !this.isActive() || !this.roundActive) return;
        this.visualCallbacks[index]?.[name]?.(...args);
    }

    _moveBot(direction) {
        const accepted = move(this.players[1], direction);
        if (accepted) this.botCallbacks.onMove?.(direction);
        return accepted;
    }

    _rotateBot(direction) {
        const accepted = rotate(this.players[1], direction);
        if (accepted) this.botCallbacks.onRotate?.(direction);
        return accepted;
    }

    _ownsRound(generation) {
        return !this.stopped && this.isActive() && this.roundActive
            && this.roundGeneration === generation && !this.multiplayer.isGameOver;
    }

    _callbacksFor(index, base = {}) {
        const generation = this.roundGeneration;
        return fenceOdysseyPhysicsCallbacks({
            ...base,
            onGarbageReady: (summary) => this.multiplayer.handleGarbageSummary(index, summary),
            spawnPiece: () => this._spawnWithGarbage(index),
        }, () => this._ownsRound(generation));
    }

    wrapHumanCallbacks(callbacks) {
        return this._callbacksFor(0, callbacks);
    }

    _spawnWithGarbage(index) {
        const state = this.players[index];
        if (state.isGameOver) return;
        const queue = this.multiplayer.garbageQueues[index];
        const entries = [];
        let burst = queue.dequeueLineBurst();
        while (burst.length) {
            entries.push(...burst);
            burst = queue.dequeueLineBurst();
        }
        if (entries.length) {
            const result = applyGarbage(state, entries);
            if (result?.topOut) {
                this.markTopOut(index);
                return;
            }
            this._callVisual(index, 'onGarbageApplied', entries.length);
        }
        spawnPiece(state, index === 0 ? this.onPieceSpawn : null, () => this.markTopOut(index));
    }

    markTopOut(index) {
        if (!this._ownsRound(this.roundGeneration) || !this.players[index]?.isAlive) return;
        if (!this.pendingDeaths.has(index)) {
            this.deathAttackers.set(index, this.multiplayer.lastAttackerIds[index]);
            this._callVisual(index, 'onTopOut');
        }
        this.players[index].isGameOver = true;
        this.pendingDeaths.add(index);
        // Stop new input immediately. In-flight cascades can still finish at the barrier.
        this.players.forEach((state) => { state.isPaused = true; });
    }

    update(time, deltaMs, humanCallbacks, playDropCallback) {
        if (this.stopped || !this.isActive() || this.paused || this.multiplayer.isGameOver) return;
        if (this.transition) return;
        const delta = Math.max(0, Math.min(50, Number(deltaMs) || 0));
        if (this.intermissionMs > 0) {
            this.intermissionMs = Math.max(0, this.intermissionMs - delta);
            if (this.intermissionMs === 0) this._startNextRound(time);
            return;
        }
        if (this.pendingDeaths.size) {
            this._beginRoundBarrier();
            return;
        }
        this.botTimeMs += delta;
        updateGame(time, this.players[0], { physicsCallbacks: humanCallbacks, playDropCallback });
        updateGame(time, this.players[1], { physicsCallbacks: this.botCallbacks });
        this.bot.update(delta, this.botTimeMs);
        if (this.pendingDeaths.size) this._beginRoundBarrier();
    }

    _beginRoundBarrier() {
        if (this.transition) return;
        this.players.forEach((state) => { state.isPaused = true; });
        const promises = this.players.map((state) => state.latestPhysicsPromise);
        this.transition = Promise.allSettled(promises).then((results) => {
            if (this.stopped || !this.isActive()) return;
            const failed = results.find((result) => result.status === 'rejected');
            if (failed) throw failed.reason;
            this.players.forEach((state, index) => {
                if (state.isGameOver && !this.pendingDeaths.has(index)) {
                    this.pendingDeaths.add(index);
                    this.deathAttackers.set(index, this.multiplayer.lastAttackerIds[index]);
                }
            });
            this.pendingDeaths.forEach((index) => {
                this.multiplayer.lastAttackerIds[index] = this.deathAttackers.get(index);
            });
            const previousFrags = [...this.multiplayer.frags];
            this.multiplayer.handlePlayerDeaths([...this.pendingDeaths]);
            this.multiplayer.frags.forEach((frags, index) => {
                if (frags > previousFrags[index]) this._callVisual(index, 'onRoundWin');
            });
            if (this.multiplayer.winner !== null) this._callVisual(this.multiplayer.winner, 'onVictory');
            this.roundActive = false;
            this.roundGeneration++;
            this.pendingDeaths.clear();
            this.deathAttackers.clear();
            this.completedScore += this.players[0].score;
            this.syncMetrics();
            this.bot.reset();
            if (!this.multiplayer.isGameOver) this.intermissionMs = 900;
        }).catch((error) => {
            if (!this.stopped && this.isActive()) {
                this.error = error;
                this.stop();
            }
        }).finally(() => { this.transition = null; });
    }

    _startNextRound(time) {
        this.round++;
        this.roundActive = true;
        const seed = (this.seed + Math.imul(this.round - 1, 0x9e3779b9)) >>> 0;
        this.players.forEach((state, index) => {
            state.reset();
            this._configurePlayer(state, index, seed);
            state.lastTime = time;
            this.multiplayer.garbageQueues[index].clear();
            this.multiplayer.lastAttackerIds[index] = null;
            fillBag(state.nextPieces, state.randomGenerator);
            spawnPiece(state, null, () => this.markTopOut(index));
        });
        this.session.physicsCallbacks = null;
        this.onRoundStart();
        this._refreshVisualCallbacks();
    }

    setPaused(paused, time) {
        this.paused = paused;
        this.players.forEach((state) => {
            state.isPaused = paused || !!this.transition || this.intermissionMs > 0;
            state.lastTime = time;
        });
    }

    syncMetrics() {
        this.session.hybridEngine.updateDuel({
            frags: this.multiplayer.frags[0],
            opponentFrags: this.multiplayer.frags[1],
            deaths: this.multiplayer.deaths[0],
        });
    }

    get score() {
        return this.completedScore + (this.roundActive ? this.players[0].score : 0);
    }

    getSnapshot() {
        return {
            targetFrags: this.targetFrags,
            difficulty: this.difficulty,
            playerFrags: this.multiplayer.frags[0],
            botName: this.botName,
            botFrags: this.multiplayer.frags[1],
            deaths: this.multiplayer.deaths[0],
            round: this.round,
            paused: this.paused,
            intermission: this.intermissionMs > 0 || !!this.transition,
            playerPendingGarbage: this.multiplayer.garbageQueues[0].getTotalLines(),
            botPendingGarbage: this.multiplayer.garbageQueues[1].getTotalLines(),
            botGrid: this.players[1].boardGrid,
            botCurrentPiece: this.players[1].currentPiece,
            botNextPieces: this.players[1].nextPieces,
        };
    }

    getResult() {
        const {
            botGrid, botCurrentPiece, botNextPieces, ...result
        } = this.getSnapshot();
        return result;
    }

    stop() {
        this.stopped = true;
        this.roundActive = false;
        this.roundGeneration++;
        this.bot.reset();
        this.players.forEach((state) => { state.isStopped = true; });
    }
}
