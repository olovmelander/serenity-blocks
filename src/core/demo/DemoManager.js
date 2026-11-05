/**
 * @fileoverview Demo Manager for Serenity Blocks
 * Handles storage, retrieval, and sharing of game demos
 */

import { openDatabaseOnce } from '../../utils/indexed-db-open.js';

// Retention cap (plan §5.0 step 2 "bank real session logs"): every game
// auto-saves a demo with full board checkpoints every 300 frames, and nothing
// ever pruned — unbounded growth invites the browser's storage-pressure
// eviction, which would silently wipe the WHOLE migration corpus. Keep the
// newest N; oldest are deleted after each save.
export const MAX_STORED_DEMOS = 200;

export class DemoManager {
    constructor() {
        this.db = null;
        this.DB_NAME = 'SerenityBlocksDemosDB';
        this.DB_VERSION = 1;
        this.STORE_NAME = 'demos';
    }

    /**
     * Opens the IndexedDB database once (utils/indexed-db-open.js: concurrent callers share it,
     * and it gives way to a newer version of the game in another tab).
     * @returns {Promise<void>}
     */
    async init() {
        return openDatabaseOnce(this, {
            name: this.DB_NAME,
            version: this.DB_VERSION,
            upgrade: (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    const store = db.createObjectStore(this.STORE_NAME, {
                        keyPath: 'id',
                        autoIncrement: true,
                    });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('score', 'metadata.finalScore', { unique: false });
                    store.createIndex('gameMode', 'gameMode', { unique: false });
                }
            },
        });
    }

    /**
     * Save a demo to storage
     * @param {Object} demo - Demo object to save
     * @returns {Promise<number>} ID of saved demo
     */
    async saveDemo(demo) {
        if (!this.db) await this.init();

        const savedId = await new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);

            // Ensure timestamp is present
            if (!demo.timestamp) demo.timestamp = Date.now();

            const request = store.add(demo);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        // Best-effort prune — a failed prune must never fail the save.
        try {
            await this._pruneOldDemos();
        } catch (err) {
            console.warn('[DemoManager] Demo prune failed (save succeeded):', err);
        }

        return savedId;
    }

    /**
     * Delete the oldest demos beyond MAX_STORED_DEMOS (by timestamp index).
     * @private
     */
    async _pruneOldDemos() {
        if (!this.db) return;
        await new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);
            const countRequest = store.count();
            countRequest.onerror = () => reject(countRequest.error);
            countRequest.onsuccess = () => {
                let excess = countRequest.result - MAX_STORED_DEMOS;
                if (excess <= 0) { resolve(); return; }
                // Walk the timestamp index ascending (oldest first), deleting.
                const cursorRequest = store.index('timestamp').openCursor();
                cursorRequest.onerror = () => reject(cursorRequest.error);
                cursorRequest.onsuccess = () => {
                    const cursor = cursorRequest.result;
                    if (!cursor || excess <= 0) { resolve(); return; }
                    cursor.delete();
                    excess -= 1;
                    cursor.continue();
                };
            };
        });
    }

    /**
     * Load a demo by ID
     * @param {number} id - Demo ID
     * @returns {Promise<Object>} Demo object
     */
    async loadDemo(id) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
            const store = transaction.objectStore(this.STORE_NAME);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * List demos with optional filtering and sorting
     * @param {{includeReplayData?: boolean}} options - Omit recording payloads for menu cards.
     * @returns {Promise<Array>} List of demos
     */
    async listDemos({ includeReplayData = true } = {}) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
            const store = transaction.objectStore(this.STORE_NAME);
            const index = store.index('timestamp');
            const request = index.openCursor(null, 'prev'); // Newest first

            const demos = [];
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const demo = cursor.value;
                    // Menu cards must not retain input/checkpoint payloads for
                    // every recording. Playback and sharing load one by ID.
                    demos.push(includeReplayData ? { ...demo, id: cursor.primaryKey } : {
                        id: cursor.primaryKey,
                        timestamp: demo.timestamp,
                        gameMode: demo.gameMode,
                        metadata: demo.metadata,
                    });
                    cursor.continue();
                } else {
                    resolve(demos);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete a demo
     * @param {number} id - Demo ID
     * @returns {Promise<void>}
     */
    async deleteDemo(id) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Export demo to JSON string, without this device's id: it means nothing on another.
     * @param {Object} demo - Demo object
     * @returns {string} JSON string
     */
    exportToJSON(demo) {
        const { id, ...portable } = demo;
        return JSON.stringify(portable, null, 2);
    }

    /**
     * Import demo from JSON string
     * @param {string} jsonStr - JSON string
     * @returns {Object} Demo object
     */
    importFromJSON(jsonStr) {
        try {
            const demo = JSON.parse(jsonStr);
            if (!demo.version || !demo.inputs) {
                throw new Error('Invalid demo format');
            }
            // The store numbers it: an id from a file could already be taken here.
            delete demo.id;
            return demo;
        } catch (e) {
            console.error('Failed to import demo:', e);
            return null;
        }
    }
}
