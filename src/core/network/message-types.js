/**
 * Network Message Types
 * Protocol for P2P communication
 */

export const MessageTypes = {
    // Lobby messages
    LOBBY_PLAYER_JOINED: 'lobby:player:joined',
    LOBBY_PLAYER_LEFT: 'lobby:player:left',
    LOBBY_PLAYER_READY: 'lobby:player:ready',
    LOBBY_GAME_START: 'lobby:game:start',
    LOBBY_CONFIG_UPDATE: 'lobby:config:update',
    LOBBY_MATCH_CONFIG: 'lobby:match:config',

    // Network QoS (ping/pong)
    NET_PING: 'net:ping',
    NET_PONG: 'net:pong',
    NET_HELLO: 'net:hello',
    NET_WELCOME: 'net:welcome',
    NET_ERROR: 'net:error',

    // Game messages (sent from peers to host)
    GAME_INPUT_MOVE: 'game:input:move', // Peer → Host
    GAME_INPUT_ROTATE: 'game:input:rotate', // Peer → Host
    GAME_INPUT_DROP: 'game:input:drop', // Peer → Host
    GAME_INPUT_BATCH: 'game:input:batch', // Peer → Host (batched inputs)
    GAME_INPUT_ACK: 'game:input:ack', // Host → Peer (input acknowledgement)

    // Game state (broadcast from host to all peers)
    GAME_STATE_FULL: 'game:state:full', // Host → All (full sync)
    GAME_STATE_DELTA: 'game:state:delta', // Host → All (delta update)
    GAME_STATE_RESYNC: 'game:state:resync', // Host → Peer (chunked resync)
    GAME_STATE_RESYNC_ACK: 'game:state:resync:ack', // Peer → Host (chunk ack/final)
    GAME_SYNCPOINT: 'game:syncpoint', // Host → All (safe state marker)
    GAME_PIECE_LOCK: 'game:piece:lock', // Host → All
    GAME_LINES_CLEAR: 'game:lines:clear', // Host → All
    GAME_GARBAGE_SENT: 'game:garbage:sent', // Host → All
    GAME_PLAYER_DIED: 'game:player:died', // Host → All
    GAME_PLAYER_FRAG: 'game:player:frag', // Host → All
    GAME_MATCH_END: 'game:match:end', // Host → All
    GAME_ROUND_RESTART: 'game:round:restart', // Host → All (restart round with countdown)
    GAME_ROUND_RESTART: 'game:round:restart', // Host → All (restart round with countdown)

    // Host Migration
    GAME_HOST_MIGRATION_ELECT: 'game:host:elect', // Peer → All
    GAME_HOST_MIGRATION_CLAIM: 'game:host:claim', // Peer → All
    GAME_HOST_MIGRATION_SYNC: 'game:host:sync', // New Host → All
    NET_HEARTBEAT: 'net:heartbeat', // Host → All (keepalive)
};

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
