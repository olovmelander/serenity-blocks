// @ts-check

import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../../events/multiplayer-events.js';
import { MessageTypes } from '../../network/message-types.js';
import { capPeerText, MAX_CHAT_CHARS, MAX_NAME_CHARS } from '../../network/peer-text.js';

/** Messages a sender may send in a burst, and the time that earns one more. */
export const CHAT_BURST = 5;
export const CHAT_REFILL_MS = 1500;

/**
 * Whether a sender may chat now (the host relays to everyone, so a flood was everyone's).
 * @param {Record<string, any>} game
 * @param {string} steamId
 * @param {number} now
 */
function takeChatToken(game, steamId, now) {
    if (!game._chatBuckets) game._chatBuckets = new Map();
    let bucket = game._chatBuckets.get(steamId);
    if (!bucket) {
        bucket = { tokens: CHAT_BURST, at: now };
        game._chatBuckets.set(steamId, bucket);
    } else if (now > bucket.at) {
        bucket.tokens = Math.min(CHAT_BURST, bucket.tokens + (now - bucket.at) / CHAT_REFILL_MS);
        bucket.at = now;
    }
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
}

/**
 * One chat message: a peer's submission on the host, or the host's relay on a peer. The
 * host binds the author to the Steam-authenticated sender, caps the text and the rate,
 * and relays it to everyone else; every side keeps it in the history and shows it.
 * @param {Record<string, any>} game
 * @param {{from?: string, data?: Record<string, any>}} msg
 * @param {number} [now]
 * @returns {boolean} whether the message was taken
 */
export function handleFfaChat(game, msg, now = Date.now()) {
    const data = msg?.data || {};
    const message = capPeerText(data.message ?? data.text, MAX_CHAT_CHARS);
    if (!message) return false;
    const resolved = {
        message,
        steamId: data.steamId,
        playerName: capPeerText(data.playerName, MAX_NAME_CHARS) || 'Player',
        color: data.color,
        timestamp: Number.isFinite(data.timestamp) ? data.timestamp : now,
    };
    if (game.isHost) {
        const rosterPlayer = game.players?.get(msg.from);
        if (!rosterPlayer && !game.spectators?.has(msg.from)) return false;
        if (!takeChatToken(game, String(msg.from), now)) return false;
        // Peer submissions never choose their relayed identity.
        resolved.steamId = msg.from;
        resolved.playerName = rosterPlayer?.name || 'Spectator';
        resolved.color = rosterPlayer?.color;
    }
    resolved.color = resolved.color || game.players?.get(resolved.steamId)?.color;

    game.chatHistory.push(resolved);
    if (game.chatHistory.length > 100) game.chatHistory.shift();
    game.chat?.addMessage(resolved);
    if (resolved.steamId !== game.localPlayerId) {
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.CHAT_MESSAGE, { ...resolved });
    }
    // The host relays to the others; the sender already shows its own message.
    if (game.isHost) game.broadcastToPeers(MessageTypes.GAME_CHAT, resolved, msg.from);
    return true;
}
