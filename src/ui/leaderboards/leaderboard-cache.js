import { STEAM_STORAGE_KEYS } from '../../core/steam/steam-config.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export class LeaderboardCache {
    constructor(options = {}) {
        this.storageKey = options.storageKey || STEAM_STORAGE_KEYS.LEADERBOARD_CACHE;
        this.defaultTtlMs = options.defaultTtlMs || DEFAULT_TTL_MS;
        this.cache = this._load();
    }

    _load() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            return stored ? JSON.parse(stored) : {};
        } catch (err) {
            return {};
        }
    }

    _save() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.cache));
        } catch (err) {
            console.warn('[LeaderboardCache] Failed to save cache:', err.message);
        }
    }

    _now() {
        return Date.now();
    }

    get(key, ttlOverrideMs) {
        const entry = this.cache[key];
        if (!entry) return null;

        const ttl = Number.isFinite(ttlOverrideMs) ? ttlOverrideMs : this.defaultTtlMs;
        const age = this._now() - (entry.timestamp || 0);
        return {
            data: entry.data,
            stale: ttl > 0 ? age > ttl : false,
            ageMs: age,
        };
    }

    set(key, data) {
        this.cache[key] = {
            timestamp: this._now(),
            data,
        };
        this._save();
    }

    clear(key) {
        if (key) {
            delete this.cache[key];
        } else {
            this.cache = {};
        }
        this._save();
    }
}
