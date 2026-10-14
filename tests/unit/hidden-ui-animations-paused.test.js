import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Hidden UI must not animate. Modals, the floating menu buttons, the main-menu player card and inactive
 * theme containers hide with opacity 0 / visibility hidden, which does NOT stop CSS animations: their
 * infinite idles restyled (and, for SVG transforms, re-laid out) the page every frame of every game,
 * about 2 ms of main thread per frame (main-thread trace, 2026-10-14: style recalc 41-58 ms/s, layout
 * 35-40 ms/s; after the pause 4 and ~0). Each hidden root pauses its descendants' animations until shown.
 */

const css = readFileSync(new URL('../../public/styles/main.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** The declarations of the rule whose selector list contains `selector`. */
function ruleFor(selector) {
    const at = css.indexOf(selector);
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
}

describe('hidden UI pauses its CSS animations', () => {
    it.each([
        '.modal:not(.visible) *',
        '.replays-icon:not(.visible) *',
        '.highscores-icon:not(.visible) *',
        '.main-menu-player-card:not(.visible) *',
        '.theme-container:not(.active) *',
    ])('%s', (selector) => {
        expect(ruleFor(selector)).toMatch(/animation-play-state:\s*paused\s*!important/);
    });

    it('the roots show through the classes the rules key on', () => {
        // If a root stops showing through .visible / .active, its rule would pause it while shown.
        expect(css).toContain('.modal.visible {');
        expect(css).toContain('.theme-container.active {');
    });
});
