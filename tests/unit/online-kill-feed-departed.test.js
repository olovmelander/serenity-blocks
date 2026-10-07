/**
 * A player who leaves mid-round is knocked out (multiplayer/ffa/presence.js). With no
 * one to credit, the Battle Log says they left, not that they topped out.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import { OnlineKillFeed } from '../../src/ui/online-kill-feed.js';

function feedHtml(event) {
    const listContainer = { innerHTML: '' };
    const feed = new OnlineKillFeed({ querySelector: () => listContainer });
    feed.addKill(event);
    return listContainer.innerHTML;
}

describe('Battle Log: departures', () => {
    it('says a leaver left', () => {
        const html = feedHtml({ victim: 'Mika', isSelfKill: true, departed: true });
        expect(html).toContain('>left<');
        expect(html).not.toContain('topped out');
    });

    it('still says topped out for one who topped out', () => {
        expect(feedHtml({ victim: 'Mika', isSelfKill: true })).toContain('topped out');
    });
});

describe('Battle Log: one row per event (audit P5)', () => {
    /** A list that records rows the way the DOM would insert them. */
    function fakeList() {
        const rows = [];
        return {
            rows,
            get innerHTML() { return rows.join(''); },
            set innerHTML(html) { rows.length = 0; if (html) rows.push(html); },
            insertAdjacentHTML(position, html) { if (position === 'afterbegin') rows.unshift(html); },
            get childElementCount() { return rows.length; },
            get lastElementChild() { return rows.length ? { remove: () => rows.pop() } : null; },
        };
    }

    it('inserts the new row instead of rebuilding the log, and keeps at most maxItems', () => {
        const list = fakeList();
        const feed = new OnlineKillFeed({ querySelector: () => list }, { maxItems: 3 });
        const render = vi.spyOn(feed, 'render');
        ['A', 'B', 'C', 'D', 'E'].forEach((victim) => feed.addKill({ victim, isSelfKill: true, eventId: victim }));
        expect(render).not.toHaveBeenCalled();
        expect(list.rows).toHaveLength(3);
        expect(list.rows[0]).toContain('>E<');
        expect(list.rows[2]).toContain('>C<');
    });

    it('an ephemeral feed still re-renders, since its rows age', () => {
        const list = fakeList();
        const feed = new OnlineKillFeed({ querySelector: () => list }, { itemTTL: 5000 });
        const render = vi.spyOn(feed, 'render');
        feed.addKill({ victim: 'A', isSelfKill: true });
        expect(render).toHaveBeenCalledTimes(1);
        feed.clear();
    });
});
