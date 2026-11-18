import { GravityBotController, gravityPlanningRate } from './gravity-bot-controller.js';
import { seededRandom } from '../../utils/helpers.js';

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
        this.controllers = new Map();
    }

    configure(playerSlots = []) {
        this.destroy();
        const botCount = playerSlots.filter(isBotSlot).length;
        const sharedSearch = botCount > 1 ? new Map() : null;
        const seed = this.multiplayerState.sharedPieceSeed ?? this.multiplayerState.rngDescriptor?.seed
            ?? (this.rng ? Math.floor(this.rng() * 0x100000000) : 0);
        for (let index = 0; index < this.multiplayerState.numPlayers; index++) {
            const slot = playerSlots[index] || { kind: 'human' };
            if (!isBotSlot(slot)) continue;

            const playerState = this.multiplayerState.players[index];
            const actions = this.actionFactory?.(index);
            if (!playerState || !actions) continue;

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
                difficulty: slot.difficulty ?? slot.botDifficulty ?? 10,
                playerIndex: index,
                playerState,
                pendingRows: () => this.multiplayerState.getGarbageQueue?.(index)?.getTotalLines() || 0,
                sharedSearch,
                planUnitsPerMs: gravityPlanningRate(botCount),
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
