/**
 * BreathingTab - the library of breathing worlds.
 *
 * One featured world with what it does and how its breath is shaped, a Begin button that
 * actually begins, and the twelve worlds as artwork to choose from. Worlds you have not found
 * yet (breath-collection.js) are shown, not hidden: dimmed, with where they are found, and can be
 * previewed but not begun. Catalogue data comes from breath-catalogue.js; the guide
 * (window.breathingIndicator) owns what is playing.
 */
import { csIcon } from '../components/cosmic-icons.js';
import {
    BREATH_WORLDS, breathPosterUrl, formatPattern, getBreathWorld,
} from '../effects/breathing/breath-catalogue.js';
import { getBreathCollection } from '../effects/breathing/breath-collection-store.js';
import { PRACTICE_MINUTES_PER_STEP } from '../effects/breathing/breath-collection.js';
import { THEME_LOCK_ICON } from './ThemeCollectionView.js';

const RHYTHM_LABELS = ['In', 'Hold', 'Out', 'Rest'];
const SPOKEN_LABELS = ['Inhale', 'Hold', 'Exhale', 'Rest'];

export class BreathingTab {
    constructor(hubInstance, breathingIndicator) {
        this.hub = hubInstance;
        this.breathingIndicator = breathingIndicator;
        this.serenityMode = hubInstance.serenityMode;
        this.collection = this.serenityMode?.deps?.breathCollection || getBreathCollection();
        this.techniques = BREATH_WORLDS;
        /** The world shown in the hero: the one you chose, or one you are only looking at. */
        this.selectedId = null;
        this.container = null;
        this.abortController = new AbortController();
        this.render();
        this.attachEventListeners();
        // A world opening while the tab is open (practice, a synced save) redraws it; marking one
        // seen only touches its card (refresh does that), so focus stays where it is.
        this.unsubscribe = this.collection.subscribe((event) => {
            if (event?.opened?.worlds?.length) this.renderKeepingFocus();
        });
    }

    /** Shown again: open what the evidence now says (a chapter finished, practice), quietly. */
    onShow() {
        this.collection.reconcile({ silent: true });
        this.refresh();
    }

    renderKeepingFocus() {
        const focused = this.container?.contains(document.activeElement) ? document.activeElement : null;
        const card = focused?.closest?.('.breath-world')?.dataset.techniqueId;
        const id = focused?.id;
        this.render();
        const target = card ? this.container.querySelector(`.breath-world[data-technique-id="${card}"]`)
            : (id && this.container.querySelector(`#${id}`));
        target?.focus?.({ preventScroll: true });
    }

    /** "Inhale 5s → Hold 2s → Exhale 7s → Rest 2s", leaving out skipped phases. */
    formatPattern(pattern) {
        return pattern.map((seconds, index) => (seconds > 0 ? `${SPOKEN_LABELS[index]} ${seconds}s` : ''))
            .filter(Boolean).join(' → ');
    }

    renderRhythm(pattern) {
        return pattern.map((seconds, index) => (seconds > 0 ? `
            <span class="breath-rhythm__step" data-phase="${index}" style="flex-grow:${seconds}">
                <b>${RHYTHM_LABELS[index]}</b><em>${seconds}<small>s</small></em>
            </span>` : '')).join('');
    }

    get settings() {
        return this.serenityMode?.deps?.settingsManager?.get?.() || {};
    }

    /** The world the hero shows: what is playing, else what you picked, else your saved choice. */
    heroWorldId() {
        const guide = this.breathingIndicator;
        if (guide?.isActive && !guide.isExternallyControlled) return guide.currentTechnique;
        if (this.selectedId) return this.selectedId;
        return guide?.allowedWorld?.(this.settings.breathingTechnique) || this.settings.breathingTechnique || guide?.currentTechnique;
    }

    renderCard(world) {
        const status = this.collection.status('worlds', world.id);
        const { requirement } = status;
        let label = `${world.name}. ${this.formatPattern(world.pattern)}.`;
        if (!status.open) label = `${world.name}, not found yet. ${requirement?.label || ''}.`;
        else if (status.isNew) label = `${world.name}, new. ${this.formatPattern(world.pattern)}.`;
        return `
            <button type="button" class="breath-world${status.open ? '' : ' is-locked'}${status.isNew ? ' is-new' : ''}"
                data-technique-id="${world.id}" style="--world-accent:${world.accent.join(', ')}"
                aria-pressed="false" aria-label="${label}">
                <span class="breath-world__art" style="background-image:url('${breathPosterUrl(world.id)}')" aria-hidden="true"></span>
                <span class="breath-world__check" aria-hidden="true"></span>
                ${status.open ? '' : `<span class="breath-world__lock" aria-hidden="true">${THEME_LOCK_ICON}</span>`}
                ${status.isNew ? '<span class="breath-world__new" aria-hidden="true">New</span>' : ''}
                <span class="breath-world__name">${world.name}</span>
                <span class="breath-world__meta">${status.open
        ? `${world.intent} · ${formatPattern(world.pattern)}` : requirement?.short || 'Not found yet'}</span>
            </button>`;
    }

    render() {
        const container = document.getElementById('tab-breathing');
        if (!container) return;
        this.container = container;
        const summary = this.collection.summary('worlds');
        const found = summary.open === summary.total ? 'All twelve found' : `${summary.open} of ${summary.total} found`;
        container.innerHTML = `
            <div class="breath-lib">
                <section class="breath-lib__hero" aria-label="Chosen world">
                    <div class="breath-lib__hero-art" aria-hidden="true">
                        <span class="breath-lib__hero-seal">${THEME_LOCK_ICON}<span>Not found yet</span></span>
                    </div>
                    <div class="breath-lib__hero-body">
                        <span class="breath-lib__eyebrow"></span>
                        <h3 class="breath-lib__name" aria-live="polite"></h3>
                        <p class="breath-lib__description"></p>
                        <div class="breath-rhythm"></div>
                        <div class="breath-lib__actions">
                            <button type="button" class="sb-btn sb-btn--primary breath-lib__begin"
                                id="breathing-guide-toggle"></button>
                            <span class="breath-lib__cycle"></span>
                        </div>
                    </div>
                </section>
                <section class="breath-lib__notice" hidden>
                    <p>${csIcon('breath', 16)} A Hale session is running and owns the rhythm.</p>
                    <button type="button" class="sb-btn breath-open-sessions">Open Hale sessions</button>
                </section>
                <section>
                    <h3 class="breath-lib__heading">Twelve worlds <small>${found} · each breathes at its own pace</small></h3>
                    <div class="breath-lib__grid" id="breathing-technique-grid" aria-label="Breathing worlds">${this.techniques.map((world) => this.renderCard(world)).join('')}</div>
                    <p class="breath-lib__found-note">${summary.open === summary.total ? 'Every world is yours.'
        : `Each Odyssey chapter you finish opens a world, and the Hale session that features it. Breathing opens
                        them too: every ${PRACTICE_MINUTES_PER_STEP} minutes of practice opens the next.`}</p>
                </section>
                <section class="breath-lib__hale">
                    <div>
                        <span class="breath-lib__eyebrow">Guided · 4 to 26 minutes</span>
                        <h3>Hale sessions</h3>
                        <p>Journeys with a voice through these worlds. Begin with Hale First Breath: four minutes in three of the worlds above.</p>
                    </div>
                    <button type="button" class="sb-btn breath-open-sessions breath-lib__hale-button">
                        Explore Hale sessions <span aria-hidden="true">→</span></button>
                </section>
                <section class="breath-lib__settings">
                    <label class="breath-lib__switch">
                        <input type="checkbox" class="sb-toggle" id="breathing-voice-toggle"
                            ${this.settings.breathingVoice !== false ? 'checked' : ''}>
                        <span><b>Voice</b><small>Each world introduced as it begins, and its words on a few breaths</small></span>
                    </label>
                    <label class="breath-lib__switch">
                        <input type="checkbox" class="sb-toggle" id="breathing-text-toggle"
                            ${this.settings.breathingText !== false ? 'checked' : ''}>
                        <span><b>Words and counts</b><small>Show “Breathe in”, the seconds, and the cue line</small></span>
                    </label>
                    <label class="breath-lib__switch">
                        <input type="checkbox" class="sb-toggle" id="breathing-auto-start"
                            ${this.settings.breathingGuideAutoStart ? 'checked' : ''}>
                        <span><b>Begin with Serenity Mode</b><small>Start breathing as soon as Serenity Mode opens</small></span>
                    </label>
                    <div class="breath-lib__keys">
                        <p class="sb-eyebrow sb-eyebrow--quiet">During a practice</p>
                        <ul class="sb-hints">
                            <li><kbd class="sb-kbd">←</kbd><kbd class="sb-kbd">→</kbd>Change world</li>
                            <li><kbd class="sb-kbd">Esc</kbd>End it</li>
                        </ul>
                    </div>
                </section>
            </div>`;
        this.refresh();
    }

    attachEventListeners() {
        if (!this.container) return;
        const { signal } = this.abortController;
        // Native activation must not also toggle a mode's global guide shortcut.
        this.container.addEventListener('keydown', (event) => {
            if ((event.key === ' ' || event.key === 'Enter') && event.target.closest('button, input')) event.stopPropagation();
        }, { signal });
        this.container.addEventListener('click', (event) => {
            const card = event.target.closest('.breath-world');
            if (card) this.selectTechnique(card.dataset.techniqueId);
            else if (event.target.closest('.breath-open-sessions')) this.hub.switchTab('sessions');
            else if (event.target.closest('.breath-lib__begin')) this.toggleBreathingGuide(!this.breathingIndicator.isActive);
        }, { signal });
        this.container.addEventListener('change', (event) => {
            if (event.target.id === 'breathing-text-toggle') this.updateSetting('breathingText', event.target.checked);
            else if (event.target.id === 'breathing-auto-start') this.updateSetting('breathingGuideAutoStart', event.target.checked);
            else if (event.target.id === 'breathing-voice-toggle') this.updateSetting('breathingVoice', event.target.checked);
        }, { signal });
        // The guide can change on its own (arrow keys, a gamepad, its End button): the hero follows.
        window.addEventListener('breathingTechniqueChange', (event) => {
            this.selectedId = event.detail?.id || null;
            this.refresh();
        }, { signal });
        window.addEventListener('breathingGuideChange', () => this.refresh(), { signal });
    }

    /** Start or stop a standalone practice. Starting closes the Hub: the world needs the screen. */
    toggleBreathingGuide(enabled) {
        const guide = this.breathingIndicator;
        if (guide.isExternallyControlled) return;
        const worldId = this.heroWorldId();
        // A world not found yet can be looked at, not begun.
        if (enabled && !this.collection.isWorldOpen(worldId)) return;
        if (enabled) {
            this.collection.markSeen('worlds', worldId);
            guide.setTechnique(worldId);
            this.serenityMode?.deps?.settingsManager?.update({ breathingTechnique: worldId });
        }
        const mode = this.serenityMode;
        const handler = enabled ? mode?._showBreathingIndicator : mode?._hideBreathingIndicator;
        if (typeof handler === 'function') {
            handler.call(mode);
        } else if (enabled) {
            guide.setTechnique(worldId);
            guide.setShowText(this.settings.breathingText !== false);
            guide.start();
        } else {
            guide.stop();
        }
        const active = Boolean(guide.isActive);
        if (mode) mode.breathingIndicatorActive = active;
        mode?.deps?.settingsManager?.update({ breathingGuideEnabled: active });
        this.refresh();
        if (active) this.hub.hide();
        else this.hub.releaseGameplay?.();
    }

    /** Show a world in the hero. A found world also becomes your choice; a hidden one is a preview. */
    selectTechnique(techniqueId) {
        if (this.breathingIndicator.isExternallyControlled) return;
        if (!this.techniques.some((world) => world.id === techniqueId)) return;
        this.selectedId = techniqueId;
        if (this.collection.isWorldOpen(techniqueId)) {
            this.collection.markSeen('worlds', techniqueId);
            this.breathingIndicator.setTechnique(techniqueId);
            this.serenityMode?.deps?.settingsManager?.update({ breathingTechnique: techniqueId });
        }
        this.refresh();
    }

    updateSetting(key, value) {
        this.serenityMode?.deps?.settingsManager?.update({ [key]: value });
        if (key === 'breathingText') this.breathingIndicator.setShowText(value);
    }

    /** Bring every control in line with the guide's real state. */
    refresh() {
        if (!this.container || !this.breathingIndicator) return;
        const guide = this.breathingIndicator;
        const world = getBreathWorld(this.heroWorldId());
        const status = this.collection.status('worlds', world.id);
        const controlled = Boolean(guide.isExternallyControlled);
        const hero = this.container.querySelector('.breath-lib__hero');
        hero.style.setProperty('--world-accent', world.accent.join(', '));
        hero.dataset.world = world.id;
        hero.classList.toggle('is-locked', !status.open);
        hero.querySelector('.breath-lib__hero-art').style.backgroundImage = `url('${breathPosterUrl(world.id)}')`;
        hero.querySelector('.breath-lib__eyebrow').textContent = status.open
            ? `${world.intent} · ${world.summary}` : `${world.intent} · ${status.requirement?.short || 'Not found yet'}`;
        const name = hero.querySelector('.breath-lib__name');
        if (name.textContent !== world.name) name.textContent = world.name;
        hero.querySelector('.breath-lib__description').textContent = world.description;
        const rhythm = hero.querySelector('.breath-rhythm');
        if (rhythm.dataset.world !== world.id) {
            rhythm.dataset.world = world.id;
            rhythm.setAttribute('aria-label', this.formatPattern(world.pattern));
            rhythm.innerHTML = this.renderRhythm(world.pattern);
        }
        const cycle = world.pattern.reduce((total, seconds) => total + seconds, 0);
        hero.querySelector('.breath-lib__cycle').textContent = status.open
            ? `${cycle} s per breath · about ${Number((60 / cycle).toFixed(1))} a minute` : `${status.requirement?.label || ''}.`;
        const begin = hero.querySelector('.breath-lib__begin');
        const active = Boolean(guide.isActive) && !controlled;
        let beginLabel = active ? 'Stop breathing' : `Begin ${world.name}`;
        if (!status.open) beginLabel = status.requirement?.place ? `Found in ${status.requirement.place}` : 'Found at the end of the Odyssey';
        begin.textContent = beginLabel;
        begin.classList.toggle('is-active', active);
        begin.setAttribute('aria-pressed', String(active));
        begin.disabled = controlled || (!status.open && !active);
        this.container.querySelector('.breath-lib__notice').hidden = !controlled;
        this.container.querySelectorAll('.breath-world').forEach((card) => {
            const pressed = card.dataset.techniqueId === world.id;
            card.classList.toggle('active', pressed);
            card.setAttribute('aria-pressed', String(pressed));
            card.disabled = controlled;
            if (pressed && card.classList.contains('is-new') && !this.collection.status('worlds', world.id).isNew) {
                card.classList.remove('is-new');
                card.querySelector('.breath-world__new')?.remove();
            }
        });
    }

    destroy() {
        this.abortController.abort();
        this.unsubscribe?.();
        this.hub = null;
        this.breathingIndicator = null;
        this.serenityMode = null;
        this.container = null;
    }
}
