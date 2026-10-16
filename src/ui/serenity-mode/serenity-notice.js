/**
 * Serenity Mode's words on screen besides the world bar: one short notice at a time (what a
 * key just did: "Music 60%", "Drift · with the music"), and the hint line that names the keys
 * on the first few visits.
 *
 * Styles: public/styles/keystone-overlays.css (`#serenity-notification`, `#serenity-first-hints`).
 */

const NOTICE_MS = 2200;
/** How many visits to Serenity Mode show the key hints, and for how long. */
export const HINT_VISITS = 3;
export const HINT_MS = 9000;
const HINT_STORE = 'serenity.serenityMode.hints';

let noticeTimer = null;

/**
 * Show a short notice; a newer one replaces it (and gets its own full time).
 * @param {string} message
 * @param {number} [ms]
 */
export function showSerenityNotice(message, ms = NOTICE_MS) {
    if (!message || typeof document === 'undefined') return;
    let notice = document.getElementById('serenity-notification');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'serenity-notification';
        notice.className = 'serenity-notification';
        notice.setAttribute('role', 'status');
        notice.setAttribute('aria-live', 'polite');
        document.body.appendChild(notice);
    }
    notice.textContent = message;
    notice.classList.add('visible');
    if (noticeTimer !== null) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
        noticeTimer = null;
        notice.classList.remove('visible');
    }, ms);
}

export function hideSerenityNotice() {
    if (noticeTimer !== null) clearTimeout(noticeTimer);
    noticeTimer = null;
    if (typeof document !== 'undefined') document.getElementById('serenity-notification')?.classList.remove('visible');
}

/** Counts this visit; true while it is one of the first HINT_VISITS. */
export function takeHintVisit() {
    try {
        const seen = Number(window.localStorage.getItem(HINT_STORE)) || 0;
        if (seen >= HINT_VISITS) return false;
        window.localStorage.setItem(HINT_STORE, String(seen + 1));
        return true;
    } catch {
        return false;
    }
}

/**
 * The hint line: keycaps and what they do, along the bottom of the screen for a while.
 * @param {Array<[string[], string]>} items keycaps (already escaped text) and their words
 * @returns {() => void} removes it early
 */
export function showFirstHints(items) {
    if (typeof document === 'undefined' || !items.length) return () => {};
    document.getElementById('serenity-first-hints')?.remove();
    const line = document.createElement('div');
    line.id = 'serenity-first-hints';
    line.className = 'serenity-first-hints serenity-hub';
    line.setAttribute('role', 'note');
    line.setAttribute('aria-label', 'Serenity controls');
    const list = document.createElement('ul');
    list.className = 'sb-hints';
    items.forEach(([caps, words]) => {
        const item = document.createElement('li');
        caps.forEach((cap) => {
            const kbd = document.createElement('kbd');
            kbd.className = 'sb-kbd';
            kbd.textContent = cap;
            item.appendChild(kbd);
        });
        item.append(words);
        list.appendChild(item);
    });
    line.appendChild(list);
    document.body.appendChild(line);
    // Next frame, so the entrance has a starting state to leave.
    requestAnimationFrame(() => line.classList.add('visible'));
    let removed = false;
    const remove = () => {
        if (removed) return;
        removed = true;
        line.classList.remove('visible');
        setTimeout(() => line.remove(), 600);
    };
    setTimeout(remove, HINT_MS);
    return remove;
}
