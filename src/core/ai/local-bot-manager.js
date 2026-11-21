import { HIDDEN_ROWS } from '../constants.js';
import { hasObscuredStack } from '../blind.js';
import { GravityBotController, gravityPlanningRate } from './gravity-bot-controller.js';
import { normalizeDifficultyTier } from './bot-difficulty.js';
import { seededRandom } from '../../utils/helpers.js';

// The original 4,480-match fit sets ordinary local styles. The faster expert's
// upper neighbours are calibrated in side-swapped native frag series.
const LOCAL_PRACTICE_CHANCE = [0.75, 0.6, 0.45, 0.3, 0.25, 0.25, 0, 0.3, 0.65];
const LOCAL_ACTION_RATE = [108, 126, 133, 218, 292, 290, 350, 515, 760];
// Practiced seats can execute a known route quickly. Their nominal tier keeps
// its own reading time above the 170 ms needed for expert search.
const EXPERT_REACTION_MAX_MS = { 8: 230, 9: 200, 10: 200 };

function localPace(nominalTier, seed, index) {
    if (nominalTier === 10) return null;
    const random = seededRandom((Math.imul(seed, 0x9e3779b1) ^ Math.imul(index + 1, 0x27d4eb2d)) >>> 0);
    const reading = seededRandom((Math.imul(seed, 0x85ebca6b) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    const judgmentTier = reading() < LOCAL_PRACTICE_CHANCE[nominalTier - 1]
        ? Math.min(10, nominalTier + 2) : nominalTier;
    const scale = Math.exp((2 * random() - 1) * 1.65);
    const handTier = nominalTier === 7 && scale <= 1 ? 8 : nominalTier;
    return {
        nominalTier,
        judgmentTier,
        apm: LOCAL_ACTION_RATE[handTier - 1],
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
                ? { reactionMs: [170, EXPERT_REACTION_MAX_MS[difficulty]], maxApm: 3750 } : undefined;

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
                    if (match.numPlayers !== 2 || !opponent?.isAlive || hasObscuredStack(opponent)
                        || playerState.isInfinityMode || match.matchConfig?.isTeamMode || match._isHotPotatoEnabled?.()
                        || rules?.disableAttacks || (rules?.forceAttackType && rules.forceAttackType !== 'lines')
                        || playerState.handicap !== opponent.handicap) return Infinity;
                    const grid = opponent.boardGrid;
                    const top = grid.findIndex((row, y) => y >= HIDDEN_ROWS && row.some(Boolean));
                    return (top < 0 ? grid.length : top) - HIDDEN_ROWS;
                },
                sharedSearch,
                precomputeBetweenTicks: true,
                planUnitsPerMs: gravityPlanningRate(botCount, judgmentTier),
                rng: seededRandom((seed ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0),
                timingRng: seededRandom((seed ^ Math.imul(index + 1, 0xc2b2ae35)) >>> 0),
            }));
        }
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

    destroy() {
        for (const controller of this.controllers.values()) {
            controller.reset();
        }
        this.controllers.clear();
    }
}
