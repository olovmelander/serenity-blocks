import { describe, expect, it, vi } from 'vitest';
import { deferFinishPastCascade } from '../../src/core/game-modes/odyssey-completion.js';

function createAttempt() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const session = {
        retired: false,
        gameState: { isProcessingPhysics: true, latestPhysicsPromise: promise },
    };
    const mode = {
        _activeLevelSession: session,
        _isLevelSessionActive: (candidate) => candidate === mode._activeLevelSession && !candidate.retired,
        _finishVictoryLap: vi.fn(),
    };
    return { mode, session, resolve };
}

describe('deferred Odyssey victory lap finish', () => {
    it('finishes once after the originating attempt finishes its cascade', async () => {
        const { mode, session, resolve } = createAttempt();
        expect(deferFinishPastCascade(mode, session)).toBe(true);
        const finishing = session.finishAfterCascade;
        expect(deferFinishPastCascade(mode, session)).toBe(true);
        expect(session.finishAfterCascade).toBe(finishing);
        resolve();
        await finishing;
        expect(mode._finishVictoryLap).toHaveBeenCalledOnce();
        expect(session.finishAfterCascade).toBeNull();
    });

    it.each(['retired', 'replaced'])('ignores completion of a %s attempt', async (change) => {
        const { mode, session, resolve } = createAttempt();
        deferFinishPastCascade(mode, session);
        const finishing = session.finishAfterCascade;
        if (change === 'retired') session.retired = true;
        else mode._activeLevelSession = { gameState: { victoryLapActive: true } };
        resolve();
        await finishing;
        expect(mode._finishVictoryLap).not.toHaveBeenCalled();
        expect(session.finishAfterCascade).toBeNull();
    });
});
