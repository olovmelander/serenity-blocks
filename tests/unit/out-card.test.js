/**
 * The online knock-out card (src/ui/keystone/out-card.js): "Out", who did it, a
 * note — the anatomy of local versus's card. It keeps the `death-overlay` class,
 * the marker the online mode and the watch manager look for.
 */
import { describe, expect, it, vi } from 'vitest';
import { createOutCard, createStatusCard, showOutCard } from '../../src/ui/keystone/out-card.js';

function fakeDoc() {
    const make = () => {
        const classes = new Set();
        const el = {
            children: [],
            style: {},
            attrs: {},
            textContent: '',
            set className(value) { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
            get className() { return [...classes].join(' '); },
            classList: {
                add: (name) => classes.add(name),
                contains: (name) => classes.has(name),
            },
            setAttribute(name, value) { this.attrs[name] = value; },
            appendChild(child) { this.children.push(child); return child; },
        };
        return el;
    };
    return { createElement: vi.fn(make) };
}

describe('createOutCard', () => {
    it('says Out, who did it and what happens next', () => {
        const card = createOutCard(fakeDoc(), { cause: 'By Ada', note: 'Watching until the round ends' });
        expect(card.className).toBe('death-overlay sb-out');
        expect(card.attrs.role).toBe('status');
        expect(card.children.map((c) => [c.className, c.textContent])).toEqual([
            ['sb-out__title', 'Out'],
            ['sb-out__cause', 'By Ada'],
            ['sb-out__note', 'Watching until the round ends'],
        ]);
    });

    it('has a compact form for opponent tiles and leaves out empty lines', () => {
        const card = createOutCard(fakeDoc(), { cause: 'Topped out', compact: true });
        expect(card.className).toBe('death-overlay sb-out sb-out--compact');
        expect(card.children.map((c) => c.textContent)).toEqual(['Out', 'Topped out']);
    });

    it('sets names as text, never as markup', () => {
        const card = createOutCard(fakeDoc(), { cause: 'By <img src=x onerror=alert(1)>' });
        expect(card.children[1].textContent).toBe('By <img src=x onerror=alert(1)>');
        expect(card.children[1].innerHTML).toBeUndefined();
    });
});

describe('createStatusCard', () => {
    it('says a late joiner plays next round in aqua, never as Out', () => {
        const card = createStatusCard(fakeDoc(), {
            title: 'Next round', note: 'Joined mid-match', compact: true, tone: 'aqua', marker: 'waiting-overlay',
        });
        expect(card.className).toBe('waiting-overlay sb-out sb-out--compact sb-out--aqua');
        expect(card.className).not.toContain('death-overlay');
        expect(card.children.map((c) => c.textContent)).toEqual(['Next round', 'Joined mid-match']);
    });

    it('says a dropped connection in slate', () => {
        const card = createStatusCard(fakeDoc(), {
            title: 'Offline', cause: 'Connection lost', tone: 'slate', marker: 'disconnect-overlay',
        });
        expect(card.className).toBe('disconnect-overlay sb-out sb-out--slate');
        expect(card.attrs.role).toBe('status');
    });

    it('uses words, never emoji', () => {
        const emoji = /\p{Extended_Pictographic}/u;
        [
            createOutCard(fakeDoc(), { cause: 'Topped out', note: 'Watching until the round ends' }),
            createStatusCard(fakeDoc(), { title: 'Next round', note: 'Joined mid-match', tone: 'aqua' }),
            createStatusCard(fakeDoc(), { title: 'Offline', cause: 'Connection lost', tone: 'slate' }),
        ].forEach((card) => card.children.forEach((c) => expect(emoji.test(c.textContent)).toBe(false)));
    });
});

describe('showOutCard', () => {
    it('anchors the card over the board and lets it rise on the next frame', () => {
        let raise = null;
        const view = {
            getComputedStyle: () => ({ position: 'static' }),
            requestAnimationFrame: (cb) => { raise = cb; },
        };
        const container = { ownerDocument: { defaultView: view }, style: {}, appendChild: vi.fn() };
        const card = createOutCard(fakeDoc(), { cause: 'By Ada' });
        showOutCard(container, card);
        expect(container.style.position).toBe('relative');
        expect(container.appendChild).toHaveBeenCalledWith(card);
        expect(card.classList.contains('is-shown')).toBe(false);
        raise();
        expect(card.classList.contains('is-shown')).toBe(true);
    });

    it('shows at once without a window to animate in', () => {
        const container = { ownerDocument: null, style: {}, appendChild: vi.fn() };
        const card = createOutCard(fakeDoc(), {});
        showOutCard(container, card);
        expect(card.classList.contains('is-shown')).toBe(true);
    });
});
