// @ts-check
/**
 * Which files of an unpacked Windows package need a valid Authenticode signature, and whether a
 * build may go on without one. No process exits or console output here: scripts/verify-signatures.mjs
 * prints these diagnostics and Vitest asserts them (tests/unit/package-signature-policy.test.js).
 *
 * Why it matters: Windows 11's Smart App Control blocks a program that is neither known to
 * Microsoft's cloud service nor validly signed, and a player cannot make an exception for one app.
 * The rule covers what electron-builder signs when it is given a certificate: the game's
 * executable (Electron's, which arrives unsigned and is renamed and given the game's icon) and
 * every native addon (build.win.signExts). Electron's and Valve's libraries are reported, not
 * required: they arrive signed or not from their makers, and the same files ship in every
 * Electron app.
 */

/** The file kinds Windows checks a signature on, and this check reports. */
export const SIGNATURE_EXTENSIONS = Object.freeze(['.exe', '.dll', '.node']);

/** The only status that counts as signed (PowerShell's SignatureStatus). */
export const VALID_SIGNATURE = 'Valid';

/** What a file's status reads when the host cannot check Authenticode at all (not Windows). */
export const UNREAD_SIGNATURE = 'Unread';

/** @param {string} file a path inside the package */
const normalize = (file) => String(file).replaceAll('\\', '/').replace(/^\.\//, '');

/**
 * True for the game's own executable at the package root and for every native addon.
 * @param {string} file path inside the package, either slash
 * @param {string} appExecutable the executable's file name, e.g. "Serenity Blocks.exe"
 */
export function requiresSignature(file, appExecutable) {
    const relative = normalize(file).toLowerCase();
    return relative === appExecutable.toLowerCase() || relative.endsWith('.node');
}

/**
 * @typedef {{ path: string, status: string, signer?: string | null }} SignatureRow
 * @typedef {{ level: 'info' | 'warning' | 'error', message: string }} Diagnostic
 */

/**
 * Decide whether the package may ship.
 *
 * - A store build (SERENITY_RELEASE=1) fails unless the game's executable and every native addon
 *   are `Valid`, or SERENITY_ALLOW_UNSIGNED=1 says the owner packages unsigned on purpose.
 * - Any other build passes and says what a store build would have stopped on.
 * - A directory without the game's executable is not an unpacked package: always an error.
 *
 * @param {object} input
 * @param {SignatureRow[]} input.files every .exe, .dll and .node of the package, paths relative to it
 * @param {string} input.appExecutable the game's executable name at the package root
 * @param {boolean} [input.isReleaseBuild] SERENITY_RELEASE=1
 * @param {boolean} [input.allowUnsigned] SERENITY_ALLOW_UNSIGNED=1
 * @param {string} [input.packageLabel] how the messages name the directory
 * @returns {{ diagnostics: Diagnostic[], failed: boolean, required: SignatureRow[], unsigned: SignatureRow[] }}
 */
export function evaluatePackageSignatures({
    files,
    appExecutable,
    isReleaseBuild = false,
    allowUnsigned = false,
    packageLabel = 'the package',
}) {
    const rows = files.map((row) => ({ ...row, path: normalize(row.path) }));
    const required = rows.filter((row) => requiresSignature(row.path, appExecutable));
    const unsigned = required.filter((row) => row.status !== VALID_SIGNATURE);

    if (!rows.some((row) => row.path.toLowerCase() === appExecutable.toLowerCase())) {
        return {
            diagnostics: [{
                level: 'error',
                message: `"${appExecutable}" is not in ${packageLabel}; point the check at an unpacked Windows package (release/win-unpacked).`,
            }],
            failed: true,
            required,
            unsigned,
        };
    }

    if (unsigned.length === 0) {
        return {
            diagnostics: [{
                level: 'info',
                message: `The game's executable and its ${required.length - 1} native addon(s) in ${packageLabel} are validly signed.`,
            }],
            failed: false,
            required,
            unsigned,
        };
    }

    const unread = unsigned.every((row) => row.status === UNREAD_SIGNATURE);
    const list = unsigned.map((row) => `    ${row.status.padEnd(12)} ${row.path}`).join('\n');
    const what = unread
        ? `Signatures cannot be read on this computer (Authenticode is checked on Windows), so ${unsigned.length} file(s) in ${packageLabel} are unverified:`
        : `${unsigned.length} file(s) in ${packageLabel} have no valid signature:`;
    const why = 'Windows\' Smart App Control blocks an unsigned program it cannot vouch for, so players with it on may be unable to start the game.';
    const how = 'electron-builder signs while it packages: give it a code-signing certificate (CSC_LINK and CSC_KEY_PASSWORD, or the route configured under "build.win" in package.json) and build again on Windows.';

    if (!isReleaseBuild) {
        return {
            diagnostics: [{
                level: 'warning',
                message: `${what}\n${list}\n  A store build (SERENITY_RELEASE=1) stops here. ${how}`,
            }],
            failed: false,
            required,
            unsigned,
        };
    }

    if (allowUnsigned) {
        return {
            diagnostics: [{
                level: 'warning',
                message: `UNSIGNED STORE BUILD, let through by SERENITY_ALLOW_UNSIGNED=1. ${what}\n${list}\n  ${why}`,
            }],
            failed: false,
            required,
            unsigned,
        };
    }

    return {
        diagnostics: [{
            level: 'error',
            message: `Store build blocker: ${what}\n${list}\n  ${why}\n  ${how}\n  To package unsigned on purpose, set SERENITY_ALLOW_UNSIGNED=1.`,
        }],
        failed: true,
        required,
        unsigned,
    };
}
