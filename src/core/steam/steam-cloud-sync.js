import steamService from './steam-service.js';
import { STEAM_EVENTS, STEAM_STORAGE_KEYS } from './steam-config.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { migrateOdysseyProgressData } from '../odyssey/OdysseyStateManager.js';
import { ODYSSEY_SAVE_VERSION, getOdysseyCompletionThemeIds } from '../odyssey/odyssey-progress-schema.js';

const CLOUD_FILES = {
    MANIFEST: 'cloud_manifest.json',
    UNLOCKS: 'unlocks.json',
    ODYSSEY: 'odyssey.json',
    SETTINGS: 'settings.json',
    KEYBINDS: 'keybinds.json',
    HIGHSCORES: 'highscores.json',
    STATS: 'stats.json',
};

const ODYSSEY_STORAGE_KEY = 'serenityBlocks_odysseyProgress';
const cloudWallClock = () => Date.now();

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

const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);
const isCompletedOrb = (value) => isRecord(value)
    && Number.isInteger(value.stars) && value.stars >= 1 && value.stars <= 3;

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
    constructor({
        settingsManager, highScoreManager, themeCollection, getOdysseyState, now = cloudWallClock,
    } = {}) {
        this.now = now;
        this.settingsManager = settingsManager || null;
        this.highScoreManager = highScoreManager || null;
        this.themeCollection = themeCollection || null;
        this.getOdysseyState = getOdysseyState || (() => null);

        this.deviceId = this._loadDeviceId();
        this.manifest = this._loadManifest();
        this.pendingUploads = new Map();
        this.flushTimer = null;
        this.debounceMs = 1500;
        this.syncInProgress = false;
        this.suppressLocalEvents = false;
        this.periodicTimer = null;
        this.flushPromise = null;
        this.flushRequested = false;
        this.uploadingFiles = new Set();
    }

    initialize() {
        this._registerEventHandlers();
        this._scheduleInitialSync();
        this._schedulePeriodicSync();
    }

    _registerEventHandlers() {
        this.themeCollection?.subscribe((event) => {
            if (this.suppressLocalEvents || event.source === 'cloud') return;
            this.queueUpload(CLOUD_FILES.UNLOCKS);
        });
        eventBus.on(EVENTS.SETTINGS_CHANGED, (event) => {
            if (this.suppressLocalEvents) return;
            const dirtyKeys = event?.dirtyKeys;
            // Older save callers omit metadata; keep their full sync behavior.
            if (!dirtyKeys || dirtyKeys.some((key) => CLOUD_SETTINGS_KEYS.includes(key))) {
                this.queueUpload(CLOUD_FILES.SETTINGS);
            }
            if (!dirtyKeys || dirtyKeys.some((key) => CLOUD_KEYBIND_KEYS.includes(key))) {
                this.queueUpload(CLOUD_FILES.KEYBINDS);
            }
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

        // Queue only the dirty category. Export, serialization and hashing happen
        // once after the debounce, using the latest settings rather than each input.
        this.pendingUploads.set(fileName, { queuedAt: this.now() });
        if (flush) {
            if (this.flushPromise) await this.flushPromise;
            await this._flushPendingUploads();
        } else this._scheduleFlush();
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
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.flushPromise) {
            this.flushRequested = true;
            await this.flushPromise;
            return;
        }
        if (this.pendingUploads.size === 0) return;
        this.flushPromise = this._flushUploadEntries();
        try {
            await this.flushPromise;
        } finally {
            this.flushPromise = null;
            if (this.flushRequested) {
                this.flushRequested = false;
                if (this.pendingUploads.size > 0) this._scheduleFlush();
            }
        }
    }

    async _flushUploadEntries() {
        const capabilities = steamService.getCapabilities ? steamService.getCapabilities() : {};
        if (steamService.isAvailable?.() && capabilities.cloud === false) return;

        const entries = Array.from(this.pendingUploads.entries());
        this.pendingUploads.clear();
        for (const [fileName, entry] of entries) {
            const { payload: cachedPayload } = entry;
            let payload = cachedPayload;
            this.uploadingFiles.add(fileName);
            try {
                if (fileName === CLOUD_FILES.UNLOCKS && this.themeCollection) {
                    // A queued local grant can upload BEFORE initial sync, or
                    // after another device earned a reward. Read and union at
                    // the write boundary too; otherwise this upload would erase
                    // the only remote copy before reconciliation could read it.
                    // eslint-disable-next-line no-await-in-loop -- Union must precede this document's upload.
                    const remote = await steamService.cloudRead(fileName);
                    if (!remote?.supported || remote.success === false) {
                        throw new Error('Collection cloud read unavailable');
                    }
                    if (remote.data) {
                        const data = safeParse(remote.data);
                        if (!data || !this.themeCollection.applyCloudData(data)) {
                            throw new Error('Collection cloud document could not be preserved');
                        }
                    }
                    // A retry must export the current union, never the cached
                    // pre-union snapshot retained after an earlier failed write.
                    payload = null;
                }
                if (fileName === CLOUD_FILES.ODYSSEY) {
                    // Played-theme history can be the only recovery evidence
                    // after a collection write fails. Preserve remote history
                    // before every upload, including a newer local clock.
                    // eslint-disable-next-line no-await-in-loop -- Union must precede the Odyssey upload.
                    const remote = await steamService.cloudRead(fileName);
                    if (!remote?.supported || remote.success === false) {
                        throw new Error('Odyssey cloud read unavailable');
                    }
                    const local = this._exportOdyssey();
                    const incoming = remote.data ? safeParse(remote.data) : local;
                    if (!local || !incoming || !this._applyOdyssey(incoming)) {
                        throw new Error('Odyssey cloud document could not be preserved');
                    }
                    payload = null;
                }
                payload ||= await this._buildLocalPayload(fileName, {
                    includeUpdatedAt: true, updatedAt: entry.queuedAt,
                });
                if (!payload) continue;
                const result = await steamService.cloudWrite(
                    fileName,
                    payload.json,
                    fileName === CLOUD_FILES.UNLOCKS || fileName === CLOUD_FILES.ODYSSEY
                        ? { queueIfOffline: false } : undefined,
                );
                if (result?.supported && result.success !== false && !result.queued) {
                    this._updateManifestEntry(fileName, payload);
                    continue;
                }
            } catch (error) {
                console.warn('[SteamCloud] Upload deferred:', fileName, error.message);
            } finally {
                this.uploadingFiles.delete(fileName);
            }
            // Retain the exact failed payload, but never replace newer edits that
            // arrived while hashing or uploading this entry.
            if (!this.pendingUploads.has(fileName)) {
                this.pendingUploads.set(fileName, { ...entry, payload });
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
            if (!manifestResponse?.supported || manifestResponse.success === false) {
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
        // Local edits remain the authority until their queued snapshot has been
        // built and acknowledged. A cloud refresh must not replace that source
        // while the debounce or an asynchronous upload is still in progress.
        if (this.flushPromise) await this.flushPromise;
        if (this.pendingUploads.has(fileName)) {
            await this._flushPendingUploads();
            if (this.pendingUploads.has(fileName)) return;
        }
        const localEntry = this.manifest.files?.[fileName] || null;
        const cloudEntry = cloudManifest.files?.[fileName] || null;

        // Cosmetic ownership is monotonic on EVERY device/clock ordering, not
        // just the timestamp-tie conflict path used by settings documents.
        if (fileName === CLOUD_FILES.UNLOCKS && this.themeCollection) {
            const liveHash = await this._computeHash(JSON.stringify(this.themeCollection.exportData()));
            if (cloudEntry && (localEntry?.hash !== cloudEntry.hash || liveHash !== cloudEntry.hash)) {
                await this._mergeUnlocksFromCloud();
            } else if (!cloudEntry) await this.queueUpload(fileName, { flush: true });
            return;
        }

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

    async _mergeUnlocksFromCloud() {
        const response = await steamService.cloudRead(CLOUD_FILES.UNLOCKS);
        if (!response?.supported || response.success === false || !response.data) return;
        const incoming = safeParse(response.data);
        if (!incoming) return;
        // Apply against the LIVE collection after the asynchronous read. A
        // local award made during that read is unioned, never replaced by the
        // stale read snapshot. applyCloudData writes synchronously and notifies
        // existing UI owners only after durable storage succeeds.
        if (!this.themeCollection.applyCloudData(incoming)) return;
        // Export at flush time, using the uploader's existing pending/in-flight
        // guards so grants or seen changes during hashing/upload stay queued.
        await this.queueUpload(CLOUD_FILES.UNLOCKS, { flush: true });
    }

    _captureLocalReadState(fileName) {
        const keys = fileName === CLOUD_FILES.SETTINGS ? CLOUD_SETTINGS_KEYS : (
            fileName === CLOUD_FILES.KEYBINDS ? CLOUD_KEYBIND_KEYS : null
        );
        return {
            entry: this.manifest.files?.[fileName],
            keys,
            // Snapshot only at a cloud read boundary, never on slider input.
            settings: keys && this.settingsManager
                ? JSON.stringify(pickKeys(this.settingsManager.get(), keys)) : null,
        };
    }

    _flushLiveSettingsBeforeCloudApply(fileName) {
        if (fileName === CLOUD_FILES.SETTINGS || fileName === CLOUD_FILES.KEYBINDS) {
            // Persist live edits before the cloud apply suppresses local events.
            // Even an edit in the OTHER category needs its upload notification;
            // the following emitEvent:false save otherwise absorbs that change.
            this.settingsManager?.flushPendingSave?.();
        }
    }

    _hasLocalChangesSinceRead(fileName, snapshot) {
        if (this.pendingUploads.has(fileName) || this.uploadingFiles.has(fileName)
            || this.manifest.files?.[fileName] !== snapshot.entry) return true;
        if (!snapshot.keys || !this.settingsManager) return false;
        if (snapshot.keys.some((key) => this.settingsManager.dirtyKeys?.has(key))) return true;
        return snapshot.settings !== JSON.stringify(pickKeys(this.settingsManager.get(), snapshot.keys));
    }

    async _downloadAndApply(fileName, cloudEntry) {
        const localSnapshot = this._captureLocalReadState(fileName);
        const response = await steamService.cloudRead(fileName);
        if (!response?.supported || response.success === false || !response.data) return;

        const parsed = safeParse(response.data);
        if (!parsed) return;
        // Finish hashing before the final guard. A newer acknowledged local
        // upload during this await invalidates the incoming data and manifest.
        const hash = await this._computeHash(response.data);
        this._flushLiveSettingsBeforeCloudApply(fileName);
        if (this._hasLocalChangesSinceRead(fileName, localSnapshot)) return;

        const application = this._applyCloudData(fileName, parsed);
        const appliedSnapshot = this._captureLocalReadState(fileName);
        const applied = await application;
        if (applied === false) return;
        if (this._hasLocalChangesSinceRead(fileName, appliedSnapshot)) return;
        if (fileName === CLOUD_FILES.ODYSSEY) {
            // The disk now holds a union, which can differ from the download.
            // Only a successful upload may acknowledge that union's manifest.
            await this.queueUpload(fileName, { flush: true });
            return;
        }
        const updatedAt = cloudEntry?.updatedAt || this.now();
        this._updateManifestEntry(fileName, { hash, updatedAt, json: response.data });
    }

    async _mergeConflict(fileName, cloudEntry) {
        const localSnapshot = this._captureLocalReadState(fileName);
        const response = await steamService.cloudRead(fileName);
        if (!response?.supported || response.success === false || !response.data) return;
        const cloudData = safeParse(response.data);
        if (!cloudData) return;
        this._flushLiveSettingsBeforeCloudApply(fileName);
        if (this._hasLocalChangesSinceRead(fileName, localSnapshot)) return;

        const localPayload = await this._buildLocalPayload(fileName);
        const localData = safeParse(localPayload?.json);
        if (!localPayload || !localData) return;
        this._flushLiveSettingsBeforeCloudApply(fileName);
        if (this._hasLocalChangesSinceRead(fileName, localSnapshot)) return;

        const merged = this._mergeData(fileName, localData, cloudData);
        if (!merged) return;

        if (fileName === CLOUD_FILES.HIGHSCORES) {
            await this._applyHighScores(merged, { merge: false });
        } else if (fileName === CLOUD_FILES.STATS) {
            await this._applyStats(merged, { merge: false });
        } else if (fileName === CLOUD_FILES.ODYSSEY) {
            if (!this._applyOdyssey(merged)) return;
        } else if (fileName === CLOUD_FILES.SETTINGS) {
            this._applySettings(merged.settings || merged);
        } else if (fileName === CLOUD_FILES.KEYBINDS) {
            this._applyKeybinds(merged);
        }
        await this.queueUpload(fileName, { flush: true });
        if (fileName === CLOUD_FILES.ODYSSEY) return;

        const hash = await this._computeHash(JSON.stringify(merged));
        this._updateManifestEntry(fileName, {
            hash,
            updatedAt: this.now(),
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
                return this._applyOdyssey(data);
            } else if (fileName === CLOUD_FILES.HIGHSCORES) {
                await this._applyHighScores(data);
            } else if (fileName === CLOUD_FILES.STATS) {
                await this._applyStats(data);
            } else if (fileName === CLOUD_FILES.UNLOCKS) {
                this.themeCollection?.applyCloudData(data);
            }
        } finally {
            this.suppressLocalEvents = false;
        }
        return undefined;
    }

    _applySettings(cloudSettings) {
        if (!this.settingsManager || !cloudSettings) return;
        const current = this.settingsManager.get();
        const merged = {
            ...current,
            ...cloudSettings,
        };
        if (this.themeCollection && merged.backgroundTheme) {
            const requested = this.themeCollection.getThemeStatus(merged.backgroundTheme).themeId;
            merged.backgroundTheme = this.themeCollection.isUnlocked(requested) ? requested : 'forest';
        }
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
        if (!isRecord(data)) return false;
        try {
            // Migrate BEFORE writing: this path bypasses OdysseyStateManager.load()
            // entirely, so an un-migrated cloud doc written raw would sit on disk
            // with stale level numbering until the next load happened to run.
            migrateOdysseyProgressData(data);
            if (Number(data.version) !== ODYSSEY_SAVE_VERSION) return false;
            const rawLocal = localStorage.getItem(ODYSSEY_STORAGE_KEY);
            const local = rawLocal ? safeParse(rawLocal) : { version: ODYSSEY_SAVE_VERSION };
            // Validate both sides, including a future local save, before any
            // replacement. Unequal timestamps must preserve completion history.
            const merged = this._mergeOdyssey(local, data);
            if (!merged) return false;
            localStorage.setItem(ODYSSEY_STORAGE_KEY, JSON.stringify(merged));
            // Refresh progress fields only. load() leaves the active attempt,
            // session clock and current-level attempt counter untouched.
            this.getOdysseyState()?.load();
            this.themeCollection?.reconcileFromOdyssey(merged, { silent: true });
            // The cloud-apply event suppression must not swallow newly recovered
            // ownership when an older device only uploaded Odyssey progress.
            if (this.themeCollection) this.queueUpload(CLOUD_FILES.UNLOCKS);
            return true;
        } catch (err) {
            console.warn('[SteamCloud] Failed to apply Odyssey data:', err.message);
            return false;
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
        if (!isRecord(localData) || !isRecord(cloudData)) return null;
        // Version-gate BOTH sides before any id-keyed merge. Without this, a v1
        // cloud doc merged by raw id aliases old ch7 arrivals onto the new ch6
        // levels (false unlocks, kept stars), and the spread below would inherit
        // `version` from the CLOUD side — stamping version:1 onto an already-
        // migrated local save so the +4 shift ran a second time on the next load.
        migrateOdysseyProgressData(localData);
        migrateOdysseyProgressData(cloudData);
        if (Number(localData?.version) !== ODYSSEY_SAVE_VERSION
            || Number(cloudData?.version) !== ODYSSEY_SAVE_VERSION) return null;
        const merged = { ...localData, ...cloudData };

        const localUnlocked = new Set(localData.unlockedLevels || []);
        const cloudUnlocked = new Set(cloudData.unlockedLevels || []);
        merged.unlockedLevels = Array.from(new Set([...localUnlocked, ...cloudUnlocked]));

        const localCompleted = localData.completedLevels || {};
        const cloudCompleted = cloudData.completedLevels || {};
        const mergedCompleted = Object.fromEntries(Object.entries(localCompleted)
            .filter(([, entry]) => isCompletedOrb(entry)));

        Object.entries(cloudCompleted).forEach(([levelId, cloudEntry]) => {
            if (!isCompletedOrb(cloudEntry)) return;
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
                themeIds: getOdysseyCompletionThemeIds({
                    themeIds: [
                        ...getOdysseyCompletionThemeIds(localEntry),
                        ...getOdysseyCompletionThemeIds(cloudEntry),
                    ],
                }),
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
            // These are cumulative snapshots, not deltas. Repeated unions must
            // never count the same saved play session more than once.
            totalPlayTime: Math.max(localStats.totalPlayTime || 0, cloudStats.totalPlayTime || 0),
            totalLinesCleared: Math.max(localStats.totalLinesCleared || 0, cloudStats.totalLinesCleared || 0),
            totalScore: Math.max(localStats.totalScore || 0, cloudStats.totalScore || 0),
            totalAttempts: Math.max(localStats.totalAttempts || 0, cloudStats.totalAttempts || 0),
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

    async _buildLocalPayload(fileName, { includeUpdatedAt = true, updatedAt: queuedAt } = {}) {
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
        } else if (fileName === CLOUD_FILES.UNLOCKS) {
            payload = this.themeCollection?.exportData() || null;
        } else {
            return null;
        }

        if (!payload) return null;
        if (fileName !== CLOUD_FILES.UNLOCKS && includeUpdatedAt
            && Number.isFinite(queuedAt) && payload.updatedAt !== undefined) {
            payload.updatedAt = queuedAt;
        }

        const json = JSON.stringify(payload);
        const hash = await this._computeHash(json);
        let updatedAt = this._deriveUpdatedAt(fileName, payload);
        if (!Number.isFinite(updatedAt)) {
            updatedAt = includeUpdatedAt ? this.now() : 0;
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
            payload.updatedAt = this.now();
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
            payload.updatedAt = this.now();
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
            payload.updatedAt = this.now();
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
            payload.updatedAt = this.now();
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
        const updatedAt = payload.updatedAt || this.now();
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
