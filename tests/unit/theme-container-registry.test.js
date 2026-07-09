/**
 * Plan §2.7 — registry-owned theme-container creation.
 * 62 themes relied on hand-written static divs in index.html; chiral-gold
 * proved a forgotten div silently breaks a theme. ensureThemeContainer makes
 * the registry the owner: existing divs win, missing ones lazy-create.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ensureThemeContainer, getThemeIds } from '../../src/themes/theme-registry.js';

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
        expect(created).toHaveLength(0);
    });

    it('lazily creates a missing container with the chiral-gold base styles', () => {
        const { body } = fakeDom();
        const container = ensureThemeContainer('forest');
        expect(container.id).toBe('forest-theme');
        expect(container.className).toBe('theme-container');
        expect(container.style.position).toBe('fixed');
        expect(container.style.zIndex).toBe('-1');
        expect(body.children[0]).toBe(container);
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

    it('works for every registered theme id', () => {
        fakeDom();
        for (const id of getThemeIds()) {
            const container = ensureThemeContainer(id);
            expect(container?.id).toBe(`${id}-theme`);
        }
    });
});
