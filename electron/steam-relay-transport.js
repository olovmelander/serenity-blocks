/**
 * Online play's packets through Steam's relay network only, so no player learns another's IP
 * address.
 *
 * steamworks.js 0.4.0 offers only the legacy ISteamNetworking P2P calls, which connect two players
 * directly whenever Steam can, and a direct connection shows each the other's IP address. This
 * module calls Steam's newer ISteamNetworkingMessages interface from the Steam API library
 * steamworks.js has already loaded, through koffi (a C FFI), and first turns ICE off for the whole
 * process (k_ESteamNetworkingConfig_P2P_Transport_ICE_Enable = 0: "do not do any ICE work at all
 * or share any IP addresses with peer"). Steam then never tries a direct route and every session
 * runs through Valve's relays (Steam Datagram Relay).
 *
 * It borrows the running Steam client that steamworks.js initialised: it never initialises or
 * shuts down Steam.
 *
 * Sessions. A peer's first message raises a session request, and steamworks.js cannot hand that
 * callback over (its callbacks are a fixed list). So the caller asks `acceptFrom` for the peers
 * its session gate allows (electron/p2p-session-gate.js): Steam's AcceptSessionWithUser accepts a
 * request that is pending and does nothing for a peer who has not asked. Sending to a peer also
 * accepts its request. A peer the gate does not allow is never accepted, and its messages never
 * arrive.
 *
 * Layouts, from Valve's steamnetworkingtypes.h (the same in the open-source GameNetworkingSockets):
 * - SteamNetworkingIdentity is packed to 1 byte: the type (int32; 16 for a SteamID) at 0, the
 *   size of what follows (int32; 8) at 4, the SteamID (uint64) at 8; 136 bytes in all.
 * - SteamNetworkingMessage_t: the data pointer at 0, its size (int32) at 8, the sender's identity
 *   at 16. (Its fields keep these offsets under both of Valve's packings.)
 * - SteamNetConnectionInfo_t: the remote address (18 bytes) at 148, the state at 176, the flags
 *   at 440; 696 bytes in all.
 *
 * Pure apart from what it is handed (koffi and the library's path): the unit tests drive it with
 * a fake. electron/steam-integration.js wires it to the game's P2P calls.
 */

/** The channel the game's packets ride (it uses one; the protocol multiplexes inside it). */
export const RELAY_CHANNEL = 0;
/** sizeof(SteamNetworkingIdentity). */
export const IDENTITY_BYTES = 136;
const IDENTITY_TYPE_STEAMID = 16;
/** Offsets inside SteamNetworkingMessage_t. */
export const MESSAGE_LAYOUT = Object.freeze({
    data: 0, size: 8, identity: 16, head: 32,
});
/** Offsets inside SteamNetConnectionInfo_t. */
export const INFO_LAYOUT = Object.freeze({
    bytes: 696, address: 148, addressBytes: 18, state: 176, flags: 440,
});
/** k_ESteamNetworkingConfig_P2P_Transport_ICE_Enable and its "disable" value. */
export const CONFIG_ICE_ENABLE = 104;
export const ICE_DISABLE = 0;
/** k_nSteamNetworkConnectionInfoFlags_Relayed. */
export const FLAG_RELAYED = 16;
/** k_EResultOK. */
export const RESULT_OK = 1;
/** ESteamNetworkingConnectionState. */
export const SESSION_STATE = Object.freeze({
    none: 0, connecting: 1, findingRoute: 2, connected: 3, closedByPeer: 4, problem: 5,
});
/** ESteamNetworkingAvailability, as `relayNetworkStatus` names it. */
const AVAILABILITY = new Map([
    [-102, 'cannot-try'], [-101, 'failed'], [-100, 'previously'], [-10, 'retrying'],
    [1, 'never-tried'], [2, 'waiting'], [3, 'attempting'], [100, 'current'],
]);

/**
 * The k_nSteamNetworkingSend_* flags for each of steamworks.js's legacy send types (the game's
 * packet codec still names those, electron/p2p-packet-codec.js): 0 Unreliable, 1
 * UnreliableNoDelay, 2 Reliable (sent at once, as the legacy reliable type was), 3
 * ReliableWithBuffering. Every send also re-opens a session that broke, as the legacy calls did.
 */
export const SEND_FLAGS_BY_LEGACY_TYPE = Object.freeze([0, 5, 9, 8]);
export const SEND_AUTO_RESTART = 32;

/** The most messages read from Steam in one call. */
export const MAX_MESSAGES_PER_READ = 32;
/** Peers whose encoded identity is kept (a lobby holds 8; spectators add a few). */
const IDENTITY_CACHE = 64;

/** The flat Steam API functions the transport calls, in koffi's C syntax. */
export const RELAY_FUNCTIONS = Object.freeze({
    messages: 'void *SteamAPI_SteamNetworkingMessages_SteamAPI_v002()',
    utils: 'void *SteamAPI_SteamNetworkingUtils_SteamAPI_v004()',
    setGlobalInt32: 'bool SteamAPI_ISteamNetworkingUtils_SetGlobalConfigValueInt32(void *self, int value, int32_t data)',
    initRelay: 'void SteamAPI_ISteamNetworkingUtils_InitRelayNetworkAccess(void *self)',
    relayStatus: 'int SteamAPI_ISteamNetworkingUtils_GetRelayNetworkStatus(void *self, void *details)',
    send: 'int SteamAPI_ISteamNetworkingMessages_SendMessageToUser(void *self, void *identity, void *data, uint32_t size, int flags, int channel)',
    receive: 'int SteamAPI_ISteamNetworkingMessages_ReceiveMessagesOnChannel(void *self, int channel, void *out, int max)',
    accept: 'bool SteamAPI_ISteamNetworkingMessages_AcceptSessionWithUser(void *self, void *identity)',
    close: 'bool SteamAPI_ISteamNetworkingMessages_CloseSessionWithUser(void *self, void *identity)',
    info: 'int SteamAPI_ISteamNetworkingMessages_GetSessionConnectionInfo(void *self, void *identity, void *info, void *status)',
    release: 'void SteamAPI_SteamNetworkingMessage_t_Release(void *message)',
});

/**
 * The Steam API library inside a steamworks.js folder, for this platform (steamworks.js 0.4.0
 * ships 64-bit Windows, Linux and macOS builds), or null.
 * @param {string} steamworksDir  the folder holding steamworks.js's package.json
 * @param {string} platform       process.platform
 * @param {(...parts: string[]) => string} join  path.join
 */
export function steamApiLibraryPath(steamworksDir, platform, join) {
    if (!steamworksDir) return null;
    if (platform === 'win32') return join(steamworksDir, 'dist', 'win64', 'steam_api64.dll');
    if (platform === 'linux') return join(steamworksDir, 'dist', 'linux64', 'libsteam_api.so');
    if (platform === 'darwin') return join(steamworksDir, 'dist', 'osx', 'libsteam_api.dylib');
    return null;
}

/**
 * A SteamNetworkingIdentity holding a SteamID64.
 * @param {string | bigint} steamId
 * @returns {Buffer}
 */
export function encodeSteamIdentity(steamId) {
    const identity = Buffer.alloc(IDENTITY_BYTES);
    identity.writeInt32LE(IDENTITY_TYPE_STEAMID, 0);
    identity.writeInt32LE(8, 4);
    identity.writeBigUInt64LE(BigInt(steamId), 8);
    return identity;
}

/**
 * The SteamID64 an identity's first 16 bytes hold, or null when it is not a SteamID.
 * @param {Buffer} head  at least 16 bytes: type, size, id
 * @returns {string | null}
 */
export function decodeSteamIdentity(head) {
    if (!head || head.length < 16) return null;
    if (head.readInt32LE(0) !== IDENTITY_TYPE_STEAMID || head.readInt32LE(4) !== 8) return null;
    const id = head.readBigUInt64LE(8);
    return id > 0n ? id.toString() : null;
}

/** A SteamID64 as the game passes it around, or null. */
function steamIdText(steamId) {
    const text = steamId == null ? '' : String(steamId);
    return /^\d{1,20}$/.test(text) && BigInt(text) > 0n ? text : null;
}

/**
 * Open the relay transport, or say why it cannot be opened.
 * @param {object} options
 * @param {any} options.koffi           the koffi module
 * @param {string} options.libraryPath  the Steam API library steamworks.js loaded
 * @param {number} [options.maxMessageBytes]  bigger incoming messages are dropped
 * @param {(message: string) => void} [options.log]
 * @returns {{ ok: true, transport: RelayTransport } | { ok: false, reason: string }}
 */
export function openRelayTransport({
    koffi, libraryPath, maxMessageBytes = 64 * 1024, log = () => {},
}) {
    if (!koffi || typeof koffi.load !== 'function') return { ok: false, reason: 'koffi is not available' };
    if (!libraryPath) return { ok: false, reason: 'no Steam API library for this platform' };
    /** @type {Record<string, Function>} */
    const fn = {};
    try {
        const lib = koffi.load(libraryPath);
        for (const [name, signature] of Object.entries(RELAY_FUNCTIONS)) fn[name] = lib.func(signature);
    } catch (error) {
        return { ok: false, reason: `the Steam API library did not load: ${error?.message || error}` };
    }
    let messages;
    let utils;
    try {
        messages = fn.messages();
        utils = fn.utils();
    } catch (error) {
        return { ok: false, reason: `Steam's networking interfaces failed: ${error?.message || error}` };
    }
    if (!messages || !utils) return { ok: false, reason: 'Steam\'s networking interfaces are not available (Steam not initialised?)' };
    // Before any session exists: no direct routes, no addresses shared, for the whole process.
    let iceOff = false;
    try {
        iceOff = fn.setGlobalInt32(utils, CONFIG_ICE_ENABLE, ICE_DISABLE) === true;
    } catch (error) {
        return { ok: false, reason: `could not turn off direct connections: ${error?.message || error}` };
    }
    if (!iceOff) return { ok: false, reason: 'Steam refused to turn off direct connections' };
    try {
        fn.initRelay(utils);
    } catch (error) {
        log(`WARN: relay network warm-up failed: ${error?.message || error}`);
    }
    log('Relay transport open: ISteamNetworkingMessages, direct connections (ICE) off');
    return { ok: true, transport: createTransport(koffi, fn, messages, utils, maxMessageBytes, log) };
}

/**
 * @typedef {object} RelayTransport
 * @property {'relay'} kind
 * @property {(steamId: string, bytes: Uint8Array, legacySendType?: number) => number} send  the EResult
 * @property {() => { steamId: string, data: Buffer } | null} next   the next message, or null
 * @property {() => number} peekSize       the next message's size, or 0
 * @property {(steamId: string) => boolean} acceptFrom   accept a pending session request
 * @property {(steamId: string) => boolean} close
 * @property {(steamId: string) => { state: number, relayed: boolean, addressKnown: boolean, layoutOk: boolean }} session
 * @property {() => string} relayNetworkStatus
 * @property {() => { received: number, dropped: number }} counts
 * @property {() => void} dispose
 */

function createTransport(koffi, fn, messages, utils, maxMessageBytes, log) {
    /** steamId -> its encoded identity */
    const identities = new Map();
    const pointers = Buffer.alloc(MAX_MESSAGES_PER_READ * 8);
    /** @type {{ steamId: string, data: Buffer }[]} */
    const queue = [];
    let received = 0;
    let dropped = 0;

    const identityOf = (steamId) => {
        let identity = identities.get(steamId);
        if (!identity) {
            if (identities.size >= IDENTITY_CACHE) identities.delete(identities.keys().next().value);
            identity = encodeSteamIdentity(steamId);
            identities.set(steamId, identity);
        }
        return identity;
    };

    /** Copy one message out of Steam's memory; it is released whatever happens. */
    const take = (message) => {
        try {
            const head = Buffer.from(new Uint8Array(koffi.view(message, MESSAGE_LAYOUT.head)));
            const data = head.readBigUInt64LE(MESSAGE_LAYOUT.data);
            const size = head.readInt32LE(MESSAGE_LAYOUT.size);
            const steamId = decodeSteamIdentity(head.subarray(MESSAGE_LAYOUT.identity));
            if (!steamId || size < 0 || size > maxMessageBytes || (size > 0 && !data)) {
                dropped += 1;
                return;
            }
            const bytes = size > 0 ? Buffer.from(new Uint8Array(koffi.view(data, size))) : Buffer.alloc(0);
            queue.push({ steamId, data: bytes });
            received += 1;
        } finally {
            fn.release(message);
        }
    };

    const pull = () => {
        if (queue.length > 0) return;
        const count = fn.receive(messages, RELAY_CHANNEL, pointers, MAX_MESSAGES_PER_READ);
        for (let i = 0; i < Math.min(count, MAX_MESSAGES_PER_READ); i += 1) {
            const message = pointers.readBigUInt64LE(i * 8);
            if (message) take(message);
        }
    };

    return {
        kind: 'relay',
        send(steamId, bytes, legacySendType = 2) {
            const id = steamIdText(steamId);
            if (!id || !bytes) return 0;
            const flags = (SEND_FLAGS_BY_LEGACY_TYPE[legacySendType] ?? SEND_FLAGS_BY_LEGACY_TYPE[2]) | SEND_AUTO_RESTART;
            const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            return fn.send(messages, identityOf(id), data, data.byteLength, flags, RELAY_CHANNEL);
        },
        next() {
            pull();
            return queue.shift() ?? null;
        },
        peekSize() {
            pull();
            return queue[0]?.data.byteLength ?? 0;
        },
        acceptFrom(steamId) {
            const id = steamIdText(steamId);
            return id ? fn.accept(messages, identityOf(id)) === true : false;
        },
        close(steamId) {
            const id = steamIdText(steamId);
            if (!id) return false;
            const closed = fn.close(messages, identityOf(id)) === true;
            identities.delete(id);
            return closed;
        },
        session(steamId) {
            const id = steamIdText(steamId);
            if (!id) {
                return {
                    state: SESSION_STATE.none, relayed: false, addressKnown: false, layoutOk: false,
                };
            }
            const info = Buffer.alloc(INFO_LAYOUT.bytes);
            const state = fn.info(messages, identityOf(id), info, null);
            const address = info.subarray(INFO_LAYOUT.address, INFO_LAYOUT.address + INFO_LAYOUT.addressBytes);
            return {
                state,
                relayed: (info.readInt32LE(INFO_LAYOUT.flags) & FLAG_RELAYED) !== 0,
                addressKnown: address.some((byte) => byte !== 0),
                // The info is read by offset; it is trusted only while its own state agrees.
                layoutOk: state !== SESSION_STATE.none && info.readInt32LE(INFO_LAYOUT.state) === state,
            };
        },
        relayNetworkStatus() {
            try {
                const value = fn.relayStatus(utils, null);
                return AVAILABILITY.get(value) ?? `unknown (${value})`;
            } catch (error) {
                log(`WARN: relay network status failed: ${error?.message || error}`);
                return 'unknown';
            }
        },
        counts() {
            return { received, dropped };
        },
        dispose() {
            queue.length = 0;
            identities.clear();
        },
    };
}
