import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createFailureModal } from '../../src/ui/odyssey/FailureModal.js';

function createElement(tagName) {
    const listeners = new Map();
    return {
        tagName,
        children: [],
        className: '',
        dataset: {},
        id: '',
        innerHTML: '',
        textContent: '',
        style: {},
        remove: vi.fn(),
        addEventListener: vi.fn((type, listener) => {
            listeners.set(type, listener);
        }),
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        dispatch(type, event = {}) {
            listeners.get(type)?.(event);
        },
    };
}

function collectMarkup(element) {
    return [
        element.textContent,
        element.innerHTML,
        ...element.children.map(collectMarkup),
    ].join(' ');
}

function findByText(element, text) {
    if (element.textContent === text) return element;
    for (const child of element.children) {
        const match = findByText(child, text);
        if (match) return match;
    }
    return null;
}

function createModal(options = {}) {
    return createFailureModal({
        attemptNumber: 3,
        onChoose: vi.fn(),
        reasonText: 'Time ran out!',
        ...options,
    });
}

describe('Odyssey failure modal result compatibility', () => {
    beforeEach(() => {
        vi.stubGlobal('document', {
            addEventListener: vi.fn(),
            createElement: vi.fn(createElement),
            removeEventListener: vi.fn(),
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('marks an experimental failure unranked without changing Retry behavior', () => {
        const onChoose = vi.fn();
        const modal = createModal({ includeLegacyResults: false, onChoose });
        const markup = collectMarkup(modal);
        const retry = findByText(modal, 'Retry');
        const map = findByText(modal, 'Back to Map');

        expect(markup).toContain('Experimental Session · Unranked');
        expect(markup).toContain('this attempt was not recorded');
        expect(markup).toContain('Attempt 3');

        retry.dispatch('click');
        map.dispatch('click');

        expect(onChoose).toHaveBeenCalledOnce();
        expect(onChoose).toHaveBeenCalledWith('retry');
    });

    it('keeps the legacy modal notice-free and preserves Back to Map', () => {
        const onChoose = vi.fn();
        const modal = createModal({ onChoose });
        const markup = collectMarkup(modal);

        expect(markup).not.toContain('Experimental Session · Unranked');
        expect(markup).not.toContain('this attempt was not recorded');

        findByText(modal, 'Back to Map').dispatch('click');

        expect(onChoose).toHaveBeenCalledOnce();
        expect(onChoose).toHaveBeenCalledWith('map');
    });

    it('explains the lost duel and that Retry starts a fresh frag score', () => {
        const modal = createModal({ results: { duel: { playerFrags: 4, botFrags: 7, targetFrags: 7 } } });
        expect(collectMarkup(modal)).toContain('Final frags: 4–7. First to 7 wins. Retry begins at 0–0.');
    });

    it('lets the next mode receive keys when a removed failure sheet is still registered', () => {
        const onChoose = vi.fn();
        const modal = createModal({ onChoose });
        const handler = document.addEventListener.mock.calls.find(([name]) => name === 'keydown')[1];
        modal.isConnected = false;
        const event = { key: ' ', preventDefault: vi.fn(), stopPropagation: vi.fn() };
        handler(event);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(onChoose).not.toHaveBeenCalled();
        expect(document.removeEventListener).toHaveBeenCalledWith('keydown', handler, true);
        expect(modal.remove).toHaveBeenCalledOnce();
    });

    it('disposes cancellation once without choosing Retry or restoring focus later', () => {
        vi.useFakeTimers();
        const onChoose = vi.fn();
        const modal = createModal({ onChoose });
        const retry = findByText(modal, 'Retry');
        retry.focus = vi.fn();
        modal.dispose();
        modal.dispose();
        vi.runAllTimers();
        retry.dispatch('click');
        expect(onChoose).not.toHaveBeenCalled();
        expect(retry.focus).not.toHaveBeenCalled();
        expect(modal.remove).toHaveBeenCalledOnce();
        vi.useRealTimers();
    });
});
