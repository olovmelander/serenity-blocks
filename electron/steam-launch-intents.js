const MAX_ID = 0xffffffffffffffffn;
export function parseLobbyLaunch(argv) {
    const parts = Array.isArray(argv) ? argv : String(argv || '').trim().split(/\s+/);
    const i = parts.indexOf('+connect_lobby');
    const value = parts[i + 1];
    if (i < 0 || typeof value !== 'string' || !/^\d{1,20}$/.test(value)) return null;
    const id = BigInt(value);
    return id > 0n && id <= MAX_ID ? String(id) : null;
}
export function createLobbyIntents(now = Date.now) {
    const pending = new Map(), seen = new Map();
    return {
        offer(lobbyId, friendSteamId, source) {
            const id = parseLobbyLaunch(['+connect_lobby', String(lobbyId)]);
            if (!id) return null;
            for (const [key, time] of seen) if (now() - time > 3000) seen.delete(key);
            if (pending.has(id) || seen.has(id)) return null;
            if (pending.size >= 16) pending.delete(pending.keys().next().value);
            const intent = { lobbyId: id, friendSteamId: friendSteamId ? String(friendSteamId) : null, source, receivedAt: now() };
            pending.set(id, intent);
            seen.set(id, now());
            return intent;
        },
        list: () => [...pending.values()],
        ack(id) { pending.delete(String(id)); },
    };
}
