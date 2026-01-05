class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    on(eventName, handler) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, new Set());
        }
        this.listeners.get(eventName).add(handler);
        return () => this.off(eventName, handler);
    }

    once(eventName, handler) {
        const off = this.on(eventName, (...args) => {
            off();
            handler(...args);
        });
        return off;
    }

    off(eventName, handler) {
        const handlers = this.listeners.get(eventName);
        if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.listeners.delete(eventName);
            }
        }
    }

    emit(eventName, payload) {
        const handlers = this.listeners.get(eventName);
        if (handlers) {
            handlers.forEach((handler) => handler(payload));
        }
    }
}

export const eventBus = new EventBus();

export const EVENTS = {
    THEME_CHANGED: 'themeChanged',
    THEME_LOADING: 'themeLoading',
    BACKGROUND_READY: 'backgroundReady',
    LINE_CLEAR: 'lineClear',
    COMBO: 'combo',
    PIECE_LOCK: 'pieceLock',
    SETTINGS_CHANGED: 'settingsChanged',
    // Journey Mode Victory Lap
    JOURNEY_GOAL_COMPLETE: 'journeyGoalComplete',
    JOURNEY_VICTORY_LAP_END: 'journeyVictoryLapEnd',
};
