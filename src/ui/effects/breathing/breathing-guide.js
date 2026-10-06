/**
 * The breathing guide: a full-screen world that breathes with you, and the few words and
 * marks that tell you what to do — a phase, a count, and a bar that shows the whole cycle.
 *
 * This module is on the menu's boot path, so it stays small and three-free: timing, DOM and
 * a CSS orb that works on any device. The living world is a lazily loaded three r186 stage
 * (WebGPU, or its WebGL2 backend) that is attached only when a guide actually starts.
 *
 * Two owners drive it: the player (a standalone practice) or a Hale session, which takes the
 * rhythm over with setExternalControl() and reports its journey through the session methods.
 */
import {
    BREATH_WORLDS, DEFAULT_BREATH_WORLD, formatPattern, getBreathWorld,
} from './breath-catalogue.js';
import {
    BREATH_PHASES, breathLevel, cycleSeconds, isValidPattern, nextPhase,
} from './breath-clock.js';

const PHASE_WORDS = ['Breathe in', 'Hold', 'Breathe out', 'Rest'];
const SEGMENT_LABELS = ['In', 'Hold', 'Out', 'Rest'];
const SESSION_STAGE_LABELS = {
    grounding: 'Arrive', active: 'Breathe', retention: 'Hold', carry: 'On your own', recovery: 'Recover', integration: 'Rest',
};
/** What the guide says in the stages that are not counted breaths. */
const GUIDANCE_WORDS = {
    natural: { phase: 'Breathe naturally', hint: 'Let the breath find its own pace' },
    carry: { phase: 'Keep the rhythm', hint: 'On your own now: in, hold, out, hold' },
    closing: { phase: 'Come back gently', hint: 'Open your eyes when you are ready' },
    'timed-hold': { phase: 'Pause', hint: 'Rest on empty, softly' },
};
const CHAPTER_MS = 3600;
const SESSION_ACCENTS = {
    BASE: [125, 211, 252], ELIXIR: [255, 150, 120], REST: [196, 176, 255], FLOW: [110, 234, 212],
};
const QUALITY_ORDER = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];
const STAGE_IDLE_MS = 45000;
const LEAVE_MS = 420;

// The stage is the only path from here to three.js: load it on first use, never at boot.
let stageModulePromise = null;
function loadStageModule() {
    if (!stageModulePromise) stageModulePromise = import('./stage/breath-stage.js');
    return stageModulePromise;
}

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const formatClock = (seconds) => {
    const safe = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

export class BreathingGuide {
    constructor(container) {
        this.container = container;
        this.isActive = false;
        this.isExternallyControlled = false;
        this.showText = true;
        this.currentTechnique = DEFAULT_BREATH_WORLD;
        this.world = getBreathWorld(this.currentTechnique);
        this.pattern = [...this.world.pattern];
        this.currentPhase = 'inhale';
        this.phaseStartTime = 0;
        this.animationFrame = null;
        this.onPhaseChangeCallback = null;
        /** Set by a session: receives 'pause', 'resume' or 'end' from the guide's own controls. */
        this.onControl = null;
        this.sessionPhase = null;
        this.sessionId = null;
        this.stage = null;
        this.stageToken = 0;
        this.timers = new Set();
        this._isPaused = false;
        this._hiddenAt = null;
        this._destroyed = false;
        this._presentation = new WeakMap();
        this._journey = [];
        this._progress = {};
        this._progressVisible = false;
        /** How a session's current stage is guided: see setGuidance(). */
        this.guidance = null;
        this.intention = null;
        this._holdReady = false;
        this._chapterTimer = null;

        // Legacy shape read by the Hub and Serenity Mode: id → { name, pattern, description, color }.
        this.techniques = Object.fromEntries(BREATH_WORLDS.map((world) => [world.id, {
            name: world.name,
            pattern: world.pattern,
            description: world.summary,
            color: { r: world.accent[0], g: world.accent[1], b: world.accent[2] },
        }]));

        this._build();
        this._tick = () => this._animate();
        this._onVisibility = () => {
            if (!this.isActive || this._isPaused) return;
            if (document.hidden) {
                this._hiddenAt = performance.now();
                this._cancelFrame();
            } else if (this._hiddenAt !== null) {
                // A standalone practice waits for you; a session's clock belongs to its manager.
                if (!this.isExternallyControlled) this.phaseStartTime += performance.now() - this._hiddenAt;
                this._hiddenAt = null;
                this._animate();
            }
        };
        this._onKey = (event) => this._handleKey(event);
        this._onResize = () => this._syncLayout();
        document.addEventListener('visibilitychange', this._onVisibility);
    }

    _build() {
        this.root = el('div', 'breath-guide');
        this.root.id = 'breathing-guide';
        this.root.hidden = true;
        this.root.dataset.world = this.currentTechnique;
        this.root.dataset.phase = 'inhale';
        this.root.setAttribute('role', 'region');
        this.root.setAttribute('aria-label', 'Breathing guide');

        this.stageHost = el('div', 'breath-guide__stage');
        // Without a GPU the guide still breathes: one soft orb, scaled by the same breath.
        this.fallback = el('div', 'breath-guide__fallback');
        this.fallback.append(el('span', 'breath-guide__orb'), el('span', 'breath-guide__orb breath-guide__orb--ring'));
        this.fallback.setAttribute('aria-hidden', 'true');
        const scrim = el('div', 'breath-guide__scrim');
        scrim.setAttribute('aria-hidden', 'true');

        this.eyebrow = el('p', 'breath-guide__eyebrow');
        this.title = el('h2', 'breath-guide__title');
        this.note = el('p', 'breath-guide__note');
        this.intentionLine = el('p', 'breath-guide__intention');
        this.intentionLine.hidden = true;
        const header = el('header', 'breath-guide__header');
        header.append(this.eyebrow, this.title, this.note, this.intentionLine);

        this.phaseWord = el('div', 'breath-guide__phase', PHASE_WORDS[0]);
        this.phaseWord.setAttribute('role', 'status');
        this.phaseWord.setAttribute('aria-live', 'polite');
        this.phaseWord.setAttribute('aria-atomic', 'true');
        this.count = el('div', 'breath-guide__count');
        this.count.setAttribute('aria-hidden', 'true');
        this.hint = el('div', 'breath-guide__hint');
        this.hint.setAttribute('aria-hidden', 'true');
        // A hold's dial: a ring that fills toward the suggested length, the time inside it.
        this.holdDial = el('div', 'breath-guide__hold');
        this.holdDial.setAttribute('aria-hidden', 'true');
        this.holdTime = el('span', 'breath-guide__hold-time', '0:00');
        this.holdLabel = el('span', 'breath-guide__hold-label');
        this.holdDial.append(el('span', 'breath-guide__hold-ring'), this.holdTime, this.holdLabel);
        this.cue = el('div', 'breath-guide__cue');
        this.cue.append(this.phaseWord, this.count, this.holdDial, this.hint);

        // A round's title card, drawn large over the world as the round begins.
        this.chapter = el('div', 'breath-guide__chapter');
        this.chapter.setAttribute('aria-hidden', 'true');
        this.chapterEyebrow = el('p', 'breath-guide__chapter-eyebrow');
        this.chapterTitle = el('p', 'breath-guide__chapter-title');
        this.chapterNote = el('p', 'breath-guide__chapter-note');
        this.chapter.append(this.chapterEyebrow, this.chapterTitle, this.chapterNote);
        // A session speaks its stages here; the phase word would chatter in a fast round.
        this.announcer = el('div', 'breath-guide__announcer');
        this.announcer.setAttribute('role', 'status');
        this.announcer.setAttribute('aria-live', 'polite');
        this.announcer.setAttribute('aria-atomic', 'true');

        this.cycle = el('div', 'breath-guide__cycle');
        this.cycle.setAttribute('aria-hidden', 'true');
        this.segments = BREATH_PHASES.map((phase, index) => {
            const segment = el('span', 'breath-guide__segment');
            segment.dataset.phase = phase;
            const fill = el('i');
            const label = el('b', '', SEGMENT_LABELS[index]);
            const seconds = el('em');
            segment.append(fill, label, seconds);
            this.cycle.appendChild(segment);
            return {
                segment, fill, label, seconds,
            };
        });

        // A session's journey: one mark per stage, and what the current stage asks of you.
        this.journey = el('div', 'breath-guide__journey');
        this.journey.hidden = true;
        this.journeyTrack = el('div', 'breath-guide__journey-track');
        this.journeyTrack.setAttribute('role', 'progressbar');
        this.journeyTrack.setAttribute('aria-label', 'Session progress');
        this.journeyTrack.setAttribute('aria-valuemin', '0');
        this.journeyTrack.setAttribute('aria-valuemax', '100');
        this.journeyStatus = el('div', 'breath-guide__journey-status');
        this.journeyStage = el('span', 'breath-guide__journey-stage');
        this.journeyDetail = el('span', 'breath-guide__journey-detail');
        this.journeyRemaining = el('span', 'breath-guide__journey-remaining');
        this.journeyStatus.append(this.journeyStage, this.journeyDetail, this.journeyRemaining);
        this.journey.append(this.journeyStatus, this.journeyTrack);

        const button = (action, label, text) => {
            const node = el('button', `breath-guide__button breath-guide__button--${action}`, text);
            node.type = 'button';
            node.dataset.action = action;
            node.setAttribute('aria-label', label);
            return node;
        };
        // A keycap beside a label that never changes (the buttons carry aria-labels).
        const keycap = (node, key) => {
            const cap = el('kbd', 'sb-kbd', key);
            cap.dataset.key = '';
            cap.setAttribute('aria-hidden', 'true');
            node.append(cap);
            return node;
        };
        this.controls = el('div', 'breath-guide__controls');
        this.previousButton = button('previous', 'Previous world', '‹');
        this.nextButton = button('next', 'Next world', '›');
        this.pauseButton = button('pause', 'Pause session', 'Pause');
        this.endButton = keycap(button('end', 'End breathing', 'End'), 'Esc');
        this.controls.append(this.previousButton, this.nextButton, this.pauseButton, this.endButton);
        // An open hold ends when you breathe in: this, Space, or a tap anywhere on the world.
        this.breatheButton = keycap(button('breathe', 'Breathe in now', 'Breathe in'), 'Space');
        // Ending a long session by accident would be unkind: it asks once, and the session
        // waits while it asks.
        this.confirm = el('div', 'breath-guide__confirm');
        this.confirm.hidden = true;
        this.confirm.setAttribute('role', 'alertdialog');
        this.confirm.setAttribute('aria-label', 'End this session?');
        // Asked from a pad: the face buttons as keycaps (A keeps going, B ends).
        this.confirmHint = el('small', 'breath-guide__confirm-hint');
        this.confirmHint.append(
            el('kbd', 'sb-kbd', 'A'),
            el('span', '', 'Keep going'),
            el('kbd', 'sb-kbd', 'B'),
            el('span', '', 'End session'),
        );
        this.confirmHint.hidden = true;
        this.confirm.append(
            el('p', '', 'End this session?'),
            button('confirm-end', 'End session', 'End session'),
            keycap(button('keep-going', 'Keep going', 'Keep going'), 'Esc'),
            this.confirmHint,
        );
        this.pausedBadge = el('div', 'breath-guide__paused');
        this.pausedBadge.append(el('b', '', 'Paused'), el('small', '', 'Resume when you are ready'));
        this.pausedBadge.hidden = true;

        this.root.append(
            this.stageHost,
            this.fallback,
            scrim,
            header,
            this.chapter,
            this.cue,
            this.cycle,
            this.breatheButton,
            this.journey,
            this.pausedBadge,
            this.controls,
            this.confirm,
            this.announcer,
        );
        this.root.addEventListener('click', (event) => {
            const action = event.target.closest?.('[data-action]')?.dataset.action;
            if (action) this._act(action);
            else if (this._canBreathe()) this._act('breathe');
        });
        // Native buttons must not also reach a mode's global Space/Enter shortcuts.
        this.root.addEventListener('keydown', (event) => {
            if ((event.key === ' ' || event.key === 'Enter') && event.target.closest?.('button')) event.stopPropagation();
        });
        this.container.appendChild(this.root);
        this._renderWorld();
    }

    // ── Presentation helpers ────────────────────────────────────────────────

    _cache(node) {
        let values = this._presentation.get(node);
        if (!values) {
            values = Object.create(null);
            this._presentation.set(node, values);
        }
        return values;
    }

    _text(node, text) {
        const values = this._cache(node);
        if (values.text === text) return;
        node.textContent = text;
        values.text = text;
    }

    _style(node, property, value) {
        const values = this._cache(node);
        const text = String(value);
        if (values[property] === text) return;
        node.style.setProperty(property, text);
        values[property] = text;
    }

    _later(callback, delay) {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            if (!this._destroyed) callback();
        }, delay);
        this.timers.add(timer);
        return timer;
    }

    _clearTimers() {
        this.timers.forEach((timer) => clearTimeout(timer));
        this.timers.clear();
        this._chapterTimer = null;
    }

    _renderWorld() {
        const { world } = this;
        this.root.dataset.world = world.id;
        const accent = (this.isExternallyControlled && SESSION_ACCENTS[this.sessionId]) || world.accent;
        this._style(this.root, '--breath-accent', accent.join(', '));
        if (!this.isExternallyControlled) {
            this._text(this.eyebrow, `${world.intent} · ${formatPattern(world.pattern)}`);
            this._text(this.title, world.name);
            this._text(this.note, world.summary);
        }
        this._renderPattern();
    }

    /** Size the cycle bar's segments by their share of the breath. */
    _renderPattern() {
        this.segments.forEach(({ segment, seconds, label }, index) => {
            const duration = this.pattern[index];
            segment.hidden = !(duration > 0);
            this._style(segment, 'flex-grow', Math.max(duration, 0.0001));
            this._text(seconds, duration > 0 ? `${Number.isInteger(duration) ? duration : duration.toFixed(1)}` : '');
            // An empty hold inside a session's retention is still a hold, not a rest.
            this._text(label, index === 3 && this.sessionPhase === 'retention' ? 'Hold' : SEGMENT_LABELS[index]);
        });
    }

    _syncLayout() {
        const width = window.innerWidth || 1;
        const height = window.innerHeight || 1;
        const portrait = width / height < 0.8;
        let focus = 0.14;
        if (portrait) focus = 0.24;
        else if (height < 520) focus = 0.08;
        this.focus = focus;
        this.stage?.setFocus(focus);
    }

    _resolveQuality() {
        const setting = window.settingsManager?.get?.()?.effectQuality;
        const name = QUALITY_ORDER.find((tier) => tier.toLowerCase() === String(setting || 'High').toLowerCase()) || 'High';
        // Phones keep the cheap tiers whatever the desktop default says.
        const coarse = window.matchMedia?.('(max-width: 768px), (pointer: coarse)').matches;
        return coarse && QUALITY_ORDER.indexOf(name) > QUALITY_ORDER.indexOf('Low') ? 'Low' : name;
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    start() {
        if (this.isActive || this._destroyed) return;
        this.isActive = true;
        this._isPaused = false;
        this._hiddenAt = null;
        this._clearTimers();
        this.root.hidden = false;
        this.root.classList.remove('is-leaving', 'is-paused', 'is-live');
        this.pausedBadge.hidden = true;
        this._closeConfirm();
        this._coarse = Boolean(window.matchMedia?.('(pointer: coarse)').matches);
        // Next frame, so the entrance transition has a starting state to leave.
        this._later(() => this.root.classList.add('is-open'), 20);
        // Once the guide is opaque the theme behind it is invisible: let it stop drawing.
        this._later(() => { if (this.isActive) window.isThemeCovered = true; }, 1100);
        this._syncLayout();
        this._attachStage();
        document.addEventListener('keydown', this._onKey, true);
        window.addEventListener('resize', this._onResize);
        this.phaseStartTime = performance.now();
        this.currentPhase = BREATH_PHASES[nextPhase(this.pattern, 0)];
        this._animate();
        this._announce();
    }

    _attachStage() {
        this.stageToken += 1;
        const token = this.stageToken;
        const live = () => token === this.stageToken && this.isActive && !this._destroyed;
        const begin = (stage) => {
            stage.setFocus(this.focus);
            stage.setSessionPhase(this.sessionPhase);
            stage.setWorld(this.currentTechnique);
            if (!this._isPaused) stage.start().catch((error) => this._stageFailed(error, stage));
        };
        if (this.stage) {
            begin(this.stage);
            return;
        }
        loadStageModule().then(({ BreathStage }) => {
            if (!live() || this.stage) return;
            const stage = new BreathStage(this.stageHost, {
                quality: this._resolveQuality(),
                onState: (state) => this._onStageState(state, stage),
            });
            this.stage = stage;
            begin(stage);
        }).catch((error) => this._stageFailed(error, null));
    }

    _onStageState(state, stage) {
        if (stage !== this.stage) return;
        if (state === 'ready') this.root.classList.add('is-live');
        else this.root.classList.remove('is-live');
        if (state === 'lost') this.stage = null;
    }

    _stageFailed(error, stage) {
        if (stage && stage !== this.stage) return;
        this.root.classList.remove('is-live');
        this.stage = null;
        try { stage?.dispose(); } catch { /* a half-built renderer may already be gone */ }
        console.warn('[BreathingGuide] world renderer unavailable, staying on the CSS guide:', error?.message || error);
    }

    stop() {
        if (!this.isActive) return;
        this.isActive = false;
        this._isPaused = false;
        this._hiddenAt = null;
        this.stageToken += 1;
        this._cancelFrame();
        this._clearTimers();
        window.isThemeCovered = false;
        document.removeEventListener('keydown', this._onKey, true);
        window.removeEventListener('resize', this._onResize);
        this.root.classList.remove('is-open', 'is-paused');
        this.root.classList.add('is-leaving');
        this._closeConfirm();
        this._hideChapter();
        this.stage?.stop();
        this._later(() => {
            this.root.hidden = true;
            this.root.classList.remove('is-leaving', 'is-live');
        }, LEAVE_MS);
        // A parked stage still holds a GPU device: give it back once the player has moved on.
        this._later(() => {
            this.stage?.dispose();
            this.stage = null;
        }, STAGE_IDLE_MS);
        this._announce();
    }

    toggle() {
        if (this.isActive) this.stop();
        else this.start();
    }

    _announce() {
        window.dispatchEvent(new CustomEvent('breathingGuideChange', {
            detail: { active: this.isActive, session: this.isExternallyControlled },
        }));
    }

    pause() {
        if (!this.isActive || this._isPaused) return;
        this._isPaused = true;
        this._pausedAt = this._hiddenAt ?? performance.now();
        this._cancelFrame();
        this.stage?.stop();
        this.root.classList.add('is-paused');
        this.pausedBadge.hidden = false;
        this._text(this.pauseButton, 'Resume');
        this.pauseButton.setAttribute('aria-label', 'Resume session');
    }

    resume() {
        if (!this.isActive || !this._isPaused) return;
        this.phaseStartTime += performance.now() - this._pausedAt;
        this._isPaused = false;
        this._hiddenAt = document.hidden ? performance.now() : null;
        this.root.classList.remove('is-paused');
        this.pausedBadge.hidden = true;
        this._text(this.pauseButton, 'Pause');
        this.pauseButton.setAttribute('aria-label', 'Pause session');
        this.stage?.start().catch((error) => this._stageFailed(error, this.stage));
        if (!document.hidden) this._animate();
    }

    destroy() {
        this._destroyed = true;
        this.stop();
        this._clearTimers();
        document.removeEventListener('visibilitychange', this._onVisibility);
        this.stage?.dispose();
        this.stage = null;
        this.root.remove();
    }

    // ── Controls ────────────────────────────────────────────────────────────

    _act(action) {
        if (action === 'previous') this.cycleTechnique(-1);
        else if (action === 'next') this.cycleTechnique(1);
        else if (action === 'pause') this.onControl?.(this._isPaused ? 'resume' : 'pause');
        else if (action === 'breathe') {
            if (this._canBreathe()) this.onControl?.('breathe');
        } else if (action === 'end') this.requestEnd();
        else if (action === 'confirm-end') {
            this._closeConfirm();
            this.onControl?.('end');
        } else if (action === 'keep-going') {
            this._closeConfirm();
            this.onControl?.('unsuspend');
            this.endButton.focus?.({ preventScroll: true });
        }
    }

    /** An open hold is waiting for you to breathe in (and nothing else is asking first). */
    _canBreathe() {
        return this.isActive && this.isExternallyControlled && this.guidance?.mode === 'open-hold'
            && !this._isPaused && this.confirm.hidden;
    }

    _closeConfirm() {
        this.confirm.hidden = true;
        this.confirmHint.hidden = true;
        this.root.classList.remove('is-confirming');
    }

    /** End a standalone practice at once; ask before ending a session (which waits meanwhile). */
    requestEnd({ fromGamepad = false } = {}) {
        if (!this.isActive) return;
        if (this.isExternallyControlled) {
            if (this.confirm.hidden) {
                this.confirm.hidden = false;
                this.root.classList.add('is-confirming');
                this.onControl?.('suspend');
            }
            this.confirmHint.hidden = !fromGamepad;
            this.confirm.querySelector('[data-action="keep-going"]')?.focus?.({ preventScroll: true });
            return;
        }
        this.stop();
    }

    /** A gamepad's A: breathe in during an open hold, keep going when asked, else pause. */
    primaryAction() {
        if (!this.isActive || !this.isExternallyControlled) return false;
        if (!this.confirm.hidden) this._act('keep-going');
        else this._act(this._canBreathe() ? 'breathe' : 'pause');
        return true;
    }

    /** A gamepad's B: ask to end the session; asked already, end it. */
    backAction() {
        if (!this.isActive || !this.isExternallyControlled) return false;
        if (!this.confirm.hidden) this._act('confirm-end');
        else this.requestEnd({ fromGamepad: true });
        return true;
    }

    _handleKey(event) {
        if (!this.isActive || event.defaultPrevented) return;
        if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        // The Hub and other dialogs sit above the guide and own their own keys.
        if (document.body.classList.contains('serenity-hub-open')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!this.confirm.hidden) this._act('keep-going');
            else this.requestEnd();
        } else if (this.isExternallyControlled && (event.key === ' ' || event.code === 'Space')) {
            if (event.target?.closest?.('button')) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            // In an open hold Space is your in-breath; otherwise it pauses.
            this._act(this._canBreathe() ? 'breathe' : 'pause');
        } else if (this.isExternallyControlled && (event.key === 'p' || event.key === 'P')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            this._act('pause');
        } else if (!this.isExternallyControlled && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.cycleTechnique(event.key === 'ArrowRight' ? 1 : -1);
        }
    }

    // ── Technique ───────────────────────────────────────────────────────────

    /** @param {string} techniqueName a world id */
    setTechnique(techniqueName) {
        if (!this.techniques[techniqueName]) return;
        const changed = techniqueName !== this.currentTechnique;
        this.currentTechnique = techniqueName;
        this.world = getBreathWorld(techniqueName);
        this.technique = this.techniques[techniqueName];
        if (!this.isExternallyControlled) {
            this.pattern = [...this.world.pattern];
            if (this.isActive && changed) {
                this.phaseStartTime = performance.now();
                this.currentPhase = BREATH_PHASES[nextPhase(this.pattern, 0)];
            }
        }
        this._renderWorld();
        if (this.isActive) this.stage?.setWorld(techniqueName);
    }

    cycleTechnique(direction = 1) {
        if (this.isExternallyControlled) return;
        const ids = BREATH_WORLDS.map((world) => world.id);
        const index = ids.indexOf(this.currentTechnique);
        const next = ids[(index + direction + ids.length) % ids.length];
        this.setTechnique(next);
        window.dispatchEvent(new CustomEvent('breathingTechniqueChange', { detail: { id: next } }));
    }

    setShowText(show) {
        this.showText = Boolean(show);
        this.root.classList.toggle('is-wordless', !this.showText);
    }

    // ── Session ownership ───────────────────────────────────────────────────

    setExternalControl(enabled) {
        this.isExternallyControlled = Boolean(enabled);
        this.root.classList.toggle('is-session', this.isExternallyControlled);
        this.journey.hidden = !(this.isExternallyControlled && this._progressVisible);
        // A session announces its stages; a standalone practice speaks each phase.
        this.phaseWord.setAttribute('aria-live', this.isExternallyControlled ? 'off' : 'polite');
        if (!this.isExternallyControlled) {
            this.onControl = null;
            this.sessionId = null;
            this._closeConfirm();
            this.root.removeAttribute('data-session');
            this.pattern = [...this.world.pattern];
            this._text(this.pauseButton, 'Pause');
            this.pauseButton.setAttribute('aria-label', 'Pause session');
            this.setGuidance(null);
            this.setIntention(null);
            this._hideChapter();
        }
        this.endButton.setAttribute('aria-label', this.isExternallyControlled ? 'End session' : 'End breathing');
        this._renderWorld();
    }

    /**
     * How the current stage is guided.
     * @param {{mode: 'paced'|'open-hold'|'timed-hold'|'carry'|'natural'|'closing',
     *   suggested?: number, cap?: number}|null} guidance
     */
    setGuidance(guidance) {
        this.guidance = guidance?.mode ? { ...guidance } : null;
        const mode = this.guidance?.mode || '';
        if ((this.root.dataset.guidance || '') !== mode) this.root.dataset.guidance = mode;
        this._holdReady = false;
        this.root.classList.remove('is-hold-ready');
        if (mode === 'open-hold' || mode === 'timed-hold') {
            const { suggested = 0 } = this.guidance;
            this._style(this.root, '--hold', '0');
            this._text(this.holdTime, mode === 'open-hold' ? '0:00' : formatClock(suggested));
            this._text(this.holdLabel, mode === 'open-hold' ? `Suggested ${formatClock(suggested)}` : 'Rest in the pause');
        }
    }

    /** The intention chosen for this session, shown as you arrive and as you rest. */
    setIntention(label) {
        this.intention = label || null;
        this.intentionLine.hidden = !this.intention;
        this._text(this.intentionLine, this.intention ? `Your intention · ${this.intention}` : '');
    }

    /** A title card over the world: a round beginning, the arrival, the rest. */
    showChapter({ eyebrow = '', title = '', note = '' } = {}) {
        if (!this.isActive) return;
        this._text(this.chapterEyebrow, eyebrow);
        this._text(this.chapterTitle, title);
        this._text(this.chapterNote, note);
        this.chapter.classList.remove('is-showing');
        // Reading layout restarts the card's animation when one card follows another.
        this.chapter.getBoundingClientRect?.();
        this.chapter.classList.add('is-showing');
        // The header steps back while the card speaks, so the two never compete.
        this.root.classList.add('is-chaptering');
        if (this._chapterTimer !== null) {
            clearTimeout(this._chapterTimer);
            this.timers.delete(this._chapterTimer);
        }
        this._chapterTimer = this._later(() => this._hideChapter(), CHAPTER_MS);
    }

    _hideChapter() {
        this._chapterTimer = null;
        this.chapter.classList.remove('is-showing');
        this.root.classList.remove('is-chaptering');
    }

    /** Say something to a screen reader (a stage beginning, a hold ready to end). */
    announce(message) {
        if (!message) return;
        // Cleared first, so the same words can be read twice in a row.
        this.announcer.textContent = '';
        this._later(() => { this.announcer.textContent = message; }, 60);
    }

    overridePattern(newPattern) {
        if (!isValidPattern(newPattern)) return;
        this.pattern = [...newPattern];
        this.phaseStartTime = performance.now();
        this.currentPhase = BREATH_PHASES[nextPhase(this.pattern, 0)];
        this._renderPattern();
    }

    /** Restart the cycle on an inhale (a session re-syncs the picture to its spoken cue). */
    resetCycle() {
        if (!this.isActive) return;
        this.phaseStartTime = performance.now();
        this.currentPhase = BREATH_PHASES[nextPhase(this.pattern, 0)];
    }

    setSessionPhase(type, progress = 0) {
        const changed = this.sessionPhase !== type;
        this.sessionPhase = type;
        this.root.dataset.sessionPhase = type || '';
        this._style(this.root, '--session-phase-progress', Math.max(0, Math.min(1, progress)).toFixed(4));
        if (changed) {
            this.stage?.setSessionPhase(type);
            this._renderPattern();
        }
    }

    /** A session's stage title and what it asks for. */
    setPrompt(text, subText = '') {
        if (!this.isExternallyControlled) return;
        this._text(this.title, text || '');
        this._text(this.note, subText || '');
    }

    /** @param {string|null} sessionId 'BASE', 'ELIXIR', 'REST' or 'FLOW' */
    setSessionTheme(sessionId) {
        this.sessionId = SESSION_ACCENTS[sessionId] ? sessionId : null;
        if (this.sessionId) this.root.dataset.session = this.sessionId;
        else this.root.removeAttribute('data-session');
        this._renderWorld();
    }

    /**
     * Lay out the session's journey: one mark per stage, sized by its length.
     * @param {{type: string, round: number, seconds: number}[]} stages
     */
    setJourney(stages = []) {
        this._journey = stages;
        this.journeyTrack.replaceChildren(...stages.map((stage) => {
            const mark = el('i', 'breath-guide__journey-mark');
            mark.dataset.type = stage.type;
            mark.style.flexGrow = String(Math.max(stage.seconds, 1));
            mark.appendChild(el('b'));
            return mark;
        }));
        this._journeyMarks = [...this.journeyTrack.children];
        this._journeyIndex = null;
    }

    showProgress(show) {
        this._progressVisible = Boolean(show);
        this.journey.hidden = !(this._progressVisible && this.isExternallyControlled);
        if (this._progressVisible) this._renderProgress();
    }

    /**
     * @param {object} data from the session manager
     * @param {string} [data.sessionName] @param {string} [data.phase] @param {number} [data.phaseIndex]
     * @param {number} [data.phaseProgress] @param {number} [data.round] @param {number} [data.totalRounds]
     * @param {number} [data.breathCount] @param {number} [data.totalBreaths]
     * @param {number} [data.remainingTime] @param {number} [data.sessionProgress]
     * @param {number} [data.sessionRemaining]
     */
    updateProgress(data) {
        this._progress = { ...this._progress, ...data };
        if (this._progressVisible) this._renderProgress();
    }

    _renderProgress() {
        const data = this._progress;
        if (!this.isExternallyControlled) return;
        const round = data.round > 0 ? `Round ${data.round} of ${data.totalRounds}` : '';
        this._text(this.eyebrow, [data.sessionName, round].filter(Boolean).join(' · '));
        // A timed pause (Hale Rest) is a pause, not a hold.
        const stage = this.guidance?.mode === 'timed-hold' ? 'Pause' : SESSION_STAGE_LABELS[data.phase];
        this._text(this.journeyStage, stage || '');
        let detail = '';
        if (data.phase === 'active' && data.totalBreaths > 0) {
            detail = `Breath ${Math.min(data.totalBreaths, (data.breathCount || 0) + 1)} of ${data.totalBreaths}`;
        } else if (data.phase === 'retention' && Number.isFinite(data.holdElapsed)) {
            detail = `Held ${formatClock(Math.floor(data.holdElapsed))}`;
        } else if (Number.isFinite(data.remainingTime)) {
            detail = `${formatClock(data.remainingTime)} left`;
        }
        this._renderHold(data);
        this._text(this.journeyDetail, detail);
        this._text(this.journeyRemaining, Number.isFinite(data.sessionRemaining)
            ? `${Math.max(1, Math.ceil(data.sessionRemaining / 60))} min to go` : '');
        const percent = Math.round(Math.max(0, Math.min(1, data.sessionProgress ?? 0)) * 100);
        const values = this._cache(this.journeyTrack);
        if (values.now !== percent) {
            this.journeyTrack.setAttribute('aria-valuenow', String(percent));
            values.now = percent;
        }
        const marks = this._journeyMarks || [];
        const index = (data.phaseIndex || 1) - 1;
        if (this._journeyIndex !== index) {
            marks.forEach((mark, i) => {
                let state = 'upcoming';
                if (i < index) state = 'done';
                else if (i === index) state = 'current';
                mark.dataset.state = state;
                if (i !== index) mark.firstChild.style.transform = '';
            });
            this._journeyIndex = index;
        }
        const fill = marks[index]?.firstChild;
        if (fill) this._style(fill, 'transform', `scaleX(${Math.max(0, Math.min(1, data.phaseProgress ?? 0)).toFixed(4)})`);
    }

    /** The hold dial: an open hold counts up toward its suggestion; a timed pause counts down. */
    _renderHold(data) {
        const mode = this.guidance?.mode;
        if (mode !== 'open-hold' && mode !== 'timed-hold') return;
        const suggested = Math.max(1, this.guidance.suggested || data.phaseDuration || 1);
        if (mode === 'timed-hold') {
            const progress = Math.max(0, Math.min(1, data.phaseProgress ?? 0));
            this._style(this.root, '--hold', progress.toFixed(4));
            this._text(this.holdTime, formatClock(Number.isFinite(data.remainingTime) ? data.remainingTime : suggested));
            return;
        }
        const elapsed = Number.isFinite(data.holdElapsed) ? Math.max(0, data.holdElapsed) : 0;
        const ready = Boolean(data.holdReady) || elapsed >= suggested;
        this._style(this.root, '--hold', Math.min(1, elapsed / suggested).toFixed(4));
        this._text(this.holdTime, formatClock(Math.floor(elapsed)));
        if (ready !== this._holdReady) {
            this._holdReady = ready;
            this.root.classList.toggle('is-hold-ready', ready);
        }
    }

    /** What the cue says now: counted breaths, or the words of a stage that is not counted. */
    _words(index, remaining) {
        const mode = this.guidance?.mode;
        if (mode === 'open-hold') {
            const hint = this._coarse ? 'Tap anywhere to breathe in' : 'Press Space or click to breathe in';
            return { phase: this._holdReady ? 'Breathe in when ready' : 'Hold', count: '', hint };
        }
        const words = mode && GUIDANCE_WORDS[mode];
        if (words) return { ...words, count: '' };
        // A session's long stillness is timed by its journey strip, not a 120-second count.
        const retention = this.sessionPhase === 'retention';
        let hint = '';
        if (index === 0) [hint] = this.world.cues;
        else if (index === 2) [, hint] = this.world.cues;
        else if (index === 1) hint = 'Stay full, stay soft';
        else hint = retention ? 'Rest in the stillness' : 'Stay empty, stay easy';
        return {
            phase: index === 3 && retention ? 'Hold' : PHASE_WORDS[index],
            count: retention ? '' : `${Math.max(1, Math.ceil(remaining))}`,
            hint,
        };
    }

    // ── Clock ───────────────────────────────────────────────────────────────

    _cancelFrame() {
        if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
        this.animationFrame = null;
    }

    _animate() {
        if (!this.isActive || this._isPaused || document.hidden) return;
        const now = performance.now();
        const previousPhase = this.currentPhase;
        const { pattern } = this;
        let index = BREATH_PHASES.indexOf(this.currentPhase);
        if (index < 0 || !(pattern[index] > 0)) index = nextPhase(pattern, Math.max(index, 0));
        let elapsed = Math.max(0, (now - this.phaseStartTime) / 1000);
        const cycle = cycleSeconds(pattern);
        if (elapsed > cycle * 2) {
            // After a long suspension skip the whole cycles that were missed; never replay their cues.
            const missed = Math.floor(elapsed / cycle) - 1;
            this.phaseStartTime += missed * cycle * 1000;
            elapsed -= missed * cycle;
        }
        // Keep the fractional overshoot and resolve every boundary this frame crossed before
        // telling audio, so a resumed tab never speaks an inhale during its current hold.
        let crossings = 0;
        while (elapsed >= pattern[index] && crossings < 16) {
            elapsed -= pattern[index];
            this.phaseStartTime += pattern[index] * 1000;
            index = nextPhase(pattern, index + 1);
            crossings += 1;
        }
        this.currentPhase = BREATH_PHASES[index];
        // A one-phase pattern wraps onto itself; that is still a boundary for whoever is counting.
        if (crossings > 0) this.onPhaseChangeCallback?.(this.currentPhase, previousPhase);
        const duration = pattern[index];
        const progress = Math.min(1, elapsed / duration);
        const breath = breathLevel(index, progress);
        this.stage?.setBreath({ breath, phase: index, progress });
        this._render(index, progress, breath, duration - elapsed);
        this.animationFrame = requestAnimationFrame(this._tick);
    }

    _render(index, progress, breath, remaining) {
        this._style(this.root, '--breath', breath.toFixed(4));
        if (this.root.dataset.phase !== BREATH_PHASES[index]) this.root.dataset.phase = BREATH_PHASES[index];
        const words = this._words(index, remaining);
        this._text(this.phaseWord, words.phase);
        this._text(this.count, words.count);
        this._text(this.hint, words.hint);
        this.segments.forEach(({ segment, fill }, i) => {
            let amount = 0;
            if (i < index) amount = 1;
            else if (i === index) amount = progress;
            this._style(fill, 'transform', `scaleX(${amount.toFixed(4)})`);
            const active = i === index;
            if ((segment.dataset.active === 'true') !== active) segment.dataset.active = String(active);
        });
    }
}

let guideInstance = null;

/** @returns {BreathingGuide} */
export function getBreathingGuide() {
    if (!guideInstance) guideInstance = new BreathingGuide(document.body);
    return guideInstance;
}

/** Called once from main.js; the instance also lives on `window.breathingIndicator`. */
export function initBreathingGuide() {
    return getBreathingGuide();
}
