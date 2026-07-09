// Effect registry. Any file matching `*.effect.js` in this folder that exports a
// `meta` ({ id, title, description }) and a `create(ctx)` function auto-registers —
// drop a new file in and it shows up in the playground dropdown, no wiring needed.
const modules = import.meta.glob('./*.effect.js', { eager: true });

const EFFECTS = {};
for (const filePath of Object.keys(modules)) {
    const mod = modules[filePath];
    if (mod && mod.meta && mod.meta.id && typeof mod.create === 'function') {
        EFFECTS[mod.meta.id] = mod;
    } else {
        // eslint-disable-next-line no-console
        console.warn(`[playground] ${filePath} is missing a valid \`meta.id\` or \`create()\` export — skipped.`);
    }
}

/** @returns {Array<{id:string,title:string,description:string}>} metadata for every registered effect, sorted by title. */
export function listEffects() {
    return Object.values(EFFECTS)
        .map((m) => m.meta)
        .sort((a, b) => a.title.localeCompare(b.title));
}

/** @returns {{meta:object, create:Function}|null} the effect module for `id`, or null. */
export function getEffect(id) {
    return EFFECTS[id] || null;
}
