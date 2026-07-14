import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { handleOnlineSessionExit } from '../../src/ui/online-session-exit.js';

class TestCustomEvent {
    constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
    }
}

function makeMode({ clearLobbyDuringExit = false } = {}) {
    const mode = {
        currentLobbyId: 'LOBBY-1',
        _handledSessionExit: null,
        _handleExitToMenu: vi.fn(async () => {
            if (clearLobbyDuringExit) mode.currentLobbyId = null;
        }),
    };
    return mode;
}

describe('online terminal session exit', () => {
    let dispatchEvent;

    beforeEach(() => {
        dispatchEvent = vi.fn();
        vi.stubGlobal('window', { dispatchEvent });
        vi.stubGlobal('CustomEvent', TestCustomEvent);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('uses local update-required copy and ignores host-provided text', async () => {
        const mode = makeMode();

        await handleOnlineSessionExit(mode, {
            reason: 'update_required',
            message: '<script>host-controlled copy</script>',
        });

        expect(mode._handleExitToMenu).toHaveBeenCalledOnce();
        expect(dispatchEvent).toHaveBeenCalledOnce();
        expect(dispatchEvent.mock.calls[0][0]).toMatchObject({
            type: 'serenity:toast',
            detail: {
                message: 'Update Serenity Blocks to join this match.',
                type: 'warning',
            },
        });
    });

    it('falls back to local generic copy for an unknown host reason', async () => {
        const mode = makeMode();

        await handleOnlineSessionExit(mode, {
            reason: 'host_defined_reason',
            message: 'Trust this remote message instead',
        });

        expect(dispatchEvent.mock.calls[0][0].detail.message).toBe('Unable to join this match.');
    });

    it('is idempotent after the first terminal exit clears the current lobby id', async () => {
        const mode = makeMode({ clearLobbyDuringExit: true });

        await handleOnlineSessionExit(mode, { reason: 'update_required' });
        await handleOnlineSessionExit(mode, { reason: 'update_required' });

        expect(mode._handleExitToMenu).toHaveBeenCalledOnce();
        expect(dispatchEvent).toHaveBeenCalledOnce();
    });
});
