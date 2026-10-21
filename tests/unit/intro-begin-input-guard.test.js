/**
 * The input that begins the intro never chooses on the menu it reveals: a held Enter's
 * auto-repeat, the click that follows a tap, or a quick second click landed on a mode card
 * that was still fading in from nothing and launched that mode.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { MENU_ARRIVAL_GUARD_MS, guardMenuArrival } from '../../src/ui/intro-begin-input-guard.js';
import { IntroAnimation } from '../../src/ui/intro-animation.js';

function input(type, props = {}) {
    return Object.assign(new Event(type, { cancelable: true }), props);
}

describe('the begin input is held back from the arriving menu', () => {
    let now;
    let target;
    let menu;
    const send = (event) => {
        target.dispatchEvent(event);
        return event;
    };

    beforeEach(() => {
        vi.useFakeTimers();
        now = 1000;
        target = new EventTarget();
        menu = vi.fn();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // Window capture runs before every menu listener; registering after the guard models that.
    const arm = (beginEvent) => {
        const release = guardMenuArrival(beginEvent, { target, now: () => now });
        ['click', 'keydown'].forEach((type) => target.addEventListener(type, menu));
        return release;
    };
    const advance = (ms) => {
        now += ms;
        vi.advanceTimersByTime(ms);
    };

    it('swallows a second click while the menu fades in, then lets clicks through', () => {
        arm(input('click'));
        advance(250);
        expect(send(input('click')).defaultPrevented).toBe(true);
        expect(menu).not.toHaveBeenCalled();
        advance(MENU_ARRIVAL_GUARD_MS);
        send(input('click'));
        expect(menu).toHaveBeenCalledTimes(1);
    });

    it('keeps swallowing a burst of clicks that began before the menu arrived', () => {
        arm(input('click'));
        for (let i = 0; i < 6; i++) {
            advance(300); // clicking on through the arrival, ~3 per second
            send(input('click'));
        }
        expect(menu).not.toHaveBeenCalled();
        advance(400); // the player pauses, sees the menu, and chooses
        send(input('click'));
        expect(menu).toHaveBeenCalledTimes(1);
    });

    it('swallows the click that follows the tap that began, however long the press', () => {
        arm(input('touchstart'));
        advance(MENU_ARRIVAL_GUARD_MS + 500); // a slow press outlasts the arrival window
        send(input('touchend'));
        advance(330); // the click follows the release
        send(input('click'));
        expect(menu).not.toHaveBeenCalled();
        advance(400);
        send(input('click'));
        expect(menu).toHaveBeenCalledTimes(1);
    });

    it('latches a held begin key until it is released', () => {
        arm(input('keydown', { key: 'Enter', code: 'Enter' }));
        for (let i = 0; i < 6; i++) {
            advance(250);
            send(input('keydown', { key: 'Enter', code: 'Enter', repeat: true }));
        }
        expect(menu).not.toHaveBeenCalled();
        send(input('keyup', { key: 'Enter', code: 'Enter' }));
        send(input('keydown', { key: 'Enter', code: 'Enter' }));
        expect(menu).toHaveBeenCalledTimes(1);
    });

    it('swallows Enter and Space only while the menu arrives, and never other keys', () => {
        arm(input('keydown', { key: 'a', code: 'KeyA' }));
        send(input('keyup', { key: 'a', code: 'KeyA' }));
        advance(200);
        send(input('keydown', { key: ' ', code: 'Space' }));
        send(input('keydown', { key: 'ArrowDown', code: 'ArrowDown' }));
        expect(menu).toHaveBeenCalledTimes(1);
        advance(MENU_ARRIVAL_GUARD_MS);
        send(input('keydown', { key: ' ', code: 'Space' }));
        expect(menu).toHaveBeenCalledTimes(2);
    });

    it('lets a fresh press of the begin key through when its release was missed', () => {
        arm(input('keydown', { key: 'Enter', code: 'Enter' }));
        advance(MENU_ARRIVAL_GUARD_MS + 100);
        send(input('keydown', { key: 'Enter', code: 'Enter' })); // not a repeat: a new press
        expect(menu).toHaveBeenCalledTimes(1);
    });

    it('stops listening once the menu has arrived and nothing is held', () => {
        const remove = vi.spyOn(target, 'removeEventListener');
        arm(input('click'));
        advance(MENU_ARRIVAL_GUARD_MS);
        expect(remove).toHaveBeenCalledWith('click', expect.any(Function), { capture: true });
    });

    it('keeps listening while the begin key is held past the arrival', () => {
        const remove = vi.spyOn(target, 'removeEventListener');
        arm(input('keydown', { key: 'Enter', code: 'Enter' }));
        advance(MENU_ARRIVAL_GUARD_MS * 3);
        expect(remove).not.toHaveBeenCalled();
        send(input('keyup', { key: 'Enter', code: 'Enter' }));
        expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });
    });
});

describe('the intro arms the guard when it begins', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('holds back the input that began from the menu it reveals', () => {
        const intro = new IntroAnimation();
        const target = new EventTarget();
        vi.stubGlobal('window', target);
        intro.isActive = true;
        intro.interactionEnabled = true;
        intro.dismissText = vi.fn();
        intro.handleInteraction(input('keydown', { key: 'Enter', code: 'Enter' }));
        const menu = vi.fn();
        target.addEventListener('keydown', menu);
        target.dispatchEvent(input('keydown', { key: 'Enter', code: 'Enter', repeat: true }));
        expect(menu).not.toHaveBeenCalled();
        intro.reset();
        target.dispatchEvent(input('keydown', { key: 'Enter', code: 'Enter', repeat: true }));
        expect(menu).toHaveBeenCalledTimes(1);
    });
});
