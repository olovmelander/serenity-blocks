import { HIDDEN_ROWS } from '../constants.js';
import { VERSUS_WEIGHTS, rowsToBlockSpawn } from './versus-evaluation.js';
import { GravityBotController, gravityPlanningRate } from './gravity-bot-controller.js';
import { normalizeDifficultyTier } from './bot-difficulty.js';
import { readMinAttackLines } from '../garbage.js';
import { seededRandom } from '../../utils/helpers.js';

// Fitted with versus play on the shipped rules: free-for-all to seven frags, both seat orders
// (reports/bots-versus-2026-11/ladder.mjs), so that each tier beats the next by a similar margin.
const LOCAL_PRACTICE_CHANCE = [0.75, 0.6, 0.5, 0.3, 0.25, 0.32, 0.14, 0.33, 0.72];
const LOCAL_ACTION_RATE = [108, 138, 150, 232, 300, 400, 585, 600, 760];
// Practiced seats can execute a known route quickly. Their nominal tier keeps
// its own reading time above the 170 ms needed for expert search.
const EXPERT_REACTION_MS = { 8: [170, 230], 9: [170, 200], 10: [158, 178] };

function localPace(nominalTier, seed, index) {
    if (nominalTier === 10) return null;
    const random = seededRandom((Math.imul(seed, 0x9e3779b1) ^ Math.imul(index + 1, 0x27d4eb2d)) >>> 0);
    const reading = seededRandom((Math.imul(seed, 0x85ebca6b) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    const judgmentTier = reading() < LOCAL_PRACTICE_CHANCE[nominalTier - 1]
        ? Math.min(10, nominalTier + 2) : nominalTier;
    const scale = Math.exp((2 * random() - 1) * 1.65);
    return {
        nominalTier,
        judgmentTier,
        apm: LOCAL_ACTION_RATE[nominalTier - 1],
        scale,
    };
}

export function isBotSlot(slot) {
    return slot?.kind === 'bot' || slot?.type === 'bot' || slot?.isBot === true;
}

export function localBotRoundSeed(seed, round) {
    return (seed + Math.imul(round - 1, 0x9e3779b9)) >>> 0;
}

export class LocalBotManager {
    constructor(options) {
        this.multiplayerState = options.multiplayerState;
        this.actionFactory = options.actionFactory;
        this.rng = options.rng;
        this.useLocalStyles = options.useLocalStyles !== false;
        this.controllers = new Map();
    }

    configure(playerSlots = [], seriesSeed = null) {
        this.destroy();
        const slots = playerSlots.slice(0, this.multiplayerState.numPlayers);
        const botCount = slots.filter(isBotSlot).length;
        if (!botCount) return;
        const sharedSearch = botCount > 1 ? new Map() : null;
        const seed = this.multiplayerState.sharedPieceSeed ?? this.multiplayerState.rngDescriptor?.seed
            ?? (this.rng ? Math.floor(this.rng() * 0x100000000) : 0);
        for (const [index, slot] of slots.entries()) {
            if (!isBotSlot(slot)) continue;

            const playerState = this.multiplayerState.players[index];
            const actions = this.actionFactory?.(index);
            if (!playerState || !actions) continue;
            const difficulty = normalizeDifficultyTier(slot.difficulty ?? slot.botDifficulty);
            const pace = this.useLocalStyles && !playerState.isInfinityMode
                ? localPace(difficulty, seriesSeed ?? seed, index) : null;
            const judgmentTier = pace?.judgmentTier ?? difficulty;
            const expertPace = judgmentTier === 10 && !playerState.isInfinityMode
                ? { reactionMs: EXPERT_REACTION_MS[difficulty], maxApm: 3750 } : undefined;

            const input = (name, action, value) => () => (this.tickInput
                ? this.tickInput.emit({
                    tick: this.tickInput.tick, subframe: 9, source: 'edge', edgeSequence: null, action, value,
                })
                : actions[name]?.());
            this.controllers.set(index, new GravityBotController({
                actions: {
                    moveLeft: input('moveLeft', 'move', -1),
                    moveRight: input('moveRight', 'move', 1),
                    rotateLeft: input('rotateLeft', 'rotate', 'left'),
                    rotateRight: input('rotateRight', 'rotate', 'right'),
                    rotateFlip: input('rotateFlip', 'rotate', 'flip'),
                    softDrop: input('softDrop', 'softDrop', null),
                    hardDrop: input('hardDrop', 'hardDrop', null),
                },
                difficulty: judgmentTier,
                configOverrides: expertPace,
                localPace: expertPace ? null : pace,
                playerIndex: index,
                playerState,
                pendingRows: () => this.multiplayerState.getGarbageQueue?.(index)?.getTotalLines() || 0,
                versus: !this.multiplayerState.matchConfig?.attackRules?.disableAttacks,
                finishingRoom: () => {
                    const match = this.multiplayerState;
                    const opponent = match.players[1 - index];
                    const rules = match.matchConfig?.attackRules;
                    // Only a standard head-to-head duel sends the gross attack
                    // directly. Team targeting, scaled damage and handicaps differ.
                    if (match.numPlayers !== 2 || !opponent?.isAlive
                        || playerState.isInfinityMode || match.matchConfig?.isTeamMode || match._isHotPotatoEnabled?.()
                        || rules?.disableAttacks || (rules?.forceAttackType && rules.forceAttackType !== 'lines')
                        || playerState.handicap !== opponent.handicap) return Infinity;
                    const grid = opponent.boardGrid;
                    const top = grid.findIndex((row, y) => y >= HIDDEN_ROWS && row.some(Boolean));
                    return (top < 0 ? grid.length : top) - HIDDEN_ROWS;
                },
                sharedSearch,
                precomputeBetweenTicks: true,
                planUnitsPerMs: gravityPlanningRate(botCount, judgmentTier, !playerState.isInfinityMode),
                versusWeights: this.playsVersus(playerState) ? VERSUS_WEIGHTS : null,
                versusOutlook: () => this.versusOutlook(index),
                rng: seededRandom((seed ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0),
                timingRng: seededRandom((seed ^ Math.imul(index + 1, 0xc2b2ae35)) >>> 0),
            }));
        }
    }

    /**
     * Versus play, at every tier: attacks are on, in the standard well (Last Standing and peaceful
     * matches keep theirs). A lower tier sees fewer pieces ahead, searches less, errs and is slower.
     */
    playsVersus(playerState) {
        return this.useLocalStyles && !playerState.isInfinityMode
            && !this.multiplayerState.matchConfig?.attackRules?.disableAttacks;
    }

    /**
     * What a versus seat's next clear is worth: the match's smallest attacking clear, whether an
     * attack counts at all now (hot potato), and the fewest rows that would end some opponent.
     * @param {number} index
     */
    versusOutlook(index) {
        const match = this.multiplayerState;
        const { route, targets } = match.attackOutlook(index);
        const rows = match.sendsRows() ? targets.map((i) => (
            rowsToBlockSpawn(match.players[i].boardGrid, match.getGarbageQueue(i).getTotalLines()))) : [];
        return {
            minAttackLines: readMinAttackLines(match.matchConfig?.minAttackLines),
            worth: route === 'none' ? 0 : 1,
            flat: route === 'count',
            killRows: Math.min(Infinity, ...rows),
        };
    }

    advanceFixedInput(index, context) {
        const controller = this.controllers.get(index);
        if (!controller) return;
        this.tickInput = context;
        try { controller.update(context.tickMs, context.tick * context.tickMs); } finally { this.tickInput = null; }
    }

    precomputeFixedSearch(elapsedMs, tickMs) {
        let advanced = 0;
        for (const [index, controller] of this.controllers) {
            if (!controller.playerState.isGameOver && !this.multiplayerState.playerPaused?.[index]) {
                advanced += controller.precomputeSearch(elapsedMs, tickMs);
            }
        }
        return advanced;
    }

    update(deltaMs, nowMs) {
        for (const controller of this.controllers.values()) {
            controller.update(deltaMs, nowMs);
        }
    }

    isBotPlayer(playerIndex) {
        return this.controllers.has(playerIndex);
    }

    /**
     * A bot plays again on an empty well (free-for-all respawn): its plan for the old board is
     * dropped and it reads the new one from its first piece. The controller sleeps while its
     * board is dead and drives it again as soon as the board is alive with a piece.
     * @param {number} playerIndex
     */
    resetPlayer(playerIndex) {
        this.controllers.get(playerIndex)?.reset();
    }

    destroy() {
        for (const controller of this.controllers.values()) {
            controller.reset();
        }
        this.controllers.clear();
    }
}
