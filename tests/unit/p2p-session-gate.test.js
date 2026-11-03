import { describe, expect, it, vi } from 'vitest';
import { P2P_SESSION_WAIT_MS, createP2PSessionGate } from '../../electron/p2p-session-gate.js';

function setup(members = []) {
    const lobby = new Set(members);
    let t = 1000;
    const accept = vi.fn();
    const gate = createP2PSessionGate({ accept, isMember: (id) => lobby.has(id), now: () => t });
    return { gate, accept, lobby, advance: (ms) => { t += ms; } };
}

describe('P2P session gate (electron/p2p-session-gate.js)', () => {
    it('accepts a lobby member at once', () => {
        const { gate, accept } = setup(['111']);
        expect(gate.onRequest(111n)).toBe(true);
        expect(accept).toHaveBeenCalledWith('111');
    });

    it('never accepts someone outside the lobby, and forgets them after the wait', () => {
        const { gate, accept, advance } = setup(['111']);
        expect(gate.onRequest('999')).toBe(false);
        gate.onMembersChanged();
        advance(P2P_SESSION_WAIT_MS + 1);
        gate.onMembersChanged();
        expect(accept).not.toHaveBeenCalled();
        expect(gate.pendingCount).toBe(0);
    });

    it('accepts a request that arrived just before its sender was listed in the lobby', () => {
        const { gate, accept, lobby, advance } = setup([]);
        expect(gate.onRequest('222')).toBe(false);
        advance(2000);
        lobby.add('222');
        gate.onMembersChanged();
        expect(accept).toHaveBeenCalledWith('222');
        expect(gate.pendingCount).toBe(0);
    });

    it('drops every held request when the lobby is left', () => {
        const { gate, accept, lobby } = setup([]);
        gate.onRequest('333');
        gate.clear();
        lobby.add('333');
        gate.onMembersChanged();
        expect(accept).not.toHaveBeenCalled();
    });

    it('ignores an empty sender and survives a failing accept', () => {
        const accept = vi.fn(() => { throw new Error('boom'); });
        const log = vi.fn();
        const gate = createP2PSessionGate({ accept, isMember: () => true, log });
        expect(gate.onRequest(null)).toBe(false);
        expect(gate.onRequest('444')).toBe(true);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('failed to accept'));
    });
});
