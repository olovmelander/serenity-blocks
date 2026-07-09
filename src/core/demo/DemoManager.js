/**
 * @fileoverview Demo Manager for Serenity Blocks
 * Handles storage, retrieval, and sharing of game demos
 */

export class DemoManager {
    constructor() {
        this.db = null;
        this.DB_NAME = 'SerenityBlocksDemosDB';
        this.DB_VERSION = 1;
        this.STORE_NAME = 'demos';
    }

    /**
     * Initializes the IndexedDB database
     * @returns {Promise<void>}
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
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
            };
        });
    }

    /**
     * Save a demo to storage
     * @param {Object} demo - Demo object to save
     * @returns {Promise<number>} ID of saved demo
     */
    async saveDemo(demo) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);

            // Ensure timestamp is present
            if (!demo.timestamp) demo.timestamp = Date.now();

            const request = store.add(demo);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
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
     * @returns {Promise<Array>} List of demos
     */
    async listDemos() {
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
                    // Apply filters here if needed
                    demos.push({
                        id: cursor.key,
                        ...demo,
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
     * Export demo to JSON string
     * @param {Object} demo - Demo object
     * @returns {string} JSON string
     */
    exportToJSON(demo) {
        return JSON.stringify(demo, null, 2);
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
            return demo;
        } catch (e) {
            console.error('Failed to import demo:', e);
            return null;
        }
    }

    /**
     * Generate a shareable URL for the demo (compressed)
     * @param {Object} demo - Demo object
     * @returns {Promise<string>} Shareable URL
     */
    async exportToURL(demo) {
        try {
            const jsonStr = JSON.stringify(demo);
            // Use CompressionStream if available (modern browsers)
            if (window.CompressionStream) {
                const stream = new Blob([jsonStr]).stream();
                const compressedReadableStream = stream.pipeThrough(new CompressionStream('gzip'));
                const compressedResponse = await new Response(compressedReadableStream);
                const blob = await compressedResponse.blob();
                const buffer = await blob.arrayBuffer();
                // Convert to base64
                const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
                return `${window.location.origin}${window.location.pathname}?demo=${base64}`;
            }
            // Fallback or just return error
            console.warn('CompressionStream not supported');
            return null;
        } catch (e) {
            console.error('Failed to export to URL:', e);
            return null;
        }
    }

    /**
     * Import demo from URL parameter
     * @param {string} base64Data - Base64 encoded compressed data
     * @returns {Promise<Object>} Demo object
     */
    async importFromURL(base64Data) {
        try {
            if (window.DecompressionStream) {
                const binaryString = atob(base64Data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                const stream = new Blob([bytes]).stream();
                const decompressedReadableStream = stream.pipeThrough(new DecompressionStream('gzip'));
                const resp = await new Response(decompressedReadableStream);
                const jsonStr = await resp.text();
                return JSON.parse(jsonStr);
            }
        } catch (e) {
            console.error('Failed to import from URL:', e);
            return null;
        }
        return null;
    }
}
