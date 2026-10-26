/**
 * Quit for the desktop game (src/ui/desktop-quit.js): offered only where the desktop shell can
 * close the game, and it takes two presses, so a stray press never closes it.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    QUIT_CONFIRM_MS, QUIT_CONFIRM_TEXT, armTwoPressQuit, canQuitDesktop, requestDesktopQuit,
} from '../../src/ui/desktop-quit.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Just what the helper touches: events, a class list and a label. */
function makeButton(text = 'Quit game') {
    const button = new EventTarget();
    const classes = new Set();
    button.classList = {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
    };
    const label = { textContent: text };
    const press = () => button.dispatchEvent(new Event('click'));
    const blur = () => button.dispatchEvent(new Event('blur'));
    return {
        button, label, press, blur,
    };
}

describe('desktop quit', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('is offered only where the desktop bridge can invoke', () => {
        expect(canQuitDesktop({ electronAPI: { invoke: () => null } })).toBe(true);
        expect(canQuitDesktop({ electronAPI: {} })).toBe(false);
        expect(canQuitDesktop({})).toBe(false);
        expect(canQuitDesktop(undefined)).toBe(false);
    });

    it('asks the shell to quit and never throws, even when the bridge refuses', async () => {
        const invoke = vi.fn(() => Promise.resolve());
        await requestDesktopQuit({ electronAPI: { invoke } });
        expect(invoke).toHaveBeenCalledWith('desktop:quit');

        const refuses = { electronAPI: { invoke: () => { throw new Error('IPC channel not allowed'); } } };
        await expect(requestDesktopQuit(refuses)).resolves.toBeUndefined();
        await expect(requestDesktopQuit({ electronAPI: { invoke: () => Promise.reject(new Error('x')) } }))
            .resolves.toBeUndefined();
        await expect(requestDesktopQuit(undefined)).resolves.toBeUndefined();
    });

    it('arms on the first press and quits on the second', () => {
        const quit = vi.fn();
        const { button, label, press } = makeButton();
        const control = armTwoPressQuit(button, { label, quit });

        press();
        expect(quit).not.toHaveBeenCalled();
        expect(control.isArmed()).toBe(true);
        expect(button.classList.contains('is-confirming')).toBe(true);
        expect(label.textContent).toBe(QUIT_CONFIRM_TEXT);

        press();
        expect(quit).toHaveBeenCalledTimes(1);
        expect(control.isArmed()).toBe(false);
        expect(label.textContent).toBe('Quit game');
    });

    it('disarms after a few seconds, when focus leaves, and on request', () => {
        const quit = vi.fn();
        const {
            button, label, press, blur,
        } = makeButton('Quit');
        const control = armTwoPressQuit(button, { label, quit });

        press();
        vi.advanceTimersByTime(QUIT_CONFIRM_MS - 1);
        expect(control.isArmed()).toBe(true);
        vi.advanceTimersByTime(1);
        expect(control.isArmed()).toBe(false);
        expect(label.textContent).toBe('Quit');
        press();
        expect(quit).not.toHaveBeenCalled();

        blur();
        expect(control.isArmed()).toBe(false);
        press();
        control.disarm();
        press();
        expect(quit).not.toHaveBeenCalled();
        expect(control.isArmed()).toBe(true);
    });

    it('wired again after its signal aborts, one press still only arms', () => {
        const quit = vi.fn();
        const { button, label, press } = makeButton();
        const first = new AbortController();
        armTwoPressQuit(button, { label, quit, signal: first.signal });
        press();
        first.abort();
        expect(button.classList.contains('is-confirming')).toBe(false);
        expect(label.textContent).toBe('Quit game');

        armTwoPressQuit(button, { label, quit, signal: new AbortController().signal });
        press();
        expect(quit).not.toHaveBeenCalled();
        expect(label.textContent).toBe(QUIT_CONFIRM_TEXT);
        press();
        expect(quit).toHaveBeenCalledTimes(1);
    });

    it('ends the pause strip with a hidden Quit game that the desktop build reveals', () => {
        const html = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
        const start = html.indexOf('<section class="settings-pause"');
        const strip = html.slice(start, html.indexOf('</section>', start));
        const buttons = [...strip.matchAll(/<button type="button" id="([a-z-]+)"([^>]*)>/g)];
        const last = buttons[buttons.length - 1];
        expect(last[1]).toBe('settings-quit-btn');
        expect(last[2]).toMatch(/\bhidden\b/);
        expect(strip.slice(strip.indexOf('id="settings-quit-btn"')))
            .toMatch(/<use href="#sb-ico-power"><\/use><\/svg><span>Quit game<\/span>/);

        const settings = readFileSync(path.join(repoRoot, 'src/ui/settings.js'), 'utf8');
        expect(settings).toMatch(/if \(quit && canQuitDesktop\(\)\) \{\s*quit\.hidden = false;/);
        expect(settings).toMatch(/armTwoPressQuit\(quit, \{ label, signal \}\)/);
    });
});
