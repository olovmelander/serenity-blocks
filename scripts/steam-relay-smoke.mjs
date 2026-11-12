/**
 * One-account check of online play's relay transport (electron/steam-relay-transport.js), run
 * against the real Steam client: Steam must be running and logged in.
 *
 *   node scripts/steam-relay-smoke.mjs [appId]     (default: steam_appid.txt, else 480)
 *
 * It starts steamworks.js as the game does, opens the relay transport (ICE off for the process),
 * and waits up to 20 s for Steam's relay network to be ready. It prints each step and exits 0
 * when the transport is open and the relay network is "current", 1 otherwise. It connects to
 * nobody: the two-account test in docs/ONLINE_RELAY_TRANSPORT_2026-11.md checks a real session.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { openRelayTransport, steamApiLibraryPath } from '../electron/steam-relay-transport.js';

const require = createRequire(import.meta.url);

function appIdFromArgs() {
    const arg = Number(process.argv[2]);
    if (Number.isInteger(arg) && arg > 0) return arg;
    const file = join(process.cwd(), 'steam_appid.txt');
    const fromFile = existsSync(file) ? Number(readFileSync(file, 'utf8').trim()) : NaN;
    return Number.isInteger(fromFile) && fromFile > 0 ? fromFile : 480;
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function main() {
    const appId = appIdFromArgs();
    let koffi;
    try {
        koffi = require('koffi');
    } catch (error) {
        console.log(`FAIL koffi did not load (${error.message}). Run npm ci first.`);
        return 1;
    }
    const steamworks = require('steamworks.js');
    let client;
    try {
        client = steamworks.init(appId);
    } catch (error) {
        console.log(`FAIL Steam did not start for AppID ${appId} (${error.message}). Is Steam running and logged in?`);
        return 1;
    }
    console.log(`ok   Steam running as ${client.localplayer.getName()} (AppID ${appId})`);
    const libraryPath = steamApiLibraryPath(dirname(require.resolve('steamworks.js')), process.platform, join);
    const opened = openRelayTransport({ koffi, libraryPath, log: (line) => console.log(`     ${line}`) });
    if (!opened.ok) {
        console.log(`FAIL relay transport did not open: ${opened.reason}`);
        return 1;
    }
    console.log('ok   relay transport open, direct connections (ICE) off');
    let status = opened.transport.relayNetworkStatus();
    for (let waited = 0; status !== 'current' && waited < 20_000; waited += 500) {
        // eslint-disable-next-line no-await-in-loop -- polling Steam, one step at a time
        await sleep(500);
        status = opened.transport.relayNetworkStatus();
    }
    console.log(`${status === 'current' ? 'ok  ' : 'FAIL'} Steam relay network: ${status}`);
    return status === 'current' ? 0 : 1;
}

main().then((code) => process.exit(code), (error) => {
    console.log(`FAIL ${error?.stack || error}`);
    process.exit(1);
});
