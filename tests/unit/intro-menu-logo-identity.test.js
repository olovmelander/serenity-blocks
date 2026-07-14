import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

/**
 * Regression: the main menu showed the "Serenity Blocks" title twice after
 * skipping the intro and then entering/leaving a mode (e.g. Local Multiplayer).
 *
 * When the intro is skipped, `body.startup-intro-skipped` is set and CSS keeps
 * the static DOM `.main-menu-logo` visible as the menu identity. On return to
 * the menu, `showBackgroundOnly()` re-creates the animated cinematic title as
 * the logo — but the stale `startup-intro-skipped` class kept the static logo
 * visible too, so both rendered at once. `showBackgroundOnly()` must clear that
 * class whenever the cinematic title becomes the live menu logo again.
 */

function makeClassList(initial = []) {
    const set = new Set(initial);
    return {
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        contains: (c) => set.has(c),
    };
}

function installFakeDocument(container) {
    const body = {
        classList: makeClassList(['startup-intro-skipped']),
        contains: (node) => node === container,
    };
    globalThis.document = { body };
    return body;
}

describe('intro menu-logo identity (duplicate header fix)', () => {
    let introAnimation;
    const originalDocument = globalThis.document;

    beforeEach(async () => {
        ({ introAnimation } = await import('../../src/ui/intro-animation.js'));
    });

    afterEach(() => {
        globalThis.document = originalDocument;
        vi.restoreAllMocks();
    });

    it('clears startup-intro-skipped when reviving the cinematic menu logo', () => {
        const titleContainer = { classList: makeClassList() };
        const container = {
            classList: makeClassList(),
            style: { display: 'none', removeProperty: () => {} },
            querySelector: (sel) => (sel === '.intro-title-container' ? titleContainer : null),
        };
        const body = installFakeDocument(container);

        introAnimation.container = container;
        introAnimation.threeRenderer = null;
        // Stub the render/audio side-effects so we exercise only the DOM/state path.
        vi.spyOn(introAnimation, 'scheduleMenuLogoLayoutUpdate').mockImplementation(() => {});
        vi.spyOn(introAnimation, 'setLoadingState').mockImplementation(() => {});
        vi.spyOn(introAnimation, 'ensureIntroMusic').mockImplementation(() => {});
        vi.spyOn(introAnimation, 'setRendererPhase').mockImplementation(() => {});
        vi.spyOn(introAnimation, 'startRenderLoop').mockImplementation(() => {});
        vi.spyOn(introAnimation, 'installTetrominoPointerListener').mockImplementation(() => {});

        expect(body.classList.contains('startup-intro-skipped')).toBe(true);

        introAnimation.showBackgroundOnly();

        // The cinematic title is live again → static DOM logo must be hidden.
        expect(body.classList.contains('startup-intro-skipped')).toBe(false);
        expect(titleContainer.classList.contains('shrink-to-logo')).toBe(true);

        introAnimation.container = null;
    });

    it('_claimMenuLogoIdentity removes the terminal skip flag', () => {
        const body = installFakeDocument(null);
        expect(body.classList.contains('startup-intro-skipped')).toBe(true);
        introAnimation._claimMenuLogoIdentity();
        expect(body.classList.contains('startup-intro-skipped')).toBe(false);
    });
});
