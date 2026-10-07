/* eslint-disable no-await-in-loop -- Promise continuations and virtual timer deadlines are sequential. */
import { setImmediate as realSetImmediate } from 'node:timers';

let installedClock = null;
const FRAME_MS = 1000 / 60;

/** A process-local clock for offline attempts; production keeps its existing driver. */
export function createVirtualClock({ epochMs = 1700000000000 } = {}) {
    let now = 0;
    let nextId = 1;
    const timers = new Map();
    const originals = new Map();
    let installed = false;
    const flush = () => new Promise((resolve) => { realSetImmediate(resolve); });

    function schedule(callback, delay, args, interval = null, raf = false) {
        if (typeof callback !== 'function') throw new TypeError('Virtual timer requires a function');
        const id = nextId++;
        timers.set(id, {
            id,
            callback,
            args,
            interval,
            raf,
            at: now + Math.max(0, Number(delay) || 0),
        });
        return id;
    }

    function replace(name, value) {
        originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }

    const clock = {
        get now() { return now; },
        get pendingCount() { return timers.size; },
        get nextTimerAt() {
            return Math.min(Infinity, ...Array.from(timers.values(), (timer) => timer.at));
        },
        flush,
        install() {
            if (installedClock) throw new Error('Virtual attempts must run serially within one process');
            const NativeDate = globalThis.Date;
            function VirtualDate(...args) {
                if (!new.target) return new NativeDate(epochMs + now).toString();
                return new NativeDate(...(args.length ? args : [epochMs + now]));
            }
            VirtualDate.prototype = NativeDate.prototype;
            Object.setPrototypeOf(VirtualDate, NativeDate);
            VirtualDate.now = () => Math.floor(epochMs + now);
            replace('Date', VirtualDate);
            const virtualPerformance = Object.create(globalThis.performance || null);
            Object.defineProperty(virtualPerformance, 'now', { value: () => now });
            replace('performance', virtualPerformance);
            replace('setTimeout', (callback, delay, ...args) => schedule(callback, delay, args));
            replace('clearTimeout', (id) => timers.delete(id));
            replace('setInterval', (callback, delay, ...args) => {
                const interval = Math.max(1, Number(delay) || 0);
                return schedule(callback, interval, args, interval);
            });
            replace('clearInterval', (id) => timers.delete(id));
            replace('requestAnimationFrame', (callback) => {
                const nextFrame = (Math.floor((now + 1e-7) / FRAME_MS) + 1) * FRAME_MS;
                return schedule(callback, nextFrame - now, [], null, true);
            });
            replace('cancelAnimationFrame', (id) => timers.delete(id));
            installed = true;
            installedClock = clock;
            return clock;
        },
        async advance(ms) {
            const target = now + Math.max(0, Number(ms) || 0);
            let calls = 0;
            await flush();
            while (clock.nextTimerAt <= target + 1e-7) {
                const next = Array.from(timers.values())
                    .filter((timer) => timer.at <= target + 1e-7)
                    .sort((a, b) => a.at - b.at || a.id - b.id)[0];
                if (!next) break;
                if (++calls > 100000) throw new Error('Virtual timer callback limit exceeded');
                now = Math.max(now, next.at);
                if (next.interval === null) timers.delete(next.id);
                else next.at += next.interval;
                next.callback(...(next.raf ? [now] : next.args));
                // Async physics schedules its next wait from promise continuations.
                await flush();
            }
            now = target;
            await flush();
        },
        async settle(promise, { maxCallbacks = 100000 } = {}) {
            let settled = false;
            let value;
            let failure;
            Promise.resolve(promise).then(
                (result) => { value = result; settled = true; },
                (error) => { failure = error; settled = true; },
            );
            for (let count = 0; !settled && count < maxCallbacks; count++) {
                await flush();
                if (settled) break;
                if (!Number.isFinite(clock.nextTimerAt)) {
                    throw new Error('Physics drain stalled without a scheduled virtual timer');
                }
                await clock.advance(Math.max(0, clock.nextTimerAt - now));
            }
            if (!settled) throw new Error('Physics drain exceeded virtual timer budget');
            if (failure) throw failure;
            return value;
        },
        restore() {
            if (!installed) return;
            timers.clear();
            for (const [name, descriptor] of originals) {
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else delete globalThis[name];
            }
            installed = false;
            installedClock = null;
        },
    };
    return clock;
}
