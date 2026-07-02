/**
 * @fileoverview Tests for the TRANSACTIONAL Battle Log (OnlineKillFeed).
 *
 * The in-match Battle Log "felt like it reset": entries auto-expired after 12s, the
 * feed was capped at 12 rows, and it was wiped on every round restart. It is now an
 * append-only match log — entries persist for the whole match (no per-entry TTL), the
 * history cap is generous, and rounds are delimited by a divider instead of a wipe.
 * These tests pin that behavior (and that the old ephemeral feed is still opt-in).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// OnlineKillFeed touches `document` (for HTML escaping) and a list container's
// innerHTML. vitest runs in node, so stub just enough DOM for render() to run.
function installDomStub() {
    const prev = globalThis.document;
    globalThis.document = {
        createElement: () => {
            let _t = '';
            return {
                set textContent(v) { _t = String(v ?? ''); },
                get innerHTML() { return _t; },
            };
        },
    };
    return () => { globalThis.document = prev; };
}

let restoreDom;
beforeEach(() => { restoreDom = installDomStub(); });
afterEach(() => { restoreDom(); });

// Import after the stub is installed at module-eval time is unnecessary (no top-level
// DOM access in the module), so a normal import is fine.
const { OnlineKillFeed } = await import('../../src/ui/online-kill-feed.js');

function makeFeed(options) {
    const listContainer = { innerHTML: '' };
    const container = {
        querySelector: (sel) => (String(sel).includes('kill-feed-list') ? listContainer : null),
    };
    const feed = new OnlineKillFeed(container, options);
    return { feed, listContainer };
}

describe('Battle Log (OnlineKillFeed) — transactional/append-only', () => {
    it('defaults to a persistent log: no TTL expiry, generous cap', () => {
        const { feed } = makeFeed();
        expect(feed.itemTTL).toBe(Infinity);
        expect(feed.maxItems).toBe(200);
    });

    it('entries never auto-expire (expiresAt is Infinity) so the log does not "reset"', () => {
        const { feed } = makeFeed();
        feed.addKill({ killer: 'A', victim: 'B', eventId: 'd1' });
        feed.addGarbageSent({ sender: 'A', target: '1 player', lines: 4 });
        expect(feed.items).toHaveLength(2);
        expect(feed.items.every((i) => i.expiresAt === Infinity)).toBe(true);
        // render() prunes expired entries; with Infinity TTL nothing is pruned.
        feed.render();
        expect(feed.items).toHaveLength(2);
    });

    it('keeps a long history (no 12-row truncation), trimming only past the 200 cap', () => {
        const { feed } = makeFeed();
        for (let i = 0; i < 205; i++) {
            feed.addKill({ killer: 'A', victim: `V${i}`, eventId: `k${i}` });
        }
        expect(feed.items).toHaveLength(200); // trimmed to the generous cap, NOT 12
        // Newest-first: the most recent kill is at the head.
        expect(feed.items[0].victim).toBe('V204');
    });

    it('addRoundMarker appends a round divider instead of wiping the log', () => {
        const { feed } = makeFeed();
        feed.addKill({ killer: 'A', victim: 'B', eventId: 'd1' });
        feed.addRoundMarker(2);
        expect(feed.items[0]).toMatchObject({ type: 'round', roundNumber: 2 });
        // The prior round's kill is still present below the divider.
        expect(feed.items.some((i) => i.type === 'kill' && i.victim === 'B')).toBe(true);
    });

    it('does not schedule an expiry timer in persistent mode', () => {
        const { feed } = makeFeed();
        feed.addKill({ killer: 'A', victim: 'B', eventId: 'd1' });
        expect(feed.expireTimer).toBeNull();
    });

    it('still supports an opt-in ephemeral feed via options (finite TTL + small cap)', () => {
        const { feed } = makeFeed({ itemTTL: 1000, maxItems: 5 });
        expect(feed.itemTTL).toBe(1000);
        expect(feed.maxItems).toBe(5);
        feed.addKill({ killer: 'A', victim: 'B', eventId: 'd1' });
        expect(Number.isFinite(feed.items[0].expiresAt)).toBe(true);
    });

    it('clear() still empties everything (used at match end / destroy, NOT per round)', () => {
        const { feed, listContainer } = makeFeed();
        feed.addKill({ killer: 'A', victim: 'B', eventId: 'd1' });
        feed.clear();
        expect(feed.items).toHaveLength(0);
        expect(listContainer.innerHTML).toBe('');
    });
});
