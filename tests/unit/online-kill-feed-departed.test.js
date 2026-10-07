/**
 * A player who leaves mid-round is knocked out (multiplayer/ffa/presence.js). With no
 * one to credit, the Battle Log says they left, not that they topped out.
 */
import { describe, expect, it } from 'vitest';
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
