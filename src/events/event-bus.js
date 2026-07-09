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
            [...handlers].forEach((handler) => handler(payload));
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
    PERFECT_CLEAR: 'perfectClear',
    CASCADE: 'cascade',
    B2B: 'b2b',
    TSPIN: 'tspin',
    PIECE_LOCK: 'pieceLock',
    PIECE_MOVE: 'pieceMove',
    PIECE_ROTATE: 'pieceRotate',
    HARD_DROP: 'hardDrop',
    LEVEL_UP: 'levelUp',
    SETTINGS_CHANGED: 'settingsChanged',
    ODYSSEY_SAVED: 'odysseySaved',
    HIGH_SCORE_SAVED: 'highScoreSaved',
    // Odyssey Mode Victory Lap
    ODYSSEY_GOAL_COMPLETE: 'odysseyGoalComplete',
    ODYSSEY_VICTORY_LAP_END: 'odysseyVictoryLapEnd',
    // Demo System
    OPEN_DEMO_BROWSER: 'openDemoBrowser',
    EXIT_TO_MAIN_MENU: 'exitToMainMenu',
    PLAY_DEMO: 'playDemo',
    // GPU Context Resilience
    CONTEXT_LOST: 'contextLost',
    CONTEXT_RESTORED: 'contextRestored',

    // Performance Adapters
    PERFORMANCE_DOWNSCALE: 'performanceDownscale'
};
