export class BotInputScheduler {
    constructor(actions, config) {
        this.actions = actions;
        this.config = config;
        this.queue = [];
        this.cooldownMs = 0;
    }

    clear() {
        this.queue = [];
        this.cooldownMs = 0;
    }

    setActions(actions) {
        this.queue = Array.isArray(actions) ? actions.slice() : [];
        this.cooldownMs = 0;
    }

    hasQueuedActions() {
        return this.queue.length > 0;
    }

    update(deltaMs) {
        if (this.queue.length === 0) return false;

        this.cooldownMs = Math.max(0, this.cooldownMs - deltaMs);
        if (this.cooldownMs > 0) return false;

        const action = this.queue.shift();
        const performed = this.perform(action);
        const interval = Math.max(20, this.config?.actionIntervalMs || 120);
        this.cooldownMs = action?.type === 'hardDrop'
            ? Math.max(45, interval * 0.65)
            : interval;

        return performed;
    }

    perform(action) {
        if (!action || !this.actions) return false;

        switch (action.type) {
        case 'move':
            return action.dir < 0
                ? Boolean(this.actions.moveLeft?.())
                : Boolean(this.actions.moveRight?.());
        case 'rotate':
            if (action.dir === 'left') return Boolean(this.actions.rotateLeft?.());
            if (action.dir === 'flip') return Boolean(this.actions.rotateFlip?.());
            return Boolean(this.actions.rotateRight?.());
        case 'softDrop':
            return Boolean(this.actions.softDrop?.());
        case 'hardDrop':
            this.actions.hardDrop?.();
            return true;
        default:
            return false;
        }
    }
}
