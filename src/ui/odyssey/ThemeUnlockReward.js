import { getThemeMeta } from '../../themes/theme-registry.js';
import { getThemeMusic } from '../../core/progression/theme-music-catalog.js';
import { getOdysseyThemePresentationPalette } from '../../core/odyssey/theme-presentation.js';
import { resolveHubThemeThumbnailUrl } from '../serenity-hub/theme-thumbnail-manifest.js';
import { el } from './keystone-sheet.js';

// Outcome sheets can be rebuilt after visiting Results. The durable award is
// independent of presentation; this weak ownership never retains old sessions.
const presentedReceipts = new WeakSet();

function createSaveNotice(receipt) {
    if (receipt?.persisted !== false || !['progress', 'collection'].includes(receipt.failure)) return null;
    const notice = el('section', 'ody-theme-reward ody-theme-reward--pending');
    notice.dataset.saveFailure = receipt.failure;
    notice.dataset.celebrating = 'false';
    notice.role = 'status';
    notice.ariaLive = presentedReceipts.has(receipt) ? 'off' : 'polite';
    notice.ariaAtomic = 'true';
    presentedReceipts.add(receipt);
    const progressFailed = receipt.failure === 'progress';
    const copy = el('div', 'ody-theme-reward__copy');
    copy.appendChild(el('p', 'ody-theme-reward__save-title', progressFailed
        ? 'Progress couldn’t be saved on this device.' : 'Theme collection couldn’t be saved.'));
    copy.appendChild(el('p', 'ody-theme-reward__save-copy', progressFailed
        ? 'Keep the game open to avoid losing this progress.'
        : 'Your completed orb is saved and can restore its theme and song.'));
    notice.appendChild(copy);
    return notice;
}

/** A saved collection receipt, with no claim action, timing or input ownership. */
export function createThemeUnlockReward(receipt, { reducedMotion = false } = {}) {
    if (receipt?.failure) return createSaveNotice(receipt);
    if (receipt?.persisted !== true || !Array.isArray(receipt.themeIds)) return null;
    const themes = [...new Map(receipt.themeIds.map(getThemeMeta)
        .filter((theme) => theme && theme.id !== 'forest').map((theme) => [theme.id, theme])).values()];
    if (!themes.length) return null;
    const fresh = !presentedReceipts.has(receipt);
    presentedReceipts.add(receipt);
    const visible = () => !document.hidden && document.hasFocus?.() !== false;
    const reward = el('section', 'ody-theme-reward');
    reward.dataset.celebrating = String(fresh && !reducedMotion && visible());
    reward.dataset.reducedMotion = String(reducedMotion);
    reward.role = 'status';
    reward.ariaLive = fresh ? 'polite' : 'off';
    reward.ariaAtomic = 'true';
    const [primary] = themes;
    const palette = getOdysseyThemePresentationPalette(primary.id);
    reward.style.setProperty('--ody-reward-color', palette?.accent || '#ebcb9c');

    const artwork = el('div', 'ody-theme-reward__art');
    artwork.ariaHidden = 'true';
    const thumbnail = resolveHubThemeThumbnailUrl(primary.id, undefined, null);
    if (thumbnail) {
        const image = el('img', 'ody-theme-reward__image');
        image.src = thumbnail;
        image.alt = '';
        image.width = 88;
        image.height = 88;
        image.decoding = 'async';
        image.addEventListener('error', () => { image.hidden = true; }, { once: true });
        artwork.appendChild(image);
    }
    artwork.appendChild(el('span', 'ody-theme-reward__seal', '✦'));
    reward.appendChild(artwork);
    const copy = el('div', 'ody-theme-reward__copy');
    copy.appendChild(el('p', 'ody-theme-reward__eyebrow', themes.length > 1
        ? 'Themes + songs collected' : 'Theme + song collected'));
    copy.appendChild(el('p', 'ody-theme-reward__name', primary.displayName));
    const song = getThemeMusic(primary.id);
    if (song) {
        copy.appendChild(el(
            'p',
            'ody-theme-reward__bonus ody-theme-reward__song',
            `Song · ${song.name} · Yours in Music`,
        ));
    }
    if (themes.length > 1) {
        copy.appendChild(el('p', 'ody-theme-reward__bonus', `Also yours · ${themes.slice(1)
            .map((theme) => theme.displayName).join(' · ')}`));
    }
    const validCount = Number.isInteger(receipt.totalOwned) && Number.isInteger(receipt.totalThemes)
        && receipt.totalOwned > 0 && receipt.totalOwned <= receipt.totalThemes;
    copy.appendChild(el('p', 'ody-theme-reward__collection', validCount
        ? `${receipt.totalOwned} / ${receipt.totalThemes} themes · Yours to choose in Themes`
        : 'Yours to choose in Themes'));
    reward.appendChild(copy);

    // A hidden/paused reward becomes its stable composition. Resuming never
    // restarts the flourish, and no sound or animation is needed to read it.
    reward.suppressCelebration = () => { reward.dataset.celebrating = 'false'; };
    const onVisibility = () => { if (!visible()) reward.suppressCelebration(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', reward.suppressCelebration);
    reward.dispose = () => {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('blur', reward.suppressCelebration);
    };
    return reward;
}
