import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    createNetworkHandlerRegistry,
    NetworkHandlerRegistry,
} from '../../src/core/multiplayer/ffa/network-handler-registry.js';
import { MessageTypes } from '../../src/core/network/message-types.js';

describe('NetworkHandlerRegistry', () => {
    it('unregisters exactly its owned handler identities once', () => {
        const network = {
            on: vi.fn(),
            off: vi.fn(),
        };
        const registry = createNetworkHandlerRegistry(network);
        const firstHandler = vi.fn();
        const secondHandler = vi.fn();

        expect(registry.register(MessageTypes.NET_PING, firstHandler)).toBe(firstHandler);
        expect(registry.register(MessageTypes.NET_PONG, secondHandler)).toBe(secondHandler);
        expect(registry.size).toBe(2);
        expect(registry.getMessageTypes()).toEqual([MessageTypes.NET_PING, MessageTypes.NET_PONG]);
        expect(network.on.mock.calls).toEqual([
            [MessageTypes.NET_PING, firstHandler],
            [MessageTypes.NET_PONG, secondHandler],
        ]);

        registry.dispose();

        expect(registry.size).toBe(0);
        expect(network.off).toHaveBeenCalledTimes(2);
        expect(network.off.mock.calls).toEqual(expect.arrayContaining([
            [MessageTypes.NET_PING, firstHandler],
            [MessageTypes.NET_PONG, secondHandler],
        ]));

        registry.dispose();
        expect(network.off).toHaveBeenCalledTimes(2);
        expect(() => registry.register('message:late', vi.fn())).toThrow(/after disposal/i);
    });

    it('validates the transport and registration contract', () => {
        expect(() => new NetworkHandlerRegistry(null)).toThrow(/requires network\.on/i);
        expect(() => new NetworkHandlerRegistry({})).toThrow(/requires network\.on/i);

        const registry = createNetworkHandlerRegistry({ on: vi.fn() });
        expect(() => registry.register('', vi.fn())).toThrow(/message type and function/i);
        expect(() => registry.register('message:type', null)).toThrow(/message type and function/i);
        expect(() => registry.register('message:unsupported', vi.fn())).toThrow(/unsupported message type/i);

        registry.dispose();
        expect(registry.size).toBe(0);
    });

    it('tracks synchronous packet application depth and restores it after failures', () => {
        const handlers = new Map();
        const network = {
            on: vi.fn((messageType, handler) => handlers.set(messageType, handler)),
            off: vi.fn(),
        };
        const onDrained = vi.fn();
        const dispatchScope = { depth: 0, onDrained };
        const registry = createNetworkHandlerRegistry(network, dispatchScope);
        const observedDepths = [];
        registry.register(MessageTypes.NET_PING, () => {
            observedDepths.push(dispatchScope.depth);
            handlers.get(MessageTypes.NET_PONG)();
            observedDepths.push(dispatchScope.depth);
        });
        registry.register(MessageTypes.NET_PONG, () => {
            observedDepths.push(dispatchScope.depth);
        });

        handlers.get(MessageTypes.NET_PING)();

        expect(observedDepths).toEqual([1, 2, 1]);
        expect(dispatchScope.depth).toBe(0);
        expect(onDrained).toHaveBeenCalledOnce();

        registry.register(MessageTypes.NET_HEARTBEAT, () => {
            expect(dispatchScope.depth).toBe(1);
            throw new Error('handler failed');
        });
        expect(() => handlers.get(MessageTypes.NET_HEARTBEAT)()).toThrow('handler failed');
        expect(dispatchScope.depth).toBe(0);
        expect(onDrained).toHaveBeenCalledTimes(2);
    });
});
