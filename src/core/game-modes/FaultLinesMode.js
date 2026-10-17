// @ts-check

/**
 * Fault Lines: cascade puzzles on the Single Player board.
 *
 * The session is Single Player's (board scene, controls, effects, pause) with three rule
 * changes latched on its GameState: the supply is finite, gravity waits, and the board
 * draws a seam where two bodies meet. After each lock's cascade settles the mode judges
 * the puzzle's goal with the same rules the certifier uses (fault-lines-sim.js) and
 * either deals the next piece or ends the puzzle. Nothing is scored or saved to Records.
 *
 * The mode stays headless: it publishes its state on EVENTS.FAULT_LINES_STATE and takes
 * undo / restart / next / load from EVENTS.FAULT_LINES_COMMAND. The HUD
 * (ui/fault-lines/fault-lines-hud.js) draws one and sends the other.
 */

import { SinglePlayerMode } from './SinglePlayerMode.js';
import { GameState, restoreBoardState, spawnPiece } from '../game.js';
import { createBoardGrid, markBoardDirty, rebuildBoardGridFromPieces } from '../board.js';
import { GAME_MODES } from '../constants.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { buildPuzzle } from '../fault-lines/fault-lines-puzzle.js';
import { dealIntoView, judge } from '../fault-lines/fault-lines-sim.js';
import { FAULT_LINES_PUZZLES, bankPuzzle } from '../fault-lines/puzzle-bank.js';
import { faultLinesProgress } from '../fault-lines/fault-lines-progress.js';

/** @typedef {import('../fault-lines/fault-lines-puzzle.js').FaultLinesPuzzle} FaultLinesPuzzle */

/**
 * The board between two pieces: everything undo needs to deal a piece again.
 * @typedef {Object} FaultLinesTurn
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

export class FaultLinesMode extends SinglePlayerMode {
    constructor(dependencies) {
        super(dependencies);
        /** @type {FaultLinesPuzzle | null} */
        this.puzzle = null;
        /** @type {FaultLinesTurn[]} */
        this._turns = [];
        /** @type {'open'|'solved'|'failed'} */
        this._outcome = 'open';
        this._dealt = 0;
        this._bestWaves = 0;
        this._lockWaves = 0;
        this._firstSolve = false;
        /** @type {(() => void) | null} */
        this._stopCommands = null;
    }

    getModeId() {
        return GAME_MODES.FAULT_LINES;
    }

    getDisplayName() {
        return 'Fault Lines';
    }

    async onActivate() {
        await super.onActivate();
        this._stopCommands?.();
        this._stopCommands = eventBus.on(EVENTS.FAULT_LINES_COMMAND, (command) => this._onCommand(command));
    }

    /** @param {Object} [options] */
    async onStart(options = {}) {
        await super.onStart(options);
        // Single Player deals the first piece after _dealSessionPieces; bring it into view.
        if (this.isRunning && this.puzzle) {
            dealIntoView(this.gameState);
            this._publish();
        }
    }

    async onDeactivate() {
        this._stopCommands?.();
        this._stopCommands = null;
        await super.onDeactivate();
        this.puzzle = null;
        eventBus.emit(EVENTS.FAULT_LINES_STATE, { active: false });
    }

    // ── Single Player session hooks ──

    /** @param {Object} options */
    _createSessionGameState(options) {
        const gameState = new GameState({ ...options, finiteSupply: true, gravityWaits: true });
        gameState.showBodySeams = true;
        return gameState;
    }

    _dealSessionPieces() {
        this._loadPuzzle(faultLinesProgress.current(), { deal: false });
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
     * A spawn the structure blocks ends the puzzle; nothing is scored. The turn that
     * could not deal is dropped, so undo returns to the piece before it.
     */
    async _handleGameOver() {
        if (!this.gameState || !this.puzzle) return;
        if (this._turns.length > 1) this._turns.pop();
        this._outcome = 'failed';
        this._publish();
    }

    // ── Puzzle flow ──

    /**
     * @param {string} puzzleId
     * @param {{ deal?: boolean }} [options] deal: false leaves the first spawn to the caller
     */
    _loadPuzzle(puzzleId, { deal = true } = {}) {
        const definition = bankPuzzle(puzzleId) || FAULT_LINES_PUZZLES[0];
        this.puzzle = buildPuzzle(definition);
        faultLinesProgress.choose(definition.id);
        if (this.gameState) {
            const { goal, bodyIds } = this.puzzle;
            this.gameState.relicPieceId = goal.type === 'relic-floor' ? bodyIds[/** @type {string} */ (goal.body)] : null;
        }
        this._turns = [];
        this._firstSolve = false;
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
     * Puts the board back to the start of a turn and records it as the latest turn.
     * @param {FaultLinesTurn} turn
     * @param {{ deal?: boolean }} [options]
     */
    _restoreTurn(turn, { deal = true } = {}) {
        const { gameState } = this;
        if (!gameState) return;
        const lockedPieces = clonePieces(turn.lockedPieces);
        restoreBoardState(gameState, {
            grid: rebuildBoardGridFromPieces(lockedPieces, createBoardGrid()),
            lockedPieces,
            currentPiece: null,
        }, { adoptBoard: true });
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
        this._turns.push({ ...turn, lockedPieces: clonePieces(turn.lockedPieces), nextPieces: turn.nextPieces.slice() });
        if (deal) this._deal();
        else this._publish();
    }

    _deal() {
        const { gameState } = this;
        if (!gameState) return;
        spawnPiece(gameState, () => this._refreshNextQueue(), () => this._handleGameOver());
        dealIntoView(gameState);
        this._refreshNextQueue();
        this._publish();
    }

    _afterCascade() {
        const { gameState, puzzle } = this;
        if (!gameState || !puzzle || !this.isRunning) return;
        this._bestWaves = Math.max(this._bestWaves, this._lockWaves);
        this._outcome = judge({
            puzzle,
            lockedPieces: gameState.lockedPieces,
            dealt: this._dealt,
            nextPieceId: gameState._pieceIdCounter + 1,
            lines: gameState.lines,
            bestWaves: this._bestWaves,
            outcome: 'open',
        });
        if (this._outcome === 'solved') {
            this._firstSolve = faultLinesProgress.markSolved(puzzle.id);
            this._publish();
            return;
        }
        if (this._outcome === 'failed') {
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
        const turn = /** @type {FaultLinesTurn} */ (this._turns.pop());
        this._restoreTurn(turn);
        return true;
    }

    restart() {
        if (!this.puzzle || this.gameState?.isProcessingPhysics) return false;
        const [first] = this._turns;
        if (!first) return false;
        this._turns = [];
        this._restoreTurn(first);
        return true;
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
        else if (type === 'load' && command.puzzleId && faultLinesProgress.openIds().has(command.puzzleId)) {
            this._loadPuzzle(command.puzzleId);
        } else if (type === 'next' && this.puzzle) {
            const next = faultLinesProgress.after(this.puzzle.id);
            if (next) this._loadPuzzle(next);
        } else if (type === 'refresh') this._publish();
    }

    /** What the HUD shows. */
    getPuzzleState() {
        const { puzzle, gameState } = this;
        if (!puzzle || !gameState) return { active: false };
        const solved = new Set(faultLinesProgress.solvedIds());
        const open = faultLinesProgress.openIds();
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
            outcome: this._outcome,
            firstSolve: this._firstSolve,
            canUndo: this._canUndo(),
            next: faultLinesProgress.after(puzzle.id),
            bank: FAULT_LINES_PUZZLES.map((entry) => ({
                id: entry.id,
                title: entry.title,
                tier: entry.tier,
                open: open.has(entry.id),
                solved: solved.has(entry.id),
            })),
        };
    }

    _publish() {
        eventBus.emit(EVENTS.FAULT_LINES_STATE, this.getPuzzleState());
    }
}
