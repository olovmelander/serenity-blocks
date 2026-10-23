import { describe, expect, it, vi } from 'vitest';
import { guardIpcHandlers, isGameSender } from '../../electron/ipc-sender-guard.js';

const gameContents = { id: 1 };
const isGameUrl = (url) => url.startsWith('file:///app/dist/');
const gameEvent = { sender: gameContents, senderFrame: { url: 'file:///app/dist/index.html' } };

function fakeIpcMain() {
    const handlers = new Map();
    return {
        handlers,
        handle(channel, listener) { handlers.set(channel, listener); },
    };
}

describe('IPC sender guard (audit R-07)', () => {
    it('trusts only the game window showing a game page', () => {
        const game = { webContents: gameContents, isGameUrl };
        expect(isGameSender(gameEvent, game)).toBe(true);
        expect(isGameSender({ ...gameEvent, sender: { id: 2 } }, game)).toBe(false);
        expect(isGameSender({ ...gameEvent, senderFrame: { url: 'https://example.com/' } }, game)).toBe(false);
        expect(isGameSender({ ...gameEvent, senderFrame: null }, game)).toBe(false);
        expect(isGameSender(gameEvent, { webContents: null, isGameUrl })).toBe(false);
        expect(isGameSender(undefined, game)).toBe(false);
    });

    it('guards every handler registered after it, and passes the arguments through', async () => {
        const ipcMain = fakeIpcMain();
        const onRefused = vi.fn();
        guardIpcHandlers(ipcMain, (event) => isGameSender(event, { webContents: gameContents, isGameUrl }), onRefused);
        ipcMain.handle('steam:cloudWrite', (_event, file, data) => `${file}:${data}`);

        const listener = ipcMain.handlers.get('steam:cloudWrite');
        expect(await listener(gameEvent, 'settings.json', '{}')).toBe('settings.json:{}');
        expect(onRefused).not.toHaveBeenCalled();

        const stranger = { sender: gameContents, senderFrame: { url: 'https://example.com/' } };
        expect(() => listener(stranger, 'settings.json', '{}')).toThrow('steam:cloudWrite: refused');
        expect(onRefused).toHaveBeenCalledWith('steam:cloudWrite');
    });
});
