// @ts-check

import { canPlacePiece } from '../game.js';

/**
 * Can the local piece move by (dx, dy) now?
 * - 'move': it can.
 * - 'blocked': a wall or the stack is in the way, so nothing would change.
 * - 'later': no piece is falling (between pieces, or mid-cascade), so the command waits
 *   for the next one on both sides.
 * @param {Record<string, any>|null|undefined} gameState
 * @param {number} dx
 * @param {number} dy
 * @returns {'move'|'blocked'|'later'}
 */
export function localMoveOutcome(gameState, dx, dy) {
    const piece = gameState?.currentPiece;
    if (!piece || gameState.isProcessingPhysics) return 'later';
    return canPlacePiece(gameState, piece, piece.x + dx, piece.y + dy) ? 'move' : 'blocked';
}

/**
 * The online versus input hooks behind window.move / rotate / softDrop / hardDrop.
 *
 * Auto-repeat (DAS/ARR and a held soft drop) keeps repeating until an action returns
 * false. These hooks used to return nothing, so at an instant repeat rate a held key
 * sent its whole repeat budget every frame (about 600 moves a second). The host's rate
 * limit then threw inputs away, its own and its peers', and the boards came apart. A move
 * or soft drop the local board cannot make changes nothing, so it is neither sent nor
 * repeated. One made while no piece falls is sent once (both sides defer it) and stops
 * the repeat for that frame.
 * @param {{
 *   send: (type: string, data: Record<string, unknown>) => void,
 *   gameState: () => Record<string, any>|null|undefined,
 *   juice: () => Record<string, any>|null|undefined,
 * }} options
 */
export function createOnlineInputHooks({ send, gameState, juice }) {
    const inHitStop = () => gameState()?.hitStopRemaining > 0;
    /** @param {string} type @param {Record<string, unknown>} data @param {number} dx @param {number} dy */
    const step = (type, data, dx, dy) => {
        if (inHitStop()) return false;
        const outcome = localMoveOutcome(gameState(), dx, dy);
        if (outcome === 'blocked') return false;
        send(type, data);
        return outcome === 'move';
    };
    return {
        /** @param {number} dir */
        move: (dir) => {
            const moved = step('move', { direction: dir }, dir, 0);
            if (moved) {
                juice()?.nudge?.(dir * 1.5, 0);
                juice()?.tilt?.(dir * 0.4);
            }
            return moved;
        },
        /** @param {string} dir */
        rotate: (dir) => {
            if (inHitStop()) return;
            send('rotate', { direction: dir });
            juice()?.tilt?.(dir === 'left' ? -0.3 : 0.3);
        },
        softDrop: () => step('drop', { type: 'soft' }, 0, 1),
        hardDrop: () => {
            if (inHitStop()) return;
            send('drop', { type: 'hard' });
            juice()?.dip?.(3);
            juice()?.bounce?.();
        },
    };
}
