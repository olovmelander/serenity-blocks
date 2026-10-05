/**
 * Hale sessions: the catalogue in the Hub, and the full-screen flow around a session
 * (prepare → countdown → the session itself in the breathing guide → complete).
 *
 * The catalogue lives in the Hub's tab. Everything after "Begin" is its own full-screen
 * surface, so preparing for twenty minutes of breathwork is never squeezed into a side panel.
 * Timing, voice and stages belong to BreathworkSessionManager; this file only presents them.
 */
import { csIcon } from '../components/cosmic-icons.js';
import { breathPosterUrl } from '../effects/breathing/breath-catalogue.js';
import { SESSION_WORLDS } from '../effects/breathwork-session-manager.js';

/** What each session is for. Durations, rounds and holds are read from the manager. */
export const HALE_SESSIONS = Object.freeze({
    BASE: {
        name: 'Hale Base',
        promise: 'Come back to yourself',
        summary: 'Rhythmic nasal breathing, quiet holds, and a grounded finish.',
        about: 'Three rounds of steady breathing through the nose. Each round is a little quicker than the last and ends in a longer stillness, then the session lets you rest.',
        intensity: 'Moderate',
        style: 'Nasal breathing',
    },
    ELIXIR: {
        name: 'Hale Elixir',
        promise: 'Meet your inner spark',
        summary: 'Connected mouth breathing that builds, then drops into deep stillness.',
        about: 'The most active session. Three rounds of fast, connected breathing through the mouth, each followed by a hold on empty lungs and one strong recovery breath.',
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
        about: 'In, hold, out, hold: four equal sides. The count grows from four to five to six across three rounds, with a quiet stretch after each.',
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
    grounding: 'Arrive', active: 'Breathe', retention: 'Hold', recovery: 'Recover', integration: 'Rest',
};
const COUNTDOWN = [
    ['3', 'Find a comfortable position'],
    ['2', 'Soften your shoulders'],
    ['1', 'Let one slow breath go'],
    ['Begin', 'Follow the voice and the light'],
];
const STATS_KEY = 'serenity.haleSessions';

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

function readStats() {
    try {
        const stats = JSON.parse(window.localStorage.getItem(STATS_KEY) || 'null');
        return stats && Number.isFinite(stats.count) ? stats : null;
    } catch {
        return null;
    }
}

function recordSession(sessionId, seconds) {
    try {
        const stats = readStats() || { count: 0, seconds: 0 };
        window.localStorage.setItem(STATS_KEY, JSON.stringify({
            count: stats.count + 1,
            seconds: stats.seconds + Math.max(0, Math.round(seconds)),
            last: { id: sessionId, at: Date.now() },
        }));
    } catch { /* private browsing: the practice still happened */ }
}

export class SessionsTab {
    constructor(hub, sessionManager) {
        this.hub = hub;
        this.sessionManager = sessionManager;
        this.container = hub.panel.querySelector('#tab-sessions');
        this.active = false;
        this.destroyed = false;
        this.pendingSessionId = null;
        this.selectedIntention = null;
        this.voiceGuidance = true;
        this.step = null;
        this.focusReturn = null;
        this.activeSessionData = null;
        this.completedSession = null;
        this.countdownGeneration = 0;
        this.sessionGeneration = 0;
        this.pendingTimers = new Map();
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
        const secondsOf = (phase) => {
            const seconds = phase.type === 'active'
                ? phase.pattern.reduce((sum, part) => sum + part, 0) * phase.breaths : phase.duration;
            return Number.isFinite(seconds) ? seconds : 0;
        };
        const total = phases.reduce((sum, phase) => sum + secondsOf(phase), 0);
        const holds = phases.filter((phase) => phase.type === 'retention').map(secondsOf);
        const rounds = this.sessionManager?.SESSIONS?.[sessionId]?.totalRounds || 3;
        const worlds = SESSION_WORLDS[sessionId] || SESSION_WORLDS.BASE;
        return {
            ...info,
            id: sessionId,
            seconds: total,
            duration: `${Math.max(1, Math.ceil(total / 60))} min`,
            rounds,
            maxHold: formatHold(Math.max(0, ...holds)),
            breaths: phases.filter((phase) => phase.type === 'active').reduce((sum, phase) => sum + phase.breaths, 0),
            poster: breathPosterUrl(Array.isArray(worlds.active) ? worlds.active[0] : worlds.active),
            stages: phases.map((phase) => ({
                type: phase.type, round: phase.round || 0, seconds: secondsOf(phase), breaths: phase.breaths || 0,
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
                        <li>Holds to ${info.maxHold}</li>
                    </ul>
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
                    <p class="hale__practice" hidden></p>
                </header>
                <section class="hale__live" hidden aria-live="polite">
                    <div>
                        <span class="hale__eyebrow">Session in progress</span>
                        <p class="hale__live-name"></p>
                    </div>
                    <button type="button" class="hale__return">Return to session</button>
                    <button type="button" class="hale__end">End session</button>
                </section>
                <div class="hale__grid">${cards}</div>
                <p class="hale__note">${csIcon('breath', 14)} Breath holds are strong practice. Sit or lie down, never practise in water or while driving, and stop if you feel dizzy.</p>
            </div>`;
        this.renderPractice();
    }

    renderPractice() {
        const line = this.container?.querySelector('.hale__practice');
        if (!line) return;
        const stats = readStats();
        line.hidden = !stats;
        if (!stats) return;
        const last = HALE_SESSIONS[stats.last?.id]?.name;
        line.textContent = [
            `${stats.count} ${stats.count === 1 ? 'session' : 'sessions'} completed`,
            `${Math.max(1, Math.round(stats.seconds / 60))} min of practice`,
            last ? `last: ${last}` : '',
        ].filter(Boolean).join(' · ');
    }

    // ── The full-screen flow ────────────────────────────────────────────────

    renderFlow() {
        const flow = document.createElement('div');
        flow.className = 'hale-flow serenity-hub';
        flow.hidden = true;
        flow.setAttribute('role', 'dialog');
        flow.setAttribute('aria-modal', 'true');
        flow.setAttribute('aria-labelledby', 'hale-flow-title');
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
                    </div>
                </div>
                <div class="hale-flow__setup">
                    <h3>Set an intention <small>optional</small></h3>
                    <div class="hale-flow__intentions" role="group" aria-label="Choose an intention"></div>
                    <label class="hale-flow__switch">
                        <input type="checkbox" class="hale-flow__voice" checked>
                        <span>Voice guidance</span>
                    </label>
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
                <dl class="hale-flow__stats"></dl>
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
        target?.addEventListener(type, handler, { ...options, signal: this.abortController.signal });
    }

    setupEventListeners() {
        if (!this.container) return;
        this.listen(this.container, 'click', (event) => {
            const begin = event.target.closest?.('.hale-card__begin');
            if (begin) this.showPrepScreen(begin.dataset.session);
            else if (event.target.closest?.('.hale__return')) this.hub.hide();
            else if (event.target.closest?.('.hale__end')) this.stopSession();
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
            else if (target.closest?.('.hale-flow__begin')) this.startCountdown();
            else if (target.closest?.('.hale-flow__cancel')) this.showPrepScreen(this.pendingSessionId);
            else if (target.closest?.('.hale-flow__finish')) this.closeCompletion();
            else if (target.closest?.('.hale-flow__again')) this.showPrepScreen(this.completedSession?.sessionId);
        });
        this.listen(this.flow.querySelector('.hale-flow__voice'), 'change', (event) => {
            this.voiceGuidance = event.target.checked;
            this.sessionManager?.audioManager?.setEnabled(this.voiceGuidance);
        });
    }

    handleFlowKey(event) {
        if (!this.flowOpen) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (this.step === 'countdown') this.showPrepScreen(this.pendingSessionId);
            else if (this.step === 'prepare') this.hidePrepScreen();
            else this.closeCompletion();
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
            rounds.push(`<li><b>Round ${round}</b> ${breathe ? `${breathe.breaths} breaths` : ''}${hold ? ` · hold ${formatClock(hold.seconds)}` : ''} · recover</li>`);
        }
        flow.querySelector('.hale-flow__rounds').innerHTML = [
            arrive ? `<li><b>Arrive</b> ${formatClock(arrive.seconds)} of slow breathing</li>` : '',
            ...rounds,
            rest ? `<li><b>Rest</b> ${formatClock(rest.seconds)} of natural breath</li>` : '',
        ].join('');
        flow.querySelector('.hale-flow__intentions').innerHTML = (INTENTIONS[sessionId] || []).map((intent) => `
            <button type="button" class="hale-flow__intention" data-intention="${intent.id}" aria-pressed="false">
                ${csIcon(intent.icon, 18)}<span>${escapeHtml(intent.label)}</span>
            </button>`).join('');
        flow.querySelector('.hale-flow__voice').checked = this.voiceGuidance;
        const begin = flow.querySelector('.hale-flow__begin');
        begin.disabled = false;
        begin.setAttribute('aria-label', `Begin ${info.name}. Intention optional.`);
        this.showStep('prepare');
        // The flow is its own surface: the Hub steps aside but keeps holding gameplay.
        this.hub.hide();
        this.scheduleUI(() => begin.focus?.({ preventScroll: true }), 30);
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
            this.sessionManager?.audioManager?.playVoice(`intentions/${sessionId.toLowerCase()}_${intentionId}.wav`);
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
            [number.textContent, message.textContent] = COUNTDOWN[i];
            number.classList.toggle('is-word', i === COUNTDOWN.length - 1);
            // Beats are sequential on purpose; cancellation settles the pending wait.
            // eslint-disable-next-line no-await-in-loop
            const elapsed = await this.waitForCountdown(i === COUNTDOWN.length - 1 ? 900 : 1000);
            if (!elapsed || this.destroyed || generation !== this.countdownGeneration) return;
        }
        this.startSession(sessionId);
    }

    startSession(sessionId) {
        if (this.destroyed || !this.getSessionDetails(sessionId)) return;
        this.completedSession = null;
        this.sessionRunning = true;
        const generation = ++this.sessionGeneration;
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
        );
        // The session now owns the screen: both the flow and the Hub step aside.
        this.showStep(null);
        this.hub.hide();
    }

    /** End the running session without a result (the player chose to stop). */
    stopSession() {
        this.sessionGeneration += 1;
        this.sessionRunning = false;
        this.cancelPendingUI();
        this.sessionManager.stopSession();
        this.activeSessionData = null;
        this.updateLive(null);
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

    showCompletionMessage(stats) {
        if (this.destroyed || !this.flow) return;
        const info = this.getSessionDetails(stats.sessionId) || {};
        this.completedSession = stats;
        recordSession(stats.sessionId, stats.totalDuration);
        const { flow } = this;
        flow.dataset.session = stats.sessionId || '';
        if (info.poster) flow.querySelector('.hale-flow__art').style.backgroundImage = `url('${info.poster}')`;
        flow.querySelector('.hale-flow__done-name').textContent = stats.sessionName || info.name || 'Hale session';
        flow.querySelector('.hale-flow__stats').innerHTML = [
            [formatClock(stats.totalDuration), 'Time for yourself'],
            [stats.rounds || info.rounds || 3, 'Rounds'],
            [info.breaths || 0, 'Guided breaths'],
            [info.maxHold || '—', 'Longest hold'],
        ].map(([value, label]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
        flow.querySelector('.hale-flow__closing').textContent = this.selectedIntention
            ? `You arrived with: ${this.selectedIntention.label}. Let your next moment begin gently.`
            : 'Notice your breath. Let your next moment begin gently.';
        this.showStep('complete');
        this.scheduleUI(() => flow.querySelector('.hale-flow__finish').focus?.({ preventScroll: true }), 30);
    }

    closeCompletion() {
        this.sessionRunning = false;
        this.showStep(null);
        this.completedSession = null;
        this.pendingSessionId = null;
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
