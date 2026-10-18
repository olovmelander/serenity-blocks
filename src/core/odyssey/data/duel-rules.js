/**
 * The one set of rules every Odyssey rival duel shares.
 *
 * A duel is the last orb of its chapter: the rival guards the way out. Every match is a race
 * to three knockouts, so a match is a few tense rounds rather than a quarter of an hour, and
 * the difficulty comes from the rival's tier and the chapter's gravity instead of its length.
 * Stars reward how cleanly the match was won: the win, the win with at most one top-out, and
 * a flawless win.
 */
export const ODYSSEY_DUEL_KNOCKOUTS = 3;

/** Both wells fall at the chapter's pace: gentle in the Earth's core, quick in the neon encore. */
export const ODYSSEY_DUEL_GRAVITY_BY_CHAPTER = Object.freeze([1000, 950, 900, 850, 800, 750, 700, 650]);

/** Two stars allow one top-out; three stars mean the rival never knocked you out. */
export const ODYSSEY_DUEL_STAR_TOP_OUTS = Object.freeze({ two: 1, three: 0 });

/** @param {number} chapter 1-based chapter id */
export function getOdysseyDuelGravity(chapter) {
    const index = Math.max(0, Math.min(ODYSSEY_DUEL_GRAVITY_BY_CHAPTER.length - 1, (Number(chapter) || 1) - 1));
    return ODYSSEY_DUEL_GRAVITY_BY_CHAPTER[index];
}

/** The goal line every surface shows for a duel. */
export function formatOdysseyDuelGoal(botName = 'the rival', knockouts = ODYSSEY_DUEL_KNOCKOUTS) {
    return `Defeat ${botName} · First to ${knockouts} knockouts`;
}

/** The rival's plate: who they are and how strong. */
export function formatOdysseyRival(botName, tier) {
    return `Rival · ${botName} · Tier ${tier}`;
}
