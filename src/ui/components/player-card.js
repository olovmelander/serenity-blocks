/**
 * PlayerCard Component
 * 
 * Reusable Steam avatar + player info component with:
 * - 3 sizes: small (32px), medium (64px), large (184px)
 * - Loading skeleton state
 * - Fallback to colored letter placeholder
 * - Color-coded border matching player game color
 */

import steamService from '../../core/steam/steam-service.js';
import { AVATAR_SIZES } from '../../core/steam/steam-config.js';
import { sanitizeCssColor } from '../../utils/dom-safety.js';

// CSS for player card (injected once)
const PLAYER_CARD_STYLES = `
.player-card {
    display: flex;
    align-items: center;
    gap: 8px;
}

.player-card.vertical {
    flex-direction: column;
    text-align: center;
}

.player-avatar-container {
    position: relative;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
}

.player-avatar-container.small {
    width: 32px;
    height: 32px;
}

.player-avatar-container.medium {
    width: 64px;
    height: 64px;
}

.player-avatar-container.large {
    width: 184px;
    height: 184px;
}

.player-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
}

.player-avatar-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    color: white;
    text-shadow: 0 2px 4px rgba(0,0,0,0.5);
    border-radius: 50%;
}

.player-avatar-placeholder.small { font-size: 14px; }
.player-avatar-placeholder.medium { font-size: 24px; }
.player-avatar-placeholder.large { font-size: 72px; }

.player-avatar-skeleton {
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, rgba(255,255,255,0.1) 25%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.1) 75%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s infinite;
    border-radius: 50%;
}

@keyframes skeleton-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
}

.player-card-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.player-card-name {
    font-weight: 700;
    color: white;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.player-card-subtitle {
    font-size: 0.85em;
    color: rgba(255,255,255,0.6);
}
`;

// Inject styles once
let stylesInjected = false;
function injectStyles() {
    if (stylesInjected) return;
    const style = document.createElement('style');
    style.textContent = PLAYER_CARD_STYLES;
    document.head.appendChild(style);
    stylesInjected = true;
}

/**
 * Create a PlayerCard element
 * 
 * @param {Object} options
 * @param {string} options.steamId - Player's Steam ID
 * @param {string} options.name - Player's display name
 * @param {string} options.color - Player's game color (hex)
 * @param {string} options.size - 'small' | 'medium' | 'large'
 * @param {boolean} options.showName - Show name next to avatar
 * @param {string} options.subtitle - Optional subtitle text
 * @param {boolean} options.vertical - Stack vertically
 * @param {Function} options.onClick - Click handler
 * @returns {HTMLElement}
 */
export function createPlayerCard(options = {}) {
    injectStyles();

    const {
        steamId = null,
        name = 'Player',
        color = '#8b5cf6',
        size = 'medium',
        showName = true,
        subtitle = null,
        vertical = false,
        onClick = null,
    } = options;

    const sizeClass = size;
    const sizePx = AVATAR_SIZES[size.toUpperCase()] || 64;
    const safeColor = sanitizeCssColor(color, '#8b5cf6');

    // Create card container
    const card = document.createElement('div');
    card.className = `player-card ${vertical ? 'vertical' : ''}`;
    if (onClick) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', onClick);
    }

    // Avatar container with border
    const avatarContainer = document.createElement('div');
    avatarContainer.className = `player-avatar-container ${sizeClass}`;
    avatarContainer.style.border = `3px solid ${safeColor}`;
    avatarContainer.style.boxShadow = `0 0 ${sizePx / 4}px ${safeColor}80`;

    // Skeleton placeholder (shown during loading)
    const skeleton = document.createElement('div');
    skeleton.className = 'player-avatar-skeleton';
    avatarContainer.appendChild(skeleton);

    card.appendChild(avatarContainer);

    // Info section
    if (showName) {
        const info = document.createElement('div');
        info.className = 'player-card-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'player-card-name';
        nameEl.textContent = name;
        nameEl.style.fontSize = size === 'small' ? '12px' : size === 'large' ? '18px' : '14px';
        info.appendChild(nameEl);

        if (subtitle) {
            const subtitleEl = document.createElement('div');
            subtitleEl.className = 'player-card-subtitle';
            subtitleEl.textContent = subtitle;
            info.appendChild(subtitleEl);
        }

        card.appendChild(info);
    }

    // Load avatar asynchronously
    loadAvatarAsync(avatarContainer, steamId, name, safeColor, size);

    return card;
}

/**
 * Load avatar asynchronously and update the container
 */
async function loadAvatarAsync(container, steamId, name, color, size) {
    const sizeClass = size;

    try {
        const avatarUrl = await steamService.getAvatar(steamId, size);

        // Remove skeleton
        const skeleton = container.querySelector('.player-avatar-skeleton');
        if (skeleton) skeleton.remove();

        if (avatarUrl) {
            // Show actual avatar
            const img = document.createElement('img');
            img.className = 'player-avatar-img';
            img.src = avatarUrl;
            img.alt = name;
            img.onerror = () => {
                // Fallback to placeholder on error
                img.remove();
                showPlaceholder(container, name, color, sizeClass);
            };
            container.appendChild(img);
        } else {
            // Show placeholder
            showPlaceholder(container, name, color, sizeClass);
        }
    } catch (err) {
        // Remove skeleton and show placeholder
        const skeleton = container.querySelector('.player-avatar-skeleton');
        if (skeleton) skeleton.remove();
        showPlaceholder(container, name, color, sizeClass);
    }
}

/**
 * Show letter placeholder
 */
function showPlaceholder(container, name, color, sizeClass) {
    const placeholder = document.createElement('div');
    placeholder.className = `player-avatar-placeholder ${sizeClass}`;
    placeholder.textContent = name.charAt(0).toUpperCase();
    placeholder.style.background = color;
    container.appendChild(placeholder);
}

/**
 * Update an existing player card's avatar
 */
export async function updatePlayerCardAvatar(cardElement, steamId, size = 'medium') {
    const container = cardElement.querySelector('.player-avatar-container');
    if (!container) return;

    // Get current color from border
    const color = container.style.borderColor || '#8b5cf6';
    const name = cardElement.querySelector('.player-card-name')?.textContent || 'P';

    // Clear current content
    container.innerHTML = '';

    // Add skeleton
    const skeleton = document.createElement('div');
    skeleton.className = 'player-avatar-skeleton';
    container.appendChild(skeleton);

    // Load new avatar
    await loadAvatarAsync(container, steamId, name, color, size);
}

export default { createPlayerCard, updatePlayerCardAvatar };
