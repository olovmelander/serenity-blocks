/**
 * Plan §2.7 — registry-owned theme-container creation.
 * 62 themes relied on hand-written static divs in index.html; chiral-gold
 * proved a forgotten div silently breaks a theme. ensureThemeContainer makes
 * the registry the owner: existing divs win, missing ones lazy-create.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
    ensureThemeContainer, getThemeIds, getThemeMeta, resolveThemeId,
} from '../../src/themes/theme-registry.js';

const savedDocument = globalThis.document;
afterEach(() => {
    globalThis.document = savedDocument;
});

function fakeDom({ existing = {} } = {}) {
    const created = [];
    const body = {
        firstChild: null,
        children: [],
        insertBefore(node) { this.children.unshift(node); this.firstChild = this.children[0]; },
        appendChild(node) { this.children.push(node); this.firstChild = this.children[0]; },
    };
    globalThis.document = {
        body,
        getElementById: (id) => existing[id] || created.find((n) => n.id === id) || null,
        createElement: (tag) => {
            const node = { tag, id: '', className: '', style: {} };
            created.push(node);
            return node;
        },
    };
    return { body, created };
}

describe('ensureThemeContainer (plan §2.7)', () => {
    it('returns the existing static div untouched when present', () => {
        const staticDiv = { id: 'forest-theme', className: 'theme-container', style: {} };
        const { created } = fakeDom({ existing: { 'forest-theme': staticDiv } });
        expect(ensureThemeContainer('forest')).toBe(staticDiv);
        expect(staticDiv.__themeRegistryOwned).toBe(true);
        expect(created).toHaveLength(0);
    });

    it('lazily creates a missing container with the chiral-gold base styles', () => {
        const { body } = fakeDom();
        const container = ensureThemeContainer('forest');
        expect(container.id).toBe('forest-theme');
        expect(container.className).toBe('theme-container');
        expect(container.style.position).toBe('fixed');
        expect(container.style.zIndex).toBe('-1');
        expect(container.__themeRegistryOwned).toBe(true);
        expect(body.children[0]).toBe(container);
    });

    it('never hides a lazily created container inline, so `.active` can reveal it', () => {
        // parhelion and serenity-warp have no static div. An inline opacity:0 beat the
        // `.theme-container.active` rule: after a hidden boot pre-warm, resume() added
        // `.active` and the theme still rendered into an invisible container.
        fakeDom();
        for (const id of ['parhelion', 'serenity-warp']) {
            const container = ensureThemeContainer(id);
            expect(container.className).toBe('theme-container');
            expect(container.style).not.toHaveProperty('opacity');
            expect(container.style).not.toHaveProperty('visibility');
        }
    });

    it('is idempotent — second call returns the first creation', () => {
        fakeDom();
        const first = ensureThemeContainer('ocean');
        const second = ensureThemeContainer('ocean');
        expect(second).toBe(first);
    });

    it('rejects unknown theme ids and non-DOM environments', () => {
        fakeDom();
        expect(ensureThemeContainer('not-a-theme')).toBe(null);
        globalThis.document = undefined;
        expect(ensureThemeContainer('forest')).toBe(null);
    });

    it('retires Bioluminescence II without aliasing its ownership to the original theme', () => {
        const { created } = fakeDom();
        expect(getThemeIds()).not.toContain('bioluminescence-2');
        expect(getThemeMeta('bioluminescence-2')).toBeUndefined();
        expect(resolveThemeId('bioluminescence-2')).toBe('bioluminescence-2');
        expect(ensureThemeContainer('bioluminescence-2')).toBe(null);
        expect(created).toHaveLength(0);
        expect(getThemeMeta('bioluminescence')).toMatchObject({ id: 'bioluminescence' });
        expect(ensureThemeContainer('bioluminescence')?.id).toBe('bioluminescence-theme');
    });

    it('works for every registered theme id', () => {
        fakeDom();
        for (const id of getThemeIds()) {
            const container = ensureThemeContainer(id);
            expect(container?.id).toBe(`${id}-theme`);
        }
    });
});
