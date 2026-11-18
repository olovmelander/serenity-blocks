import { assessRecords, recordOwner } from '../progression/record-book.js';
import { STAT_NAMES, isScoreInt } from './steam-catalogue.js';

const WINDOW = 600000;
export class RecordPublisher {
    constructor(service, invoke, storage, now = Date.now) {
        Object.assign(this, { service, invoke, storage, now });
        this.cloudOwner = null;
        this.bests = {};
        this.pending = null;
        this.dirty = false;
    }
    get owner() { return recordOwner(this.service); }
    get key() { return 'steam-records-v1/' + this.owner; }
    state() {
        const raw = this.storage?.getItem(this.key);
        if (!raw) return {};
        try { return JSON.parse(raw) || {}; } catch { this.storage.setItem(this.key + '/recovery', raw); return { share: false }; }
    }
    save(change) {
        if (!this.storage || !this.owner) throw new Error('No record profile available');
        this.storage.setItem(this.key, JSON.stringify({ ...this.state(), ...change }));
    }
    sharing() { return this.owner ? this.state().share ?? null : null; }
    setSharing(share) {
        this.save({ share: Boolean(share) });
        return this.flush();
    }
    isPending(name, score) {
        const best = this.bests[name];
        return Boolean(best && (score == null || score === best.score) && this.sharing() && this.state().ack?.[name] !== best.score);
    }
    flush() {
        this.dirty = true;
        if (!this.pending) this.pending = (async () => {
            while (this.dirty) { this.dirty = false; await this.sync(); }
        })().catch((e) => { this.lastError = e.message; }).finally(() => { this.pending = null; });
        return this.pending;
    }
    async sync() {
        const owner = this.owner;
        if (!this.manager) return;
        const current = () => owner === this.owner;
        let { recordBook: book } = await this.manager.getStatistics();
        if (!current() || !book) return;
        let result = assessRecords(book, owner);
        this.bests = result.bests;
        if (!owner || !this.service.isOnline || !this.invoke) return;
        const sendStats = async () => {
            if (!Object.keys(book.runs).length && !result.awards.length) return;
            if (this.cloudOwner !== owner || this.service.capabilities.cloud === false) {
                // Unlocks are idempotent even with Cloud disabled. Totals need the shared
                // baseline to reconcile independent offline finishes exactly.
                const signature = JSON.stringify(result.awards);
                if (result.awards.length && this.state().awarded !== signature) {
                    const ok = await this.invoke('steam:commitStats', { appId: this.service.appId, steamId: this.service.steamId,
                        values: {}, awards: result.awards });
                    if (ok === true && current()) this.save({ awarded: signature });
                }
                return;
            }
            if (!book.steamBase) {
                const base = await this.invoke('steam:getStats', STAT_NAMES);
                if (!current() || !STAT_NAMES.every((key) => isScoreInt(base?.[key]))) return;
                // Persist the pre-upgrade baseline before any native mutation.
                const saved = await this.manager.importStatistics({ recordBook: { steamBase: base, runs: {} } });
                book = saved.recordBook;
                // The baseline must reach this writer's Cloud generation before the first store.
                this.cloudOwner = null;
                this.onBaseline?.();
                return;
            }
            if (this.baselineConfirmed !== JSON.stringify(book.steamBase)) { this.onBaseline?.(); return; }
            result = assessRecords(book, owner);
            const signature = JSON.stringify([result.values, result.awards]);
            if (this.state().stored === signature) return;
            const ack = await this.invoke('steam:commitStats', { appId: this.service.appId, steamId: this.service.steamId,
                values: result.values, awards: result.awards });
            if (current() && ack === true) this.save({ stored: signature });
        };
        // A stats outage cannot prevent public boards, or vice versa.
        const stats = sendStats().catch((error) => { this.lastError = error.message; });
        try {
            for (const [name, best] of Object.entries(this.bests)) {
                if (!current() || this.sharing() !== true || !this.service.capabilities.leaderboards) break;
                const state = this.state();
                if (state.ack?.[name] === best.score || state.retry?.[name]?.after > this.now()) continue;
                const time = this.now();
                const budget = (state.uploads || []).filter((t) => t > time - WINDOW);
                if (budget.length >= 10) break;
                this.save({ uploads: [...budget, time] });
                const res = await this.invoke('steam:uploadScore', { leaderboardName: name, score: best.score,
                    scoreDetailsPacked: best.details, owner });
                if (!current()) break;
                if (!res?.success) {
                    this.lastError = res?.error || 'Score upload pending';
                    const retry = this.state().retry || {};
                    const tries = (retry[name]?.tries || 0) + 1;
                    retry[name] = { tries, after: time + Math.min(WINDOW, 2000 * 2 ** Math.min(tries, 9)) + Math.floor(Math.random() * 1000) };
                    this.save({ retry });
                    continue;
                }
                const retry = this.state().retry || {};
                delete retry[name];
                this.save({ retry, ack: { ...this.state().ack, [name]: best.score } });
                this.service.emit?.('steam:score-confirmed', { name, owner });
            }
        } finally { await stats; }
    }
}
