/**
 * @fileoverview Local versus HUD (LocalMultiplayerMode): one place for every number.
 *
 * - The match bar (top row, beside the controls tray): the mode, the goal, the round,
 *   the clock in a timed match and, with teams, each team's total.
 * - A name plate over each board: seat, name, how they play (keys, controller or bot
 *   skill), their rank and the number that decides the match, with a bar toward the
 *   goal.
 * - One line of stats under each board: the numbers that do not decide the match.
 * - The knock-out card on a board, and a controls card on each human board at the
 *   start of a match.
 * - The match told as it happens: a streak from attacker to target with the lines it
 *   carries, a "+1" on a frag, the round's result in a banner, a well that turns
 *   coral when its stack nears the top.
 *
 * The mode owns the game and passes plain numbers; this module owns the DOM.
 * Styles: public/styles/keystone-versus.css. Markup hooks: index.html
 * (#lv-match-bar, #p{n}-plate, #p{n}-meta inside .player-card[data-player]).
 */
import { escapeHtml, sanitizeCssColor } from '../utils/dom-safety.js';
import { versusCoachRows, versusControls } from './local-seat-controls.js';

const COACH_MS = 6000;
const BANNER_MS = 1700;
const ATTACK_MS = 440;
/** Rows of 20 at which a stack is in danger (the well turns coral)... */
const DANGER_ROWS = 15;
/** ...and the rows it must clear before the well calms (no flicker at the line). */
const DANGER_CALM = 3;
/** Incoming garbage: the lines that fill the meter, and a heavy attack (it glows). */
const METER_LINES = 20;
const HEAVY_LINES = 8;

/** Replays a CSS animation class on the next frame. */
const replay = (el, className) => {
    el.classList.remove(className);
    const nextFrame = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
    nextFrame(() => el.classList.add(className));
};

const reducedMotion = () => {
    try {
        return window.settingsManager?.get?.().reducedMotion
            || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
};

/**
 * The number that decides a local match, and its goal.
 * @param {object} config the match config from the setup sheet
 * @returns {{ key: 'frags'|'score'|'lines'|'toRoof', unit: string, target: number|null }}
 */
export function versusMetric(config = {}) {
    const value = Number(config.endConditionValue) || 0;
    if (config.isInfinityLMS || config.endCondition === 'infinity-lms') {
        return { key: 'toRoof', unit: 'To roof', target: null };
    }
    switch (config.endCondition) {
    case 'points': return { key: 'score', unit: 'Points', target: value > 0 ? value * 1000 : null };
    case 'never': return { key: 'score', unit: 'Points', target: null };
    case 'lines': return { key: 'lines', unit: 'Lines', target: value > 0 ? value : null };
    // "The highest score when time runs out wins" (the setup sheet).
    case 'time': return { key: 'score', unit: 'Points', target: null };
    default: return { key: 'frags', unit: 'Frags', target: value > 0 ? value : null };
    }
}

/** The goal in words, for the match bar and the results. */
export function versusGoal(config = {}) {
    const value = Number(config.endConditionValue) || 0;
    const team = Boolean(config.isTeamMode);
    if (config.isInfinityLMS || config.endCondition === 'infinity-lms') {
        return team ? 'Last team standing' : 'Last one standing';
    }
    const first = team ? 'First team to' : 'First to';
    switch (config.endCondition) {
    case 'points': return `${first} ${(value * 1000).toLocaleString()} points`;
    case 'lines': return `${first} ${value} lines`;
    case 'time': return `${team ? 'Highest team score' : 'Highest score'} in ${value} min`;
    case 'never': return 'Endless';
    // A team's frag goal counts the rounds it wins (LocalMultiplayerMode).
    default: return team
        ? `${first} ${value} ${value === 1 ? 'round' : 'rounds'}`
        : `${first} ${value} ${value === 1 ? 'frag' : 'frags'}`;
    }
}

/** The kind of match, for the match bar's first chip. */
export function versusMode(config = {}) {
    if (config.isInfinityLMS) return 'Infinity';
    if (config.hotPotato || config.attackStyle === 'hot_potato') return 'Hot potato';
    if (config.isTeamMode) return 'Teams';
    return 'Free-for-all';
}

/**
 * Standard competition ranks (1, 2, 2, 4), highest value first.
 * @param {number[]} values
 * @returns {number[]}
 */
export function competitionRanks(values) {
    return values.map((value) => 1 + values.filter((other) => other > value).length);
}

export const ordinal = (n) => {
    const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n] || 'th';
    return `${n}${suffix}`;
};

/** m:ss for a remaining time. */
export function formatClock(ms) {
    const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const STAT_LABELS = {
    level: 'Level', lines: 'Lines', score: 'Score', frags: 'Frags',
};

/**
 * The stats line under a board: what does not decide the match.
 * @param {{ level?: number, lines?: number, score?: number, frags?: number }} entry
 * @param {string} metricKey
 * @returns {Array<[string, string]>}
 */
export function versusMetaStats(entry, metricKey) {
    const order = metricKey === 'toRoof' ? ['level', 'lines'] : ['level', 'lines', 'score', 'frags']
        .filter((key) => key !== metricKey)
        .slice(0, 3);
    return order.map((key) => {
        const value = Number(entry?.[key]) || 0;
        return [STAT_LABELS[key], key === 'score' ? value.toLocaleString() : String(value)];
    });
}

/**
 * @typedef {object} VersusEntry
 * @property {number} frags
 * @property {number} score
 * @property {number} lines
 * @property {number} level
 * @property {number} [toRoof]
 * @property {boolean} isAlive
 * @property {number} [team] resolved team id (team matches)
 */

export class LocalVersusHud {
    /**
     * @param {object} options
     * @param {object} options.config the match config
     * @param {number} options.numPlayers
     * @param {(index: number) => { primary?: string, light?: string }} options.colorFor
     * @param {(teamId: number) => string} [options.teamLabel]
     * @param {object} [options.settings] the settings (key and controller bindings)
     * @param {Document} [options.doc]
     */
    constructor({
        config, numPlayers, colorFor, teamLabel = (t) => `Team ${String.fromCharCode(65 + t)}`,
        settings = {}, doc = document,
    }) {
        this.config = config || {};
        this.numPlayers = numPlayers;
        this.colorFor = colorFor;
        this.teamLabel = teamLabel;
        this.settings = settings || {};
        this.doc = doc;
        this.metric = versusMetric(this.config);
        this.round = 1;
        this._plateSigs = [];
        this._barSig = '';
        this._knockouts = new Map();
        this._victories = [];
        this._coachTimer = null;
        this._lastValues = [];
        this._danger = [];
        this._incoming = [];
        this._timers = new Set();
    }

    /** A timer the HUD clears when it is destroyed. */
    _later(fn, ms) {
        const id = setTimeout(() => {
            this._timers.delete(id);
            fn();
        }, ms);
        this._timers.add(id);
    }

    _name(index) {
        return this.config.playerSlots?.[index]?.name || `Player ${index + 1}`;
    }

    _color(index) {
        return sanitizeCssColor(this.colorFor(index)?.primary);
    }

    _el(id) {
        return this.doc.getElementById(id);
    }

    /** The meter beside a board fills with the garbage waiting to rise into it. */
    _meter(index, lines) {
        if (this._incoming[index] === lines) return;
        this._incoming[index] = lines;
        const meter = this._el(`p${index + 1}-garbage-bar`);
        if (!meter) return;
        const fill = meter.querySelector('.garbage-fill');
        if (fill) fill.style.height = `${Math.min(100, (lines / METER_LINES) * 100)}%`;
        meter.classList.toggle('is-heavy', lines >= HEAVY_LINES);
    }

    /** Builds the plates and the match bar for this match. */
    mount() {
        const slots = this.config.playerSlots || [];
        for (let i = 0; i < this.numPlayers; i++) {
            const n = i + 1;
            const plate = this._el(`p${n}-plate`);
            if (!plate) continue;
            const slot = slots[i] || {};
            const name = slot.name || `Player ${n}`;
            const team = this.config.isTeamMode ? this.config.playerTeams?.[i] ?? i : null;
            const teamChip = team === null ? ''
                : `<span class="lv-plate__team">${escapeHtml(this.teamLabel(team))}</span>`;
            const goal = this.metric.target
                ? '<span class="lv-plate__goal" aria-hidden="true"><span class="lv-plate__goal-fill"></span></span>'
                : '';
            plate.innerHTML = `
                <span class="lv-plate__seat" aria-hidden="true">P${n}</span>
                <span class="lv-plate__who">
                    <span class="lv-plate__name">
                        <span class="lv-plate__name-text">${escapeHtml(name)}</span>${teamChip}
                    </span>
                    <span class="lv-plate__controls">${escapeHtml(versusControls(i, slot, this.settings))}</span>
                </span>
                <span class="lv-plate__rank" hidden></span>
                <span class="lv-plate__stat">
                    <span class="lv-plate__value">0</span>
                    <span class="lv-plate__unit">${escapeHtml(this.metric.unit)}</span>
                </span>
                ${goal}`;
            plate.dataset.kind = slot.kind === 'bot' ? 'bot' : 'human';
            this._lastValues[i] = 0;
            this._danger[i] = false;
            this._meter(i, 0);
            plate.closest('.player-card')?.setAttribute('aria-label', `${name}, player ${n}`);
            this._plateSigs[i] = '';
        }
        const bar = this._el('lv-match-bar');
        if (bar) {
            bar.hidden = false;
            this._barSig = '';
        }
    }

    /**
     * @param {VersusEntry[]} entries one per player
     * @param {object} [match]
     * @param {number} [match.round]
     * @param {{ limitMs: number, startedAt: number }|null} [match.clock] a timed match's limit
     * @param {number|null} [match.clockMs] or the time left, directly
     * @param {Object<string, number>|null} [match.teamTotals] each team's number toward the
     *   goal, by the team rule (the mode's)
     */
    update(entries, {
        round = this.round, clock = null, clockMs = null, teamTotals = null,
    } = {}) {
        this.round = round;
        this.teamTotals = teamTotals;
        const timeLeft = clock ? clock.limitMs - (Date.now() - (clock.startedAt || Date.now())) : clockMs;
        const { key, target } = this.metric;
        const values = entries.map((e) => Number(e?.[key]) || 0);
        const teamMode = Boolean(this.config.isTeamMode);
        const ranks = competitionRanks(values);
        // Ranks say nothing while everyone is level, and the bar ranks teams.
        const showRanks = !teamMode && key !== 'toRoof' && new Set(values).size > 1;

        entries.forEach((entry, i) => {
            const plate = this._el(`p${i + 1}-plate`);
            if (!plate || !entry) return;
            this._meter(i, Number(entry.incoming) || 0);
            const value = values[i];
            const out = entry.isAlive === false;
            const meta = versusMetaStats(entry, key);
            // A teammate's bar shows the team's progress: the goal is the team's.
            const toward = teamMode && teamTotals ? (teamTotals[entry.team ?? i] ?? value) : value;
            const rank = showRanks ? ranks[i] : 0;
            const stack = Number(entry.stack) || 0;
            const danger = !out && (stack >= DANGER_ROWS || (this._danger[i] && stack > DANGER_ROWS - DANGER_CALM));
            this._danger[i] = danger;
            const flags = `${out ? 1 : 0}${danger ? 1 : 0}`;
            const sig = `${value}|${toward}|${rank}|${flags}|${meta.map((m) => m[1]).join(',')}`;
            if (sig === this._plateSigs[i]) return;
            this._plateSigs[i] = sig;
            plate.closest('.player-card')?.classList.toggle('lv-danger', danger);
            // A frag lands on the plate.
            if (key === 'frags' && value > (this._lastValues[i] ?? 0)) this._bump(plate, value - this._lastValues[i]);
            this._lastValues[i] = value;

            const valueEl = plate.querySelector('.lv-plate__value');
            if (valueEl) valueEl.textContent = key === 'score' ? value.toLocaleString() : String(value);
            const rankEl = plate.querySelector('.lv-plate__rank');
            if (rankEl) {
                rankEl.hidden = !showRanks;
                rankEl.textContent = showRanks ? ordinal(ranks[i]) : '';
                rankEl.dataset.rank = String(ranks[i]);
            }
            const fill = plate.querySelector('.lv-plate__goal-fill');
            if (fill && target) fill.style.setProperty('--lv-goal', String(Math.min(1, toward / target)));
            plate.classList.toggle('is-out', out);
            plate.closest('.player-card')?.classList.toggle('lv-out', out);

            const metaEl = this._el(`p${i + 1}-meta`);
            if (metaEl) {
                metaEl.innerHTML = meta.map(([label, v]) => (
                    `<span class="lv-meta__stat"><span class="lv-meta__label">${label}</span>`
                    + `<span class="lv-meta__value">${escapeHtml(v)}</span></span>`
                )).join('');
            }
        });

        this._renderBar(entries, values, timeLeft);
    }

    _renderBar(entries, values, clockMs) {
        const bar = this._el('lv-match-bar');
        if (!bar) return;
        const teams = this.config.isTeamMode ? this._teamTotals(entries, values) : [];
        const timed = clockMs !== null && clockMs !== undefined;
        // Time's up ends the match when this round ends.
        let clock = '';
        if (timed) clock = clockMs > 0 ? formatClock(clockMs) : 'Last round';
        const sig = `${this.round}|${clock}|${teams.map((t) => `${t.id}:${t.total}`).join(',')}`;
        if (sig === this._barSig) return;
        this._barSig = sig;
        const lowTime = timed && clockMs <= 30000;
        const clockHtml = clock
            ? `<span class="lv-match-bar__clock${lowTime ? ' is-low' : ''}"`
                + ` aria-label="${clockMs > 0 ? `Time left ${clock}` : clock}">${clock}</span>`
            : '';
        const teamHtml = teams.map((t) => (
            `<span class="lv-match-bar__team" style="--team-color:${sanitizeCssColor(t.color)}">`
            + `<span class="lv-match-bar__team-name">${escapeHtml(t.label)}</span>`
            + `<span class="lv-match-bar__team-total">${escapeHtml(this._format(t.total))}</span></span>`
        )).join('');
        bar.innerHTML = `
            <span class="lv-match-bar__mode">${escapeHtml(versusMode(this.config))}</span>
            <span class="lv-match-bar__goal">${escapeHtml(versusGoal(this.config))}</span>
            <span class="lv-match-bar__round">Round ${this.round}</span>
            ${clockHtml}
            ${teamHtml ? `<span class="lv-match-bar__teams">${teamHtml}</span>` : ''}`;
    }

    _format(value) {
        return this.metric.key === 'score' ? Number(value).toLocaleString() : String(value);
    }

    _teamTotals(entries, values) {
        const totals = new Map();
        entries.forEach((entry, i) => {
            const id = entry?.team ?? i;
            const t = totals.get(id) || {
                id, total: 0, label: this.teamLabel(id), color: this.colorFor(i)?.primary || '#a78bfa',
            };
            t.total = this.teamTotals ? (this.teamTotals[id] ?? 0) : t.total + values[i];
            totals.set(id, t);
        });
        return [...totals.values()].sort((a, b) => a.id - b.id);
    }

    /** The plate's number pops and a "+n" rises beside it. */
    _bump(plate, by) {
        if (!plate.classList || reducedMotion()) return;
        // Restarts on a quick second frag.
        replay(plate, 'is-bumped');
        const chip = this.doc.createElement('span');
        chip.className = 'lv-plate__bump';
        chip.textContent = `+${by}`;
        plate.appendChild(chip);
        this._later(() => {
            chip.remove();
            plate.classList.remove('is-bumped');
        }, 1000);
    }

    /**
     * The knock-out card over a board (3–4 players, until the round ends), naming who
     * did it.
     * @param {number} index the player out
     * @param {number|null} [by] who knocked them out (null or themselves: topped out)
     */
    showKnockout(index, by = null) {
        const section = this._el(`p${index + 1}-phaser-container`)?.closest('.player-board-section');
        if (!section) return;
        this._knockouts.get(index)?.remove();
        const card = this.doc.createElement('div');
        card.className = 'lv-ko';
        card.setAttribute('role', 'status');
        const knockedBy = Number.isInteger(by) && by !== index;
        const cause = knockedBy ? `By ${this._name(by)}` : 'Topped out';
        const byColor = knockedBy ? ` style="--by-color:${this._color(by)}"` : '';
        card.innerHTML = '<span class="lv-ko__title">Out</span>'
            + `<span class="lv-ko__cause"${byColor}>${escapeHtml(cause)}</span>`
            + '<span class="lv-ko__note">Back next round</span>';
        section.appendChild(card);
        this._knockouts.set(index, card);
        // Let the board fade first, then the card rises.
        setTimeout(() => card.classList.add('is-shown'), 600);
    }

    clearKnockouts() {
        this._knockouts.forEach((card) => card.remove());
        this._knockouts.clear();
        this.doc.querySelectorAll('.lv-ko').forEach((card) => card.remove());
    }

    /**
     * The match won: a crest over each winner's well — "Victory", their name in their
     * colour — while the well celebrates, until the results.
     * @param {number[]} winners
     */
    showVictory(winners = []) {
        this.clearVictory();
        winners.forEach((index) => {
            const section = this._el(`p${index + 1}-phaser-container`)?.closest('.player-board-section');
            if (!section) return;
            const crest = this.doc.createElement('div');
            crest.className = 'lv-victory';
            crest.setAttribute('role', 'status');
            crest.style.setProperty('--win-color', this._color(index));
            crest.innerHTML = '<span class="lv-victory__kicker">Match won</span>'
                + '<span class="lv-victory__title">Victory</span>'
                + `<span class="lv-victory__name">${escapeHtml(this._name(index))}</span>`;
            section.appendChild(crest);
            this._victories.push(crest);
            this._el(`p${index + 1}-plate`)?.classList.add('is-victor');
            // The light rises first, then the crest.
            this._later(() => crest.classList.add('is-shown'), 380);
        });
    }

    clearVictory() {
        this._victories.forEach((crest) => crest.remove());
        this._victories = [];
        this.doc.querySelectorAll('#multiplayer-container .lv-plate.is-victor')
            .forEach((plate) => plate.classList.remove('is-victor'));
    }

    /** Each human board shows its controls for a few seconds at the start. */
    showCoach() {
        this.hideCoach();
        const slots = this.config.playerSlots || [];
        for (let i = 0; i < this.numPlayers; i++) {
            if (slots[i]?.kind === 'bot') continue;
            // On the board's foot, under the falling pieces.
            const host = this._el(`p${i + 1}-phaser-container`)?.closest('.player-board-section');
            if (!host) continue;
            const coach = this.doc.createElement('div');
            coach.className = 'lv-coach';
            coach.setAttribute('role', 'note');
            coach.innerHTML = versusCoachRows(i, this.settings).map(([action, keys]) => {
                const caps = keys.filter(Boolean).map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('');
                return `<span class="lv-coach__row"><span class="lv-coach__action">${action}</span>`
                    + `<span class="lv-coach__keys">${caps}</span></span>`;
            }).join('');
            host.appendChild(coach);
        }
        this._coachTimer = setTimeout(() => this.hideCoach(), COACH_MS);
    }

    hideCoach() {
        clearTimeout(this._coachTimer);
        this._coachTimer = null;
        this.doc.querySelectorAll('#multiplayer-container .lv-coach').forEach((card) => {
            card.classList.add('is-leaving');
            setTimeout(() => card.remove(), 400);
        });
    }

    /**
     * The round's result, for a moment, as the next round starts.
     * @param {number} round the round that ended
     * @param {{ winnerIndex?: number, teamId?: number, selfKill?: boolean }|null} outcome
     */
    announceRound(round, outcome = null) {
        const stage = this._el('multiplayer-container');
        if (!stage) return;
        let banner = this._el('lv-round-banner');
        if (!banner) {
            banner = this.doc.createElement('div');
            banner.id = 'lv-round-banner';
            banner.className = 'lv-round';
            banner.setAttribute('role', 'status');
            stage.appendChild(banner);
        }
        let title = 'A draw';
        let color = '';
        if (Number.isInteger(outcome?.teamId)) {
            title = `${this.teamLabel(outcome.teamId)} takes it`;
            const member = (this.config.playerTeams || []).indexOf(outcome.teamId);
            color = this._color(member >= 0 ? member : 0);
        } else if (Number.isInteger(outcome?.winnerIndex)) {
            title = `${this._name(outcome.winnerIndex)} takes it`;
            color = this._color(outcome.winnerIndex);
        }
        const note = outcome?.selfKill ? 'Topped out, no frag' : '';
        banner.style.setProperty('--round-color', color || 'var(--sb-keystone)');
        const noteHtml = note ? `<span class="lv-round__note">${note}</span>` : '';
        banner.innerHTML = `<span class="lv-round__kicker">Round ${round}</span>`
            + `<span class="lv-round__title">${escapeHtml(title)}</span>${noteHtml}`;
        replay(banner, 'is-shown');
        clearTimeout(this._bannerTimer);
        this._bannerTimer = setTimeout(() => banner.classList.remove('is-shown'), BANNER_MS);
    }

    /**
     * An attack, drawn: a streak from the attacker's board into each target's garbage
     * meter, which flashes and counts the lines in.
     * @param {number} from attacker
     * @param {number[]} targets
     * @param {number} lines
     */
    showAttack(from, targets, lines) {
        const stage = this._el('multiplayer-container');
        const origin = this._el(`p${from + 1}-phaser-container`)?.closest('.player-board-section');
        if (!stage || !origin || !lines) return;
        const color = this._color(from);
        const motion = !reducedMotion() && typeof origin.animate === 'function';
        targets.forEach((target) => {
            const meter = this._el(`p${target + 1}-garbage-bar`);
            if (!meter) return;
            const land = () => this._hit(meter, lines, color);
            if (!motion) {
                land();
                return;
            }
            const a = origin.getBoundingClientRect();
            const b = meter.getBoundingClientRect();
            const x0 = a.left + a.width / 2;
            const y0 = a.top + a.height * 0.42;
            const x1 = b.left + b.width / 2;
            const y1 = b.bottom - Math.min(b.height * 0.25, 60);
            const dx = x1 - x0;
            const dy = y1 - y0;
            const angle = `${Math.atan2(dy, dx).toFixed(4)}rad`;
            const streak = this.doc.createElement('div');
            streak.className = 'lv-attack';
            streak.style.cssText = `left:${x0}px;top:${y0}px;--attack-color:${color};`
                + `--attack-len:${Math.hypot(dx, dy)}px`;
            streak.innerHTML = '<span class="lv-attack__trail"></span><span class="lv-attack__orb"></span>';
            stage.appendChild(streak);
            streak.querySelector('.lv-attack__orb').animate(
                [{ transform: 'translate(-50%, -50%) scale(0.6)' },
                    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.15)` }],
                { duration: ATTACK_MS, easing: 'cubic-bezier(0.55, 0, 0.8, 0.4)', fill: 'forwards' },
            );
            streak.querySelector('.lv-attack__trail').animate(
                [{ transform: `rotate(${angle}) scaleX(0)`, opacity: 0.9 },
                    { transform: `rotate(${angle}) scaleX(1)`, opacity: 0.6, offset: 0.85 },
                    { transform: `rotate(${angle}) scaleX(1)`, opacity: 0 }],
                { duration: ATTACK_MS + 160, easing: 'ease-in', fill: 'forwards' },
            );
            this._later(() => {
                streak.remove();
                land();
            }, ATTACK_MS);
        });
    }

    /** The target's meter takes the hit: a flash and "+n" rows. */
    _hit(meter, lines, color) {
        replay(meter, 'is-hit');
        const well = meter.parentElement;
        if (well) {
            const label = this.doc.createElement('span');
            label.className = 'lv-hit';
            label.textContent = `+${lines}`;
            label.style.setProperty('--attack-color', color);
            well.appendChild(label);
            this._later(() => label.remove(), 1100);
        }
        this._later(() => meter.classList.remove('is-hit'), 500);
    }

    destroy() {
        this._timers.forEach((id) => clearTimeout(id));
        this._timers.clear();
        clearTimeout(this._bannerTimer);
        this.doc.getElementById?.('lv-round-banner')?.remove();
        this.doc.querySelectorAll('#multiplayer-container .lv-attack, #multiplayer-container .lv-hit')
            .forEach((node) => node.remove());
        this.hideCoach();
        this.clearKnockouts();
        this.clearVictory();
        for (let n = 1; n <= 4; n++) {
            const plate = this._el(`p${n}-plate`);
            if (plate) plate.innerHTML = '';
            const meta = this._el(`p${n}-meta`);
            if (meta) meta.innerHTML = '';
            this._el(`player-${n}-card`)?.classList.remove('lv-out');
        }
        const bar = this._el('lv-match-bar');
        if (bar) {
            bar.hidden = true;
            bar.innerHTML = '';
        }
    }
}
