/**
 * Hale sessions: the catalogue in the Hub, and the full-screen flow around a session
 * (prepare → countdown → the session itself in the breathing guide → complete).
 *
 * The catalogue lives in the Hub's tab. Everything after "Begin" is its own full-screen
 * surface, so preparing for twenty minutes of breathwork is never squeezed into a side panel.
 * Timing, voice and stages belong to BreathworkSessionManager; your practice (history, streak,
 * best holds) to breathwork-practice-log.js; this file only presents them.
 */
import { csIcon } from '../components/cosmic-icons.js';
import { breathPosterUrl, getBreathWorld } from '../effects/breathing/breath-catalogue.js';
import { SESSION_WORLDS } from '../effects/breathwork-session-manager.js';
import {
    MIN_PRACTICE_SECONDS, formatPracticeTime, longestOpenHold, readPracticeLog, recordPractice,
    summarizePractice,
} from '../effects/breathwork-practice-log.js';

/** What each session is for. Durations, rounds and holds are read from the manager. */
export const HALE_SESSIONS = Object.freeze({
    BASE: {
        name: 'Hale Base',
        promise: 'Come back to yourself',
        summary: 'Rhythmic nasal breathing, quiet holds, and a grounded finish.',
        about: 'Three rounds of steady breathing through the nose. Each round is a little quicker than the last and ends in a stillness you hold for as long as feels good, then the session lets you rest.',
        intensity: 'Moderate',
        style: 'Nasal breathing',
    },
    ELIXIR: {
        name: 'Hale Elixir',
        promise: 'Meet your inner spark',
        summary: 'Connected mouth breathing that builds, then drops into deep stillness.',
        about: 'The most active session. Three rounds of fast, connected breathing through the mouth, each followed by a hold on empty lungs that ends when you breathe in, and one strong recovery breath.',
        intensity: 'High',
        style: 'Mouth breathing',
    },
    REST: {
        name: 'Hale Rest',
        promise: 'Let the day soften',
        summary: 'Gentle breaths with long exhales, for the end of the day.',
        about: 'Slow breathing through the nose with an out-breath twice as long as the in-breath. The pauses are short and soft, and the closing rest is made for drifting off.',
        intensity: 'Gentle',
        style: 'Nasal breathing',
    },
    FLOW: {
        name: 'Hale Flow',
        promise: 'Find your own rhythm',
        summary: 'Box breathing that widens round by round.',
        about: 'In, hold, out, hold: four equal sides. The count grows from four to five to six across three rounds, and after each the counting stops and you keep the rhythm on your own.',
        intensity: 'Moderate',
        style: 'Box breathing',
    },
});

const INTENTIONS = {
    BASE: [
        { id: 'calm', icon: 'wave', label: 'Find calm' },
        { id: 'focus', icon: 'target', label: 'Sharpen focus' },
        { id: 'ground', icon: 'tree', label: 'Ground myself' },
        { id: 'breathe', icon: 'breath', label: 'Just breathe' },
    ],
    ELIXIR: [
        { id: 'energy', icon: 'bolt', label: 'Ignite energy' },
        { id: 'release', icon: 'flame', label: 'Release and let go' },
        { id: 'transform', icon: 'butterfly', label: 'Transform' },
        { id: 'power', icon: 'shield', label: 'Build power' },
    ],
    REST: [
        { id: 'sleep', icon: 'moon', label: 'Prepare for sleep' },
        { id: 'unwind', icon: 'leaf', label: 'Unwind' },
        { id: 'restore', icon: 'flower', label: 'Restore' },
        { id: 'peace', icon: 'cloud', label: 'Find peace' },
    ],
    FLOW: [
        { id: 'balance', icon: 'balance', label: 'Find balance' },
        { id: 'clarity', icon: 'gem', label: 'Gain clarity' },
        { id: 'presence', icon: 'star', label: 'Be present' },
        { id: 'rhythm', icon: 'note', label: 'Find rhythm' },
    ],
};
const STAGE_NAMES = {
    grounding: 'Arrive', active: 'Breathe', retention: 'Hold', carry: 'On your own', recovery: 'Recover', integration: 'Rest',
};
const COUNTDOWN = [
    ['3', 'Find a comfortable position'],
    ['2', 'Soften your shoulders'],
    ['1', 'Let one slow breath go'],
    ['Begin', 'Follow the voice and the light'],
];
const PREFS_KEY = 'serenity.halePrefs';
const DEFAULT_PREFS = Object.freeze({
    voice: true, sounds: true, vibration: true, openHolds: true, safetyAcknowledged: false,
});
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/** The live strip's End asks for a second press within this window. */
const END_CONFIRM_MS = 4000;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function formatClock(seconds) {
    const safe = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function formatHold(seconds) {
    if (!(seconds > 0)) return 'no holds';
    return seconds >= 60 ? `${Number((seconds / 60).toFixed(1))} min` : `${seconds} sec`;
}

function storage() {
    try {
        return window.localStorage || null;
    } catch {
        return null;
    }
}

function readPrefs() {
    try {
        const saved = JSON.parse(storage()?.getItem(PREFS_KEY) || 'null');
        return { ...DEFAULT_PREFS, ...(saved && typeof saved === 'object' ? saved : {}) };
    } catch {
        return { ...DEFAULT_PREFS };
    }
}

const secondsOf = (phase) => {
    const seconds = phase.type === 'active'
        ? (phase.pattern || []).reduce((sum, part) => sum + part, 0) * phase.breaths : phase.duration;
    return Number.isFinite(seconds) ? seconds : 0;
};

const worldOf = (sessionId, phase) => {
    const worlds = SESSION_WORLDS[sessionId] || SESSION_WORLDS.BASE;
    const choice = worlds[phase.type] || worlds.grounding;
    return Array.isArray(choice) ? choice[Math.max(0, (phase.round || 1) - 1) % choice.length] : choice;
};

export class SessionsTab {
    constructor(hub, sessionManager) {
        this.hub = hub;
        this.sessionManager = sessionManager;
        this.container = hub.panel.querySelector('#tab-sessions');
        this.active = false;
        this.destroyed = false;
        this.pendingSessionId = null;
        this.selectedIntention = null;
        this.savedPrefs = readPrefs();
        this.voiceGuidance = this.prefs.voice;
        this.step = null;
        this.focusReturn = null;
        this.activeSessionData = null;
        this.completedSession = null;
        this.countdownGeneration = 0;
        this.sessionGeneration = 0;
        this.pendingTimers = new Map();
        this.endArmed = null;
        this.abortController = new AbortController();
        this.render();
        this.renderFlow();
        this.setupEventListeners();
    }

    // ── Session facts ───────────────────────────────────────────────────────

    /** Everything the catalogue and the preparation screen say about a session. */
    getSessionDetails(sessionId) {
        const info = HALE_SESSIONS[sessionId];
        if (!info) return null;
        const phases = this.sessionManager?.SESSIONS?.[sessionId]?.phases || [];
        const total = phases.reduce((sum, phase) => sum + secondsOf(phase), 0);
        const retentions = phases.filter((phase) => phase.type === 'retention');
        const holds = retentions.map(secondsOf);
        const rounds = this.sessionManager?.SESSIONS?.[sessionId]?.totalRounds || 3;
        const worlds = SESSION_WORLDS[sessionId] || SESSION_WORLDS.BASE;
        const openHolds = retentions.some((phase) => phase.hold === 'open');
        const carry = phases.filter((phase) => phase.type === 'carry');
        const largestCount = Math.max(0, ...phases.filter((phase) => phase.type === 'active').map((phase) => Math.max(...(phase.pattern || [0]))));
        let feature = `Holds to ${formatHold(Math.max(0, ...holds))}`;
        if (openHolds) feature = 'Holds at your pace';
        else if (retentions.length) feature = `Pauses to ${formatHold(Math.max(0, ...holds))}`;
        else if (carry.length) feature = `Counts to ${largestCount}`;
        return {
            ...info,
            id: sessionId,
            seconds: total,
            duration: `${Math.max(1, Math.ceil(total / 60))} min`,
            rounds,
            maxHold: formatHold(Math.max(0, ...holds)),
            openHolds,
            feature,
            breaths: phases.filter((phase) => phase.type === 'active').reduce((sum, phase) => sum + (phase.breaths || 0), 0),
            carrySeconds: carry.reduce((sum, phase) => sum + secondsOf(phase), 0),
            poster: breathPosterUrl(Array.isArray(worlds.active) ? worlds.active[0] : worlds.active),
            stages: phases.map((phase) => ({
                type: phase.type,
                round: phase.round || 0,
                seconds: secondsOf(phase),
                breaths: phase.breaths || 0,
                hold: phase.hold || null,
                world: worldOf(sessionId, phase),
            })),
        };
    }

    // ── Catalogue (inside the Hub) ──────────────────────────────────────────

    render() {
        if (!this.container) return;
        const cards = Object.keys(HALE_SESSIONS).map((sessionId) => {
            const info = this.getSessionDetails(sessionId);
            return `<article class="hale-card" data-session="${sessionId}">
                <div class="hale-card__art" style="background-image:url('${info.poster}')" aria-hidden="true"></div>
                <div class="hale-card__body">
                    <span class="hale-card__tag">${escapeHtml(info.intensity)} · ${escapeHtml(info.style)}</span>
                    <h3>${escapeHtml(info.name)}</h3>
                    <p class="hale-card__promise">${escapeHtml(info.promise)}</p>
                    <p class="hale-card__summary">${escapeHtml(info.summary)}</p>
                    <ul class="hale-card__facts">
                        <li>${csIcon('clock', 13)} ${info.duration}</li>
                        <li>${info.rounds} rounds</li>
                        <li>${escapeHtml(info.feature)}</li>
                    </ul>
                    <p class="hale-card__mine" data-mine="${sessionId}" hidden></p>
                    <button type="button" class="hale-card__begin" data-session="${sessionId}">
                        Begin ${escapeHtml(info.name)} <span aria-hidden="true">→</span>
                    </button>
                </div>
            </article>`;
        }).join('');
        this.container.innerHTML = `
            <div class="hale">
                <header class="hale__intro">
                    <span class="hale__eyebrow">Hale sessions · guided breathwork</span>
                    <h2>A voice, a rhythm, and a world that follows your breath.</h2>
                    <p>Every session arrives gently, breathes through three rounds with a stillness after each, and ends in rest.</p>
                </header>
                <section class="hale__practice" aria-label="Your practice" hidden></section>
                <section class="hale__live" hidden aria-live="polite">
                    <div>
                        <span class="hale__eyebrow">Session in progress · paused while the Hub is open</span>
                        <p class="hale__live-name"></p>
                    </div>
                    <button type="button" class="hale__return">Return to session</button>
                    <button type="button" class="hale__end">End session</button>
                </section>
                <div class="hale__grid">${cards}</div>
                <p class="hale__note">${csIcon('breath', 14)} Breath holds are strong practice. Sit or lie down, never practise in or near water or while driving, and stop if you feel dizzy.</p>
            </div>`;
        this.renderPractice();
    }

    /** Your practice: streak, this week, totals, and each session's own line. */
    renderPractice() {
        if (!this.container) return;
        const section = this.container.querySelector('.hale__practice');
        if (!section) return;
        const summary = summarizePractice(readPracticeLog(storage()));
        section.hidden = !summary.hasHistory;
        Object.keys(HALE_SESSIONS).forEach((sessionId) => {
            const line = this.container.querySelector(`[data-mine="${sessionId}"]`);
            if (!line) return;
            const mine = summary.bySession[sessionId];
            const parts = [];
            if (mine?.count) parts.push(`${mine.count} completed`);
            if (mine?.bestHold) parts.push(`best hold ${formatClock(mine.bestHold)}`);
            line.hidden = !parts.length;
            line.textContent = parts.length ? `You · ${parts.join(' · ')}` : '';
        });
        if (!summary.hasHistory) return;
        const last = HALE_SESSIONS[summary.last?.id]?.name;
        const week = summary.week.map((day) => {
            const date = new Date(day.start);
            return `<li class="${day.practised ? 'is-practised' : ''}" title="${date.toDateString()}"><i></i><span>${WEEKDAYS[date.getDay()]}</span></li>`;
        }).join('');
        const streak = `<b>${summary.streak}</b><span>${summary.streak === 1 ? 'day' : 'days in a row'}</span>`;
        const totals = [
            `${summary.completed} ${summary.completed === 1 ? 'session' : 'sessions'} completed`,
            `${formatPracticeTime(summary.seconds)} of practice`,
            last ? `last: ${last}` : '',
        ].filter(Boolean).join(' · ');
        section.innerHTML = `
            <div class="hale__streak">${csIcon('flame', 18)}<p>${streak}</p></div>
            <ol class="hale__week" aria-label="The last seven days">${week}</ol>
            <p class="hale__totals">${totals}</p>`;
    }

    // ── The full-screen flow ────────────────────────────────────────────────

    renderFlow() {
        const flow = document.createElement('div');
        flow.className = 'hale-flow serenity-hub';
        flow.hidden = true;
        flow.setAttribute('role', 'dialog');
        flow.setAttribute('aria-modal', 'true');
        flow.setAttribute('aria-labelledby', 'hale-flow-title');
        // Desktop browsers expose vibrate() too, and it does nothing there: offer it on touch only.
        const canVibrate = Boolean(this.sessionManager?.chimes?.canVibrate)
            && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
        flow.innerHTML = `
            <div class="hale-flow__art" aria-hidden="true"></div>
            <div class="hale-flow__panel hale-flow__panel--prepare" data-panel="prepare">
                <div class="hale-flow__lead">
                    <button type="button" class="hale-flow__back"><span aria-hidden="true">←</span> All sessions</button>
                    <span class="hale__eyebrow hale-flow__facts"></span>
                    <h2 id="hale-flow-title" class="hale-flow__name"></h2>
                    <p class="hale-flow__promise"></p>
                    <p class="hale-flow__about"></p>
                    <div class="hale-flow__journey" aria-label="How the session unfolds">
                        <div class="hale-flow__track"></div>
                        <ol class="hale-flow__rounds"></ol>
                        <p class="hale-flow__best" hidden></p>
                    </div>
                </div>
                <div class="hale-flow__setup">
                    <h3>Set an intention <small>optional</small></h3>
                    <div class="hale-flow__intentions" role="group" aria-label="Choose an intention"></div>
                    <div class="hale-flow__options" role="group" aria-label="Guidance">
                        <label class="hale-flow__switch">
                            <input type="checkbox" class="hale-flow__voice" checked>
                            <span>Voice guidance</span>
                        </label>
                        <label class="hale-flow__switch">
                            <input type="checkbox" class="hale-flow__sounds" checked>
                            <span>Bells and breath tones</span>
                        </label>
                        <label class="hale-flow__switch hale-flow__switch--holds">
                            <input type="checkbox" class="hale-flow__holds" checked>
                            <span>Breathe in when you are ready <small>Holds end when you choose</small></span>
                        </label>
                        <label class="hale-flow__switch" ${canVibrate ? '' : 'hidden'}>
                            <input type="checkbox" class="hale-flow__vibration" checked>
                            <span>Gentle vibration</span>
                        </label>
                    </div>
                    <div class="hale-flow__caution" hidden>
                        <p>${csIcon('shield', 15)} Holding your breath after fast breathing can make you light-headed. Sit or lie down. Never practise in or near water, while driving, or standing. Stop and breathe normally if you feel unwell.</p>
                        <label class="hale-flow__ack"><input type="checkbox" class="hale-flow__ack-input"><span>I understand</span></label>
                    </div>
                    <p class="hale-flow__safety">Sit or lie down somewhere you can let go. Breathe comfortably, and return to your natural breath whenever you need to.</p>
                    <button type="button" class="hale-flow__begin">Begin session <span aria-hidden="true">→</span></button>
                </div>
            </div>
            <div class="hale-flow__panel hale-flow__panel--countdown" data-panel="countdown" role="status" aria-live="polite" aria-atomic="true">
                <p class="hale-flow__intent"></p>
                <div class="hale-flow__number">3</div>
                <p class="hale-flow__message"></p>
                <button type="button" class="hale-flow__cancel">Back to preparation</button>
            </div>
            <div class="hale-flow__panel hale-flow__panel--complete" data-panel="complete">
                <span class="hale__eyebrow">Session complete</span>
                <h2 class="hale-flow__done-name"></h2>
                <p class="hale-flow__record" hidden></p>
                <dl class="hale-flow__stats"></dl>
                <figure class="hale-flow__holds-chart" hidden></figure>
                <p class="hale-flow__streak-line" hidden></p>
                <p class="hale-flow__closing"></p>
                <div class="hale-flow__actions">
                    <button type="button" class="hale-flow__finish">Done</button>
                    <button type="button" class="hale-flow__again">Go again</button>
                </div>
            </div>`;
        document.body.appendChild(flow);
        this.flow = flow;
    }

    get flowOpen() { return Boolean(this.flow && !this.flow.hidden); }

    /** Your saved choices: voice, bells, open holds, vibration, and the safety note read once. */
    get prefs() { return this.savedPrefs || DEFAULT_PREFS; }

    /**
     * True from Begin until the result is dismissed. The guide stops a moment before the
     * result appears; without this the game behind would resume in that gap.
     */
    get holdsScreen() { return this.flowOpen || this.sessionRunning === true; }

    showStep(step) {
        this.step = step;
        const { flow } = this;
        if (!flow) return;
        flow.dataset.step = step || '';
        flow.hidden = !step;
        flow.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== step; });
        if (step) this.scheduleUI(() => flow.classList.add('is-open'), 20);
        else flow.classList.remove('is-open');
    }

    listen(target, type, handler, options = {}) {
        target?.addEventListener?.(type, handler, { ...options, signal: this.abortController.signal });
    }

    setupEventListeners() {
        if (!this.container) return;
        this.listen(this.container, 'click', (event) => {
            const begin = event.target.closest?.('.hale-card__begin');
            if (begin) this.showPrepScreen(begin.dataset.session);
            else if (event.target.closest?.('.hale__return')) this.hub.hide();
            else if (event.target.closest?.('.hale__end')) this.requestEndFromHub();
        });
        // Native activation must not also reach a mode's global Space/Enter shortcuts.
        const keepKeys = (event) => {
            if ((event.key === ' ' || event.key === 'Enter') && event.target.closest?.('button, input')) event.stopPropagation();
        };
        this.listen(this.container, 'keydown', keepKeys);
        this.listen(this.flow, 'keydown', (event) => {
            keepKeys(event);
            this.handleFlowKey(event);
        });
        this.listen(this.flow, 'click', (event) => {
            const { target } = event;
            const intention = target.closest?.('.hale-flow__intention');
            if (intention) this.selectIntention(intention.dataset.intention, this.pendingSessionId);
            else if (target.closest?.('.hale-flow__back')) this.hidePrepScreen();
            else if (target.closest?.('.hale-flow__begin')) this.beginFromPrep();
            else if (target.closest?.('.hale-flow__cancel')) this.showPrepScreen(this.pendingSessionId);
            else if (target.closest?.('.hale-flow__finish')) this.closeCompletion();
            else if (target.closest?.('.hale-flow__again')) this.showPrepScreen(this.completedSession?.sessionId);
        });
        const toggle = (selector, key, apply) => this.listen(this.flow.querySelector(selector), 'change', (event) => {
            this.savePrefs({ [key]: Boolean(event.target.checked) });
            apply?.(Boolean(event.target.checked));
        });
        toggle('.hale-flow__voice', 'voice', (on) => {
            this.voiceGuidance = on;
            this.sessionManager?.audioManager?.setEnabled(on);
        });
        toggle('.hale-flow__sounds', 'sounds');
        toggle('.hale-flow__holds', 'openHolds', () => this.renderJourney(this.pendingSessionId));
        toggle('.hale-flow__vibration', 'vibration');
        toggle('.hale-flow__ack-input', 'safetyAcknowledged', () => this.updateBegin());
        // The Hub over a running session holds it; closing the Hub lets it continue.
        this.listen(window, 'serenityHubVisibilityChange', (event) => {
            if (!this.sessionRunning || !this.sessionManager?.activeSession) return;
            if (event.detail?.visible) this.sessionManager.suspend?.('hub');
            else this.sessionManager.unsuspend?.('hub');
        });
    }

    savePrefs(changes) {
        this.savedPrefs = { ...this.prefs, ...changes };
        try {
            storage()?.setItem(PREFS_KEY, JSON.stringify(this.savedPrefs));
        } catch { /* private browsing: the choice holds for this visit */ }
    }

    handleFlowKey(event) {
        if (!this.flowOpen) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.back();
        } else if (event.key === 'Tab') {
            const panel = this.flow.querySelector(`[data-panel="${this.step}"]`);
            const controls = [...(panel?.querySelectorAll('button:not(:disabled), input') || [])];
            if (!controls.length) return;
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    }

    /** One step back: countdown → preparation → catalogue; a result closes. */
    back() {
        if (this.step === 'countdown') this.showPrepScreen(this.pendingSessionId);
        else if (this.step === 'prepare') this.hidePrepScreen();
        else if (this.step === 'complete') this.closeCompletion();
    }

    /** A gamepad's A inside the flow: press whatever has focus (Begin, Cancel, Done). */
    primaryAction() {
        if (!this.flowOpen) return false;
        const focused = document.activeElement;
        const panel = this.flow.querySelector(`[data-panel="${this.step}"]`);
        const target = focused && panel?.contains?.(focused) ? focused : panel?.querySelector('.hale-flow__begin, .hale-flow__finish, .hale-flow__cancel');
        if (!target || target.disabled) return true;
        target.click?.();
        return true;
    }

    scheduleUI(callback, delay) {
        const timer = setTimeout(() => {
            this.pendingTimers.delete(timer);
            if (!this.destroyed) callback();
        }, delay);
        this.pendingTimers.set(timer, null);
        return timer;
    }

    waitForCountdown(delay) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pendingTimers.delete(timer);
                resolve(true);
            }, delay);
            this.pendingTimers.set(timer, resolve);
        });
    }

    cancelPendingUI() {
        this.countdownGeneration += 1;
        this.pendingTimers.forEach((resolve, timer) => {
            clearTimeout(timer);
            resolve?.(false);
        });
        this.pendingTimers.clear();
        this.endArmed = null;
    }

    /** The journey, stage by stage, with the world each one is set in. */
    renderJourney(sessionId) {
        const info = this.getSessionDetails(sessionId);
        if (!info || !this.flow) return;
        const { flow } = this;
        const openHolds = info.openHolds && this.prefs.openHolds !== false;
        const thumbs = (stages) => `<span class="hale-flow__worlds" aria-hidden="true">${stages.map((stage) => (
            `<i style="background-image:url('${breathPosterUrl(stage.world)}')" title="${escapeHtml(getBreathWorld(stage.world).name)}"></i>`
        )).join('')}</span>`;
        flow.querySelector('.hale-flow__track').innerHTML = info.stages.map((stage) => (
            `<i data-type="${stage.type}" style="flex-grow:${Math.max(stage.seconds, 1)}" title="${STAGE_NAMES[stage.type]} · ${formatClock(stage.seconds)}"></i>`
        )).join('');
        const arrive = info.stages.find((stage) => stage.type === 'grounding');
        const rest = info.stages.find((stage) => stage.type === 'integration');
        const rounds = [];
        for (let round = 1; round <= info.rounds; round++) {
            const stages = info.stages.filter((stage) => stage.round === round);
            const breathe = stages.find((stage) => stage.type === 'active');
            const hold = stages.find((stage) => stage.type === 'retention');
            const carry = stages.find((stage) => stage.type === 'carry');
            let still = '';
            if (hold && hold.hold === 'open' && openHolds) still = ` · hold at your pace, about ${formatClock(hold.seconds)}`;
            else if (hold) still = ` · ${hold.hold === 'timed' ? 'pause' : 'hold'} ${formatClock(hold.seconds)}`;
            else if (carry) still = ` · ${formatClock(carry.seconds)} on your own`;
            const shown = stages.filter((stage) => stage.type !== 'recovery');
            rounds.push(`<li>${thumbs(shown)}<b>Round ${round}</b> ${breathe ? `${breathe.breaths} breaths` : ''}${still} · ${carry ? 'reset' : 'recover'}</li>`);
        }
        flow.querySelector('.hale-flow__rounds').innerHTML = [
            arrive ? `<li>${thumbs([arrive])}<b>Arrive</b> ${formatClock(arrive.seconds)} of slow breathing</li>` : '',
            ...rounds,
            rest ? `<li>${thumbs([rest])}<b>Rest</b> ${formatClock(rest.seconds)} of natural breath</li>` : '',
        ].join('');
        const best = summarizePractice(readPracticeLog(storage())).bySession[sessionId]?.bestHold || 0;
        const bestLine = flow.querySelector('.hale-flow__best');
        bestLine.hidden = !(info.openHolds && best > 0);
        bestLine.textContent = bestLine.hidden ? '' : `Your best hold in ${info.name}: ${formatClock(best)}`;
    }

    /** Begin is ready unless a strong-hold session still needs its one-time safety note read. */
    updateBegin() {
        const info = this.getSessionDetails(this.pendingSessionId);
        if (!info || !this.flow) return;
        const caution = info.openHolds && !this.prefs.safetyAcknowledged;
        const begin = this.flow.querySelector('.hale-flow__begin');
        begin.disabled = false;
        if (caution) {
            const read = Boolean(this.flow.querySelector('.hale-flow__ack-input').checked);
            begin.disabled = !read;
        }
    }

    /** Open the preparation screen for a session. */
    showPrepScreen(sessionId) {
        if (this.destroyed) return;
        const info = this.getSessionDetails(sessionId);
        if (!info) return;
        this.cancelPendingUI();
        this.pendingSessionId = sessionId;
        this.selectedIntention = null;
        this.completedSession = null;
        this.focusReturn = this.container?.querySelector(`.hale-card__begin[data-session="${sessionId}"]`) || null;
        const { flow } = this;
        flow.dataset.session = sessionId;
        flow.querySelector('.hale-flow__art').style.backgroundImage = `url('${info.poster}')`;
        flow.querySelector('.hale-flow__facts').textContent = `${info.duration} · ${info.intensity} · ${info.style}`;
        flow.querySelector('.hale-flow__name').textContent = info.name;
        flow.querySelector('.hale-flow__promise').textContent = info.promise;
        flow.querySelector('.hale-flow__about').textContent = info.about;
        this.renderJourney(sessionId);
        flow.querySelector('.hale-flow__intentions').innerHTML = (INTENTIONS[sessionId] || []).map((intent) => `
            <button type="button" class="hale-flow__intention" data-intention="${intent.id}" aria-pressed="false">
                ${csIcon(intent.icon, 18)}<span>${escapeHtml(intent.label)}</span>
            </button>`).join('');
        flow.querySelector('.hale-flow__voice').checked = this.voiceGuidance;
        flow.querySelector('.hale-flow__sounds').checked = this.prefs.sounds !== false;
        flow.querySelector('.hale-flow__vibration').checked = this.prefs.vibration !== false;
        const holds = flow.querySelector('.hale-flow__holds');
        holds.checked = this.prefs.openHolds !== false;
        flow.querySelector('.hale-flow__switch--holds').hidden = !info.openHolds;
        const caution = flow.querySelector('.hale-flow__caution');
        caution.hidden = !info.openHolds;
        flow.querySelector('.hale-flow__ack').hidden = Boolean(this.prefs.safetyAcknowledged);
        flow.querySelector('.hale-flow__ack-input').checked = Boolean(this.prefs.safetyAcknowledged);
        flow.querySelector('.hale-flow__safety').hidden = info.openHolds;
        const begin = flow.querySelector('.hale-flow__begin');
        begin.setAttribute('aria-label', `Begin ${info.name}. Intention optional.`);
        this.updateBegin();
        this.showStep('prepare');
        // The flow is its own surface: the Hub steps aside but keeps holding gameplay.
        this.hub.hide();
        this.scheduleUI(() => (begin.disabled ? flow.querySelector('.hale-flow__ack-input') : begin).focus?.({ preventScroll: true }), 30);
    }

    /** Leave the flow and return to the catalogue. */
    hidePrepScreen() {
        if (!this.flowOpen && !this.pendingSessionId) return;
        this.cancelPendingUI();
        this.showStep(null);
        this.pendingSessionId = null;
        this.selectedIntention = null;
        this.hub.switchTab?.('sessions');
        this.hub.show?.();
        this.focusReturn?.focus?.({ preventScroll: true });
    }

    selectIntention(intentionId, sessionId) {
        const intention = (INTENTIONS[sessionId] || []).find((item) => item.id === intentionId);
        if (!intention) return;
        // Choosing the same intention again clears it: it was always optional.
        this.selectedIntention = this.selectedIntention?.id === intentionId ? null : intention;
        if (this.selectedIntention && this.voiceGuidance) {
            this.sessionManager?.audioManager?.playVoice(this.intentionClip(sessionId, intentionId));
        }
        this.flow.querySelectorAll('.hale-flow__intention').forEach((button) => {
            const pressed = button.dataset.intention === this.selectedIntention?.id;
            button.setAttribute('aria-pressed', String(pressed));
            button.classList.toggle('is-selected', pressed);
        });
        const info = this.getSessionDetails(sessionId);
        this.flow.querySelector('.hale-flow__begin').setAttribute('aria-label', this.selectedIntention
            ? `Begin ${info.name} with intention: ${this.selectedIntention.label}` : `Begin ${info.name}. Intention optional.`);
    }

    intentionClip(sessionId, intentionId) {
        return `intentions/${String(sessionId).toLowerCase()}_${intentionId}.wav`;
    }

    /** Begin, from a click: the moment the browser lets sound and vibration start. */
    beginFromPrep() {
        const begin = this.flow?.querySelector('.hale-flow__begin');
        if (begin?.disabled) return;
        this.sessionManager?.chimes?.prime?.();
        this.startCountdown();
    }

    async startCountdown() {
        this.cancelPendingUI();
        const generation = this.countdownGeneration;
        const sessionId = this.pendingSessionId;
        if (!sessionId || !this.getSessionDetails(sessionId)) return;
        const { flow } = this;
        flow.querySelector('.hale-flow__intent').textContent = this.selectedIntention
            ? `Your intention: ${this.selectedIntention.label}` : 'Nothing to achieve. Just be here.';
        this.showStep('countdown');
        this.scheduleUI(() => flow.querySelector('.hale-flow__cancel').focus?.({ preventScroll: true }), 30);
        const number = flow.querySelector('.hale-flow__number');
        const message = flow.querySelector('.hale-flow__message');
        for (let i = 0; i < COUNTDOWN.length; i++) {
            const last = i === COUNTDOWN.length - 1;
            number.textContent = COUNTDOWN[i][0];
            message.textContent = last && !this.voiceGuidance ? 'Follow the light' : COUNTDOWN[i][1];
            number.classList.toggle('is-word', last);
            // Beats are sequential on purpose; cancellation settles the pending wait.
            // eslint-disable-next-line no-await-in-loop
            const elapsed = await this.waitForCountdown(last ? 900 : 1000);
            if (!elapsed || this.destroyed || generation !== this.countdownGeneration) return;
        }
        this.startSession(sessionId);
    }

    startSession(sessionId) {
        if (this.destroyed || !this.getSessionDetails(sessionId)) return;
        this.completedSession = null;
        this.sessionRunning = true;
        const generation = ++this.sessionGeneration;
        // Only an intention of this session: each one has its own spoken clip.
        const intention = (INTENTIONS[sessionId] || []).some((item) => item.id === this.selectedIntention?.id)
            ? this.selectedIntention : null;
        this.selectedIntention = intention;
        this.sessionManager.audioManager?.setEnabled(this.voiceGuidance);
        this.sessionManager.onEndRequested = () => this.stopSession();
        this.sessionManager.startSession(
            sessionId,
            (progress) => {
                // Ignore reports from a session that was replaced or ended.
                if (generation === this.sessionGeneration) this.updateLive(progress);
            },
            (stats) => {
                if (this.destroyed || generation !== this.sessionGeneration) return;
                this.activeSessionData = null;
                this.updateLive(null);
                this.hub.breathingTab?.refresh();
                this.showCompletionMessage({ ...stats, sessionId });
            },
            {
                intention: intention ? { ...intention, clip: this.intentionClip(sessionId, intention.id) } : null,
                openHolds: this.prefs.openHolds !== false,
                sounds: this.prefs.sounds !== false,
                vibration: this.prefs.vibration !== false,
            },
        );
        // The session now owns the screen: both the flow and the Hub step aside.
        this.showStep(null);
        this.hub.hide();
    }

    /** The Hub's End asks for a second press: it is a long session to lose by accident. */
    requestEndFromHub() {
        const button = this.container?.querySelector('.hale__end');
        if (this.endArmed) {
            clearTimeout(this.endArmed);
            this.pendingTimers.delete(this.endArmed);
            this.endArmed = null;
            if (button) button.textContent = 'End session';
            this.stopSession();
            return;
        }
        if (button) button.textContent = 'Press again to end';
        this.endArmed = this.scheduleUI(() => {
            this.endArmed = null;
            if (button) button.textContent = 'End session';
        }, END_CONFIRM_MS);
    }

    /** End the running session without a result (you chose to stop); the time still counts. */
    stopSession() {
        const practised = this.sessionManager.snapshot?.();
        this.sessionGeneration += 1;
        this.sessionRunning = false;
        this.cancelPendingUI();
        this.sessionManager.stopSession();
        if (practised && practised.totalDuration >= MIN_PRACTICE_SECONDS) {
            recordPractice({
                id: practised.sessionId,
                seconds: practised.totalDuration,
                completed: false,
                rounds: practised.rounds,
                breaths: practised.breaths,
                holds: practised.holds,
                intention: practised.intention,
            }, storage());
        }
        this.activeSessionData = null;
        this.updateLive(null);
        this.renderPractice();
        this.hub.breathingTab?.refresh();
        this.hub.releaseGameplay?.();
    }

    /** Cancel every session surface without returning focus to the previous mode. */
    cancelForModeChange() {
        if (this.destroyed) return;
        this.sessionGeneration += 1;
        this.sessionRunning = false;
        this.cancelPendingUI();
        this.sessionManager.stopSession();
        this.activeSessionData = null;
        this.updateLive(null);
        this.showStep(null);
        this.pendingSessionId = null;
        this.selectedIntention = null;
        this.completedSession = null;
        this.focusReturn = null;
    }

    setActive(active) {
        this.active = Boolean(active) && !this.destroyed;
        if (this.active) {
            this.renderPractice();
            this.updateLive(this.activeSessionData);
        }
    }

    /** Keep the catalogue's "session in progress" strip current while the Hub is open. */
    updateLive(progress) {
        if (this.destroyed) return;
        this.activeSessionData = progress || null;
        if (!this.active || !this.container) return;
        const live = this.container.querySelector('.hale__live');
        if (!live) return;
        const running = Boolean(progress && this.sessionManager?.activeSession);
        if (live.hidden === running) live.hidden = !running;
        if (!running) return;
        const round = progress.round > 0 ? ` · Round ${progress.round} of ${progress.totalRounds}` : '';
        const text = `${progress.sessionName || 'Session'}${round} · ${STAGE_NAMES[progress.phase] || ''}`;
        const name = live.querySelector('.hale__live-name');
        if (name.textContent !== text) name.textContent = text;
    }

    /** Your holds, one bar per round, each beside the length it was suggested. */
    renderHoldsChart(holds, previousBest) {
        const chart = this.flow.querySelector('.hale-flow__holds-chart');
        const open = holds.filter((hold) => hold.mode === 'open');
        chart.hidden = !open.length;
        if (!open.length) {
            chart.innerHTML = '';
            return;
        }
        const top = Math.max(...open.map((hold) => Math.max(hold.seconds, hold.suggested)), previousBest, 1);
        const best = Math.max(...open.map((hold) => hold.seconds));
        chart.innerHTML = `<figcaption>Your holds <small>${previousBest > 0 ? `previous best ${formatClock(previousBest)}` : 'marks show the suggested length'}</small></figcaption>
            <ol>${open.map((hold) => `
                <li class="${hold.seconds === best ? 'is-best' : ''}" style="--h:${(hold.seconds / top).toFixed(3)};--s:${(hold.suggested / top).toFixed(3)}">
                    <span class="hale-flow__bar"><i></i></span>
                    <b>${formatClock(hold.seconds)}</b>
                    <small>Round ${hold.round}</small>
                </li>`).join('')}
            </ol>`;
    }

    showCompletionMessage(stats) {
        if (this.destroyed || !this.flow) return;
        const info = this.getSessionDetails(stats.sessionId) || {};
        this.completedSession = stats;
        const holds = Array.isArray(stats.holds) ? stats.holds : [];
        const record = recordPractice({
            id: stats.sessionId,
            seconds: stats.totalDuration,
            completed: true,
            rounds: stats.rounds ?? info.rounds,
            breaths: stats.breaths ?? info.breaths,
            holds,
            intention: stats.intention ?? this.selectedIntention?.label ?? null,
        }, storage());
        const { flow } = this;
        flow.dataset.session = stats.sessionId || '';
        if (info.poster) flow.querySelector('.hale-flow__art').style.backgroundImage = `url('${info.poster}')`;
        flow.querySelector('.hale-flow__done-name').textContent = stats.sessionName || info.name || 'Hale session';
        const longest = longestOpenHold(holds);
        let last = [info.maxHold || '—', 'Longest hold'];
        if (longest > 0) last = [formatClock(longest), 'Longest hold'];
        else if (holds.length) last = [info.maxHold, 'Longest pause'];
        else if (info.carrySeconds) last = [formatClock(info.carrySeconds), 'On your own'];
        flow.querySelector('.hale-flow__stats').innerHTML = [
            [formatClock(stats.totalDuration), 'Time for yourself'],
            [stats.rounds ?? info.rounds ?? 3, 'Rounds'],
            [stats.breaths ?? info.breaths ?? 0, 'Guided breaths'],
            last,
        ].map(([value, label]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
        const badge = flow.querySelector('.hale-flow__record');
        badge.hidden = !record.personalBest;
        badge.innerHTML = record.personalBest
            ? `${csIcon('trophy', 15)} New best hold: ${formatClock(record.longestHold)} <small>was ${formatClock(record.previousBest)}</small>` : '';
        this.renderHoldsChart(holds, record.previousBest);
        const summary = summarizePractice(record.log);
        const streak = flow.querySelector('.hale-flow__streak-line');
        streak.hidden = !record.recorded;
        streak.textContent = record.recorded ? [
            summary.streak > 1 ? `${summary.streak} days in a row` : 'Practised today',
            `${summary.completed} ${summary.completed === 1 ? 'session' : 'sessions'}`,
            `${formatPracticeTime(summary.seconds)} of practice`,
        ].join(' · ') : '';
        const intention = this.selectedIntention?.label || stats.intention;
        flow.querySelector('.hale-flow__closing').textContent = intention
            ? `You arrived with: ${intention}. Let your next moment begin gently.`
            : 'Notice your breath. Let your next moment begin gently.';
        this.showStep('complete');
        this.scheduleUI(() => flow.querySelector('.hale-flow__finish').focus?.({ preventScroll: true }), 30);
    }

    closeCompletion() {
        this.sessionRunning = false;
        this.showStep(null);
        this.completedSession = null;
        this.pendingSessionId = null;
        this.selectedIntention = null;
        this.renderPractice();
        this.hub.releaseGameplay?.();
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.active = false;
        this.sessionRunning = false;
        this.sessionGeneration += 1;
        this.cancelPendingUI();
        this.abortController.abort();
        if (this.sessionManager) this.sessionManager.onEndRequested = null;
        this.flow?.remove();
        this.flow = null;
        this.activeSessionData = null;
        this.completedSession = null;
        this.focusReturn = null;
        this.container = null;
    }
}
