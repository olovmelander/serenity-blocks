/**
 * Strings and numbers from other players reach markup in the lobby browser, the Battle
 * Log, the scoreboard and the results. A lobby's name, host and id are any lobby
 * owner's to choose; colours, counts and placements come from the host. None of them
 * may close an attribute, open a tag or smuggle CSS.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

const PAYLOAD = '"><img src=x onerror=alert(1)>';

beforeEach(() => {
    vi.stubGlobal('document', {
        createElement: () => {
            let text = '';
            return {
                set textContent(value) { text = String(value ?? ''); },
                get innerHTML() {
                    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                },
            };
        },
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('lobby browser rows', () => {
    it('escape a lobby owner\'s name, host and id in attributes and text', async () => {
        const { LobbyBrowser } = await import('../../src/ui/lobby-browser.js');
        const browser = Object.create(LobbyBrowser.prototype);
        const html = browser.lobbyRowHtml({
            id: PAYLOAD, name: PAYLOAD, hostName: PAYLOAD, status: PAYLOAD, players: 1, maxPlayers: 4,
        });
        expect(html).not.toContain('<img');
        expect(html).toContain('data-lobby-id="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"');
        expect(html).toContain('aria-label="Watch &quot;&gt;&lt;img src=x onerror=alert(1)&gt;"');
    });
});

describe('Battle Log rows', () => {
    it('drop a colour that is not a hex colour and print counts as numbers', async () => {
        const { OnlineKillFeed } = await import('../../src/ui/online-kill-feed.js');
        const listContainer = { innerHTML: '' };
        const feed = new OnlineKillFeed({ querySelector: () => listContainer });
        feed.addGarbageSent({
            sender: 'A', target: 'B', lines: '<b>9</b>', senderColor: 'red;background:url(x)', targetColor: '#22d3ee',
        });
        feed.render();
        const html = listContainer.innerHTML;
        expect(html).not.toContain('background:url');
        expect(html).not.toContain('<b>');
        expect(html).toContain('style="color: #22d3ee;"');
        expect(html).toContain('→ 0 lines →');
    });
});

describe('online scoreboard rows', () => {
    it('only take a hex colour into the row\'s style', async () => {
        const { OnlineScoreboard } = await import('../../src/ui/online-scoreboard.js');
        const listContainer = { innerHTML: '' };
        const board = Object.assign(Object.create(OnlineScoreboard.prototype), {
            listContainer,
            players: [{
                id: 'A', name: 'A', color: 'red;}</style><script>x</script>', frags: 1, isAlive: true,
            }],
            sortBy: 'frags',
            localPlayerId: null,
        });
        board.render();
        expect(listContainer.innerHTML).not.toContain('<script>');
        expect(listContainer.innerHTML).toContain('--player-row-color: #a0aec0');
    });
});
