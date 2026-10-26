/**
 * Strip the requestVideoFrameCallback polyfill out of Phaser's ESM bundle at build time.
 *
 * Phaser 4 inlines `src/polyfills/requestVideoFrame.js`, which is copied from
 * https://github.com/ThaUnknown/rvfc-polyfill, a GPL-3.0 project. The game ships under its own
 * licence, so that code must not be in the release. It is safe to drop: the polyfill only installs
 * itself where `HTMLVideoElement.prototype.requestVideoFrameCallback` is missing (Electron's
 * Chromium has it natively), and the game does not use Phaser's video objects at all.
 *
 * The block removed is the polyfill's whole `if (...) { ... }` statement, from its "From
 * https://github.com/ThaUnknown/rvfc-polyfill" comment to the statement's closing brace. If the
 * marker comment is gone but the polyfill's code is still there (a Phaser update that reworded
 * it), the build fails, so the code can never slip back into a release unnoticed.
 */

export const RVFC_MARKER = '//  From https://github.com/ThaUnknown/rvfc-polyfill';
export const RVFC_FINGERPRINT = '_rvfcpolyfillmap';
const PHASER_ESM = /node_modules[\\/]phaser[\\/]dist[\\/]phaser\.esm\.js$/;
const REPLACEMENT = '// requestVideoFrameCallback polyfill removed at build time (GPL-3.0 upstream; see vite.config.js)';

/**
 * Remove the polyfill block from Phaser's source text.
 * @param {string} code
 * @returns {{ code: string, removed: string }} `removed` is '' when there was nothing to remove.
 */
export function stripRvfcPolyfill(code) {
    const start = code.indexOf(RVFC_MARKER);
    if (start < 0) {
        if (code.includes(RVFC_FINGERPRINT)) {
            throw new Error('[strip-phaser-rvfc-polyfill] the GPL-3.0 rvfc polyfill is in Phaser but its marker comment moved; update the plugin.');
        }
        return { code, removed: '' };
    }
    const ifAt = code.indexOf('if (typeof HTMLVideoElement', start);
    // The condition holds no brace, so the first one after `if (` opens the polyfill's block.
    const open = ifAt < 0 ? -1 : code.indexOf('{', ifAt);
    if (ifAt < 0 || open < 0 || ifAt - start > 200) {
        throw new Error('[strip-phaser-rvfc-polyfill] could not find the polyfill statement after its marker.');
    }
    let depth = 0;
    let end = -1;
    for (let i = open; i < code.length; i += 1) {
        const ch = code[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    if (end < 0) throw new Error('[strip-phaser-rvfc-polyfill] unbalanced braces in the polyfill block.');
    const removed = code.slice(start, end);
    const out = code.slice(0, start) + REPLACEMENT + code.slice(end);
    if (out.includes(RVFC_FINGERPRINT) || !removed.includes(RVFC_FINGERPRINT)) {
        throw new Error('[strip-phaser-rvfc-polyfill] the polyfill block was not removed cleanly.');
    }
    return { code: out, removed };
}

/** Vite/Rollup plugin: build only (the dev server never ships). */
export function createStripPhaserRvfcPolyfillPlugin() {
    return {
        name: 'strip-phaser-rvfc-polyfill',
        apply: 'build',
        transform(code, id) {
            if (!PHASER_ESM.test(id)) return null;
            const { code: out, removed } = stripRvfcPolyfill(code);
            return removed ? { code: out, map: null } : null;
        },
    };
}
