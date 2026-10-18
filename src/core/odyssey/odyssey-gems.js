/**
 * Odyssey gems: the campaign's mercy that keeps its challenge.
 *
 * Finishing an orb or falling on it earns a gem. During an orb a gem buys one of three
 * abilities, each once per attempt. An orb cleared with a gem's help counts as cleared and
 * opens the path, but holds one star and stays off the time leaderboard: the other stars
 * still ask for an unaided clear. The wallet is capped so gems are spent, not hoarded.
 */
export const ODYSSEY_GEM_CAP = 9;
export const ODYSSEY_GEMS_PER_CLEAR = 1;
export const ODYSSEY_GEMS_PER_FALL = 1;
export const ODYSSEY_TIDE_ROWS = 4;
export const ODYSSEY_STILL_AIR_MS = 20000;
export const ODYSSEY_STILL_AIR_SLOWEST_MS = 1500;
export const ODYSSEY_STILL_AIR_EXTENSION_SECONDS = 30;

export const ODYSSEY_GEM_ABILITIES = Object.freeze([
    Object.freeze({
        id: 'tide',
        name: 'Tide',
        key: '1',
        summary: `Sweeps the lowest ${ODYSSEY_TIDE_ROWS} rows of the well away. Nothing it clears counts toward the goal.`,
    }),
    Object.freeze({
        id: 'still-air',
        name: 'Still Air',
        key: '2',
        summary: 'Twenty seconds of the slowest fall. On a timed orb, thirty more seconds instead.',
    }),
    Object.freeze({
        id: 'second-breath',
        name: 'Second Breath',
        key: '3',
        summary: 'Armed for the rest of the orb: one top-out empties the well and play goes on.',
    }),
]);

export function getOdysseyGemAbility(abilityId) {
    return ODYSSEY_GEM_ABILITIES.find((ability) => ability.id === abilityId) || null;
}

const whole = (value) => Math.max(0, Math.floor(Number(value) || 0));

/** The persisted wallet: gems in hand plus lifetime earned and spent, within the cap. */
export function normalizeOdysseyGemWallet(raw) {
    const earned = whole(raw?.earned);
    const spent = whole(raw?.spent);
    return { count: Math.min(ODYSSEY_GEM_CAP, whole(raw?.count)), earned, spent };
}

/** @returns {{ wallet: object, awarded: number }} the new wallet and how many gems fit under the cap */
export function awardOdysseyGems(wallet, amount = 1) {
    const current = normalizeOdysseyGemWallet(wallet);
    const awarded = Math.max(0, Math.min(whole(amount), ODYSSEY_GEM_CAP - current.count));
    return {
        wallet: { ...current, count: current.count + awarded, earned: current.earned + awarded },
        awarded,
    };
}

/** @returns {{ wallet: object, spent: boolean }} */
export function spendOdysseyGem(wallet) {
    const current = normalizeOdysseyGemWallet(wallet);
    if (current.count === 0) return { wallet: current, spent: false };
    return { wallet: { ...current, count: current.count - 1, spent: current.spent + 1 }, spent: true };
}

/** One attempt's gem use: which abilities were spent, what is still in effect. */
export function createOdysseyGemRun() {
    return {
        used: new Set(),
        spent: 0,
        stillAir: null,
        secondBreathArmed: false,
        secondBreathUsed: false,
    };
}

export function canUseOdysseyGem(run, abilityId, gemCount) {
    if (!run || !getOdysseyGemAbility(abilityId)) return false;
    if (run.used.has(abilityId)) return false;
    return whole(gemCount) > 0;
}

/** A gem's help clears the orb but holds the first star only. */
export function capOdysseyAidedStars(stars, run) {
    const earned = Math.max(0, Math.min(3, whole(stars)));
    return run?.spent > 0 ? Math.min(earned, 1) : earned;
}

function describeAbilityState(run, ability, gemCount, nowMs) {
    if (ability.id === 'still-air' && run.stillAir?.kind === 'slow') {
        const remainingMs = Math.max(0, run.stillAir.until - nowMs);
        if (remainingMs > 0) return { state: 'active', remainingMs };
    }
    if (ability.id === 'second-breath' && run.secondBreathArmed) return { state: 'armed', remainingMs: 0 };
    if (run.used.has(ability.id)) return { state: 'used', remainingMs: 0 };
    return { state: whole(gemCount) > 0 ? 'ready' : 'empty', remainingMs: 0 };
}

/** What the HUD shows: the wallet count and each ability's state for this attempt. */
export function describeOdysseyGemRun(run, gemCount, nowMs = 0) {
    const active = run || createOdysseyGemRun();
    return {
        count: whole(gemCount),
        spent: active.spent,
        abilities: ODYSSEY_GEM_ABILITIES.map((ability) => ({
            ...ability,
            ...describeAbilityState(active, ability, gemCount, nowMs),
        })),
    };
}
