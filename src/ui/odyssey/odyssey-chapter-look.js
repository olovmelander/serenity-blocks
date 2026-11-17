/**
 * The chapter the UI wears. The map's header and the play rail's tray take the glass and the
 * light of the chapter the world is SHOWING (the page's `data-ody-chapter`, which the
 * stylesheet turns into --ody-hue-rgb, --ody-glass-rgb ...: public/styles/odyssey-shared.css,
 * generated from src/core/odyssey/data/chapter-looks.js). Surfaces about one orb (its card, its
 * briefing, its outcome sheet) wear that orb's chapter themselves.
 *
 * The world's chapter is read from the board a few times a second while the map shows: it
 * changes when the camera crosses a seam, wherever that happens (a scroll, a glide, a return
 * from an orb, the opening sweep), and a poll that small costs nothing and misses none of them.
 */
import { getOdysseyChapterLook, odysseyLookHex } from '../../core/odyssey/data/chapter-looks.js';

/** How often the world's chapter is read while the map shows (ms). */
export const CHAPTER_LOOK_WATCH_MS = 300;

let watch = null;

/** The chapter's light as '#rrggbb' (the journey overlay's colour, focus rings, rules). */
export function odysseyChapterColor(chapterId) {
    return odysseyLookHex(getOdysseyChapterLook(chapterId).accent);
}

/**
 * Put a chapter on the page (or take it off with null): everything outside a surface with its
 * own chapter wears it.
 * @param {number|null} chapterId
 * @param {Document} [doc]
 * @returns {boolean} whether the page changed
 */
export function wearOdysseyChapter(chapterId, doc = globalThis.document) {
    const root = doc?.documentElement;
    if (!root?.dataset) return false;
    const next = Number.isInteger(chapterId) && chapterId >= 1 ? String(getOdysseyChapterLook(chapterId).id) : null;
    const current = root.dataset.odyChapter ?? null;
    if (next === current) return false;
    if (next === null) delete root.dataset.odyChapter;
    else root.dataset.odyChapter = next;
    return true;
}

/** The chapter the world shows while the map does, else null (an orb is being played, the mode left). */
function chapterInView(mode) {
    if (!mode?.isActive || mode.isInBoardView === false) return null;
    const chapter = Number(mode.boardController?.lastActiveChapter);
    return Number.isInteger(chapter) ? chapter : null;
}

/**
 * Keep the page wearing the chapter the world shows, for as long as the mode is active.
 * Idempotent per mode; a new mode replaces the old watch; the watch ends itself (and takes the
 * chapter off the page) once the mode has left.
 * @param {object} mode OdysseyMode (isActive, isInBoardView, boardController.lastActiveChapter)
 * @param {{doc?: Document, windowRef?: Window}} [options]
 * @returns {() => void} stop
 */
export function watchOdysseyChapterInView(mode, { doc = globalThis.document, windowRef = globalThis.window } = {}) {
    if (watch?.mode === mode) return watch.stop;
    watch?.stop();
    if (!mode || typeof windowRef?.setInterval !== 'function') return () => {};
    const tick = () => {
        if (!mode.isActive) {
            watch?.stop();
            return;
        }
        wearOdysseyChapter(chapterInView(mode), doc);
    };
    const timer = windowRef.setInterval(tick, CHAPTER_LOOK_WATCH_MS);
    const stop = () => {
        windowRef.clearInterval(timer);
        if (watch?.mode === mode) watch = null;
        wearOdysseyChapter(null, doc);
    };
    watch = { mode, stop };
    tick();
    return stop;
}

/** Test seam: end any watch. */
export function resetOdysseyChapterLookForTests() {
    watch?.stop();
    watch = null;
}
