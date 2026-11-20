// Unpackaged, explicitly selected native QA twin. The store build ignores STEAMWORKS_MODULE.
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { loadDesktopSteamClient, CALLBACK } from '../electron/steam-native-client.js';
const require = createRequire(import.meta.url);
export const qaNativeDirectory = dirname(require.resolve('steamworks.js'));
export const SteamCallback = CALLBACK;
export function init(appId) {
    if (!appId || appId === 480 || String(appId) !== process.env.SERENITY_QA_APP) throw new Error('Set the licensed QA App ID');
    const client = loadDesktopSteamClient(qaNativeDirectory, require('koffi'), appId, console.log);
    if (String(client.localplayer.getSteamId().steamId64) !== process.env.SERENITY_QA_ACCOUNT) { client.retire(); throw new Error('Wrong QA account'); }
    const fault = process.env.SERENITY_QA_FAULT;
    if (fault === 'cloud-write') client.cloud.writeFile = () => false;
    if (fault === 'relay-open') client.qaDisableRelay = true;
    if (fault === 'upload-ack' || fault === 'stats-ack') {
        const target = fault === 'upload-ack' ? client.boards : client;
        const name = fault === 'upload-ack' ? 'upload' : 'commitStats';
        const original = target[name].bind(target);
        target[name] = async (...args) => {
            const result = await original(...args);
            console.log('[Steam QA] Native acknowledgement received. Terminating before local receipt commit.', result);
            process.exit(86);
        };
    }
    return client;
}
