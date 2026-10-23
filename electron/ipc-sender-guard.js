/**
 * Every ipcMain.handle answers only the game's own page (audit R-07). The handlers resize the
 * window, quit, report process metrics and drive Steam (lobbies, P2P packets, Cloud files);
 * they used to answer whatever frame invoked them. Only the game's page has the preload today,
 * so this is the second wall: a frame that is not the game, in the game's window, is refused
 * even if it reaches ipcRenderer.
 *
 * guardIpcHandlers wraps ipcMain.handle itself, so the handlers steam-integration.js registers
 * later are guarded too. Install it before the first handler is registered.
 */

/**
 * @param {{ sender?: unknown, senderFrame?: { url?: string } | null } | null | undefined} event
 * @param {{ webContents: unknown, isGameUrl: (url: string) => boolean }} game
 * @returns {boolean}
 */
export function isGameSender(event, { webContents, isGameUrl }) {
    const url = event?.senderFrame?.url;
    return Boolean(webContents)
        && event?.sender === webContents
        && typeof url === 'string'
        && isGameUrl(url);
}

/**
 * @param {{ handle: (channel: string, listener: Function) => void }} ipcMain
 * @param {(event: any) => boolean} isTrustedSender
 * @param {(channel: string) => void} [onRefused]
 */
export function guardIpcHandlers(ipcMain, isTrustedSender, onRefused = () => {}) {
    const register = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, listener) => register(channel, (event, ...args) => {
        if (!isTrustedSender(event)) {
            onRefused(channel);
            throw new Error(`${channel}: refused, the sender is not the game`);
        }
        return listener(event, ...args);
    });
}
