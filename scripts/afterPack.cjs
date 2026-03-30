/**
 * electron-builder afterPack hook
 *
 * GPU preference launcher removed — main.js uses
 * app.commandLine.appendSwitch('force-high-performance-gpu') instead.
 *
 * This hook is kept as a no-op so electron-builder's "afterPack" config
 * reference doesn't break.
 */

module.exports = async function (_context) {
    console.log('[afterPack] No post-pack steps required.');
};
