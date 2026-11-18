import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DISPATCH_FUNCTIONS, openSteamDispatcher } from './steam-dispatch.js';
import { steamApiLibraryPath } from './steam-relay-transport.js';
import { BOARDS, isEligibleScore } from '../src/core/steam/steam-catalogue.js';

// Signatures and callback layouts from the SDK shipped by @pipelab/steamworks.js 0.12.2.
// Valve packs 64-bit members on 8-byte boundaries on Windows and 4 on Linux.
export const CLIENT_FUNCTIONS = {
    ...DISPATCH_FUNCTIONS,
    stats: 'void *SteamAPI_SteamUserStats_v013()',
    mm: 'void *SteamAPI_SteamMatchmaking_v009()',
    utils: 'void *SteamAPI_SteamUtils_v010()',
    apps: 'void *SteamAPI_SteamApps_v008()',
    friends: 'void *SteamAPI_SteamFriends_v018()',
    user: 'void *SteamAPI_SteamUser_v023()',
    online: 'bool SteamAPI_ISteamUser_BLoggedOn(void *s)',
    remote: 'void *SteamAPI_SteamRemoteStorage_v016()',
    find: 'uint64_t SteamAPI_ISteamUserStats_FindLeaderboard(void *s, const char *name)',
    sort: 'int SteamAPI_ISteamUserStats_GetLeaderboardSortMethod(void *s, uint64_t board)',
    display: 'int SteamAPI_ISteamUserStats_GetLeaderboardDisplayType(void *s, uint64_t board)',
    entries: 'int SteamAPI_ISteamUserStats_GetLeaderboardEntryCount(void *s, uint64_t board)',
    upload: 'uint64_t SteamAPI_ISteamUserStats_UploadLeaderboardScore(void *s, uint64_t board, int method, int32_t score, void *details, int count)',
    download: 'uint64_t SteamAPI_ISteamUserStats_DownloadLeaderboardEntries(void *s, uint64_t board, int view, int start, int end)',
    downloadUsers: 'uint64_t SteamAPI_ISteamUserStats_DownloadLeaderboardEntriesForUsers(void *s, uint64_t board, void *users, int count)',
    entry: 'bool SteamAPI_ISteamUserStats_GetDownloadedLeaderboardEntry(void *s, uint64_t list, int index, void *entry, void *details, int count)',
    award: 'bool SteamAPI_ISteamUserStats_SetAchievement(void *s, const char *name)',
    statsStore: 'bool SteamAPI_ISteamUserStats_StoreStats(void *s)',
    lobbyCreate: 'uint64_t SteamAPI_ISteamMatchmaking_CreateLobby(void *s, int type, int capacity)',
    lobbyJoin: 'uint64_t SteamAPI_ISteamMatchmaking_JoinLobby(void *s, uint64_t id)',
    lobbyList: 'uint64_t SteamAPI_ISteamMatchmaking_RequestLobbyList(void *s)',
    lobbyAt: 'uint64_t SteamAPI_ISteamMatchmaking_GetLobbyByIndex(void *s, int index)',
    leave: 'void SteamAPI_ISteamMatchmaking_LeaveLobby(void *s, uint64_t id)',
    value: 'const char *SteamAPI_ISteamMatchmaking_GetLobbyData(void *s, uint64_t id, const char *key)',
    set: 'bool SteamAPI_ISteamMatchmaking_SetLobbyData(void *s, uint64_t id, const char *key, const char *value)',
    members: 'int SteamAPI_ISteamMatchmaking_GetNumLobbyMembers(void *s, uint64_t id)',
    member: 'uint64_t SteamAPI_ISteamMatchmaking_GetLobbyMemberByIndex(void *s, uint64_t id, int index)',
    limit: 'int SteamAPI_ISteamMatchmaking_GetLobbyMemberLimit(void *s, uint64_t id)',
    owner: 'uint64_t SteamAPI_ISteamMatchmaking_GetLobbyOwner(void *s, uint64_t id)',
    setOwner: 'bool SteamAPI_ISteamMatchmaking_SetLobbyOwner(void *s, uint64_t id, uint64_t owner)',
    launch: 'int SteamAPI_ISteamApps_GetLaunchCommandLine(void *s, void *out, int size)',
    keyboard: 'bool SteamAPI_ISteamUtils_ShowFloatingGamepadTextInput(void *s, int mode, int x, int y, int width, int height)',
    clearPresence: 'void SteamAPI_ISteamFriends_ClearRichPresence(void *friends)',
    overlayEnabled: 'bool SteamAPI_ISteamUtils_IsOverlayEnabled(void *utils)',
    invite: 'bool SteamAPI_ISteamMatchmaking_InviteUserToLobby(void *mm, uint64_t lobby, uint64_t friendId)',
    initFilter: 'bool SteamAPI_ISteamUtils_InitFilterText(void *s, uint32_t options)',
    filter: 'int SteamAPI_ISteamUtils_FilterText(void *s, int context, uint64_t sender, const char *input, void *output, uint32_t size)',
    quota: 'bool SteamAPI_ISteamRemoteStorage_GetQuota(void *s, void *total, void *remaining)',
    modified: 'int64_t SteamAPI_ISteamRemoteStorage_GetFileTimestamp(void *s, const char *name)',
};

export const CALLBACK = { SteamServersConnected: 101, SteamServerConnectFailure: 102,
    SteamServersDisconnected: 103, GameLobbyJoinRequested: 333, GameRichPresenceJoinRequested: 337,
    LobbyChatUpdate: 506, NewUrlLaunchParameters: 1014, UserStatsStored: 1102,
    P2PSessionRequest: 1202, P2PSessionConnectFail: 1203 };
const textOf = (buffer) => buffer.toString('utf8').split('\0')[0];
const idOf = (buf, offset = 0) => buf.readBigUInt64LE(offset);
const idObject = (id) => ({ steamId64: BigInt(id) });

function callbackData(kind, buf) {
    switch (kind) {
    case 333: return { lobby_steam_id: idOf(buf), friend_steam_id: idOf(buf, 8) };
    case 337: return { friend_steam_id: idOf(buf), connect: textOf(buf.subarray(8)) };
    case 506: return { lobby: idOf(buf), user_changed: idOf(buf, 8), member_state_change: buf.readUInt32LE(24) };
    case 1102: return { appId: Number(idOf(buf)), result: buf.readInt32LE(8) };
    case 1202: return { remote: idOf(buf) };
    case 1203: return { remote: idOf(buf), error: buf[8] };
    default: return {};
    }
}

export function createDesktopSteamClient({ native, fn, dispatch, platform, appId }) {
    const stats = fn.stats(), mm = fn.mm(), utils = fn.utils(), remote = fn.remote();
    if (!stats || !mm || !utils || !remote) throw new Error('Steam interfaces unavailable');
    const wide = platform === 'win32';
    const boardCache = new Map();
    const self = native.localplayer.getSteamId().steamId64;
    let uploadPending = false;
    let selfTail = Promise.resolve();
    let selfPending = false;
    let storePending = null;
    function storedAtLeast(name, target) {
        const value = native.stats.getInt(name);
        return Number.isInteger(value) && value >= target;
    }
    function board(name) {
        if (!BOARDS[name]) throw new Error('Unknown leaderboard');
        if (!boardCache.has(name)) {
            const task = dispatch.wait(fn.find(stats, name), 1104).then((r) => {
                if (!r[8]) throw new Error('Leaderboard has not been published');
                const id = idOf(r);
                if (fn.sort(stats, id) !== BOARDS[name].sort || fn.display(stats, id) !== BOARDS[name].display) {
                    throw new Error('Leaderboard configuration mismatch');
                }
                return id;
            }).catch((e) => { boardCache.delete(name); throw e; });
            boardCache.set(name, task);
        }
        return boardCache.get(name);
    }
    function readRows(result, limit) {
        const count = Math.min(Math.max(0, result.readInt32LE(16)), limit);
        const rows = [];
        for (let i = 0; i < count; i++) {
            const entry = Buffer.alloc(32), detail = Buffer.alloc(7 * 4);
            if (!fn.entry(stats, idOf(result, 8), i, entry, detail, 7)) throw new Error('Steam entry read failed');
            const id = idOf(entry);
            const size = Math.min(7, Math.max(0, entry.readInt32LE(16)));
            rows.push({ steamId: String(id), rank: entry.readInt32LE(8), score: entry.readInt32LE(12),
                name: native.friends.getFriendName(id) || 'Steam player',
                details: Array.from({ length: size }, (_, n) => detail.readInt32LE(n * 4)) });
        }
        return rows;
    }
    function lobby(id) {
        return { id, getData: (key) => fn.value(mm, id, key), setData: (key, value) => fn.set(mm, id, key, value),
            leave: () => fn.leave(mm, id), getMemberCount: () => fn.members(mm, id), getMemberLimit: () => fn.limit(mm, id),
            getOwner: () => idObject(fn.owner(mm, id)), setOwner: (owner) => fn.setOwner(mm, id, BigInt(owner)),
            getMembers: () => Array.from({ length: fn.members(mm, id) }, (_, i) => idObject(fn.member(mm, id, i))) };
    }
    fn.initFilter(utils, 0);
    return { ...native, callback: { register: (kind, cb) => dispatch.on(kind, (raw) => cb(callbackData(kind, raw))) },
        matchmaking: {
            createLobby: async (type, max) => {
                const r = await dispatch.wait(fn.lobbyCreate(mm, type, max), 513);
                if (r.readInt32LE() !== 1) throw new Error('Steam could not create the lobby');
                return lobby(idOf(r, wide ? 8 : 4));
            },
            joinLobby: async (id) => {
                const r = await dispatch.wait(fn.lobbyJoin(mm, id), 504);
                const reason = r.readUInt32LE(16);
                if (reason !== 1) throw new Error(({ 2: 'Lobby closed', 3: 'An invitation is required', 4: 'Lobby is full' })[reason] || 'Unable to join lobby');
                return lobby(idOf(r));
            },
            getLobbies: async () => {
                const r = await dispatch.wait(fn.lobbyList(mm), 510);
                return Array.from({ length: Math.min(1000, r.readUInt32LE()) }, (_, i) => lobby(fn.lobbyAt(mm, i)));
            },
        },
        boards: {
            async upload(name, score, details) {
                if (!isEligibleScore(name, score, details)) throw new Error('Ineligible score');
                const handle = await board(name);
                if (uploadPending) throw new Error('Steam upload in progress');
                const call = fn.upload(stats, handle, 1, score, Int32Array.from(details), details.length);
                if (!call) throw new Error('Steam upload unavailable');
                uploadPending = true;
                {
                    const r = await dispatch.wait(call, 1106, () => { uploadPending = false; });
                    if (!r[0] || idOf(r, wide ? 8 : 4) !== handle) throw new Error('Steam rejected score');
                    const pos = wide ? 20 : 16;
                    return { success: true, changed: Boolean(r[pos]), rank: r.readInt32LE(pos + 4), previousRank: r.readInt32LE(pos + 8) };
                }
            },
            async page(name, type, start, count) {
                const handle = await board(name);
                const kind = { global: 0, around_user: 1, friends: 2 }[type];
                if (kind == null || !Number.isInteger(count) || count < 1 || count > 100 || !Number.isInteger(start) || start < 0 || start > 1000000) throw new Error('Invalid leaderboard range');
                const r = await dispatch.wait(fn.download(stats, handle, kind, kind === 1 ? -2 : start + 1, kind === 1 ? 2 : start + count), 1105);
                return { supported: true, entries: readRows(r, count), total: fn.entries(stats, handle) };
            },
            self(name) {
                const task = selfTail.then(async () => {
                    const handle = await board(name);
                    const users = Buffer.alloc(8);
                    users.writeBigUInt64LE(BigInt(self));
                    if (selfPending) throw new Error('Personal rank lookup pending');
                    const call = fn.downloadUsers(stats, handle, users, 1);
                    if (!call) throw new Error('Personal rank lookup unavailable');
                    selfPending = true;
                    const r = await dispatch.wait(call, 1105, () => { selfPending = false; });
                    return readRows(r, 1).find((row) => row.steamId === String(self)) || null;
                });
                selfTail = task.catch(() => {});
                return task;
            },
        },
        commitStats(values, awards) {
            if (storePending) return Promise.reject(new Error('Steam stats store in progress'));
            for (const [name, target] of Object.entries(values)) {
                const before = native.stats.getInt(name);
                if (!Number.isInteger(before)) return Promise.reject(new Error('Steam stat unavailable: ' + name));
                if (before < target && native.stats.setInt(name, target) === false) return Promise.reject(new Error('Steam rejected stat: ' + name));
            }
            for (const name of awards) if (!native.achievement.isActivated(name) && !fn.award(stats, name)) return Promise.reject(new Error('Steam rejected achievement'));
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Steam stats confirmation pending')), 30000);
                timeout.unref?.();
                const ticket = dispatch.on(1102, (body) => {
                    const result = callbackData(1102, body);
                    if (result.appId !== appId) return;
                    clearTimeout(timeout);
                    ticket.disconnect();
                    storePending = null;
                    if (result.result !== 1) reject(new Error('Steam stats store result ' + result.result));
                    else if (Object.entries(values).some(([name, value]) => !storedAtLeast(name, value))
                        || awards.some((name) => !native.achievement.isActivated(name))) reject(new Error('Steam stats read-back failed'));
                    else resolve(true);
                });
                storePending = { reject, ticket, timeout };
                if (!fn.statsStore(stats)) { clearTimeout(timeout); ticket.disconnect(); storePending = null; reject(new Error('Steam stats store unavailable')); }
            });
        },
        clearPresence: () => fn.clearPresence(fn.friends()),
        overlayEnabled: () => fn.overlayEnabled(utils),
        inviteFriend: (lobbyId, friendId) => fn.invite(mm, BigInt(lobbyId), BigInt(friendId)),
        showKeyboard: (x, y, width, height) => fn.keyboard(utils, 0, x, y, width, height),
        loggedOn: () => fn.online(fn.user()),
        launchArgs: () => { const out = Buffer.alloc(4096); fn.launch(fn.apps(), out, out.length); return textOf(out); },
        filterChat: (sender, text) => {
            const out = Buffer.alloc(Buffer.byteLength(text) * 4 + 1);
            fn.filter(utils, 2, BigInt(sender), text, out, out.length);
            return textOf(out);
        },
        cloud: { ...native.cloud, getQuota: () => {
            const total = Buffer.alloc(8), available = Buffer.alloc(8);
            return fn.quota(remote, total, available) ? { total: Number(idOf(total)), available: Number(idOf(available)) } : null;
        }, getFileTimestamp: (name) => Number(fn.modified(remote, name)) },
        retire() { clearTimeout(storePending?.timeout); storePending?.ticket.disconnect(); storePending?.reject(new Error('Steam session ended')); storePending = null; dispatch.close(); },
    };
}

export function loadDesktopSteamClient(directory, koffi, appId, log) {
    const win = process.platform === 'win32';
    const addon = win ? 'win64/steamworksjs.win32-x64-msvc.node' : 'linux64/steamworksjs.linux-x64-gnu.node';
    const require = createRequire(join(directory, 'index.js'));
    const native = require(join(directory, 'dist', addon));
    const lib = koffi.load(steamApiLibraryPath(directory, process.platform, join));
    const fn = Object.fromEntries(Object.entries(CLIENT_FUNCTIONS).map(([key, signature]) => [key, lib.func(signature)]));
    native.init(appId);
    if (native.utils.getAppId() !== appId) throw new Error('Steam started a different App ID');
    const dispatch = openSteamDispatcher(fn, koffi.view, { log });
    const client = createDesktopSteamClient({ native, fn, dispatch, platform: process.platform, appId });
    const timer = setInterval(() => { try { dispatch.pump(); } catch (e) { log('Steam callback pump: ' + e.message); } }, 1000 / 30);
    const retire = client.retire;
    client.retire = () => { clearInterval(timer); retire(); };
    return client;
}
