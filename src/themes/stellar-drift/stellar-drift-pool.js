/**
 * Stellar Drift — a fixed pool of timed events (three-free).
 *
 * The world keeps one pool per kind of event (ripples, chimes, jets, strikes, lightning). Nothing
 * is allocated at event time: a new event takes a free slot, or, when the pool is full, the slot
 * of the event with the least light left (so under fast play a bright one still running is never
 * wiped for a new one while a faded one lingers), and each frame the live ones are handed,
 * compacted, to whoever writes the shader's table.
 */

/** What an event has left at `time`: its strength, falling away over `fade` seconds. */
const fading = (fade) => (item, time) => {
    const age = time - item.birth;
    // One not yet born has all of its light still to come.
    if (age < 0) return (item.strength ?? 1) * 2;
    return (item.strength ?? 1) * Math.exp(-age / fade);
};

/** A fixed pool of timed events; when it is full the new one takes the dimmest one's place. */
export class EventPool {
    /**
     * @param {number} slots
     * @param {number} life     seconds an event is held at most
     * @param {() => object} make
     * @param {number|((item: object, time: number) => number)} [left] what an event has left at a
     *   time: a function, or the seconds its light takes to fall to 1/e (default: a third of its
     *   life, i.e. the oldest goes first among equals)
     */
    constructor(slots, life, make, left = life / 3) {
        this.life = life;
        this.left = typeof left === 'function' ? left : fading(left);
        this.items = Array.from({ length: slots }, () => ({ live: false, birth: -1e6, ...make() }));
    }

    reset() {
        for (let i = 0; i < this.items.length; i++) {
            this.items[i].live = false;
            this.items[i].birth = -1e6;
        }
    }

    /** The slot the next event goes in: a free one, else the one with the least light left. */
    take(birth) {
        let pick = null;
        let least = Infinity;
        for (let i = 0; i < this.items.length; i++) {
            const item = this.items[i];
            if (!item.live) {
                pick = item;
                break;
            }
            const left = this.left(item, birth);
            if (left < least || (left === least && item.birth < pick.birth)) {
                least = left;
                pick = item;
            }
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
