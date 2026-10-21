import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createFailureModal } from '../../src/ui/odyssey/FailureModal.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';

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

function findByClass(element, className) {
    if (element.className === className) return element;
    for (const child of element.children) {
        const match = findByClass(child, className);
        if (match) return match;
    }
    return null;
}

function findAllByClass(element, className) {
    return [
        ...(element.className === className ? [element] : []),
        ...element.children.flatMap((child) => findAllByClass(child, className)),
    ];
}

function findByRole(element, role) {
    if (element.role === role) return element;
    for (const child of element.children) {
        const match = findByRole(child, role);
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

    it('shows the lost duel as a scoreboard and that Retry starts a fresh frag score', () => {
        const modal = createModal({
            results: { duel: { playerFrags: 4, botFrags: 7, targetFrags: 7 } },
            levelConfig: getLevelById(1),
            metrics: { lines: 18 },
        });
        const markup = collectMarkup(modal);
        const score = findByClass(modal, 'sb-ody-duel');
        expect(score.ariaLabel).toBe('Knockouts: you 4, The rival 7. First to 7 wins.');
        expect(markup).toContain('Knockouts · first to 7 wins');
        expect(markup).toContain('Retry begins at 0–0.');
        const frags = findAllByClass(modal, 'sb-ody-duel__frags').map((node) => node.textContent);
        expect(frags).toEqual(['4', '7']);
        const cells = findAllByClass(modal, 'sb-ody-duel__cells')
            .map((row) => row.children.filter((cell) => cell.className === 'is-filled').length);
        expect(cells).toEqual([4, 7]);
        expect(findByRole(modal, 'progressbar')).toBeNull();
    });

    it('names the rival from the orb when the duel result does not', () => {
        const rivalOrb = {
            id: 10, name: 'Wave Runner', chapter: 2, mechanics: { versus: { botName: 'Coral' } },
        };
        const modal = createModal({
            results: { duel: { playerFrags: 1, botFrags: 3, targetFrags: 3 } },
            levelConfig: rivalOrb,
            reasonText: 'Coral reached 3 knockouts first.',
        });
        expect(findByClass(modal, 'sb-ody-duel').ariaLabel).toBe('Knockouts: you 1, Coral 3. First to 3 wins.');
        expect(findByClass(modal, 'sb-orb-art sb-ody-outcome__orb').dataset.kind).toBe('rival');
    });

    it('makes the orb the hero: its world, its name as the title and the reason as the outcome', () => {
        const modal = createModal({ levelConfig: getLevelById(1), metrics: { lines: 18 }, failureReason: 'top-out' });
        const art = findByClass(modal, 'sb-orb-art sb-ody-outcome__orb');
        expect(art.dataset).toMatchObject({ state: 'failed', odyChapter: '1' });
        expect(modal.dataset.odyChapter).toBe('1');
        expect(findByClass(modal, 'sb-eyebrow sb-ody-eyebrow').textContent).toBe('Orb 1 · Earth Core · Attempt 3');
        expect(findByClass(modal, 'sb-ody-title').textContent).toBe(getLevelById(1).name);
        expect(findByClass(modal, 'sb-ody-outcome__line').textContent).toBe('Time ran out.');
        // The actions sit alone in the footer row: sheet-input.js finds Retry first, Back to Map last.
        const footer = findByClass(modal, 'sb-ody-outcome__footer');
        const actions = findByClass(footer, 'sb-ody-actions');
        expect(actions.children.map((node) => node.textContent)).toEqual(['Retry', 'Back to Map']);
        expect(findByClass(findByClass(modal, 'sb-ody-outcome sb-ody-outcome--art'), 'sb-ody-actions')).toBeNull();
    });

    it('keeps the reason as the title when no orb is known', () => {
        const modal = createModal();
        expect(findByClass(modal, 'sb-ody-title').textContent).toBe('Time ran out.');
        expect(findByClass(modal, 'sb-ody-outcome__line')).toBeNull();
        expect(findByClass(modal, 'sb-ody-outcome__hero')).toBeNull();
        expect(findByClass(modal, 'sb-eyebrow sb-ody-eyebrow').textContent).toBe('Attempt 3');
    });

    it('shows the main-goal shortfall and preserves unranked keyboard retry', () => {
        const onChoose = vi.fn();
        const modal = createModal({
            levelConfig: getLevelById(1),
            metrics: { lines: 18 },
            failureReason: 'top-out',
            includeLegacyResults: false,
            onChoose,
        });
        const markup = collectMarkup(modal);
        const progress = findByRole(modal, 'progressbar');
        // The attempt's number as a figure over its target.
        const value = findByClass(modal, 'sb-ody-debrief__value');
        expect(value.children.map((node) => node.textContent)).toEqual(['18', '/ 20 lines']);
        expect(progress.ariaValueText).toContain('18 / 20 lines');
        expect(markup).toContain('2 lines short of the goal.');
        expect(markup).toContain('Next attempt');
        expect(markup).toContain('Experimental Session · Unranked');
        expect(progress.ariaValueNow).toBe('18');
        expect(progress.ariaValueMax).toBe('20');
        expect(progress.children[0].style.width).toBe('90%');
        const handler = document.addEventListener.mock.calls.find(([name]) => name === 'keydown')[1];
        const event = { key: 'r', preventDefault: vi.fn(), stopPropagation: vi.fn() };
        handler(event);
        findByText(modal, 'Retry').dispatch('click');
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('retry');
        expect(event.preventDefault).toHaveBeenCalledOnce();
    });

    it('labels an over-target failure honestly and bounds its accessible progress', () => {
        const modal = createModal({
            levelConfig: getLevelById(49),
            metrics: { score: 36033 },
            failureReason: 'top-out',
        });
        const progress = findByRole(modal, 'progressbar');
        expect(collectMarkup(modal)).toContain('The final total met the target, but the orb was not cleared.');
        expect(progress.ariaValueNow).toBe('36000');
        expect(progress.ariaValueMax).toBe('36000');
        expect(progress.ariaValueText).toContain((36033).toLocaleString());
        expect(progress.ariaValueText).toContain('orb was not cleared');
        expect(progress.children[0].style.width).toBe('100%');
    });

    it('keeps Back to Map usable when progress data is unavailable', () => {
        const onChoose = vi.fn();
        const modal = createModal({
            levelConfig: getLevelById(1), metrics: { lines: NaN }, onChoose,
        });
        expect(findByRole(modal, 'progressbar')).toBeNull();
        expect(collectMarkup(modal)).not.toMatch(/NaN|undefined/);
        const map = findByText(modal, 'Back to Map');
        document.activeElement = map;
        const handler = document.addEventListener.mock.calls.find(([name]) => name === 'keydown')[1];
        const event = { key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() };
        handler(event);
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(onChoose).not.toHaveBeenCalled();
        map.dispatch('click');
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('map');
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

    it('leaves Escape and Enter to Settings when Settings is open over the sheet', () => {
        // Audit 2026-10-18: Escape meant to close Settings chose "Back to map" underneath, and
        // Enter on a Settings control started a retry.
        const onChoose = vi.fn();
        createModal({ onChoose });
        const settingsVisible = { classList: { contains: (name) => name === 'visible' } };
        document.getElementById = vi.fn((id) => (id === 'settings-modal' ? settingsVisible : null));
        const handler = document.addEventListener.mock.calls.find(([name]) => name === 'keydown')[1];
        for (const key of ['Escape', 'Enter', 'r']) {
            const event = { key, preventDefault: vi.fn(), stopPropagation: vi.fn() };
            handler(event);
            expect(event.stopPropagation).not.toHaveBeenCalled();
        }
        expect(onChoose).not.toHaveBeenCalled();

        settingsVisible.classList.contains = () => false; // Settings closed: the sheet's keys again
        handler({ key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() });
        expect(onChoose).toHaveBeenCalledExactlyOnceWith('map');
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
