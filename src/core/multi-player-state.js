/**
 * @fileoverview Multi-player game state for 2-4 player local multiplayer
 * Manages N independent game states with garbage interaction
 *
 * This replaces MultiplayerGameState for scalable local multiplayer
 */

import { GameState } from './game.js';
import {
    GarbageQueue, GarbageAttack, calculateGarbage, versusAttackRules,
    applyHandicap, accumulateHandicapStamps,
} from './garbage.js';
import { ROWS } from './constants.js';
import { clearBlind } from './blind.js';
import { INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1 } from './infinity-spawn-policy.js';
import { applyMatchLevelRule } from './multiplayer/match-level-rule.js';
import {
    INFINITY_WELL_ROWS_DEFAULT, infinityWellOpeningRows, readInfinityWellRows,
} from './multiplayer/infinity-well-rule.js';
import {
    AttackCredit, forgetsSpentCredit, respawnVersusBoard, stepCrowdStamps, takeCrowdCut,
} from './multiplayer/versus-rules.js';
import {
    countHolderRows, createHotPotatoState, isHotPotatoConfig, potatoRoute, stepHotPotato,
} from './multiplayer/hot-potato.js';
import { seededRandom } from '../utils/helpers.js';

/**
 * Player color scheme for visual distinction
 * Colors are vibrant, accessible, and easily distinguishable
 */
export const PLAYER_COLORS = [
    {
        primary: '#3B82F6', // Blue - Player 1
        light: '#60A5FA',
        glow: 'rgba(59, 130, 246, 0.5)',
        name: 'Blue',
    },
    {
        primary: '#EF4444', // Red - Player 2
        light: '#F87171',
        glow: 'rgba(239, 68, 68, 0.5)',
        name: 'Red',
    },
    {
        primary: '#10B981', // Green - Player 3
        light: '#34D399',
        glow: 'rgba(16, 185, 129, 0.5)',
        name: 'Green',
    },
    {
        primary: '#F59E0B', // Amber/Orange - Player 4
        light: '#FBBF24',
        glow: 'rgba(245, 158, 11, 0.5)',
        name: 'Amber',
    },
];

/**
 * Team colors are the SAME palette indexed by team id: Team A=0 Blue, B=1 Red,
 * C=2 Green, D=3 Amber. Exported under a team-centric name so the local match
 * config modal and the engine share ONE source of truth — when two players are
 * on the same team they resolve to the same color object, and the setup card,
 * board border, HUD dot and garbage all align by construction.
 */
export const TEAM_COLORS = PLAYER_COLORS;

/**
 * Multi-player game state that manages 2-4 players
 */
export class MultiPlayerState {
    /**
     * @param {number} [numPlayers]
     * @param {{ maxPendingLines?: number }} [options] maxPendingLines: most rows that may wait
     *   for one player (local versus: VERSUS_MAX_PENDING_LINES; Odyssey duels keep no limit).
     */
    constructor(numPlayers = 2, { maxPendingLines = Infinity } = {}) {
        this.numPlayers = numPlayers;

        // Player game states (array-based for scalability)
        this.players = [];
        this.garbageQueues = [];
        this.playerColors = []; // Store player color assignments

        for (let i = 0; i < numPlayers; i++) {
            this.players.push(new GameState());
            this.garbageQueues.push(new GarbageQueue({ maxLines: maxPendingLines }));
        }

        // Match configuration (set by LocalMultiplayerMode)
        this.matchConfig = {
            endCondition: 'frags',
            endConditionValue: 7,
            startLevel: 1,
            levelProgression: false,
            boringRules: false,
            isTeamMode: false,
            playerTeams: [],
            infinityMaxRows: INFINITY_WELL_ROWS_DEFAULT,
        };

        this._assignPlayerColors();

        // Match state
        this.isGameOver = false;
        this.isPaused = false;
        this.winner = null; // Player index (0-3) or null
        this.matchStartTime = 0;

        // Frag tracking (kills) and deaths tracking
        this.frags = new Array(numPlayers).fill(0);
        this.deaths = new Array(numPlayers).fill(0); // Deaths per player
        // Who gets the frag if each player dies: kept by attackCredit (versus-rules.js) and
        // mirrored here, where the round logic reads it.
        this.lastAttackerIds = new Array(numPlayers).fill(null);
        this.attackCredit = Array.from({ length: numPlayers }, () => new AttackCredit());
        // Crowd stamps: with more than four players alive they shrink each player's attacks.
        this.crowdStamps = new Array(numPlayers).fill(0);
        // Presentation listener: (attackerIndex, targetIndices, lines) for each attack that
        // sends garbage (local versus draws it between the boards). Never alters the sim.
        this.onAttack = null;

        // Timing (shared between players)
        this.lastTime = 0;
        this.animationId = null;

        // Attack sequencing per player for deterministic IDs
        this.attackSequences = new Array(numPlayers).fill(0);

        // Per-player pause state for infinity minimap exploration
        this.playerPaused = new Array(numPlayers).fill(false);

        // Shared RNG seed for fairness (set by mode)
        this.sharedPieceSeed = 0;
        this.rngDescriptor = null;

        // Per-round extended stats; LocalMultiplayerMode folds these into
        // cumulative match stats between rounds.
        this.playerMetrics = this._createPlayerMetrics();

        // Hot potato (multiplayer/hot-potato.js). Disabled unless the match config plays it.
        this.hotPotato = createHotPotatoState(false);
        // Randomness for the potato's turn order (tests pin it).
        // The order is drawn from the match seed (updateHotPotato), so a match can be replayed.
        this.potatoRandom = null;
        // Presentation listener: each potato event ({type: 'take'|'pass', team, ...}). Never
        // alters the sim.
        this.onPotatoEvent = null;
    }

    /**
     * Set match configuration
     */
    setMatchConfig(config) {
        // The well height (infinity-well-rule.js): 40 to 1,000 rows, 100 when none is given.
        const infinityMaxRows = readInfinityWellRows(config?.infinityMaxRows);

        this.matchConfig = {
            ...this.matchConfig,
            ...config,
            infinityMaxRows,
        };
        this._assignPlayerColors();
        this._resetHotPotatoState();
    }

    _createEmptyMetrics() {
        return {
            attacksSent: 0,
            attackLinesSent: 0,
            attacksReceived: 0,
            attackLinesReceived: 0,
            cleanLinesSent: 0,
            cleanLinesReceived: 0,
            maxCombo: 0,
            maxComboDepth: 0,
            maxComboComplexity: 0,
            potatoPasses: 0,
            potatoRowsSent: 0,
        };
    }

    _createPlayerMetrics() {
        return Array.from({ length: this.numPlayers }, () => this._createEmptyMetrics());
    }

    _resetPlayerMetrics() {
        this.playerMetrics = this._createPlayerMetrics();
    }

    getPlayerMetrics(playerIndex) {
        return this.playerMetrics[playerIndex] || this._createEmptyMetrics();
    }

    _isHotPotatoEnabled() {
        return isHotPotatoConfig(this.matchConfig);
    }

    /** A fresh potato: nobody holds it, the first holder is chosen two seconds in. */
    _resetHotPotatoState() {
        this.hotPotato = createHotPotatoState(this._isHotPotatoEnabled());
    }

    /**
     * The potato's team of a player: its team in a team match, else the player alone.
     * @param {number} playerIndex
     * @returns {string}
     */
    potatoTeamOf(playerIndex) {
        const team = this.matchConfig?.isTeamMode
            ? (this.matchConfig?.playerTeams?.[playerIndex] ?? playerIndex)
            : playerIndex;
        return String(team);
    }

    /** @returns {Array<{ key: string, alive: boolean }>} every team, with whether it has a living player */
    _potatoTeams() {
        /** @type {Map<string, boolean>} */
        const teams = new Map();
        this.players.forEach((player, index) => {
            const key = this.potatoTeamOf(index);
            teams.set(key, (teams.get(key) || false) || player?.isAlive === true);
        });
        return Array.from(teams, ([key, alive]) => ({ key, alive }));
    }

    /**
     * The potato as the HUD shows it: the holding team's players, its rows sent and its target.
     * @returns {{ enabled: boolean, holderTeam: string|null, holderIndices: number[], sent: number, target: number }}
     */
    getHotPotatoState() {
        const state = this.hotPotato || createHotPotatoState(false);
        const holderIndices = state.holder === null ? [] : this.players
            .map((_, index) => index)
            .filter((index) => this.potatoTeamOf(index) === state.holder);
        return {
            enabled: state.enabled,
            holderTeam: state.holder,
            holderIndices,
            sent: state.sent,
            target: state.target,
        };
    }

    /**
     * Run the potato's clock by `dtMs` of game time (the match loop calls this each step while
     * the match runs, so a pause or the countdown never counts).
     * @param {number} dtMs
     * @returns {Object|null} the potato event ('take' or 'pass'), if one happened
     */
    updateHotPotato(dtMs) {
        if (!this.hotPotato?.enabled || this.isGameOver) return null;
        this.potatoRandom ??= Number.isFinite(this.sharedPieceSeed)
            ? seededRandom((this.sharedPieceSeed ^ 0x6d2b79f5) >>> 0) : Math.random;
        const event = stepHotPotato(this.hotPotato, dtMs, this._potatoTeams(), this.potatoRandom);
        if (event?.type === 'pass') this._potatoPassed(event);
        if (event) this.onPotatoEvent?.(event);
        return event;
    }

    /**
     * A team got rid of the potato: its players' waiting garbage is dropped and their hidden
     * cells show.
     * @param {{ team: string }} event
     */
    _potatoPassed(event) {
        this.players.forEach((player, index) => {
            if (this.potatoTeamOf(index) !== event.team) return;
            this.garbageQueues[index]?.clear();
            clearBlind(player);
        });
    }

    _recordCascadeMetrics(playerIndex, summary = {}) {
        const metrics = this.playerMetrics[playerIndex];
        if (!metrics) return;

        const depth = summary.depth ?? summary.totalLines ?? 0;
        const complexity = summary.complexity ?? summary.comboStages ?? 0;
        metrics.maxCombo = Math.max(metrics.maxCombo, complexity);
        metrics.maxComboDepth = Math.max(metrics.maxComboDepth, depth);
        metrics.maxComboComplexity = Math.max(metrics.maxComboComplexity, complexity);
    }

    _recordOutgoingAttack(playerIndex, { lines = 0, cleanLines = 0, countAttack = false } = {}) {
        const metrics = this.playerMetrics[playerIndex];
        if (!metrics) return;
        if (countAttack) metrics.attacksSent++;
        metrics.attackLinesSent += Math.max(0, lines);
        metrics.cleanLinesSent += Math.max(0, cleanLines);
    }

    _recordIncomingAttack(playerIndex, { lines = 0, cleanLines = 0, countAttack = false } = {}) {
        const metrics = this.playerMetrics[playerIndex];
        if (!metrics) return;
        if (countAttack) metrics.attacksReceived++;
        metrics.attackLinesReceived += Math.max(0, lines);
        metrics.cleanLinesReceived += Math.max(0, cleanLines);
    }

    /**
     * Apply per-player handicap levels (0-4) from match config.
     * Defaults every player to Intermediate (2) when not specified. Resets any
     * previously accumulated stamps. Call after players have been reset.
     * @param {Array<number>} [levels] - Handicap level per player index
     */
    setPlayerHandicaps(levels = []) {
        this.players.forEach((player, index) => {
            if (!player) return;
            const level = Number.isFinite(levels?.[index]) ? levels[index] : 2;
            player.handicap = Math.min(4, Math.max(0, level));
            player.handicaps = {};
        });
    }

    /**
     * Accumulate handicap stamps for one player against all opponents.
     * Intended to be called once per piece lock. No-op when handicap levels are
     * equal (the common case), so it is safe to call unconditionally.
     * @param {number} playerIndex
     */
    accumulateHandicap(playerIndex) {
        const player = this.players[playerIndex];
        if (!player) return;

        const opponents = {};
        this.players.forEach((other, index) => {
            if (index !== playerIndex && other) {
                opponents[index] = other;
            }
        });

        accumulateHandicapStamps(player, opponents);
    }

    /**
     * Everything one placed piece counts for in versus play: handicap stamps, a crowd stamp
     * (only while more than four players are alive), and fading the credit of whoever has
     * attacked this player. In free-for-all a holder whose credit has faded to nothing is
     * forgotten, so a player left alone for a while dies uncredited; survivor rounds and
     * Infinity's Last Standing keep the last holder. Call once per piece lock (local versus
     * only: Odyssey's duels never call it).
     * @param {number} playerIndex
     */
    notePiecePlaced(playerIndex) {
        if (!this.players[playerIndex]) return;
        this.accumulateHandicap(playerIndex);
        const alive = this.players.filter((state) => state?.isAlive).length;
        this.crowdStamps[playerIndex] = stepCrowdStamps(this.crowdStamps[playerIndex], alive);
        const credit = this.attackCredit[playerIndex];
        if (!credit) return;
        const forgetSpent = forgetsSpentCredit(this.matchConfig) && !this.matchConfig?.isInfinityLMS;
        credit.notePiecePlaced({ forgetSpent });
        this.lastAttackerIds[playerIndex] = credit.killer;
    }

    /**
     * Put a dead player back in play (free-for-all): an empty well at the match's start level
     * that keeps their score, lines and piece stream (respawnVersusBoard), no garbage waiting,
     * and no frag credit, crowd stamps or handicap stamps carried over. Frags and deaths stand.
     * @param {number} playerIndex
     * @returns {boolean} false when there is no such player or they are alive
     */
    respawnPlayer(playerIndex) {
        const player = this.players[playerIndex];
        if (!player || player.isAlive) return false;
        respawnVersusBoard(player, this.matchConfig);
        player.handicaps = {};
        this.garbageQueues[playerIndex]?.clear();
        this.attackCredit[playerIndex]?.reset();
        this.lastAttackerIds[playerIndex] = null;
        this.crowdStamps[playerIndex] = 0;
        this.playerPaused[playerIndex] = false;
        return true;
    }

    /**
     * An attack of `lines` rows from `attackerIndex` reached `targetIndex`.
     * @param {number} targetIndex
     * @param {number} attackerIndex
     * @param {number} lines
     */
    _noteAttack(targetIndex, attackerIndex, lines) {
        const credit = this.attackCredit[targetIndex];
        if (!credit) return;
        credit.noteAttack(attackerIndex, lines);
        this.lastAttackerIds[targetIndex] = credit.killer;
    }

    /**
     * Take the crowd cut off an attack's normal rows, spending the sender's crowd stamps.
     * A move that empties the board keeps its full size, and boring rules turn the cut off.
     * @param {number} playerIndex
     * @param {GarbageAttack} attack
     * @returns {GarbageAttack}
     */
    _applyCrowdCut(playerIndex, attack) {
        const normal = attack.holeMasks?.length || 0;
        const { lines, stamps } = takeCrowdCut(normal, this.crowdStamps[playerIndex], {
            clean: attack.sendForPerfectClear,
            boringRules: this.matchConfig?.boringRules,
        });
        this.crowdStamps[playerIndex] = stamps;
        if (lines >= normal) return attack;
        return GarbageAttack.fromJSON({
            ...attack.toJSON(),
            holeMasks: attack.holeMasks.slice(0, lines),
        }).withId(attack.id);
    }

    /**
     * Apply the per-opponent handicap to an attack for one target. Reduces the
     * number of normal garbage lines (clean lines bypass handicap) by consuming
     * the attacker's accumulated stamps for that opponent. Returns the original
     * attack unchanged when no reduction applies.
     * @param {GarbageAttack} attack - Base attack
     * @param {Object} attackerState - Sender GameState (holds handicap stamps)
     * @param {number} targetIndex - Opponent index, used as the stamp key
     * @returns {GarbageAttack}
     */
    _applyHandicapForTarget(attack, attackerState, targetIndex) {
        const normalCount = attack.holeMasks?.length || 0;
        if (!attackerState || normalCount === 0) {
            return attack;
        }

        const reduced = applyHandicap(normalCount, attackerState, targetIndex, false);
        if (reduced >= normalCount) {
            return attack;
        }

        return GarbageAttack.fromJSON({
            ...attack.toJSON(),
            holeMasks: attack.holeMasks.slice(0, reduced),
        }).withId(attack.id);
    }

    /**
     * Reset the game state
     */
    reset() {
        for (let i = 0; i < this.numPlayers; i++) {
            // Latch the board rules before reset creates the grid. Infinity
            // spawns follow board truth, independently of camera animation.
            const player = this.players[i];
            player.isInfinityMode = Boolean(this.matchConfig?.isInfinityLMS);
            if (player.isInfinityMode) {
                // A well shorter than the usual opening grid opens at its full height:
                // the grid can never be taller than the well the match chose.
                player.maxRows = readInfinityWellRows(this.matchConfig.infinityMaxRows);
                player.initialInfinityRows = infinityWellOpeningRows(player.maxRows);
                player.infinitySpawnPolicy = INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1;
                player.infinityVisibleRows = ROWS;
                player.infinitySpawnOffsetRows = 2;
            }
            this.players[i].reset();

            // Apply Infinity LMS configuration
            if (this.matchConfig?.isInfinityLMS) {
                // Enable infinity mode
                this.players[i].isInfinityMode = true;
                this.players[i].maxRows = readInfinityWellRows(this.matchConfig?.infinityMaxRows);
                this.players[i].disableLevelProgression = true;
                this.players[i].disableGarbage = false; // Keep garbage for multiplayer

                // reset() created the opening Infinity grid (44 rows, or a shorter well's all).
                const infinityGrid = this.players[i].boardGrid;

                // Initialize infinity stats
                this.players[i].infinityStats = {
                    blocksPlaced: 0,
                    maxCascadeScore: 0,
                    maxComboComplexity: 0,
                    maxComboDepth: 0,
                    totalCascades: 0,
                    rowsReached: infinityGrid.length,
                };

                // Camera tracking
                const startingCameraRow = Math.max(0, infinityGrid.length - ROWS);
                this.players[i].cameraRow = startingCameraRow;
                this.players[i].currentTopRow = startingCameraRow;

                console.log(`[MultiPlayerState] Player ${i + 1} initialized for Infinity LMS: ${infinityGrid.length} rows, max ${this.players[i].maxRows}`);
            } else if (this.matchConfig) {
                // The match's level rule (match-level-rule.js, shared with online play): the
                // starting level and its speed, and no levelling up unless the match turns it on.
                applyMatchLevelRule(this.players[i], this.matchConfig);
            }

            this.garbageQueues[i].clear();
            this.frags[i] = 0;
            this.deaths[i] = 0;
            this.lastAttackerIds[i] = null;
            this.attackCredit[i].reset();
            this.crowdStamps[i] = 0;
            this.playerPaused[i] = false;
        }

        this._assignPlayerColors();
        this._resetPlayerMetrics();

        this.isGameOver = false;
        this.isPaused = false;
        this.winner = null;
        this.lastTime = 0;
        this.sharedPieceSeed = 0;
        this.potatoRandom = null;
        this.rngDescriptor = null;
        this.matchStartTime = Date.now();
        // Each round starts a fresh potato; its first holder is chosen two seconds into play.
        this._resetHotPotatoState();
    }

    /**
     * Get player state by index
     */
    getPlayerState(playerIndex) {
        return this.players[playerIndex];
    }

    /**
     * Get opponent state by index (for 2 players only)
     * @deprecated Use getPlayerState with specific index instead
     */
    getOpponentState(playerIndex) {
        if (this.numPlayers !== 2) {
            console.warn('[MultiPlayerState] getOpponentState only works for 2 players');
            return null;
        }
        return this.players[playerIndex === 0 ? 1 : 0];
    }

    /**
     * Get garbage queue by index
     */
    getGarbageQueue(playerIndex) {
        return this.garbageQueues[playerIndex];
    }

    /**
     * Assign player colors based on match configuration
     */
    _assignPlayerColors() {
        // Color is always team-driven. Each player's team defaults to its own
        // index (P1=A, P2=B, P3=C, P4=D), so an all-distinct config reproduces
        // the classic per-player FFA colors with zero regression; players who
        // share a team resolve to the same color object.
        this.playerColors = this.players.map((_, index) => {
            const teamId = this.matchConfig?.playerTeams?.[index] ?? index;
            return TEAM_COLORS[teamId % TEAM_COLORS.length] || TEAM_COLORS[0];
        });
    }

    /**
     * Get player color scheme by index
     */
    getPlayerColor(playerIndex) {
        return this.playerColors[playerIndex] || PLAYER_COLORS[0];
    }

    /**
     * Handle garbage summary and route to opponents
     *
     * Every other living player (not a team mate) receives the whole attack, less the crowd
     * cut and the per-opponent handicap. What the attack's rows become depends on the attack
     * style (garbage.js ATTACK_TYPES: rows, blind pieces or a full blind). In a hot potato match
     * the potato decides where it goes (multiplayer/hot-potato.js).
     */
    handleGarbageSummary(playerIndex, summary, onGarbageSend) {
        // Attack ruleset from match config (standard/blind/full_blind/peaceful).
        const attackRules = this.matchConfig?.attackRules || null;
        this._recordCascadeMetrics(playerIndex, summary);

        // Peaceful preset: players never send garbage to each other.
        if (attackRules?.disableAttacks) {
            return;
        }

        const attack = calculateGarbage(summary, versusAttackRules(this.matchConfig));
        const attackerState = this.players[playerIndex];

        const sequence = typeof summary.sequence === 'number'
            ? summary.sequence
            : this.attackSequences[playerIndex]++;
        const attackId = `P${playerIndex + 1}-A${sequence}`;
        attack.withId(attackId);

        const unscaledLines = attack.getTotalLines();

        // Per-cascade traces are debug-level: production builds strip console.debug, and these
        // logged two or three lines for every cascade of a duel (Odyssey audit 2026-10-18).
        console.debug(
            `[MultiPlayerState] Player ${playerIndex + 1} cascade resolved → depth=${attack.depth}, combo=${attack.complexity}`,
        );

        // Full size until more than four players are alive (versus-rules.js, crowd cut).
        const scaledAttack = this._applyCrowdCut(playerIndex, attack);
        const totalLines = scaledAttack.getTotalLines();

        console.debug(
            `[MultiPlayerState]   Total attack rows: ${totalLines} (before the crowd cut ${unscaledLines})`,
        );

        if (totalLines <= 0) {
            return;
        }

        // Route garbage to all opponents
        let targets = this._getAttackTargets(playerIndex);

        if (this._isHotPotatoEnabled()) {
            const team = this.potatoTeamOf(playerIndex);
            const { route, holder } = potatoRoute(this.hotPotato, team);
            if (route === 'none') return;
            if (route === 'count') {
                // The holding team's attacks deal nothing: they count toward its target.
                const metrics = this.playerMetrics[playerIndex];
                if (metrics) metrics.potatoRowsSent += totalLines;
                this._recordOutgoingAttack(playerIndex, { countAttack: true });
                const passed = countHolderRows(this.hotPotato, team, totalLines);
                if (passed) {
                    if (metrics) metrics.potatoPasses++;
                    this._potatoPassed(passed);
                    this.onPotatoEvent?.(passed);
                }
                onGarbageSend?.(playerIndex, [], 0, { type: 'potato', passed: Boolean(passed) });
                return;
            }
            targets = targets.filter((index) => this.potatoTeamOf(index) === holder);
        }

        // Get attacker's color for garbage blocks. The garbage cell is stamped
        // with the attacker's (team) color so it renders in that color on the
        // victim board; the team field uses the raw team id (no 2-team clamp).
        const attackerColor = this.getPlayerColor(playerIndex);
        const resolvedTeamId = this.matchConfig?.isTeamMode
            ? (this.matchConfig?.playerTeams?.[playerIndex] ?? playerIndex)
            : null;

        const context = {
            color: attackerColor ? attackerColor.primary : '#808080',
            team: resolvedTeamId,
        };

        if (targets.length === 0) {
            console.log(`[MultiPlayerState] No valid targets for Player ${playerIndex + 1}`);
            return;
        }

        let countedOutgoingPacket = false;
        targets.forEach((targetIndex) => {
            const targetQueue = this.garbageQueues[targetIndex];

            // The per-opponent handicap reduces this attack's normal rows for stronger players;
            // entries are expanded per target so the reduction can differ per opponent.
            const targetAttack = this._applyHandicapForTarget(scaledAttack, attackerState, targetIndex);
            const entries = targetAttack.expandEntries(context);
            // The attack's rows, whatever they become (rows, blind pieces or a full blind).
            const rows = targetAttack.getTotalLines();
            const cleanLines = targetAttack.cleanMasks?.length || 0;

            if (entries.length > 0) {
                // Frag credit counts the rows sent, before the target's pending cap drops any.
                this._noteAttack(targetIndex, playerIndex, rows);
                this._recordOutgoingAttack(playerIndex, {
                    lines: rows,
                    cleanLines,
                    countAttack: !countedOutgoingPacket,
                });
                this._recordIncomingAttack(targetIndex, {
                    lines: rows,
                    cleanLines,
                    countAttack: true,
                });
                countedOutgoingPacket = true;
            }

            // Queued for the target's next spawn: rows go in then, blind entries wait for the
            // pieces they hide (blind.js takeSpawnBlinds).
            entries.forEach((entry) => {
                targetQueue.enqueue({
                    ...entry,
                    sourcePlayerId: playerIndex,
                    attackId,
                });
            });

            console.debug(
                `[MultiPlayerState] Player ${playerIndex + 1} → Player ${targetIndex + 1}: ${rows} rows`,
            );
        });

        this.onAttack?.(playerIndex, targets, totalLines);
        if (onGarbageSend) {
            onGarbageSend(playerIndex, targets, totalLines);
        }
    }

    /**
     * Determine attack targets for a player
     *
     * For 2 players: Always attack the other player
     * For 3-4 players: Attack all other alive players (evenly distributed)
     */
    _getAttackTargets(attackerIndex) {
        const targets = [];
        const attackerTeam = this.matchConfig.isTeamMode ? this.matchConfig.playerTeams[attackerIndex] : null;

        for (let i = 0; i < this.numPlayers; i++) {
            if (i !== attackerIndex && this.players[i].isAlive) {
                // In team mode, skip targets on the same team
                if (this.matchConfig.isTeamMode && this.matchConfig.playerTeams[i] === attackerTeam) {
                    continue;
                }
                targets.push(i);
            }
        }

        return targets;
    }

    /**
     * Whom a player's attack would reach now, and how: 'attack' deals it; with the hot potato,
     * 'count' adds it to the holding team's target and 'none' deals nothing.
     * @param {number} playerIndex
     * @returns {{ route: 'attack'|'count'|'none', targets: number[] }}
     */
    attackOutlook(playerIndex) {
        const targets = this._getAttackTargets(playerIndex);
        if (!this._isHotPotatoEnabled()) return { route: 'attack', targets };
        const { route, holder } = potatoRoute(this.hotPotato, this.potatoTeamOf(playerIndex));
        if (route !== 'holder') return { route, targets: [] };
        return { route: 'attack', targets: targets.filter((i) => this.potatoTeamOf(i) === holder) };
    }

    /** Whether an attack in this match sends garbage rows (not blind attacks, not peace). */
    sendsRows() {
        const rules = this.matchConfig?.attackRules;
        return !rules?.disableAttacks && (!rules?.forceAttackType || rules.forceAttackType === 'lines');
    }

    /**
     * Mark one player as dead. Legacy callers retain their one-callback-at-a-time behavior.
     */
    handlePlayerDeath(playerIndex) {
        return this.handlePlayerDeaths([playerIndex]).length > 0;
    }

    /**
     * Mark a same-tick set of players as dead, all before anyone judges the match.
     * Indices are canonicalized ascending while invalid, duplicate, and
     * already-dead entries are ignored. A shared multiplayer tick can resolve a
     * full player barrier without giving the first callback an outcome edge.
     *
     * The match is not judged here: its owner judges it once the batch is in.
     * OdysseyBotMatch calls checkWinCondition() (its frags carry across rounds).
     * LocalMultiplayerMode judges its match totals (_resolveMatchEnd), since reset() clears
     * these counters every round: judging them here ended a 3-4 player match by one round's
     * frags while two players were still alive, which stopped the loop with no result shown.
     *
     * @param {number[]} playerIndices - Zero-based player indices
     * @returns {number[]} The canonical unique indices eliminated by this call
     */
    handlePlayerDeaths(playerIndices) {
        const uniqueIndices = [];
        const seen = new Set();
        for (const playerIndex of playerIndices || []) {
            if (
                !Number.isInteger(playerIndex)
                || playerIndex < 0
                || playerIndex >= this.players.length
                || seen.has(playerIndex)
            ) continue;
            seen.add(playerIndex);
            uniqueIndices.push(playerIndex);
        }
        uniqueIndices.sort((left, right) => left - right);

        return uniqueIndices.filter(
            (playerIndex) => this._eliminatePlayer(playerIndex) === true,
        );
    }

    /** Mark one player dead and award the frag to the last attacker. */
    _eliminatePlayer(playerIndex) {
        const player = this.players[playerIndex];

        if (!player.isAlive) {
            return false; // Already dead
        }

        player.isAlive = false;

        // Increment death counter
        this.deaths[playerIndex]++;

        // Award frag to last attacker
        const killerId = this.lastAttackerIds[playerIndex];

        if (
            Number.isInteger(killerId)
            && killerId >= 0
            && killerId < this.players.length
            && killerId !== playerIndex
        ) {
            this.frags[killerId]++;
            console.log(
                `[MultiPlayerState] 💀 Player ${killerId + 1} fragged Player ${playerIndex + 1}! Frags: ${this.frags[killerId]}`,
            );
        } else {
            console.log(`[MultiPlayerState] 💀 Player ${playerIndex + 1} self-destructed (no frag awarded)`);
        }

        return true;
    }

    /**
     * Check if match should end based on win condition
     * NOTE: This checks MATCH win conditions (e.g., first to 7 frags), not round-end conditions.
     * Round-end logic (last player standing) is handled by LocalMultiplayerMode._handleGameOver()
     */
    checkWinCondition() {
        const config = this.matchConfig;

        // Check specific win conditions (frags, time, points, lines, never)
        // DO NOT check "last player standing" here - that's a round-end, not match-end
        if (config.isTeamMode) {
            // Aggregate stats by team
            const teamStats = {};
            for (let i = 0; i < this.numPlayers; i++) {
                const teamId = config.playerTeams[i];
                if (!teamStats[teamId]) {
                    teamStats[teamId] = { frags: 0, score: 0, lines: 0 };
                }
                teamStats[teamId].frags += this.frags[i];
                teamStats[teamId].score += this.players[i].score;
                teamStats[teamId].lines += this.players[i].totalLinesCleared;
            }

            const metric = config.endCondition === 'points' ? 'score' : config.endCondition;
            const target = config.endCondition === 'points'
                ? config.endConditionValue * 1000
                : config.endConditionValue;
            if (['frags', 'score', 'lines'].includes(metric)) {
                const entries = Object.entries(teamStats);
                const maxValue = Math.max(...entries.map(([, stats]) => stats[metric]));
                if (maxValue >= target) {
                    const leaders = entries
                        .filter(([, stats]) => stats[metric] === maxValue)
                        .map(([teamId]) => Number(teamId));
                    if (leaders.length === 1) this.endMatchByTeam(leaders[0]);
                    else this.endMatch(null);
                    return true;
                }
            }

            // For time-based, wait for switch below or handle here?
            // Switch below handles individual winners, team mode needs its own time-end logic
        }

        switch (config.endCondition) {
        case 'frags': {
            const maxFrags = Math.max(...this.frags);
            if (maxFrags >= config.endConditionValue) {
                const leaders = this.frags
                    .map((frags, playerIndex) => (frags === maxFrags ? playerIndex : -1))
                    .filter((playerIndex) => playerIndex >= 0);
                this.endMatch(leaders.length === 1 ? leaders[0] : null);
                return true;
            }
            break;
        }

        case 'time': {
            const elapsed = (Date.now() - this.matchStartTime) / 1000 / 60; // minutes
            if (elapsed >= config.endConditionValue) {
                if (config.isTeamMode) {
                    // Winner is team with highest aggregate score
                    const teamScores = {};
                    for (let i = 0; i < this.numPlayers; i++) {
                        const teamId = config.playerTeams[i];
                        teamScores[teamId] = (teamScores[teamId] || 0) + this.players[i].score;
                    }
                    const winnerTeamId = Object.keys(teamScores).reduce((a, b) => (teamScores[a] > teamScores[b] ? a : b));
                    this.endMatchByTeam(parseInt(winnerTeamId));
                } else {
                    // Winner is player with highest score
                    const scores = this.players.map((p) => p.score);
                    const topPlayerIndex = scores.indexOf(Math.max(...scores));
                    this.endMatch(topPlayerIndex);
                }
                return true;
            }
            break;
        }

        case 'points': {
            const targetScore = config.endConditionValue * 1000;
            const maxScore = Math.max(...this.players.map((player) => player.score));
            if (maxScore >= targetScore) {
                const leaders = this.players
                    .map((player, playerIndex) => (player.score === maxScore ? playerIndex : -1))
                    .filter((playerIndex) => playerIndex >= 0);
                this.endMatch(leaders.length === 1 ? leaders[0] : null);
                return true;
            }
            break;
        }

        case 'lines': {
            const maxLines = Math.max(...this.players.map((player) => player.totalLinesCleared));
            if (maxLines >= config.endConditionValue) {
                const leaders = this.players
                    .map((player, playerIndex) => (
                        player.totalLinesCleared === maxLines ? playerIndex : -1
                    ))
                    .filter((playerIndex) => playerIndex >= 0);
                this.endMatch(leaders.length === 1 ? leaders[0] : null);
                return true;
            }
            break;
        }

        case 'never':
            // Never end automatically
            break;
        }

        return false;
    }

    /**
     * End match declaring a team as the winner
     */
    endMatchByTeam(teamId) {
        this.isGameOver = true;
        this.winner = `Team ${String.fromCharCode(65 + teamId)}`;
        console.log(`[MultiPlayerState] 🏆 ${this.winner} wins the match!`);
    }

    /**
     * End the match with a winner
     */
    endMatch(winnerIndex) {
        this.isGameOver = true;
        this.winner = winnerIndex;

        if (winnerIndex !== null) {
            console.log(`[MultiPlayerState] 🏆 Player ${winnerIndex + 1} wins the match!`);
        } else {
            console.log('[MultiPlayerState] 🤝 Match ended in a draw');
        }
    }

    /**
     * Get match statistics for all players
     */
    getMatchStats() {
        return this.players.map((player, index) => ({
            playerIndex: index,
            playerName: `Player ${index + 1}`,
            frags: this.frags[index],
            score: player.score,
            lines: player.totalLinesCleared,
            isAlive: player.isAlive,
            level: player.level,
        }));
    }

    /**
     * Get sorted leaderboard
     */
    getLeaderboard() {
        const stats = this.getMatchStats();

        // Sort by: frags (desc) → score (desc) → lines (desc)
        stats.sort((a, b) => {
            if (b.frags !== a.frags) return b.frags - a.frags;
            if (b.score !== a.score) return b.score - a.score;
            return b.lines - a.lines;
        });

        return stats;
    }
}
