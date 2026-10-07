/**
 * Deterministic network impairment harness for mock/local multiplayer tests.
 *
 * Percent fields are 0..100 for DevTools friendliness:
 * localStorage.setItem('serenity.netImpair',
 *   '{"enabled":true,"lossPct":5,"reorderPct":10,"minDelayMs":50,"maxDelayMs":150}')
 *
 * The two lanes are modelled the way Steam carries them. Unreliable packets can be
 * lost, reordered and duplicated. Reliable messages arrive once and in order: a
 * datagram the link loses (lossPct) costs a resend, about one round trip, and every
 * reliable message sent after it waits behind it. `reliableChaos` restores the old
 * stress mode in which reliable messages reorder and duplicate like unreliable ones;
 * `reliableLossPct` drops reliable messages outright, which Steam only does when the
 * connection itself is lost.
 */

export const DEFAULT_NETWORK_IMPAIRMENT = Object.freeze({
    enabled: false,
    seed: 1,
    lossPct: 0, // unreliable packets only
    reliableLossPct: 0,
    duplicatePct: 0,
    reorderPct: 0,
    minDelayMs: 0,
    maxDelayMs: 0,
    reorderDelayMs: 100,
    reliableDelayMs: 0,
    burstLossPct: 0, // unreliable packets only
    burstLength: 0,
    duplicateDelayMs: 1,
    reliableRetransmitMs: 0, // 0 = one round trip of the configured delay, at least 50 ms
    reliableChaos: false,
});

/** A reliable message resent this many times is late, not lost: stop rolling for loss. */
const MAX_RELIABLE_RESENDS = 3;
/** The mock transport's one-post-reaches-everyone target. */
const BROADCAST_TARGET = 'all';

const NETWORK_IMPAIRMENT_PRESETS = Object.freeze({
    off: { enabled: false },
    lossy: {
        enabled: true,
        lossPct: 5,
        reorderPct: 10,
        minDelayMs: 50,
        maxDelayMs: 150,
        seed: 1337,
    },
    burst: {
        enabled: true,
        lossPct: 2,
        burstLossPct: 8,
        burstLength: 4,
        minDelayMs: 40,
        maxDelayMs: 120,
        reorderPct: 8,
        seed: 4242,
    },
    badwifi: {
        enabled: true,
        lossPct: 8,
        duplicatePct: 2,
        reorderPct: 15,
        minDelayMs: 80,
        maxDelayMs: 240,
        burstLossPct: 5,
        burstLength: 3,
        seed: 9001,
    },
});

function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function parseBool(value, fallback = false) {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    if (typeof value !== 'string') return fallback;
    const lower = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(lower)) return true;
    if (['0', 'false', 'no', 'off'].includes(lower)) return false;
    return fallback;
}

function parseDelayRange(value) {
    if (Array.isArray(value)) {
        return {
            minDelayMs: clampNumber(value[0], 0, 10000, 0),
            maxDelayMs: clampNumber(value[1], 0, 10000, 0),
        };
    }
    if (typeof value === 'string') {
        const match = value.trim().match(/^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?$/);
        if (match) {
            return {
                minDelayMs: clampNumber(match[1], 0, 10000, 0),
                maxDelayMs: clampNumber(match[2] ?? match[1], 0, 10000, 0),
            };
        }
    }
    if (Number.isFinite(Number(value))) {
        const delay = clampNumber(value, 0, 10000, 0);
        return { minDelayMs: delay, maxDelayMs: delay };
    }
    return {};
}

function seedToUint32(seed) {
    if (Number.isFinite(Number(seed))) {
        const n = Number(seed) >>> 0;
        return n || 0x6d2b79f5;
    }
    const text = String(seed ?? 'serenity');
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
    }
    return hash || 0x6d2b79f5;
}

function readLocalStorageValue(key) {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage?.getItem(key) ?? null;
    } catch (err) {
        return null;
    }
}

function readSearchParams() {
    if (typeof window === 'undefined' || !window.location) return null;
    try {
        return new URLSearchParams(window.location.search || '');
    } catch (err) {
        return null;
    }
}

function parseConfigText(raw) {
    if (raw == null || raw === '') return {};
    const text = String(raw).trim();
    const preset = NETWORK_IMPAIRMENT_PRESETS[text.toLowerCase()];
    if (preset) return { ...preset };
    if (['1', 'true', 'yes', 'on'].includes(text.toLowerCase())) return { enabled: true };
    if (['0', 'false', 'no', 'off'].includes(text.toLowerCase())) return { enabled: false };
    if (text.startsWith('{')) {
        try {
            return JSON.parse(text);
        } catch (err) {
            return {};
        }
    }
    return {};
}

export function normalizeNetworkImpairmentConfig(config = {}) {
    const merged = {
        ...DEFAULT_NETWORK_IMPAIRMENT,
        ...config,
    };

    if (config.loss != null && config.lossPct == null) merged.lossPct = config.loss;
    if (config.dupPct != null && config.duplicatePct == null) merged.duplicatePct = config.dupPct;
    if (config.delayMs != null) Object.assign(merged, parseDelayRange(config.delayMs));
    if (config.delay != null) Object.assign(merged, parseDelayRange(config.delay));

    const minDelayMs = clampNumber(merged.minDelayMs, 0, 10000, 0);
    const maxDelayMs = clampNumber(merged.maxDelayMs, 0, 10000, minDelayMs);

    return {
        enabled: parseBool(merged.enabled, false),
        seed: merged.seed ?? 1,
        lossPct: clampNumber(merged.lossPct, 0, 100, 0),
        reliableLossPct: clampNumber(merged.reliableLossPct, 0, 100, 0),
        duplicatePct: clampNumber(merged.duplicatePct, 0, 100, 0),
        reorderPct: clampNumber(merged.reorderPct, 0, 100, 0),
        minDelayMs: Math.min(minDelayMs, maxDelayMs),
        maxDelayMs: Math.max(minDelayMs, maxDelayMs),
        reorderDelayMs: clampNumber(merged.reorderDelayMs, 0, 10000, 100),
        reliableDelayMs: clampNumber(merged.reliableDelayMs, 0, 10000, 0),
        burstLossPct: clampNumber(merged.burstLossPct, 0, 100, 0),
        burstLength: Math.floor(clampNumber(merged.burstLength, 0, 1000, 0)),
        duplicateDelayMs: clampNumber(merged.duplicateDelayMs, 0, 10000, 1),
        reliableRetransmitMs: clampNumber(merged.reliableRetransmitMs, 0, 10000, 0),
        reliableChaos: parseBool(merged.reliableChaos, false),
    };
}

export function readNetworkImpairmentConfig() {
    let config = parseConfigText(readLocalStorageValue('serenity.netImpair'));
    const params = readSearchParams();
    if (!params) return normalizeNetworkImpairmentConfig(config);

    if (params.has('netImpair')) {
        config = {
            ...config,
            ...parseConfigText(params.get('netImpair')),
            enabled: parseBool(params.get('netImpair'), true),
        };
    }

    const urlKeys = [
        ['netLoss', 'lossPct'],
        ['netReliableLoss', 'reliableLossPct'],
        ['netDup', 'duplicatePct'],
        ['netReorder', 'reorderPct'],
        ['netReliableDelay', 'reliableDelayMs'],
        ['netBurstLoss', 'burstLossPct'],
        ['netBurstLength', 'burstLength'],
        ['netSeed', 'seed'],
        ['netRetransmit', 'reliableRetransmitMs'],
        ['netReliableChaos', 'reliableChaos'],
    ];
    for (const [urlKey, configKey] of urlKeys) {
        if (params.has(urlKey)) config[configKey] = params.get(urlKey);
    }
    if (params.has('netDelay')) Object.assign(config, parseDelayRange(params.get('netDelay')));
    if (params.has('netMinDelay')) config.minDelayMs = params.get('netMinDelay');
    if (params.has('netMaxDelay')) config.maxDelayMs = params.get('netMaxDelay');

    return normalizeNetworkImpairmentConfig(config);
}

/**
 * Boot-time impairment gate (remediation plan §1.4). The harness is a dev/test
 * tool: a stale localStorage 'serenity.netImpair' left over from a test session
 * must never shape real Steam traffic. The live (localStorage/URL) config is
 * honored only in mock mode, dev builds, or with an explicit ?netImpair opt-in
 * in the URL; every other session gets the inert defaults.
 */
export function resolveImpairmentBootConfig({ mockMode = false, isDev = false, search = '' } = {}) {
    const explicitOptIn = /[?&]netImpair\b/.test(search);
    if (mockMode || isDev || explicitOptIn) return readNetworkImpairmentConfig();
    return DEFAULT_NETWORK_IMPAIRMENT;
}

export class NetworkImpairmentHarness {
    constructor(config = {}) {
        this.stats = this._newStats();
        this._burstRemaining = 0;
        this.setConfig(config);
    }

    setConfig(config = {}) {
        this.config = normalizeNetworkImpairmentConfig(config);
        this._rngState = seedToUint32(this.config.seed);
        this._burstRemaining = 0;
        /** When the last reliable message to each target is due: later ones queue behind it. */
        this._reliableTailAt = new Map();
        this.resetStats();
    }

    resetStats() {
        this.stats = this._newStats();
    }

    _newStats() {
        return {
            planned: 0,
            delivered: 0,
            dropped: 0,
            burstDropped: 0,
            duplicated: 0,
            delayed: 0,
            reordered: 0,
            reliableDelayed: 0,
            reliableResent: 0,
            reliableQueued: 0,
        };
    }

    getStats() {
        return {
            enabled: this.config.enabled,
            config: { ...this.config },
            ...this.stats,
            burstRemaining: this._burstRemaining,
        };
    }

    /**
     * @param {{channel?: number, delivery?: string, target?: string, nowMs?: number}} [packet]
     *   `target` and the sender's clock `nowMs` keep each target's reliable messages in order.
     */
    planDelivery({
        channel = 0, delivery = 'reliable', target = '', nowMs = 0,
    } = {}) {
        if (!this.config.enabled) {
            return { drop: false, deliveries: [{ delayMs: 0, duplicateIndex: 0 }] };
        }

        this.stats.planned += 1;
        const reliable = delivery === 'reliable' || (delivery == null && channel === 0);
        if (reliable && !this.config.reliableChaos) return this._planReliable(target, nowMs);
        const dropChance = reliable ? this.config.reliableLossPct : this.config.lossPct;

        if (!reliable && this._burstRemaining > 0) {
            this._burstRemaining -= 1;
            this.stats.dropped += 1;
            this.stats.burstDropped += 1;
            return { drop: true, reason: 'burst' };
        }

        if (!reliable && this.config.burstLength > 0 && this._chance(this.config.burstLossPct)) {
            this._burstRemaining = Math.max(0, this.config.burstLength - 1);
            this.stats.dropped += 1;
            this.stats.burstDropped += 1;
            return { drop: true, reason: 'burst_start' };
        }

        if (this._chance(dropChance)) {
            this.stats.dropped += 1;
            return { drop: true, reason: reliable ? 'reliable_loss' : 'loss' };
        }

        let delayMs = this._randomInt(this.config.minDelayMs, this.config.maxDelayMs);
        if (reliable && this.config.reliableDelayMs > 0) {
            delayMs += this.config.reliableDelayMs;
            this.stats.reliableDelayed += 1;
        }

        if (this._chance(this.config.reorderPct)) {
            delayMs += this.config.reorderDelayMs;
            this.stats.reordered += 1;
        }

        const duplicate = this._chance(this.config.duplicatePct);
        const deliveries = [{ delayMs, duplicateIndex: 0 }];
        if (duplicate) {
            this.stats.duplicated += 1;
            deliveries.push({
                delayMs: delayMs + this.config.duplicateDelayMs,
                duplicateIndex: 1,
            });
        }

        this.stats.delivered += deliveries.length;
        if (deliveries.some((item) => item.delayMs > 0)) this.stats.delayed += deliveries.length;
        return { drop: false, deliveries };
    }

    /**
     * A reliable message: once, in order. Each loss of its datagram adds a resend, and
     * it cannot overtake a reliable message to the same target that is still on its way.
     * @param {string} target
     * @param {number} nowMs
     */
    _planReliable(target, nowMs) {
        if (this._chance(this.config.reliableLossPct)) {
            this.stats.dropped += 1;
            return { drop: true, reason: 'reliable_loss' };
        }

        let delayMs = this._randomInt(this.config.minDelayMs, this.config.maxDelayMs);
        if (this.config.reliableDelayMs > 0) {
            delayMs += this.config.reliableDelayMs;
            this.stats.reliableDelayed += 1;
        }
        const resendMs = this.config.reliableRetransmitMs
            || Math.max(50, this.config.minDelayMs + this.config.maxDelayMs);
        for (let i = 0; i < MAX_RELIABLE_RESENDS && this._chance(this.config.lossPct); i += 1) {
            delayMs += resendMs;
            this.stats.reliableResent += 1;
        }

        const now = Number.isFinite(nowMs) ? nowMs : 0;
        // A broadcast ('all') reaches every target, so it queues behind every target's
        // messages and every later message to any target queues behind it.
        const key = String(target ?? '');
        const tails = this._reliableTailAt;
        const tailAt = key === BROADCAST_TARGET
            ? Math.max(-Infinity, ...tails.values())
            : Math.max(tails.get(key) ?? -Infinity, tails.get(BROADCAST_TARGET) ?? -Infinity);
        let deliverAt = Math.max(now + delayMs, tailAt);
        // A message still queued for this target is due no later than now: stay behind it.
        if (tailAt >= now && deliverAt <= now) deliverAt = now + 1;
        if (deliverAt > now + delayMs) this.stats.reliableQueued += 1;
        if (key === BROADCAST_TARGET) tails.forEach((_, other) => tails.set(other, deliverAt));
        tails.set(key, deliverAt);

        const deliveries = [{ delayMs: deliverAt - now, duplicateIndex: 0 }];
        this.stats.delivered += 1;
        if (deliveries[0].delayMs > 0) this.stats.delayed += 1;
        // `ordered`: the sender must hand these over in planned order, not by racing timers.
        return { drop: false, ordered: true, deliveries };
    }

    _chance(percent) {
        if (percent <= 0) return false;
        if (percent >= 100) return true;
        return this._random() * 100 < percent;
    }

    _randomInt(min, max) {
        const lo = Math.floor(Math.min(min, max));
        const hi = Math.floor(Math.max(min, max));
        if (hi <= lo) return lo;
        return lo + Math.floor(this._random() * (hi - lo + 1));
    }

    _random() {
        let x = this._rngState >>> 0;
        x ^= (x << 13) >>> 0;
        x ^= x >>> 17;
        x ^= (x << 5) >>> 0;
        this._rngState = x >>> 0;
        return this._rngState / 0x100000000;
    }
}
