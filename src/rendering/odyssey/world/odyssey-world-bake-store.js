// @ts-check
/**
 * @fileoverview The One World bake kept across launches (perf audit 2026-10-28).
 *
 * The boot bake (odyssey-world-bake-loader.js) is deterministic and depends only on its request
 * and on the code that runs it, yet every launch baked it again: ~3 s of CPU over four or five
 * workers on the audit's cloud runner, 37-43 MB out, on the way to the first map. This keeps the
 * landed arrays in IndexedDB under a key the loader builds from both (a production chunk's URL
 * names its content hash), so the next launch reads them instead.
 *
 * Two records in one store: `meta` (the key it was baked under, a few KB) and `data` (the arrays).
 * A read takes the meta first, so a stale copy costs a small read, not the whole copy, and the
 * loader starts its workers as soon as it knows; `data` is read only on a match. Both are written
 * in one transaction, so a reader never sees a meta without its data. Nothing here throws: any
 * failure (no IndexedDB, a full disk, another tab upgrading the database) reads as a miss or a
 * write not made, and the bake runs as it always has.
 */

import { openDatabaseOnce } from '../../../utils/indexed-db-open.js';

const DB_NAME = 'serenity-blocks-odyssey-world';
const DB_VERSION = 1;
const STORE = 'bake';

/**
 * Devices that report less memory keep no copy: writing one clones the whole bake once more on
 * the main thread (Chromium reports deviceMemory rounded to a power of two, capped at 8).
 */
const MIN_DEVICE_MEMORY_GB = 4;

/** @typedef {{db: IDBDatabase | null, _opening?: Promise<void> | null}} BakeConnection */

/** One connection for the page, shared by every read and write. @type {BakeConnection} */
const pageConnection = { db: null, _opening: null };

/**
 * @typedef {object} BakeStoreOptions
 * @property {IDBFactory} [indexedDB]
 * @property {BakeConnection} [connection] where the open connection lives (tests pass their own)
 */

/**
 * Whether this page can keep a copy at all.
 * @param {{indexedDB?: unknown, deviceMemory?: unknown}} [env]
 * @returns {boolean}
 */
export function worldBakeStoreAvailable({
    indexedDB = globalThis.indexedDB,
    deviceMemory = /** @type {{deviceMemory?: number}|undefined} */ (globalThis.navigator)?.deviceMemory,
} = {}) {
    if (!indexedDB || typeof (/** @type {IDBFactory} */ (indexedDB)).open !== 'function') return false;
    return typeof deviceMemory !== 'number' || deviceMemory >= MIN_DEVICE_MEMORY_GB;
}

/**
 * @param {BakeStoreOptions} options
 * @returns {Promise<IDBDatabase>}
 */
async function openBakeDatabase({ indexedDB = globalThis.indexedDB, connection = pageConnection }) {
    await openDatabaseOnce(connection, {
        name: DB_NAME,
        version: DB_VERSION,
        indexedDB,
        upgrade: (event) => {
            const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        },
    });
    if (!connection.db) throw new Error(`${DB_NAME}: no connection`);
    return connection.db;
}

/**
 * @param {IDBDatabase} db
 * @param {string} id
 * @returns {Promise<any>}
 */
function getRecord(db, id) {
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/** @param {unknown} value @param {number} length */
function isTyped(value, length = -1) {
    return ArrayBuffer.isView(value) && !(value instanceof DataView)
        && (length < 0 || /** @type {Uint8Array} */ (value).length === length);
}

/**
 * Whether a stored copy has the shape the board consumes for this request. The bytes are the
 * bake's; this catches a copy from an older format or a damaged record, which read as a miss.
 * @param {any} stored
 * @param {{reliefRes: number, shadowRes: number, cloudField?: boolean, cloudSpecs?: unknown[]|null, scatter?: object|null}} request
 * @returns {boolean}
 */
export function isUsableStoredWorldBake(stored, request) {
    const {
        relief, textures, cloudField: field, scatter: zoned,
    } = stored || {};
    const { reliefRes: res, shadowRes } = request;
    if (!relief || relief.res !== res || !isTyped(relief.data, res * res * 4) || !isTyped(relief.total, res * res)
        || !Number.isFinite(relief.step) || !Number.isFinite(relief.origin)) return false;
    const sun = textures?.sunFields;
    if (!sun || sun.res !== shadowRes || !isTyped(sun.data, shadowRes * shadowRes * 4)) return false;
    const platesOk = ['atlas', 'detail', 'macro', 'summit']
        .every((plate) => isTyped(textures[plate]?.data) && textures[plate].data.length > 0);
    if (!platesOk) return false;
    if (!!request.cloudField && Array.isArray(request.cloudSpecs)) {
        if (!field || !isTyped(field.position) || field.masses !== request.cloudSpecs.length) return false;
    } else if (field !== null) {
        return false;
    }
    if (request.scatter) {
        return !!zoned && Array.isArray(zoned.placements) && zoned.buckets instanceof Map && !!zoned.stats
            && isTyped(zoned.shade?.data);
    }
    return zoned === null;
}

/**
 * The copy kept for `key`, or null (none, another key's, unusable, or any failure).
 * @param {string} key
 * @param {Parameters<typeof isUsableStoredWorldBake>[1]} request
 * @param {BakeStoreOptions & {onMeta?: (match: boolean) => void}} [options]
 *   `onMeta` hears, before the arrays are read, whether a copy for this key exists
 * @returns {Promise<{relief: object, textures: object, cloudField: object|null, scatter: object|null}|null>}
 */
export async function readStoredWorldBake(key, request, { onMeta, ...options } = {}) {
    let told = false;
    const tell = (/** @type {boolean} */ match) => {
        if (told) return;
        told = true;
        onMeta?.(match);
    };
    try {
        const db = await openBakeDatabase(options);
        const meta = await getRecord(db, 'meta');
        const match = meta?.key === key;
        tell(match);
        if (!match) return null;
        const stored = await getRecord(db, 'data');
        if (!isUsableStoredWorldBake(stored, request)) {
            console.warn('[world-bake] the kept copy does not fit this bake; baking afresh');
            return null;
        }
        return {
            relief: stored.relief, textures: stored.textures, cloudField: stored.cloudField, scatter: stored.scatter,
        };
    } catch (error) {
        tell(false);
        console.warn('[world-bake] could not read the kept copy:', /** @type {Error} */ (error)?.message || error);
        return null;
    }
}

/**
 * Keep `bake` for `key`, replacing whatever was kept. Resolves once it is on disk.
 * @param {string} key
 * @param {{relief: object, textures: object, cloudField: object|null, scatter: object|null}} bake
 * @param {BakeStoreOptions} [options]
 * @returns {Promise<boolean>} whether it was kept
 */
export async function storeWorldBake(key, bake, options = {}) {
    try {
        const db = await openBakeDatabase(options);
        return await new Promise((resolve) => {
            const transaction = db.transaction(STORE, 'readwrite');
            transaction.oncomplete = () => resolve(true);
            transaction.onabort = () => resolve(false);
            transaction.onerror = () => resolve(false);
            const store = transaction.objectStore(STORE);
            store.put({
                relief: bake.relief, textures: bake.textures, cloudField: bake.cloudField, scatter: bake.scatter,
            }, 'data');
            store.put({ key, savedAt: Date.now() }, 'meta');
        });
    } catch (error) {
        // DataCloneError, QuotaExceededError, no IndexedDB: the next launch bakes, as before.
        console.warn('[world-bake] could not keep the bake:', /** @type {Error} */ (error)?.message || error);
        return false;
    }
}
