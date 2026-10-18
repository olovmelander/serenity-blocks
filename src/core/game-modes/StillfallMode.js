// @ts-check

/**
 * Stillfall: cascade puzzles on the Single Player board.
 *
 * The session is Single Player's (board scene, controls, effects, pause) with three rule
 * changes latched on its GameState: the supply is finite, gravity waits, and the board
 * draws a seam where two bodies meet. After each lock's cascade settles the mode judges
 * the puzzle's goal with the same rules the certifier uses (stillfall-sim.js) and
 * either deals the next piece or ends the puzzle. Nothing is scored or saved to Records.
 *
 * The mode stays headless: it publishes its state on EVENTS.STILLFALL_STATE and takes
 * undo / restart / hint / next / load from EVENTS.STILLFALL_COMMAND. The HUD
 * (ui/stillfall/stillfall-hud.js) draws one and sends the other.
 */

import { SinglePlayerMode } from './SinglePlayerMode.js';
import { GameState, restoreBoardState, spawnPiece } from '../game.js';
import {
    createBoardGrid, invalidateGhostCache, markBoardDirty, rebuildBoardGridFromPieces,
} from '../board.js';
import { GAME_MODES } from '../constants.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { piecePool } from '../../utils/object-pool.js';
import { buildPuzzle } from '../stillfall/stillfall-puzzle.js';
import {
    applyPlacement, boardFor, cellsOf, countCells, createRun, dealIntoView, failReason, judge, sameBoard,
    solutionPlacement,
} from '../stillfall/stillfall-sim.js';
import { solveFrom } from '../stillfall/stillfall-solver.js';
import { STILLFALL_PUZZLES, bankPuzzle } from '../stillfall/puzzle-bank.js';
import { stillfallProgress } from '../stillfall/stillfall-progress.js';

/** @typedef {import('../stillfall/stillfall-puzzle.js').StillfallPuzzle} StillfallPuzzle */
/** @typedef {import('../stillfall/stillfall-sim.js').StillfallPlacement} StillfallPlacement */
/** @typedef {import('../stillfall/stillfall-sim.js').StillfallRun} StillfallRun */

/**
 * The board between two pieces: everything undo needs to deal a piece again.
 * @typedef {Object} StillfallTurn
 * @property {Array<Object>} lockedPieces
 * @property {string[]} nextPieces the piece about to be dealt first
 * @property {number} pieceIdCounter
 * @property {number} lines
 * @property {number} bestWaves
 * @property {number} dealt
 */

/** @param {Array<Object>} pieces */
function clonePieces(pieces) {
    return pieces.map((piece) => ({ ...piece, shape: piece.shape.map((/** @type {number[]} */ row) => row.slice()) }));
}

export class StillfallMode extends SinglePlayerMode {
    constructor(dependencies) {
        super(dependencies);
        /** @type {StillfallPuzzle | null} */
        this.puzzle = null;
        /** @type {StillfallTurn[]} */
        this._turns = [];
        /** @type {'open'|'solved'|'failed'} */
        this._outcome = 'open';
        /** @type {'spent'|'blocked'|'relic-lost'|null} */
        this._reason = null;
        this._dealt = 0;
        this._bestWaves = 0;
        this._lockWaves = 0;
        this._firstSolve = false;
        this._hintShown = false;
        this._hintRestarted = false;
        /** @type {(() => void) | null} */
        this._stopCommands = null;
    }

    getModeId() {
        return GAME_MODES.STILLFALL;
    }

    getDisplayName() {
        return 'Stillfall';
    }

    async onActivate() {
        await super.onActivate();
        this._stopCommands?.();
        this._stopCommands = eventBus.on(EVENTS.STILLFALL_COMMAND, (command) => this._onCommand(command));
    }

    /** @param {Object} [options] */
    async onStart(options = {}) {
        await super.onStart(options);
        if (!this.isRunning || !this.puzzle) return;
        // Single Player deals the first piece after _dealSessionPieces; bring it into view.
        dealIntoView(this.gameState);
        this._publish();
    }

    async onDeactivate() {
        this._stopCommands?.();
        this._stopCommands = null;
        await super.onDeactivate();
        this.puzzle = null;
        eventBus.emit(EVENTS.STILLFALL_STATE, { active: false });
    }

    // ── Single Player session hooks ──

    /** @param {Object} options */
    _createSessionGameState(options) {
        const gameState = new GameState({
            ...options, finiteSupply: true, gravityWaits: true, disableLevelProgression: true,
        });
        gameState.showBodySeams = true;
        gameState.moveSummaryVocabulary = 'wave'; // the cascade banner counts waves, the panel's word
        return gameState;
    }

    _dealSessionPieces() {
        this._loadPuzzle(stillfallProgress.current(), { deal: false });
    }

    _recordsDemos() {
        return false;
    }

    _allowsFixedTick() {
        return false;
    }

    _getPhysicsCallbacks() {
        const callbacks = super._getPhysicsCallbacks();
        const { gameState } = this;
        return {
            ...callbacks,
            onPieceLock: (piece) => {
                this._dealt += 1;
                this._lockWaves = 0;
                this._clearHint();
                callbacks.onPieceLock(piece);
            },
            onLineClear: (lineCount, ...rest) => {
                this._lockWaves = Math.max(this._lockWaves, rest[3] ?? 1);
                callbacks.onLineClear(lineCount, ...rest);
            },
            // After the cascade settles: judge the goal, then deal on or stop.
            spawnPiece: () => {
                if (this.gameState === gameState) this._afterCascade();
            },
        };
    }

    /**
     * A dealt piece the structure blocks fails the puzzle; nothing is scored. spawnPiece
     * has marked the session over and left the blocked piece in hand: both are undone
     * here, because the game loop stops drawing on isGameOver and undo must still work.
     * The turn that could not deal is dropped, so undo returns to the piece before it.
     */
    async _handleGameOver() {
        const { gameState } = this;
        if (!gameState || !this.puzzle) return;
        gameState.isGameOver = false;
        if (gameState.currentPiece) {
            piecePool.release(gameState.currentPiece);
            gameState.currentPiece = null;
            invalidateGhostCache(gameState);
        }
        if (this._turns.length > 1) this._turns.pop();
        this._outcome = 'failed';
        this._reason = 'blocked';
        this.deps.soundManager?.sfxPlayer?.playPuzzleMiss?.();
        this._publish();
    }

    // ── Puzzle flow ──

    /**
     * @param {string} puzzleId
     * @param {{ deal?: boolean }} [options] deal: false leaves the first spawn to the caller
     */
    _loadPuzzle(puzzleId, { deal = true } = {}) {
        const definition = bankPuzzle(puzzleId) || STILLFALL_PUZZLES[0];
        this.puzzle = buildPuzzle(definition);
        stillfallProgress.choose(definition.id);
        if (this.gameState) {
            const { goal, bodyIds } = this.puzzle;
            this.gameState.relicPieceId = goal.type === 'relic-floor' ? bodyIds[/** @type {string} */ (goal.body)] : null;
        }
        this._turns = [];
        this._restoreTurn({
            lockedPieces: this.puzzle.lockedPieces,
            nextPieces: this.puzzle.supply,
            pieceIdCounter: this.puzzle.nextPieceId - 1,
            lines: 0,
            bestWaves: 0,
            dealt: 0,
        }, { deal });
    }

    /**
     * Puts the board back to the start of a turn and records it as the latest turn. The
     * piece in hand, if any, stays until the deal replaces it (spawnPiece returns it to
     * the pool).
     * @param {StillfallTurn} turn
     * @param {{ deal?: boolean }} [options]
     */
    _restoreTurn(turn, { deal = true } = {}) {
        const { gameState } = this;
        if (!gameState) return;
        const lockedPieces = clonePieces(turn.lockedPieces);
        restoreBoardState(gameState, {
            grid: rebuildBoardGridFromPieces(lockedPieces, createBoardGrid()),
            lockedPieces,
        }, { adoptBoard: true });
        gameState.hintCells = null;
        markBoardDirty(gameState);
        gameState.nextPieces = turn.nextPieces.slice();
        gameState._pieceIdCounter = turn.pieceIdCounter;
        gameState.lines = turn.lines;
        gameState.isGameOver = false;
        gameState.inputQueue = null;
        this._bestWaves = turn.bestWaves;
        this._dealt = turn.dealt;
        this._lockWaves = 0;
        this._outcome = 'open';
        this._reason = null;
        this._firstSolve = false;
        this._hintShown = false;
        this._hintRestarted = false;
        this._turns.push({ ...turn, lockedPieces: clonePieces(turn.lockedPieces), nextPieces: turn.nextPieces.slice() });
        if (deal) this._deal();
        else this._publish();
    }

    _deal() {
        const { gameState } = this;
        if (!gameState) return;
        spawnPiece(gameState, () => this._refreshNextQueue(), () => this._handleGameOver());
        if (this._outcome === 'failed') return; // the deal was blocked; _handleGameOver published
        dealIntoView(gameState);
        this._refreshNextQueue();
        this._publish();
    }

    /** The puzzle as the board stands now, in the certifier's terms. */
    _liveRun() {
        const { gameState, puzzle } = this;
        return /** @type {StillfallRun} */ ({
            puzzle,
            lockedPieces: gameState.lockedPieces,
            dealt: this._dealt,
            nextPieceId: gameState._pieceIdCounter + 1,
            lines: gameState.lines,
            bestWaves: this._bestWaves,
            outcome: 'open',
        });
    }

    _afterCascade() {
        const { gameState, puzzle } = this;
        if (!gameState || !puzzle || !this.isRunning) return;
        this._bestWaves = Math.max(this._bestWaves, this._lockWaves);
        const run = this._liveRun();
        this._outcome = judge(run);
        if (this._outcome === 'solved') {
            this._firstSolve = stillfallProgress.markSolved(puzzle.id);
            this.deps.soundManager?.sfxPlayer?.playLevelUp?.();
            this._publish();
            return;
        }
        if (this._outcome === 'failed') {
            this._reason = failReason(run);
            this.deps.soundManager?.sfxPlayer?.playPuzzleMiss?.();
            this._publish();
            return;
        }
        this._turns.push({
            lockedPieces: clonePieces(gameState.lockedPieces),
            nextPieces: gameState.nextPieces.slice(),
            pieceIdCounter: gameState._pieceIdCounter,
            lines: gameState.lines,
            bestWaves: this._bestWaves,
            dealt: this._dealt,
        });
        this._deal();
    }

    /** Takes back the last piece placed: its turn starts again. */
    undo() {
        if (!this._canUndo()) return false;
        // Mid-turn, the current turn is the latest record: drop it and replay the one before.
        if (this._outcome === 'open') this._turns.pop();
        const turn = /** @type {StillfallTurn} */ (this._turns.pop());
        this._restoreTurn(turn);
        this.deps.soundManager?.sfxPlayer?.playMove?.();
        return true;
    }

    restart() {
        if (!this.puzzle || this.gameState?.isProcessingPhysics) return false;
        const [first] = this._turns;
        if (!first) return false;
        this._turns = [];
        this._restoreTurn(first);
        this.deps.soundManager?.sfxPlayer?.playMove?.();
        return true;
    }

    /**
     * Lights a landing on the board: the stored solution's next step while the pieces
     * placed so far follow it, else the first step of any straight line on from here.
     * Only when no line on exists does the puzzle start over, and the state says so.
     */
    hint() {
        const { gameState, puzzle } = this;
        if (!gameState || !puzzle || puzzle.solution.length === 0 || gameState.isProcessingPhysics) return false;
        if (this._outcome === 'open') {
            let run = createRun(puzzle);
            let step = 0;
            for (; step < this._dealt; step += 1) {
                const placement = solutionPlacement(run, puzzle.solution[step]);
                if (!placement) break;
                ({ run } = applyPlacement(run, placement));
            }
            if (step === this._dealt && sameBoard(boardFor(run.lockedPieces), gameState.boardGrid)) {
                const placement = solutionPlacement(run, puzzle.solution[step]);
                if (placement) return this._showHint(placement, false);
            }
            const line = solveFrom(this._liveRun());
            if (line?.length) return this._showHint(line[0], false);
        }
        const first = solutionPlacement(createRun(puzzle), puzzle.solution[0]);
        if (!first || !this.restart()) return false;
        return this._showHint(first, true);
    }

    /**
     * @param {StillfallPlacement} placement
     * @param {boolean} restarted
     */
    _showHint(placement, restarted) {
        const { gameState } = this;
        if (!gameState) return false;
        gameState.hintCells = cellsOf(placement);
        markBoardDirty(gameState);
        this._hintShown = true;
        this._hintRestarted = restarted;
        this._publish();
        return true;
    }

    /** A hint is for one piece: once it lands, the next piece may ask again. */
    _clearHint() {
        this._hintShown = false;
        this._hintRestarted = false;
        const { gameState } = this;
        if (!gameState?.hintCells) return;
        gameState.hintCells = null;
        markBoardDirty(gameState);
    }

    _canUndo() {
        const { gameState } = this;
        if (!gameState || !this.puzzle || gameState.isProcessingPhysics) return false;
        return this._outcome === 'open' ? this._turns.length > 1 : this._turns.length > 0;
    }

    /** @param {{ type?: string, puzzleId?: string }} command */
    _onCommand(command) {
        if (!this.isRunning || this.isPaused || !this.gameState || this.gameState.isProcessingPhysics) return;
        const type = command?.type;
        if (type === 'undo') this.undo();
        else if (type === 'restart') this.restart();
        else if (type === 'hint') this.hint();
        else if (type === 'load' && command.puzzleId && stillfallProgress.openIds().has(command.puzzleId)) {
            this._loadPuzzle(command.puzzleId);
        } else if (type === 'next' && this.puzzle) {
            const next = stillfallProgress.after(this.puzzle.id);
            if (next) this._loadPuzzle(next);
        } else if (type === 'refresh') this._publish();
    }

    /** What the HUD shows. */
    getPuzzleState() {
        const { puzzle, gameState } = this;
        if (!puzzle || !gameState) return { active: false };
        const solved = new Set(stillfallProgress.solvedIds());
        const open = stillfallProgress.openIds();
        const inHand = gameState.currentPiece?.shapeKey || null;
        return {
            active: true,
            puzzle: {
                id: puzzle.id,
                title: puzzle.title,
                lesson: puzzle.lesson,
                goal: { ...puzzle.goal },
                supply: puzzle.supply.slice(),
            },
            dealt: this._dealt,
            inHand,
            remaining: [inHand, ...gameState.nextPieces].filter(Boolean),
            lines: gameState.lines,
            bestWaves: this._bestWaves,
            cellsLeft: countCells(gameState.lockedPieces),
            outcome: this._outcome,
            reason: this._outcome === 'failed' ? this._reason : null,
            firstSolve: this._outcome === 'solved' && this._firstSolve,
            canUndo: this._canUndo(),
            canHint: puzzle.solution.length > 0,
            hintShown: this._hintShown,
            hintRestarted: this._hintRestarted,
            next: stillfallProgress.after(puzzle.id),
            allSolved: stillfallProgress.allSolved(),
            bank: STILLFALL_PUZZLES.map((entry) => ({
                id: entry.id,
                title: entry.title,
                tier: entry.tier,
                open: open.has(entry.id),
                solved: solved.has(entry.id),
            })),
        };
    }

    _publish() {
        eventBus.emit(EVENTS.STILLFALL_STATE, this.getPuzzleState());
    }
}
