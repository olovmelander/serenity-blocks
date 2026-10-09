import { getThemeMeta } from '../../themes/theme-registry.js';
import { getThemeMusic } from '../../core/progression/theme-music-catalog.js';
import { getOdysseyThemePresentationPalette } from '../../core/odyssey/theme-presentation.js';
import { resolveHubThemeThumbnailUrl } from '../serenity-hub/theme-thumbnail-manifest.js';
import { el } from './keystone-sheet.js';
import { countWords } from './journey-pacing.js';

// Outcome sheets can be rebuilt after visiting Results. The durable award is
// independent of presentation; this weak ownership never retains old sessions.
const presentedReceipts = new WeakSet();
const SPARKS = 10;

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
    notice.readingWords = countWords(Array.from(copy.children, (node) => node.textContent));
    return notice;
}

function createArtwork(themeId, { ceremony }) {
    const artwork = el('div', 'ody-theme-reward__art');
    artwork.ariaHidden = 'true';
    if (ceremony) {
        ['halo', 'ring', 'ring ody-theme-reward__ring--outer'].forEach((part) => {
            artwork.appendChild(el('span', `ody-theme-reward__${part}`));
        });
        const sparks = el('span', 'ody-theme-reward__sparks');
        for (let index = 0; index < SPARKS; index += 1) {
            const spark = el('i', 'ody-theme-reward__spark');
            spark.style.setProperty('--spark-angle', `${Math.round((360 / SPARKS) * index + (index % 2) * 11)}deg`);
            spark.style.setProperty('--spark-delay', `${(index % 5) * 70}ms`);
            spark.style.setProperty('--spark-reach', `${index % 3 === 0 ? 118 : 96}%`);
            sparks.appendChild(spark);
        }
        artwork.appendChild(sparks);
    }
    const thumbnail = resolveHubThemeThumbnailUrl(themeId, undefined, null);
    if (thumbnail) {
        const image = el('img', 'ody-theme-reward__image');
        image.src = thumbnail;
        image.alt = '';
        image.width = ceremony ? 176 : 88;
        image.height = ceremony ? 176 : 88;
        image.decoding = 'async';
        image.addEventListener('error', () => { image.hidden = true; }, { once: true });
        artwork.appendChild(image);
    }
    artwork.appendChild(el('span', 'ody-theme-reward__seal', '✦'));
    return artwork;
}

function appendCompactCopy(copy, { themes, primary, song }) {
    copy.appendChild(el('p', 'ody-theme-reward__eyebrow', themes.length > 1
        ? 'Themes + songs collected' : 'Theme + song collected'));
    copy.appendChild(el('p', 'ody-theme-reward__name', primary.displayName));
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
}

/** The first-time reward is the hero of the completion: what you unlocked, heard and collected. */
function appendCeremonyCopy(copy, {
    themes, primary, song, nowPlaying,
}) {
    const readable = [];
    const add = (tag, className, text) => {
        readable.push(text);
        return copy.appendChild(el(tag, className, text));
    };
    add('p', 'ody-theme-reward__eyebrow', themes.length > 1 ? 'New themes unlocked' : 'New theme unlocked');
    add('p', 'ody-theme-reward__name', primary.displayName);
    if (song) {
        const row = el('p', 'ody-theme-reward__song');
        row.dataset.nowPlaying = String(nowPlaying);
        const bars = el('span', 'ody-theme-reward__eq');
        bars.ariaHidden = 'true';
        for (let index = 0; index < 4; index += 1) bars.appendChild(el('i'));
        row.appendChild(bars);
        const songName = `New song · ${song.name}`;
        readable.push(songName);
        row.appendChild(el('span', 'ody-theme-reward__song-name', songName));
        copy.appendChild(row);
        add('p', 'ody-theme-reward__song-note', nowPlaying
            ? 'Playing now · yours to keep in Music' : 'Yours to keep in Music');
    }
    if (themes.length > 1) {
        add('p', 'ody-theme-reward__bonus', `Also unlocked · ${themes.slice(1)
            .map((theme) => theme.displayName).join(' · ')}`);
    }
    return readable;
}

/**
 * A saved collection receipt, with no claim action, timing or input ownership.
 * `variant: 'ceremony'` is the large completion reveal; the compact card serves Results and the finale.
 */
export function createThemeUnlockReward(receipt, {
    reducedMotion = false, variant = 'compact', nowPlaying = false,
} = {}) {
    if (receipt?.failure) return createSaveNotice(receipt);
    if (receipt?.persisted !== true || !Array.isArray(receipt.themeIds)) return null;
    const themes = [...new Map(receipt.themeIds.map(getThemeMeta)
        .filter((theme) => theme && theme.id !== 'forest').map((theme) => [theme.id, theme])).values()];
    if (!themes.length) return null;
    const ceremony = variant === 'ceremony';
    const fresh = !presentedReceipts.has(receipt);
    presentedReceipts.add(receipt);
    const visible = () => !document.hidden && document.hasFocus?.() !== false;
    const reward = el('section', ceremony ? 'ody-theme-reward ody-theme-reward--ceremony' : 'ody-theme-reward');
    reward.dataset.celebrating = String(fresh && !reducedMotion && visible());
    reward.dataset.reducedMotion = String(reducedMotion);
    reward.role = 'status';
    reward.ariaLive = fresh ? 'polite' : 'off';
    reward.ariaAtomic = 'true';
    const [primary] = themes;
    const palette = getOdysseyThemePresentationPalette(primary.id);
    reward.style.setProperty('--ody-reward-color', palette?.accent || '#ebcb9c');
    if (palette?.highlight) reward.style.setProperty('--ody-reward-glow', palette.highlight);

    reward.appendChild(createArtwork(primary.id, { ceremony }));
    const copy = el('div', 'ody-theme-reward__copy');
    const song = getThemeMusic(primary.id);
    const readable = ceremony ? appendCeremonyCopy(copy, {
        themes, primary, song, nowPlaying: Boolean(nowPlaying && song),
    }) : [];
    if (!ceremony) appendCompactCopy(copy, { themes, primary, song });
    const validCount = Number.isInteger(receipt.totalOwned) && Number.isInteger(receipt.totalThemes)
        && receipt.totalOwned > 0 && receipt.totalOwned <= receipt.totalThemes;
    if (ceremony && validCount) {
        // The meter fills from the collection before this orb to the one after it.
        const meter = el('div', 'ody-theme-reward__meter');
        meter.ariaHidden = 'true';
        const before = Math.max(0, receipt.totalOwned - themes.length) / receipt.totalThemes;
        meter.style.setProperty('--meter-from', before.toFixed(4));
        meter.style.setProperty('--meter-to', (receipt.totalOwned / receipt.totalThemes).toFixed(4));
        meter.appendChild(el('span', 'ody-theme-reward__meter-fill'));
        copy.appendChild(meter);
    }
    let collectionCopy = 'Yours to choose in Themes';
    if (validCount) {
        collectionCopy = ceremony
            ? `${receipt.totalOwned} of ${receipt.totalThemes} themes collected`
            : `${receipt.totalOwned} / ${receipt.totalThemes} themes · Yours to choose in Themes`;
    }
    copy.appendChild(el('p', 'ody-theme-reward__collection', collectionCopy));
    reward.appendChild(copy);
    reward.readingWords = countWords(readable, collectionCopy);

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
