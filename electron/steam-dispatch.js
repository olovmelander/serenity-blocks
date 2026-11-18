// One consumer owns Steam's manual callback pipe. The native binding's JS initializer
// starts its own interval, so the desktop adapter calls the pinned addon's init directly.
export const DISPATCH_FUNCTIONS = {
    pipe: 'int SteamAPI_GetHSteamPipe()',
    frame: 'void SteamAPI_ManualDispatch_RunFrame(int pipe)',
    next: 'bool SteamAPI_ManualDispatch_GetNextCallback(int pipe, void *message)',
    free: 'void SteamAPI_ManualDispatch_FreeLastCallback(int pipe)',
    result: 'bool SteamAPI_ManualDispatch_GetAPICallResult(int pipe, uint64_t call, void *data, int size, int callback, void *failed)',
};

export function openSteamDispatcher(fn, view, { clock = Date.now, log = () => {} } = {}) {
    const pipe = fn.pipe();
    if (!pipe) throw new Error('Steam callback pipe unavailable');
    const requests = new Map();
    const handlers = new Map();
    const message = Buffer.alloc(24);
    let disposed = false;

    function complete(event) {
        const handle = event.readBigUInt64LE(0).toString();
        const pending = requests.get(handle);
        if (!pending) return;
        requests.delete(handle);
        pending.onSettled?.();
        try {
            const size = event.readUInt32LE(12);
            if (event.readInt32LE(8) !== pending.kind || size < 1 || size > 65536) throw new Error('Unexpected Steam call result');
            const body = Buffer.alloc(size);
            const failed = Buffer.alloc(1);
            if (!fn.result(pipe, BigInt(handle), body, size, pending.kind, failed) || failed[0]) throw new Error('Steam request failed');
            pending.resolve(body);
        } catch (error) { pending.reject(error); }
    }

    return {
        wait(handle, kind, onSettled) {
            if (disposed || !handle || requests.has(String(handle))) return Promise.reject(new Error('Invalid Steam call'));
            return new Promise((resolve, reject) => requests.set(String(handle), { kind, resolve, reject, onSettled, deadline: clock() + 30000 }));
        },
        on(kind, handler) {
            if (!handlers.has(kind)) handlers.set(kind, new Set());
            handlers.get(kind).add(handler);
            return { disconnect: () => handlers.get(kind)?.delete(handler) };
        },
        pump() {
            if (disposed) return;
            fn.frame(pipe);
            for (let count = 0; count < 512 && fn.next(pipe, message); count++) {
                try {
                    const kind = message.readInt32LE(4);
                    const size = message.readInt32LE(16);
                    if (size < 0 || size > 65536 || (kind !== 703 && !handlers.has(kind))) continue;
                    const address = message.readBigUInt64LE(8);
                    const body = size && address ? Buffer.from(new Uint8Array(view(address, size))) : Buffer.alloc(0);
                    if (kind === 703) complete(body);
                    else for (const listener of handlers.get(kind)) listener(body);
                } catch (error) { log('Steam callback: ' + error.message); }
                finally { fn.free(pipe); }
            }
            for (const [id, pending] of requests) {
                if (clock() >= pending.deadline) {
                    // Keep ownership until completion. In particular another score upload must
                    // not start while Steam can still be processing the previous one.
                    pending.deadline = Infinity;
                    pending.reject(new Error('Steam request timed out'));
                }
            }
        },
        close() {
            disposed = true;
            for (const pending of requests.values()) { pending.onSettled?.(); pending.reject(new Error('Steam session ended')); }
            requests.clear();
            handlers.clear();
        },
    };
}
