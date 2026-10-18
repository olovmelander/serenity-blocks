// @ts-check

/**
 * Odyssey charms: picked at the road's waystones and kept for the rest of the journey.
 *
 * A charm is a passive. Three pay points, four move the asks, one keeps an orb alive. The
 * shape (id, name, one line, kind) and two of the names are Waystones' (core/waystones/
 * charms.js), so a player who knows one mode knows the other; the catalogue is Odyssey's own
 * because this road has stars, deadlines, rubble and rivals rather than lanterns and banks.
 *
 * Where they are gathered: a draft of three at every chapter's arrival (take one or pass),
 * and the road's mercy, a draft after the third fall on one orb. Drafts are seeded by the
 * journey, so a draft offers the same three however often the player looks at it, and a
 * charm is never offered twice. Nothing here touches a game state: `applyOdysseyCharmsToLevel`
 * writes the goal, safety and pace charms into the orb the engine is configured with, and
 * core/odyssey/odyssey-charm-effects.js pays the score charms during play.
 */
import { pickDistinct, seededRng, freshSeed } from '../seeded-stream.js';

/**
 * @typedef {Object} OdysseyCharm
 * @property {string} id
 * @property {string} name
 * @property {string} line one sentence for the draft
 * @property {'score' | 'goal' | 'safety'} kind
 */

/** @type {readonly OdysseyCharm[]} */
export const ODYSSEY_CHARMS = Object.freeze([
    {
        id: 'kindle', name: 'Kindle', kind: 'score', line: 'A cascade two waves deep or more scores half again.',
    },
    {
        id: 'swell', name: 'Swell', kind: 'score', line: 'Three or four lines at once score 40% more.',
    },
    {
        id: 'afterglow', name: 'Afterglow', kind: 'score', line: 'A perfect clear pays 1,500 more.',
    },
    {
        id: 'keel',
        name: 'Keel',
        kind: 'goal',
        line: 'Every orb asks 15% less; a cascade or chain goal asks one fewer.',
    },
    {
        id: 'long-breath', name: 'Long Breath', kind: 'goal', line: 'A timed orb gives thirty more seconds.',
    },
    {
        id: 'still-air', name: 'Still Air', kind: 'goal', line: 'Pieces fall a quarter slower, on every orb.',
    },
    {
        id: 'low-tide', name: 'Low Tide', kind: 'goal', line: 'Every orb begins with two fewer rows of rubble.',
    },
    {
        id: 'hearth', name: 'Hearth', kind: 'safety', line: 'Once an orb, a top-out empties the well and play goes on.',
    },
]);

/** How a draft card names a charm's kind: what it does for the road, in a few words. */
export const ODYSSEY_CHARM_KIND_LABELS = Object.freeze({
    score: 'Pays points', goal: 'Eases the ask', safety: 'Keeps you in',
});

/** Kindle: the bonus share of a lock's clear points when its cascade ran this deep. */
export const KINDLE = Object.freeze({ wavesAtLeast: 2, bonusShare: 0.5 });
/** Swell: the bonus share when one wave cleared this many lines. */
export const SWELL = Object.freeze({ linesAtLeast: 3, bonusShare: 0.4 });
/** Afterglow: points a perfect clear pays on top of its own bonus. */
export const AFTERGLOW_BONUS = 1500;
/** Keel: line and score asks are this much less; a cascade or chain ask is one fewer. */
export const KEEL_FACTOR = 0.85;
/** Long Breath: seconds added to a deadline. */
export const LONG_BREATH_SECONDS = 30;
/** Still Air: the drop interval is this many times longer, through every level-up. */
export const STILL_AIR_FACTOR = 1.25;
/** Low Tide: rows of rubble an orb begins without. */
export const LOW_TIDE_ROWS = 2;
/** A draft offers this many. */
export const ODYSSEY_CHARM_DRAFT_SIZE = 3;
/** The road's mercy: a draft after this many falls on one orb. */
export const ODYSSEY_MERCY_FALLS = 3;

/** @param {string} id */
export function odysseyCharmById(id) {
    return ODYSSEY_CHARMS.find((charm) => charm.id === id) || null;
}

/** The charm objects for a list of ids, unknown ids dropped. @param {readonly string[]} ids */
export function describeOdysseyCharms(ids) {
    return (ids || []).map((id) => odysseyCharmById(id)).filter(Boolean);
}

/** The draft key of a chapter's arrival. @param {number} chapterId */
export const odysseyChapterDraftKey = (chapterId) => `chapter:${chapterId}`;
/** The draft key of an orb's mercy. @param {number} levelId */
export const odysseyMercyDraftKey = (levelId) => `orb:${levelId}`;

/**
 * The three charms a draft offers: seeded by the journey and the draft's key, never one the
 * player holds. Fewer when fewer remain; none when every charm is held.
 * @param {string} seed
 * @param {string} key
 * @param {readonly string[]} owned
 * @returns {string[]} charm ids
 */
export function draftOdysseyCharms(seed, key, owned, count = ODYSSEY_CHARM_DRAFT_SIZE) {
    const rng = seededRng(seed, `draft:${key}`);
    return pickDistinct(rng, ODYSSEY_CHARMS, count, (charm) => !owned.includes(charm.id)).map((charm) => charm.id);
}

/**
 * @typedef {Object} OdysseyCharmState
 * @property {string} seed the journey's draft seed
 * @property {string[]} owned charm ids, in the order taken
 * @property {Record<string, string | null>} drafts settled drafts: the charm taken, or null for a pass
 * @property {Record<string, number>} falls attempts lost per orb id this journey
 */

/** @returns {OdysseyCharmState} */
export function createOdysseyCharmState({ seed = freshSeed() } = {}) {
    return {
        seed: String(seed), owned: [], drafts: {}, falls: {},
    };
}

const whole = (value) => Math.max(0, Math.floor(Number(value) || 0));

/** A saved charm state made whole: unknown charms dropped, counts whole, a seed always present. */
export function normalizeOdysseyCharmState(raw) {
    const state = createOdysseyCharmState({ seed: typeof raw?.seed === 'string' && raw.seed ? raw.seed : undefined });
    const owned = Array.isArray(raw?.owned) ? raw.owned : [];
    state.owned = [...new Set(owned.filter((id) => odysseyCharmById(id)))];
    Object.entries(raw?.drafts || {}).forEach(([key, value]) => {
        if (value === null || odysseyCharmById(value)) state.drafts[key] = value;
    });
    Object.entries(raw?.falls || {}).forEach(([levelId, count]) => {
        const falls = whole(count);
        if (falls > 0) state.falls[levelId] = falls;
    });
    return state;
}

/**
 * The draft a key offers now: null once it was taken or passed, or when nothing is left.
 * @param {OdysseyCharmState} state
 * @param {string} key
 * @returns {{ key: string, charms: OdysseyCharm[] } | null}
 */
export function odysseyCharmDraft(state, key) {
    if (!state || key in state.drafts) return null;
    const charms = describeOdysseyCharms(draftOdysseyCharms(state.seed, key, state.owned));
    return charms.length ? { key, charms } : null;
}

/**
 * Take one charm of a draft and keep it for the rest of the road.
 * @param {OdysseyCharmState} state
 * @returns {boolean} whether the charm was in the draft and is now held
 */
export function takeOdysseyCharm(state, key, charmId) {
    const draft = odysseyCharmDraft(state, key);
    if (!draft || !draft.charms.some((charm) => charm.id === charmId)) return false;
    state.owned.push(charmId);
    state.drafts[key] = charmId;
    return true;
}

/** Pass a draft; it is not offered again. @param {OdysseyCharmState} state */
export function passOdysseyCharm(state, key) {
    if (!state || key in state.drafts) return false;
    state.drafts[key] = null;
    return true;
}

/** One more fall on an orb. @param {OdysseyCharmState} state @returns {number} the orb's falls */
export function recordOdysseyFall(state, levelId) {
    const id = String(levelId);
    state.falls[id] = whole(state.falls[id]) + 1;
    return state.falls[id];
}

/** The road's mercy for an orb: its draft once it has been fallen on three times. */
export function odysseyMercyDraft(state, levelId) {
    if (!state || whole(state.falls[String(levelId)]) < ODYSSEY_MERCY_FALLS) return null;
    return odysseyCharmDraft(state, odysseyMercyDraftKey(levelId));
}

const PRIMARY_METRIC = Object.freeze({
    lines: 'lines', score: 'score', cascade: 'cascades', combo: 'combo',
});

/** Keel's ask for a goal: 15% less for lines and points, one fewer for a cascade or chain. */
export function keelTarget(type, target) {
    const authored = Number(target) || 0;
    if (type === 'lines' || type === 'score') return Math.max(1, Math.ceil(authored * KEEL_FACTOR));
    if (type === 'cascade' || type === 'combo') return Math.max(1, authored - 1);
    return authored;
}

/**
 * The orb as the held charms make it: the goal Keel lowers (and the star tier that mirrors
 * it), the deadline Long Breath lengthens, the rubble Low Tide clears, the pace Still Air
 * slows. Pure; the authored orb is untouched. Without charms the orb is returned as is.
 * @param {object} level the authored orb (a registry level or its presentation)
 * @param {readonly string[]} charmIds
 */
export function applyOdysseyCharmsToLevel(level, charmIds) {
    const charms = (charmIds || []).filter((id) => odysseyCharmById(id));
    if (!level || charms.length === 0) return level;
    const has = (id) => charms.includes(id);
    const next = {
        ...level,
        victory: { ...level.victory, primary: { ...level.victory?.primary }, failure: { ...level.victory?.failure } },
        mechanics: {
            ...level.mechanics,
            board: { ...level.mechanics?.board },
            speed: { ...level.mechanics?.speed },
        },
        stars: { ...level.stars },
        charms,
    };
    const { primary, failure } = level.victory || {};
    if (has('keel') && primary && PRIMARY_METRIC[primary.type]) {
        const target = keelTarget(primary.type, primary.target);
        if (target !== primary.target) {
            next.victory.primary.target = target;
            const metric = PRIMARY_METRIC[primary.type];
            // The tier that mirrors the goal follows it; higher asks stay the challenge they were.
            Object.entries(level.stars || {}).forEach(([tier, condition]) => {
                if (condition?.[metric] === primary.target) next.stars[tier] = { ...condition, [metric]: target };
            });
        }
    }
    if (has('long-breath') && failure?.type === 'time' && Number.isFinite(failure.value)) {
        next.victory.failure.value = failure.value + LONG_BREATH_SECONDS;
    }
    const rubble = Number(level.mechanics?.board?.startingRows) || 0;
    if (has('low-tide') && rubble > 0) next.mechanics.board.startingRows = Math.max(0, rubble - LOW_TIDE_ROWS);
    if (has('still-air')) {
        next.mechanics.speed.paceFactor = (Number(level.mechanics?.speed?.paceFactor) || 1) * STILL_AIR_FACTOR;
    }
    return next;
}
