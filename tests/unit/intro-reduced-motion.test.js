import {
    afterEach, beforeEach, describe, expect, it,
} from 'vitest';

/**
 * Regression: the 3D cinematic intro ignored prefers-reduced-motion entirely,
 * forcing parallax + a particle storm + a whiteout on vestibular-sensitive
 * users, even though the boot warp it wraps already honored the OS preference.
 *
 * The intro must now suppress the animated background for reduced-motion users
 * (the OS `prefers-reduced-motion` preference, matching the boot warp):
 * showBackgroundOnly() must NOT build the WebGPU cinematic, must leave the static
 * DOM menu logo as the identity (startup-intro-skipped stays set), and must
 * report the menu background ready immediately so menu re-entry doesn't stall.
 * (The boot-time skip itself lives in main.js's skipIntro gate.)
 */

describe('intro reduced-motion gating', () => {
    let introAnimation;
    let reduceMatches;
    const saved = {};

    beforeEach(async () => {
        reduceMatches = false;
        for (const g of ['window', 'document', 'CustomEvent']) saved[g] = globalThis[g];

        globalThis.CustomEvent = function CustomEvent(type, opts) {
            const ev = new Event(type);
            ev.detail = opts?.detail;
            return ev;
        };
        const win = new EventTarget();
        win.location = { search: '' };
        win.matchMedia = (q) => ({ matches: q.includes('reduce') ? reduceMatches : false, media: q });
        globalThis.window = win;

        const bodyClasses = new Set(['startup-intro-skipped']);
        globalThis.document = {
            body: {
                classList: {
                    add: (c) => bodyClasses.add(c),
                    remove: (c) => bodyClasses.delete(c),
                    contains: (c) => bodyClasses.has(c),
                },
                contains: () => false,
            },
        };

        ({ introAnimation } = await import('../../src/ui/intro-animation.js'));
        introAnimation.container = null;
    });

    afterEach(() => {
        introAnimation.container = null;
        for (const g of ['window', 'document', 'CustomEvent']) globalThis[g] = saved[g];
    });

    it('reflects the OS prefers-reduced-motion preference', () => {
        expect(introAnimation._prefersReducedMotion()).toBe(false);
        reduceMatches = true;
        expect(introAnimation._prefersReducedMotion()).toBe(true);
    });

    it('showBackgroundOnly does not build the cinematic and keeps the static logo', async () => {
        reduceMatches = true;
        let bgReady = false;
        window.addEventListener('intro:menuBgReady', () => { bgReady = true; }, { once: true });

        await introAnimation.showBackgroundOnly();

        expect(introAnimation.container).toBeNull(); // no WebGPU container built
        expect(document.body.classList.contains('startup-intro-skipped')).toBe(true); // static logo stays
        expect(bgReady).toBe(true); // menu re-entry doesn't stall on the timeout
    });
});
