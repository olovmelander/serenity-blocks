/**
 * Menus own their keys (2026-10-26): Space and Enter press a menu's focused control
 * instead of hard-dropping, Escape is not taken twice, and the arrow keys walk a menu
 * the way the D-pad does without changing a setting on the way.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { InputController, setupKeyboardControls } from '../../src/ui/controls.js';
import { controlOwnsArrow, handleMenuKey } from '../../src/ui/keyboard-menu-navigation.js';
import { SpatialNavigation } from '../../src/ui/spatial-navigation.js';
import { createKeyboardGameProbes } from '../../src/ui/keyboard-game-probes.js';

function createEventTarget(extra = {}) {
    const listeners = new Map();
    return {
        addEventListener(type, listener) {
            listeners.set(type, [...(listeners.get(type) || []), listener]);
        },
        removeEventListener(type, listener) {
            listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== listener));
        },
        dispatchEvent: vi.fn(),
        ...extra,
    };
}

/** A minimal element: tag, attributes, classes, and where it sits. */
function element(tag, {
    attrs = {}, classes = [], parent = null, contains = () => false,
} = {}) {
    const node = {
        tagName: tag.toUpperCase(),
        parent,
        attrs,
        classList: { contains: (name) => classes.includes(name) },
        getAttribute: (name) => attrs[name] ?? null,
        focus: vi.fn(),
        scrollIntoView: vi.fn(),
        contains,
        matches(selector) {
            return selector.split(',').some((part) => matchesOne(node, part.trim()));
        },
        closest(selector) {
            for (let current = node; current; current = current.parent) {
                if (current.matches(selector)) return current;
            }
            return null;
        },
    };
    return node;
}

function matchesOne(node, selector) {
    const tag = /^[a-z]+/i.exec(selector)?.[0];
    if (tag && node.tagName !== tag.toUpperCase()) return false;
    for (const [, name, value] of selector.matchAll(/\[([a-z-]+)(?:="([^"]*)")?\]/g)) {
        if (value === undefined ? !(name in node.attrs) : node.attrs[name] !== value) return false;
    }
    for (const [, name] of selector.matchAll(/\.([a-z_-]+)/gi)) {
        if (!node.classList.contains(name)) return false;
    }
    return Boolean(tag) || selector.includes('[') || selector.includes('.');
}

function keyEvent(key, extra = {}) {
    return {
        key, code: '', repeat: false, defaultPrevented: false, preventDefault: vi.fn(), ...extra,
    };
}

describe('controlOwnsArrow', () => {
    it('leaves every arrow to text fields', () => {
        const field = element('input', { attrs: { type: 'text' } });
        for (const direction of ['up', 'down', 'left', 'right']) expect(controlOwnsArrow(field, direction)).toBe(true);
        expect(controlOwnsArrow(element('textarea'), 'down')).toBe(true);
    });

    it('gives a slider and a radio only their own axis', () => {
        const slider = element('input', { attrs: { type: 'range' } });
        expect(controlOwnsArrow(slider, 'left')).toBe(true);
        expect(controlOwnsArrow(slider, 'down')).toBe(false);
        expect(controlOwnsArrow(element('input', { attrs: { type: 'radio' } }), 'up')).toBe(false);
        const number = element('input', { attrs: { type: 'number' } });
        expect(controlOwnsArrow(number, 'right')).toBe(true);
        expect(controlOwnsArrow(number, 'up')).toBe(false);
    });

    it('walks past a closed dropdown and a checkbox', () => {
        expect(controlOwnsArrow(element('select'), 'down')).toBe(false);
        expect(controlOwnsArrow(element('input', { attrs: { type: 'checkbox' } }), 'down')).toBe(false);
    });

    it('keeps a tab strip or segmented row on its own axis, a listbox on every arrow', () => {
        const strip = element('div', { attrs: { role: 'tablist' } });
        const tab = element('button', { attrs: { role: 'tab' }, parent: strip });
        expect(controlOwnsArrow(tab, 'right')).toBe(true);
        expect(controlOwnsArrow(tab, 'down')).toBe(false);
        const vertical = element('div', { attrs: { role: 'tablist', 'aria-orientation': 'vertical' } });
        expect(controlOwnsArrow(element('button', { parent: vertical }), 'down')).toBe(true);
        const list = element('div', { attrs: { role: 'listbox' } });
        expect(controlOwnsArrow(element('div', { parent: list }), 'left')).toBe(true);
    });
});

describe('handleMenuKey', () => {
    let sheet;
    let doc;

    beforeEach(() => {
        sheet = element('div', { attrs: { id: 'high-scores-modal' }, classes: ['visible'], contains: () => true });
        sheet.querySelector = () => null;
        sheet.querySelectorAll = () => [];
        doc = {
            body: { classList: { contains: () => false } },
            activeElement: null,
            querySelector: () => null,
            getElementById: (id) => (id === 'high-scores-modal' ? sheet : null),
        };
    });

    afterEach(() => vi.restoreAllMocks());

    it('moves focus to the nearest control that way inside the open sheet', () => {
        const from = element('button');
        const to = element('button');
        doc.activeElement = from;
        const find = vi.spyOn(SpatialNavigation, 'findNextElement').mockReturnValue(to);
        const event = keyEvent('ArrowDown');

        expect(handleMenuKey(event, doc)).toBe(true);
        expect(find).toHaveBeenCalledWith(from, 'down', sheet);
        expect(to.focus).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
    });

    it('stands aside for a key another handler took, and for a control that uses it', () => {
        doc.activeElement = element('input', { attrs: { type: 'range' } });
        const find = vi.spyOn(SpatialNavigation, 'findNextElement');
        expect(handleMenuKey(keyEvent('ArrowLeft'), doc)).toBe(false);
        expect(handleMenuKey(keyEvent('ArrowDown', { defaultPrevented: true }), doc)).toBe(false);
        expect(find).not.toHaveBeenCalled();
    });

    it('keeps a dropdown value when nothing lies further that way', () => {
        doc.activeElement = element('select');
        vi.spyOn(SpatialNavigation, 'findNextElement').mockReturnValue(null);
        const event = keyEvent('ArrowDown');
        expect(handleMenuKey(event, doc)).toBe(false);
        expect(event.preventDefault).toHaveBeenCalled();
    });

    it('turns a toggle with Enter, as A does', () => {
        const box = element('input', { attrs: { type: 'checkbox' } });
        box.click = vi.fn();
        doc.activeElement = box;
        expect(handleMenuKey(keyEvent('Enter'), doc)).toBe(true);
        expect(box.click).toHaveBeenCalledOnce();
    });

    it('does nothing in play, where the arrows are the game\'s', () => {
        sheet.classList = { contains: () => false };
        doc.activeElement = element('button');
        const find = vi.spyOn(SpatialNavigation, 'findNextElement');
        expect(handleMenuKey(keyEvent('ArrowDown'), doc)).toBe(false);
        expect(find).not.toHaveBeenCalled();
    });
});

describe('gameplay keys stand aside for menus', () => {
    let documentStub;

    function harness(gameActionsExtra = {}) {
        const settings = {
            keyBindings: {
                moveLeft: 'ArrowLeft',
                moveRight: 'ArrowRight',
                rotateRight: 'ArrowUp',
                rotateLeft: 'z',
                flip: 'a',
                softDrop: 'ArrowDown',
                hardDrop: 'Space',
            },
            player2KeyBindings: {},
            dasDelay: 100,
            dasInterval: 20,
        };
        window.settings = settings;
        const controller = new InputController();
        const gameActions = {
            requestMove: vi.fn(),
            requestRotate: vi.fn(),
            requestSoftDrop: vi.fn(),
            requestHardDrop: vi.fn(),
            openSettingsMenu: vi.fn(),
            startGame: vi.fn(),
            initSound: vi.fn(),
            ...gameActionsExtra,
        };
        setupKeyboardControls(controller, settings, gameActions);
        return { controller, gameActions };
    }

    beforeEach(() => {
        documentStub = createEventTarget({
            activeElement: null,
            hidden: false,
            body: { classList: { contains: () => false } },
            getElementById: () => null,
        });
        vi.stubGlobal('document', documentStub);
        vi.stubGlobal('window', createEventTarget({ settings: null }));
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('lets Space press a button on an open sheet instead of hard-dropping', () => {
        const records = { classList: { contains: (name) => name === 'visible' }, inert: false };
        documentStub.getElementById = (id) => (id === 'high-scores-modal' ? records : null);
        const { controller, gameActions } = harness();
        const space = keyEvent(' ');

        controller.handleKeyDown(space);

        expect(gameActions.requestHardDrop).not.toHaveBeenCalled();
        expect(space.preventDefault).not.toHaveBeenCalled();
    });

    it('gives Space and Enter to a focused control when no piece is in play', () => {
        documentStub.activeElement = element('input', { attrs: { type: 'checkbox' } });
        const { controller, gameActions } = harness({ isGameplayLive: () => false });

        controller.handleKeyDown(keyEvent(' '));
        expect(gameActions.requestHardDrop).not.toHaveBeenCalled();

        const live = harness({ isGameplayLive: () => true });
        live.controller.handleKeyDown(keyEvent(' '));
        expect(live.gameActions.requestHardDrop).toHaveBeenCalledOnce();
    });

    it('does not open Settings on an Escape that was already taken, or that the mode keeps', () => {
        const { controller, gameActions } = harness();
        controller.handleKeyDown(keyEvent('Escape', { defaultPrevented: true }));
        expect(gameActions.openSettingsMenu).not.toHaveBeenCalled();

        const serenity = harness({ modeOwnsEscape: () => true });
        serenity.controller.handleKeyDown(keyEvent('Escape'));
        expect(serenity.gameActions.openSettingsMenu).not.toHaveBeenCalled();

        controller.handleKeyDown(keyEvent('Escape'));
        expect(gameActions.openSettingsMenu).toHaveBeenCalledOnce();
    });
});

describe('keyboard game probes', () => {
    it('answers who plays seat 2, whether a piece is in play and who keeps Escape', () => {
        const mode = {
            isRunning: true,
            getModeId: () => 'local-multiplayer',
            multiplayerState: { players: [{}, {}], isPaused: false, isGameOver: false },
            _isBotPlayer: (index) => index === 1,
        };
        const probes = createKeyboardGameProbes({ gameModeManager: { getCurrentMode: () => mode } });
        expect(probes.isPlayer2KeyboardActive()).toBe(false);
        mode._isBotPlayer = () => false;
        expect(probes.isPlayer2KeyboardActive()).toBe(true);
        expect(probes.isGameplayLive()).toBe(true);
        mode.multiplayerState.isPaused = true;
        expect(probes.isGameplayLive()).toBe(false);

        const map = {
            isRunning: true, getModeId: () => 'odyssey', levelRunStarted: false, gameState: { currentPiece: {} },
        };
        expect(createKeyboardGameProbes({ gameModeManager: { getCurrentMode: () => map } }).isGameplayLive()).toBe(false);

        const serenity = { isRunning: true, getModeId: () => 'serenity', keyFor: () => 'Escape' };
        const serenityProbes = createKeyboardGameProbes({ gameModeManager: { getCurrentMode: () => serenity } });
        expect(serenityProbes.modeOwnsEscape()).toBe(true);
        serenity.keyFor = () => 'q';
        expect(serenityProbes.modeOwnsEscape()).toBe(false);
    });
});
