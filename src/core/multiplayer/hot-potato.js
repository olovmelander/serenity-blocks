// @ts-check

/**
 * Hot potato (versus attack style 'hot_potato'), local and online alike.
 *
 * Teams take the potato in turn; without teams every player is a team of one. The order is a
 * shuffle of the teams that never hands the potato to the same team twice in a row, shuffled
 * again once it is used up. A new holder is chosen POTATO_HANDOFF_MS after the last holder got
 * rid of it, and as long after the match or round starts.
 *
 * The holding team must send a target number of attack rows to get rid of it. Each team's
 * target starts at POTATO_FIRST_TARGET and goes up by one each time the team gets rid of it;
 * a team with nobody left alive goes back to POTATO_FIRST_TARGET.
 *
 * While a team holds it, that team's attacks deal nothing and count toward its target (its
 * members' rows add up), and everyone else's attacks go only to the holding team. While nobody
 * holds it, attacks deal nothing. It passes on when the holding team's rows reach the target,
 * or when nobody on the holding team is alive. The callers drop the pending garbage of a team
 * that got rid of it and clear its hidden cells.
 *
 * Pure state and rules: the callers own the clock (game time locally, the host's clock online)
 * and the randomness (any `() => number` in [0, 1)).
 */

export const POTATO_FIRST_TARGET = 2;
export const POTATO_HANDOFF_MS = 2000;

/**
 * @typedef {{
 *   enabled: boolean,
 *   holder: string|null,
 *   sent: number,
 *   target: number,
 *   targets: Record<string, number>,
 *   order: string[],
 *   lastHolder: string|null,
 *   waitMs: number,
 *   generation: number,
 * }} HotPotatoState
 *   holder: the team holding the potato (null: nobody); sent / target: the rows the holding
 *   team has sent and must send; targets: each team's target the next time it takes the potato;
 *   order: the teams still to come in the current shuffle; lastHolder: the team that held it
 *   last; waitMs: time left before the next holder is chosen; generation: bumped on every
 *   change, so a copy elsewhere knows to update.
 */

/**
 * @typedef {{ key: string, alive: boolean }} PotatoTeam
 * @typedef {{ type: 'take', team: string, target: number }
 *   | { type: 'pass', team: string, reason: 'target'|'eliminated', target: number, sent: number }} PotatoEvent
 */

/**
 * @param {boolean} [enabled]
 * @returns {HotPotatoState}
 */
export function createHotPotatoState(enabled = false) {
    return {
        enabled: Boolean(enabled),
        holder: null,
        sent: 0,
        target: 0,
        targets: {},
        order: [],
        lastHolder: null,
        waitMs: enabled ? POTATO_HANDOFF_MS : 0,
        generation: 0,
    };
}

/**
 * Whether a match config plays the hot potato.
 * @param {{ hotPotato?: unknown, attackStyle?: unknown }|null|undefined} config
 */
export function isHotPotatoConfig(config) {
    return Boolean(config?.hotPotato) || config?.attackStyle === 'hot_potato';
}

/**
 * The target a team must send the next time it holds the potato.
 * @param {HotPotatoState} state
 * @param {string} team
 */
export function potatoTargetOf(state, team) {
    const target = Math.floor(Number(state.targets?.[team]));
    return Number.isFinite(target) && target >= POTATO_FIRST_TARGET ? target : POTATO_FIRST_TARGET;
}

/**
 * @template T
 * @param {T[]} items
 * @param {() => number} random
 * @returns {T[]}
 */
function shuffled(items, random) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
        const draw = Number(random());
        const j = Math.min(i, Math.max(0, Math.floor((Number.isFinite(draw) ? draw : 0) * (i + 1))));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/**
 * The next team in turn: the first team of the order that has a living player and did not
 * hold the potato last. Teams passed over keep their place. When no team in the order can take
 * it, the order is used up and every team is shuffled again.
 * @param {HotPotatoState} state
 * @param {PotatoTeam[]} teams
 * @param {() => number} random
 * @returns {string|null} null when no team can take it now
 */
function drawNextTeam(state, teams, random) {
    const eligible = new Set(teams
        .filter((team) => team.alive && team.key !== state.lastHolder)
        .map((team) => team.key));
    if (eligible.size === 0) return null;
    const known = new Set(teams.map((team) => team.key));
    state.order = state.order.filter((key) => known.has(key));
    let index = state.order.findIndex((key) => eligible.has(key));
    if (index < 0) {
        state.order = shuffled(teams.map((team) => team.key), random);
        index = state.order.findIndex((key) => eligible.has(key));
    }
    if (index < 0) return null;
    const [key] = state.order.splice(index, 1);
    return key;
}

/**
 * The holding team gets rid of the potato.
 * @param {HotPotatoState} state
 * @param {'target'|'eliminated'} reason
 * @returns {PotatoEvent|null}
 */
function passOn(state, reason) {
    const team = state.holder;
    if (team === null) return null;
    const { sent, target } = state;
    state.targets[team] = reason === 'target' ? potatoTargetOf(state, team) + 1 : POTATO_FIRST_TARGET;
    state.lastHolder = team;
    state.holder = null;
    state.sent = 0;
    state.target = 0;
    state.waitMs = POTATO_HANDOFF_MS;
    state.generation += 1;
    return {
        type: 'pass', team, reason, target, sent,
    };
}

/**
 * Advance the potato by `dtMs` of the match clock.
 * @param {HotPotatoState} state
 * @param {number} dtMs
 * @param {PotatoTeam[]} teams every team in the match, with whether it has a living player
 * @param {() => number} [random]
 * @returns {PotatoEvent|null} what happened, if anything
 */
export function stepHotPotato(state, dtMs, teams, random = Math.random) {
    if (!state?.enabled) return null;
    teams.forEach((team) => {
        // A team with nobody left alive starts again from the first target.
        if (!team.alive && team.key !== state.holder) delete state.targets[team.key];
    });
    if (state.holder !== null) {
        const holder = teams.find((team) => team.key === state.holder);
        return holder?.alive ? null : passOn(state, 'eliminated');
    }
    const step = Number(dtMs);
    if (Number.isFinite(step) && step > 0) state.waitMs = Math.max(0, state.waitMs - step);
    if (state.waitMs > 0) return null;
    const team = drawNextTeam(state, teams, random);
    if (team === null) return null;
    state.holder = team;
    state.sent = 0;
    state.target = potatoTargetOf(state, team);
    state.generation += 1;
    return { type: 'take', team, target: state.target };
}

/**
 * How an attack by a player of `team` is routed while the potato is played.
 * - 'count': the team holds it; the attack deals nothing and counts toward its target.
 * - 'holder': the attack goes only to the holding team (`holder`).
 * - 'none': nobody holds it; the attack deals nothing.
 * @param {HotPotatoState} state
 * @param {string} team
 * @returns {{ route: 'count'|'holder'|'none', holder: string|null }}
 */
export function potatoRoute(state, team) {
    if (state.holder === null) return { route: 'none', holder: null };
    if (state.holder === team) return { route: 'count', holder: team };
    return { route: 'holder', holder: state.holder };
}

/**
 * A player of the holding team sent `rows` attack rows. The potato passes on once the team's
 * rows reach its target.
 * @param {HotPotatoState} state
 * @param {string} team
 * @param {number} rows
 * @returns {PotatoEvent|null} the pass, when this attack got rid of it
 */
export function countHolderRows(state, team, rows) {
    if (!state?.enabled || state.holder !== team) return null;
    const add = Math.max(0, Math.floor(Number(rows) || 0));
    if (add === 0) return null;
    state.sent += add;
    state.generation += 1;
    return state.sent >= state.target ? passOn(state, 'target') : null;
}

/**
 * A potato state from the wire, in canonical form (anything else gives a disabled one).
 * @param {unknown} value
 * @returns {HotPotatoState|null}
 */
export function normalizeHotPotatoState(value) {
    if (!value || typeof value !== 'object') return null;
    const source = /** @type {Record<string, any>} */ (value);
    const key = (/** @type {unknown} */ item) => (typeof item === 'string' && item.length <= 128 ? item : null);
    const count = (/** @type {unknown} */ item, max = 1e6) => {
        const n = Math.floor(Number(item));
        return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
    };
    /** @type {Record<string, number>} */
    const targets = {};
    if (source.targets && typeof source.targets === 'object') {
        Object.entries(source.targets).slice(0, 64).forEach(([team, target]) => {
            if (key(team) !== null) targets[team] = Math.max(POTATO_FIRST_TARGET, count(target, 1000));
        });
    }
    return {
        enabled: Boolean(source.enabled),
        holder: key(source.holder),
        sent: count(source.sent),
        target: count(source.target, 1000),
        targets,
        order: Array.isArray(source.order) ? source.order.slice(0, 64).map(key).filter((k) => k !== null) : [],
        lastHolder: key(source.lastHolder),
        waitMs: count(source.waitMs, 60000),
        generation: count(source.generation, Number.MAX_SAFE_INTEGER),
    };
}
