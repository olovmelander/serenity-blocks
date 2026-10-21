import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    createOdysseyOrbArt, createOdysseyStarRow, odysseyLevelThemeId, odysseyOrbArtUrl,
} from '../../src/ui/odyssey/odyssey-orb-art.js';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';

// ---- A light DOM: elements with children, attributes, datasets and listeners ----
function createElement(tagName) {
    return {
        tagName,
        children: [],
        attributes: {},
        dataset: {},
        textContent: '',
        className: '',
        innerHTML: '',
        appendChild(child) { this.children.push(child); return child; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        addEventListener: vi.fn(),
    };
}
const nodes = (element) => [element, ...element.children.flatMap(nodes)];
const byClass = (root, className) => nodes(root).filter((node) => node.className.split(' ').includes(className));

describe('Odyssey orb art', () => {
    beforeEach(() => vi.stubGlobal('document', { createElement }));
    afterEach(() => vi.unstubAllGlobals());

    it('resolves a theme to its artwork and nothing for no theme', () => {
        expect(odysseyOrbArtUrl('forest')).toMatch(/forest/);
        expect(odysseyOrbArtUrl(null)).toBeNull();
        expect(odysseyOrbArtUrl('')).toBeNull();
    });

    it('finds an orb’s theme the navigator’s way: icon theme, then path icon, then primary', () => {
        expect(odysseyLevelThemeId({ iconThemeId: 'a', theme: { pathIcon: 'b', primary: 'c' } })).toBe('a');
        expect(odysseyLevelThemeId({ theme: { pathIcon: 'b', primary: 'c' } })).toBe('b');
        expect(odysseyLevelThemeId({ theme: { primary: 'c' } })).toBe('c');
        expect(odysseyLevelThemeId(null)).toBeNull();
        const registry = new LevelRegistry();
        expect(odysseyOrbArtUrl(odysseyLevelThemeId(registry.resolveLevelPresentation(1)))).toBeTruthy();
    });

    it('puts the world in its rings, in the chapter’s light, with the orb’s number', () => {
        const art = createOdysseyOrbArt({
            themeId: 'forest', chapter: 3, state: 'cleared', number: 14,
        });
        expect(art.className).toBe('sb-orb-art');
        expect(art.attributes['aria-hidden']).toBe('true');
        expect(art.dataset).toEqual({ state: 'cleared', odyChapter: '3' });
        expect(byClass(art, 'sb-orb-art__halo')).toHaveLength(1);
        expect(byClass(art, 'sb-orb-art__orbit')).toHaveLength(1);
        const [image] = byClass(art, 'sb-orb-art__image');
        expect(image.src).toMatch(/forest/);
        expect(image.alt).toBe('');
        expect(byClass(art, 'sb-orb-art__number')[0].textContent).toBe('14');
        expect(byClass(art, 'sb-orb-art__lock')).toHaveLength(0);
        expect(byClass(art, 'sb-orb-art__badge')).toHaveLength(0);
    });

    it('shuts a locked orb behind a lock, crowns a boss, marks a rival and can hold its breath', () => {
        const locked = createOdysseyOrbArt({ themeId: 'forest', state: 'locked' });
        expect(byClass(locked, 'sb-orb-art__lock')[0].innerHTML).toContain('<svg');
        const boss = createOdysseyOrbArt({ kind: 'boss', breathe: false, className: 'panel-art' });
        expect(boss.className).toBe('sb-orb-art panel-art');
        expect(boss.dataset.still).toBe('true');
        expect(byClass(boss, 'sb-orb-art__badge--boss')[0].innerHTML).toContain('<svg');
        expect(byClass(boss, 'sb-orb-art__image')).toHaveLength(0);
        const rival = createOdysseyOrbArt({ kind: 'rival' });
        expect(byClass(rival, 'sb-orb-art__badge--rival')[0].textContent).toBe('VS');
    });

    it('draws three stars with the earned ones lit, named when asked', () => {
        const row = createOdysseyStarRow(2, { label: '2 of 3 stars' });
        expect(row.children.map((star) => star.className)).toEqual(['is-earned', 'is-earned', '']);
        expect(row.attributes).toEqual({ role: 'img', 'aria-label': '2 of 3 stars' });
        expect(createOdysseyStarRow(9).children.filter((star) => star.className === 'is-earned')).toHaveLength(3);
        expect(createOdysseyStarRow('x').attributes['aria-hidden']).toBe('true');
    });

    it('builds nothing without a document', () => {
        vi.stubGlobal('document', undefined);
        expect(createOdysseyOrbArt({ themeId: 'forest' })).toBeNull();
        expect(createOdysseyStarRow(1)).toBeNull();
    });
});
