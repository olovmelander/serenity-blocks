import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoBrowser } from '../../src/ui/demo-browser.js';

function fixture() {
    let resolveDelete;
    const deletion = new Promise((resolve) => { resolveDelete = resolve; });
    const deleteButton = {};
    const nextButton = { focus: vi.fn() };
    const classes = new Set(['visible']);
    vi.stubGlobal('document', { activeElement: deleteButton });
    const browser = Object.assign(Object.create(DemoBrowser.prototype), {
        refreshGeneration: 0,
        modal: {
            contains: (element) => element === deleteButton,
            classList: { contains: (value) => classes.has(value), remove: (value) => classes.delete(value) },
        },
        listContainer: { querySelector: () => nextButton },
        demoManager: { deleteDemo: vi.fn(() => deletion) },
        refreshList: vi.fn(async () => {}),
        setStatus: vi.fn(),
    });
    return { browser, nextButton, resolveDelete };
}

afterEach(() => vi.unstubAllGlobals());

describe('replay deletion focus ownership', () => {
    it('does not focus a hidden replay sheet when deletion finishes after close', async () => {
        const { browser, nextButton, resolveDelete } = fixture();
        const deleting = browser.deleteDemo(7);
        browser.hide();
        const menuButton = {};
        document.activeElement = menuButton;
        resolveDelete();
        await deleting;
        expect(browser.demoManager.deleteDemo).toHaveBeenCalledWith(7);
        expect(nextButton.focus).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(menuButton);
    });

    it('restores focus to the next replay when the sheet stays open', async () => {
        const { browser, nextButton, resolveDelete } = fixture();
        const deleting = browser.deleteDemo(7);
        resolveDelete();
        await deleting;
        expect(nextButton.focus).toHaveBeenCalledWith({ preventScroll: true });
    });
});
