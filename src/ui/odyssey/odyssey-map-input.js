/**
 * Keyboard and controller travel on the Odyssey map. Arrows and the D-pad step along the path
 * (orb by orb, or chapter by chapter), Enter and A play the selected orb, Home returns to the
 * first orb and End to the one that waits to be played. Nothing here owns the map while a
 * sheet, the navigator, a journey flow or the first arrival does.
 */
import { getOpenSheet } from '../sheet-input.js';
import { isOdysseyWorldInterlude } from './odyssey-world-return.js';

const KEY_MOVES = Object.freeze({
    ArrowRight: 'next',
    ArrowLeft: 'previous',
    ArrowUp: 'next-chapter',
    ArrowDown: 'previous-chapter',
    PageUp: 'next-chapter',
    PageDown: 'previous-chapter',
    Home: 'first',
    End: 'current',
});
const PAD_REPEAT_DELAY_MS = 420;
const PAD_REPEAT_INTERVAL_MS = 180;
const PAD_MOVES = Object.freeze([
    { move: 'next', button: 15, axis: 0, sign: 1 },
    { move: 'previous', button: 14, axis: 0, sign: -1 },
    { move: 'next-chapter', button: 12, axis: 1, sign: -1 },
    { move: 'previous-chapter', button: 13, axis: 1, sign: 1 },
]);

/**
 * Where a step lands. Pure: the selection, or the orb that waits to be played when none is
 * selected, moves by one orb or to the next or previous chapter's first orb.
 */
export function stepOdysseyMapSelection({
    selectedLevelId = null, currentLevel = 1, totalLevels = 1, chapterStarts = [],
}, move) {
    const total = Math.max(1, Number(totalLevels) || 1);
    const clamp = (id) => Math.max(1, Math.min(total, id));
    const from = clamp(Number.isFinite(selectedLevelId) ? selectedLevelId : (Number(currentLevel) || 1));
    switch (move) {
    case 'next': return clamp(from + 1);
    case 'previous': return clamp(from - 1);
    case 'next-chapter': return chapterStarts.find((start) => start > from) ?? total;
    case 'previous-chapter': {
        const behind = chapterStarts.filter((start) => start < from);
        return behind.length ? behind[behind.length - 1] : 1;
    }
    case 'first': return 1;
    case 'current': return clamp(Number(currentLevel) || 1);
    default: return from;
    }
}

/** The map answers keys and the pad only while it is the thing on screen. */
export function canNavigateOdysseyMap(mode, doc = globalThis.document) {
    if (!mode?.isActive || !mode.isInBoardView || mode.isEnteringLevel || mode.levelCompleting) return false;
    if (isOdysseyWorldInterlude(mode) || mode._isOdysseyNavigatorOpen?.() || mode._firstArrival) return false;
    if (doc && (getOpenSheet(doc) || doc.getElementById?.('odyssey-flow-overlay'))) return false;
    return true;
}

export function describeOdysseyMapSelection(mode) {
    return {
        selectedLevelId: Number.isFinite(mode.selectedLevelId) ? mode.selectedLevelId : null,
        currentLevel: mode.odysseyState?.currentLevel || 1,
        totalLevels: mode.levelRegistry?.getTotalLevels?.() || 1,
        chapterStarts: (mode.levelRegistry?.getAllChapters?.() || [])
            .map((chapter) => chapter?.levelRange?.[0]).filter(Number.isFinite),
    };
}

/** Travel to the orb a step lands on; the board's selection callback fills the panel. */
export function moveOdysseyMapSelection(mode, move) {
    if (!canNavigateOdysseyMap(mode)) return null;
    const target = stepOdysseyMapSelection(describeOdysseyMapSelection(mode), move);
    if (!Number.isFinite(target)) return null;
    mode.boardController?.selectLevel?.(target);
    return target;
}

/** Play the selected orb when it is open. */
export function playOdysseyMapSelection(mode) {
    if (!canNavigateOdysseyMap(mode)) return false;
    const levelId = mode.selectedLevelId;
    if (!Number.isFinite(levelId) || !mode.odysseyState?.isLevelUnlocked?.(levelId)) return false;
    Promise.resolve(mode.launchOdysseyLevel(levelId, { source: 'map-input' }))
        .catch((error) => console.warn('[Odyssey] Map launch failed:', error));
    return true;
}

/** The first controller's D-pad and left stick step the map; A plays. Held directions repeat. */
export function createOdysseyMapPadControls(controller, {
    isActive, onMove, onPlay, now = () => (globalThis.performance?.now?.() ?? Date.now()),
}) {
    const held = new Map();
    let playArmed = false;
    const reset = () => {
        held.clear();
        playArmed = false;
    };
    const pressed = (gamepad, entry) => Boolean(gamepad.buttons[entry.button]?.pressed)
        || (entry.sign < 0 ? controller.isAxisNegative(gamepad, entry.axis) : controller.isAxisPositive(gamepad, entry.axis));
    return {
        reset,
        process(gamepad, slot) {
            if (slot !== 0) return false;
            if (!isActive() || document.hidden || document.hasFocus?.() === false
                || gamepad.buttons[9]?.pressed) {
                reset();
                return false;
            }
            const time = now();
            for (const entry of PAD_MOVES) {
                if (!pressed(gamepad, entry)) {
                    held.delete(entry.move);
                    continue;
                }
                const state = held.get(entry.move);
                if (!state) {
                    held.set(entry.move, { nextAt: time + PAD_REPEAT_DELAY_MS });
                    onMove(entry.move);
                } else if (time >= state.nextAt) {
                    state.nextAt = time + PAD_REPEAT_INTERVAL_MS;
                    onMove(entry.move);
                }
            }
            const play = Boolean(gamepad.buttons[0]?.pressed);
            if (!play) playArmed = true;
            else if (playArmed) {
                playArmed = false;
                onPlay();
            }
            // Start still opens Settings through the ordinary poll.
            return false;
        },
    };
}

/** Own the map's keys and pad for as long as the mode is active; dispose on deactivation. */
export function installOdysseyMapInput(mode) {
    let disposed = false;
    const doc = typeof document !== 'undefined' ? document : null;
    const onKeyDown = (event) => {
        if (disposed || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.target?.closest?.('input, textarea, select, [contenteditable]')) return;
        const move = KEY_MOVES[event.key];
        if (move) {
            if (event.repeat && (move === 'first' || move === 'current')) return;
            if (moveOdysseyMapSelection(mode, move) !== null) event.preventDefault();
            return;
        }
        if (event.key !== 'Enter' && event.key !== ' ') return;
        // A focused control keeps its own Enter and Space (the Play button, the preference).
        if (event.repeat || event.target?.closest?.('button, a, label, input, summary')) return;
        if (playOdysseyMapSelection(mode)) event.preventDefault();
    };
    const pad = mode.deps?.gamepadController?.setOdysseyMapControls?.({
        isActive: () => !disposed && canNavigateOdysseyMap(mode),
        onMove: (move) => moveOdysseyMapSelection(mode, move),
        onPlay: () => playOdysseyMapSelection(mode),
    });
    doc?.addEventListener?.('keydown', onKeyDown, true);
    return () => {
        if (disposed) return;
        disposed = true;
        doc?.removeEventListener?.('keydown', onKeyDown, true);
        pad?.dispose?.();
    };
}
