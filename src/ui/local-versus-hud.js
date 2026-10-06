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
 *
 * The mode owns the game and passes plain numbers; this module owns the DOM.
 * Styles: public/styles/keystone-versus.css. Markup hooks: index.html
 * (#lv-match-bar, #p{n}-plate, #p{n}-meta inside .player-card[data-player]).
 */
import { escapeHtml, sanitizeCssColor } from '../utils/dom-safety.js';
import { BOT_SKILL_TIERS } from './local-match-config-modal.js';

const COACH_MS = 6000;

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

const KEY_NAMES = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ' ': 'Space',
    Space: 'Space',
    Shift: 'Shift',
    Control: 'Ctrl',
    Enter: 'Enter',
};

/** A key as printed on a keycap. */
export function keyName(key) {
    if (!key) return '';
    if (KEY_NAMES[key]) return KEY_NAMES[key];
    return key.length === 1 ? key.toUpperCase() : key;
}

/** The keyboard layout a player uses, in a few words. */
export function keyboardScheme(bindings = {}) {
    const moves = [bindings.moveLeft, bindings.moveRight, bindings.softDrop];
    if (moves.join() === 'ArrowLeft,ArrowRight,ArrowDown') return 'Arrow keys';
    if (moves.map((k) => String(k || '').toLowerCase()).join() === 'a,d,s') return 'WASD';
    return `Keys ${[bindings.moveLeft, bindings.moveRight].map(keyName).join(' ')}`.trim();
}

/** Standard-mapping button names, by index (12–15: the D-pad's directions). */
const PAD_BUTTONS = [
    'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu',
    'L3', 'R3', '↑', '↓', '←', '→',
];

/** Keyboard players are P1 and P2 (Settings → Controls); P3 and P4 play on controllers. */
const KEY_BINDINGS = ['keyBindings', 'player2KeyBindings'];
const PAD_BINDINGS = ['gamepadBindings', 'player2GamepadBindings', 'player3GamepadBindings', 'player4GamepadBindings'];

/**
 * How a seat plays, for its plate.
 * @param {number} index seat (0–3)
 * @param {{ kind?: string, difficulty?: number }} slot
 * @param {object} settings
 */
export function versusControls(index, slot = {}, settings = {}) {
    if (slot.kind === 'bot') {
        const tier = BOT_SKILL_TIERS[(Number(slot.difficulty) || 1) - 1];
        return tier ? `Bot · ${tier}` : 'Bot';
    }
    const keys = settings?.[KEY_BINDINGS[index]];
    return keys ? keyboardScheme(keys) : `Controller ${index + 1}`;
}

/**
 * The controls card's rows: [action, keys].
 * @returns {Array<[string, string[]]>}
 */
export function versusCoachRows(index, settings = {}) {
    const keys = settings?.[KEY_BINDINGS[index]];
    if (keys) {
        return [
            ['Move', [keys.moveLeft, keys.moveRight].map(keyName)],
            ['Turn', [keys.rotateRight, keys.rotateLeft].map(keyName)],
            ['Drop', [keys.softDrop, keys.hardDrop].map(keyName)],
        ];
    }
    const pad = settings?.[PAD_BINDINGS[index]] || {};
    const button = (b, fallback) => PAD_BUTTONS[b] || fallback;
    // Moving on the D-pad reads as one cap; its ↓ then reads as the D-pad's too.
    const dpadMove = [pad.moveLeft ?? 14, pad.moveRight ?? 15].join() === '14,15';
    return [
        ['Move', dpadMove ? ['D-pad'] : [button(pad.moveLeft, '←'), button(pad.moveRight, '→')]],
        ['Turn', [button(pad.rotateRight, 'A'), button(pad.rotateLeft, 'Y')]],
        ['Drop', [button(pad.softDrop, '↓'), button(pad.hardDrop, 'B')]],
    ];
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
        this._coachTimer = null;
    }

    _el(id) {
        return this.doc.getElementById(id);
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
            const value = values[i];
            const out = entry.isAlive === false;
            const meta = versusMetaStats(entry, key);
            // A teammate's bar shows the team's progress: the goal is the team's.
            const toward = teamMode && teamTotals ? (teamTotals[entry.team ?? i] ?? value) : value;
            const rank = showRanks ? ranks[i] : 0;
            const sig = `${value}|${toward}|${rank}|${out ? 1 : 0}|${meta.map((m) => m[1]).join(',')}`;
            if (sig === this._plateSigs[i]) return;
            this._plateSigs[i] = sig;

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

    /** The knock-out card over a board (3–4 players, until the round ends). */
    showKnockout(index, note = 'Back next round') {
        const section = this._el(`p${index + 1}-phaser-container`)?.closest('.player-board-section');
        if (!section) return;
        this._knockouts.get(index)?.remove();
        const card = this.doc.createElement('div');
        card.className = 'lv-ko';
        card.setAttribute('role', 'status');
        card.innerHTML = `<span class="lv-ko__title">Out</span><span class="lv-ko__note">${escapeHtml(note)}</span>`;
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

    /** Each human board shows its controls for a few seconds at the start. */
    showCoach() {
        this.hideCoach();
        const slots = this.config.playerSlots || [];
        for (let i = 0; i < this.numPlayers; i++) {
            if (slots[i]?.kind === 'bot') continue;
            const card = this._el(`player-${i + 1}-card`);
            // Beside the board the card waits under the queue; above it, on the board's foot.
            const besideBoard = card?.closest('[data-queue]')?.dataset.queue === 'side'
                && !card.classList.contains('infinity-lms');
            const host = besideBoard
                ? card.querySelector('.player-next-section')
                : this._el(`p${i + 1}-phaser-container`)?.closest('.player-board-section');
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

    destroy() {
        this.hideCoach();
        this.clearKnockouts();
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
