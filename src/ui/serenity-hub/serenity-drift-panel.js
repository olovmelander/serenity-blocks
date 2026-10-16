/**
 * The Themes tab's "Serenity Mode" panel: Drift (how the mode moves between themes by itself)
 * and Rest (how long it stays before the music fades and the screen dims). The same choices
 * as the world bar's chips, where a controller can reach them. Shown only while Serenity Mode
 * runs (its SerenityModeUi answers); elsewhere the Hub has no drift to set.
 *
 * Styles: public/styles/keystone-hub.css (`.themes-lib__drift`).
 */
import {
    DRIFT_OPTIONS, REST_OPTIONS, restChipLabel, restOptionLabel,
} from '../serenity-mode/serenity-options.js';

export function renderDriftPanel() {
    const drift = DRIFT_OPTIONS.map((option) => `<button type="button" class="sb-chip themes-lib__drift-choice"
                data-drift="${option.id}" aria-pressed="false">${option.label}</button>`).join('');
    const rest = REST_OPTIONS.map((minutes) => `<button type="button" class="sb-chip themes-lib__drift-choice"
                data-rest="${minutes}" aria-pressed="false">${restOptionLabel(minutes)}</button>`).join('');
    return `<section class="themes-lib__drift" id="serenity-drift-panel"
            aria-labelledby="serenity-drift-title" hidden>
            <p class="sb-eyebrow themes-lib__drift-eyebrow" id="serenity-drift-title">
                Serenity Mode · watch on its own</p>
            <div class="themes-lib__drift-row" role="group" aria-labelledby="serenity-drift-label">
                <p class="themes-lib__drift-label" id="serenity-drift-label"><b>Drift</b>
                    <small>Move between your themes by itself. With the music, each song brings its world.</small></p>
                <div class="themes-lib__drift-options">${drift}</div>
            </div>
            <div class="themes-lib__drift-row" role="group" aria-labelledby="serenity-rest-label">
                <p class="themes-lib__drift-label" id="serenity-rest-label"><b>Rest</b>
                    <small class="themes-lib__rest-note">
                        Stay a while, then the music fades and the screen dims.</small></p>
                <div class="themes-lib__drift-options">${rest}</div>
            </div>
        </section>`;
}

/**
 * Bring the panel in line with the mode. Hidden when Serenity Mode is not running.
 * @param {ParentNode|null} container the Themes tab
 * @param {any} mode the Hub's mode (SerenityMode while it runs)
 */
export function syncDriftPanel(container, mode) {
    const panel = container?.querySelector?.('#serenity-drift-panel');
    if (!panel) return;
    const ui = mode?.ui;
    const live = Boolean(ui?.getDriftState);
    panel.hidden = !live;
    if (!live) return;
    const { pace } = ui.getDriftState();
    const { minutes, msLeft } = ui.getRestState();
    panel.querySelectorAll('[data-drift]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.drift === pace));
    });
    panel.querySelectorAll('[data-rest]').forEach((button) => {
        button.setAttribute('aria-pressed', String(Number(button.dataset.rest) === minutes));
    });
    const note = panel.querySelector('.themes-lib__rest-note');
    if (note) {
        note.textContent = msLeft > 0
            ? `${restChipLabel(msLeft).replace('Rest · ', '')}, then the music fades and the screen dims.`
            : 'Stay a while, then the music fades and the screen dims.';
    }
}

/**
 * A press inside the panel.
 * @returns {boolean} whether it was one of the panel's choices
 */
export function handleDriftPanelClick(target, mode) {
    const choice = target?.closest?.('#serenity-drift-panel [data-drift], #serenity-drift-panel [data-rest]');
    const ui = mode?.ui;
    if (!choice || !ui) return false;
    if (choice.dataset.drift !== undefined) ui.setDrift(choice.dataset.drift);
    else ui.setRest(Number(choice.dataset.rest));
    return true;
}
