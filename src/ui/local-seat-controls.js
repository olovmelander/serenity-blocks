/**
 * @fileoverview How each local versus seat plays, in words and keycaps — shared by the
 * setup sheet (local-match-config-modal.js) and the in-game plates and controls card
 * (local-versus-hud.js).
 *
 * Seats 1 and 2 play on the keyboard (Settings → Controls: arrows and WASD by default)
 * or on controllers 1 and 2; seats 3 and 4 on controllers 3 and 4.
 */

/** Bot skill names, 1–10. */
export const BOT_SKILL_TIERS = [
    'Rookie', 'Novice', 'Learner', 'Steady', 'Skilled',
    'Sharp', 'Expert', 'Master', 'Ace', 'Machine',
];

const KEY_NAMES = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ' ': 'Space',
    Space: 'Space',
    Shift: 'Shift',
    Control: 'Ctrl',
    Enter: 'Enter',
};

/** A key as printed on a keycap. */
export function keyName(key) {
    if (!key) return '';
    if (KEY_NAMES[key]) return KEY_NAMES[key];
    return key.length === 1 ? key.toUpperCase() : key;
}

/** The keyboard layout a player uses, in a few words. */
export function keyboardScheme(bindings = {}) {
    const moves = [bindings.moveLeft, bindings.moveRight, bindings.softDrop];
    if (moves.join() === 'ArrowLeft,ArrowRight,ArrowDown') return 'Arrow keys';
    if (moves.map((k) => String(k || '').toLowerCase()).join() === 'a,d,s') return 'WASD';
    return `Keys ${[bindings.moveLeft, bindings.moveRight].map(keyName).join(' ')}`.trim();
}

/** Standard-mapping button names, by index (12–15: the D-pad's directions). */
const PAD_BUTTONS = [
    'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu',
    'L3', 'R3', '↑', '↓', '←', '→',
];

const KEY_BINDINGS = ['keyBindings', 'player2KeyBindings'];
const PAD_BINDINGS = ['gamepadBindings', 'player2GamepadBindings', 'player3GamepadBindings', 'player4GamepadBindings'];
/** The defaults, when no settings are at hand (Settings → Controls). */
const DEFAULT_KEYS = [
    {
        moveLeft: 'ArrowLeft',
        moveRight: 'ArrowRight',
        rotateRight: 'ArrowUp',
        rotateLeft: 'z',
        softDrop: 'ArrowDown',
        hardDrop: 'Space',
    },
    {
        moveLeft: 'a', moveRight: 'd', rotateRight: 'w', rotateLeft: 'q', softDrop: 's', hardDrop: 'Shift',
    },
];

/**
 * How a seat plays, for its in-game plate: "Arrow keys", "WASD", "Controller 3" or
 * "Bot · Master".
 * @param {number} index seat (0–3)
 * @param {{ kind?: string, difficulty?: number }} slot
 * @param {object} settings
 */
export function versusControls(index, slot = {}, settings = {}) {
    if (slot.kind === 'bot') {
        const tier = BOT_SKILL_TIERS[(Number(slot.difficulty) || 1) - 1];
        return tier ? `Bot · ${tier}` : 'Bot';
    }
    const keys = settings?.[KEY_BINDINGS[index]] || DEFAULT_KEYS[index];
    return keys ? keyboardScheme(keys) : `Controller ${index + 1}`;
}

/**
 * How a human seat plays, for the setup sheet: keys and the controller that also
 * drives it ("Arrow keys · Controller 1"), or the controller alone.
 * @param {number} index seat (0–3)
 * @param {object} settings
 */
export function seatSetupControls(index, settings = {}) {
    const keys = settings?.[KEY_BINDINGS[index]] || DEFAULT_KEYS[index];
    const pad = `Controller ${index + 1}`;
    return keys ? `${keyboardScheme(keys)} · ${pad}` : pad;
}

/**
 * The controls card's rows: [action, keys].
 * @returns {Array<[string, string[]]>}
 */
export function versusCoachRows(index, settings = {}) {
    const keys = settings?.[KEY_BINDINGS[index]] || DEFAULT_KEYS[index];
    if (keys) {
        return [
            ['Move', [keys.moveLeft, keys.moveRight].map(keyName)],
            ['Turn', [keys.rotateRight, keys.rotateLeft].map(keyName)],
            ['Drop', [keys.softDrop, keys.hardDrop].map(keyName)],
        ];
    }
    const pad = settings?.[PAD_BINDINGS[index]] || {};
    const button = (b, fallback) => PAD_BUTTONS[b] || fallback;
    // Moving on the D-pad reads as one cap; its ↓ then reads as the D-pad's too.
    const dpadMove = [pad.moveLeft ?? 14, pad.moveRight ?? 15].join() === '14,15';
    return [
        ['Move', dpadMove ? ['D-pad'] : [button(pad.moveLeft, '←'), button(pad.moveRight, '→')]],
        ['Turn', [button(pad.rotateRight, 'A'), button(pad.rotateLeft, 'Y')]],
        ['Drop', [button(pad.softDrop, '↓'), button(pad.hardDrop, 'B')]],
    ];
}
