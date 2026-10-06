/**
 * Lobby Waiting Room
 *
 * Players wait here after joining a lobby before the match starts. Three columns:
 * the lobby (goal, settings, lobby ID, invites), the players (one card each with
 * their hue and host / you / ready state, and the one primary action — Start match
 * for the host, Ready for everyone else) and the room (activity and chat).
 * Leaving asks first, in-app. Escape leaves a text field first, then asks to leave.
 * Styles: public/styles/keystone-multiplayer.css (#lobby-waiting-room).
 */

import { onMultiplayerEvent, MULTIPLAYER_EVENTS } from '../events/multiplayer-events.js';
import { createPlayerCard } from './components/player-card.js';
import steamService from '../core/steam/steam-service.js';
import { MessageTypes } from '../core/network/message-types.js';
import { escapeHtml, sanitizeCssColor } from '../utils/dom-safety.js';
import {
    closeLayer, conditionLabel, confirmSheet, describeGoal, mpIcon, openLayer,
} from './components/mp-sheet.js';

const WELCOME = 'Welcome to the lobby.';

export class LobbyWaitingRoom {
    constructor(ffaGameState, onMatchStart, onLeaveLobby = null) {
        this.gameState = ffaGameState;
        this.onMatchStart = onMatchStart;
        this.onLeaveLobby = onLeaveLobby;
        this.container = null;
        this.updateInterval = null;
        this.initialUpdateTimeout = null;
        this.isVisible = false;
        this.leaving = false;

        this.createUI();
    }

    /** Element by id inside the room (never another surface's duplicate id). */
    $(id) {
        return this.container?.querySelector?.(`#${id}`) || null;
    }

    /**
 * Create the waiting room UI
 */
    createUI() {
        this.container = document.createElement('div');
        this.container.id = 'lobby-waiting-room';
        // Use the same grid layout class as the game
        this.container.className = 'online-game-area lobby-mode hidden';
        this.container.setAttribute('role', 'region');
        this.container.setAttribute('aria-labelledby', 'room-name');

        this.container.innerHTML = `
      <!-- LEFT PANEL: Lobby Info & Settings -->
      <div class="opponents-panel lobby-left-panel wr-panel">
        <div class="watch-controls wr-head">
            <div class="watch-controls-row wr-head__row">
                <p class="sb-eyebrow">Online lobby</p>
                <button type="button" class="sb-btn sb-btn--quiet wr-leave" id="leave-lobby-btn">${mpIcon('leave', 16)}<span>Leave</span></button>
            </div>
            <div class="lobby-header-info">
                <h2 id="room-name" class="wr-title">Connecting…</h2>
            </div>
        </div>

        <div class="match-info-panel wr-scroll">
            <p class="lobby-objective sb-mp-note" id="lobby-objective"></p>
            <h3 class="sb-mp-label">Match</h3>
            <dl class="match-info-grid wr-facts">
              <div class="info-item">
                <dt class="info-label">Players</dt>
                <dd class="info-value" id="max-players-value">–</dd>
              </div>
              <div class="info-item">
                <dt class="info-label">Win condition</dt>
                <dd class="info-value" id="win-condition-value">–</dd>
              </div>
              <div class="info-item">
                <dt class="info-label">Target</dt>
                <dd class="info-value" id="win-target-value">–</dd>
              </div>
              <div class="info-item">
                <dt class="info-label">Host</dt>
                <dd class="info-value" id="host-name-value">–</dd>
              </div>
            </dl>
        </div>

        <div class="lobby-controls wr-invite">
             <div class="room-code-display">
                <div class="room-code-label" id="lobby-id-label">Lobby ID</div>
                <div class="room-code-row">
                   <span class="room-code-value" id="lobby-id-display" aria-labelledby="lobby-id-label">Connecting…</span>
                   <button type="button" class="lobby-copy-btn" id="copy-lobby-id" aria-label="Copy lobby ID">${mpIcon('copy', 16)}</button>
                </div>
                <p class="room-code-hint">Share it so friends can join.</p>
             </div>
             <button type="button" class="sb-btn wr-invite__btn" id="invite-friends-btn">${mpIcon('invite', 16)}<span>Invite friends</span></button>
        </div>
      </div>

      <!-- CENTER PANEL: Player Grid -->
      <div class="main-board-panel lobby-center-panel wr-players">
        <div class="lobby-center-header">
             <h3 class="wr-players__title">Players <span class="player-count-badge" id="player-count-badge"><span id="player-count">0</span>/<span id="max-players-count">8</span></span></h3>
             <div class="ready-legend" aria-hidden="true">
                <span class="ready-indicator ready"></span>Ready
                <span class="ready-indicator not-ready"></span>Not ready
             </div>
        </div>

        <div class="lobby-ready-progress">
             <div class="sb-meter lobby-ready-meter" id="ready-progress-fill" role="img" aria-label="No players yet"></div>
             <span class="ready-progress-label" id="ready-progress-label">0 of 0 ready</span>
        </div>

        <div class="lobby-player-grid" id="player-list" role="list" aria-label="Players in this lobby"></div>

        <div class="lobby-center-footer">
             <p class="waiting-indicator" id="waiting-text" aria-live="polite">Waiting for players…</p>
             <div class="lobby-action-buttons">
                <button type="button" class="sb-btn sb-btn--primary btn-ready" id="ready-btn" aria-pressed="false" hidden>Ready</button>
                <button type="button" class="sb-btn sb-btn--primary btn-start" id="start-match-btn" hidden disabled>Start match</button>
             </div>
        </div>
      </div>

      <!-- RIGHT PANEL: Activity & Chat -->
      <div class="right-panel wr-room">
          <section class="online-kill-feed wr-panel" id="lobby-activity-log" aria-labelledby="lobby-activity-title">
             <h3 class="kill-feed-header sb-mp-label" id="lobby-activity-title">Activity</h3>
             <div class="kill-feed-list" id="activity-log-list" role="log" aria-live="polite"></div>
          </section>

          <section class="online-chat wr-panel" aria-labelledby="lobby-chat-title">
            <h3 class="sb-mp-label wr-chat__title" id="lobby-chat-title">Chat</h3>
            <div class="chat-messages" id="lobby-chat-messages" role="log" aria-live="polite">
              <div class="system-message">${WELCOME}</div>
            </div>
            <form class="chat-input-row" id="lobby-chat-form" novalidate>
                <input type="text" id="lobby-chat-input" class="sb-mp-input" placeholder="Say something" maxlength="100" autocomplete="off" aria-label="Chat message">
                <button type="submit" class="sb-btn wr-send" id="lobby-chat-send" aria-label="Send message">${mpIcon('send', 16)}</button>
            </form>
          </section>
      </div>
    `;

        document.body.appendChild(this.container);

        this.setupEventListeners();
    }

    /**
 * Setup event listeners
 */
    setupEventListeners() {
    // Leave button
        const leaveBtn = this.container.querySelector('#leave-lobby-btn');
        leaveBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent global click handler from triggering
            this.leaveLobby();
        });

        // Ready button
        const readyBtn = this.container.querySelector('#ready-btn');
        readyBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent global click handler from triggering
            this.toggleReady();
        });

        // Copy Lobby ID
        const copyBtn = this.container.querySelector('#copy-lobby-id');
        if (copyBtn) {
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = this.container.querySelector('#lobby-id-display')?.textContent || '';
                if (!id || id === 'Connecting…') return;
                const done = () => {
                    copyBtn.classList.add('copied');
                    copyBtn.setAttribute('aria-label', 'Lobby ID copied');
                    copyBtn.innerHTML = mpIcon('check', 16);
                    setTimeout(() => {
                        copyBtn.classList.remove('copied');
                        copyBtn.setAttribute('aria-label', 'Copy lobby ID');
                        copyBtn.innerHTML = mpIcon('copy', 16);
                    }, 1400);
                };
                if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(id).then(done).catch(() => {});
                } else {
                    done();
                }
            });
        }

        // Start button
        const startBtn = this.container.querySelector('#start-match-btn');
        startBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent global click handler from triggering single-player start
            this.startMatch();
        });

        // Invite friends button
        const inviteBtn = this.container.querySelector('#invite-friends-btn');
        if (inviteBtn) {
            inviteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();

                // Check if Steam is available
                if (!steamService.isOnline) {
                    this.addChatMessage('Invites need Steam, which is not running.', true);
                    return;
                }

                const lobbyId = this.gameState?.network?.currentLobbyId || null;
                if (!lobbyId) {
                    this.addChatMessage('There is no lobby to invite to yet.', true);
                    return;
                }

                const opened = await steamService.openLobbyInviteDialog(lobbyId);
                if (!opened) {
                    console.warn('[LobbyWaitingRoom] Unable to open Steam invite dialog');
                    this.addChatMessage('The Steam invite window did not open. Try Shift+Tab for the Steam overlay.', true);
                }
            });
        }

        // Chat integration
        // Listen for incoming messages
        this.chatHandler = (detail) => {
            this.addChatMessage({
                playerName: detail.playerName,
                message: detail.message,
                steamId: detail.steamId,
                color: detail.color,
            });
        };
        onMultiplayerEvent(MULTIPLAYER_EVENTS.CHAT_MESSAGE, this.chatHandler);

        // Chat input
        const chatInput = this.container.querySelector('#lobby-chat-input');
        const chatForm = this.container.querySelector('#lobby-chat-form');

        const sendChat = () => {
            const text = chatInput.value.trim();
            if (text && this.gameState) {
                const localPlayer = this.gameState.getLocalPlayer?.() || this.gameState.players?.get(this.gameState.localPlayerId);
                const playerColor = localPlayer?.color || '#a78bfa';
                const msgData = {
                    message: text,
                    playerName: this.gameState.network.playerName,
                    steamId: this.gameState.localPlayerId,
                    color: playerColor,
                    timestamp: Date.now(),
                };
                if (this.gameState.network.isHost) {
                    this.gameState.network.broadcastToAll(MessageTypes.GAME_CHAT, msgData);
                } else if (this.gameState.network.hostSteamId) {
                    this.gameState.network.sendP2PMessage(
                        this.gameState.network.hostSteamId,
                        MessageTypes.GAME_CHAT,
                        msgData,
                    );
                }

                // Add to local history/UI
                if (this.gameState.chatHistory) this.gameState.chatHistory.push(msgData);
                this.addChatMessage({ ...msgData, playerName: 'You' });
                chatInput.value = '';
            }
        };

        chatForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            e.stopPropagation();
            sendChat();
        });
        // Keys typed here are chat, not gameplay (Escape is handled by the room first).
        if (chatInput) chatInput.addEventListener('keydown', (e) => e.stopPropagation());
    }

    /**
 * Show the waiting room
 */
    show() {
        if (!this.container) {
            console.error('❌ Waiting room container not created');
            return;
        }
        if (this.isVisible) return;
        this.isVisible = true;
        this.leaving = false;

        if (!this.gameState) {
            console.warn('⚠️ No game state set for waiting room');
        }

        console.log('📋 Showing waiting room...');
        this.container.classList.remove('hidden');
        openLayer(this.container, () => this.leaveLobby(), { fieldsFirst: true });

        // Update UI after a brief delay to ensure DOM is ready
        this.initialUpdateTimeout = setTimeout(() => {
            this.initialUpdateTimeout = null;
            if (!this.isVisible || !this.container) return;
            this.updateUI();

            // Load chat history (re-render so a reopened room never duplicates it).
            const chatEl = this.container.querySelector('#lobby-chat-messages');
            if (chatEl && this.gameState && this.gameState.chatHistory) {
                chatEl.innerHTML = `<div class="system-message">${WELCOME}</div>`;

                this.gameState.chatHistory.forEach((msg) => {
                    if (!msg.playerName) {
                        // System message
                        this.addChatMessage(msg.text || msg.message, true);
                    } else {
                        // Player message - pass full object for color support
                        this.addChatMessage(msg);
                    }
                });
            }

            // Initial focus: the one primary action for this player.
            const primary = [this.$('start-match-btn'), this.$('ready-btn')]
                .find((button) => button && !button.hidden);
            if (primary && !this.container.contains(document.activeElement)) primary.focus({ preventScroll: true });
        }, 50);

        // Update every second
        this.updateInterval = setInterval(() => this.updateUI(), 1000);

        // Listen for player list changes and update immediately
        this.playerListChangeHandler = () => {
            console.log('🔄 Player list changed, updating UI...');
            this._logRosterChanges();
            this.updateUI();
        };
        this.playerListChangeUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.PLAYER_LIST_CHANGED,
            this.playerListChangeHandler,
        );

        console.log('✅ Waiting room visible');
    }

    /**
 * Hide the waiting room
 */
    hide() {
        this.isVisible = false;
        this.container?.classList.add('hidden');
        if (this.container) closeLayer(this.container);

        if (this.initialUpdateTimeout) {
            clearTimeout(this.initialUpdateTimeout);
            this.initialUpdateTimeout = null;
        }

        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        // Remove event listener
        if (this.playerListChangeUnsub) {
            this.playerListChangeUnsub();
            this.playerListChangeUnsub = null;
            this.playerListChangeHandler = null;
        }
    }

    /**
 * Update UI with current game state
 */
    updateUI() {
        if (!this.gameState) {
            console.warn('⚠️ updateUI called but no gameState');
            return;
        }

        try {
            // Update match info
            this.updateMatchInfo();

            // Update player list
            this.updatePlayerList();

            // Update controls
            this.updateControls();
        } catch (err) {
            console.error('❌ Error updating waiting room UI:', err);
        }
    }

    /** Write text only when it changed (the room refreshes every second). */
    setText(id, text) {
        const el = this.$(id);
        const value = String(text ?? '');
        if (el && el.textContent !== value) el.textContent = value;
        return el;
    }

    /**
 * Update match info panel
 */
    updateMatchInfo() {
        const config = this.gameState.matchConfig;

        // Max players
        this.setText('max-players-value', `Up to ${config.maxPlayers}`);
        this.setText('max-players-count', config.maxPlayers);

        // Win condition
        this.setText('win-condition-value', this.getConditionText(config.endCondition));

        // Room Name & ID
        if (this.gameState.lobbyName) this.setText('room-name', this.gameState.lobbyName);
        if (this.gameState.lobbyId) this.setText('lobby-id-display', this.gameState.lobbyId);

        // Target value
        let targetText = config.endConditionValue;
        if (config.endCondition === 'points') {
            targetText = `${config.endConditionValue * 1000} points`;
        } else if (config.endCondition === 'time') {
            targetText = `${config.endConditionValue} min`;
        } else if (config.endCondition === 'never') {
            targetText = 'None';
        } else if (config.endCondition === 'frags' || config.endCondition === 'lines') {
            targetText = `${config.endConditionValue} ${config.endCondition}`;
        }
        this.setText('win-target-value', targetText);

        // Objective summary callout
        this.setText('lobby-objective', config.endCondition === 'never'
            ? 'Endless — the host ends the match'
            : describeGoal(config.endCondition, config.endConditionValue));

        // Host name
        const hostPlayer = Array.from(this.gameState.players.values())
            .find((p) => p.steamId === this.gameState.network.hostSteamId);
        this.setText('host-name-value', hostPlayer ? hostPlayer.name : 'Unknown');
    }

    /**
 * Get condition text
 */
    getConditionText(condition) {
        return conditionLabel(condition);
    }

    /**
 * Update player list
 */
    updatePlayerList() {
        const listEl = this.$('player-list');
        if (!listEl) return;
        const players = Array.from(this.gameState.players.values());

        // Dirty-check: updateUI() calls this every 1000ms AND it fires on every
        // PLAYER_LIST_CHANGED. Without this it re-logged per-player, re-batched avatars,
        // and rebuilt innerHTML once a second even when nothing changed — the console
        // "📊 [LOBBY] Updating player list" flood. Skip all of it when the roster is
        // visually identical (covers name/ready/color/host/local/count changes).
        const hostId = this.gameState.network?.hostSteamId;
        const localId = this.gameState.localPlayerId;
        const roster = players
            .map((p) => `${p.steamId}:${p.name}:${p.isReady ? 1 : 0}:${p.color}:${p.steamId === hostId ? 1 : 0}`)
            .sort()
            .join('|');
        const sig = `${players.length}@${localId || ''}@${this.gameState.matchConfig?.maxPlayers || ''}|${roster}`;
        if (sig === this._lastPlayerListSig) return;
        this._lastPlayerListSig = sig;

        console.log(`📊 [LOBBY] Updating player list: ${players.length} players`);

        // Update count
        this.setText('player-count', players.length);

        // Batch preload all avatars in parallel for faster rendering
        const steamIds = players.map((p) => p.steamId).filter(Boolean);
        steamService.getAvatarsBatch(steamIds, 'medium').catch((err) => {
            console.warn('[LobbyWaitingRoom] Failed to preload avatars:', err.message);
        });

        // Clear and rebuild player cards with real avatars (keep focus on a kick
        // button that survives the rebuild).
        const focusedKick = listEl.contains(document.activeElement)
            ? document.activeElement.dataset.steamId : null;
        listEl.innerHTML = '';

        players.forEach((player) => {
            const isHost = player.steamId === this.gameState.network.hostSteamId;
            const isLocal = player.steamId === this.gameState.localPlayerId;
            const isReady = player.isReady || isHost;
            const playerColor = sanitizeCssColor(player.color, '#808080');

            const cardEl = document.createElement('div');
            cardEl.className = `lobby-player-card ${isReady ? 'ready' : 'not-ready'} ${isLocal ? 'local' : ''} ${isHost ? 'host' : ''}`.trim();
            cardEl.style.setProperty('--player-color', playerColor);
            cardEl.setAttribute('role', 'listitem');

            // Player hue along the top edge
            const colorStrip = document.createElement('div');
            colorStrip.className = 'player-color-strip';
            colorStrip.setAttribute('aria-hidden', 'true');
            cardEl.appendChild(colorStrip);

            // Avatar + name, with a non-empty fallback so a card is never nameless.
            const displayName = player.name || (isLocal ? 'You' : 'Player');
            const playerCard = createPlayerCard({
                steamId: player.steamId,
                name: displayName,
                color: playerColor,
                size: 'medium',
                showName: true,
                vertical: true,
            });
            if (playerCard) cardEl.appendChild(playerCard);

            // Role: host / you / player
            const statusEl = document.createElement('div');
            statusEl.className = 'player-status';
            const roles = [isHost ? 'Host' : '', isLocal ? 'You' : ''].filter(Boolean);
            statusEl.innerHTML = `${isHost ? mpIcon('crown', 13) : ''}<span>${roles.join(' · ') || 'Player'}</span>`;
            cardEl.appendChild(statusEl);

            // Ready state in words
            const badgeEl = document.createElement('div');
            badgeEl.className = 'player-ready-badge';
            badgeEl.textContent = isReady ? 'Ready' : 'Not ready';
            cardEl.appendChild(badgeEl);

            // Host admin: remove any OTHER player (host-only, never self/host).
            if (this.gameState.isHost && !isHost && !isLocal && this.gameState.kickPlayer) {
                const kickBtn = document.createElement('button');
                kickBtn.type = 'button';
                kickBtn.className = 'player-kick-btn';
                kickBtn.dataset.steamId = player.steamId;
                kickBtn.setAttribute('aria-label', `Remove ${displayName} from the lobby`);
                kickBtn.innerHTML = mpIcon('remove', 16);
                kickBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const confirmed = await confirmSheet({
                        eyebrow: 'Host',
                        title: `Remove ${displayName}?`,
                        message: 'They leave this lobby now.',
                        confirmLabel: 'Remove',
                        cancelLabel: 'Keep',
                    });
                    if (confirmed) this.gameState.kickPlayer(player.steamId);
                });
                cardEl.appendChild(kickBtn);
                if (focusedKick && focusedKick === player.steamId) queueMicrotask(() => kickBtn.focus({ preventScroll: true }));
            }

            listEl.appendChild(cardEl);
        });

        // Empty seats up to max capacity, so the grid always reads as N/max
        const maxPlayers = parseInt(this.gameState.matchConfig?.maxPlayers, 10) || players.length || 8;
        for (let i = players.length; i < maxPlayers; i++) {
            const slot = document.createElement('div');
            slot.className = 'lobby-player-card empty-slot';
            slot.setAttribute('role', 'listitem');
            slot.innerHTML = `<div class="empty-slot-icon" aria-hidden="true">${mpIcon('plus', 18)}</div><div class="empty-slot-label">Open seat</div>`;
            listEl.appendChild(slot);
        }
    }

    /**
 * Update control buttons
 */
    updateControls() {
        const { isHost } = this.gameState;
        const players = Array.from(this.gameState.players.values());
        const hostId = this.gameState.network.hostSteamId;
        const readyFlags = players.map((p) => Boolean(p.isReady || p.steamId === hostId));
        const readyCount = readyFlags.filter(Boolean).length;
        const minPlayers = 2; // Minimum 2 players to start

        // Ready meter: one cell per player, filled when ready (ready first).
        const total = players.length;
        const meter = this.$('ready-progress-fill');
        if (meter) {
            const cells = readyFlags.slice().sort((a, b) => Number(b) - Number(a))
                .map((ready) => (ready ? '<i class="is-filled"></i>' : '<i></i>')).join('');
            if (meter.innerHTML !== cells) meter.innerHTML = cells;
            meter.classList.toggle('all-ready', total > 0 && readyCount === total);
            meter.setAttribute('aria-label', `${readyCount} of ${total} players ready`);
        }
        const watching = this.gameState.getSpectatorCount ? this.gameState.getSpectatorCount() : 0;
        this.setText('ready-progress-label', `${readyCount} of ${total} ready${watching > 0 ? ` · ${watching} watching` : ''}`);

        const readyBtn = this.$('ready-btn');
        const startBtn = this.$('start-match-btn');
        const waitingText = this.$('waiting-text');
        if (!readyBtn || !startBtn || !waitingText) return;

        if (isHost) {
            readyBtn.hidden = true;
            startBtn.hidden = false;

            // Quadra-style: the host can START as soon as there are >=2 players — readiness
            // is a courtesy signal, not a hard gate. One AFK/unready peer no longer blocks the
            // whole lobby; unready peers still receive the seed and start with everyone.
            const notReady = players.length - readyCount;
            startBtn.disabled = players.length < minPlayers;

            if (players.length < minPlayers) {
                const missing = minPlayers - players.length;
                this.setText('waiting-text', `Waiting for ${missing} more ${missing === 1 ? 'player' : 'players'}`);
                waitingText.className = 'waiting-indicator';
            } else if (notReady === 0) {
                this.setText('waiting-text', 'Everyone is ready.');
                waitingText.className = 'waiting-indicator ready';
            } else {
                this.setText('waiting-text', `${notReady} ${notReady === 1 ? 'player is' : 'players are'} not ready — you can start anyway.`);
                waitingText.className = 'waiting-indicator';
            }
        } else {
            readyBtn.hidden = false;
            startBtn.hidden = true;

            const localPlayer = this.gameState.getLocalPlayer();
            const ready = Boolean(localPlayer && localPlayer.isReady);
            if (readyBtn.textContent !== (ready ? 'Not ready' : 'Ready')) readyBtn.textContent = ready ? 'Not ready' : 'Ready';
            readyBtn.setAttribute('aria-pressed', ready ? 'true' : 'false');
            readyBtn.classList.toggle('ready', ready);
            // Ready is the primary action until it is done; then undoing it is quiet.
            readyBtn.classList.toggle('sb-btn--primary', !ready);
            this.setText('waiting-text', ready ? 'You are ready. Waiting for the host to start.' : 'Press Ready when you are set.');
            waitingText.className = `waiting-indicator${ready ? ' ready' : ''}`;
        }
    }

    /**
 * Toggle ready state
 */
    toggleReady() {
        const localPlayer = this.gameState.getLocalPlayer();
        if (!localPlayer) return;

        const newReadyState = !localPlayer.isReady;
        this.gameState.setReady(newReadyState);

        // Add chat message
        this.addChatMessage(`You are ${newReadyState ? 'ready' : 'not ready'}.`);

        // Update UI immediately
        this.updateUI();
        this._logRosterChanges();
    }

    /**
 * Start the match (host only)
 */
    startMatch() {
        if (!this.gameState.isHost) {
            console.warn('Only host can start match');
            return;
        }

        const players = Array.from(this.gameState.players.values());
        const readyCount = players.filter((p) => p.isReady || p.steamId === this.gameState.network.hostSteamId).length;

        if (players.length < 2) {
            // The button is disabled below two players; say why if it is reached anyway.
            this.setText('waiting-text', 'A match needs at least two players.');
            return;
        }

        // No all-ready gate: the host may start with >=2 players even if some haven't readied
        // (Quadra-style drop-in feel). Unready peers still get LOBBY_GAME_START + the seed.
        if (readyCount < players.length) {
            console.log(`🚀 Host starting with ${players.length - readyCount} player(s) not ready`);
        }

        console.log('🚀 Host starting match!');

        // Start the match - this will trigger countdown
        this.gameState.startMatch();

        // Hide waiting room
        this.hide();

    // Note: Don't call onMatchStart callback here!
    // The callback will be triggered by MATCH_STARTED event after countdown completes
    // This ensures host follows the same flow as peers (countdown -> setup UI)
    }

    /**
 * Leave the lobby (asks first, in-app)
 */
    async leaveLobby() {
        if (this.leaving) return;
        this.leaving = true;
        const confirmed = await confirmSheet({
            eyebrow: 'Online versus',
            title: 'Leave this lobby?',
            message: this.gameState?.isHost
                ? 'You are the host. You will return to the match list.'
                : 'You will return to the match list.',
            confirmLabel: 'Leave',
            cancelLabel: 'Stay',
        });
        this.leaving = false;
        if (!confirmed || !this.isVisible) return;

        console.log('👋 Leaving lobby');

        // Cleanup
        if (this.gameState) {
            this.gameState.cleanup();
        }

        // Hide waiting room
        this.hide();

        // Call callback to return to lobby browser
        if (this.onLeaveLobby) {
            this.onLeaveLobby();
        }
    }

    /**
   * Get a player's color from the game state
   * @param {string} steamId - The player's Steam ID
   * @returns {string|null} The player's color hex code or null
   */
    getPlayerColor(steamId) {
        if (!steamId || !this.gameState?.players) return null;
        const player = this.gameState.players.get(steamId);
        return player?.color || null;
    }

    /**
   * Add chat message
   * @param {Object|string} message - Message object with playerName/message/steamId/color, or string for system messages
   * @param {boolean} isSystem - Whether this is a system message (only used for string messages)
   */
    addChatMessage(message, isSystem = true) {
        if (!this.container) return;
        const chatEl = this.container.querySelector('#lobby-chat-messages');
        if (!chatEl) return;

        const msgDiv = document.createElement('div');

        // Handle both object format and string format
        if (typeof message === 'string') {
            // Legacy string format or system message
            const msgClass = isSystem ? 'system-message' : 'player-message';
            msgDiv.className = msgClass;
            msgDiv.textContent = message;
        } else {
            // Object format with player info
            const playerColor = sanitizeCssColor(
                this.getPlayerColor(message.steamId) || message.color,
            );
            msgDiv.className = 'player-message';
            msgDiv.style.setProperty('--player-color', playerColor);
            msgDiv.innerHTML = `
        <span class="color-indicator" aria-hidden="true"></span>
        <span class="author">${escapeHtml(message.playerName)}</span>
        <span class="text">${escapeHtml(message.message ?? message.text ?? '')}</span>
      `;
        }

        chatEl.appendChild(msgDiv);
        chatEl.scrollTop = chatEl.scrollHeight;
    }

    /**
 * Append an entry to the lobby Activity Log.
 */
    addActivityLogEntry(text, type = 'info') {
        if (!this.container) return;
        const listEl = this.container.querySelector('#activity-log-list');
        if (!listEl) return;
        const entry = document.createElement('div');
        entry.className = `activity-log-entry activity-${type}`;
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        entry.innerHTML = `<span class="activity-dot" aria-hidden="true"></span><span class="activity-text">${this.escapeHtml(text)}</span><span class="activity-time">${time}</span>`;
        listEl.appendChild(entry);
        listEl.scrollTop = listEl.scrollHeight;
    }

    /**
 * Diff the roster against the last snapshot and log join / leave / ready changes.
 */
    _logRosterChanges() {
        if (!this.gameState) return;
        const hostId = this.gameState.network?.hostSteamId;
        const next = new Map();
        Array.from(this.gameState.players.values()).forEach((p) => {
            next.set(p.steamId, { name: p.name, ready: !!(p.isReady || p.steamId === hostId) });
        });

        // First sync: seed the snapshot, then log everyone ALREADY present so a client that
        // joins an existing lobby sees the full roster (host + others) instead of an empty
        // Activity Log. This makes the log consistent for EVERYONE — not just whoever was
        // watching from the moment the lobby opened.
        if (!this._activitySnapshot) {
            this._activitySnapshot = next;
            this.addActivityLogEntry('Lobby open — waiting for players', 'info');
            next.forEach((info) => this.addActivityLogEntry(`${info.name} joined`, 'join'));
            return;
        }

        next.forEach((info, id) => {
            const prev = this._activitySnapshot.get(id);
            if (!prev) {
                this.addActivityLogEntry(`${info.name} joined`, 'join');
            } else if (prev.ready !== info.ready) {
                this.addActivityLogEntry(`${info.name} ${info.ready ? 'is ready' : 'is not ready'}`, info.ready ? 'ready' : 'unready');
            }
        });
        this._activitySnapshot.forEach((info, id) => {
            if (!next.has(id)) this.addActivityLogEntry(`${info.name} left`, 'leave');
        });
        this._activitySnapshot = next;
    }

    /**
 * Escape HTML
 */
    escapeHtml(text) {
        return escapeHtml(text);
    }

    /**
 * Destroy the waiting room
 */
    destroy() {
        this.hide();
        this.container?.remove();
        this.container = null;
    }
}
