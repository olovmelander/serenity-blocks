/**
 * The bootstrap error box shows the message as text and offers a restart (audit
 * 2026-10-13: BOOT-02). It used to put the message into innerHTML and point players at
 * a browser console that release builds do not have.
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { showStartupErrorBox } from '../../src/ui/startup-error-box.js';

function fakeElement(tagName) {
    const listeners = {};
    return {
        tagName,
        style: {},
        attributes: {},
        children: [],
        textContent: '',
        setAttribute(name, value) { this.attributes[name] = value; },
        append(...nodes) { this.children.push(...nodes); },
        appendChild(node) { this.children.push(node); },
        addEventListener(type, listener) { listeners[type] = listener; },
        click() { listeners.click?.(); },
        focus: vi.fn(),
    };
}

afterEach(() => vi.unstubAllGlobals());

describe('showStartupErrorBox', () => {
    it('shows the message as text with a focused Restart that reloads', () => {
        const body = fakeElement('body');
        const reload = vi.fn();
        vi.stubGlobal('document', { body, createElement: fakeElement });
        vi.stubGlobal('window', { location: { reload } });

        const box = showStartupErrorBox(new Error('<img src=x onerror=alert(1)>'));

        expect(body.children).toEqual([box]);
        expect(box.attributes.role).toBe('alert');
        const [title, message, restart] = box.children;
        expect(title.textContent).toBe('Failed to Start Game');
        expect(message.textContent).toBe('<img src=x onerror=alert(1)>');
        expect(box).not.toHaveProperty('innerHTML');
        expect(restart.textContent).toBe('Restart');
        expect(restart.focus).toHaveBeenCalledOnce();
        restart.click();
        expect(reload).toHaveBeenCalledOnce();
    });

    it('names a thrown non-Error value', () => {
        vi.stubGlobal('document', { body: fakeElement('body'), createElement: fakeElement });
        vi.stubGlobal('window', { location: { reload: vi.fn() } });
        expect(showStartupErrorBox('init timed out').children[1].textContent).toBe('init timed out');
    });
});
