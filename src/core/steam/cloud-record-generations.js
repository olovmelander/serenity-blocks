// Recovery slots are disjoint across devices. A legacy client cannot replace them by
// uploading its old shared snapshot. Read back the new slot before the old one is reused.
const PREFIX = 'records_v1_';
const FILE = /^records_v1_([a-z0-9-]+)_(highscores|stats|odyssey|unlocks|stillfall)_([012])\.json$/;
const kinds = new Set(['highscores','stats','odyssey','unlocks','stillfall']);
// Steam Remote Storage's text binding needs a text envelope. Compress larger snapshots
// before base64 encoding. Small files are kept readable for recovery.
async function encodePayload(text) {
    if (text.length < 4096 || typeof CompressionStream === 'undefined') return { payload: text };
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const payload = btoa(binary);
    return payload.length < text.length ? { encoding: 'gzip', payload } : { payload: text };
}
async function decodePayload(envelope) {
    if (!envelope.encoding) return envelope.payload;
    if (envelope.encoding !== 'gzip') throw new Error('Unknown Cloud encoding');
    const bytes = Uint8Array.from(atob(envelope.payload), (c) => c.charCodeAt(0));
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 64 * 1024 * 1024) throw new Error('Recovery file exceeds supported size');
            chunks.push(value);
        }
    } finally { await reader.cancel(); }
    return new Blob(chunks).text();
}
export function protectedFile(file) { return kinds.has(file.replace(/\.json$/, '')); }
export class CloudRecordGenerations {
    constructor({ service, device, hash, apply, quarantine, newer }) {
        Object.assign(this, { service, device, hash, apply, quarantine, newer });
        this.loaded = new Map();
        this.restoredFiles = new Set();
    }
    async inspect(name) {
        const remote = await this.service.cloudRead(name);
        if (!remote?.supported || remote.success === false) throw new Error('Recovery file unavailable');
        if (remote.data == null) return null;
        try {
            const envelope = JSON.parse(remote.data);
            if (Number(envelope?.version) > 1) { this.quarantine(name, remote.data); return { future: true }; }
            if (envelope.version !== 1 || !Number.isSafeInteger(envelope.generation) || envelope.generation < 1 || typeof envelope.payload !== 'string') throw new Error('Invalid generation');
            const payload = await decodePayload(envelope);
            if (await this.hash(payload) !== envelope.digest) throw new Error('Cloud checksum mismatch');
            if (this.newer?.(FILE.exec(name)?.[2] + '.json', JSON.parse(payload))) {
                this.quarantine(name, remote.data);
                return { future: true };
            }
            return { ...envelope, payload };
        } catch {
            this.quarantine(name, remote.data);
            return { damaged: true };
        }
    }
    async restore() {
        const files = await this.service.cloudList();
        if (!Array.isArray(files)) throw new Error('Could not enumerate Cloud recovery records');
        const groups = new Map();
        this.restoredFiles.clear();
        for (const { name } of files) {
            const match = FILE.exec(name);
            if (!match) continue;
            const group = match[1] + '_' + match[2];
            if (!groups.has(group)) groups.set(group, []);
            const envelope = await this.inspect(name);
            if (envelope?.future) return false;
            if (envelope && !envelope.damaged) groups.get(group).push({ ...envelope, name, file: match[2] + '.json' });
        }
        let healthy = true;
        for (const versions of groups.values()) {
            let applied = false;
            for (const v of versions.sort((a, b) => b.generation - a.generation)) {
                try {
                    if (this.loaded.get(v.name) !== v.digest) {
                        if (await this.apply(v.file, JSON.parse(v.payload)) === false) throw new Error('Incompatible recovery document');
                        this.loaded.set(v.name, v.digest);
                    }
                    this.restoredFiles.add(v.file);
                    applied = true;
                    break;
                } catch { this.quarantine(v.name, v.payload); }
            }
            healthy &&= applied;
        }
        return healthy;
    }
    async write(file, payload) {
        const kind = file.replace(/\.json$/, '');
        if (!kinds.has(kind) || !/^[a-z0-9-]{1,80}$/.test(this.device)) throw new Error('Invalid Cloud writer');
        const prefix = PREFIX + this.device + '_' + kind + '_';
        const names = [0, 1, 2].map((slot) => prefix + slot + '.json');
        const slots = await Promise.all(names.map((name) => this.inspect(name)));
        if (slots.some((s) => s?.future)) throw new Error('This save requires a newer game');
        if (slots.every((s) => s?.damaged)) throw new Error('Cloud recovery slots need repair');
        const digest = await this.hash(payload);
        const order = [0, 1, 2].sort((a, b) => (slots[b]?.generation || 0) - (slots[a]?.generation || 0));
        const previous = slots[order[0]];
        const same = slots.filter((s) => s?.digest === digest && s.generation === previous?.generation).length;
        if (same >= 2) return;
        const generation = previous?.digest === digest ? previous.generation : (previous?.generation || 0) + 1;
        const encoded = await encodePayload(payload);
        const json = JSON.stringify({ version: 1, generation, digest, ...encoded });
        const store = async (slot) => {
            const result = await this.service.cloudWrite(names[slot], json, { queueIfOffline: false });
            if (!result?.success || result.queued) throw new Error('Recovery write pending');
            const check = await this.inspect(names[slot]);
            if (check?.digest !== digest || check.generation !== generation) throw new Error('Could not verify recovery generation');
        };
        let copies = same;
        // Two checked copies of this PB, plus the last known good generation. A failed
        // mirror write leaves at least one current copy and at least one previous copy.
        for (const slot of order.reverse()) {
            if (slots[slot]?.generation === generation && slots[slot]?.digest === digest) continue;
            await store(slot);
            if (++copies >= 2) break;
        }
    }
}
