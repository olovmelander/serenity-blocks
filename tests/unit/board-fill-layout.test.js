/**
 * The board's share of the window (keystone-overlays.css :root): every mode's well stands at
 * --sb-board-fill of the height it could fill, never shorter than --sb-board-floor, so the
 * theme shows round it. The solo well applies it in CSS (keystone-solo.css, with Odyssey's
 * overrides in keystone-overlays.css); both versus stages read the same tokens in JS, whose
 * defaults (BOARD_FILL) must match them.
 */
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { BOARD_FILL } from '../../src/ui/local-versus-layout.js';

const sheet = (name) => postcss.parse(readFileSync(new URL(`../../public/styles/${name}`, import.meta.url), 'utf8'));
const overlays = sheet('keystone-overlays.css');
const solo = sheet('keystone-solo.css');

/** Every declaration of `prop` in a sheet, with the media it sits in. */
const declarations = (root, prop) => {
    const found = [];
    root.walkDecls(prop, (decl) => {
        const media = decl.parent?.parent?.type === 'atrule' ? decl.parent.parent.params : '';
        found.push({ selector: decl.parent.selector, media, value: decl.value });
    });
    return found;
};

describe('the board\'s share of the window', () => {
    it('declares the share and the floor once on :root, as BOARD_FILL holds them', () => {
        const fill = declarations(overlays, '--sb-board-fill');
        const floor = declarations(overlays, '--sb-board-floor');
        expect(fill.find((d) => d.selector === ':root' && !d.media)?.value).toBe(String(BOARD_FILL.fill));
        expect(floor.find((d) => d.selector === ':root' && !d.media)?.value).toBe(`${BOARD_FILL.floor}px`);
        expect(BOARD_FILL.fill).toBeLessThan(1);
    });

    it('gives portrait screens the whole height', () => {
        const portrait = declarations(overlays, '--sb-board-fill')
            .find((d) => d.media.includes('max-aspect-ratio: 1/1'));
        expect(portrait?.value).toBe('1');
    });

    it('sizes the solo well from its share of the room', () => {
        const [boardH] = declarations(solo, '--sp-board-h');
        expect(boardH.value).toContain('var(--sb-board-fill');
        expect(boardH.value).toContain('var(--sb-board-floor');
        const widths = [...declarations(solo, '--board-width'), ...declarations(overlays, '--board-width')]
            .filter((d) => d.value.includes('--sp-board'));
        expect(widths.length).toBeGreaterThan(0);
        widths.forEach((d) => expect(d.value, d.selector).toContain('var(--sp-board-h)'));
    });

    it('measures the room from the tray, never from --sp-top, which follows the board (a cycle)', () => {
        const chain = ['--sp-board-h-room', '--sp-board-h', '--board-width', '--board-height', '--sp-column-h'];
        [solo, overlays].forEach((root) => chain.forEach((prop) => {
            declarations(root, prop).forEach((d) => expect(d.value, `${d.selector} ${prop}`).not.toContain('--sp-top'));
        }));
        const [top] = declarations(solo, '--sp-top');
        expect(top.value).toContain('var(--sp-head)');
        expect(top.value).toContain('var(--sp-column-h)');
    });

    it('drops the old card\'s frost, which blurred the theme round the queue', () => {
        let value;
        solo.walkRules((rule) => {
            if (rule.selector.endsWith('#single-player-container .single-player-card')) {
                rule.walkDecls('backdrop-filter', ({ value: v }) => { value = v; });
            }
        });
        expect(value).toBe('none');
    });
});
