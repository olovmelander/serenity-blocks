/**
 * MainMenuPlayerCard Component
 *
 * Displays the logged-in Steam user's avatar and name in the main menu.
 * Features:
 * - Shows Steam avatar with loading skeleton
 * - Displays player name and online status
 * - Click to open Steam overlay profile
 * - Graceful offline fallback
 */

import steamService from '../../core/steam/steam-service.js';
import { STEAM_EVENTS } from '../../core/steam/steam-config.js';

// CSS for main menu player card
const MAIN_MENU_PLAYER_CARD_STYLES = `
.main-menu-player-card {
    position: fixed;
    top: 16px;
    right: 15px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px 8px 8px;
    background: rgba(15, 20, 30, 0.9);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 10px;
    backdrop-filter: blur(12px);
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 1000;
    opacity: 0;
    transform: translateY(-10px);
    pointer-events: none;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.main-menu-player-card.visible {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
}

.main-menu-player-card:hover {
    background: rgba(20, 25, 40, 0.95);
    border-color: rgba(139, 92, 246, 0.5);
    box-shadow: 0 6px 24px rgba(139, 92, 246, 0.25),
                0 4px 12px rgba(0, 0, 0, 0.4);
    transform: translateY(-1px);
}

.main-menu-player-card:active {
    transform: scale(0.98) translateY(0);
}

.mmpc-avatar-container {
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    overflow: hidden;
    border: 2px solid rgba(139, 92, 246, 0.5);
    box-shadow: 0 0 10px rgba(139, 92, 246, 0.3),
                inset 0 0 8px rgba(139, 92, 246, 0.1);
    flex-shrink: 0;
    transition: all 0.25s ease;
}

.main-menu-player-card:hover .mmpc-avatar-container {
    border-color: rgba(139, 92, 246, 0.7);
    box-shadow: 0 0 16px rgba(139, 92, 246, 0.4),
                inset 0 0 8px rgba(139, 92, 246, 0.15);
}

.mmpc-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
}

.mmpc-avatar-skeleton {
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.05) 75%);
    background-size: 200% 100%;
    animation: mmpc-skeleton-shimmer 1.5s infinite;
    border-radius: 50%;
}

@keyframes mmpc-skeleton-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}

.mmpc-avatar-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #8b5cf6, #6366f1);
    font-size: 18px;
    font-weight: bold;
    color: white;
    text-shadow: 0 2px 4px rgba(0,0,0,0.3);
    border-radius: 50%;
}

.mmpc-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}

.mmpc-name {
    font-family: 'Orbitron', sans-serif;
    font-size: 13px;
    font-weight: 700;
    color: white;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
    letter-spacing: 0.3px;
}

.mmpc-status {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.6);
}

.mmpc-state-pill {
    display: none;
    align-items: center;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 8px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    border: 1px solid rgba(148, 163, 184, 0.4);
    background: rgba(148, 163, 184, 0.12);
    color: rgba(226, 232, 240, 0.9);
}

.mmpc-state-pill.visible {
    display: inline-flex;
}

.mmpc-state-pill.partial {
    border-color: rgba(251, 191, 36, 0.5);
    background: rgba(251, 191, 36, 0.15);
    color: rgba(254, 240, 138, 0.95);
}

.mmpc-state-pill.offline {
    border-color: rgba(248, 113, 113, 0.5);
    background: rgba(248, 113, 113, 0.12);
    color: rgba(254, 226, 226, 0.95);
}

.mmpc-retry-btn {
    display: none;
    align-items: center;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid rgba(99, 102, 241, 0.5);
    background: rgba(99, 102, 241, 0.12);
    color: rgba(224, 231, 255, 0.95);
    font-size: 8px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    cursor: pointer;
}

.mmpc-retry-btn.visible {
    display: inline-flex;
}

.mmpc-retry-btn:hover {
    background: rgba(99, 102, 241, 0.2);
    border-color: rgba(129, 140, 248, 0.7);
}

.mmpc-friends-badge {
    display: none;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: 999px;
    background: rgba(34, 197, 94, 0.15);
    border: 1px solid rgba(34, 197, 94, 0.5);
    color: rgba(167, 243, 208, 0.95);
    font-size: 8px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
}

.mmpc-friends-badge.visible {
    display: inline-flex;
}

.mmpc-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #6b7280;
    transition: all 0.3s ease;
}

.mmpc-status-dot.online {
    background: #22c55e;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);
    animation: mmpc-pulse-online 2s ease-in-out infinite;
}

@keyframes mmpc-pulse-online {
    0%, 100% { box-shadow: 0 0 6px rgba(34, 197, 94, 0.5); }
    50% { box-shadow: 0 0 12px rgba(34, 197, 94, 0.7); }
}

.mmpc-status-dot.offline {
    background: #6b7280;
}

.mmpc-steam-icon {
    width: 12px;
    height: 12px;
    opacity: 0.35;
    margin-left: auto;
    transition: opacity 0.2s, transform 0.2s;
}

.main-menu-player-card:hover .mmpc-steam-icon {
    opacity: 0.75;
    transform: scale(1.1);
}

/* Responsive: Medium screens */
@media (max-width: 900px) {
    .main-menu-player-card {
        top: 14px;
        right: 12px;
        padding: 7px 10px 7px 7px;
        gap: 8px;
    }
    .mmpc-avatar-container {
        width: 36px;
        height: 36px;
    }
    .mmpc-name {
        font-size: 12px;
        max-width: 100px;
    }
    .mmpc-avatar-placeholder {
        font-size: 16px;
    }
}

/* Responsive: Small screens */
@media (max-width: 600px) {
    .main-menu-player-card {
        top: 10px;
        right: 10px;
        padding: 6px 10px 6px 6px;
        gap: 8px;
        border-radius: 8px;
    }
    .mmpc-avatar-container {
        width: 32px;
        height: 32px;
    }
    .mmpc-name {
        font-size: 11px;
        max-width: 80px;
    }
    .mmpc-status {
        font-size: 9px;
    }
    .mmpc-avatar-placeholder {
        font-size: 14px;
    }
    .mmpc-steam-icon {
        width: 10px;
        height: 10px;
    }
}
`;

// Inject styles once
let stylesInjected = false;
function injectStyles() {
    if (stylesInjected) return;
    const style = document.createElement('style');
    style.id = 'main-menu-player-card-styles';
    style.textContent = MAIN_MENU_PLAYER_CARD_STYLES;
    document.head.appendChild(style);
    stylesInjected = true;
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
    }

    /**
     * Initialize and create the player card
     */
    async initialize() {
        injectStyles();
        this.createElement();
        this.setupEventListeners();

        // Show immediately if Steam is already initialized
        if (steamService.initComplete) {
            await this.updateFromSteam();
            await this.updateConnectionState();
            await this.updateFriendsPlaying();
            this.startFriendsPlayingPoll();
            this.show();
        }

        console.log('[MainMenuPlayerCard] Initialized');
    }

    /**
     * Create the DOM element
     */
    createElement() {
        this.element = document.createElement('div');
        this.element.className = 'main-menu-player-card';
        this.element.setAttribute('role', 'button');
        this.element.setAttribute('aria-label', 'Steam Profile');
        this.element.setAttribute('tabindex', '0');

        this.element.innerHTML = `
            <div class="mmpc-avatar-container">
                <div class="mmpc-avatar-skeleton"></div>
            </div>
            <div class="mmpc-info">
                <div class="mmpc-name">Loading...</div>
                <div class="mmpc-status">
                    <span class="mmpc-status-dot"></span>
                    <span class="mmpc-status-text">Connecting...</span>
                    <span class="mmpc-friends-badge">0 Friends Playing</span>
                    <span class="mmpc-state-pill"></span>
                    <button type="button" class="mmpc-retry-btn">Retry now</button>
                </div>
            </div>
            <svg class="mmpc-steam-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
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
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.handleClick();
            }
        });

        if (this.retryButton) {
            this.retryButton.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
                await steamService.retryConnection();
                await this.updateConnectionState();
            });
        }

        document.body.appendChild(this.element);
    }

    /**
     * Setup Steam event listeners
     */
    setupEventListeners() {
        // Listen for Steam ready
        this.unsubscribers.push(
            steamService.on(STEAM_EVENTS.READY, () => {
                this.updateFromSteam();
                this.updateConnectionState();
                this.updateFriendsPlaying();
                this.startFriendsPlayingPoll();
                this.show();
            })
        );

        // Listen for connection changes
        this.unsubscribers.push(
            steamService.on(STEAM_EVENTS.CONNECTED, () => {
                this.setOnlineStatus(true);
                this.updateConnectionState();
                this.updateFriendsPlaying();
                this.startFriendsPlayingPoll();
            })
        );

        this.unsubscribers.push(
            steamService.on(STEAM_EVENTS.DISCONNECTED, () => {
                this.setOnlineStatus(false);
                this.updateConnectionState();
                this.setFriendsPlayingCount(0);
                this.stopFriendsPlayingPoll();
            })
        );

        this.unsubscribers.push(
            steamService.on(STEAM_EVENTS.RECONNECTED, () => {
                this.updateFromSteam();
                this.setOnlineStatus(true);
                this.updateConnectionState();
                this.updateFriendsPlaying();
                this.startFriendsPlayingPoll();
            })
        );

        // If Steam init failed, show offline state
        this.unsubscribers.push(
            steamService.on(STEAM_EVENTS.INIT_FAILED, () => {
                this.setOfflineMode();
                this.updateConnectionState();
                this.setFriendsPlayingCount(0);
                this.stopFriendsPlayingPoll();
                this.show();
            })
        );

        this.unsubscribers.push(
            steamService.on(STEAM_EVENTS.CAPABILITIES_UPDATED, () => {
                this.updateConnectionState();
            })
        );

        this.unsubscribers.push(
            steamService.on(STEAM_EVENTS.STATE_CHANGED, () => {
                this.updateConnectionState();
            })
        );

        // Hide during gameplay, show when returning to menu
        this._gameModeHandler = (e) => {
            const { mode } = e.detail || {};
            // Hide card when any game mode is selected
            if (mode) {
                this.hide();
            }
        };
        window.addEventListener('gameModeChanged', this._gameModeHandler);

        // Show again when game stops or returns to menu
        this._gameStopHandler = () => {
            // Small delay to let modal appear first
            setTimeout(() => this.show(), 100);
        };
        window.addEventListener('gameEnded', this._gameStopHandler);
        window.addEventListener('returnToMenu', this._gameStopHandler);

        // Also show when start modal becomes visible
        this._startModalObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const modal = mutation.target;
                    if (modal.classList.contains('visible') && !modal.classList.contains('hidden')) {
                        this.show();
                    }
                }
            });
        });

        const startModal = document.getElementById('start-modal');
        if (startModal) {
            this._startModalObserver.observe(startModal, { attributes: true });
        }
    }

    /**
     * Update card from Steam data
     */
    async updateFromSteam() {
        const status = steamService.getStatus();

        // Update name
        this.nameElement.textContent = status.playerName || 'Player';

        // Update online status
        this.setOnlineStatus(status.isOnline);

        // Load avatar
        await this.loadAvatar(status.steamId, status.playerName);
    }

    /**
     * Update connection state pill + retry button
     */
    async updateConnectionState() {
        if (!this.statePill || !this.retryButton) return;

        const state = steamService.getConnectionState
            ? steamService.getConnectionState()
            : (steamService.isOnline ? 'connected' : 'offline');
        const capabilities = steamService.getCapabilities ? steamService.getCapabilities() : {};
        const status = steamService.getStatus ? steamService.getStatus() : {};
        const queuedActions = Number(status?.queuedActions || 0);
        const queueNote = queuedActions > 0 ? ` • ${queuedActions} queued` : '';

        this.statePill.classList.remove('visible', 'partial', 'offline');
        this.retryButton.classList.remove('visible');

        if (state === 'partial') {
            this.statePill.textContent = 'Limited';
            this.statePill.classList.add('visible', 'partial');
            const missing = [];
            if (!capabilities.leaderboards) missing.push('leaderboards');
            if (!capabilities.cloud) missing.push('cloud');
            if (!capabilities.achievements) missing.push('achievements');
            if (!capabilities.friends) missing.push('friends');
            this.statePill.title = missing.length
                ? `Steam API missing: ${missing.join(', ')}${queueNote}`
                : `Steam API limited${queueNote}`;
        } else if (state === 'offline' || state === 'no_steam') {
            this.statePill.textContent = 'Offline';
            this.statePill.classList.add('visible', 'offline');
            this.statePill.title = state === 'no_steam'
                ? `Steam client unavailable${queueNote}`
                : `Steam offline${queueNote}`;
            this.retryButton.classList.add('visible');
        } else {
            this.statePill.title = '';
        }
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

        const label = count === 1 ? 'Friend' : 'Friends';
        this.friendsBadge.textContent = `${count} ${label} Playing`;
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
                img.alt = playerName || 'Player';
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
        const letter = (name || 'P').charAt(0).toUpperCase();
        this.avatarContainer.innerHTML = `<div class="mmpc-avatar-placeholder">${letter}</div>`;
    }

    /**
     * Set online/offline status display
     */
    setOnlineStatus(isOnline) {
        this.statusDot.classList.toggle('online', isOnline);
        this.statusDot.classList.toggle('offline', !isOnline);
        this.statusText.textContent = isOnline ? 'Online' : 'Offline';
    }

    /**
     * Set offline mode (Steam unavailable)
     */
    setOfflineMode() {
        this.nameElement.textContent = steamService.playerName || 'Player';
        this.setOnlineStatus(false);
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
     * Show the player card
     */
    show() {
        if (this.isVisible) return;
        this.isVisible = true;
        // Use requestAnimationFrame for smooth animation
        requestAnimationFrame(() => {
            this.element.classList.add('visible');
        });
    }

    /**
     * Hide the player card
     */
    hide() {
        if (!this.isVisible) return;
        this.isVisible = false;
        this.element.classList.remove('visible');
    }

    /**
     * Destroy and cleanup
     */
    destroy() {
        this.unsubscribers.forEach(unsub => unsub());
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

        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.element = null;

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
