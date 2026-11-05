/**
 * What a session reports it did. Rounds used to be counted by recovery stages, which only two of
 * the nine sessions have, so seven showed "0 Rounds" on the closing card and saved 0 to the
 * practice log. Real manager, real sessions, on a fake clock.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { BreathworkSessionManager } from '../../src/ui/effects/breathwork-session-manager.js';

class FakeAudio {
    constructor() {
        this.volume = 1;
        this.currentTime = 0;
        this.paused = true;
    }

    play() {
        this.paused = false;
        return Promise.resolve();
    }

    pause() { this.paused = true; }

    addEventListener() {}

    removeEventListener() {}

    load() {}
}

const indicator = () => new Proxy({ pattern: [4, 0, 4, 0] }, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => {
        target[key] = value;
        return true;
    },
});

const SESSIONS = ['FIRST', 'TIDE', 'ROOTS', 'UNWIND', 'SUNRISE', 'REST', 'FLOW', 'BASE', 'ELIXIR'];
const START = [null, { sounds: false, vibration: false, openHolds: false }];

async function complete(sessionId) {
    const manager = new BreathworkSessionManager(indicator());
    let stats = null;
    manager.startSession(sessionId, START[0], (report) => { stats = report; }, START[1]);
    for (let step = 0; step < 400 && !stats; step += 1) {
        // eslint-disable-next-line no-await-in-loop -- one stretch of the session after another
        await vi.advanceTimersByTimeAsync(10000);
    }
    manager.destroy();
    return stats;
}

describe('the rounds a session reports', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('Audio', FakeAudio);
        vi.stubGlobal('window', globalThis);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each(SESSIONS)('counts every round of a completed %s', async (sessionId) => {
        const stats = await complete(sessionId);

        expect(stats).not.toBeNull();
        expect(stats.totalRounds).toBeGreaterThan(0);
        expect(stats.rounds).toBe(stats.totalRounds);
    });

    it('does not count a round the player left in the middle of', async () => {
        const manager = new BreathworkSessionManager(indicator());
        manager.startSession('FIRST', START[0], () => {}, START[1]);
        await vi.advanceTimersByTimeAsync(1000);

        const report = manager.snapshot();
        manager.destroy();

        expect(report.rounds).toBe(0);
    });
});
