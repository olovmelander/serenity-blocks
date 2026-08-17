import steamService from './steam-service.js';
import { STEAM_EVENTS, STEAM_STORAGE_KEYS } from './steam-config.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { migrateOdysseyProgressData } from '../odyssey/OdysseyStateManager.js';

const CLOUD_FILES = {
    MANIFEST: 'cloud_manifest.json',
    ODYSSEY: 'odyssey.json',
    SETTINGS: 'settings.json',
    KEYBINDS: 'keybinds.json',
    HIGHSCORES: 'highscores.json',
    STATS: 'stats.json',
    UNLOCKS: 'unlocks.json',
};

const ODYSSEY_STORAGE_KEY = 'serenityBlocks_odysseyProgress';

const CLOUD_SETTINGS_KEYS = [
    'gameMode',
    'dasDelay',
    'dasInterval',
    'musicTrack',
    'soundSet',
    'musicVolume',
    'sfxVolume',
    'backgroundMode',
    'backgroundTheme',
    'themeLinkedMode',
    'themeLinkedSfx',
    'autoThemeChange',
    'randomThemeInterval',
    'pieceLockRipple',
    'pieceLockRippleColor',
    'comboPopupEffect',
    'lineClearEffects',
    'backgroundComboEffects',
    'themeBasedTetrominos',
    'controlScheme',
];

const CLOUD_KEYBIND_KEYS = [
    'keyBindings',
    'player2KeyBindings',
    'serenityKeyBindings',
    'serenityGamepadBindings',
];

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

const fallbackHash = (input) => {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash) + input.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
};

const safeParse = (raw) => {
    if (!raw || typeof raw !== 'string') return null;
    try {
        return JSON.parse(raw);
    } catch (err) {
        return null;
    }
};

const pickKeys = (obj, keys) => {
    const output = {};
    keys.forEach((key) => {
        if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
            output[key] = obj[key];
        }
    });
    return output;
};

const toTimestamp = (value) => {
    if (!value) return null;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : null;
};

export class SteamCloudSyncManager {
    constructor({ settingsManager, highScoreManager } = {}) {
        this.settingsManager = settingsManager || null;
        this.highScoreManager = highScoreManager || null;

        this.deviceId = this._loadDeviceId();
        this.manifest = this._loadManifest();
        this.pendingUploads = new Map();
        this.flushTimer = null;
        this.debounceMs = 1500;
        this.syncInProgress = false;
        this.suppressLocalEvents = false;
        this.periodicTimer = null;
    }

    initialize() {
        this._registerEventHandlers();
        this._scheduleInitialSync();
        this._schedulePeriodicSync();
    }

    _registerEventHandlers() {
        eventBus.on(EVENTS.SETTINGS_CHANGED, () => {
            if (this.suppressLocalEvents) return;
            this.queueUpload(CLOUD_FILES.SETTINGS);
            this.queueUpload(CLOUD_FILES.KEYBINDS);
        });

        eventBus.on(EVENTS.ODYSSEY_SAVED, () => {
            if (this.suppressLocalEvents) return;
            this.queueUpload(CLOUD_FILES.ODYSSEY);
        });

        eventBus.on(EVENTS.HIGH_SCORE_SAVED, () => {
            if (this.suppressLocalEvents) return;
            this.queueUpload(CLOUD_FILES.HIGHSCORES);
            this.queueUpload(CLOUD_FILES.STATS);
        });

        steamService.on('steam:reconnected', () => {
            this.syncFromCloud();
        });

        steamService.on(STEAM_EVENTS.CAPABILITIES_UPDATED, (caps) => {
            if (caps?.cloud) {
                this.syncFromCloud();
                this._flushPendingUploads();
            }
        });
    }

    _scheduleInitialSync() {
        setTimeout(() => {
            this.syncFromCloud();
        }, 2500);
    }

    _schedulePeriodicSync() {
        if (this.periodicTimer) {
            clearInterval(this.periodicTimer);
        }
        this.periodicTimer = setInterval(() => {
            this.syncFromCloud();
        }, 15 * 60 * 1000);
    }

    async queueUpload(fileName, { flush = false } = {}) {
        const capabilities = steamService.getCapabilities ? steamService.getCapabilities() : {};
        if (steamService.isAvailable?.() && capabilities.cloud === false) {
            return;
        }

        const payload = await this._buildLocalPayload(fileName, { includeUpdatedAt: true });
        if (!payload) return;

        this.pendingUploads.set(fileName, payload);
        this._scheduleFlush();

        if (flush) {
            await this._flushPendingUploads();
        }
    }

    _scheduleFlush() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
        }
        this.flushTimer = setTimeout(() => {
            this._flushPendingUploads();
        }, this.debounceMs);
    }

    async _flushPendingUploads() {
        if (this.pendingUploads.size === 0) return;

        const capabilities = steamService.getCapabilities ? steamService.getCapabilities() : {};
        if (steamService.isAvailable?.() && capabilities.cloud === false) {
            return;
        }

        const entries = Array.from(this.pendingUploads.entries());
        this.pendingUploads.clear();

        for (const [fileName, payload] of entries) {
            const result = await steamService.cloudWrite(fileName, payload.json);
            if (result?.queued) {
                this.pendingUploads.set(fileName, payload);
                continue;
            }
            if (result?.supported && result.success !== false) {
                this._updateManifestEntry(fileName, payload);
            } else {
                // Leave unsynced if Remote Storage is unavailable or errored
                this.pendingUploads.set(fileName, payload);
            }
        }

        await this._uploadManifest();
    }

    async syncFromCloud() {
        if (this.syncInProgress) return;
        this.syncInProgress = true;

        try {
            await steamService.waitForInit();
            if (!steamService.isAvailable()) return;
            const capabilities = steamService.getCapabilities ? steamService.getCapabilities() : {};
            if (capabilities.cloud === false) return;

            const manifestResponse = await steamService.cloudRead(CLOUD_FILES.MANIFEST);
            if (!manifestResponse?.supported) {
                return;
            }

            const cloudManifest = safeParse(manifestResponse.data);
            if (!cloudManifest || !cloudManifest.files) {
                await this._pushAllLocal();
                return;
            }

            await this._bootstrapLocalManifest();

            const files = Object.values(CLOUD_FILES).filter((file) => file !== CLOUD_FILES.MANIFEST);
            for (const fileName of files) {
                await this._syncFile(fileName, cloudManifest);
            }

            await this._uploadManifest();
        } finally {
            this.syncInProgress = false;
        }
    }

    async _syncFile(fileName, cloudManifest) {
        const localEntry = this.manifest.files?.[fileName] || null;
        const cloudEntry = cloudManifest.files?.[fileName] || null;

        if (!localEntry && !cloudEntry) return;

        if (!localEntry && cloudEntry) {
            await this._downloadAndApply(fileName, cloudEntry);
            return;
        }

        if (localEntry && !cloudEntry) {
            await this.queueUpload(fileName, { flush: true });
            return;
        }

        if (localEntry.hash && cloudEntry.hash && localEntry.hash === cloudEntry.hash) {
            return;
        }

        if ((cloudEntry.updatedAt || 0) > (localEntry.updatedAt || 0)) {
            await this._downloadAndApply(fileName, cloudEntry);
            return;
        }

        if ((localEntry.updatedAt || 0) > (cloudEntry.updatedAt || 0)) {
            await this.queueUpload(fileName, { flush: true });
            return;
        }

        await this._mergeConflict(fileName, cloudEntry);
    }

    async _downloadAndApply(fileName, cloudEntry) {
        const response = await steamService.cloudRead(fileName);
        if (!response?.supported || !response.data) return;

        const parsed = safeParse(response.data);
        if (!parsed) return;

        await this._applyCloudData(fileName, parsed);
        const hash = await this._computeHash(response.data);
        const updatedAt = cloudEntry?.updatedAt || Date.now();
        this._updateManifestEntry(fileName, { hash, updatedAt, json: response.data });
    }

    async _mergeConflict(fileName, cloudEntry) {
        const response = await steamService.cloudRead(fileName);
        if (!response?.supported || !response.data) return;
        const cloudData = safeParse(response.data);
        if (!cloudData) return;

        const localPayload = await this._buildLocalPayload(fileName);
        const localData = safeParse(localPayload?.json);
        if (!localPayload || !localData) return;

        const merged = this._mergeData(fileName, localData, cloudData);
        if (!merged) return;

        if (fileName === CLOUD_FILES.HIGHSCORES) {
            await this._applyHighScores(merged, { merge: false });
        } else if (fileName === CLOUD_FILES.STATS) {
            await this._applyStats(merged, { merge: false });
        } else if (fileName === CLOUD_FILES.ODYSSEY) {
            this._applyOdyssey(merged);
        } else if (fileName === CLOUD_FILES.SETTINGS) {
            this._applySettings(merged.settings || merged);
        } else if (fileName === CLOUD_FILES.KEYBINDS) {
            this._applyKeybinds(merged);
        }
        await this.queueUpload(fileName, { flush: true });

        const hash = await this._computeHash(JSON.stringify(merged));
        this._updateManifestEntry(fileName, {
            hash,
            updatedAt: Date.now(),
            json: JSON.stringify(merged),
        });
    }

    async _applyCloudData(fileName, data) {
        this.suppressLocalEvents = true;

        try {
            if (fileName === CLOUD_FILES.SETTINGS) {
                this._applySettings(data.settings || data);
            } else if (fileName === CLOUD_FILES.KEYBINDS) {
                this._applyKeybinds(data);
            } else if (fileName === CLOUD_FILES.ODYSSEY) {
                this._applyOdyssey(data);
            } else if (fileName === CLOUD_FILES.HIGHSCORES) {
                await this._applyHighScores(data);
            } else if (fileName === CLOUD_FILES.STATS) {
                await this._applyStats(data);
            }
        } finally {
            this.suppressLocalEvents = false;
        }
    }

    _applySettings(cloudSettings) {
        if (!this.settingsManager || !cloudSettings) return;
        const current = this.settingsManager.get();
        const merged = {
            ...current,
            ...cloudSettings,
        };
        this.settingsManager.update(merged, true);
        this.settingsManager.save({ emitEvent: false });
    }

    _applyKeybinds(cloudKeybinds) {
        if (!this.settingsManager || !cloudKeybinds) return;
        const current = this.settingsManager.get();
        const keybinds = cloudKeybinds.keyBindings ? cloudKeybinds : (cloudKeybinds.keybinds || cloudKeybinds);
        const merged = {
            ...current,
            keyBindings: {
                ...current.keyBindings,
                ...(keybinds.keyBindings || {}),
            },
            player2KeyBindings: {
                ...current.player2KeyBindings,
                ...(keybinds.player2KeyBindings || {}),
            },
            serenityKeyBindings: {
                ...current.serenityKeyBindings,
                ...(keybinds.serenityKeyBindings || {}),
            },
            serenityGamepadBindings: {
                ...current.serenityGamepadBindings,
                ...(keybinds.serenityGamepadBindings || {}),
            },
        };
        this.settingsManager.update(merged, true);
        this.settingsManager.save({ emitEvent: false });
    }

    _applyOdyssey(data) {
        if (!data) return;
        try {
            // Migrate BEFORE writing: this path bypasses OdysseyStateManager.load()
            // entirely, so an un-migrated cloud doc written raw would sit on disk
            // with stale level numbering until the next load happened to run.
            localStorage.setItem(ODYSSEY_STORAGE_KEY, JSON.stringify(migrateOdysseyProgressData(data)));
        } catch (err) {
            console.warn('[SteamCloud] Failed to apply Odyssey data:', err.message);
        }
    }

    async _applyHighScores(data, { merge = true } = {}) {
        if (!this.highScoreManager || !data) return;
        const entries = data.highScores || data.scores || [];
        await this.highScoreManager.importHighScores(entries, { merge });
    }

    async _applyStats(data, { merge = true } = {}) {
        if (!this.highScoreManager || !data) return;
        const stats = data.stats || data;
        await this.highScoreManager.importStatistics(stats, { merge });
    }

    _mergeData(fileName, localData, cloudData) {
        if (fileName === CLOUD_FILES.ODYSSEY) {
            return this._mergeOdyssey(localData, cloudData);
        }
        if (fileName === CLOUD_FILES.HIGHSCORES) {
            const localScores = localData.highScores || localData.scores || [];
            const cloudScores = cloudData.highScores || cloudData.scores || [];
            const mergedScores = this._mergeHighScores(localScores, cloudScores);
            return { ...localData, ...cloudData, highScores: mergedScores };
        }
        if (fileName === CLOUD_FILES.STATS) {
            const mergedStats = this._mergeStatistics(localData.stats || localData, cloudData.stats || cloudData);
            return { stats: mergedStats };
        }
        if (fileName === CLOUD_FILES.SETTINGS) {
            const localSettings = localData.settings || localData;
            const cloudSettings = cloudData.settings || cloudData;
            return { version: 1, settings: { ...localSettings, ...cloudSettings } };
        }
        if (fileName === CLOUD_FILES.KEYBINDS) {
            const localKeys = localData.keyBindings ? localData : (localData.keybinds || localData);
            const cloudKeys = cloudData.keyBindings ? cloudData : (cloudData.keybinds || cloudData);
            return {
                version: 1,
                keyBindings: { ...(localKeys.keyBindings || {}), ...(cloudKeys.keyBindings || {}) },
                player2KeyBindings: {
                    ...(localKeys.player2KeyBindings || {}),
                    ...(cloudKeys.player2KeyBindings || {}),
                },
                serenityKeyBindings: {
                    ...(localKeys.serenityKeyBindings || {}),
                    ...(cloudKeys.serenityKeyBindings || {}),
                },
                serenityGamepadBindings: {
                    ...(localKeys.serenityGamepadBindings || {}),
                    ...(cloudKeys.serenityGamepadBindings || {}),
                },
            };
        }
        return cloudData;
    }

    _mergeOdyssey(localData, cloudData) {
        // Version-gate BOTH sides before any id-keyed merge. Without this, a v1
        // cloud doc merged by raw id aliases old ch7 arrivals onto the new ch6
        // levels (false unlocks, kept stars), and the spread below would inherit
        // `version` from the CLOUD side — stamping version:1 onto an already-
        // migrated local save so the +4 shift ran a second time on the next load.
        migrateOdysseyProgressData(localData);
        migrateOdysseyProgressData(cloudData);
        const merged = { ...localData, ...cloudData };

        const localUnlocked = new Set(localData.unlockedLevels || []);
        const cloudUnlocked = new Set(cloudData.unlockedLevels || []);
        merged.unlockedLevels = Array.from(new Set([...localUnlocked, ...cloudUnlocked]));

        const localCompleted = localData.completedLevels || {};
        const cloudCompleted = cloudData.completedLevels || {};
        const mergedCompleted = { ...localCompleted };

        Object.entries(cloudCompleted).forEach(([levelId, cloudEntry]) => {
            const localEntry = mergedCompleted[levelId] || {};
            const mergedEntry = {
                ...localEntry,
                ...cloudEntry,
                stars: Math.max(localEntry.stars || 0, cloudEntry.stars || 0),
                bestScore: Math.max(localEntry.bestScore || 0, cloudEntry.bestScore || 0),
                bestTime: Math.min(
                    localEntry.bestTime || Number.POSITIVE_INFINITY,
                    cloudEntry.bestTime || Number.POSITIVE_INFINITY,
                ),
                attempts: Math.max(localEntry.attempts || 0, cloudEntry.attempts || 0),
            };

            if (!Number.isFinite(mergedEntry.bestTime)) {
                delete mergedEntry.bestTime;
            }

            const localBonuses = localEntry.completedBonuses || [];
            const cloudBonuses = cloudEntry.completedBonuses || [];
            if (localBonuses.length || cloudBonuses.length) {
                const maxLen = Math.max(localBonuses.length, cloudBonuses.length);
                const combined = [];
                for (let i = 0; i < maxLen; i++) {
                    combined[i] = Boolean(localBonuses[i] || cloudBonuses[i]);
                }
                mergedEntry.completedBonuses = combined;
            }

            const localDate = toTimestamp(localEntry.completionDate);
            const cloudDate = toTimestamp(cloudEntry.completionDate);
            if (localDate && cloudDate) {
                mergedEntry.completionDate = new Date(Math.min(localDate, cloudDate)).toISOString();
            } else if (cloudEntry.completionDate) {
                mergedEntry.completionDate = cloudEntry.completionDate;
            } else if (localEntry.completionDate) {
                mergedEntry.completionDate = localEntry.completionDate;
            }

            mergedCompleted[levelId] = mergedEntry;
        });

        merged.completedLevels = mergedCompleted;
        merged.currentChapter = Math.max(localData.currentChapter || 1, cloudData.currentChapter || 1);
        merged.currentLevel = Math.max(localData.currentLevel || 1, cloudData.currentLevel || 1);

        const localStats = localData.statistics || {};
        const cloudStats = cloudData.statistics || {};
        merged.statistics = {
            ...localStats,
            ...cloudStats,
            totalPlayTime: (localStats.totalPlayTime || 0) + (cloudStats.totalPlayTime || 0),
            totalLinesCleared: (localStats.totalLinesCleared || 0) + (cloudStats.totalLinesCleared || 0),
            totalScore: (localStats.totalScore || 0) + (cloudStats.totalScore || 0),
            highestCombo: Math.max(localStats.highestCombo || 0, cloudStats.highestCombo || 0),
            maxCascadeDepth: Math.max(localStats.maxCascadeDepth || 0, cloudStats.maxCascadeDepth || 0),
            chaptersCompleted: Math.max(localStats.chaptersCompleted || 0, cloudStats.chaptersCompleted || 0),
        };

        merged.statistics.totalStars = this._getTotalStars(merged.completedLevels);
        merged.lastSaveDate = new Date().toISOString();

        return merged;
    }

    _mergeHighScores(localScores, cloudScores) {
        const combined = [...localScores, ...cloudScores].map((entry) => ({
            ...entry,
        }));

        const deduped = [];
        const seen = new Set();
        for (const entry of combined) {
            const key = [
                entry.score ?? 0,
                entry.lines ?? 0,
                entry.level ?? 0,
                entry.timestamp ?? 0,
            ].join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(entry);
        }

        deduped.sort((a, b) => {
            if ((b.score ?? 0) !== (a.score ?? 0)) {
                return (b.score ?? 0) - (a.score ?? 0);
            }
            return (b.timestamp ?? 0) - (a.timestamp ?? 0);
        });

        return deduped.slice(0, 100);
    }

    _mergeStatistics(localStats, cloudStats) {
        const merged = {
            id: 'stats',
            totalGames: (localStats.totalGames || 0) + (cloudStats.totalGames || 0),
            totalScore: (localStats.totalScore || 0) + (cloudStats.totalScore || 0),
            totalLines: (localStats.totalLines || 0) + (cloudStats.totalLines || 0),
            highestScore: Math.max(localStats.highestScore || 0, cloudStats.highestScore || 0),
            highestLevel: Math.max(localStats.highestLevel || 0, cloudStats.highestLevel || 0),
            bestScorePerLevel: {
                ...(localStats.bestScorePerLevel || {}),
            },
        };

        const incomingPerLevel = cloudStats.bestScorePerLevel || {};
        Object.keys(incomingPerLevel).forEach((level) => {
            const current = merged.bestScorePerLevel[level] || 0;
            merged.bestScorePerLevel[level] = Math.max(current, incomingPerLevel[level] || 0);
        });

        return merged;
    }

    _getTotalStars(completedLevels) {
        return Object.values(completedLevels || {}).reduce((sum, entry) => sum + (entry?.stars || 0), 0);
    }

    async _buildLocalPayload(fileName, { includeUpdatedAt = true } = {}) {
        let payload = null;

        if (fileName === CLOUD_FILES.SETTINGS) {
            payload = this._exportSettings({ includeUpdatedAt });
        } else if (fileName === CLOUD_FILES.KEYBINDS) {
            payload = this._exportKeybinds({ includeUpdatedAt });
        } else if (fileName === CLOUD_FILES.ODYSSEY) {
            payload = this._exportOdyssey();
        } else if (fileName === CLOUD_FILES.HIGHSCORES) {
            payload = await this._exportHighScores({ includeUpdatedAt });
        } else if (fileName === CLOUD_FILES.STATS) {
            payload = await this._exportStats({ includeUpdatedAt });
        } else {
            return null;
        }

        if (!payload) return null;

        const json = JSON.stringify(payload);
        const hash = await this._computeHash(json);
        let updatedAt = this._deriveUpdatedAt(fileName, payload);
        if (!Number.isFinite(updatedAt)) {
            updatedAt = includeUpdatedAt ? Date.now() : 0;
        }

        return {
            json,
            hash,
            updatedAt,
            size: json.length,
        };
    }

    _exportSettings({ includeUpdatedAt = true } = {}) {
        if (!this.settingsManager) return null;
        const settings = this.settingsManager.get();
        const filtered = pickKeys(settings, CLOUD_SETTINGS_KEYS);
        const payload = {
            version: 1,
            settings: filtered,
        };
        if (includeUpdatedAt) {
            payload.updatedAt = Date.now();
        }
        return payload;
    }

    _exportKeybinds({ includeUpdatedAt = true } = {}) {
        if (!this.settingsManager) return null;
        const settings = this.settingsManager.get();
        const filtered = pickKeys(settings, CLOUD_KEYBIND_KEYS);
        const payload = {
            version: 1,
            ...filtered,
        };
        if (includeUpdatedAt) {
            payload.updatedAt = Date.now();
        }
        return payload;
    }

    _exportOdyssey() {
        try {
            const raw = localStorage.getItem(ODYSSEY_STORAGE_KEY);
            if (!raw) return null;
            const parsed = safeParse(raw);
            if (!parsed) return null;
            return parsed;
        } catch (err) {
            return null;
        }
    }

    async _exportHighScores({ includeUpdatedAt = true } = {}) {
        if (!this.highScoreManager) return null;
        const scores = await this.highScoreManager.exportHighScores(100);
        const payload = {
            version: 1,
            highScores: scores,
        };
        if (includeUpdatedAt) {
            payload.updatedAt = Date.now();
        }
        return payload;
    }

    async _exportStats({ includeUpdatedAt = true } = {}) {
        if (!this.highScoreManager) return null;
        const stats = await this.highScoreManager.exportStatistics();
        const payload = {
            version: 1,
            stats,
        };
        if (includeUpdatedAt) {
            payload.updatedAt = Date.now();
        }
        return payload;
    }

    async _computeHash(json) {
        if (textEncoder && typeof crypto !== 'undefined' && crypto.subtle?.digest) {
            const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(json));
            return Array.from(new Uint8Array(digest))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
        }
        return fallbackHash(json);
    }

    _loadManifest() {
        try {
            const stored = localStorage.getItem(STEAM_STORAGE_KEYS.CLOUD_MANIFEST);
            const parsed = stored ? JSON.parse(stored) : null;
            if (parsed && parsed.files) {
                parsed.deviceId = this.deviceId;
                return parsed;
            }
        } catch (err) {
            // ignore
        }
        return {
            schemaVersion: 1,
            deviceId: this.deviceId,
            updatedAt: 0,
            files: {},
        };
    }

    _saveManifest() {
        try {
            localStorage.setItem(STEAM_STORAGE_KEYS.CLOUD_MANIFEST, JSON.stringify(this.manifest));
        } catch (err) {
            console.warn('[SteamCloud] Failed to save manifest:', err.message);
        }
    }

    _updateManifestEntry(fileName, payload) {
        if (!this.manifest.files) {
            this.manifest.files = {};
        }
        const updatedAt = payload.updatedAt || Date.now();
        this.manifest.files[fileName] = {
            updatedAt,
            hash: payload.hash || null,
            size: payload.size || (payload.json ? payload.json.length : undefined),
        };
        this.manifest.updatedAt = Math.max(this.manifest.updatedAt || 0, updatedAt);
        this._saveManifest();
    }

    async _uploadManifest() {
        const json = JSON.stringify(this.manifest);
        const result = await steamService.cloudWrite(CLOUD_FILES.MANIFEST, json);
        if (result?.queued) {
            // Queued for a later flush by steamService; nothing to do here.
        }
    }

    async _pushAllLocal() {
        const files = Object.values(CLOUD_FILES).filter((file) => file !== CLOUD_FILES.MANIFEST);
        for (const file of files) {
            await this.queueUpload(file, { flush: true });
        }
    }

    async _bootstrapLocalManifest() {
        if (this.manifest?.files && Object.keys(this.manifest.files).length > 0) {
            return;
        }

        const files = Object.values(CLOUD_FILES).filter((file) => file !== CLOUD_FILES.MANIFEST);
        for (const file of files) {
            const payload = await this._buildLocalPayload(file, { includeUpdatedAt: false });
            if (!payload) continue;
            this._updateManifestEntry(file, payload);
        }
    }

    _deriveUpdatedAt(fileName, payload) {
        if (!payload) return null;
        if (payload.updatedAt && Number.isFinite(payload.updatedAt)) {
            return payload.updatedAt;
        }

        if (fileName === CLOUD_FILES.ODYSSEY) {
            const lastSave = toTimestamp(payload.lastSaveDate);
            if (lastSave) return lastSave;
        }

        if (fileName === CLOUD_FILES.HIGHSCORES) {
            const highScores = payload.highScores || [];
            const maxTs = highScores.reduce((max, entry) => {
                const ts = Number(entry.timestamp || 0);
                return ts > max ? ts : max;
            }, 0);
            if (maxTs) return maxTs;
        }

        return null;
    }

    _loadDeviceId() {
        try {
            const stored = localStorage.getItem(STEAM_STORAGE_KEYS.CLOUD_DEVICE_ID);
            if (stored) return stored;
        } catch (err) {
            // ignore
        }

        let id = null;
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            id = crypto.randomUUID();
        } else {
            id = `device-${Math.random().toString(36).slice(2, 10)}`;
        }

        try {
            localStorage.setItem(STEAM_STORAGE_KEYS.CLOUD_DEVICE_ID, id);
        } catch (err) {
            // ignore
        }

        return id;
    }
}

export default SteamCloudSyncManager;
