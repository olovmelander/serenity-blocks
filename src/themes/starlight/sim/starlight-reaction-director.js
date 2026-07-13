/**
 * Starlight — Reaction Director (pure, renderer-free)
 *
 * The plan's §5 "one resolution → one dominant cue" brain. It replaces the old
 * StarlightEmitters' independent per-event handlers, which fired a full spectacle
 * for PIECE_LOCK, LINE_CLEAR, COMBO, TSPIN, B2B and PERFECT_CLEAR simultaneously
 * (double-firing the same twinkle-wave, stacking rings/meteors/signs, and keeping
 * a single global origin that is not multiplayer-safe).
 *
 * Design (deterministic + testable — no Three, no eventBus dependency in the core):
 *   - COALESCE: every canonical event that belongs to ONE lock resolution is
 *     accumulated into a per-PLAYER pending record. All events that arrive between
 *     two update() frames collapse into that one record — the plan's "short
 *     same-turn coalescing window". This is robust to bus emission ORDER, so it
 *     does not depend on COMBO firing before/after LINE_CLEAR, nor on the
 *     (single-player) `cascadeCount` that the direct eventBus.emit path omits.
 *   - DOMINANCE: perfect clear > combo apex > Tetris/T-spin > ordinary line clear
 *     > lock. Exactly ONE dominant cue is emitted; T-spin/B2B/combo/clear-count are
 *     MODIFIERS on it, never independent shows.
 *   - THEME-TIME TIMELINE: delayed beats are scheduled on a theme-time clock
 *     advanced by update(dt) from the theme animate loop — never setTimeout — so
 *     choreography pauses with the render gate and is refresh-rate independent.
 *   - BY-VALUE: every origin captured into a delayed beat is cloned, so a later
 *     resolution can never clobber an in-flight cue's position (fixes the old
 *     shared `_b2bPos` scratch race).
 *   - PER-PLAYER: pending / combo-milestone / last-special / apex-cooldown state is
 *     keyed by `player` (single-player omits it → DEFAULT_PLAYER).
 *
 * The core talks to the world only through injected `adapters` (subsystem calls)
 * and `resolvers` (board-space origins). Tests wire spy adapters + stub resolvers;
 * the playground effect wires a static board mock; the production theme (a later
 * slice) wires the live projected board rect. HARD_DROP / LEVEL_UP are deliberately
 * NOT consumed — they are never canonically emitted on this bus.
 */

/** Impulse kinds (strings so the core needs no stardust import; adapters map them). */
export const IMPULSE = Object.freeze({ ATTRACTOR: 'attractor', RADIAL: 'radial', VORTEX: 'vortex' });

/** Resolved dominant actions (exposed for tests + debugging). */
export const CUE = Object.freeze({
    LOCK: 'lock',
    LINE_CLEAR: 'lineClear',
    TETRIS: 'tetris',
    TSPIN: 'tspin',
    COMBO_APEX: 'comboApex',
    PERFECT_CLEAR: 'perfectClear',
});

const DEFAULT_PLAYER = 0;
const COMBO_TIERS = Object.freeze([4, 7, 10]); // resonance milestone thresholds
const MAX_BEATS = 64; // hard cap so a pathological event storm can't grow the queue unbounded

const noop = () => {};
const DEFAULT_ADAPTERS = Object.freeze({
    seal: noop, // (cells:[{x,y,z}], opts) — cell-centered stellar seal (the lock hero)
    wave: noop, // (origin, opts)           — starfield twinkle-wave
    impulse: noop, // (origin, strength, kind) — stardust impulse
    ring: noop, // (origin, opts)           — shockwave ring
    echo: noop, // (origin, opts)           — shockwave light-echo shell
    meteor: noop, // (kind, opts)           — 'faint'|'bright'|'fireball'|'shower'
    sign: noop, // (kind, opts)             — constellation trigger
    camera: noop, // (kind, amount)         — 'dolly'|'fovPunch'|'vertigo'
    fx: noop, // (field, value)             — post punch bump (bloom/vignette/chroma/flash)
    aurora: noop, // (strength, ms)         — aurora surge
});

const clone = (o) => ({ x: o?.x || 0, y: o?.y || 0, z: o?.z || 0 });
const cloneAll = (arr) => (Array.isArray(arr) ? arr.map(clone) : []);

const DEFAULT_RESOLVERS = Object.freeze({
    lockOrigin: () => ({ x: 0, y: 0, z: 0 }), // centroid of the locked piece
    lockCells: () => [{ x: 0, y: 0, z: 0 }], // world centers of each filled cell
    rowsOrigin: () => ({ x: 0, y: 0, z: 0 }), // centroid of the cleared rows
    rowOrigins: () => [{ x: 0, y: 0, z: 0 }], // per-cleared-row world origins (bottom→top)
});

export class StarlightReactionDirector {
    constructor({ adapters, resolvers, apexCooldown = 6 } = {}) {
        this.adapters = { ...DEFAULT_ADAPTERS, ...(adapters || {}) };
        this.resolvers = { ...DEFAULT_RESOLVERS, ...(resolvers || {}) };
        this.apexCooldown = apexCooldown; // seconds of hysteresis between combo-apex spectacles

        this.time = 0;
        this._beats = []; // [{ at:themeTime, fn }]
        this._pending = new Map(); // player -> resolution record (this frame)
        this._state = new Map(); // player -> { comboTier, lastCombo, lastSpecial, apexAt }
        this._unsubs = [];
        this._droppedBeats = 0; // diagnostic: beats refused at the MAX_BEATS cap
    }

    // ── lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Subscribe to the SIX canonical events only. HARD_DROP / LEVEL_UP are omitted
     * on purpose (dead on this bus). Returns a detach function.
     */
    attach(bus, EVENTS) {
        if (!bus || !EVENTS) return () => {};
        this._unsubs.push(
            bus.on(EVENTS.PIECE_LOCK, (d) => this.onPieceLock(d)),
            bus.on(EVENTS.LINE_CLEAR, (d) => this.onLineClear(d)),
            bus.on(EVENTS.COMBO, (d) => this.onCombo(d)),
            bus.on(EVENTS.TSPIN, (d) => this.onTSpin(d)),
            bus.on(EVENTS.B2B, (d) => this.onB2B(d)),
            bus.on(EVENTS.PERFECT_CLEAR, (d) => this.onPerfectClear(d)),
        );
        return () => this.detach();
    }

    detach() {
        for (const unsub of this._unsubs) {
            try { unsub?.(); } catch { /* ignore */ }
        }
        this._unsubs = [];
    }

    reset() {
        this.time = 0;
        this._beats.length = 0;
        this._pending.clear();
        this._state.clear();
        this._droppedBeats = 0;
    }

    dispose() {
        this.detach();
        this.reset();
    }

    // ── theme-time loop ───────────────────────────────────────────────────────

    /** Advance theme time, flush this frame's coalesced resolutions, fire due beats. */
    update(dt) {
        this.time += Number.isFinite(dt) ? Math.max(0, dt) : 0;
        this._flush();
        if (!this._beats.length) return;
        // Fire everything due, keep the rest. Splice-free for GC calm.
        let write = 0;
        for (let read = 0; read < this._beats.length; read += 1) {
            const beat = this._beats[read];
            if (beat.at <= this.time) {
                try { beat.fn(); } catch { /* an adapter throwing must not stall the timeline */ }
            } else {
                this._beats[write] = beat;
                write += 1;
            }
        }
        this._beats.length = write;
    }

    // ── event intake (pure; also callable directly by tests / the effect) ──────

    onPieceLock(d = {}) { this._mark(d, (r) => { r.lock = true; r.piece = d.piece || null; }); }

    onLineClear(d = {}) {
        this._mark(d, (r) => {
            r.lineCount = Math.max(1, Number(d.lineCount) || 1);
            r.clearedRows = Array.isArray(d.clearedRows) ? d.clearedRows.slice() : [];
        });
    }

    onCombo(d = {}) {
        // COMBO carries no geometry of its own — it only sets the pending resonance
        // that the coalesced clear consumes (plan §5: "It does not launch geometry").
        this._mark(d, (r) => { r.comboCount = Math.max(1, Number(d.comboCount) || 1); });
    }

    onTSpin(d = {}) { this._mark(d, (r) => { r.tspin = true; r.tspinLines = Number(d.lineCount) || 0; }); }

    onB2B(d = {}) { this._mark(d, (r) => { r.b2b = d.active !== false; }); }

    onPerfectClear(d = {}) { this._mark(d, (r) => { r.perfectClear = true; r.depth = Number(d.depth) || 0; }); }

    // ── coalescing ────────────────────────────────────────────────────────────

    _playerKey(d) {
        const p = d?.player;
        return p === undefined || p === null ? DEFAULT_PLAYER : p;
    }

    _mark(d, fn) {
        const player = this._playerKey(d);
        let record = this._pending.get(player);
        if (!record) { record = { player }; this._pending.set(player, record); }
        fn(record);
    }

    _stateFor(player) {
        let st = this._state.get(player);
        if (!st) {
            st = {
                comboTier: 0, lastCombo: 0, lastSpecial: null, apexAt: -Infinity,
            };
            this._state.set(player, st);
        }
        return st;
    }

    _flush() {
        if (!this._pending.size) return;
        for (const [player, record] of this._pending) this._resolve(player, record);
        this._pending.clear();
    }

    // ── dominance + cue dispatch ──────────────────────────────────────────────

    _resolve(player, r) {
        const st = this._stateFor(player);
        const combo = r.comboCount | 0;
        const tierStep = this._advanceComboGate(st, combo); // milestone crossing (0 = none)
        const clear = r.lineCount | 0;

        if (r.perfectClear) { this._cuePerfectClear(player, r); return; }
        if (clear >= 1 && combo >= 10 && this._apexReady(st)) { this._cueComboApex(player, r, st); return; }
        if (r.tspin) { this._cueTSpin(player, r); return; }
        if (clear >= 4) { this._cueTetris(player, r); return; }
        if (clear >= 1) { this._cueLineClear(player, r, combo, tierStep); return; }
        if (r.lock) { this._cueLock(player, r); }
        // COMBO with no clear (shouldn't happen on this bus) intentionally does nothing.
    }

    /**
     * Combo milestone gate (mirrors the Sky MoodDirector discipline): a long combo
     * streak crosses each tier [4,7,10] exactly once; a fresh chain (count drops)
     * re-arms it. Returns the newly-crossed tier index (1..3) or 0.
     */
    _advanceComboGate(st, combo) {
        if (combo <= 0) return 0;
        if (combo < st.lastCombo) st.comboTier = 0; // new chain
        st.lastCombo = combo;
        let tier = 0;
        for (let i = 0; i < COMBO_TIERS.length; i += 1) if (combo >= COMBO_TIERS[i]) tier = i + 1;
        if (tier > st.comboTier) { const crossed = tier; st.comboTier = tier; return crossed; }
        return 0;
    }

    _apexReady(st) { return this.time - st.apexAt >= this.apexCooldown; }

    // ── scheduling primitives ─────────────────────────────────────────────────

    _at(offset, fn) {
        if (this._beats.length >= MAX_BEATS) { this._droppedBeats += 1; return; }
        this._beats.push({ at: this.time + Math.max(0, offset || 0), fn });
    }

    // ── cue grammar (plan §5). The LOCK cue is the fully-authored hero this slice; ──
    //    the others emit the right coalesced beats (verified by tests) and are art-
    //    tuned in later slices.

    /** Lock, no clear (§4.7): cell-centered stellar seal + one shallow release wave. */
    _cueLock(player, r) {
        const cells = cloneAll(this.resolvers.lockCells(r.piece, player));
        const centroid = clone(this.resolvers.lockOrigin(r.piece, player));
        const accent = r.piece?.accent;
        // The seal renderer plays its own anticipation→core→outline→release envelope.
        this._at(0, () => this.adapters.seal(cells, { accent, strength: 1.0 }));
        this._at(0, () => this.adapters.impulse(centroid, 1.4, IMPULSE.ATTRACTOR)); // dust inhale
        // Release: energy transfers into the sky ~220 ms later (one shallow wave).
        this._at(0.22, () => this.adapters.wave(centroid, { boost: 0.4, speed: 1.6, sigma: 34 }));
        this._at(0.22, () => this.adapters.fx('bloomPunch', 0.04));
    }

    /** Single/double/triple: row-aligned horizon sweep + 0/1/2 small meteors; no sign. */
    _cueLineClear(player, r, combo, tierStep) {
        const rows = cloneAll(this.resolvers.rowOrigins(r.clearedRows, player));
        const centroid = clone(this.resolvers.rowsOrigin(r.clearedRows, player));
        const n = r.lineCount | 0;
        const warm = combo >= 4 ? 1.15 : 1.0; // resonance warms + lengthens the sweep
        rows.forEach((row, k) => {
            this._at(k * 0.05, () => this.adapters.wave(row, {
                boost: 0.55 * warm, speed: 1.6, sigma: 30,
            }));
        });
        this._at(0, () => this.adapters.impulse(centroid, 1.6 + n * 0.4, IMPULSE.RADIAL));
        const meteors = Math.min(2, n - 1); // single→0, double→1, triple→2
        if (meteors > 0) this._at(n * 0.05, () => this.adapters.meteor('shower', { count: meteors }));
        this._at(0, () => this.adapters.fx('bloomPunch', 0.1 + n * 0.02));

        // Resonance modifiers (plan §5 combo tiers) layered on the clear, sign-gated.
        if (combo >= 4) this._at(0.04, () => this.adapters.ring(centroid, { color: [1.0, 0.85, 0.5], maxRadius: 2.0 }));
        if (combo >= 7) {
            this._at(0.02, () => this.adapters.impulse(centroid, 4.0, IMPULSE.ATTRACTOR)); // brief nova inhale
            this._at(0.16, () => this.adapters.impulse(centroid, 6.0, IMPULSE.RADIAL));
            this._at(0.16, () => this.adapters.meteor('bright', {}));
        }
        // One sign is SEEDED only when a resonance milestone is newly crossed (tier 1
        // = combo 4–6 small seed; tier 2 = 7–9 readable trace) — never persistent, and
        // never re-seeded while the combo climbs within a tier (milestone dedup).
        if (tierStep >= 1) {
            const kind = tierStep >= 2 ? 'earned' : 'zodiac';
            this._at(0.2, () => this.adapters.sign(kind, { count: 1, persistent: false }));
        }
    }

    /** Tetris: four linked row sweeps bottom→top, then one hero meteor + FOV breath. */
    _cueTetris(player, r) {
        const rows = cloneAll(this.resolvers.rowOrigins(r.clearedRows, player));
        const centroid = clone(this.resolvers.rowsOrigin(r.clearedRows, player));
        rows.forEach((row, k) => {
            this._at(k * 0.055, () => this.adapters.wave(row, { boost: 0.8, speed: 1.6, sigma: 28 }));
        });
        this._emitTetrisBurst(centroid, 1.0);
        this._recordSpecial(player, r, { kind: CUE.TETRIS, origin: centroid, strength: 1.0 });
    }

    // Converge the linked sweeps into one burst just after the last row resolves
    // (4 rows × 0.055 + 0.03 ≈ 0.195s), then the hero meteor + FOV breath.
    _emitTetrisBurst(origin, strength) {
        const converge = 0.25;
        this._at(converge, () => this.adapters.impulse(origin, 6.0 * strength, IMPULSE.VORTEX));
        this._at(converge, () => this.adapters.ring(origin, { color: [1.0, 0.96, 0.91], maxRadius: 3.0 * strength }));
        this._at(converge, () => this.adapters.meteor(strength >= 1 ? 'fireball' : 'bright', {}));
        this._at(converge, () => this.adapters.camera('fovPunch', -2.0 * strength));
        this._at(converge, () => this.adapters.fx('flashPunch', 0.5 * strength));
        this._at(converge, () => this.adapters.fx('bloomPunch', 0.18 * strength));
    }

    /** T-spin: compact rotating vortex + thin counter-ring; no large chromatic split. */
    _cueTSpin(player, r) {
        const origin = clone(this.resolvers.lockOrigin(r.piece, player));
        this._at(0, () => this.adapters.wave(origin, {
            boost: 0.6, speed: 1.6, sigma: 28, invert: true,
        }));
        this._at(0, () => this.adapters.impulse(origin, 4.0, IMPULSE.VORTEX));
        this._at(0, () => this.adapters.ring(origin, { color: [0.62, 0.55, 0.9], maxRadius: 2.0 })); // lavender
        this._at(0, () => this.adapters.fx('chromaPunch', 0.08));
        this._recordSpecial(player, r, { kind: CUE.TSPIN, origin, strength: 1.0 });
    }

    /** Combo apex (≥10 with a clear): earned constellation birth + strongest bloom. */
    _cueComboApex(player, r, st) {
        const origin = clone(this.resolvers.rowsOrigin(r.clearedRows, player));
        st.apexAt = this.time; // arm the cooldown/hysteresis
        this._at(0, () => this.adapters.impulse(origin, 4.0, IMPULSE.ATTRACTOR)); // inhale
        this._at(0.18, () => this.adapters.impulse(origin, 10.0, IMPULSE.RADIAL)); // bloom
        this._at(0.18, () => this.adapters.echo(origin, { maxRadius: 3.6 }));
        this._at(0.18, () => this.adapters.sign('earned', { count: 1, persistent: true }));
        this._at(0.18, () => this.adapters.meteor('shower', { count: 4 }));
        this._at(0.18, () => this.adapters.camera('fovPunch', -2.5));
        this._at(0.18, () => this.adapters.aurora(0.5, 1200));
        this._at(0.18, () => this.adapters.fx('flashPunch', 0.4));
        this._at(0.18, () => this.adapters.fx('bloomPunch', 0.26));
        this._recordSpecial(player, r, { kind: CUE.COMBO_APEX, origin, strength: 1.0 });
    }

    /** Perfect clear: quiet half-beat, then a full-field constellation reveal. */
    _cuePerfectClear(player, r) {
        const origin = clone(this.resolvers.rowsOrigin(r.clearedRows, player));
        // Quiet half-beat first, then the reveal (no stacked T-spin/B2B spectacle).
        this._at(0.25, () => this.adapters.sign('earned', { count: 1, persistent: true, full: true }));
        this._at(0.25, () => this.adapters.impulse(origin, 5.0, IMPULSE.RADIAL));
        this._at(0.25, () => this.adapters.echo(origin, { maxRadius: 3.4 }));
        this._at(0.25, () => this.adapters.wave(origin, { boost: 0.9, speed: 1.5, sigma: 22 }));
        this._at(0.25, () => this.adapters.aurora(0.6, 1600));
        this._at(0.25, () => this.adapters.fx('flashPunch', 0.5));
    }

    /**
     * Record the special just emitted and, if this resolution is also flagged B2B,
     * schedule ONE copied half-strength replay by value (plan §5). This replays the
     * special we KNOW happened — it never arms a timer hoping to recognize a future
     * event, and the origin is cloned so a later cue can't move it.
     */
    _recordSpecial(player, r, special) {
        const st = this._stateFor(player);
        st.lastSpecial = special;
        if (!r.b2b) return;
        const origin = clone(special.origin);
        this._at(0.19, () => {
            if (special.kind === CUE.TSPIN) {
                this.adapters.impulse(origin, 2.0, IMPULSE.VORTEX);
                this.adapters.ring(origin, { color: [0.72, 0.66, 0.95], maxRadius: 1.4, alpha: 0.5 });
            } else {
                this.adapters.ring(origin, { color: [0.85, 0.92, 1.0], maxRadius: 1.6, alpha: 0.55 });
                this.adapters.echo(origin, { maxRadius: 2.0, alpha: 0.3 });
            }
        });
    }

    // ── diagnostics (for the playground HUD / profile artifacts) ───────────────
    getDiagnostics() {
        return {
            time: this.time,
            pendingPlayers: this._pending.size,
            scheduledBeats: this._beats.length,
            droppedBeats: this._droppedBeats,
            players: [...this._state.entries()].map(([player, st]) => ({
                player, comboTier: st.comboTier, lastCombo: st.lastCombo, hasSpecial: !!st.lastSpecial,
            })),
        };
    }
}
