/**
 * A host change during a match used to be silent: the match carried on and nobody was told who
 * hosts now. The new host and every follower announce it (network/host-migration.js), and the
 * player reads one line (ui/online-session-exit.js).
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { HostMigration } from '../../src/core/network/host-migration.js';
import { MULTIPLAYER_EVENTS, onMultiplayerEvent } from '../../src/events/multiplayer-events.js';
import { announceNewHost, describeNewHost } from '../../src/ui/online-session-exit.js';

const OLD_HOST = '76561198000000001';
const NEW_HOST = '76561198000000002';
const ME = '76561198000000003';

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('who hosts now, in words', () => {
    it('names the new host, or says it is you', () => {
        expect(describeNewHost({ newHostId: NEW_HOST, localSteamId: ME, name: 'Ada' }))
            .toBe('Ada is now hosting this match.');
        expect(describeNewHost({ newHostId: ME, localSteamId: ME, name: 'Me' }))
            .toBe('You are now hosting this match.');
        expect(describeNewHost({ newHostId: NEW_HOST, localSteamId: ME })).toBe('This match has a new host.');
        expect(describeNewHost({})).toBe('');
    });

    it('is shown as a note while the match is on, and not once it is gone', () => {
        const dispatched = [];
        vi.stubGlobal('window', { dispatchEvent: (event) => dispatched.push(event) });
        vi.stubGlobal('CustomEvent', class {
            constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
        });
        const mode = {
            ffaGameState: {},
            steamNetworking: { steamId: ME },
            _getPlayerName: (id) => (id === NEW_HOST ? 'Ada' : null),
        };

        announceNewHost(mode, { newHostId: NEW_HOST });
        expect(dispatched).toEqual([expect.objectContaining({
            type: 'serenity:toast', detail: { message: 'Ada is now hosting this match.', type: 'info' },
        })]);

        announceNewHost({ ...mode, ffaGameState: null }, { newHostId: NEW_HOST });
        announceNewHost(mode, {});
        expect(dispatched).toHaveLength(1);
    });
});

describe('a follower of a host change', () => {
    /** A peer's migration, following whoever the network names. */
    function follower(hostSteamId) {
        const game = {
            isHost: false,
            localPlayerId: ME,
            network: { hostSteamId, isHost: false },
            onHostAuthorityChanged: vi.fn(),
        };
        const migration = new HostMigration(game);
        return { game, migration };
    }

    it('announces the new host it adopts', () => {
        const announced = [];
        const unsubscribe = onMultiplayerEvent(MULTIPLAYER_EVENTS.HOST_MIGRATED, (detail) => announced.push(detail));
        const { game, migration } = follower(OLD_HOST);
        try {
            migration.adoptHost(NEW_HOST, 'migration_claim');
            expect(game.network.hostSteamId).toBe(NEW_HOST);
            expect(announced).toEqual([{ newHostId: NEW_HOST, previousHostId: OLD_HOST }]);

            // The same host named again is no change.
            migration.adoptHost(NEW_HOST, 'migration_sync');
            expect(announced).toHaveLength(1);
        } finally {
            unsubscribe();
            migration.dispose();
        }
    });

    it('says nothing for the first host of a session', () => {
        const announced = [];
        const unsubscribe = onMultiplayerEvent(MULTIPLAYER_EVENTS.HOST_MIGRATED, (detail) => announced.push(detail));
        const { migration } = follower(null);
        try {
            migration.adoptHost(OLD_HOST, 'join');
            expect(announced).toEqual([]);
        } finally {
            unsubscribe();
            migration.dispose();
        }
    });
});
