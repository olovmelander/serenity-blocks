/**
 * MainMenuPlayerCard: the Steam account in the main menu's top-right corner (desktop builds).
 *
 * - The avatar (a rounded tile), the Steam name and one status line: Online, Connecting or
 *   Offline, with friends playing and a "Limited" note when Steam is up but missing APIs.
 * - Click (or Enter/Space) opens the Steam overlay while Steam is online.
 * - It belongs to the menu: shown only while the start modal is, hidden under any sheet
 *   that covers the menu (body.start-modal-covered) and, in the narrow scrolling layout,
 *   once the list scrolls under it.
 * - Its state is read from steamService whenever it is shown, not only from events, so it
 *   can never be left saying "Connecting" after Steam has settled.
 *
 * A browser build has no Steam client at all (no Electron IPC): there is no account to show
 * and nothing to click, so the card is not built. "Player · Offline" with a Retry that can
 * never succeed would only suggest something is broken; the menu says where Steam matters
 * (Online Versus: "Steam required").
 *
 * Styles: public/styles/keystone-menu.css ("Main-menu player card").
 */

import steamService from '../../core/steam/steam-service.js';
import { STEAM_EVENTS } from '../../core/steam/steam-config.js';

const SCROLL_HIDE_PX = 24;

/** True in the desktop app, where the Steam client can be reached over Electron IPC. */
export function hasSteamClient(win = typeof window !== 'undefined' ? window : null) {
    return typeof win?.electronAPI?.invoke === 'function';
}

function connectionState() {
    if (typeof steamService.getConnectionState === 'function') return steamService.getConnectionState();
    return steamService.isOnline ? 'connected' : 'offline';
}

const isOnlineState = (state) => state === 'connected' || state === 'partial';

/**
 * What the card says for a connection state (pure, for the tests).
 * @returns {{ status: string, dot: 'online'|'connecting'|'offline', retry: boolean, title: string }}
 */
export function describeConnection(state, { queuedActions = 0 } = {}) {
    const queueNote = queuedActions > 0 ? ` · ${queuedActions} waiting to sync` : '';
    if (isOnlineState(state)) {
        return {
            status: 'Online', dot: 'online', retry: false, title: '',
        };
    }
    if (state === 'connecting') {
        return {
            status: 'Connecting', dot: 'connecting', retry: false, title: 'Connecting to Steam',
        };
    }
    return {
        status: 'Offline',
        dot: 'offline',
        retry: true,
        title: state === 'no_steam' ? `Steam is not running${queueNote}` : `Steam is offline${queueNote}`,
    };
}

/**
 * MainMenuPlayerCard - Shows Steam user info in main menu
 */
class MainMenuPlayerCard {
    constructor() {
        this.element = null;
        this.avatarContainer = null;
        this.nameElement = null;
        this.statusDot = null;
        this.statusText = null;
        this.friendsBadge = null;
        this.statePill = null;
        this.retryButton = null;
        this.unsubscribers = [];
        this.isVisible = false;
        this.friendsPollInterval = null;
        this.unavailable = false;
        this.avatarFor = null;
    }

    /**
     * Initialize and create the player card
     */
    async initialize() {
        if (this.element || this.unavailable) return;
        if (!hasSteamClient()) {
            this.unavailable = true;
            console.log('[MainMenuPlayerCard] No Steam client in this build; the card stays out');
            return;
        }
        this.createElement();
        this.setupEventListeners();
        // Whatever Steam has settled on so far (it may already be ready, failed or still
        // connecting); the events below keep it current from here.
        await this.refresh();
        this.show();

        console.log('[MainMenuPlayerCard] Initialized');
    }

    /**
     * Create the DOM element
     */
    createElement() {
        this.element = document.createElement('div');
        this.element.className = 'main-menu-player-card';
        this.element.setAttribute('role', 'button');
        this.element.setAttribute('aria-label', 'Steam profile');
        this.element.setAttribute('tabindex', '0');

        this.element.innerHTML = `
            <div class="mmpc-avatar-container" aria-hidden="true">
                <div class="mmpc-avatar-skeleton"></div>
            </div>
            <div class="mmpc-info">
                <div class="mmpc-name"></div>
                <div class="mmpc-status">
                    <span class="mmpc-status-dot" aria-hidden="true"></span>
                    <span class="mmpc-status-text"></span>
                    <span class="mmpc-friends-badge"></span>
                    <span class="mmpc-state-pill"></span>
                    <button type="button" class="mmpc-retry-btn">Retry</button>
                </div>
            </div>
        `;

        this.avatarContainer = this.element.querySelector('.mmpc-avatar-container');
        this.nameElement = this.element.querySelector('.mmpc-name');
        this.statusDot = this.element.querySelector('.mmpc-status-dot');
        this.statusText = this.element.querySelector('.mmpc-status-text');
        this.friendsBadge = this.element.querySelector('.mmpc-friends-badge');
        this.statePill = this.element.querySelector('.mmpc-state-pill');
        this.retryButton = this.element.querySelector('.mmpc-retry-btn');

        // Click handler to open Steam overlay
        this.element.addEventListener('click', () => this.handleClick());
        this.element.addEventListener('keydown', (e) => {
            if (e.target === this.retryButton) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.handleClick();
            }
        });

        if (this.retryButton) {
            this.retryButton.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.setConnectionVisualState('connecting');
                await steamService.retryConnection();
                await this.refresh();
            });
        }

        this.nameElement.textContent = steamService.playerName || 'Player';
        this.setConnectionVisualState(connectionState());
        this.showPlaceholder(steamService.playerName);
        document.body.appendChild(this.element);
    }

    /**
     * Setup Steam event listeners
     */
    setupEventListeners() {
        // Every Steam change re-reads the whole state: one path, whatever the event order.
        const refresh = () => { this.refresh(); };
        [
            STEAM_EVENTS.READY,
            STEAM_EVENTS.CONNECTED,
            STEAM_EVENTS.DISCONNECTED,
            STEAM_EVENTS.RECONNECTED,
            STEAM_EVENTS.INIT_FAILED,
            STEAM_EVENTS.CAPABILITIES_UPDATED,
            STEAM_EVENTS.STATE_CHANGED,
        ].forEach((event) => this.unsubscribers.push(steamService.on(event, refresh)));
        // A settled Steam (ready or not) may surface the card if the menu is up.
        [STEAM_EVENTS.READY, STEAM_EVENTS.INIT_FAILED].forEach((event) => {
            this.unsubscribers.push(steamService.on(event, () => this.show()));
        });

        // Hide as soon as any game mode is selected (immediate; the start-modal
        // observer below is the authoritative source of truth for re-showing).
        this._gameModeHandler = (e) => {
            const { mode } = e.detail || {};
            if (mode) {
                this.hide();
            }
        };
        window.addEventListener('gameModeChanged', this._gameModeHandler);

        // Show again when game stops or returns to menu. show() is guarded by
        // _isMenuVisible(), so this only takes effect once the menu is actually back.
        this._gameStopHandler = () => {
            // Small delay to let the start modal re-appear first.
            setTimeout(() => this.show(), 100);
        };
        window.addEventListener('gameEnded', this._gameStopHandler);
        window.addEventListener('returnToMenu', this._gameStopHandler);

        // The start modal is the single source of truth for card visibility: the card
        // belongs to the main menu. Drive show/hide off its visibility BOTH ways — the
        // missing hide-on-close is why the card leaked into gameplay (game start removes
        // the modal's `visible` class but nothing was hiding the card).
        this._startModalObserver = new MutationObserver((mutations) => {
            if (!mutations.some((m) => m.type === 'attributes' && m.attributeName === 'class')) return;
            if (this._isMenuVisible()) {
                this.show();
            } else {
                this.hide();
            }
        });

        const startModal = document.getElementById('start-modal');
        if (startModal) {
            this._startModalObserver.observe(startModal, { attributes: true, attributeFilter: ['class'] });
            // The narrow layout scrolls the menu under the corner: the card steps aside.
            this._scrollHandler = () => {
                this.element?.classList.toggle('is-scrolled', startModal.scrollTop > SCROLL_HIDE_PX);
            };
            startModal.addEventListener('scroll', this._scrollHandler, { passive: true });
            this._startModal = startModal;
        }
    }

    /** Read name, connection, capabilities and friends from steamService and show them. */
    async refresh() {
        if (!this.element) return;
        const state = connectionState();
        this.nameElement.textContent = steamService.playerName || 'Player';
        this.updateConnectionState();
        if (isOnlineState(state)) {
            const steamId = steamService.steamId || null;
            if (steamId && this.avatarFor !== steamId) {
                this.avatarFor = steamId;
                await this.loadAvatar(steamId, steamService.playerName);
            }
        } else if (this.avatarFor !== 'placeholder') {
            this.avatarFor = 'placeholder';
            this.showPlaceholder(steamService.playerName);
        }
        await this.updateFriendsPlaying();
        this.syncFriendsPlayingPoll();
    }

    /**
     * Update card from Steam data
     */
    async updateFromSteam() {
        this.avatarFor = null;
        await this.refresh();
    }

    /**
     * Update the status line, the "Limited" note and Retry
     */
    async updateConnectionState() {
        if (!this.element || !this.statePill || !this.retryButton) return;

        const state = connectionState();
        const capabilities = steamService.getCapabilities ? steamService.getCapabilities() : {};
        const status = steamService.getStatus ? steamService.getStatus() : {};
        const queuedActions = Number(status?.queuedActions || 0);
        const described = describeConnection(state, { queuedActions });

        this.setConnectionVisualState(state);
        this.statePill.classList.remove('visible', 'partial', 'offline');
        this.retryButton.classList.toggle('visible', described.retry);
        this.statusText.title = described.title;
        this.statePill.title = '';

        if (state === 'partial') {
            this.statePill.textContent = 'Limited';
            this.statePill.classList.add('visible', 'partial');
            const missing = [];
            if (!capabilities.leaderboards) missing.push('leaderboards');
            if (!capabilities.cloud) missing.push('cloud saves');
            if (!capabilities.achievements) missing.push('achievements');
            if (!capabilities.friends) missing.push('friends');
            this.statePill.title = missing.length
                ? `Not available from Steam right now: ${missing.join(', ')}`
                : 'Some Steam features are not available right now';
        }

        const name = steamService.playerName || 'Player';
        this.element.setAttribute('aria-label', isOnlineState(state)
            ? `${name}, Steam online. Opens Steam friends`
            : `${name}, Steam ${described.status.toLowerCase()}`);
        this.element.setAttribute('aria-disabled', String(!isOnlineState(state)));
    }

    /**
     * Update friends playing badge
     */
    async updateFriendsPlaying() {
        const capabilities = steamService.getCapabilities ? steamService.getCapabilities() : {};
        if (!steamService.isOnline || capabilities.friends === false) {
            this.setFriendsPlayingCount(0);
            return;
        }

        try {
            const friends = await steamService.getFriendsPlayingGame();
            this.setFriendsPlayingCount(friends.length);
        } catch (err) {
            this.setFriendsPlayingCount(0);
        }
    }

    /**
     * Set friends playing badge count
     */
    setFriendsPlayingCount(count) {
        if (!this.friendsBadge) return;
        if (!count) {
            this.friendsBadge.classList.remove('visible');
            return;
        }

        this.friendsBadge.textContent = `${count} ${count === 1 ? 'friend' : 'friends'} playing`;
        this.friendsBadge.classList.add('visible');
    }

    /**
     * Start polling friends playing count
     */
    startFriendsPlayingPoll() {
        if (this.friendsPollInterval) {
            clearInterval(this.friendsPollInterval);
        }
        this.friendsPollInterval = setInterval(() => {
            this.updateFriendsPlaying();
        }, 60000);
    }

    shouldPollFriendsPlaying() {
        const capabilities = steamService.getCapabilities ? steamService.getCapabilities() : {};
        return this.isVisible && steamService.isOnline && capabilities.friends !== false;
    }

    syncFriendsPlayingPoll() {
        if (this.shouldPollFriendsPlaying()) {
            if (!this.friendsPollInterval) this.startFriendsPlayingPoll();
            return;
        }

        this.stopFriendsPlayingPoll();
    }

    /**
     * Stop polling friends playing count
     */
    stopFriendsPlayingPoll() {
        if (this.friendsPollInterval) {
            clearInterval(this.friendsPollInterval);
            this.friendsPollInterval = null;
        }
    }

    /**
     * Load avatar from Steam
     */
    async loadAvatar(steamId, playerName) {
        // Show skeleton while loading
        this.avatarContainer.innerHTML = '<div class="mmpc-avatar-skeleton"></div>';

        try {
            const avatarUrl = await steamService.getAvatar(steamId, 'medium');

            if (avatarUrl) {
                const img = document.createElement('img');
                img.className = 'mmpc-avatar-img';
                img.src = avatarUrl;
                img.alt = '';
                img.onerror = () => this.showPlaceholder(playerName);

                this.avatarContainer.innerHTML = '';
                this.avatarContainer.appendChild(img);
            } else {
                this.showPlaceholder(playerName);
            }
        } catch (err) {
            this.showPlaceholder(playerName);
        }
    }

    /**
     * Show letter placeholder for avatar
     */
    showPlaceholder(name) {
        if (!this.avatarContainer) return;
        const letter = (String(name || '').trim() || 'P').charAt(0).toUpperCase();
        const placeholder = document.createElement('div');
        placeholder.className = 'mmpc-avatar-placeholder';
        placeholder.textContent = letter;
        this.avatarContainer.innerHTML = '';
        this.avatarContainer.appendChild(placeholder);
    }

    /**
     * Set online/offline status display
     */
    setOnlineStatus(isOnline) {
        this.setConnectionVisualState(isOnline ? 'connected' : 'offline');
    }

    setConnectionVisualState(state) {
        if (!this.statusDot || !this.statusText) return;
        const { status, dot } = describeConnection(state || 'offline');
        this.statusDot.classList.toggle('online', dot === 'online');
        this.statusDot.classList.toggle('connecting', dot === 'connecting');
        this.statusDot.classList.toggle('offline', dot === 'offline');
        this.statusText.textContent = status;
        if (this.element) this.element.dataset.state = state || 'offline';
    }

    /**
     * Set offline mode (Steam unavailable)
     */
    setOfflineMode() {
        if (!this.element) return;
        this.nameElement.textContent = steamService.playerName || 'Player';
        this.setOnlineStatus(false);
        this.avatarFor = 'placeholder';
        this.showPlaceholder(steamService.playerName);
    }

    /**
     * Handle click - open Steam overlay
     */
    async handleClick() {
        if (steamService.isOnline) {
            // Open Steam overlay to profile
            const success = await steamService.activateOverlay('Friends');
            if (!success) {
                console.log('[MainMenuPlayerCard] Steam overlay unavailable');
            }
        }
    }

    /**
     * Whether the main menu (start modal) is currently on screen. This is the
     * authoritative "should the card be visible" signal — the card belongs to the
     * menu, so any show() outside it (e.g. async Steam INIT_FAILED during gameplay)
     * must be suppressed.
     */
    _isMenuVisible() {
        const startModal = document.getElementById('start-modal');
        return !!startModal
            && startModal.classList.contains('visible')
            && !startModal.classList.contains('hidden');
    }

    /**
     * Show the player card
     */
    show() {
        // Only ever surface the card on the main menu — neutralizes stray re-shows
        // from async Steam events (INIT_FAILED/READY/RECONNECTED) during gameplay,
        // regardless of event ordering or whether gameModeChanged fired.
        if (!this.element || !this._isMenuVisible()) return;
        if (this.isVisible) return;
        this.isVisible = true;
        // Never stale: what Steam says now, not what the last event said.
        this.refresh();
        // Use requestAnimationFrame for smooth animation
        requestAnimationFrame(() => {
            if (this.isVisible) this.element?.classList.add('visible');
        });
    }

    /**
     * Hide the player card
     */
    hide() {
        if (!this.isVisible) return;
        this.isVisible = false;
        this.syncFriendsPlayingPoll();
        this.element?.classList.remove('visible');
    }

    /**
     * Destroy and cleanup
     */
    destroy() {
        this.unsubscribers.forEach((unsub) => unsub());
        this.unsubscribers = [];
        this.stopFriendsPlayingPoll();

        // Remove game mode event listeners
        if (this._gameModeHandler) {
            window.removeEventListener('gameModeChanged', this._gameModeHandler);
        }
        if (this._gameStopHandler) {
            window.removeEventListener('gameEnded', this._gameStopHandler);
            window.removeEventListener('returnToMenu', this._gameStopHandler);
        }
        if (this._startModalObserver) {
            this._startModalObserver.disconnect();
        }
        if (this._startModal && this._scrollHandler) {
            this._startModal.removeEventListener('scroll', this._scrollHandler);
        }

        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.element = null;
        this.isVisible = false;

        console.log('[MainMenuPlayerCard] Destroyed');
    }
}

// Singleton instance
let instance = null;

/**
 * Get or create the main menu player card
 */
export function getMainMenuPlayerCard() {
    if (!instance) {
        instance = new MainMenuPlayerCard();
    }
    return instance;
}

/**
 * Initialize the main menu player card
 */
export async function initializeMainMenuPlayerCard() {
    const card = getMainMenuPlayerCard();
    await card.initialize();
    return card;
}

export { MainMenuPlayerCard };
export default { getMainMenuPlayerCard, initializeMainMenuPlayerCard };
