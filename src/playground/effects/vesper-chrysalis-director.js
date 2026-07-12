/**
 * Vesper Chrysalis — pure metamorphosis-director accumulation helpers.
 *
 * Extracted from vesper-chrysalis.effect.js so the "combo energy accumulates,
 * big beats STACK instead of resetting, milestone bursts don't re-spawn, combo
 * progress is isolated per player" semantics are renderer-free unit-testable —
 * the effect closure needs a live WebGPU renderer; none of this does. This is
 * the Vesper analogue of Wolfhour's effect-accumulation surface.
 *
 * Every function is pure (no THREE, no uniforms, no side effects).
 */

/**
 * Galaxy-style concurrent shockwave slots — the big beats (tetris / t-spin /
 * perfect-clear) STACK as independent expanding rings rather than a fresh beat
 * resetting the single ring. 2–6 by quality tier, mirroring Wolfhour's lunar
 * pulse-slot budget.
 * @param {number} tier 0=Minimal … 5=Extreme
 * @returns {number} slot count
 */
export function waveSlotsForTier(tier) {
    if (tier <= 1) return 2; // Minimal / Low
    if (tier <= 3) return 4; // Medium / High
    return 6; // Ultra / Extreme
}

/**
 * Resolve a player's combo progress against the incoming count. A DROP in count
 * means a fresh chain for that player, so the milestone gate restarts at 0
 * (otherwise the next chain would inherit the old chain's crossed milestones).
 * @param {number} stored last-seen combo for this player
 * @param {number} count incoming combo count
 * @returns {{ prev: number, count: number }} sanitized progress window
 */
export function resolveComboProgress(stored, count) {
    const safeStored = Math.max(0, Math.floor(Number(stored) || 0));
    const safeCount = Math.max(0, Math.floor(Number(count) || 0));
    const prev = safeCount < safeStored ? 0 : safeStored;
    return { prev, count: safeCount };
}

/**
 * Combo energy HOLDS and accumulates to a safe cap; it never rewinds mid-decay.
 * A fresh chain starting at count=1 must not yank a still-decaying boost back
 * down — Math.max keeps the higher value until the new chain catches up.
 * @param {number} current live sCombo value
 * @param {number} count combo count
 * @param {number} rate per-link contribution
 * @param {number} cap ceiling
 * @returns {number} the held/accumulated boost
 */
export function accumulateComboBoost(current, count, rate, cap) {
    return Math.min(cap, Math.max(current, count * rate));
}

/**
 * The milestone combo counts newly crossed in (prev, count], every `step`,
 * capped to `max` per event so a single huge jump can't spawn a burst storm
 * (FPS-spike guard). Returns the milestone values (3, 6, 9, …).
 * @param {number} prev previously-crossed combo
 * @param {number} count current combo
 * @param {number} [step] milestone spacing
 * @param {number} [max] max milestones emitted per event
 * @returns {number[]} newly-crossed milestone values, ascending
 */
export function comboMilestonesCrossed(prev, count, step = 3, max = 3) {
    const out = [];
    const first = Math.floor(prev / step) * step + step;
    for (let m = first; m <= count && out.length < max; m += step) {
        if (m >= step) out.push(m);
    }
    return out;
}

/**
 * Pick the pool slot nearest natural death so a fresh effect STACKS alongside
 * live ones instead of round-robining a livelier slot out. Remaining life is the
 * PRIMARY key — a dead slot (remaining 0) always wins over any live one, so a
 * fresh effect never clobbers a live ring while a free slot sits idle. `amp` is
 * a SECONDARY tie-break, applied only among slots with equal remaining life
 * (prefers the weaker one); `ampWeight` scales it (used by the shockwave pool;
 * 0 for bursts). Mirrors Wolfhour's strict dead-first + strength-as-tie-break.
 * @param {Array<{ t0: number, life: number, amp?: number }>} states slot states
 * @param {number} time authoritative clock
 * @param {number} [ampWeight] weight on residual amplitude in the tie-break
 * @returns {number} chosen slot index
 */
export function pickExpiringSlotIndex(states, time, ampWeight = 0) {
    let idx = 0;
    let bestRemaining = Infinity;
    let bestAmp = Infinity;
    for (let i = 0; i < states.length; i += 1) {
        const st = states[i];
        const remaining = Math.max(0, st.life - (time - st.t0));
        const amp = (st.amp || 0) * ampWeight;
        if (remaining < bestRemaining || (remaining === bestRemaining && amp < bestAmp)) {
            bestRemaining = remaining;
            bestAmp = amp;
            idx = i;
        }
    }
    return idx;
}
