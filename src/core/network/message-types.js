// @ts-check
/**
 * Network Message Types
 * Protocol for P2P communication
 */

import {
    CURRENT_PROTOCOL_VERSION,
    PROTOCOL_V1,
    PROTOCOL_V2,
} from './protocol-version.js';

export const MessageTypes = Object.freeze(/** @type {const} */ ({
    // Lobby messages
    LOBBY_PLAYER_JOINED: 'lobby:player:joined',
    LOBBY_PLAYER_LEFT: 'lobby:player:left',
    LOBBY_PLAYER_READY: 'lobby:player:ready',
    LOBBY_GAME_START: 'lobby:game:start',
    LOBBY_CONFIG_UPDATE: 'lobby:config:update',
    LOBBY_MATCH_CONFIG: 'lobby:match:config',
    JOIN_REJECTED: 'lobby:join:rejected', // Host → joiner: rejected (e.g. lobby full)
    RETURN_TO_LOBBY: 'lobby:return', // Host → all: leave the results screen back to the waiting room
    PLAYER_KICKED: 'lobby:player:kicked', // Host → a player: you've been removed from the match

    // Network QoS (ping/pong)
    NET_PING: 'net:ping',
    NET_PONG: 'net:pong',
    NET_HELLO: 'net:hello',
    NET_WELCOME: 'net:welcome',
    NET_ERROR: 'net:error',

    // Game messages (sent from peers to host)
    GAME_INPUT_MOVE: 'game:input:move', // Unsupported legacy direct input
    GAME_INPUT_ROTATE: 'game:input:rotate', // Unsupported legacy direct input
    GAME_INPUT_DROP: 'game:input:drop', // Unsupported legacy direct input
    GAME_INPUT_BATCH: 'game:input:batch', // Peer → Host (batched inputs)
    GAME_INPUT_ACK: 'game:input:ack', // Host → Peer (input acknowledgement)
    GAME_ATTACK_REQUEST: 'game:attack:request', // Peer → Host

    // Game state (broadcast from host to all peers)
    GAME_STATE_FULL: 'game:state:full', // Host → All (full sync)
    GAME_STATE_DELTA: 'game:state:delta', // Host → All (delta update)
    GAME_STATE_RESYNC: 'game:state:resync', // Host → Peer (chunked resync)
    GAME_STATE_RESYNC_ACK: 'game:state:resync:ack', // Peer → Host (chunk ack/final)
    GAME_STATE_RESYNC_PREPARE: 'game:state:resync:prepare', // Host → Peer (freeze/flush barrier)
    GAME_STATE_RESYNC_READY: 'game:state:resync:ready', // Peer → Host (input fence reached locally)
    GAME_SYNCPOINT: 'game:syncpoint', // Host → All (safe state marker)
    GAME_PIECE_LOCK: 'game:piece:lock', // Host → All
    GAME_LINES_CLEAR: 'game:lines:clear', // Host → All
    GAME_GARBAGE_SENT: 'game:garbage:sent', // Host → All
    GAME_PLAYER_DIED: 'game:player:died', // Host → All
    GAME_PLAYER_FRAG: 'game:player:frag', // Host → All
    GAME_PLAYER_LOCK: 'game:player:lock', // Host → All (reliable per-lock authoritative board snap; anchors opponent boards)
    GAME_MATCH_END: 'game:match:end', // Host → All
    GAME_ROUND_RESTART: 'game:round:restart', // Host → All (restart round with countdown)
    GAME_ROUND_READY: 'game:round:ready', // Peer → Host (peer has reset and is ready for the next round — ready-barrier syncpoint)
    GAME_ROUND_START: 'game:round:start', // Host → All (all players ready / timeout — everyone starts the round together)
    GAME_CHAT: 'game:chat', // Peer → Host submission, Host → Peer relay
    GAME_REMATCH_VOTE: 'game:rematch:vote', // Peer → Host
    GAME_REMATCH_STATUS: 'game:rematch:status', // Host → All
    GAME_POTATO_UPDATE: 'game:potato:update', // Host → All
    GAME_POTATO_DETONATE: 'game:potato:detonate', // Host → All

    // Host Migration
    GAME_HOST_MIGRATION_ELECT: 'game:host:elect', // Peer → All
    GAME_HOST_MIGRATION_CLAIM: 'game:host:claim', // Peer → All
    GAME_HOST_MIGRATION_SYNC: 'game:host:sync', // New Host → All
    LEGACY_HOST_MIGRATED: 'game:host:migrated', // Unsupported legacy alias
    LEGACY_HOST_HANDOFF: 'game:host:handoff', // Unsupported legacy alias
    NET_HEARTBEAT: 'net:heartbeat', // Host → All (keepalive)
}));

/** @typedef {(typeof MessageTypes)[keyof typeof MessageTypes]} MessageType */
/** @typedef {'host'|'peer'|'successor'} ProtocolSenderRole */
/** @typedef {'host'|'peer'} ProtocolReceiverRole */
/** @typedef {{sender: ProtocolSenderRole, receiver: ProtocolReceiverRole}} ProtocolRoute */
/**
 * @typedef {{
 *   status: 'supported',
 *   routes: ReadonlyArray<Readonly<ProtocolRoute>>,
 *   stateful?: 'migration-claim'|'migration-sync',
 * }} SupportedProtocolEntry
 */
/** @typedef {{status: 'unsupported', reason: string}} UnsupportedProtocolEntry */
/** @typedef {Readonly<SupportedProtocolEntry|UnsupportedProtocolEntry>} ProtocolEntry */

/** @type {ReadonlyArray<Readonly<ProtocolRoute>>} */
const HOST_TO_PEER = Object.freeze([Object.freeze({ sender: 'host', receiver: 'peer' })]);
/** @type {ReadonlyArray<Readonly<ProtocolRoute>>} */
const PEER_TO_HOST = Object.freeze([Object.freeze({ sender: 'peer', receiver: 'host' })]);
/** @type {ReadonlyArray<Readonly<ProtocolRoute>>} */
const PEER_TO_PEER = Object.freeze([Object.freeze({ sender: 'peer', receiver: 'peer' })]);
/** @type {ReadonlyArray<Readonly<ProtocolRoute>>} */
const SUCCESSOR_TO_PEER = Object.freeze([Object.freeze({ sender: 'successor', receiver: 'peer' })]);
/** @type {ReadonlyArray<Readonly<ProtocolRoute>>} */
const RELAY_ROUTES = Object.freeze([...PEER_TO_HOST, ...HOST_TO_PEER]);

/**
 * @param {ReadonlyArray<Readonly<ProtocolRoute>>} routes
 * @param {'migration-claim'|'migration-sync'} [stateful]
 * @returns {Readonly<SupportedProtocolEntry>}
 */
function supported(routes, stateful) {
    return Object.freeze(stateful
        ? { status: 'supported', routes, stateful }
        : { status: 'supported', routes });
}

/** @param {string} reason @returns {Readonly<UnsupportedProtocolEntry>} */
function unsupported(reason) {
    return Object.freeze({ status: 'unsupported', reason });
}

/**
 * Complete Phase 6A.3 wire catalog. Directional relays use exact route tuples;
 * no `any` role exists, so peer→peer and host→host traffic stays denied.
 *
 * @type {Readonly<Record<MessageType, ProtocolEntry>>}
 */
export const PROTOCOL_CATALOG = Object.freeze({
    [MessageTypes.LOBBY_PLAYER_JOINED]: supported(RELAY_ROUTES),
    [MessageTypes.LOBBY_PLAYER_LEFT]: supported(RELAY_ROUTES),
    [MessageTypes.LOBBY_PLAYER_READY]: supported(PEER_TO_HOST),
    [MessageTypes.LOBBY_GAME_START]: supported(HOST_TO_PEER),
    [MessageTypes.LOBBY_CONFIG_UPDATE]: unsupported('No production sender or receiver'),
    [MessageTypes.LOBBY_MATCH_CONFIG]: unsupported('No production sender or receiver'),
    [MessageTypes.JOIN_REJECTED]: supported(HOST_TO_PEER),
    [MessageTypes.RETURN_TO_LOBBY]: supported(HOST_TO_PEER),
    [MessageTypes.PLAYER_KICKED]: supported(HOST_TO_PEER),

    [MessageTypes.NET_PING]: supported(PEER_TO_HOST),
    [MessageTypes.NET_PONG]: supported(HOST_TO_PEER),
    [MessageTypes.NET_HELLO]: supported(PEER_TO_HOST),
    [MessageTypes.NET_WELCOME]: supported(HOST_TO_PEER),
    [MessageTypes.NET_ERROR]: supported(RELAY_ROUTES),

    [MessageTypes.GAME_INPUT_MOVE]: unsupported('Superseded by sequenced GAME_INPUT_BATCH'),
    [MessageTypes.GAME_INPUT_ROTATE]: unsupported('Superseded by sequenced GAME_INPUT_BATCH'),
    [MessageTypes.GAME_INPUT_DROP]: unsupported('Superseded by sequenced GAME_INPUT_BATCH'),
    [MessageTypes.GAME_INPUT_BATCH]: supported(PEER_TO_HOST),
    [MessageTypes.GAME_INPUT_ACK]: unsupported('Superseded by snapshot acknowledgement fields'),
    [MessageTypes.GAME_ATTACK_REQUEST]: supported(PEER_TO_HOST),

    [MessageTypes.GAME_STATE_FULL]: supported(HOST_TO_PEER),
    [MessageTypes.GAME_STATE_DELTA]: unsupported('Binary deltas use GAME_STATE_FULL envelopes'),
    [MessageTypes.GAME_STATE_RESYNC]: supported(HOST_TO_PEER),
    [MessageTypes.GAME_STATE_RESYNC_ACK]: supported(PEER_TO_HOST),
    [MessageTypes.GAME_STATE_RESYNC_PREPARE]: supported(HOST_TO_PEER),
    [MessageTypes.GAME_STATE_RESYNC_READY]: supported(PEER_TO_HOST),
    [MessageTypes.GAME_SYNCPOINT]: supported(HOST_TO_PEER),
    [MessageTypes.GAME_PIECE_LOCK]: unsupported('Superseded by GAME_PLAYER_LOCK'),
    [MessageTypes.GAME_LINES_CLEAR]: supported(HOST_TO_PEER),
    [MessageTypes.GAME_GARBAGE_SENT]: supported(HOST_TO_PEER),
    [MessageTypes.GAME_PLAYER_DIED]: supported(HOST_TO_PEER),
    [MessageTypes.GAME_PLAYER_FRAG]: supported(HOST_TO_PEER),
    [MessageTypes.GAME_PLAYER_LOCK]: supported(HOST_TO_PEER),
    [MessageTypes.GAME_MATCH_END]: supported(HOST_TO_PEER),
    [MessageTypes.GAME_ROUND_RESTART]: supported(HOST_TO_PEER),
    [MessageTypes.GAME_ROUND_READY]: supported(PEER_TO_HOST),
    [MessageTypes.GAME_ROUND_START]: supported(HOST_TO_PEER),
    [MessageTypes.GAME_CHAT]: supported(RELAY_ROUTES),
    [MessageTypes.GAME_REMATCH_VOTE]: supported(PEER_TO_HOST),
    [MessageTypes.GAME_REMATCH_STATUS]: supported(HOST_TO_PEER),
    [MessageTypes.GAME_POTATO_UPDATE]: supported(HOST_TO_PEER),
    [MessageTypes.GAME_POTATO_DETONATE]: supported(HOST_TO_PEER),

    [MessageTypes.GAME_HOST_MIGRATION_ELECT]: unsupported('Election is local; CLAIM is the wire event'),
    [MessageTypes.GAME_HOST_MIGRATION_CLAIM]: supported(PEER_TO_PEER, 'migration-claim'),
    [MessageTypes.GAME_HOST_MIGRATION_SYNC]: supported(SUCCESSOR_TO_PEER, 'migration-sync'),
    [MessageTypes.LEGACY_HOST_MIGRATED]: unsupported('Dormant alias replaced by migration CLAIM/SYNC'),
    [MessageTypes.LEGACY_HOST_HANDOFF]: unsupported('Dormant unsafe alias with no production sender'),
    [MessageTypes.NET_HEARTBEAT]: supported(HOST_TO_PEER),
});

/**
 * Catalogs are explicit per wire version. Adding a supported version requires
 * adding its role/schema table here; negotiation never guesses compatibility.
 */
export const PROTOCOL_CATALOG_BY_VERSION = Object.freeze({
    [PROTOCOL_V1]: PROTOCOL_CATALOG,
    [PROTOCOL_V2]: PROTOCOL_CATALOG,
});

/** @type {Set<string>} */
const BOOTSTRAP_MESSAGE_TYPES = new Set([
    MessageTypes.NET_HELLO,
    MessageTypes.NET_WELCOME,
    MessageTypes.JOIN_REJECTED,
    MessageTypes.NET_ERROR,
]);

/** @param {unknown} messageType */
export function isProtocolBootstrapMessageType(messageType) {
    return typeof messageType === 'string' && BOOTSTRAP_MESSAGE_TYPES.has(messageType);
}

/**
 * @param {unknown} messageType
 * @param {unknown} [protocolVersion]
 * @returns {ProtocolEntry|null}
 */
export function getProtocolEntry(messageType, protocolVersion = CURRENT_PROTOCOL_VERSION) {
    if (typeof messageType !== 'string') return null;
    // Negotiation and its terminal error lane must remain readable before a
    // common version exists, including when the remote is newer than this build.
    if (isProtocolBootstrapMessageType(messageType)) {
        return PROTOCOL_CATALOG[/** @type {MessageType} */ (messageType)];
    }
    if (typeof protocolVersion !== 'string') return null;
    const catalogs = /** @type {Readonly<Record<string, Readonly<Record<string, ProtocolEntry>>>>} */ (
        PROTOCOL_CATALOG_BY_VERSION
    );
    const catalog = catalogs[protocolVersion];
    if (!catalog || !Object.prototype.hasOwnProperty.call(catalog, messageType)) return null;
    return catalog[messageType];
}

/** @param {unknown} messageType @param {unknown} [protocolVersion] */
export function isSupportedMessageType(messageType, protocolVersion = CURRENT_PROTOCOL_VERSION) {
    return getProtocolEntry(messageType, protocolVersion)?.status === 'supported';
}

/** @param {unknown} messageType */
export function isSupportedInAnyProtocolVersion(messageType) {
    if (isProtocolBootstrapMessageType(messageType)) return true;
    return Object.keys(PROTOCOL_CATALOG_BY_VERSION).some(
        (version) => isSupportedMessageType(messageType, version),
    );
}

// Temporary compatibility view for focused tests and callers that consume
// single-route policies. Multi-route relay entries intentionally do not appear.
/** @type {Record<string, Readonly<ProtocolRoute>>} */
const singleRoutePolicies = {};
Object.entries(PROTOCOL_CATALOG).forEach(([messageType, entry]) => {
    if (entry.status === 'supported' && entry.routes.length === 1) {
        singleRoutePolicies[messageType] = entry.routes[0];
    }
});
export const MESSAGE_ROLE_POLICIES = Object.freeze(singleRoutePolicies);

/**
 * Serialize a message for network transmission
 */
export function serializeMessage(type, data) {
    return JSON.stringify({
        type,
        data,
        timestamp: Date.now(),
    });
}

/**
 * Deserialize a message from network
 */
export function deserializeMessage(message) {
    try {
        return JSON.parse(message);
    } catch (err) {
        console.error('Failed to deserialize message:', err);
        return null;
    }
}
