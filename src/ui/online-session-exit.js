const EXIT_MESSAGES = Object.freeze({
    update_required: 'Update Serenity Blocks to join this match.',
    host_update_required: 'This host is using an older version. Ask the host to update Serenity Blocks.',
    invalid_protocol_range: 'The match version could not be verified. Update Serenity Blocks and try again.',
    invalid_protocol_selection: 'The host returned an invalid network version. The join was stopped.',
    envelope_mismatch: 'This match uses an incompatible network envelope. Update Serenity Blocks and try again.',
    protocol_mismatch: 'This match uses an incompatible version of Serenity Blocks.',
    lobby_full: 'This lobby is full. Choose another match or try again later.',
    join_failed: 'The host could not add you to this match.',
    kicked: 'You were removed from the match by the host.',
});

/**
 * Terminal join failures arrive redundantly as WELCOME(false) and
 * JOIN_REJECTED. Teardown and notification are deliberately one-shot.
 * @param {any} mode
 * @param {any} detail
 */
export async function handleOnlineSessionExit(mode, detail = {}) {
    const reason = typeof detail.reason === 'string' ? detail.reason : 'protocol_mismatch';
    if (mode._handledSessionExit) return;
    mode._handledSessionExit = reason;
    try { await mode._handleExitToMenu(); } catch (error) { /* best-effort teardown */ }
    try {
        window.dispatchEvent(new CustomEvent('serenity:toast', {
            detail: {
                message: EXIT_MESSAGES[reason] ?? 'Unable to join this match.',
                type: 'warning',
            },
        }));
    } catch (error) { /* no-op outside the browser */ }
}
