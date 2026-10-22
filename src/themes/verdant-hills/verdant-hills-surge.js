/**
 * Verdant Hills — the day builds with play.
 *
 * VerdantHillsReactions answers each event and carries how hot play runs (`frame.surge`, from
 * src/themes/shared/gameplay-surge.js: `level` 0..1, `fever` 0..1, `stage` calm/warm/hot/fever,
 * `punch` the momentary kick) and Reduce motion's share (`frame.still`). This is where the hills
 * spend them: one pure function that reads a reactions frame and writes what the world wears
 * this frame into an object it keeps, so the light, the lens, the kites, the birds, the whirl
 * and the windmill all build from the same numbers.
 *
 *   calm   as it always was: an event answered, then the breeze again
 *   warm   the downs take notice: the grass runs with light, the butterflies lift, the kites
 *          climb their lines
 *   hot    alive with the player: the whirl keeps turning round the board between clears, the
 *          swallows wheel, the light warms and the gusts come harder, the wind starts to clear
 *          the haze off the valley and the iris closes a little, so the greens stay deep
 *   fever  the kite day at full stretch: the gale rises past the dial and the cloud shadows race
 *          over a valley swept clear to the far hills,
 *          the kites stand at the top of their lines swinging wide, the whirl stands tall in the
 *          kites' colours and fed thick with seed, the swallows high, the cumulus thins and (in
 *          the reactions) a break in the clouds is held open over the valley
 *
 * Every floor here starts above casual play, so a lock now and then leaves the day exactly as
 * it was. Nothing here is a flash: what it adds rises and falls with the surge, over seconds.
 * Under Reduce motion everything that MOVES (gusts, gale, the wind dial, birds, butterflies,
 * the whirl's spin and seed, ribbons) is calmed to VERDANT_HILLS_STILL_MOTION of itself; the
 * light still builds.
 */

/** What Reduce motion leaves of the day's motion. */
export const VERDANT_HILLS_STILL_MOTION = 0.35;

const unit = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);
const smooth = (low, high, value) => {
    const t = unit((value - low) / (high - low));
    return t * t * (3 - 2 * t);
};

/** A fresh object for wearVerdantHillsFrame to fill, frame after frame. */
export function createVerdantHillsWorn() {
    return {
        epoch: 0,
        settled: false,
        kites: null,
        kiteTug: null,
        emitters: null,
        waves: null,
        streaks: null,
        front: null,
        fronts: null,
        sunbreak: null,
        festival: 0,
        aloft: 0,
        streak: 0,
        wind: 0,
        gale: 0,
        gust: 0,
        warmth: 0,
        glow: 0,
        shimmer: 0,
        shafts: 0,
        flock: 0,
        flutter: 0,
        height: 0,
        whirl: 0,
        heat: 0,
        streamers: 0,
        feed: 1,
        coverShift: 0,
        clearAir: 0,
        iris: 0,
        saturation: 0,
        level: 0,
        fever: 0,
        stage: 0,
        punch: 0,
        motion: 1,
    };
}

/**
 * What the world wears this frame: the reactions frame with the surge spent on it. Writes into
 * `worn` (and returns it); allocates nothing.
 * @param {object} [frame] a VerdantHillsReactions frame
 * @param {object} [worn] from createVerdantHillsWorn()
 */
export function wearVerdantHillsFrame(frame = {}, worn = createVerdantHillsWorn()) {
    const source = frame || {};
    const surge = source.surge || {};
    const level = unit(surge.level);
    const fever = unit(surge.fever);
    const punch = unit(surge.punch);
    const motion = 1 - (1 - VERDANT_HILLS_STILL_MOTION) * unit(source.still);
    const warm = smooth(0.2, 0.5, level);
    const hot = smooth(0.45, 0.85, level);
    const out = worn;
    out.epoch = source.epoch;
    out.settled = source.settled === true;
    out.kites = source.kites;
    out.kiteTug = source.kiteTug;
    out.emitters = source.emitters;
    out.waves = source.waves;
    out.streaks = source.streaks;
    out.front = source.front ?? null;
    out.fronts = source.fronts ?? null;
    out.sunbreak = source.sunbreak ?? null;
    out.festival = unit(source.festival);
    out.aloft = Number.isFinite(source.aloft) ? source.aloft : 0;
    out.streak = Number.isFinite(source.streak) ? source.streak : 0;
    out.level = level;
    out.fever = fever;
    out.stage = Number.isInteger(surge.stage) ? surge.stage : 0;
    out.punch = punch;
    out.motion = motion;
    // The air: the dial as it was, and a gale on top of it that only hot play raises.
    out.wind = unit(source.wind) * motion;
    out.gale = (0.3 * hot + 0.7 * fever) * motion;
    out.gust = unit(Math.max(unit(source.gust), 0.2 * hot + 0.2 * fever) + 0.15 * punch) * motion;
    // The light: warmer, the grass running with it, the seed glinting; the iris closes against it.
    out.warmth = Math.max(unit(source.warmth), 0.15 * warm + 0.15 * hot + 0.2 * fever);
    out.glow = Math.max(unit(source.glow), 0.2 * hot + 0.3 * fever);
    out.shimmer = Math.max(unit(source.shimmer), 0.25 * warm + 0.2 * hot + 0.3 * fever);
    out.shafts = Math.max(unit(source.shafts), 0.12 * hot + 0.2 * fever);
    out.iris = 0.02 * warm + 0.03 * hot + 0.04 * fever;
    out.saturation = 0.05 * hot + 0.07 * fever;
    // The cumulus thins in a fever (a share of the sky), so the valley lies in broken sun, and the
    // rising wind clears the air: the far hills stand sharp and green instead of fading pale.
    out.coverShift = fever > 0 ? -0.07 * fever : 0;
    out.clearAir = 0.3 * hot + 0.5 * fever;
    // What lives here: birds up, butterflies lifting, kites climbing their lines.
    out.flock = Math.max(unit(source.flock), 0.3 * hot + 0.6 * fever) * motion;
    out.flutter = Math.max(unit(source.flutter), 0.3 * warm + 0.2 * hot + 0.3 * fever) * motion;
    out.height = Math.max(unit(source.height), 0.35 * warm + 0.3 * hot + 0.35 * fever);
    // The whirl keeps turning between clears once play is hot, and stands tall in a fever.
    const whirl = Math.max(unit(source.whirl), 0.35 * hot + 0.55 * fever);
    out.whirl = whirl;
    out.heat = unit(Math.max(unit(source.heat), (whirl - 0.5) / 0.42) + 0.25 * fever);
    out.streamers = Math.max(unit(source.streamers), unit((whirl - 0.3) / 0.5));
    out.feed = 1 + 0.8 * fever;
    return out;
}
