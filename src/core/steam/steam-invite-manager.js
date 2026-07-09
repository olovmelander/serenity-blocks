/**
 * SteamInviteManager
 *
 * Listens for Steam lobby invites and routes them through
 * a user-friendly toast flow with queueing when busy.
 */

import steamService from './steam-service.js';
import { STEAM_EVENTS } from './steam-config.js';
import { GAME_MODES } from '../constants.js';
import { onMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../events/multiplayer-events.js';
import { getInviteToastManager } from '../../ui/components/invite-toast.js';

export class SteamInviteManager {
    constructor(gameModeManager) {
        this.gameModeManager = gameModeManager;
        this.toastManager = getInviteToastManager();
        this.pendingInvites = [];
        this.pendingInviteIds = new Set();
        this.pendingMatchUnsub = null;
        this.unsubscribers = [];
        this._gameEndedHandler = null;
        this._returnToMenuHandler = null;
        this._modalHiddenHandler = null;

        this._bind();
    }

    _bind() {
        this.unsubscribers.push(
            steamService.on(STEAM_EVENTS.INVITE_RECEIVED, (invite) => {
                this._handleInvite(invite);
            }),
        );

        const pending = steamService.consumePendingInvites();
        pending.forEach((invite) => this._handleInvite(invite));

        this.unsubscribers.push(
            this.gameModeManager.on('modeStopped', () => {
                this._tryJoinPending('modeStopped');
            }),
        );

        this._gameEndedHandler = () => this._tryJoinPending('gameEnded');
        this._returnToMenuHandler = () => this._tryJoinPending('returnToMenu');
        window.addEventListener('gameEnded', this._gameEndedHandler);
        window.addEventListener('returnToMenu', this._returnToMenuHandler);

        this._modalHiddenHandler = (event) => {
            const modalName = event?.detail?.modalName;
            if (modalName === 'gameOver' || modalName === 'start') {
                this._tryJoinPending(`modalHidden:${modalName}`);
            }
        };
        window.addEventListener('modalHidden', this._modalHiddenHandler);
    }

    async _handleInvite(invite) {
        if (!invite?.lobbyId) {
            return;
        }

        const friendName = await this._resolveFriendName(invite.friendSteamId);
        const isBusy = this._isBusy();
        const modeId = this.gameModeManager.getCurrentModeId();
        const lowKey = modeId === GAME_MODES.SERENITY;

        const message = isBusy
            ? `Invite from ${friendName} - will join after match`
            : `Invite from ${friendName}`;

        this.toastManager.showInvite({
            id: `invite-${invite.lobbyId}`,
            title: 'Game Invite',
            message,
            acceptText: isBusy ? 'Queue' : 'Join',
            declineText: 'Decline',
            timeoutMs: 10000,
            lowKey,
            onAccept: () => {
                if (isBusy) {
                    this._enqueueInvite(invite);
                } else {
                    this._joinLobby(invite.lobbyId);
                }
            },
            onDecline: () => {
                this._removePendingInvite(invite.lobbyId);
            },
        });
    }

    _enqueueInvite(invite) {
        if (!invite?.lobbyId) return;
        if (this.pendingInviteIds.has(invite.lobbyId)) return;

        this.pendingInvites.push(invite);
        this.pendingInviteIds.add(invite.lobbyId);

        const mode = this.gameModeManager.getCurrentMode();
        const modeId = mode?.getModeId?.();

        if (this.pendingMatchUnsub) {
            this.pendingMatchUnsub();
            this.pendingMatchUnsub = null;
        }

        if (modeId === GAME_MODES.ONLINE_MULTIPLAYER && mode?.isInMatch) {
            this.pendingMatchUnsub = onMultiplayerEvent(
                MULTIPLAYER_EVENTS.GAME_OVER,
                () => {
                    if (this.pendingMatchUnsub) {
                        this.pendingMatchUnsub();
                        this.pendingMatchUnsub = null;
                    }
                    this._tryJoinPending('matchEnd');
                },
            );
        }
    }

    _removePendingInvite(lobbyId) {
        if (!lobbyId || !this.pendingInviteIds.has(lobbyId)) return;
        this.pendingInviteIds.delete(lobbyId);
        this.pendingInvites = this.pendingInvites.filter((invite) => invite.lobbyId !== lobbyId);
    }

    _dequeueInvite() {
        const invite = this.pendingInvites.shift() || null;
        if (invite?.lobbyId) {
            this.pendingInviteIds.delete(invite.lobbyId);
        }
        return invite;
    }

    _isBusy() {
        const mode = this.gameModeManager.getCurrentMode();
        if (!mode) return false;

        const modeId = mode.getModeId?.();
        if (modeId === GAME_MODES.ONLINE_MULTIPLAYER) {
            return !!mode.isInMatch;
        }

        return !!mode.isRunning;
    }

    async _tryJoinPending(trigger) {
        if (!this.pendingInvites.length) return;
        if (this._isBusy()) return;

        const invite = this._dequeueInvite();
        if (!invite) return;
        await this._joinLobby(invite.lobbyId, trigger);
    }

    async _joinLobby(lobbyId) {
        if (!lobbyId) return;

        try {
            this._removePendingInvite(lobbyId);
            const modeId = this.gameModeManager.getCurrentModeId();
            const currentMode = this.gameModeManager.getCurrentMode();

            if (modeId !== GAME_MODES.ONLINE_MULTIPLAYER) {
                await this.gameModeManager.activateMode(GAME_MODES.ONLINE_MULTIPLAYER);
                await this.gameModeManager.startCurrentMode({ lobbyId, invite: true });
                return;
            }

            if (!currentMode?.isRunning) {
                await this.gameModeManager.startCurrentMode({ lobbyId, invite: true });
                return;
            }

            if (typeof currentMode.joinLobbyFromInvite === 'function') {
                await currentMode.joinLobbyFromInvite(lobbyId);
            }
        } catch (err) {
            console.warn('[SteamInviteManager] Failed to join lobby:', err.message);
        }
    }

    async _resolveFriendName(friendSteamId) {
        if (!friendSteamId) return 'Friend';
        const friends = await steamService.getFriends();
        const match = friends.find((friend) => friend.steamId === friendSteamId);
        return match?.name || 'Friend';
    }

    destroy() {
        this.unsubscribers.forEach((unsub) => unsub());
        this.unsubscribers = [];
        if (this.pendingMatchUnsub) {
            this.pendingMatchUnsub();
            this.pendingMatchUnsub = null;
        }
        if (this._gameEndedHandler) {
            window.removeEventListener('gameEnded', this._gameEndedHandler);
            this._gameEndedHandler = null;
        }
        if (this._returnToMenuHandler) {
            window.removeEventListener('returnToMenu', this._returnToMenuHandler);
            this._returnToMenuHandler = null;
        }
        if (this._modalHiddenHandler) {
            window.removeEventListener('modalHidden', this._modalHiddenHandler);
            this._modalHiddenHandler = null;
        }
        this.pendingInvites = [];
        this.pendingInviteIds.clear();
    }
}

export default { SteamInviteManager };
