/**
 * Stellar Drift — a fixed pool of timed events (three-free).
 *
 * The world keeps one pool per kind of event (ripples, chimes, jets, strikes, lightning). Nothing
 * is allocated at event time: a new event takes a free slot, or the oldest one's when the pool is
 * full, and each frame the live ones are handed, compacted, to whoever writes the shader's table.
 */

/** A fixed pool of timed events; the newest takes the oldest one's place when it is full. */
export class EventPool {
    constructor(slots, life, make) {
        this.life = life;
        this.items = Array.from({ length: slots }, () => ({ live: false, birth: -1e6, ...make() }));
    }

    reset() {
        for (let i = 0; i < this.items.length; i++) {
            this.items[i].live = false;
            this.items[i].birth = -1e6;
        }
    }

    /** The slot the next event goes in: a free one, else the oldest. */
    take(birth) {
        let pick = this.items[0];
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            if (!item.live) {
                pick = item;
                break;
            }
            if (item.birth < pick.birth) pick = item;
        }
        pick.live = true;
        pick.birth = birth;
        return pick;
    }

    /** Retire what has outlived `life`, and hand every live event to `write(item, index)`. */
    flush(time, write) {
        let count = 0;
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            if (!item.live) continue;
            if (time - item.birth > this.life) {
                item.live = false;
                continue;
            }
            write(item, count);
            count += 1;
        }
        return count;
    }
}
