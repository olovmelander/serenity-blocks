// @ts-check
/** Short feeding bouts and independent ear movements, sampled directly from the board clock. */
function variation(key) {
    const a = Math.imul(key ^ (key >>> 16), 0x21f0aaad);
    const b = Math.imul(a ^ (a >>> 15), 0x735a2d97);
    return ((b ^ (b >>> 15)) >>> 0) / 4294967296;
}

/** A pulse that starts and ends at rest, including at a boundary between two bouts. */
function pulse(u) {
    if (u <= 0 || u >= 1) return 0;
    const arc = 4 * u * (1 - u);
    return arc * arc * arc;
}

function earFlick(clock, period, seed) {
    const slot = Math.floor(clock / period);
    const choice = variation(seed + slot);
    const start = (slot * period) + 0.2 + (choice * (period - 1.3));
    const duration = 0.72 + (0.2 * variation(seed - slot - 1));
    return (0.7 + (0.3 * choice)) * pulse((clock - start) / duration);
}

export function createGrazingPose() {
    return {
        pluck: 0, chew: 0, sweep: 0, swallow: 0, earL: 0, earR: 0,
    };
}

/** A muzzle works across a patch for a few bites, then rests. Its ears can turn at any time. */
export function sampleGrazing(time, seed, size, tempo, out) {
    // The hind and calf at the tarn share a path seed but feed at different times.
    const individual = Math.imul(seed, 397) + Math.round(size * 1000);
    const offset = 37 * variation(individual);
    const clock = (time * tempo * (0.93 + (0.14 * variation(individual + 1)))) + offset;
    const slot = Math.floor(clock / 6.6);
    const choice = Math.imul(slot, 11) + individual;
    const age = clock - (slot * 6.6) - 0.15 - variation(choice + 2);
    const interval = 0.86 + (0.24 * variation(choice + 3));
    const bites = 2 + Math.floor(3 * variation(choice + 4));
    const beat = age / interval;
    const u = beat - Math.floor(beat);
    const feeding = beat >= 0 && beat < bites;
    out.chew = feeding ? pulse((u - 0.04) / 0.9) : 0;
    out.pluck = feeding ? pulse((u - 0.23) / 0.77) : 0;
    out.sweep = pulse(beat / bites) * ((2 * variation(choice + 5)) - 1);
    out.swallow = pulse((age - (bites * interval)) / 0.85);
    out.earL = earFlick(time + offset, 4.7, individual + 37);
    out.earR = earFlick(time - offset, 5.3, individual + 71);
    return out;
}
