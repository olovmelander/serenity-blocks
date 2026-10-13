/**
 * The window waits for the game to finish its saves before closing, for at most two
 * seconds (audit LIFE-14). Only the answer to this request, from this window, counts.
 */
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    PREPARE_QUIT_CHANNEL,
    QUIT_FLUSH_TIMEOUT_MS,
    QUIT_READY_CHANNEL,
    requestRendererQuitFlush,
} from '../../electron/quit-flush.js';

function fakeWindow() {
    const sent = [];
    return { sent, webContents: { send: (channel, id) => sent.push({ channel, id }) } };
}

afterEach(() => vi.useRealTimers());

describe('quit flush request', () => {
    it('resolves when the renderer answers this request', async () => {
        const ipc = new EventEmitter();
        const { sent, webContents } = fakeWindow();
        const done = requestRendererQuitFlush({ ipc, webContents });
        expect(sent).toHaveLength(1);
        expect(sent[0].channel).toBe(PREPARE_QUIT_CHANNEL);
        ipc.emit(QUIT_READY_CHANNEL, { sender: webContents }, sent[0].id);
        await expect(done).resolves.toBe('flushed');
        expect(ipc.listenerCount(QUIT_READY_CHANNEL)).toBe(0);
    });

    it('ignores answers to another request or from another window, then gives up on time', async () => {
        vi.useFakeTimers();
        const ipc = new EventEmitter();
        const { sent, webContents } = fakeWindow();
        let outcome = null;
        requestRendererQuitFlush({ ipc, webContents }).then((value) => { outcome = value; });
        ipc.emit(QUIT_READY_CHANNEL, { sender: webContents }, sent[0].id + 1);
        ipc.emit(QUIT_READY_CHANNEL, { sender: {} }, sent[0].id);
        await vi.advanceTimersByTimeAsync(QUIT_FLUSH_TIMEOUT_MS - 1);
        expect(outcome).toBeNull();
        await vi.advanceTimersByTimeAsync(1);
        expect(outcome).toBe('timed-out');
        expect(ipc.listenerCount(QUIT_READY_CHANNEL)).toBe(0);
    });

    it('does not wait for a renderer it cannot reach', async () => {
        const ipc = new EventEmitter();
        const webContents = { send: () => { throw new Error('Object has been destroyed'); } };
        await expect(requestRendererQuitFlush({ ipc, webContents })).resolves.toBe('unavailable');
        expect(ipc.listenerCount(QUIT_READY_CHANNEL)).toBe(0);
    });
});
