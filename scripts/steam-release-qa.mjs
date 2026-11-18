import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { CloudRecordGenerations } from '../src/core/steam/cloud-record-generations.js';
import { RELAY_FUNCTIONS, steamApiLibraryPath } from '../electron/steam-relay-transport.js';
import { BOARDS, ACHIEVEMENTS, ACHIEVEMENT_DEFINITIONS, STAT_NAMES } from '../src/core/steam/steam-catalogue.js';
import { isReleaseSteamAppId } from '../electron/steam-app-id.js';
import { CLIENT_FUNCTIONS, loadDesktopSteamClient } from '../electron/steam-native-client.js';

const [action, ...args] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const number = (text) => /^\d+$/.test(text || '') && isReleaseSteamAppId(Number(text));
if (action === 'manifest') {
    console.log(JSON.stringify({ stats: STAT_NAMES, achievements: ACHIEVEMENTS,
        statSetup: { type: 'INT', setBy: 'Client', default: 0, minimum: 0, maximum: 2147483647 },
        achievementSetup: ACHIEVEMENT_DEFINITIONS,
        boards: Object.values(BOARDS).map(({ name, label, mode, unit, sort }) => ({ name, communityName: ({single:'Single Player', infinity:'Infinity', odyssey:'Odyssey'})[mode] + ' · ' + label, display: unit, sort: sort === 1 ? 'Ascending' : 'Descending', method: 'KeepBest', reads: 'Public', writes: 'Client' })) }, null, 2));
} else if (action === 'verify-native') {
    // Loading symbols is deliberately separate from initializing a live Steam account.
    const root = args[0] ? resolve(args[0]) : null;
    const directory = root ? join(root, 'steamworks.js') : dirname(require.resolve('steamworks.js'));
    const k = root ? require(join(root, 'koffi')) : require('koffi');
    const win = process.platform === 'win32';
    const addon = require(join(directory, 'dist', win ? 'win64/steamworksjs.win32-x64-msvc.node' : 'linux64/steamworksjs.linux-x64-gnu.node'));
    const lib = k.load(steamApiLibraryPath(directory, process.platform, join));
    for (const signature of [...Object.values(CLIENT_FUNCTIONS), ...Object.values(RELAY_FUNCTIONS)]) lib.func(signature);
    if (typeof addon.init !== 'function') throw new Error('Native Steam addon unavailable');
    console.log(process.platform, process.arch, Object.keys(CLIENT_FUNCTIONS).length, 'client and', Object.keys(RELAY_FUNCTIONS).length, 'relay symbols resolved, addon loaded');
} else if (action === 'size') {
    const count = Number(args[0] || 100000);
    if (!Number.isInteger(count) || count < 10 || count > 300000) throw new Error('size accepts 10 to 300000 runs');
    const hash = (text) => createHash('sha256').update(text).digest('hex');
    const files = new Map();
    const service = { cloudRead: async (name) => ({ supported: true, data: files.get(name) ?? null }),
        cloudWrite: async (name, data) => { files.set(name, data); return { success: true }; } };
    const writers = ['a','b'].map((device) => new CloudRecordGenerations({ service, device, hash }));
    const runs = {};
    for (let i = 1; i <= count; i++) {
        const key = hash(String(i)).slice(0, 32);
        runs[key] = { mode: i % 2 ? 'single' : 'infinity', owner: '123456/76561198000000000', score: i * 17,
            lines: i % 128, level: i % 20 + 1, duration: i % 1800 + 1, cascade: i % 8, flags: i % 2, checksum: parseInt(key.slice(0,8),16) | 0 };
        if (i === count - 1 || i === count) {
            const json = JSON.stringify({version:1, stats:{ totalGames:i, recordBook:{version:1,runs} }});
            for (const writer of writers) await writer.write('stats.json', json);
            files.set('stats.json', json);
        }
    }
    const bytes = [...files.values()].reduce((sum, value) => sum + Buffer.byteLength(value), 0);
    console.log(JSON.stringify({runs:count, writers:writers.length, statsFiles:files.size, bytes, remainingOf64MiB:67108864-bytes}));
    if (bytes > 67108864) process.exitCode = 1;
} else if (action === 'depots') {
    const [app, windows, linux, destination] = args;
    if (![app, windows, linux].every(number) || windows === linux || !destination) throw new Error('depots APPID WIN_DEPOT LINUX_DEPOT NEW_OUTPUT_DIRECTORY');
    const dir = resolve(destination);
    fs.mkdirSync(dir, { recursive: true });
    for (const [id, folder] of [[windows, 'win-unpacked'], [linux, 'linux-unpacked']]) {
        const root = resolve('release', folder).replaceAll('\\', '/');
        if (!fs.existsSync(root)) throw new Error('Missing staged package ' + folder);
        fs.writeFileSync(join(dir, 'depot_' + id + '.vdf'),
            '"DepotBuildConfig"\n{\n "DepotID" "' + id + '"\n "ContentRoot" "' + root + '"\n "FileMapping" { "LocalPath" "*" "DepotPath" "." "recursive" "1" }\n}\n', { flag: 'wx' });
    }
    fs.writeFileSync(join(dir, 'app_build.vdf'), '"AppBuild"\n{\n "AppID" "' + app + '"\n "Desc" "Serenity Blocks QA"\n'
        + ' "Preview" "1"\n "BuildOutput" "output"\n "Depots" { "' + windows + '" "depot_' + windows + '.vdf" "' + linux + '" "depot_' + linux + '.vdf" }\n}\n', { flag: 'wx' });
} else {
    const [id, expected, target, backup] = args;
    if (!['inspect', 'backup', 'truncate', 'future', 'restore'].includes(action) || !number(id) || !/^\d{17}$/.test(expected || '')) {
        throw new Error('Use manifest, depots, or inspect/backup/truncate/future/restore APPID EXPECTED_QA_STEAMID [FILE BACKUP_DIRECTORY]');
    }
    const client = loadDesktopSteamClient(dirname(require.resolve('steamworks.js')), require('koffi'), Number(id), console.error);
    try {
        if (String(client.localplayer.getSteamId().steamId64) !== expected) throw new Error('Signed-in QA account does not match');
        if (action === 'inspect') {
            const result = { appId: client.utils.getAppId(), cloud: client.cloud.isEnabledForApp(), quota: client.cloud.getQuota(), boards: {}, stats: {} };
            result.files = client.cloud.listFiles().map(({name, size}) => {
                const file = { name, bytes: Number(size), modified: client.cloud.getFileTimestamp(name) };
                if (/^records_v1_/.test(name)) {
                    try {
                        const {version, generation, digest} = JSON.parse(client.cloud.readFile(name));
                        Object.assign(file, {version, generation, digest});
                    } catch { file.damaged = true; }
                }
                return file;
            });
            for (const name of Object.keys(BOARDS)) {
                try { const page = await client.boards.page(name, 'global', 0, 1); result.boards[name] = { entries: page.total }; }
                catch (error) { result.boards[name] = { error: error.message }; process.exitCode = 1; }
            }
            for (const name of STAT_NAMES) {
                result.stats[name] = client.stats.getInt(name);
                if (!Number.isInteger(result.stats[name])) process.exitCode = 1;
            }
            result.achievements = client.achievement.names();
            if (ACHIEVEMENTS.some((name) => !result.achievements.includes(name))) process.exitCode = 1;
            if (!result.cloud || !result.quota || result.quota.total < 67108864) process.exitCode = 1;
            console.log(JSON.stringify(result, null, 2));
        } else {
            if (!target || !backup || !/^(cloud_manifest|highscores|odyssey|stats|records_v1_[a-z0-9-]+_(stats|highscores|odyssey)_[012])\.json$/.test(target)) throw new Error('Choose one named recovery file and a private backup directory');
            const dir = join(resolve(backup), id + '-' + expected);
            fs.mkdirSync(dir, { recursive: true });
            const copy = join(dir, target);
            if (action === 'backup') {
                if (!client.cloud.fileExists(target)) throw new Error('Cloud file absent');
                fs.writeFileSync(copy, client.cloud.readFile(target), { flag: 'wx', mode: 0o600 });
            } else {
                const original = fs.readFileSync(copy, 'utf8');
                if (action !== 'restore' && client.cloud.readFile(target) !== original) throw new Error('Current file differs from the backup');
                const value = action === 'restore' ? original : action === 'future' ? '{"version":999}' : '{';
                if (!client.cloud.writeFile(target, value) || client.cloud.readFile(target) !== value) throw new Error('Cloud write/read-back failed');
            }
        }
    } finally { client.retire(); }
}
