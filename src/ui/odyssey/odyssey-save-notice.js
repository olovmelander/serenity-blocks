import { showToast } from '../components/toast.js';

/**
 * Tell the player, once, that their Odyssey save could not be read. The journey starts fresh
 * either way; it used to say nothing while the next save overwrote the old one, which
 * OdysseyStateManager now keeps beside it (audit 2026-10-18).
 * @param {{ unreadableSaveKey?: string, unreadableSaveNoticed?: boolean }|null|undefined} state
 * @returns {boolean} whether the notice was shown
 */
export function noticeOdysseyUnreadableSave(state) {
    if (!state?.unreadableSaveKey || state.unreadableSaveNoticed) return false;
    state.unreadableSaveNoticed = true;
    return showToast({
        message: 'Your Odyssey save could not be read, so the journey starts fresh. '
            + 'The old save was kept as a backup.',
        type: 'warning',
        timeoutMs: 10000,
    }) !== null;
}
