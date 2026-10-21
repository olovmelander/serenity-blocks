import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The 2026-10-21 UI audit's fixes, held by the stylesheets themselves.
const STYLES = path.resolve(__dirname, '../../public/styles');
const css = (file) => readFileSync(path.join(STYLES, file), 'utf8');

/** The rule block that starts at `selector` (up to its closing brace at column 0). */
function block(source, selector) {
    const start = source.indexOf(selector);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return source.slice(start, source.indexOf('\n}', start));
}

describe('keystone UI guards', () => {
    it('lays the main menu out by text size: breakpoints in em, the list in rem', () => {
        const menu = css('keystone-menu.css');
        const queries = menu.match(/^@media[^{]*/gm);
        expect(queries.length).toBeGreaterThan(8);
        for (const query of queries) {
            // Pixels only as the short-window floor beside the em conditions.
            const px = query.match(/\d+px/g) || [];
            expect(px.every((value) => value === '648px' || value === '649px'), query).toBe(true);
        }
        expect(menu).toContain('grid-template-columns: minmax(17.5rem, 23.75rem) minmax(0, 1fr);');
        expect(menu).toContain('@media (max-width: 56.25em), (max-height: 33.75em), (max-height: 648px) {');
    });

    it('draws every sheet on a solid panel, so nothing behind reads through it', () => {
        const sheets = [
            [css('keystone-modals.css'), ':is(#settings-modal, #high-scores-modal, #demo-browser-modal, #game-over-modal, #demo-complete-modal) > .modal-content::before {'],
            [css('keystone-multiplayer.css'), '.sb-mp-screen .sb-mp-sheet__panel {'],
            [css('keystone-overlays.css'), '.sb-ody-sheet__panel {'],
        ];
        for (const [source, selector] of sheets) {
            const fill = block(source, selector).match(/linear-gradient\([^;]*;/)?.[0] || '';
            expect(fill, selector).toMatch(/rgb\(/);
            expect(fill, selector).not.toMatch(/rgba\(/);
        }
    });

    it('hangs the menu\'s toasts from the top while the stage stands beside the list', () => {
        const toasts = css('keystone-multiplayer.css');
        const rule = block(toasts, '@media (min-width: 56.3125em) and (min-height: 33.8125em) and (min-height: 649px) {');
        expect(rule).toContain('body.start-modal-open .sb-toast-region');
        expect(rule).toContain('bottom: auto;');
    });
});
