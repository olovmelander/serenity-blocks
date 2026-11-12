/**
 * The debugging switches a launch may turn on, read once at startup.
 *
 * - `SERENITY_ENABLE_DIAGNOSTICS=1`: DevTools, the debug keys, renderer remote debugging and
 *   the diagnostics IPC.
 * - `SERENITY_DISABLE_CSP=1`: start without the Content-Security-Policy.
 * - `SERENITY_MAIN_INSPECT_PORT` / `--serenity-main-inspect-port=`: the main-process
 *   inspector (only with diagnostics on).
 *
 * A store build (electron/steam-app-id.js: packaged, with the game's own AppID) ignores all
 * three: a player's game cannot be opened up by a variable in their environment. Development
 * runs and packaged test builds without a release AppID keep them.
 *
 * Pure (no Electron): electron/main.js reads it; the unit tests pin it.
 */

const INSPECT_PORT_ARG = '--serenity-main-inspect-port=';

/** A usable TCP port from text, or 0. */
function parsePort(value) {
    const port = Number(value);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : 0;
}

/**
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {string[]} [options.argv]
 * @param {boolean} [options.storeBuild]  electron/steam-app-id.js isStoreBuild()
 * @returns {{ diagnosticsEnabled: boolean, cspDisabled: boolean, mainInspectPort: number }}
 */
export function resolveDebugFlags({ env = {}, argv = [], storeBuild = false } = {}) {
    if (storeBuild) {
        return { diagnosticsEnabled: false, cspDisabled: false, mainInspectPort: 0 };
    }
    const diagnosticsEnabled = env.SERENITY_ENABLE_DIAGNOSTICS === '1';
    const inspectArg = argv.find((arg) => typeof arg === 'string' && arg.startsWith(INSPECT_PORT_ARG));
    const requestedPort = parsePort(env.SERENITY_MAIN_INSPECT_PORT)
        || (inspectArg ? parsePort(inspectArg.slice(INSPECT_PORT_ARG.length)) : 0);
    return {
        diagnosticsEnabled,
        cspDisabled: env.SERENITY_DISABLE_CSP === '1',
        // The inspector is a second opt-in on top of diagnostics, never on its own.
        mainInspectPort: diagnosticsEnabled ? requestedPort : 0,
    };
}
