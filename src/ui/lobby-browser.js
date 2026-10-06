/**
 * Lobby Browser UI — "Online versus" (Keystone sheet).
 *
 * Displays available multiplayer lobbies and allows players to:
 * - Browse available matches (players as a cell meter, condition and status in words)
 * - Create new matches (the one primary action)
 * - Join, drop into a game under way, or watch
 * - Join a friend's match by its lobby ID
 *
 * Escape, the close tile and Back all return to the main menu. A failed join keeps
 * the browser open with the reason inline (`showError`).
 * Styles: public/styles/keystone-multiplayer.css (#lobby-browser).
 */
import {
    closeLayer, conditionLabel, describeGoal, focusSoon, mpIcon, openLayer,
} from './components/mp-sheet.js';

const MAX_METER_CELLS = 8;

export class LobbyBrowser {
    constructor(steamNetworking, onJoinLobby, onCreateLobby, onCancel = null) {
        this.steam = steamNetworking;
        this.onJoinLobby = onJoinLobby;
        this.onCreateLobby = onCreateLobby;
        this.onCancel = onCancel;

        this.container = null;
        this.refreshInterval = null;
        this.refreshPromise = null;
        this.refreshGeneration = 0;
        this.visibilityGeneration = 0;
        this.isVisible = false;
        this.destroyed = false;
        this.lobbies = [];
        this.joining = false;

        this.createUI();
    }

    /**
   * Create the lobby browser UI
   */
    createUI() {
        this.container = document.createElement('div');
        this.container.id = 'lobby-browser';
        this.container.className = 'lobby-browser sb-mp-screen hidden';

        this.container.innerHTML = `
      <div class="lobby-browser-overlay" aria-hidden="true"></div>
      <div class="sb-mp-sheet lobby-browser-modal" role="dialog" aria-modal="true"
           aria-labelledby="lobby-browser-title" aria-describedby="lobby-browser-lede">
        <div class="sb-mp-sheet__panel">
          <header class="lobby-browser-header sb-mp-sheet__header">
            <div class="sb-mp-sheet__heading">
              <p class="sb-eyebrow">Stack · Online versus</p>
              <h2 class="sb-mp-sheet__title" id="lobby-browser-title">Online versus</h2>
              <p class="sb-mp-sheet__lede" id="lobby-browser-lede">Join an open match, drop into one under way, or create your own.</p>
            </div>
            <button type="button" class="sb-mp-close" id="close-lobby-browser" aria-label="Close and return to the menu">${mpIcon('close', 20)}</button>
          </header>

          <div class="lobby-browser-controls sb-mp-toolbar">
            <form class="lobby-join-by-id" id="join-by-id-form" novalidate>
              <label class="sb-mp-field__label" for="join-by-id-input">Join by lobby ID</label>
              <div class="lobby-join-by-id__row">
                <input type="text" id="join-by-id-input" class="sb-mp-input"
                  placeholder="Paste a friend's lobby ID"
                  maxlength="32" inputmode="numeric" autocomplete="off" spellcheck="false"
                  aria-describedby="join-by-id-hint join-by-id-error" />
                <button type="submit" class="sb-btn lobby-join-by-id__btn" id="join-by-id-btn">${mpIcon('join', 16)}<span>Join</span></button>
              </div>
              <p class="join-by-id-hint sb-mp-help" id="join-by-id-hint">The host sees the ID in their waiting room. Steam invites and Join game work too.</p>
              <p class="join-by-id-error sb-mp-alert" id="join-by-id-error" role="alert" hidden></p>
            </form>
            <button type="button" class="sb-btn sb-btn--quiet lobby-refresh" id="refresh-lobbies-btn">${mpIcon('refresh', 16)}<span>Refresh</span></button>
          </div>

          <div class="lobby-list-container sb-mp-sheet__body">
            <div class="lobby-list-header" aria-hidden="true">
              <span class="col-name">Match</span>
              <span class="col-players">Players</span>
              <span class="col-condition">Win condition</span>
              <span class="col-status">Status</span>
              <span class="col-action"></span>
            </div>
            <div class="lobby-list" id="lobby-list" role="list" aria-label="Open matches">
              ${this.emptyStateHtml()}
            </div>
          </div>

          <footer class="lobby-browser-footer sb-mp-sheet__footer">
            <ul class="sb-hints sb-mp-sheet__hints" aria-hidden="true">
              <li><kbd class="sb-kbd" data-key>Esc</kbd><kbd class="sb-kbd" data-pad>B</kbd>Back</li>
              <li><kbd class="sb-kbd" data-key>Tab</kbd>Move</li>
            </ul>
            <p class="lobby-count sb-mp-count" aria-live="polite"><span id="lobby-count">0</span> <span class="lobby-count__label">matches listed</span></p>
            <div class="sb-mp-sheet__actions">
              <button type="button" class="sb-btn sb-btn--quiet" id="lobby-browser-back">Back</button>
              <button type="button" class="sb-btn sb-btn--primary" id="create-match-btn">${mpIcon('plus', 16)}<span>Create match</span></button>
            </div>
          </footer>
        </div>
        <span class="sb-mp-sheet__key" aria-hidden="true"></span>
      </div>
    `;

        // Add to DOM
        document.body.appendChild(this.container);

        // Setup event listeners
        this.setupEventListeners();
    }

    emptyStateHtml() {
        return `
        <div class="lobby-list-empty" role="listitem">
          <span class="lobby-list-empty__icon" aria-hidden="true">${mpIcon('search', 26)}</span>
          <p class="lobby-list-empty__title">No open matches right now</p>
          <p class="text-muted">Create one, or join a friend with their lobby ID.</p>
        </div>`;
    }

    /**
   * Setup event listeners
   */
    setupEventListeners() {
        this.container.querySelector('#close-lobby-browser').addEventListener('click', () => this.cancel());
        this.container.querySelector('#lobby-browser-back')?.addEventListener('click', () => this.cancel());
        this.container.querySelector('.lobby-browser-overlay').addEventListener('click', () => this.cancel());
        this.container.querySelector('#create-match-btn').addEventListener('click', () => this.showCreateMatchModal());
        this.container.querySelector('#refresh-lobbies-btn').addEventListener('click', () => this.refresh());

        // Join-by-ID (room code) — the reliable cross-machine path that does not
        // depend on the public lobby list (which Steam region-filters and caps).
        const joinIdForm = this.container.querySelector('#join-by-id-form');
        const joinIdInput = this.container.querySelector('#join-by-id-input');
        joinIdForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.joinById();
        });
        if (joinIdInput) {
            joinIdInput.addEventListener('keydown', (e) => {
                // Keep keystrokes out of the global game hotkey handlers (Escape still
                // reaches the browser's back handler, which runs first).
                e.stopPropagation();
            });
            joinIdInput.addEventListener('input', () => this.clearJoinError());
        }

        // One delegated handler for every row action (rows re-render).
        this.container.querySelector('#lobby-list')?.addEventListener('click', (e) => {
            const button = e.target.closest?.('button[data-lobby-id]');
            if (!button || button.disabled) return;
            const { lobbyId } = button.dataset;
            this.joinLobby(lobbyId, { asSpectator: button.classList.contains('btn-watch') });
        });
    }

    /**
   * Join a lobby from the pasted Lobby ID (room code). Steam lobby IDs are
   * numeric, so we strip everything else to tolerate stray spaces/quotes.
   */
    joinById() {
        const input = this.container.querySelector('#join-by-id-input');
        const raw = (input?.value || '').trim();
        const id = raw.replace(/\D/g, '');

        if (!id) {
            this.showJoinError('Enter a lobby ID — it is a number.');
            input?.focus();
            return;
        }

        this.clearJoinError();
        // Reuse the same join path as the lobby list.
        this.joinLobby(id);
    }

    showJoinError(message) {
        const el = this.container?.querySelector('#join-by-id-error');
        if (!el) return;
        el.textContent = message;
        el.hidden = false;
        this.container.querySelector('#join-by-id-input')?.setAttribute?.('aria-invalid', 'true');
    }

    clearJoinError() {
        const el = this.container?.querySelector('#join-by-id-error');
        if (!el || el.hidden !== false) return; // nothing showing
        el.hidden = true;
        el.textContent = '';
        this.container.querySelector('#join-by-id-input')?.removeAttribute?.('aria-invalid');
    }

    /** A join or watch that failed: the browser stays open and says why. */
    showError(message) {
        this.showJoinError(message);
    }

    /**
   * Show the lobby browser
   */
    async show() {
        if (this.destroyed) return;
        if (this.isVisible) {
            await this.refresh();
            return;
        }
        this.isVisible = true;
        this.visibilityGeneration += 1;
        const generation = this.visibilityGeneration;
        this.container.classList.remove('hidden');
        this.clearJoinError();
        openLayer(this.container, () => this.cancel());
        focusSoon(() => this.container?.querySelector('#create-match-btn'));
        await this.refresh();
        // A closed/replaced browser must not acquire a timer after Steam replies.
        if (!this.isVisible || this.destroyed || generation !== this.visibilityGeneration) return;

        // Auto-refresh every 5 seconds. Clear any prior handle first so a second
        // show() (e.g. the ?localMp=browse cold start, where mode-activate already
        // showed the browser) doesn't orphan the previous interval.
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        this.refreshInterval = setInterval(() => this.refresh(), 5000);
    }

    /**
   * Hide the lobby browser
   */
    hide() {
        this.isVisible = false;
        this.visibilityGeneration += 1;
        this.container?.classList.add('hidden');
        if (this.container) closeLayer(this.container);

        // Stop auto-refresh
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    /**
   * Cancel the lobby browser (hide and trigger cancel callback)
   */
    async cancel() {
        this.hide();

        if (this.onCancel) {
            console.log('[LobbyBrowser] Triggering cancel callback');
            await this.onCancel();
            console.log('[LobbyBrowser] Cancel callback completed');
        }
    }

    /**
   * Refresh lobby list
   */
    refresh() {
        if (this.destroyed) return Promise.resolve();
        const generation = this.visibilityGeneration;
        if (this.refreshPromise) {
            if (this.refreshGeneration === generation) return this.refreshPromise;
            // Reopening waits for the retired request before fetching fresh data;
            // repeated refresh clicks never overlap Steam requests.
            return this.refreshPromise.then(() => {
                if (!this.destroyed && generation === this.visibilityGeneration) return this.refresh();
                return undefined;
            });
        }
        this.refreshGeneration = generation;
        this.refreshPromise = Promise.resolve()
            .then(() => this.steam.getLobbies())
            .then((lobbies) => {
                if (this.destroyed || generation !== this.visibilityGeneration) return;
                this.lobbies = lobbies;
                this.renderLobbies();
                const countEl = this.container.querySelector('#lobby-count');
                const count = String(this.lobbies.length);
                if (countEl.textContent !== count) countEl.textContent = count;
                const labelEl = this.container.querySelector('.lobby-count__label');
                const label = this.lobbies.length === 1 ? 'match listed' : 'matches listed';
                if (labelEl && labelEl.textContent !== label) labelEl.textContent = label;
            })
            .catch((err) => console.error('Failed to refresh lobbies:', err))
            .finally(() => { this.refreshPromise = null; });
        return this.refreshPromise;
    }

    /**
   * Render lobby list
   */
    renderLobbies() {
        const listEl = this.container.querySelector('#lobby-list');
        const signature = JSON.stringify(this.lobbies.map((lobby) => [
            lobby.id, lobby.name, lobby.hostName, this.getMaxPlayers(lobby),
            this.getPlayerCount(lobby), this.getLobbyStatus(lobby), lobby.endCondition || 'frags',
            lobby.endConditionValue ?? null,
        ]));
        if (signature === this.lastLobbyRenderSignature) return;
        this.lastLobbyRenderSignature = signature;

        if (this.lobbies.length === 0) {
            listEl.innerHTML = this.emptyStateHtml();
            return;
        }

        listEl.innerHTML = this.lobbies.map((lobby) => this.lobbyRowHtml(lobby)).join('');
    }

    lobbyRowHtml(lobby) {
        const max = this.getMaxPlayers(lobby);
        const current = this.getPlayerCount(lobby);
        const status = this.getLobbyStatus(lobby);
        const condition = lobby.endCondition || 'frags';
        const joinable = this.canJoinLobby(lobby);
        // An IN-PROGRESS game with a free slot can be DROPPED INTO: you join as a waiting
        // player and spawn at the next round (same shared seed). Reuses the .btn-join path.
        const canDropIn = status === 'playing' && current < max;
        const id = this.escapeHtml(lobby.id);
        const name = this.escapeHtml(lobby.name || 'Unnamed match');
        let actionBtn;
        if (joinable) {
            actionBtn = `<button type="button" class="sb-btn lobby-action btn-join" data-lobby-id="${id}" aria-label="Join ${name}">${mpIcon('join', 16)}<span>Join</span></button>`;
        } else if (canDropIn) {
            actionBtn = `<button type="button" class="sb-btn lobby-action btn-join btn-dropin" data-lobby-id="${id}" aria-label="Drop in to ${name} — you play from the next round">${mpIcon('dropin', 16)}<span>Drop in</span></button>`;
        } else {
            const disabledLabel = status === 'finished' ? 'Finished' : 'Full';
            actionBtn = `<button type="button" class="sb-btn lobby-action btn-disabled" disabled>${disabledLabel}</button>`;
        }

        const cells = Math.min(max, MAX_METER_CELLS);
        const filled = Math.round((Math.min(current, max) / max) * cells);
        const meter = Array.from({ length: cells }, (_, i) => (i < filled ? '<i class="is-filled"></i>' : '<i></i>')).join('');
        const goal = lobby.endConditionValue ? describeGoal(condition, lobby.endConditionValue) : conditionLabel(condition);

        return `
      <div class="lobby-item status-${this.escapeHtml(status)}" data-lobby-id="${id}" role="listitem">
        <span class="col-name">
          <strong>${name}</strong>
          ${lobby.hostName ? `<span class="lobby-host">Hosted by ${this.escapeHtml(lobby.hostName)}</span>` : ''}
        </span>
        <span class="col-players">
          <span class="sb-meter lobby-capacity" role="img" aria-label="${current} of ${max} players">${meter}</span>
          <span class="player-count">${current}/${max}</span>
        </span>
        <span class="col-condition">${this.escapeHtml(goal)}</span>
        <span class="col-status">
          <span class="sb-chip status-badge status-${this.escapeHtml(status)}">${this.getStatusText(status)}</span>
        </span>
        <span class="col-action">
          ${actionBtn}
          <button type="button" class="sb-btn sb-btn--quiet lobby-action btn-watch" data-lobby-id="${id}" aria-label="Watch ${name}">${mpIcon('watch', 16)}<span>Watch</span></button>
        </span>
      </div>
    `;
    }

    /**
   * Resolve the current player count from whichever field the source provides.
   * Mock lobbies expose `players`; live game state uses `playerCount`.
   */
    getPlayerCount(lobby) {
        // Steam's counts are BigInt (steamworks.js); the list does arithmetic and JSON on them.
        return Number(lobby.players ?? lobby.playerCount ?? lobby.currentPlayers ?? 0) || 0;
    }

    /** A lobby's seats (Steam's limit is a BigInt, or null for none). */
    getMaxPlayers(lobby) {
        return Number(lobby.maxPlayers) || 8;
    }

    /**
   * Resolve a lobby's status, deriving it from capacity when not supplied.
   */
    getLobbyStatus(lobby) {
        if (lobby.status) return lobby.status;
        const max = this.getMaxPlayers(lobby);
        return this.getPlayerCount(lobby) >= max ? 'full' : 'open';
    }

    /**
   * Check if player can join lobby
   */
    canJoinLobby(lobby) {
        const status = this.getLobbyStatus(lobby);
        if (status === 'playing' || status === 'finished') return false;
        if (this.getPlayerCount(lobby) >= this.getMaxPlayers(lobby)) return false;
        return true;
    }

    /**
   * Get status text
   */
    getStatusText(status) {
        const statusMap = {
            open: 'Open',
            waiting: 'Open',
            full: 'Full',
            playing: 'In progress',
            finished: 'Finished',
        };
        return statusMap[status] || 'Open';
    }

    /**
   * Join a lobby. When the join fails the browser stays open with the reason inline.
   */
    async joinLobby(lobbyId, options = {}) {
        if (this.joining) return;
        this.joining = true;
        const asSpectator = !!options.asSpectator;
        this.clearJoinError();
        try {
            console.log(`🚀 ${asSpectator ? 'Watching' : 'Joining'} lobby: ${lobbyId}`);

            if (this.onJoinLobby) await this.onJoinLobby(lobbyId, { asSpectator });
            // The mode hides the browser to join; when a join fails it shows the browser
            // again with the reason (showError) — then the browser must stay.
            if (this.isVisible) return;

            this.hide();
        } catch (err) {
            console.error('Failed to join lobby:', err);
            if (!this.destroyed && !this.isVisible) await this.show();
            this.showError(`Could not ${asSpectator ? 'watch' : 'join'} that match. ${err?.message || ''}`.trim());
        } finally {
            this.joining = false;
        }
    }

    /**
   * Show create match modal
   */
    showCreateMatchModal() {
        // The create sheet replaces the browser; its Back returns here.
        this.hide();

        // Show match config modal
        if (this.onCreateLobby) {
            this.onCreateLobby();
        }
    }

    /**
   * Escape HTML to prevent XSS
   */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
   * Destroy the lobby browser
   */
    destroy() {
        this.hide();
        this.destroyed = true;
        this.container?.remove();
        this.container = null;
    }
}
