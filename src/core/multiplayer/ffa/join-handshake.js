// @ts-check

import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../../events/multiplayer-events.js';
import { MessageTypes } from '../../network/message-types.js';
import {
    acceptsEnvelopeVersionOffer,
    getProtocolRejectionMessage,
    PROTOCOL_REJECTION_REASONS,
} from '../../network/protocol-version.js';
import {
    isJoinHandshakeComplete,
    JOIN_LIFECYCLE_EVENTS,
    transitionFfaJoinState,
} from './join-lifecycle.js';
import { routeFfaResync } from './resync-request-handler.js';

const LOBBY_FULL_MESSAGE = 'This lobby is full. Choose another match or try again later.';

/** @param {any} game */
export function buildJoinProtocolOffer(game) {
    const offer = game.network.getProtocolOffer();
    game._lastJoinProtocolOffer = offer;
    return {
        // Exact-version legacy hosts read this field. Advertising the minimum
        // preserves overlap while new hosts use the full range below.
        protocolVersion: offer.minVersion,
        minVersion: offer.minVersion,
        maxVersion: offer.maxVersion,
        envelopeVersion: game.network.envelopeVersion,
        minEnvelopeVersion: game.network.envelopeVersion,
        maxEnvelopeVersion: game.network.envelopeVersion,
        handshakeNonce: game._joinHandshakeNonce ?? null,
    };
}

/** @param {any} game */
function cancelJoinAnnounce(game) {
    if (game._announceTimer) clearTimeout(game._announceTimer);
    game._announceTimer = null;
}

/** @param {string} reason */
function localRejectionMessage(reason) {
    return reason === 'lobby_full'
        ? LOBBY_FULL_MESSAGE
        : getProtocolRejectionMessage(reason);
}

/** @param {any} game @param {any} data */
function applyTerminalJoinRejection(game, data = {}) {
    if (data.handshakeNonce && game._joinHandshakeNonce
        && data.handshakeNonce !== game._joinHandshakeNonce) return;
    const reason = typeof data.reason === 'string' ? data.reason : 'rejected';
    const signature = `${reason}:${data.minVersion ?? ''}:${data.maxVersion ?? ''}`;
    if (game._lastJoinRejection === signature) return;
    game._lastJoinRejection = signature;
    transitionFfaJoinState(game, JOIN_LIFECYCLE_EVENTS.REJECT, { reason });
    cancelJoinAnnounce(game);
    game.network.clearNegotiatedProtocol?.(game.network.hostSteamId);
    emitMultiplayerEvent(MULTIPLAYER_EVENTS.JOIN_REJECTED, {
        reason,
        message: localRejectionMessage(reason),
        minVersion: data.minVersion ?? null,
        maxVersion: data.maxVersion ?? null,
    });
}

/** @param {any} game @param {any} result @param {string} reason @param {string|null} [handshakeNonce] */
function buildWelcomePayload(game, result, reason, handshakeNonce = null) {
    const selectedVersion = result.protocolVersion ?? null;
    return {
        // Kept for exact-version clients during rollout.
        protocolVersion: selectedVersion ?? game.network.protocolVersion,
        selectedVersion,
        minVersion: result.minVersion,
        maxVersion: result.maxVersion,
        envelopeVersion: game.network.envelopeVersion,
        featureFlags: [],
        matchId: game.network.matchId,
        matchNonce: game.network.matchNonce,
        hostSteamId: game.network.hostSteamId,
        accepted: result.accepted,
        reason,
        message: result.message ?? null,
        handshakeNonce,
    };
}

/** @param {any} game @param {any} msg @param {any} result */
function rejectHello(game, msg, result) {
    game.network.clearNegotiatedProtocol?.(msg.from);
    const payload = buildWelcomePayload(
        game,
        result,
        result.reason,
        msg.data?.handshakeNonce ?? null,
    );
    // Stamp terminal bootstrap packets with the requester's exact wire version
    // so already-shipped equality-only clients can still read the rejection.
    const requesterVersion = msg.protocolVersion ?? msg.data?.protocolVersion;
    const options = requesterVersion ? {
        protocolVersion: requesterVersion,
        envelopeVersion: msg.envelopeVersion,
    } : undefined;
    game.network.sendP2PMessage(msg.from, MessageTypes.NET_WELCOME, payload, options);
    game.network.sendP2PMessage(msg.from, MessageTypes.JOIN_REJECTED, {
        reason: result.reason,
        message: result.message,
        minVersion: result.minVersion,
        maxVersion: result.maxVersion,
        handshakeNonce: msg.data?.handshakeNonce ?? null,
    }, options);
}

/** @param {any} game @param {any} registry */
export function registerJoinHandshakeHandlers(game, registry) {
    registry.register(MessageTypes.NET_HELLO, (msg) => {
        if (!game.isHost || game._disposed) return;
        game.network.lockProtocolSession?.();
        const result = game.network.negotiateProtocol(msg.data);
        if (!acceptsEnvelopeVersionOffer(
            msg.data,
            msg.envelopeVersion,
            game.network.envelopeVersion,
        )) {
            result.accepted = false;
            result.protocolVersion = null;
            result.reason = PROTOCOL_REJECTION_REASONS.ENVELOPE_MISMATCH;
            result.message = getProtocolRejectionMessage(result.reason);
        }

        const existingPlayer = game.players.get(msg.from);
        const existingSpectator = game.spectators.has(msg.from);
        const isNewPlayer = !existingPlayer && !existingSpectator && !msg.data?.asSpectator;
        const capacity = game.matchConfig?.maxPlayers || 8;
        if (result.accepted && isNewPlayer && game.players.size >= capacity) {
            result.accepted = false;
            result.protocolVersion = null;
            result.reason = 'lobby_full';
            result.message = LOBBY_FULL_MESSAGE;
        }

        if (!result.accepted || !result.protocolVersion
            || !game.network.setNegotiatedProtocol(msg.from, result.protocolVersion)) {
            if (result.accepted) {
                result.accepted = false;
                result.protocolVersion = null;
                result.reason = PROTOCOL_REJECTION_REASONS.INVALID_SELECTION;
                result.message = getProtocolRejectionMessage(result.reason);
            }
            rejectHello(game, msg, result);
            return;
        }

        // WELCOME is deliberately first on the reliable channel. The peer adopts
        // the selected session before roster, match metadata, or resync arrives.
        game.network.sendP2PMessage(
            msg.from,
            MessageTypes.NET_WELCOME,
            buildWelcomePayload(game, result, 'ok', msg.data?.handshakeNonce ?? null),
        );

        if (existingPlayer?.isDisconnected) {
            clearTimeout(existingPlayer.disconnectTimeout);
            existingPlayer.isDisconnected = false;
            existingPlayer.disconnectTimeout = null;
            game.broadcastPlayerList();
            routeFfaResync(game, msg.from, 'reconnect');
            return;
        }
        if (existingPlayer || existingSpectator) return;

        if (msg.data?.asSpectator) {
            game._registerSpectator(msg.from, msg.data?.name || 'Spectator');
            return;
        }

        const added = game.addPlayer(msg.from, msg.data?.name || 'Player');
        if (added) {
            game.queueResync(msg.from);
            return;
        }

        game.network.clearNegotiatedProtocol(msg.from);
        rejectHello(game, msg, {
            ...result,
            accepted: false,
            protocolVersion: null,
            reason: 'join_failed',
            message: 'The host could not add this player to the match.',
        });
    });

    registry.register(MessageTypes.NET_WELCOME, (msg) => {
        if (game.isHost || game._disposed) return;
        if (!msg.data?.accepted) {
            applyTerminalJoinRejection(game, msg.data);
            return;
        }

        const selectedVersion = msg.data.selectedVersion ?? msg.data.protocolVersion;
        const offer = game._lastJoinProtocolOffer ?? game.network.getProtocolOffer();
        const senderMatchesHost = !msg.from
            || !game.network.hostSteamId
            || msg.from === game.network.hostSteamId;
        const identityIsValid = senderMatchesHost
            && Boolean(msg.data.matchId && msg.data.matchNonce && msg.data.hostSteamId)
            && (!msg.from || msg.data.hostSteamId === msg.from)
            && (!game.network.matchId || msg.data.matchId === game.network.matchId);
        const selectionIsValid = game.network.acceptsProtocolSelection(selectedVersion, offer)
            && (!msg.protocolVersion || msg.protocolVersion === selectedVersion)
            && (msg.data.envelopeVersion ?? msg.envelopeVersion) === game.network.envelopeVersion
            && (!msg.envelopeVersion || msg.envelopeVersion === game.network.envelopeVersion);
        const attemptIsValid = isJoinHandshakeComplete(game.joinState)
            || msg.data.selectedVersion == null
            || (Boolean(game._joinHandshakeNonce)
                && msg.data.handshakeNonce === game._joinHandshakeNonce);

        if (!identityIsValid || !selectionIsValid || !attemptIsValid
            || !game.network.setNegotiatedProtocol(msg.from, selectedVersion)) {
            applyTerminalJoinRejection(game, {
                reason: PROTOCOL_REJECTION_REASONS.INVALID_SELECTION,
            });
            return;
        }

        game.network.matchId = msg.data.matchId;
        game.network.matchNonce = msg.data.matchNonce;
        game.network.hostSteamId = msg.data.hostSteamId;
        transitionFfaJoinState(game, JOIN_LIFECYCLE_EVENTS.WELCOME_ACCEPTED, {
            hostSteamId: msg.data.hostSteamId,
            protocolVersion: selectedVersion,
        });
        game._lastJoinRejection = null;
        cancelJoinAnnounce(game);
    });

    registry.register(MessageTypes.JOIN_REJECTED, (msg) => {
        if (!game.isHost) applyTerminalJoinRejection(game, msg.data);
    });
}

/** @param {any} game @param {any} session @param {string} [reason] */
export function broadcastSessionWelcome(game, session, reason = 'match_start') {
    const offer = game.network.getProtocolOffer();
    const selectedVersion = session.protocolVersion;
    game.network.connectedPeers.forEach((peerInfo, steamId) => {
        if (!game.network.hasNegotiatedProtocol(steamId)) return;
        game.network.sendP2PMessage(steamId, MessageTypes.NET_WELCOME, {
            protocolVersion: selectedVersion,
            selectedVersion,
            minVersion: offer.minVersion,
            maxVersion: offer.maxVersion,
            envelopeVersion: game.network.envelopeVersion,
            featureFlags: [],
            matchId: session.matchId,
            matchNonce: session.matchNonce,
            hostSteamId: session.hostSteamId,
            accepted: true,
            reason,
        });
    });
}
