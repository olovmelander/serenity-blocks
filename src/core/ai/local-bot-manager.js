import { PuzzleBotController } from './puzzle-bot-controller.js';

function isBotSlot(slot) {
    return slot?.kind === 'bot' || slot?.type === 'bot' || slot?.isBot === true;
}

export class LocalBotManager {
    constructor(options) {
        this.multiplayerState = options.multiplayerState;
        this.actionFactory = options.actionFactory;
        this.rng = options.rng || Math.random;
        this.controllers = new Map();
    }

    configure(playerSlots = []) {
        this.destroy();

        for (let index = 0; index < this.multiplayerState.numPlayers; index++) {
            const slot = playerSlots[index] || { kind: 'human' };
            if (!isBotSlot(slot)) continue;

            const playerState = this.multiplayerState.players[index];
            const actions = this.actionFactory?.(index);
            if (!playerState || !actions) continue;

            this.controllers.set(index, new PuzzleBotController({
                actions,
                difficulty: slot.difficulty ?? slot.botDifficulty ?? 10,
                playerIndex: index,
                playerState,
                rng: this.rng,
            }));
        }
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
