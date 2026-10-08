import {
    THEME_COLLECTION_STORAGE_KEY,
    THEME_COLLECTION_RECOVERY_STORAGE_KEY,
    THEME_COLLECTION_VERSION,
    ODYSSEY_PROGRESS_STORAGE_KEY,
    createThemeCollectionData,
    getValidCompletedLevels,
    mergeThemeCollections,
    normalizeThemeCollection,
    sameThemeCollection,
} from './theme-collection-model.js';

/** Local-first collection with recoverable Odyssey grants and no presentation effects. */
export class ThemeCollectionService {
    constructor({
        catalog, levels, rules = [], resolveThemeId = (id) => id,
        migrateProgress = (data) => data, storage = null, now = () => 0,
    }) {
        this.catalog = catalog;
        this.levels = levels;
        this.rules = rules;
        this.resolveThemeId = resolveThemeId;
        this.migrateProgress = migrateProgress;
        this.storage = storage;
        this.now = now;
        this.listeners = new Set();
        this.revision = 0;
        this.readOnly = false;
        this.persistenceStatus = storage ? 'ready' : 'storage-unavailable';
        this.corruptDocument = null;
        this.recoveryCommitRequired = false;
        this.data = createThemeCollectionData();
        this.knownIds = new Set(catalog.map((theme) => theme.id));
        this.load();
        this.reconcileFromOdyssey(undefined, { silent: true });
    }

    load() {
        let raw;
        try {
            raw = this.storage?.getItem(THEME_COLLECTION_STORAGE_KEY);
            if (raw === null || raw === undefined) {
                this.readOnly = false;
                this.persistenceStatus = this.storage ? 'ready' : 'storage-unavailable';
                return;
            }
        } catch {
            this.readOnly = true;
            this.persistenceStatus = 'storage-unavailable';
            return;
        }
        let parsed;
        try { parsed = JSON.parse(raw); } catch { /* Preserve the exact raw document before recovery. */ }
        if (Number(parsed?.version) > THEME_COLLECTION_VERSION) {
            this.readOnly = true;
            this.persistenceStatus = 'unsupported-version';
            return;
        }
        const normalized = normalizeThemeCollection(parsed, this.resolveThemeId);
        if (!normalized) {
            this.corruptDocument = raw;
            this.readOnly = true;
            return;
        }
        this.data = normalized;
        this.readOnly = false;
        this.persistenceStatus = 'ready';
    }

    _prepareRecovery() {
        if (this.persistenceStatus === 'storage-unavailable' && this.storage) this.load();
        if (this.corruptDocument === null) return !this.readOnly;
        try {
            const latest = this.storage.getItem(THEME_COLLECTION_STORAGE_KEY);
            if (latest !== this.corruptDocument) {
                // Respect a repair made by another owner before this retry.
                this.corruptDocument = null;
                this.readOnly = false;
                this.load();
                if (this.corruptDocument === null) return !this.readOnly;
            }
            this.storage.setItem(THEME_COLLECTION_RECOVERY_STORAGE_KEY, this.corruptDocument);
            this.readOnly = false;
            this.recoveryCommitRequired = true;
            return true;
        } catch {
            this.readOnly = true;
            this.persistenceStatus = 'backup-failed';
            return false;
        }
    }

    getPersistenceStatus() {
        return {
            status: this.persistenceStatus,
            readOnly: this.readOnly,
            canRetry: this.persistenceStatus !== 'unsupported-version',
        };
    }

    readOdysseyProgress() {
        try {
            const raw = this.storage?.getItem(ODYSSEY_PROGRESS_STORAGE_KEY);
            return raw ? this.migrateProgress(JSON.parse(raw)) : null;
        } catch {
            return null;
        }
    }

    isUnlocked(id) {
        const canonical = this.resolveThemeId(id);
        return this.knownIds.has(canonical) && Object.hasOwn(this.data.grants, canonical);
    }

    getOwnedThemeIds() {
        return this.catalog.filter(({ id }) => this.isUnlocked(id)).map(({ id }) => id);
    }

    getSummary() {
        const owned = this.getOwnedThemeIds();
        return {
            owned: owned.length,
            total: this.catalog.length,
            newCount: owned.filter((id) => !this.data.seenThemeIds.includes(id)).length,
        };
    }

    getThemeStatus(rawId) {
        const themeId = this.resolveThemeId(rawId);
        const level = this.levels.find((entry) => this.resolveThemeId(entry.theme?.primary) === themeId);
        const rule = this.rules.find((entry) => entry.themeIds.includes(themeId));
        let requirement = { type: 'unavailable', label: 'No Odyssey unlock route is available yet.' };
        if (themeId === 'forest') requirement = { type: 'starter', label: 'Your starting theme.' };
        else if (level) {
            requirement = {
                type: 'orb',
                levelId: level.id,
                chapterId: level.chapter,
                label: `Complete Odyssey orb ${level.id} · ${level.name}.`,
            };
        } else if (rule) {
            requirement = {
                type: rule.type,
                ...(rule.chapterId ? { chapterId: rule.chapterId } : {}),
                ...(rule.count ? { count: rule.count } : {}),
                label: rule.label,
            };
        }
        const owned = this.isUnlocked(themeId);
        return {
            themeId, owned, isNew: owned && !this.data.seenThemeIds.includes(themeId), requirement,
        };
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    _publish(source, receipt) {
        const event = { source, receipt, summary: this.getSummary() };
        this.listeners.forEach((listener) => {
            try { listener(event); } catch (error) { console.warn('[ThemeCollection] Listener failed:', error); }
        });
    }

    exportData() {
        return JSON.parse(JSON.stringify(this.data));
    }

    _receipt(themeIds, persisted, sourceLevelId = null) {
        const summary = this.getSummary();
        return {
            themeIds, totalOwned: summary.owned, totalThemes: summary.total, persisted, sourceLevelId,
        };
    }

    _persist(next, source, themeIds = [], sourceLevelId = null) {
        if (this.readOnly || !this.storage?.setItem) return this._receipt([], false, sourceLevelId);
        try {
            this.storage.setItem(THEME_COLLECTION_STORAGE_KEY, JSON.stringify(next));
        } catch (error) {
            console.warn('[ThemeCollection] Collection save failed:', error);
            this.persistenceStatus = 'write-failed';
            return this._receipt([], false, sourceLevelId);
        }
        this.data = next;
        this.persistenceStatus = 'ready';
        this.corruptDocument = null;
        this.recoveryCommitRequired = false;
        this.revision += 1;
        const receipt = this._receipt(themeIds, true, sourceLevelId);
        this._publish(source, receipt);
        return receipt;
    }

    _collectFromProgress(progress, { silent = true, sourceLevelId = null, themeId = null } = {}) {
        const completed = getValidCompletedLevels(progress, this.levels);
        const next = this.exportData();
        const earned = [];
        const add = (rawId, source, levelId, earnedAt) => {
            const id = this.resolveThemeId(rawId);
            if (!this.knownIds.has(id) || Object.hasOwn(next.grants, id)) return;
            next.grants[id] = { source, ...(levelId ? { levelId } : {}), earnedAt };
            earned.push(id);
        };
        const earnedAt = new Date(this.now()).toISOString();
        completed.forEach((completion, levelId) => {
            const level = this.levels.find((entry) => entry.id === levelId);
            // A persisted snapshot survives a future re-theme of this authored orb.
            const played = levelId === sourceLevelId && themeId
                ? themeId : completion.themeId || level.theme?.primary;
            add(
                played,
                'odyssey',
                levelId,
                Number.isFinite(Date.parse(completion.completionDate)) ? completion.completionDate : earnedAt,
            );
        });
        this.rules.forEach((rule) => {
            const required = rule.type === 'chapter'
                ? this.levels.filter((level) => level.chapter === rule.chapterId) : this.levels;
            const eligible = rule.type === 'milestone' ? completed.size >= rule.count
                : required.length > 0 && required.every((level) => completed.has(level.id));
            if (eligible) rule.themeIds.forEach((id) => add(id, rule.type, sourceLevelId, earnedAt));
        });
        if (earned.length === 0 && !this.recoveryCommitRequired) return this._receipt([], true, sourceLevelId);
        const playedIndex = earned.indexOf(this.resolveThemeId(themeId));
        if (playedIndex > 0) earned.unshift(...earned.splice(playedIndex, 1));
        if (silent) next.seenThemeIds.push(...earned);
        next.updatedAt = this.now();
        const normalized = normalizeThemeCollection(next, this.resolveThemeId);
        return this._persist(normalized, silent ? 'reconcile' : 'award', earned, sourceLevelId);
    }

    reconcileFromOdyssey(progress, { silent = true } = {}) {
        if (!this._prepareRecovery()) return this._receipt([], false);
        const savedProgress = progress === undefined ? this.readOdysseyProgress() : progress;
        if (!savedProgress || typeof savedProgress !== 'object') {
            return this.recoveryCommitRequired
                ? this._collectFromProgress(null, { silent }) : this._receipt([], true);
        }
        const snapshot = savedProgress.getSaveData?.() || savedProgress;
        const migrated = this.migrateProgress(JSON.parse(JSON.stringify(snapshot)));
        // Future schemas must not be interpreted as current campaign completion.
        if (Number(migrated?.version) !== 2) return this._receipt([], false);
        return this._collectFromProgress(migrated, { silent });
    }

    awardCompletion({ levelId, themeId, progressPersisted } = {}) {
        if (progressPersisted !== true || !Number.isSafeInteger(levelId)) return this._receipt([], false, levelId);
        if (!this._prepareRecovery()) return this._receipt([], false, levelId);
        const progress = this.readOdysseyProgress();
        if (Number(progress?.version) !== 2) return this._receipt([], false, levelId);
        const completed = getValidCompletedLevels(progress, this.levels);
        const expectedTheme = completed.get(levelId)?.themeId
            || this.levels.find((level) => level.id === levelId)?.theme?.primary;
        if (!completed.has(levelId) || !this.knownIds.has(this.resolveThemeId(themeId))
            || this.resolveThemeId(themeId) !== this.resolveThemeId(expectedTheme)) {
            return this._receipt([], false, levelId);
        }
        return this._collectFromProgress(progress, { silent: false, sourceLevelId: levelId, themeId });
    }

    markSeen(rawId) {
        const id = this.resolveThemeId(rawId);
        if (!this.isUnlocked(id) || this.data.seenThemeIds.includes(id)) return this.isUnlocked(id);
        const next = this.exportData();
        next.seenThemeIds.push(id);
        next.updatedAt = this.now();
        return this._persist(normalizeThemeCollection(next, this.resolveThemeId), 'seen').persisted;
    }

    /** Cloud ownership is always a union; cloud imports never trigger a celebration. */
    applyCloudData(data) {
        const merged = mergeThemeCollections(this.data, data, this.resolveThemeId);
        if (!merged) return false;
        if (sameThemeCollection(merged, this.data)) return true;
        return this._persist(merged, 'cloud').persisted;
    }
}
