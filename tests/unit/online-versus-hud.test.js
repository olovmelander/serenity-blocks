/**
 * Online versus' stage chrome (src/ui/online-versus-hud.js): your plate leads with the
 * number that decides the match, the bar says the goal, the round and who is still in, a
 * banner says who took each round while the host's beat holds, and the match won puts a
 * crest over the winner's well before the results. Words, never emoji.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    OnlineVersusHud, ROUND_BANNER_MS, ROUND_START_MS, STAGE_LEAVE_MS, VICTORY_BEAT_MS, VICTORY_BEAT_REDUCED_MS,
} from '../../src/ui/online-versus-hud.js';
import { ROUND_OVER_BEAT_MS } from '../../src/core/multiplayer/ffa-round-policy.js';
import { describeGoal } from '../../src/ui/components/mp-sheet.js';

const EMOJI = /\p{Extended_Pictographic}/u;

/** A minimal DOM: ids, classes, a tree, and the few calls the HUD makes. */
function makeDom() {
    const nodes = [];
    function el(tag = 'div', { id = '', className = '' } = {}) {
        const classes = new Set(String(className).split(/\s+/).filter(Boolean));
        const node = {
            tag,
            id,
            children: [],
            parentElement: null,
            textContent: '',
            hidden: false,
            dataset: {},
            attrs: {},
            offsetWidth: 100,
            style: { props: {}, setProperty(name, value) { this.props[name] = value; } },
            classList: {
                add: (...names) => names.forEach((n) => classes.add(n)),
                remove: (...names) => names.forEach((n) => classes.delete(n)),
                toggle: (n, on = !classes.has(n)) => {
                    if (on) classes.add(n); else classes.delete(n);
                    return on;
                },
                contains: (n) => classes.has(n),
            },
            get className() { return [...classes].join(' '); },
            set className(value) {
                classes.clear();
                String(value).split(/\s+/).filter(Boolean).forEach((n) => classes.add(n));
            },
            setAttribute(name, value) { node.attrs[name] = value; },
            appendChild(child) {
                child.parentElement = node;
                node.children.push(child);
                return child;
            },
            replaceChildren(...kids) {
                node.children.splice(0).forEach((kid) => { kid.parentElement = null; });
                kids.forEach((kid) => node.appendChild(kid));
            },
            remove() {
                const parent = node.parentElement;
                if (parent) parent.children.splice(parent.children.indexOf(node), 1);
                node.parentElement = null;
            },
            closest(selector) {
                const wanted = selector.split(',').map((s) => s.trim().replace(/^\./, ''));
                for (let at = node; at; at = at.parentElement) {
                    if (wanted.some((n) => at.classList.contains(n))) return at;
                }
                return null;
            },
            querySelectorAll(selector) {
                const cls = selector.replace(/^\./, '');
                const out = [];
                const walk = (n) => n.children.forEach((c) => {
                    if (c.classList.contains(cls)) out.push(c);
                    walk(c);
                });
                walk(node);
                return out;
            },
        };
        nodes.push(node);
        return node;
    }

    const stage = el('div', { id: 'online-multiplayer-container' });
    const card = stage.appendChild(el('div', { id: 'online-player-card', className: 'player-card' }));
    const wrapper = card.appendChild(el('div', { className: 'player-board-wrapper' }));
    ['ov-plate-name', 'ov-plate-value', 'ov-plate-unit', 'ov-meta-a-label', 'ov-meta-a',
        'ov-meta-b-label', 'ov-meta-b'].forEach((id) => card.appendChild(el('span', { id })));
    const bar = stage.appendChild(el('div', { id: 'ov-match-bar' }));
    ['ov-match-goal', 'ov-match-round', 'ov-match-alive'].forEach((id) => bar.appendChild(el('span', { id })));
    const field = stage.appendChild(el('div', { id: 'watch-grid' }));
    const tile = field.appendChild(el('div', { className: 'opponent-mini-board' }));
    const frame = tile.appendChild(el('div', { className: 'opponent-grid-frame' }));

    const find = (root, test) => {
        if (test(root)) return root;
        for (const child of root.children) {
            const hit = find(child, test);
            if (hit) return hit;
        }
        return null;
    };
    const doc = {
        defaultView: { innerWidth: 1600, innerHeight: 900 },
        getElementById: (id) => find(stage, (n) => n.id === id),
        createElement: (tag) => el(tag),
    };
    return {
        doc, stage, card, wrapper, tile, frame,
    };
}

const texts = (node) => node.children.map((c) => c.textContent);
const byId = (dom, id) => dom.doc.getElementById(id);

let reduced = false;

beforeEach(() => {
    reduced = false;
    vi.useFakeTimers();
    vi.stubGlobal('window', {
        innerWidth: 1600,
        innerHeight: 900,
        matchMedia: () => ({ matches: reduced }),
    });
    vi.stubGlobal('document', { documentElement: {} });
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('online versus HUD: your numbers', () => {
    it('leads your plate with the number that decides the match', () => {
        const dom = makeDom();
        const hud = new OnlineVersusHud(dom.doc);
        const state = { frags: 3, lines: 12, score: 4200 };

        hud.updateStats(state, 'frags');
        expect(byId(dom, 'ov-plate-value').textContent).toBe('3');
        expect(byId(dom, 'ov-plate-unit').textContent).toBe('Frags');
        expect(byId(dom, 'ov-meta-a-label').textContent).toBe('Lines');
        expect(byId(dom, 'ov-meta-a').textContent).toBe('12');
        expect(byId(dom, 'ov-meta-b-label').textContent).toBe('Score');
        expect(byId(dom, 'ov-meta-b').textContent).toBe((4200).toLocaleString());

        hud.updateStats(state, 'lines');
        expect(byId(dom, 'ov-plate-value').textContent).toBe('12');
        expect(byId(dom, 'ov-plate-unit').textContent).toBe('Lines');
        expect(byId(dom, 'ov-meta-a-label').textContent).toBe('Frags');

        hud.updateStats(state, 'points');
        expect(byId(dom, 'ov-plate-value').textContent).toBe((4200).toLocaleString());
        expect(byId(dom, 'ov-plate-unit').textContent).toBe('Points');
    });

    it('tells the goal, the round and who is still in', () => {
        const dom = makeDom();
        const hud = new OnlineVersusHud(dom.doc);
        const players = [
            { isAlive: true }, { isAlive: false }, { isAlive: true }, { isAlive: false, awaitingSpawn: true },
        ];
        hud.updateMatchBar(players, players.length, { endCondition: 'frags', endConditionValue: 5 }, 2);
        expect(byId(dom, 'ov-match-goal').textContent).toBe(describeGoal('frags', 5));
        expect(byId(dom, 'ov-match-round').textContent).toBe('Round 2');
        // A late joiner waiting for the next round is not counted either way.
        expect(byId(dom, 'ov-match-alive').textContent).toBe('2 of 3 in');
        expect(byId(dom, 'ov-match-alive').hidden).toBe(false);

        hud.updateMatchBar([{ isAlive: true }], 1, { endCondition: 'lines', endConditionValue: 40 }, 1);
        expect(byId(dom, 'ov-match-goal').textContent).toBe(describeGoal('lines', 40));
        expect(byId(dom, 'ov-match-alive').hidden).toBe(true);
    });
});

describe('online versus HUD: the stage', () => {
    it('lays the stage out once per window and roster, and hands the field its size', () => {
        const dom = makeDom();
        const hud = new OnlineVersusHud(dom.doc);
        const field = { setFieldLayout: vi.fn() };

        hud.layout(3, field);
        expect(dom.stage.dataset.arrangement).toBe('center');
        expect(dom.stage.style.props['--ov-block']).toMatch(/px$/);
        expect(dom.card.style.props['--board-width']).toMatch(/px$/);
        expect(field.setFieldLayout).toHaveBeenCalledTimes(1);
        const [size] = field.setFieldLayout.mock.calls[0];
        expect(size.rows * size.columns).toBeGreaterThanOrEqual(3);
        expect(size.block).toBeGreaterThan(0);

        hud.layout(3, field);
        expect(field.setFieldLayout).toHaveBeenCalledTimes(1);
        hud.layout(5, field);
        expect(field.setFieldLayout).toHaveBeenCalledTimes(2);
    });
});

describe('online versus HUD: the round', () => {
    it('says who took the round, and is gone before the next one starts', () => {
        const dom = makeDom();
        const hud = new OnlineVersusHud(dom.doc);
        expect(ROUND_BANNER_MS).toBeLessThan(ROUND_OVER_BEAT_MS);

        hud.announceRound(2, { name: 'Mika', color: '#22d3ee', isYou: false });
        const banner = byId(dom, 'ov-round-banner');
        expect(banner.parentElement).toBe(dom.stage);
        expect(banner.classList.contains('is-shown')).toBe(true);
        expect(banner.attrs.role).toBe('status');
        expect(texts(banner)).toEqual(['Round 2', 'Mika', 'takes the round']);
        expect(banner.classList.contains('ov-round--long')).toBe(false);
        expect(banner.style.props['--round-color']).toBe('#22d3ee');

        vi.advanceTimersByTime(ROUND_BANNER_MS);
        expect(banner.classList.contains('is-shown')).toBe(false);
    });

    it('keeps a long name whole, set smaller', () => {
        const dom = makeDom();
        const hud = new OnlineVersusHud(dom.doc);
        hud.announceRound(3, { name: 'Wintermute_Longname_99', isYou: false });
        const banner = byId(dom, 'ov-round-banner');
        expect(texts(banner)).toEqual(['Round 3', 'Wintermute_Longname_99', 'takes the round']);
        expect(banner.classList.contains('ov-round--long')).toBe(true);
    });

    it('speaks to you when you took it, and calls a draw a draw', () => {
        const dom = makeDom();
        const hud = new OnlineVersusHud(dom.doc);
        hud.announceRound(3, { name: 'Me', color: '#ffac88', isYou: true });
        expect(texts(byId(dom, 'ov-round-banner'))).toEqual(['Round 3', 'You take it', 'Next round in a moment']);
        hud.announceRound(4, null);
        const banner = byId(dom, 'ov-round-banner');
        expect(texts(banner)).toEqual(['Round 4', 'A draw']);
        expect(banner.style.props['--round-color']).toBe('var(--sb-keystone)');
    });

    it('counts the next round in as it starts', () => {
        const dom = makeDom();
        const hud = new OnlineVersusHud(dom.doc);
        hud.announceRoundStart(3, { endCondition: 'lines', endConditionValue: 40 });
        const banner = byId(dom, 'ov-round-banner');
        expect(texts(banner)).toEqual([describeGoal('lines', 40), 'Round 3']);
        expect(banner.classList.contains('ov-round--start')).toBe(true);
        vi.advanceTimersByTime(ROUND_START_MS);
        expect(banner.classList.contains('is-shown')).toBe(false);

        // The outcome after a start is a full banner again.
        hud.announceRound(3, null);
        expect(banner.classList.contains('ov-round--start')).toBe(false);
    });
});

describe('online versus HUD: the match won', () => {
    it('raises a crest over an opponent winner\'s well and steps the rest back', () => {
        const dom = makeDom();
        const hud = new OnlineVersusHud(dom.doc);
        hud.showVictory(dom.frame, { name: 'Mika', color: '#22d3ee', isYou: false });

        expect(dom.stage.classList.contains('is-match-over')).toBe(true);
        expect(dom.tile.classList.contains('is-victor')).toBe(true);
        expect(dom.card.classList.contains('is-victor')).toBe(false);
        const [crest] = dom.frame.querySelectorAll('.ov-victory');
        expect(texts(crest)).toEqual(['Match won', 'Victory', 'Mika']);
        expect(crest.style.props['--win-color']).toBe('#22d3ee');
        // The light rises first, then the crest.
        expect(crest.classList.contains('is-shown')).toBe(false);
        vi.advanceTimersByTime(400);
        expect(crest.classList.contains('is-shown')).toBe(true);
    });

    it('names you on your own well, and clears for the next match', () => {
        const dom = makeDom();
        const hud = new OnlineVersusHud(dom.doc);
        hud.showVictory(dom.wrapper, { name: 'Me', color: '#ffac88', isYou: true });
        expect(dom.card.classList.contains('is-victor')).toBe(true);
        const [crest] = dom.wrapper.querySelectorAll('.ov-victory');
        expect(texts(crest)).toEqual(['Match won', 'Victory', 'You']);

        hud.reset();
        expect(dom.wrapper.querySelectorAll('.ov-victory')).toHaveLength(0);
        expect(dom.stage.classList.contains('is-match-over')).toBe(false);
        expect(dom.card.classList.contains('is-victor')).toBe(false);
        // A crest still on its way does not come back after the reset.
        vi.advanceTimersByTime(1000);
        expect(dom.stage.querySelectorAll('.ov-victory')).toHaveLength(0);
    });

    it('stands the crest over the stage when the winner\'s tile is too small to hold it', () => {
        const dom = makeDom();
        const hud = new OnlineVersusHud(dom.doc);
        dom.frame.offsetWidth = 64; // a phone's full field
        hud.showVictory(dom.frame, { name: 'Mika', color: '#22d3ee' });
        expect(dom.frame.querySelectorAll('.ov-victory')).toHaveLength(0);
        const [crest] = dom.stage.querySelectorAll('.ov-victory');
        expect(crest.parentElement).toBe(dom.stage);
        expect(crest.classList.contains('ov-victory--stage')).toBe(true);
        expect(texts(crest)).toEqual(['Match won', 'Victory', 'Mika']);
        // The winner's tile still lifts.
        expect(dom.tile.classList.contains('is-victor')).toBe(true);

        // No well at all (the winner left the field): over the stage too.
        hud.showVictory(null, { name: 'Mika' });
        expect(dom.stage.querySelectorAll('.ov-victory--stage')).toHaveLength(1);
    });

    it('a crest shown again starts its beat afresh', () => {
        const dom = makeDom();
        const hud = new OnlineVersusHud(dom.doc);
        hud.showVictory(dom.frame, { name: 'Mika' });
        vi.advanceTimersByTime(1000);
        hud.showVictory(dom.wrapper, { isYou: true });
        // The first crest's leaving would have come at the first beat's end.
        vi.advanceTimersByTime(VICTORY_BEAT_MS - STAGE_LEAVE_MS - 1000);
        expect(dom.stage.classList.contains('is-leaving')).toBe(false);
        vi.advanceTimersByTime(1000);
        expect(dom.stage.classList.contains('is-leaving')).toBe(true);
        expect(dom.stage.querySelectorAll('.ov-victory')).toHaveLength(1);
    });

    it('steps the stage out as the beat ends, so the results never follow an empty window', () => {
        const dom = makeDom();
        const hud = new OnlineVersusHud(dom.doc);
        hud.showVictory(dom.frame, { name: 'Mika' });
        vi.advanceTimersByTime(VICTORY_BEAT_MS - STAGE_LEAVE_MS - 1);
        expect(dom.stage.classList.contains('is-leaving')).toBe(false);
        vi.advanceTimersByTime(1);
        expect(dom.stage.classList.contains('is-leaving')).toBe(true);
        // The next match comes in at full strength.
        hud.reset();
        expect(dom.stage.classList.contains('is-leaving')).toBe(false);
    });

    it('holds the match won shorter with reduced motion', () => {
        const hud = new OnlineVersusHud(makeDom().doc);
        expect(hud.victoryBeatMs()).toBe(VICTORY_BEAT_MS);
        reduced = true;
        expect(hud.victoryBeatMs()).toBe(VICTORY_BEAT_REDUCED_MS);
        expect(VICTORY_BEAT_REDUCED_MS).toBeLessThan(VICTORY_BEAT_MS);
    });

    it('never puts an emoji on the stage', () => {
        const dom = makeDom();
        const hud = new OnlineVersusHud(dom.doc);
        hud.announceRound(1, { name: 'Mika', isYou: false });
        hud.announceRound(2, { isYou: true });
        hud.announceRound(3, null);
        hud.announceRoundStart(4, { endCondition: 'frags', endConditionValue: 3 });
        hud.showVictory(dom.frame, { name: 'Mika' });
        const all = [];
        const walk = (n) => n.children.forEach((c) => { all.push(c.textContent); walk(c); });
        walk(dom.stage);
        all.forEach((text) => expect(EMOJI.test(text)).toBe(false));
    });
});
