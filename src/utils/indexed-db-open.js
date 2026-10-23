// @ts-check
/**
 * Open an owner's IndexedDB connection once (the high scores, the demos).
 *
 * Callers arriving together share one opening: each used to open its own connection, and the
 * storage warm-up reopened over a live one, leaving the old connections open. The connection
 * closes itself when a newer version of the game in another tab upgrades the database
 * (`versionchange`), so that tab's upgrade is not blocked. An open that another tab blocks fails
 * instead of waiting forever: a results screen awaits the score save.
 */

/**
 * @param {{ db: IDBDatabase | null, _opening?: Promise<void> | null }} owner where the connection lives
 * @param {{
 *   name: string,
 *   version: number,
 *   upgrade: (event: IDBVersionChangeEvent) => void,
 *   indexedDB?: IDBFactory,
 * }} options
 * @returns {Promise<void>}
 */
export function openDatabaseOnce(owner, {
    name, version, upgrade, indexedDB = globalThis.indexedDB,
}) {
    if (owner.db) return Promise.resolve();
    owner._opening ??= new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);
        let failed = false;
        const fail = (/** @type {unknown} */ error) => {
            failed = true;
            reject(error);
        };
        request.onerror = () => fail(request.error);
        request.onblocked = () => fail(new Error(`${name}: blocked by a connection open in another tab`));
        request.onupgradeneeded = (event) => upgrade(event);
        request.onsuccess = () => {
            const db = request.result;
            if (failed) {
                db.close(); // the blocking tab let go after the caller had been told it failed
                return;
            }
            db.onversionchange = () => {
                db.close();
                if (owner.db === db) owner.db = null;
            };
            owner.db = db;
            resolve();
        };
    }).finally(() => { owner._opening = null; });
    return owner._opening;
}
