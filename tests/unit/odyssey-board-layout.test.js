import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { mountOdysseyBoardLayout } from '../../src/ui/odyssey/odyssey-board-layout.js';

function host() {
    const attributes = new Set();
    return {
        dataset: {},
        hasAttribute: (name) => attributes.has(name),
        removeAttribute: vi.fn((name) => attributes.delete(name)),
        toggleAttribute: vi.fn((name, on) => {
            if (on) attributes.add(name);
            else attributes.delete(name);
        }),
    };
}

function options(mechanics = { board: { rows: 20 }, pieces: { previewCount: 5 } }) {
    return { stage: host(), container: host(), levelConfig: { mechanics } };
}

afterEach(() => vi.unstubAllGlobals());

describe('Odyssey shared gameplay layout ownership', () => {
    it('opts into the canonical solo well and retires stale danger/floor state', () => {
        const value = options();
        value.stage.toggleAttribute('data-danger', true);
        value.container.toggleAttribute('data-off-floor', true);
        mountOdysseyBoardLayout(value);
        expect(value.stage.dataset).toEqual({ board: 'well', odysseyBoard: 'standard', odysseyPreviews: '3' });
        expect(value.stage.hasAttribute('data-danger')).toBe(false);
        expect(value.container.hasAttribute('data-off-floor')).toBe(false);
    });

    it('keeps three previews across authored tower and duel layouts', () => {
        const value = options({ board: { rows: 100 }, pieces: { previewCount: 2 } });
        const layout = mountOdysseyBoardLayout(value);
        expect(value.stage.dataset.odysseyBoard).toBe('tower');
        expect(value.stage.dataset.odysseyPreviews).toBe('3');
        layout.update({ mechanics: { board: { rows: 20 }, versus: { fragsToWin: 7 }, previewCount: 4 } });
        expect(value.stage.dataset.odysseyBoard).toBe('duel');
        expect(value.stage.dataset.odysseyPreviews).toBe('3');
    });

    it('lets the shared observers own their flags until explicit reset', () => {
        const value = options();
        const layout = mountOdysseyBoardLayout(value);
        value.stage.toggleAttribute('data-danger', true);
        value.container.toggleAttribute('data-off-floor', true);
        layout.update();
        expect(value.stage.hasAttribute('data-danger')).toBe(true);
        expect(value.container.hasAttribute('data-off-floor')).toBe(true);
        layout.update({ danger: false, offFloor: false });
        expect(value.stage.hasAttribute('data-danger')).toBe(false);
        expect(value.container.hasAttribute('data-off-floor')).toBe(false);
    });

    it('fences retired handles before the replacement attempt or next mode can be styled', () => {
        const value = options();
        const previous = mountOdysseyBoardLayout(value);
        const replacement = mountOdysseyBoardLayout({ ...value, mechanics: { board: { rows: 100 } } });
        previous.update({ danger: true, mechanics: { versus: {} } });
        previous.cleanup();
        expect(value.stage.dataset.odysseyBoard).toBe('tower');
        expect(value.stage.dataset.board).toBe('well');
        expect(value.stage.hasAttribute('data-danger')).toBe(false);
        replacement.cleanup();
        value.stage.dataset.board = 'well'; // Single Player now owns this same stage.
        replacement.cleanup();
        replacement.update({ danger: true });
        expect(value.stage.dataset.board).toBe('well');
        expect(value.stage.dataset.odysseyBoard).toBeUndefined();
        expect(value.stage.hasAttribute('data-danger')).toBe(false);
    });

    it('cleans the Odyssey attributes without changing other presentation ownership', () => {
        const value = options();
        value.stage.dataset.theme = 'aurora';
        const layout = mountOdysseyBoardLayout(value);
        layout.update({ danger: true, offFloor: true });
        layout.cleanup();
        expect(value.stage.dataset).toEqual({ theme: 'aurora' });
        expect(value.container.hasAttribute('data-off-floor')).toBe(false);
    });

    it('resolves the production DOM but safely no-ops before a gameplay stage exists', () => {
        const value = options();
        vi.stubGlobal('document', { querySelector: () => value.stage, getElementById: () => value.container });
        mountOdysseyBoardLayout({ levelConfig: value.levelConfig });
        expect(value.stage.dataset.board).toBe('well');
        vi.stubGlobal('document', undefined);
        const missing = mountOdysseyBoardLayout();
        expect(() => { missing.update(); missing.cleanup(); }).not.toThrow();
    });
});

describe('Odyssey well presentation constraints', () => {
    const css = postcss.parse(readFileSync(new URL('../../public/styles/keystone-overlays.css', import.meta.url), 'utf8'));
    const scoped = ".single-player-stage[data-board='well'][data-odyssey-board]";
    const declarations = (selector, property) => {
        const values = [];
        css.walkRules(selector, (rule) => rule.walkDecls(property, (decl) => values.push(decl.value)));
        return values;
    };

    it('fits the three preview tiles into the shared queue without old fixed-card width', () => {
        expect(declarations(`${scoped} #single-player-container .player-next-pieces`, 'min-width')).toContain('0');
        expect(declarations(`${scoped} #single-player-container .player-next-piece`, 'flex')).toContain('1 1 0');
        expect(declarations(`${scoped} #single-player-card`, 'padding')).toContain('0');
    });

    it('gives the real minimap a definite board-sized box and overrides legacy inline positioning', () => {
        const selector = `${scoped} #infinity-minimap.infinity-minimap`;
        expect(declarations(selector, 'height')).toEqual(['var(--board-height)', 'var(--board-height)']);
        css.walkRules(selector, (rule) => {
            rule.walkDecls(/^(position|top)$/, (decl) => expect(decl.important).toBe(true));
        });
        expect(declarations(scoped, '--sp-board-h-room').join(' ')).toContain('var(--sp-vh)');
    });

    it('moves the short-landscape ledger beside the board without a mobile time overlay', () => {
        const landscape = css.nodes.find((node) => node.type === 'atrule'
            && node.params.includes('max-height: 600px') && node.params.includes('min-aspect-ratio: 1/1'));
        const values = {};
        landscape.walkDecls((decl) => { values[`${decl.parent.selector}:${decl.prop}`] = decl.value; });
        expect(values[`${scoped}:--sp-bottom`]).toBe('16px');
        expect(values[`${scoped} #odyssey-hud .objective-section:padding-right`]).toBe('0');
        expect(values[`${scoped} #odyssey-hud .time-section:position`]).toBe('static');
    });
});
