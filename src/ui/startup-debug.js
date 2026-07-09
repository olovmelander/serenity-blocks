import { performanceMonitor } from '../utils/performance-monitor.js';

const TRACE_KEY = '__serenityStartupTrace';
const DEBUG_STORAGE_KEY = 'serenity.startupDebug';
const MAX_TRACE_ENTRIES = 400;

function getNowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? Math.round(performance.now() * 10) / 10
        : Date.now();
}

function getTraceStore(target = globalThis.window) {
    if (!target) return null;
    if (!Array.isArray(target[TRACE_KEY])) {
        target[TRACE_KEY] = [];
    }
    return target[TRACE_KEY];
}

export function isStartupDebugEnabled() {
    try {
        if (globalThis.__SERENITY_STARTUP_DEBUG__ === true) return true;
        if (typeof window === 'undefined') return false;
        const params = new URLSearchParams(window.location.search || '');
        if (params.get('startupDebug') === '1') return true;
        return window.localStorage?.getItem(DEBUG_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

function setStartupDebugEnabled(enabled) {
    globalThis.__SERENITY_STARTUP_DEBUG__ = Boolean(enabled);
    try {
        if (typeof window !== 'undefined') {
            if (enabled) {
                window.localStorage?.setItem(DEBUG_STORAGE_KEY, '1');
            } else {
                window.localStorage?.removeItem(DEBUG_STORAGE_KEY);
            }
        }
    } catch {
        // Storage may be unavailable; the in-memory flag above is enough.
    }
}

export function installStartupDebug() {
    if (typeof window === 'undefined') return null;
    if (window.startupDebug) return window.startupDebug;

    const api = {
        enable() {
            setStartupDebugEnabled(true);
            console.log('[StartupDebug] enabled');
            return this.status();
        },
        disable() {
            setStartupDebugEnabled(false);
            console.log('[StartupDebug] disabled');
            return this.status();
        },
        status() {
            return {
                enabled: isStartupDebugEnabled(),
                entries: getTraceStore()?.length || 0,
                storageKey: DEBUG_STORAGE_KEY,
            };
        },
        clear() {
            const trace = getTraceStore();
            if (trace) trace.length = 0;
            return this.status();
        },
        dump(limit = MAX_TRACE_ENTRIES) {
            const trace = getTraceStore() || [];
            const count = Number.isFinite(limit) && limit > 0 ? limit : MAX_TRACE_ENTRIES;
            return trace.slice(-count);
        },
        table(limit = 80) {
            const rows = this.dump(limit).map((entry) => ({
                t: entry.t,
                phase: entry.phase,
                ...entry.payload,
            }));
            console.table(rows);
            return rows;
        },
        events(limit = 120) {
            return performanceMonitor
                .getRecentRuntimeEvents(limit)
                .filter((entry) => entry.type === 'startup_trace' || entry.type.startsWith('startup_'));
        },
        copy(limit = MAX_TRACE_ENTRIES) {
            const text = JSON.stringify(this.dump(limit), null, 2);
            navigator.clipboard?.writeText?.(text);
            return text;
        },
    };

    window.startupDebug = api;
    return api;
}

export function markStartup(phase, payload = {}, options = {}) {
    const entry = {
        phase,
        t: getNowMs(),
        timestamp: new Date().toISOString(),
        payload,
    };

    const trace = getTraceStore();
    if (trace) {
        trace.push(entry);
        if (trace.length > MAX_TRACE_ENTRIES) {
            trace.splice(0, trace.length - MAX_TRACE_ENTRIES);
        }
    }

    if (options.performanceEvent !== false) {
        performanceMonitor.recordEvent('startup_trace', {
            phase,
            ...payload,
        });
    }

    if (isStartupDebugEnabled()) {
        let method = 'log';
        if (options.level === 'warn') {
            method = 'warn';
        } else if (options.level === 'error') {
            method = 'error';
        }
        console[method](`[StartupTrace] ${phase}`, payload);
    }

    return entry;
}

installStartupDebug();
