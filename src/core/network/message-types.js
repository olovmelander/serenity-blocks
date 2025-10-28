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
  
  // Game messages (sent from peers to host)
  GAME_INPUT_MOVE: 'game:input:move',           // Peer → Host
  GAME_INPUT_ROTATE: 'game:input:rotate',       // Peer → Host
  GAME_INPUT_DROP: 'game:input:drop',           // Peer → Host
  
  // Game state (broadcast from host to all peers)
  GAME_STATE_FULL: 'game:state:full',           // Host → All (full sync)
  GAME_STATE_DELTA: 'game:state:delta',         // Host → All (delta update)
  GAME_PIECE_LOCK: 'game:piece:lock',           // Host → All
  GAME_LINES_CLEAR: 'game:lines:clear',         // Host → All
  GAME_GARBAGE_SENT: 'game:garbage:sent',       // Host → All
  GAME_PLAYER_DIED: 'game:player:died',         // Host → All
  GAME_PLAYER_FRAG: 'game:player:frag',         // Host → All
  GAME_MATCH_END: 'game:match:end',             // Host → All
  GAME_ROUND_RESTART: 'game:round:restart',     // Host → All (restart round with countdown)
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

