/**
 * An orb's world as art, the navigator's way (odyssey-navigator.css .odyssey-postcard__art):
 * the theme's artwork in a ring, a halo and an orbit in the chapter's light, a lock while shut,
 * a crown on a chapter boss, VS on a rival and the orb's number on a tab. For every surface
 * that shows one orb beside its story: the map's orb panel, the failure and results sheets, the
 * travel cover and the finale. Stars are drawn the same way everywhere they are counted.
 *
 * Plain DOM properties only (className, dataset, innerHTML for the glyphs), so the builders
 * stay testable against minimal element stubs. Styles: public/styles/odyssey-shared.css
 * (.sb-orb-art, .sb-star-row and the chapter hues, --ody-hue-rgb on [data-ody-chapter]).
 */
import { resolveHubThemeThumbnailUrl } from '../serenity-hub/theme-thumbnail-manifest.js';

export const ODYSSEY_STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M12 2.6l2.7 5.6 6.1.8-4.4 4.3 1.1 6.1L12 16.5l-5.5 2.9 1.1-6.1-4.4-4.3 6.1-.8L12 2.6Z"/></svg>';
export const ODYSSEY_CROWN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M4.5 18 3.2 8.2l4.6 3.6L12 5l4.2 6.8 4.6-3.6L19.5 18Z"/></svg>';
export const ODYSSEY_LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';

/**
 * The theme whose artwork shows an orb, from its authored or presented level (the navigator's
 * rule, odyssey-navigator-model.js): its icon theme, else its path icon, else its primary theme.
 * @param {object|null|undefined} level a LevelRegistry level or resolveLevelPresentation() result
 * @returns {string|null}
 */
export function odysseyLevelThemeId(level) {
    return level?.iconThemeId || level?.theme?.pathIcon || level?.theme?.primary || null;
}

/** The artwork for an orb's theme, or null when there is none to show. */
export function odysseyOrbArtUrl(themeId) {
    if (!themeId) return null;
    try {
        return resolveHubThemeThumbnailUrl(themeId, undefined, null) || null;
    } catch {
        return null;
    }
}

function node(tag, className, text = '') {
    const element = globalThis.document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

/**
 * The orb's world in its rings. Decorative: the surface around it names the orb.
 * @param {object} [options]
 * @param {string|null} [options.themeId] the orb's theme, whose artwork fills the ring
 * @param {number|string|null} [options.chapter] lends the halo and orbit its light (data-ody-chapter)
 * @param {'open'|'next'|'cleared'|'locked'|'failed'} [options.state]
 * @param {'boss'|'rival'|'showcase'|null} [options.kind]
 * @param {number|string|null} [options.number] the orb's number on the tab under the ring
 * @param {boolean} [options.breathe] the halo breathes (off for small or busy places)
 * @param {string} [options.className] extra classes for the root
 * @returns {HTMLElement|null}
 */
export function createOdysseyOrbArt({
    themeId = null, chapter = null, state = 'open', kind = null, number = null, breathe = true, className = '',
} = {}) {
    if (!globalThis.document?.createElement) return null;
    const art = node('span', `sb-orb-art${className ? ` ${className}` : ''}`);
    art.setAttribute?.('aria-hidden', 'true');
    if (art.dataset) {
        art.dataset.state = state;
        if (kind) art.dataset.kind = kind;
        if (chapter !== null && chapter !== undefined) art.dataset.odyChapter = String(chapter);
        if (!breathe) art.dataset.still = 'true';
    }
    art.appendChild(node('span', 'sb-orb-art__halo'));
    art.appendChild(node('span', 'sb-orb-art__orbit'));
    const disc = node('span', 'sb-orb-art__disc');
    const src = odysseyOrbArtUrl(themeId);
    if (src) {
        const image = node('img', 'sb-orb-art__image');
        image.alt = '';
        image.decoding = 'async';
        image.width = 256;
        image.height = 256;
        image.addEventListener?.('error', () => { image.hidden = true; }, { once: true });
        image.src = src;
        disc.appendChild(image);
    }
    art.appendChild(disc);
    if (state === 'locked') {
        const lock = node('span', 'sb-orb-art__lock');
        lock.innerHTML = ODYSSEY_LOCK_SVG;
        art.appendChild(lock);
    }
    if (kind === 'boss') {
        const crown = node('span', 'sb-orb-art__badge sb-orb-art__badge--boss');
        crown.innerHTML = ODYSSEY_CROWN_SVG;
        art.appendChild(crown);
    } else if (kind === 'rival') {
        art.appendChild(node('span', 'sb-orb-art__badge sb-orb-art__badge--rival', 'VS'));
    }
    if (number !== null && number !== undefined && number !== '') {
        art.appendChild(node('span', 'sb-orb-art__number', String(number)));
    }
    return art;
}

/**
 * Three stars, the earned ones lit in gold (the navigator's and the results sheet's star).
 * @param {number} earned
 * @param {{ className?: string, total?: number, label?: string }} [options]
 * @returns {HTMLElement|null}
 */
export function createOdysseyStarRow(earned, { className = '', total = 3, label = '' } = {}) {
    if (!globalThis.document?.createElement) return null;
    const count = Math.max(0, Math.min(total, Math.floor(Number(earned) || 0)));
    const row = node('span', `sb-star-row${className ? ` ${className}` : ''}`);
    if (label) {
        row.setAttribute?.('role', 'img');
        row.setAttribute?.('aria-label', label);
    } else {
        row.setAttribute?.('aria-hidden', 'true');
    }
    for (let index = 0; index < total; index += 1) {
        const star = node('i', index < count ? 'is-earned' : '');
        star.innerHTML = ODYSSEY_STAR_SVG;
        row.appendChild(star);
    }
    return row;
}
