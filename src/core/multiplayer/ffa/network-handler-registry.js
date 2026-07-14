// @ts-check

import { isSupportedInAnyProtocolVersion } from '../../network/message-types.js';

/**
 * Owns the exact handler functions installed by one multiplayer game-state
 * instance. SteamNetworking intentionally supports multiple subscribers per
 * message type, so cleanup must unregister by function identity rather than
 * clearing the transport's shared handler table.
 */
export class NetworkHandlerRegistry {
    /**
     * @param {{
     *   on: (messageType: string, handler: (...args: any[]) => void) => boolean|void,
     *   off?: (messageType: string, handler: (...args: any[]) => void) => void,
     * }} network
     * @param {{depth: number, onDrained?: () => void}|null} [dispatchScope]
     */
    constructor(network, dispatchScope = null) {
        if (!network || typeof network.on !== 'function') {
            throw new TypeError('NetworkHandlerRegistry requires network.on');
        }
        this.network = network;
        this.dispatchScope = dispatchScope;
        /** @type {Array<{messageType: string, handler: (...args: any[]) => void}>} */
        this.registrations = [];
        this.disposed = false;
    }

    /**
     * @param {string} messageType
     * @param {(...args: any[]) => void} handler
     */
    register(messageType, handler) {
        if (this.disposed) {
            throw new Error('Cannot register a network handler after disposal');
        }
        if (!messageType || typeof handler !== 'function') {
            throw new TypeError('Network handlers require a message type and function');
        }
        if (!isSupportedInAnyProtocolVersion(messageType)) {
            throw new Error(`Cannot register unsupported message type: ${messageType}`);
        }

        const ownedHandler = this.dispatchScope ? (...args) => {
            this.dispatchScope.depth = Math.max(0, Number(this.dispatchScope.depth) || 0) + 1;
            try {
                return handler(...args);
            } finally {
                this.dispatchScope.depth = Math.max(0, this.dispatchScope.depth - 1);
                if (this.dispatchScope.depth === 0) this.dispatchScope.onDrained?.();
            }
        } : handler;
        const accepted = this.network.on(messageType, ownedHandler);
        if (accepted === false) {
            throw new Error(`Network rejected handler registration: ${messageType}`);
        }
        this.registrations.push({ messageType, handler: ownedHandler });
        return handler;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;

        if (typeof this.network.off === 'function') {
            for (let i = this.registrations.length - 1; i >= 0; i -= 1) {
                const { messageType, handler } = this.registrations[i];
                this.network.off(messageType, handler);
            }
        }
        this.registrations.length = 0;
    }

    get size() {
        return this.registrations.length;
    }

    getMessageTypes() {
        return this.registrations.map(({ messageType }) => messageType);
    }
}

export function createNetworkHandlerRegistry(network, dispatchScope = null) {
    return new NetworkHandlerRegistry(network, dispatchScope);
}
