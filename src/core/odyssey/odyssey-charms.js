// @ts-check

/**
 * Odyssey charms: gathered along the road, three carried at a time.
 *
 * A charm is a passive taken once and kept: an id, a name, a kind and one line. The catalogue
 * fits this road's stars, deadlines, rubble and rivals, and the road is authored: each chapter's
 * arrival offers the three charms that suit its orbs (ODYSSEY_CHAPTER_CHARMS), and the road's
 * mercy, after the third fall on one orb, offers the charms that would ease that very orb.
 *
 * What is gathered stays in the bag for the rest of the journey. Up to three charms are
 * carried onto an orb (ODYSSEY_CHARM_SLOTS), chosen on the map, so the late chapters keep the
 * challenge they were authored with and the choice of what to carry is the player's. Nothing
 * here touches a game state: `applyOdysseyCharmsToLevel` writes the goal, safety and pace
 * charms into the orb the engine is configured with, and core/odyssey/odyssey-charm-effects.js
 * pays the score charms during play.
 */

/**
 * @typedef {Object} OdysseyCharm
 * @property {string} id
 * @property {string} name
 * @property {string} line one sentence for the draft card
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
/** Charms carried onto an orb at once. */
export const ODYSSEY_CHARM_SLOTS = 3;
/** A draft offers this many. */
export const ODYSSEY_CHARM_DRAFT_SIZE = 3;
/** The road's mercy: a draft after this many falls on one orb. */
export const ODYSSEY_MERCY_FALLS = 3;

/**
 * Each chapter's arrival offers the charms that suit the road ahead, in this order. The early
 * chapters teach the three kinds; a chapter with deadlines offers Long Breath, one deep in rubble
 * Low Tide, a fast one Still Air, a scoring one the points charms. Every charm is offered in at
 * least two chapters, so a pass is never a loss.
 * @type {Readonly<Record<number, readonly string[]>>}
 */
export const ODYSSEY_CHAPTER_CHARMS = Object.freeze({
    1: ['kindle', 'keel', 'hearth'], // Earth Core: the first cascades, the first wall, the first fall
    2: ['low-tide', 'kindle', 'hearth'], // Deep Ocean: rubble five and eight deep, cascade goals
    3: ['long-breath', 'swell', 'keel'], // Surface World: the first deadline, long line goals
    4: ['still-air', 'swell', 'low-tide'], // Mountains: the pace quickens, rubble returns
    5: ['long-breath', 'afterglow', 'keel'], // Sky: two deadlines, score goals, a showcase boss
    6: ['kindle', 'long-breath', 'still-air'], // Space: fourteen orbs, three timed, big scores
    7: ['low-tide', 'hearth', 'afterglow'], // Black Hole: rubble ten and thirty deep, the longest asks
    8: ['swell', 'keel', 'still-air'], // Urban Encore: one last electric dream, fast and scored
});

/** @param {string} id */
export function odysseyCharmById(id) {
    return ODYSSEY_CHARMS.find((charm) => charm.id === id) || null;
}

/** The charm objects for a list of ids, unknown ids dropped. @param {readonly string[]} [ids] */
export function describeOdysseyCharms(ids) {
    return (ids || []).map((id) => odysseyCharmById(id)).filter(Boolean);
}

/** The draft key of a chapter's arrival. @param {number} chapterId */
export const odysseyChapterDraftKey = (chapterId) => `chapter:${chapterId}`;
/** The draft key of an orb's mercy. @param {number} levelId */
export const odysseyMercyDraftKey = (levelId) => `orb:${levelId}`;

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
 * Whether a charm eases this orb: changes what it asks, lengthens its clock, clears its rubble,
 * slows its fall or forgives a top-out. The points charms never do; they pay.
 * @param {object | undefined} level the authored orb
 * @param {string} charmId
 */
export function odysseyCharmEases(level, charmId) {
    const primary = level?.victory?.primary;
    switch (charmId) {
    case 'keel':
        return Boolean(primary && PRIMARY_METRIC[primary.type]) && keelTarget(primary.type, primary.target) !== primary.target;
    case 'long-breath':
        return level?.victory?.failure?.type === 'time' && Number.isFinite(level.victory.failure.value);
    case 'low-tide':
        return (Number(level?.mechanics?.board?.startingRows) || 0) > 0;
    case 'still-air':
    case 'hearth':
        return true;
    default:
        return false;
    }
}

/**
 * The charms a chapter's arrival offers now: the chapter's own three, less what the bag already
 * holds, topped up from the catalogue so the arrival offers three while charms remain.
 * @param {number} chapterId
 * @param {readonly string[]} gathered
 * @returns {string[]} charm ids
 */
export function odysseyChapterCharms(chapterId, gathered) {
    const authored = ODYSSEY_CHAPTER_CHARMS[chapterId] || [];
    const offered = authored.filter((id) => !gathered.includes(id));
    for (const charm of ODYSSEY_CHARMS) {
        if (offered.length >= ODYSSEY_CHARM_DRAFT_SIZE) break;
        if (!gathered.includes(charm.id) && !offered.includes(charm.id)) offered.push(charm.id);
    }
    return offered.slice(0, ODYSSEY_CHARM_DRAFT_SIZE);
}

/**
 * The road's mercy for an orb: the charms that would ease this orb and are not yet in the bag,
 * the most particular first (its clock, its rubble, its ask), then the ones that help anywhere.
 * @param {object | undefined} level the authored orb
 * @param {readonly string[]} gathered
 * @returns {string[]} charm ids, possibly fewer than a full draft
 */
export function odysseyMercyCharms(level, gathered) {
    return ['long-breath', 'low-tide', 'keel', 'hearth', 'still-air']
        .filter((id) => !gathered.includes(id) && odysseyCharmEases(level, id))
        .slice(0, ODYSSEY_CHARM_DRAFT_SIZE);
}

/**
 * @typedef {Object} OdysseyCharmState
 * @property {string[]} gathered charm ids, in the order taken; the bag
 * @property {string[]} carried the charms carried onto the next orb, in the order taken up
 * @property {Record<string, string | null>} drafts settled drafts: the charm taken, or null for a pass
 * @property {Record<string, number>} falls attempts lost per orb id this journey
 */

/** @returns {OdysseyCharmState} */
export function createOdysseyCharmState() {
    return {
        gathered: [], carried: [], drafts: {}, falls: {},
    };
}

const whole = (value) => Math.max(0, Math.floor(Number(value) || 0));
const knownUnique = (ids) => [...new Set((Array.isArray(ids) ? ids : []).filter((id) => odysseyCharmById(id)))];

/**
 * A saved charm state made whole: unknown charms dropped, the carried charms a subset of the
 * bag and never more than the slots, counts whole. A save that only names what was gathered
 * carries the last three taken.
 */
export function normalizeOdysseyCharmState(raw) {
    const state = createOdysseyCharmState();
    state.gathered = knownUnique(Array.isArray(raw?.gathered) ? raw.gathered : raw?.owned);
    state.carried = Array.isArray(raw?.carried)
        ? knownUnique(raw.carried).filter((id) => state.gathered.includes(id)).slice(-ODYSSEY_CHARM_SLOTS)
        : state.gathered.slice(-ODYSSEY_CHARM_SLOTS);
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
 * @typedef {Object} OdysseyCharmDraft
 * @property {string} key
 * @property {OdysseyCharm[]} charms
 */

/**
 * A chapter arrival's draft: null once it was taken or passed, or when the bag holds every charm.
 * @param {OdysseyCharmState} state
 * @param {number} chapterId
 * @returns {OdysseyCharmDraft | null}
 */
export function odysseyChapterDraft(state, chapterId) {
    const key = odysseyChapterDraftKey(chapterId);
    if (!state || key in state.drafts) return null;
    const charms = describeOdysseyCharms(odysseyChapterCharms(chapterId, state.gathered));
    return charms.length ? { key, charms } : null;
}

/**
 * The road's mercy for an orb: once it has been fallen on three times, the charms that would
 * ease it; null when the bag already holds them all, or once the draft was taken or passed.
 * @param {OdysseyCharmState} state
 * @param {object} [level] the authored orb
 * @param {number} [levelId] the orb's id when no orb is at hand
 * @returns {OdysseyCharmDraft | null}
 */
export function odysseyMercyDraft(state, level, levelId = level?.id) {
    const key = odysseyMercyDraftKey(levelId);
    if (!state || key in state.drafts || whole(state.falls[String(levelId)]) < ODYSSEY_MERCY_FALLS) return null;
    const charms = describeOdysseyCharms(odysseyMercyCharms(level, state.gathered));
    return charms.length ? { key, charms } : null;
}

/**
 * Carry a charm from the bag. When the slots are full the charm carried longest is set down.
 * @param {OdysseyCharmState} state
 * @param {string} charmId
 * @returns {string | null} the charm set down, if any
 */
export function carryOdysseyCharm(state, charmId) {
    if (state.carried.includes(charmId)) return null;
    state.carried.push(charmId);
    return state.carried.length > ODYSSEY_CHARM_SLOTS ? state.carried.shift() : null;
}

/**
 * Take one charm of a draft: into the bag for the rest of the journey, and carried from here.
 * @param {OdysseyCharmState} state
 * @param {OdysseyCharmDraft | null} draft the draft as offered
 * @param {string} charmId
 * @returns {{ setDown: string | null } | null} what was set down to carry it, or null when refused
 */
export function takeOdysseyCharm(state, draft, charmId) {
    if (!state || !draft || draft.key in state.drafts) return null;
    if (!draft.charms.some((charm) => charm.id === charmId) || state.gathered.includes(charmId)) return null;
    state.gathered.push(charmId);
    state.drafts[draft.key] = charmId;
    return { setDown: carryOdysseyCharm(state, charmId) };
}

/** Pass a draft; that arrival or that orb's mercy is settled. @param {OdysseyCharmState} state */
export function passOdysseyCharm(state, draft) {
    if (!state || !draft || draft.key in state.drafts) return false;
    state.drafts[draft.key] = null;
    return true;
}

/**
 * Carry a gathered charm, or set a carried one down. Refused for a charm not in the bag, and
 * for a fourth charm while three are carried: setting one down is the player's call.
 * @param {OdysseyCharmState} state
 * @param {string} charmId
 * @returns {{ carried: boolean, refused: boolean }}
 */
export function toggleOdysseyCarriedCharm(state, charmId) {
    if (!state?.gathered.includes(charmId)) return { carried: false, refused: true };
    const index = state.carried.indexOf(charmId);
    if (index >= 0) {
        state.carried.splice(index, 1);
        return { carried: false, refused: false };
    }
    if (state.carried.length >= ODYSSEY_CHARM_SLOTS) return { carried: false, refused: true };
    state.carried.push(charmId);
    return { carried: true, refused: false };
}

/** One more fall on an orb. @param {OdysseyCharmState} state @returns {number} the orb's falls */
export function recordOdysseyFall(state, levelId) {
    const id = String(levelId);
    state.falls[id] = whole(state.falls[id]) + 1;
    return state.falls[id];
}

/**
 * The orb as the carried charms make it: the goal Keel lowers (and the star tier that mirrors
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
