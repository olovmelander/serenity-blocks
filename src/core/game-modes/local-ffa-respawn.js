/**
 * Local versus free-for-all: death and respawn (versus-rules.js, the 'ffa' game type).
 *
 * Deaths arrive already counted by MultiPlayerState (a death each, and the frag to whoever held
 * the frag credit, never to the player themselves). Each board shows its knock-out and drops the
 * garbage waiting for it; nobody else stops and the round goes on. The match goal is checked at
 * once. A person plays again with any of their keys RESPAWN_KEY_HOLD_MS after dying (onSeatPress);
 * a bot comes back on its own after BOT_RESPAWN_MS. The functions take the LocalMultiplayerMode.
 */

import { isBotSlot } from '../ai/local-bot-manager.js';
import { ownsLocalMultiplayerRound } from './local-multiplayer-loop.js';

/**
 * How long after a death a person's keys start to bring them back. A key still held, or mashed,
 * as they topped out must not put them straight back on an empty well.
 */
export const RESPAWN_KEY_HOLD_MS = 1000;
/** How long a bot stays out before it plays again on its own. */
export const BOT_RESPAWN_MS = 1750;
/** A bot's return that fell in a pause is tried again this often until play resumes. */
const RESPAWN_RETRY_MS = 250;

/** The players who are out, until they play again. */
function downPlayers(mode) {
    if (!mode._downPlayers) mode._downPlayers = new Map();
    return mode._downPlayers;
}

/** A seat played by a bot (it comes back on its own; keys never bring it back). */
function isBotSeat(mode, playerIndex) {
    return mode._isBotPlayer(playerIndex) || isBotSlot(mode.matchConfig?.playerSlots?.[playerIndex]);
}

/** Forget one player's way back (and its timer). */
function forgetDownPlayer(mode, playerIndex) {
    const down = mode._downPlayers?.get(playerIndex);
    if (down) clearTimeout(down.timer);
    mode._downPlayers?.delete(playerIndex);
}

/** Forget every way back: the match or round they belong to is over. */
export function forgetDownPlayers(mode) {
    mode._downPlayers?.forEach((down) => clearTimeout(down.timer));
    mode._downPlayers = new Map();
}

/**
 * Free-for-all deaths, already counted by MultiPlayerState.
 * @param {any} mode
 * @param {number[]} playerIndices the players who just died
 * @param {Array<number|null>} creditHolders each player's frag credit holder at death
 * @param {object} roundOwner the round the deaths belong to (local-multiplayer-loop.js)
 * @returns {Promise<boolean>} false when none of them was a new death
 */
export async function handleFreeForAllDeaths(mode, playerIndices, creditHolders, roundOwner) {
    const state = mode.multiplayerState;
    const diedAt = mode._wallNow();
    let anyNew = false;
    playerIndices.forEach((playerIndex) => {
        const player = state.players[playerIndex];
        // One death, one card: the legacy path can report it twice (main.js counts it,
        // then calls _handleGameOver).
        if (!player || player.isAlive || downPlayers(mode).has(playerIndex)) return;
        anyNew = true;
        if (player.currentPiece) player.currentPiece = null;
        state.garbageQueues[playerIndex]?.clear();
        const killer = creditHolders?.[playerIndex];
        mode._showPlayerDeathAnimation(
            playerIndex,
            Number.isInteger(killer) && killer !== playerIndex ? killer : null,
        );
        downPlayers(mode).set(playerIndex, { at: diedAt, roundOwner, timer: null });
        if (isBotSeat(mode, playerIndex)) scheduleBotRespawn(mode, playerIndex, BOT_RESPAWN_MS);
    });
    if (!anyNew) return false;

    const matchEnd = mode._resolveMatchEnd();
    if (matchEnd !== null) await mode._endMatchMidRound(matchEnd, roundOwner);
    return true;
}

/**
 * A key of a seat went down (controls.js, gamepad-controller.js). A person who is out plays
 * again, once RESPAWN_KEY_HOLD_MS have passed since the death.
 * @param {any} mode
 * @param {number} playerIndex
 * @returns {boolean} whether the player came back
 */
export function onSeatPress(mode, playerIndex) {
    const down = mode._downPlayers?.get(playerIndex);
    if (!down || isBotSeat(mode, playerIndex)) return false;
    if (mode._wallNow() - down.at < RESPAWN_KEY_HOLD_MS) return false;
    return respawnPlayer(mode, playerIndex) === 'respawned';
}

/** A bot plays again after `delayMs`; tried again shortly while the game is paused. */
function scheduleBotRespawn(mode, playerIndex, delayMs) {
    const down = mode._downPlayers?.get(playerIndex);
    if (!down) return;
    clearTimeout(down.timer);
    down.timer = setTimeout(() => {
        down.timer = null;
        if (mode._downPlayers?.get(playerIndex) !== down) return;
        if (respawnPlayer(mode, playerIndex) === 'held') scheduleBotRespawn(mode, playerIndex, RESPAWN_RETRY_MS);
    }, delayMs);
}

/**
 * Put a player who is out back in play: an empty well at the match's start level, their score,
 * lines and piece stream kept (MultiPlayerState.respawnPlayer), the knock-out cleared, their bot
 * (if any) reset, and their first piece spawned the way a new round spawns it. Only within the
 * round the death belongs to, never while the match ends.
 * @param {any} mode
 * @param {number} playerIndex
 * @returns {'respawned'|'held'|'gone'} 'held' while the game is paused
 */
export function respawnPlayer(mode, playerIndex) {
    const down = mode._downPlayers?.get(playerIndex);
    if (!down) return 'gone';
    const state = mode.multiplayerState;
    if (
        !state
        || state.isGameOver
        || mode._matchEnding
        || !ownsLocalMultiplayerRound(mode, down.roundOwner)
    ) {
        forgetDownPlayer(mode, playerIndex);
        return 'gone';
    }
    if (mode.isPaused || state.isPaused) return 'held';
    forgetDownPlayer(mode, playerIndex);
    if (!state.respawnPlayer(playerIndex)) return 'gone';

    mode._clearPlayerDeathAnimation(playerIndex);
    mode.botManager?.resetPlayer?.(playerIndex);
    mode.deps?.soundManager?.sfxPlayer?.playDrop?.();
    mode._spawnFirstPiece(playerIndex);
    mode._syncBoardScenes();
    console.log(`[LocalMultiplayer] Player ${playerIndex + 1} plays again`);
    return 'respawned';
}
