/**
 * @fileoverview Multi-player game state for 2-4 player local multiplayer
 * Manages N independent game states with garbage interaction
 *
 * This replaces MultiplayerGameState for scalable local multiplayer
 */

import { GameState } from './game.js';
import {
    GarbageQueue, GarbageAttack, calculateGarbage, insertGarbageEntries, ATTACK_TYPES,
    applyHandicap, accumulateHandicapStamps, createGarbageAttackFromColumns,
    DEFAULT_POTATO_DURATION_MS, DEFAULT_POTATO_PENALTY_LINES,
} from './garbage.js';
import { processPhysics } from './physics.js';
import { LEVEL_SPEEDS, COLS, ROWS } from './constants.js';
import { createInfinityGrid } from './infinity-grid.js';

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
    constructor(numPlayers = 2) {
        this.numPlayers = numPlayers;

        // Player game states (array-based for scalability)
        this.players = [];
        this.garbageQueues = [];
        this.playerColors = []; // Store player color assignments

        for (let i = 0; i < numPlayers; i++) {
            this.players.push(new GameState());
            this.garbageQueues.push(new GarbageQueue());
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
            infinityMaxRows: 100,
        };

        this._assignPlayerColors();

        // Match state
        this.isGameOver = false;
        this.isPaused = false;
        this.winner = null; // Player index (0-3) or null
        this.matchStartTime = 0;

        // Frag tracking (kills) and deaths tracking
        this.frags = new Array(numPlayers).fill(0);
        this.deaths = new Array(numPlayers).fill(0); // Quadra-style death counter
        this.lastAttackerIds = new Array(numPlayers).fill(null); // Track who last attacked each player

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

        // Hot Potato variant state. Disabled unless enabled by match config.
        this.hotPotato = this._createHotPotatoState();
    }

    /**
     * Set match configuration
     */
    setMatchConfig(config) {
        const rawInfinityRows = Number(config?.infinityMaxRows);
        const infinityMaxRows = Number.isFinite(rawInfinityRows)
            ? Math.min(1000, Math.max(100, rawInfinityRows))
            : 100;

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
            potatoDetonations: 0,
            potatoLinesReceived: 0,
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

    _createHotPotatoState() {
        return {
            enabled: false,
            holderIndex: null,
            previousHolderIndex: null,
            expiresAt: 0,
            durationMs: DEFAULT_POTATO_DURATION_MS,
            penaltyLines: DEFAULT_POTATO_PENALTY_LINES,
            generation: 0,
            lastEvent: null,
        };
    }

    _isHotPotatoEnabled() {
        const rules = this.matchConfig?.attackRules || {};
        return !!(
            this.matchConfig?.hotPotato
            || this.matchConfig?.attackStyle === 'hot_potato'
            || rules.forceAttackType === ATTACK_TYPES.POTATO
        );
    }

    _resetHotPotatoState(now = Date.now()) {
        const enabled = this._isHotPotatoEnabled();
        const rules = this.matchConfig?.attackRules || {};
        const durationMs = Math.max(
            1000,
            Number(this.matchConfig?.potatoDurationMs || rules.potatoDurationMs || DEFAULT_POTATO_DURATION_MS),
        );
        const penaltyLines = Math.max(
            1,
            Number(this.matchConfig?.potatoPenaltyLines || rules.potatoPenaltyLines || DEFAULT_POTATO_PENALTY_LINES),
        );
        const holderIndex = enabled ? this._chooseHotPotatoHolder(null) : null;

        this.hotPotato = {
            enabled,
            holderIndex,
            previousHolderIndex: null,
            expiresAt: holderIndex === null ? 0 : now + durationMs,
            durationMs,
            penaltyLines,
            generation: 0,
            lastEvent: null,
        };
    }

    getHotPotatoState(now = Date.now()) {
        const state = this.hotPotato || this._createHotPotatoState();
        return {
            ...state,
            timeRemainingMs: state.enabled && state.expiresAt
                ? Math.max(0, state.expiresAt - now)
                : 0,
        };
    }

    _getAlivePlayerIndexes() {
        const alive = [];
        this.players.forEach((player, index) => {
            if (player?.isAlive) alive.push(index);
        });
        return alive;
    }

    _chooseHotPotatoHolder(previousIndex = null, preferredTargets = []) {
        const alive = this._getAlivePlayerIndexes();
        if (alive.length === 0) return null;

        const preferred = preferredTargets.find((index) => alive.includes(index) && index !== previousIndex);
        if (preferred !== undefined) return preferred;

        if (previousIndex === null || previousIndex === undefined || !alive.includes(previousIndex)) {
            return alive[0];
        }

        const sorted = alive.slice().sort((a, b) => a - b);
        const next = sorted.find((index) => index > previousIndex);
        return next ?? sorted[0];
    }

    _transferHotPotato(fromIndex, toIndex, reason = 'pass', now = Date.now()) {
        if (!this.hotPotato?.enabled || toIndex === null || toIndex === undefined) {
            return null;
        }

        this.hotPotato.previousHolderIndex = fromIndex ?? this.hotPotato.holderIndex;
        this.hotPotato.holderIndex = toIndex;
        this.hotPotato.expiresAt = now + this.hotPotato.durationMs;
        this.hotPotato.generation++;
        this.hotPotato.lastEvent = {
            type: reason,
            fromIndex,
            toIndex,
            timestamp: now,
            generation: this.hotPotato.generation,
        };

        return this.hotPotato.lastEvent;
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

    _recordIncomingAttack(playerIndex, {
        lines = 0, cleanLines = 0, countAttack = false, potato = false,
    } = {}) {
        const metrics = this.playerMetrics[playerIndex];
        if (!metrics) return;
        if (countAttack) metrics.attacksReceived++;
        metrics.attackLinesReceived += Math.max(0, lines);
        metrics.cleanLinesReceived += Math.max(0, cleanLines);
        if (potato) {
            metrics.potatoDetonations++;
            metrics.potatoLinesReceived += Math.max(0, lines);
        }
    }

    /**
     * Apply per-player Quadra handicap levels (0-4) from match config.
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
            player.handicapCrowd = 0;
        });
    }

    /**
     * Accumulate Quadra handicap stamps for one player against all opponents.
     * Intended to be called once per piece lock. No-op when handicap levels are
     * equal (the common case), so it is safe to call unconditionally.
     * @param {number} playerIndex
     */
    accumulateHandicap(playerIndex) {
        const player = this.players[playerIndex];
        if (!player) return;

        const opponents = {};
        let aliveCount = 0;
        this.players.forEach((other, index) => {
            if (other?.isAlive) aliveCount++;
            if (index !== playerIndex && other) {
                opponents[index] = other;
            }
        });

        accumulateHandicapStamps(player, opponents, aliveCount);
    }

    /**
     * Apply Quadra per-opponent handicap to an attack for one target. Reduces the
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
            this.players[i].reset();

            // Apply Infinity LMS configuration
            if (this.matchConfig?.isInfinityLMS) {
                // Enable infinity mode
                this.players[i].isInfinityMode = true;
                this.players[i].maxRows = this.matchConfig?.infinityMaxRows || 100;
                this.players[i].disableLevelProgression = true;
                this.players[i].disableGarbage = false; // Keep garbage for multiplayer

                // Create infinity grid (starts at 44 rows, expands dynamically)
                const infinityGrid = createInfinityGrid(COLS, 44);
                this.players[i].board = infinityGrid;
                this.players[i].boardGrid = infinityGrid;

                // Initialize infinity stats
                this.players[i].infinityStats = {
                    blocksPlaced: 0,
                    maxCascadeScore: 0,
                    maxComboComplexity: 0,
                    maxComboDepth: 0,
                    totalCascades: 0,
                    rowsReached: 44,
                };

                // Camera tracking
                const startingCameraRow = Math.max(0, infinityGrid.length - ROWS);
                this.players[i].cameraRow = startingCameraRow;
                this.players[i].currentTopRow = startingCameraRow;

                console.log(`[MultiPlayerState] Player ${i + 1} initialized for Infinity LMS: 44 rows, max ${this.players[i].maxRows}`);
            } else {
                // Apply normal match configuration settings
                if (this.matchConfig) {
                    this.players[i].disableLevelProgression = !this.matchConfig.levelProgression;

                    // Set start level from match config
                    if (this.matchConfig.startLevel) {
                        this.players[i].level = this.matchConfig.startLevel;

                        // Update drop interval based on start level
                        const speedIndex = Math.min(
                            this.matchConfig.startLevel - 1,
                            LEVEL_SPEEDS.length - 1,
                        );
                        this.players[i].dropInterval = LEVEL_SPEEDS[speedIndex];

                        console.log(`[MultiPlayerState] Player ${i + 1} reset: level=${this.players[i].level}, dropInterval=${this.players[i].dropInterval}ms`);
                    }
                }
            }

            this.garbageQueues[i].clear();
            this.frags[i] = 0;
            this.deaths[i] = 0;
            this.lastAttackerIds[i] = null;
            this.playerPaused[i] = false;
        }

        this._assignPlayerColors();
        this._resetPlayerMetrics();

        this.isGameOver = false;
        this.isPaused = false;
        this.winner = null;
        this.lastTime = 0;
        this.sharedPieceSeed = 0;
        this.rngDescriptor = null;
        this.matchStartTime = Date.now();
        this._resetHotPotatoState(this.matchStartTime);
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

    _buildHotPotatoPenaltyAttack(holderIndex) {
        const columnsByRow = Array.from({ length: this.hotPotato.penaltyLines }, (_, rowIndex) => {
            const col = (holderIndex * 3 + rowIndex * 2) % COLS;
            return [col];
        });

        return createGarbageAttackFromColumns({
            rows: this.hotPotato.penaltyLines,
            columnsByRow,
            attackType: ATTACK_TYPES.POTATO,
            metadata: {
                source: 'hot_potato',
                holderIndex,
                generation: this.hotPotato.generation,
            },
        }).withId(`POTATO-${this.hotPotato.generation + 1}`);
    }

    _detonateHotPotato(holderIndex, now = Date.now()) {
        if (!this.hotPotato?.enabled || holderIndex === null || holderIndex === undefined) {
            return null;
        }

        const holder = this.players[holderIndex];
        if (!holder?.isAlive) {
            const nextHolder = this._chooseHotPotatoHolder(holderIndex);
            return this._transferHotPotato(holderIndex, nextHolder, 'holder_eliminated', now);
        }

        const attack = this._buildHotPotatoPenaltyAttack(holderIndex);
        const color = this.getPlayerColor(holderIndex)?.primary || '#f97316';
        const entries = attack.expandEntries({
            color,
            attackerId: null,
            attackerName: 'Hot Potato',
        });

        entries.forEach((entry) => {
            this.garbageQueues[holderIndex].enqueue({
                ...entry,
                sourcePlayerId: null,
                attackId: attack.id,
                isHotPotato: true,
            });
        });

        this.lastAttackerIds[holderIndex] = null;
        this._recordIncomingAttack(holderIndex, {
            lines: entries.filter((entry) => entry.type === 'line').length,
            countAttack: true,
            potato: true,
        });

        const nextHolder = this._chooseHotPotatoHolder(holderIndex);
        return this._transferHotPotato(holderIndex, nextHolder, 'detonate', now);
    }

    updateHotPotato(now = Date.now()) {
        if (!this.hotPotato?.enabled || this.isGameOver) {
            return null;
        }

        const holderIndex = this.hotPotato.holderIndex;
        const holder = holderIndex === null || holderIndex === undefined
            ? null
            : this.players[holderIndex];

        if (!holder?.isAlive) {
            const nextHolder = this._chooseHotPotatoHolder(holderIndex);
            return this._transferHotPotato(holderIndex, nextHolder, 'holder_eliminated', now);
        }

        if (this.hotPotato.expiresAt > 0 && now >= this.hotPotato.expiresAt) {
            return this._detonateHotPotato(holderIndex, now);
        }

        return null;
    }

    _handleHotPotatoAttack(playerIndex, attack, onGarbageSend) {
        if (!this.hotPotato?.enabled) {
            return false;
        }

        const targets = this._getAttackTargets(playerIndex);
        const lineCount = attack.getTotalLines();
        if (lineCount <= 0 || targets.length === 0) {
            return true;
        }

        const holderIndex = this.hotPotato.holderIndex;
        if (holderIndex === null || holderIndex === undefined) {
            this._transferHotPotato(null, this._chooseHotPotatoHolder(null), 'start');
            return true;
        }

        if (playerIndex === holderIndex) {
            const nextHolder = this._chooseHotPotatoHolder(playerIndex, targets);
            if (nextHolder !== null && nextHolder !== playerIndex) {
                this._transferHotPotato(playerIndex, nextHolder, 'pass');
                const metrics = this.playerMetrics[playerIndex];
                if (metrics) metrics.potatoPasses++;
            }
        }

        this._recordOutgoingAttack(playerIndex, {
            lines: 0,
            cleanLines: 0,
            countAttack: true,
        });

        if (onGarbageSend) {
            onGarbageSend(playerIndex, targets, 0, { type: ATTACK_TYPES.POTATO, holderIndex: this.hotPotato.holderIndex });
        }

        return true;
    }

    /**
     * Handle garbage summary and route to opponents
     *
     * For 2 players: Send to other player
     * For 3+ players: Distribute to all other players
     */
    handleGarbageSummary(playerIndex, summary, onGarbageSend) {
        // Attack ruleset from match config (Quadra-style: standard/blind/full_blind/peaceful).
        const attackRules = this.matchConfig?.attackRules || null;
        this._recordCascadeMetrics(playerIndex, summary);

        // Peaceful preset: players never send garbage to each other.
        if (attackRules?.disableAttacks) {
            return;
        }

        const attack = calculateGarbage(summary, attackRules || {});
        const attackerState = this.players[playerIndex];

        if (this._isHotPotatoEnabled()) {
            this._handleHotPotatoAttack(playerIndex, attack, onGarbageSend);
            return;
        }

        const sequence = typeof summary.sequence === 'number'
            ? summary.sequence
            : this.attackSequences[playerIndex]++;
        const attackId = `P${playerIndex + 1}-A${sequence}`;
        attack.withId(attackId);

        let totalLines = attack.getTotalLines();

        console.log(
            `[MultiPlayerState] Player ${playerIndex + 1} cascade resolved → depth=${attack.depth}, combo=${attack.complexity}`,
        );

        // Apply attack scaling based on player count
        totalLines = this._scaleAttackForPlayerCount(totalLines);

        console.log(
            `[MultiPlayerState]   Total attack rows: ${totalLines} (scaled from ${attack.getTotalLines()})`,
        );

        // Blind / Full Blind attacks carry an effect even when they add no garbage
        // lines, so they must not be short-circuited by the line-count guard.
        if (
            totalLines <= 0
            && attack.attackType !== ATTACK_TYPES.BLIND
            && attack.attackType !== ATTACK_TYPES.FULL_BLIND
        ) {
            return;
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

        // Route garbage to all opponents
        const targets = this._getAttackTargets(playerIndex);

        if (targets.length === 0) {
            console.log(`[MultiPlayerState] No valid targets for Player ${playerIndex + 1}`);
            return;
        }

        let countedOutgoingPacket = false;
        targets.forEach((targetIndex) => {
            // Track last attacker for frag attribution
            this.lastAttackerIds[targetIndex] = playerIndex;

            const targetQueue = this.garbageQueues[targetIndex];

            // Quadra per-opponent handicap reduces this attack's normal garbage
            // lines for stronger players; entries are expanded per target so the
            // reduction can differ per opponent.
            const targetAttack = this._applyHandicapForTarget(attack, attackerState, targetIndex);
            const entries = targetAttack.expandEntries(context);
            const queueableEntries = [];
            const lineEntries = entries.filter((entry) => entry.type === 'line');
            const cleanLines = lineEntries.filter((entry) => entry.variant === 'clean').length;
            const countsAsAttack = entries.length > 0;

            if (countsAsAttack) {
                this._recordOutgoingAttack(playerIndex, {
                    lines: lineEntries.length,
                    cleanLines,
                    countAttack: !countedOutgoingPacket,
                });
                this._recordIncomingAttack(targetIndex, {
                    lines: lineEntries.length,
                    cleanLines,
                    countAttack: true,
                });
                countedOutgoingPacket = true;
            }

            entries.forEach((entry) => {
                if (entry.type === 'full_blind') {
                    targetQueue.enqueue({
                        type: 'full_blind',
                        duration: entry.duration,
                        sourcePlayerId: playerIndex,
                        attackId,
                    });
                } else if (entry.type === 'blind') {
                    targetQueue.enqueue({
                        type: 'blind',
                        duration: entry.duration,
                        sourcePlayerId: playerIndex,
                        attackId,
                    });
                } else {
                    queueableEntries.push(entry);
                }
            });

            if (queueableEntries.length > 0) {
                // Add to garbage queue - will be inserted when next piece locks
                queueableEntries.forEach((entry) => {
                    targetQueue.enqueue({
                        ...entry,
                        sourcePlayerId: playerIndex,
                        attackId,
                    });
                });
            }

            console.log(
                `[MultiPlayerState] Player ${playerIndex + 1} → Player ${targetIndex + 1}: ${targetAttack.getTotalLines()} lines`,
            );
        });

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
     * Apply attack scaling based on number of players
     * Similar to Quadra's "boring rules" system
     *
     * Without boring rules:
     * - 2 players: 100% damage (no scaling)
     * - 3 players: 75% damage
     * - 4 players: 50% damage
     */
    _scaleAttackForPlayerCount(totalLines) {
        if (this.matchConfig.boringRules) {
            return totalLines; // No scaling with boring rules
        }

        // Count alive players
        const alivePlayers = this.players.filter((p) => p.isAlive).length;

        if (alivePlayers <= 2) {
            return totalLines; // Full damage for 2 players
        } if (alivePlayers === 3) {
            return Math.ceil(totalLines * 0.75); // 75% damage for 3 players
        }
        return Math.ceil(totalLines * 0.5); // 50% damage for 4+ players
    }

    /**
     * Mark one player as dead and evaluate the match immediately.
     * Legacy callers retain their one-callback-at-a-time behavior.
     */
    handlePlayerDeath(playerIndex) {
        return this.handlePlayerDeaths([playerIndex]).length > 0;
    }

    /**
     * Mark a same-tick set of players as dead before evaluating the match.
     * Indices are canonicalized ascending while invalid, duplicate, and
     * already-dead entries are ignored. A shared multiplayer tick can resolve a
     * full player barrier without giving the first callback an outcome edge.
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

        const eliminatedIndices = uniqueIndices.filter(
            (playerIndex) => this._handlePlayerDeathWithoutWinCheck(playerIndex) === true,
        );
        if (eliminatedIndices.length > 0) {
            this.checkWinCondition();
        }
        return eliminatedIndices;
    }

    /** Mark one player dead without evaluating the match mid-batch. */
    _handlePlayerDeathWithoutWinCheck(playerIndex) {
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
