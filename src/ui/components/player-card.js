/**
 * PlayerCard Component
 *
 * Reusable Steam avatar + player name, used by the online waiting room:
 * - 3 sizes: small (32px), medium (64px), large (184px)
 * - Loading skeleton state
 * - Fallback to a letter tile in the player's colour
 * - Rounded-square avatar framed in the player's colour
 *
 * Class names are `mp-avatar*` — the board cards own `.player-card` (themes style
 * `.player-card[data-player]`), so this component never shares it. Styles live in
 * public/styles/keystone-multiplayer.css; the player colour arrives as `--avatar-color`.
 */

import steamService from '../../core/steam/steam-service.js';
import { sanitizeCssColor } from '../../utils/dom-safety.js';

const SIZES = new Set(['small', 'medium', 'large']);

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

    const sizeClass = SIZES.has(size) ? size : 'medium';
    const safeColor = sanitizeCssColor(color, '#8b5cf6');

    // Create card container
    const card = document.createElement('div');
    card.className = `mp-avatar-card mp-avatar-card--${sizeClass}${vertical ? ' mp-avatar-card--vertical' : ''}`;
    card.style.setProperty('--avatar-color', safeColor);
    if (onClick) {
        card.classList.add('is-clickable');
        card.addEventListener('click', onClick);
    }

    // Avatar tile framed in the player's colour
    const avatarContainer = document.createElement('div');
    avatarContainer.className = `mp-avatar mp-avatar--${sizeClass}`;

    // Skeleton placeholder (shown during loading)
    const skeleton = document.createElement('div');
    skeleton.className = 'mp-avatar__skeleton';
    avatarContainer.appendChild(skeleton);

    card.appendChild(avatarContainer);

    // Info section
    if (showName) {
        const info = document.createElement('div');
        info.className = 'mp-avatar-card__info';

        const nameEl = document.createElement('div');
        nameEl.className = 'mp-avatar-card__name';
        nameEl.textContent = name;
        info.appendChild(nameEl);

        if (subtitle) {
            const subtitleEl = document.createElement('div');
            subtitleEl.className = 'mp-avatar-card__subtitle';
            subtitleEl.textContent = subtitle;
            info.appendChild(subtitleEl);
        }

        card.appendChild(info);
    }

    // Load avatar asynchronously
    loadAvatarAsync(avatarContainer, steamId, name, sizeClass);

    return card;
}

/**
 * Load avatar asynchronously and update the container
 */
async function loadAvatarAsync(container, steamId, name, size) {
    try {
        const avatarUrl = await steamService.getAvatar(steamId, size);

        // Remove skeleton
        container.querySelector('.mp-avatar__skeleton')?.remove();

        if (avatarUrl) {
            // Show actual avatar
            const img = document.createElement('img');
            img.className = 'mp-avatar__img';
            img.src = avatarUrl;
            img.alt = '';
            img.onerror = () => {
                // Fallback to placeholder on error
                img.remove();
                showPlaceholder(container, name);
            };
            container.appendChild(img);
        } else {
            // Show placeholder
            showPlaceholder(container, name);
        }
    } catch (err) {
        // Remove skeleton and show placeholder
        container.querySelector('.mp-avatar__skeleton')?.remove();
        showPlaceholder(container, name);
    }
}

/**
 * Show letter placeholder (tinted by the card's --avatar-color)
 */
function showPlaceholder(container, name) {
    const placeholder = document.createElement('div');
    placeholder.className = 'mp-avatar__placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.textContent = (name || 'P').charAt(0).toUpperCase();
    container.appendChild(placeholder);
}

/**
 * Update an existing player card's avatar
 */
export async function updatePlayerCardAvatar(cardElement, steamId, size = 'medium') {
    const container = cardElement.querySelector('.mp-avatar');
    if (!container) return;

    const name = cardElement.querySelector('.mp-avatar-card__name')?.textContent || 'P';

    // Clear current content
    container.innerHTML = '';

    // Add skeleton
    const skeleton = document.createElement('div');
    skeleton.className = 'mp-avatar__skeleton';
    container.appendChild(skeleton);

    // Load new avatar
    await loadAvatarAsync(container, steamId, name, SIZES.has(size) ? size : 'medium');
}

export default { createPlayerCard, updatePlayerCardAvatar };
