// @ts-check
/**
 * @fileoverview Online versus' stage chrome (OnlineMultiplayerMode), in local versus'
 * anatomy (local-versus-hud.js): sizes the stage for the window and the roster
 * (online-versus-layout.js), fills your plate (the number that decides the match) and
 * the line under your board, keeps the match bar, and plays the endings — a banner
 * saying who took the round while the round-over beat holds (ffa-round-policy.js), a
 * short one as the next round starts, and a crest over the winner's well before the
 * results. Words, never emoji. Styles: keystone-online.css.
 */
import { applyOnlineLayout, onlineLayout } from './online-versus-layout.js';
import { readVersusViewport, versusParts } from './local-versus-layout.js';
import { primaryMetric } from './scoreboard-metrics.js';
import { describeGoal } from './components/mp-sheet.js';
import { COLS, ROWS } from '../core/constants.js';

/** How long a round's outcome stays up (the host's beat is ROUND_OVER_BEAT_MS). */
export const ROUND_BANNER_MS = 2300;
/** "Round 2" as the next round starts. */
export const ROUND_START_MS = 1100;
/** The match won: the crest and the boards hold this long before the results. */
export const VICTORY_BEAT_MS = 2400;
export const VICTORY_BEAT_REDUCED_MS = 900;
/** The stage steps out this long before the results fade in (keystone-online.css). */
export const STAGE_LEAVE_MS = 320;
/** A well narrower than this (a small tile: a phone, a full field) can't hold the crest. */
export const CREST_MIN_WELL_PX = 100;

const UNITS = Object.freeze({ frags: 'Frags', lines: 'Lines', score: 'Points' });
/** A banner title longer than this sets smaller (keystone-online.css .ov-round--long). */
const LONG_TITLE_CHARS = 14;

const reducedMotion = () => {
    try {
        return Boolean(window.settingsManager?.get?.().reducedMotion
            || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    } catch {
        return false;
    }
};

export class OnlineVersusHud {
    /** @param {Document} [doc] */
    constructor(doc = document) {
        this.doc = doc;
        /** @type {Array<ReturnType<typeof setTimeout>>} */
        this._timers = [];
        this.reset();
    }

    /** A new match: everything is laid out and filled afresh, endings cleared. */
    reset() {
        this._layoutKey = null;
        this._barSig = null;
        this._stats = {};
        this._statEls = null;
        this._color = null;
        this._timers.forEach((timer) => clearTimeout(timer));
        this._timers = [];
        this.clearRound();
        this.clearVictory();
    }

    destroy() {
        this.reset();
    }

    /** @param {string} id */
    _el(id) {
        return this.doc.getElementById(id);
    }

    _stage() {
        return this._el('online-multiplayer-container');
    }

    /** @param {() => void} fn @param {number} ms */
    _later(fn, ms) {
        const timer = setTimeout(() => {
            this._timers = this._timers.filter((t) => t !== timer);
            fn();
        }, ms);
        this._timers.push(timer);
        return timer;
    }

    /**
     * Sizes the stage for the window and the roster: your station, the opponents' field
     * and the rail. Cheap every frame: it works only when the window or the count changed.
     * @param {number} opponents boards in the field (a spectator's: everyone)
     * @param {{ setFieldLayout?: Function } | null} [field] the opponents' field
     */
    layout(opponents, field = null) {
        const stage = this._stage();
        if (!stage) return;
        const view = this.doc.defaultView;
        const count = Math.max(0, Math.min(8, Math.round(opponents) || 0));
        const key = `${view?.innerWidth}x${view?.innerHeight}|${count}`;
        if (key === this._layoutKey) return;
        this._layoutKey = key;

        const layout = onlineLayout({ ...readVersusViewport(), opponents: Math.min(count, 7) });
        applyOnlineLayout(stage, layout);
        const card = this._el('online-player-card');
        if (card) {
            const p = versusParts(layout.block);
            const vars = {
                '--board-width': `${COLS * layout.block}px`,
                '--board-height': `${ROWS * layout.block}px`,
                '--ov-unit': p.unit.toFixed(3),
                '--ov-plate-h': `${p.plate}px`,
                '--ov-meta-h': `${p.meta}px`,
                '--ov-trash': `${p.trash}px`,
                '--ov-meter-gap': `${p.meterGap}px`,
                '--ov-next-w': `${p.nextWidth}px`,
                '--ov-next-h': `${p.nextHeight}px`,
                '--ov-later-w': `${p.laterWidth}px`,
                '--ov-later-h': `${p.laterHeight}px`,
                '--next-piece-gap': `${p.nextGap}px`,
            };
            Object.entries(vars).forEach(([name, value]) => card.style.setProperty(name, value));
        }
        field?.setFieldLayout?.(layout.fieldRows ? {
            block: layout.fieldBlock,
            rows: layout.fieldRows,
            columns: layout.fieldColumns,
        } : null);
    }

    /** Your colour on your station (the plate's edge, the walls, the next tile). */
    setColor(color) {
        if (!color || color === this._color) return;
        this._color = color;
        this._el('online-player-card')?.style.setProperty('--player-primary', color);
    }

    /** @param {string} name */
    setPlayerName(name) {
        const el = this._el('ov-plate-name');
        if (el) el.textContent = name || 'You';
    }

    /**
     * Your plate shows the number that decides the match (frags, points or lines); the
     * line under the board the other two.
     * @param {{ frags?: number, lines?: number, score?: number }} state
     * @param {string} [endCondition]
     */
    updateStats(state, endCondition) {
        if (!this._statEls) {
            const el = (id) => this._el(id);
            this._statEls = {
                plateValue: el('ov-plate-value'),
                plateUnit: el('ov-plate-unit'),
                aLabel: el('ov-meta-a-label'),
                a: el('ov-meta-a'),
                bLabel: el('ov-meta-b-label'),
                b: el('ov-meta-b'),
            };
        }
        const metric = primaryMetric(endCondition);
        const values = { frags: state.frags || 0, lines: state.lines || 0, score: state.score || 0 };
        const others = ['frags', 'lines', 'score'].filter((key) => key !== metric);
        const text = (key) => (key === 'score' ? values.score.toLocaleString() : String(values[key]));
        const label = (key) => (key === 'score' ? 'Score' : UNITS[key]);
        const next = {
            plateValue: text(metric),
            plateUnit: UNITS[metric],
            aLabel: label(others[0]),
            a: text(others[0]),
            bLabel: label(others[1]),
            b: text(others[1]),
        };
        Object.entries(next).forEach(([key, value]) => {
            const node = this._statEls?.[key];
            if (node && this._stats[key] !== value) {
                node.textContent = value;
                this._stats[key] = value;
            }
        });
    }

    /**
     * The match bar: the goal, the round, and who is still in.
     * @param {Array<any>} players
     * @param {number} count
     * @param {{ endCondition?: string, endConditionValue?: unknown }} config
     * @param {number} round
     */
    updateMatchBar(players, count, config = {}, round = 1) {
        let alive = 0;
        let playing = 0;
        for (let i = 0; i < count; i++) {
            const p = players?.[i];
            if (!p || p.awaitingSpawn === true) continue;
            playing += 1;
            if (p.isAlive !== false) alive += 1;
        }
        const goal = describeGoal(config.endCondition || 'frags', config.endConditionValue);
        const roundText = `Round ${round || 1}`;
        const standing = playing > 1 ? `${alive} of ${playing} in` : '';
        const sig = `${goal}|${roundText}|${standing}`;
        if (sig === this._barSig) return;
        this._barSig = sig;
        const set = (id, text) => {
            const el = this._el(id);
            if (!el) return;
            if (el.textContent !== text) el.textContent = text;
            el.hidden = !text;
        };
        set('ov-match-goal', goal);
        set('ov-match-round', roundText);
        set('ov-match-alive', standing);
    }

    /** The round banner, created on first use. */
    _banner() {
        const stage = this._stage();
        if (!stage) return null;
        let banner = this._el('ov-round-banner');
        if (!banner) {
            banner = this.doc.createElement('div');
            banner.id = 'ov-round-banner';
            banner.className = 'ov-round';
            banner.setAttribute('role', 'status');
            stage.appendChild(banner);
        }
        return banner;
    }

    /**
     * @param {{ kicker: string, title: string, note?: string|null, color?: string|null,
     *   hold: number, start?: boolean }} opts
     */
    _showBanner({
        kicker, title, note = null, color = null, hold, start = false,
    }) {
        const banner = this._banner();
        if (!banner) return;
        banner.replaceChildren();
        const line = (className, text) => {
            if (!text) return;
            const span = this.doc.createElement('span');
            span.className = className;
            span.textContent = text;
            banner.appendChild(span);
        };
        line('ov-round__kicker', kicker);
        line('ov-round__title', title);
        line('ov-round__note', note);
        banner.style.setProperty('--round-color', color || 'var(--sb-keystone)');
        banner.classList.toggle('ov-round--start', start);
        // A long name sets smaller, so it keeps to one line where it can.
        banner.classList.toggle('ov-round--long', title.length > LONG_TITLE_CHARS);
        banner.classList.remove('is-shown');
        // Restart the rise: a banner replaced mid-hold comes in again.
        void banner.offsetWidth; // eslint-disable-line no-void
        banner.classList.add('is-shown');
        if (this._bannerTimer) clearTimeout(this._bannerTimer);
        this._bannerTimer = this._later(() => banner.classList.remove('is-shown'), hold);
    }

    /**
     * The round is over: who took it, for the beat before the next one.
     * @param {number} round the round that ended
     * @param {{ name?: string|null, color?: string|null, isYou?: boolean } | null} winner
     *   null: a draw
     */
    announceRound(round, winner) {
        let title = 'A draw';
        let note = null;
        if (winner?.isYou) {
            title = 'You take it';
            note = 'Next round in a moment';
        } else if (winner?.name) {
            // The name is the title, whole; the verb goes under it.
            title = winner.name;
            note = 'takes the round';
        }
        this._showBanner({
            kicker: `Round ${round || 1}`,
            title,
            note,
            color: winner?.color || null,
            hold: ROUND_BANNER_MS,
        });
    }

    /**
     * The next round starts.
     * @param {number} round
     * @param {{ endCondition?: string, endConditionValue?: unknown }} [config]
     */
    announceRoundStart(round, config = {}) {
        this._showBanner({
            kicker: describeGoal(config?.endCondition || 'frags', config?.endConditionValue),
            title: `Round ${round || 1}`,
            hold: ROUND_START_MS,
            start: true,
        });
    }

    clearRound() {
        const banner = this.doc?.getElementById?.('ov-round-banner');
        banner?.classList.remove('is-shown');
        if (this._bannerTimer) clearTimeout(this._bannerTimer);
        this._bannerTimer = null;
    }

    /**
     * The match won: a crest over the winner's well — "Match won", "Victory", the name in
     * their colour — the other boards dimmed, until the results. A tile too small to hold
     * it (or no well at all) gets the crest over the stage instead.
     * @param {HTMLElement | null} well the winner's board (your card, or their tile's frame)
     * @param {{ name?: string|null, color?: string|null, isYou?: boolean }} winner
     */
    showVictory(well, winner) {
        this.clearVictory();
        const stage = this._stage();
        stage?.classList.add('is-match-over');
        // The stage steps out as the beat ends, so the results come in over a dip, not a
        // flash of an empty window (OnlineMultiplayerMode holds the beat).
        this._victoryTimers.push(this._later(
            () => stage?.classList.add('is-leaving'),
            Math.max(0, this.victoryBeatMs() - STAGE_LEAVE_MS),
        ));
        well?.closest('.player-card, .opponent-mini-board')?.classList.add('is-victor');
        const holder = well && (well.offsetWidth || 0) >= CREST_MIN_WELL_PX ? well : stage;
        if (!holder) return;
        const crest = this.doc.createElement('div');
        crest.className = holder === well ? 'ov-victory' : 'ov-victory ov-victory--stage';
        crest.setAttribute('role', 'status');
        if (winner?.color) crest.style.setProperty('--win-color', winner.color);
        const line = (className, text) => {
            const span = this.doc.createElement('span');
            span.className = className;
            span.textContent = text;
            crest.appendChild(span);
        };
        line('ov-victory__kicker', 'Match won');
        line('ov-victory__title', 'Victory');
        line('ov-victory__name', winner?.isYou ? 'You' : (winner?.name || ''));
        holder.appendChild(crest);
        this._crest = crest;
        // The light rises first, then the crest.
        this._victoryTimers.push(this._later(() => crest.classList.add('is-shown'), 380));
    }

    /** How long the match won holds before the results (shorter with reduced motion). */
    victoryBeatMs() {
        return reducedMotion() ? VICTORY_BEAT_REDUCED_MS : VICTORY_BEAT_MS;
    }

    clearVictory() {
        this._victoryTimers?.forEach((timer) => clearTimeout(timer));
        this._victoryTimers = [];
        this._crest?.remove();
        this._crest = null;
        const stage = this.doc?.getElementById?.('online-multiplayer-container');
        stage?.classList.remove('is-match-over', 'is-leaving');
        stage?.querySelectorAll?.('.is-victor').forEach((el) => el.classList.remove('is-victor'));
        stage?.querySelectorAll?.('.ov-victory').forEach((el) => el.remove());
    }
}
