/**
 * BreathingTab - the library of breathing worlds.
 *
 * One featured world with what it does and how its breath is shaped, a Begin button that
 * actually begins, and the twelve worlds as artwork to choose from. Catalogue data comes from
 * breath-catalogue.js; the guide (window.breathingIndicator) owns what is playing.
 */
import { csIcon } from '../components/cosmic-icons.js';
import {
    BREATH_WORLDS, breathPosterUrl, formatPattern, getBreathWorld,
} from '../effects/breathing/breath-catalogue.js';

const RHYTHM_LABELS = ['In', 'Hold', 'Out', 'Rest'];
const SPOKEN_LABELS = ['Inhale', 'Hold', 'Exhale', 'Rest'];

export class BreathingTab {
    constructor(hubInstance, breathingIndicator) {
        this.hub = hubInstance;
        this.breathingIndicator = breathingIndicator;
        this.serenityMode = hubInstance.serenityMode;
        this.techniques = BREATH_WORLDS;
        this.container = null;
        this.abortController = new AbortController();
        this.render();
        this.attachEventListeners();
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

    render() {
        const container = document.getElementById('tab-breathing');
        if (!container) return;
        this.container = container;
        const selected = this.breathingIndicator.currentTechnique;
        const cards = this.techniques.map((world) => `
            <button type="button" class="breath-world" data-technique-id="${world.id}"
                style="--world-accent:${world.accent.join(', ')}"
                aria-pressed="${world.id === selected}"
                aria-label="${world.name}. ${this.formatPattern(world.pattern)}.">
                <span class="breath-world__art" style="background-image:url('${breathPosterUrl(world.id)}')" aria-hidden="true"></span>
                <span class="breath-world__check" aria-hidden="true">${csIcon('check', 12)}</span>
                <span class="breath-world__name">${world.name}</span>
                <span class="breath-world__meta">${world.intent} · ${formatPattern(world.pattern)}</span>
            </button>`).join('');
        container.innerHTML = `
            <div class="breath-lib">
                <section class="breath-lib__hero" aria-live="polite">
                    <div class="breath-lib__hero-art" aria-hidden="true"></div>
                    <div class="breath-lib__hero-body">
                        <span class="breath-lib__eyebrow"></span>
                        <h3 class="breath-lib__name"></h3>
                        <p class="breath-lib__description"></p>
                        <div class="breath-rhythm"></div>
                        <div class="breath-lib__actions">
                            <button type="button" class="breath-lib__begin" id="breathing-guide-toggle"></button>
                            <span class="breath-lib__cycle"></span>
                        </div>
                    </div>
                </section>
                <section class="breath-lib__notice" hidden>
                    <p>${csIcon('breath', 16)} A Hale session is running and owns the rhythm.</p>
                    <button type="button" class="breath-open-sessions">Open Hale sessions</button>
                </section>
                <section>
                    <h3 class="breath-lib__heading">Twelve worlds <small>Each one breathes at its own pace</small></h3>
                    <div class="breath-lib__grid" id="breathing-technique-grid" aria-label="Breathing worlds">${cards}</div>
                </section>
                <section class="breath-lib__hale">
                    <div>
                        <span class="breath-lib__eyebrow">Guided · 19 to 26 minutes</span>
                        <h3>Hale sessions</h3>
                        <p>Full journeys with a voice: arrive, three rounds of breathing and stillness, then rest.</p>
                    </div>
                    <button type="button" class="breath-open-sessions breath-lib__hale-button">Explore Hale sessions <span aria-hidden="true">→</span></button>
                </section>
                <section class="breath-lib__settings">
                    <label class="breath-lib__switch">
                        <input type="checkbox" id="breathing-text-toggle" ${this.settings.breathingText !== false ? 'checked' : ''}>
                        <span><b>Words and counts</b><small>Show “Breathe in”, the seconds, and the cue line</small></span>
                    </label>
                    <label class="breath-lib__switch">
                        <input type="checkbox" id="breathing-auto-start" ${this.settings.breathingGuideAutoStart ? 'checked' : ''}>
                        <span><b>Begin with Serenity Mode</b><small>Start breathing as soon as Serenity Mode opens</small></span>
                    </label>
                    <p class="breath-lib__keys">In a practice: <kbd>←</kbd> <kbd>→</kbd> change world · <kbd>Esc</kbd> ends it</p>
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
        }, { signal });
        // The guide can change on its own (arrow keys, a gamepad, its End button).
        window.addEventListener('breathingTechniqueChange', () => this.refresh(), { signal });
        window.addEventListener('breathingGuideChange', () => this.refresh(), { signal });
    }

    /** Start or stop a standalone practice. Starting closes the Hub: the world needs the screen. */
    toggleBreathingGuide(enabled) {
        const guide = this.breathingIndicator;
        if (guide.isExternallyControlled) return;
        const mode = this.serenityMode;
        const handler = enabled ? mode?._showBreathingIndicator : mode?._hideBreathingIndicator;
        if (typeof handler === 'function') {
            handler.call(mode);
        } else if (enabled) {
            guide.setTechnique(this.settings.breathingTechnique || guide.currentTechnique);
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

    selectTechnique(techniqueId) {
        if (this.breathingIndicator.isExternallyControlled) return;
        if (!this.techniques.some((world) => world.id === techniqueId)) return;
        this.breathingIndicator.setTechnique(techniqueId);
        this.serenityMode?.deps?.settingsManager?.update({ breathingTechnique: techniqueId });
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
        const world = getBreathWorld(guide.currentTechnique);
        const controlled = Boolean(guide.isExternallyControlled);
        const hero = this.container.querySelector('.breath-lib__hero');
        hero.style.setProperty('--world-accent', world.accent.join(', '));
        hero.dataset.world = world.id;
        hero.querySelector('.breath-lib__hero-art').style.backgroundImage = `url('${breathPosterUrl(world.id)}')`;
        hero.querySelector('.breath-lib__eyebrow').textContent = `${world.intent} · ${world.summary}`;
        hero.querySelector('.breath-lib__name').textContent = world.name;
        hero.querySelector('.breath-lib__description').textContent = world.description;
        const rhythm = hero.querySelector('.breath-rhythm');
        if (rhythm.dataset.world !== world.id) {
            rhythm.dataset.world = world.id;
            rhythm.setAttribute('aria-label', this.formatPattern(world.pattern));
            rhythm.innerHTML = this.renderRhythm(world.pattern);
        }
        const cycle = world.pattern.reduce((total, seconds) => total + seconds, 0);
        hero.querySelector('.breath-lib__cycle').textContent = `${cycle} s per breath · about ${Number((60 / cycle).toFixed(1))} a minute`;
        const begin = hero.querySelector('.breath-lib__begin');
        const active = Boolean(guide.isActive) && !controlled;
        begin.textContent = active ? 'Stop breathing' : `Begin ${world.name}`;
        begin.classList.toggle('is-active', active);
        begin.setAttribute('aria-pressed', String(active));
        begin.disabled = controlled;
        this.container.querySelector('.breath-lib__notice').hidden = !controlled;
        this.container.querySelectorAll('.breath-world').forEach((card) => {
            const pressed = card.dataset.techniqueId === world.id;
            card.classList.toggle('active', pressed);
            card.setAttribute('aria-pressed', String(pressed));
            card.disabled = controlled;
        });
    }

    destroy() {
        this.abortController.abort();
        this.hub = null;
        this.breathingIndicator = null;
        this.serenityMode = null;
        this.container = null;
    }
}
