/**
 * @fileoverview Odyssey board-view HUD overlay: the header bar, the chapter-arrival card and the
 * orb panel docked beside the live map.
 *
 * - The header is the navigator's header made compact (docs/ODYSSEY_NAVIGATOR_2026-10.md): the
 *   wordmark, the journey in figures (stars, orbs cleared, the chapter you are in) over a slim
 *   cell meter of every orb, and the charm chip, a button that opens the charm guide
 *   (odyssey-charm-guide.js, wired by odyssey-map-input.js). renderOdysseyMapHeader draws the
 *   figures; until it has, the two text lines the mode writes (#odyssey-header-stars and
 *   #odyssey-header-progress) stand in for them.
 * - The orb panel is the navigator's orb card, docked: its ids are filled by
 *   ui/odyssey/odyssey-level-panel.js (renderOdysseyLevelPanel). Its story scrolls on its own
 *   between the header and the bottom edge; Play stays in view at its foot. Play's Enter / A
 *   keycap is drawn by CSS, since the mode rewrites the button's text while an orb launches.
 *
 * Extracted from OdysseyMode._createBoardInfoOverlay (masterplan E1). Pure DOM: it builds and
 * returns the overlay + an (empty) <style> element. OdysseyMode keeps the wiring (mounting,
 * header refresh, and the play-button → launchOdysseyLevel handler) since those need mode state.
 * The look lives in public/styles/odyssey-map.css.
 */
import { buildOdysseyNavigatorModel } from './odyssey-navigator-model.js';

/** A keycap, and the controller button that does the same (body.sb-input-gamepad swaps them). */
function keys(label, pad) {
    return `<kbd class="sb-kbd" data-key>${label}</kbd><kbd class="sb-kbd" data-pad>${pad}</kbd>`;
}

/** "Orbs cleared", where narrow windows keep only "Orbs". */
const ORBS_CLEARED = 'Orbs<span class="odyssey-map-figure__more"> cleared</span>';

/** A header figure: the count, out of the whole, and what it counts. */
function figure(name, countId, wholeId, label) {
    return `<span class="odyssey-map-figure" data-figure="${name}"><b><span id="${countId}">0</span>`
        + `<small> / <span id="${wholeId}">0</span></small></b> ${label}</span>`;
}

/**
 * Build the board-view HUD overlay.
 * @param {object} [options]
 * @param {boolean} [options.autoContinue=true] Continue between orbs in the same chapter.
 * @param {function(boolean):void} [options.onAutoContinueChange] Persist the player's choice.
 * @returns {{overlay: HTMLElement, style: HTMLStyleElement}} the overlay + its style element
 *   (caller appends both, wires the #level-panel-play-btn, and refreshes the header)
 */
export function createBoardInfoOverlay({ autoContinue = true, onAutoContinueChange } = {}) {
    const overlay = document.createElement('div');
    overlay.id = 'odyssey-board-overlay';
    overlay.innerHTML = `
        <div class="odyssey-header-bar" id="odyssey-map-header" data-journey="pending">
            <h1><img class="odyssey-header-wordmark" src="./assets/branding/modes/odyssey.svg" alt="Odyssey"
                width="628" height="104"></h1>
            <div class="odyssey-progress-info">
                <div class="odyssey-map-journey" id="odyssey-map-journey">
                    <div class="odyssey-map-figures">
                        ${figure('stars', 'odyssey-map-stars', 'odyssey-map-max-stars', 'Stars')}
                        ${figure('orbs', 'odyssey-map-cleared', 'odyssey-map-total-orbs', ORBS_CLEARED)}
                        ${figure('chapter', 'odyssey-map-chapter', 'odyssey-map-total-chapters', 'Chapter')}
                    </div>
                    <span class="odyssey-map-meter" id="odyssey-map-meter" aria-hidden="true"></span>
                </div>
                <span id="odyssey-header-stars" class="odyssey-header-line">★ 0</span>
                <span id="odyssey-header-progress" class="odyssey-header-line">Progress: 0%</span>
                <button type="button" id="odyssey-header-charms" aria-haspopup="dialog"
                    title="Clearing an orb leaves you a charm. Press 1–4 during an orb to use one."
                    >◇ No charms yet</button>
            </div>
        </div>
        <div id="odyssey-chapter-arrival-card" class="odyssey-chapter-arrival-card" aria-live="polite">
            <div id="odyssey-arrival-kicker" class="odyssey-arrival-kicker">Chapter 1</div>
            <div id="odyssey-arrival-title" class="odyssey-arrival-title">Earth Core</div>
            <div id="odyssey-arrival-subtitle" class="odyssey-arrival-subtitle">Find your first rhythm</div>
        </div>
        <div id="odyssey-level-panel" class="odyssey-level-panel hidden" role="region"
            aria-labelledby="level-panel-name">
            <div class="level-panel__body">
                <div class="level-panel__head">
                    <div id="level-panel-art" class="level-panel__art" aria-hidden="true"></div>
                    <div class="level-panel__titles">
                        <p class="level-panel__eyebrow">
                            <span id="level-panel-number" class="level-number-badge">Orb 1</span>
                            <span id="level-panel-kind" class="level-kind" hidden></span>
                        </p>
                        <h2 id="level-panel-name">Orb</h2>
                        <p id="level-panel-chapter" class="level-chapter">Chapter 1</p>
                        <div id="level-panel-stars" class="level-stars" role="img"
                            aria-label="0 of 3 stars earned">☆☆☆</div>
                    </div>
                </div>
                <p id="level-panel-description" class="level-description"></p>
                <p id="level-panel-lock" class="level-lock-hint" hidden></p>
                <p id="level-panel-charm-hint" class="level-charm-hint" hidden></p>
                <div id="level-panel-objectives" class="level-objectives">
                    <p class="level-goal"><strong>Goal</strong> <span id="level-panel-goal"></span></p>
                    <p id="level-panel-star-goals-label" class="level-objectives__label">Stars</p>
                    <ul id="level-panel-star-goals" class="level-star-goals"></ul>
                    <p id="level-panel-rules-label" class="level-objectives__label" hidden>Rules</p>
                    <ul id="level-panel-rules" class="level-rules" hidden></ul>
                    <p id="level-panel-tip" class="level-tip" hidden></p>
                </div>
            </div>
            <div class="level-panel__actions">
                <button id="level-panel-play-btn" class="level-play-btn">Play</button>
                <ul class="sb-hints level-nav-hint" aria-hidden="true">
                    <li>${keys('←', '◀')}${keys('→', '▶')}Orb</li>
                    <li>${keys('↑', '▲')}${keys('↓', '▼')}Chapter</li>
                </ul>
                <label class="odyssey-flow-preference" for="odyssey-auto-continue"
                    title="Chapter arrivals always wait for you.">
                    <input id="odyssey-auto-continue" class="sb-toggle" type="checkbox"
                        aria-describedby="odyssey-flow-preference-hint">
                    <span class="odyssey-flow-preference__copy">
                        <span>Flow to the next orb automatically</span>
                        <small id="odyssey-flow-preference-hint">Chapter arrivals always wait for you.</small>
                    </span>
                </label>
            </div>
        </div>
    `;

    const autoContinueInput = overlay.querySelector('#odyssey-auto-continue');
    if (autoContinueInput) {
        autoContinueInput.checked = autoContinue !== false;
        autoContinueInput.addEventListener('change', () => {
            onAutoContinueChange?.(autoContinueInput.checked);
        });
    }

    // The look lives in public/styles/odyssey-map.css (#odyssey-board-overlay). The element is
    // still returned because the caller mounts and later removes it by id.
    const style = document.createElement('style');
    style.id = 'odyssey-board-overlay-styles';
    return { overlay, style };
}

/**
 * The header's journey as plain data, from the navigator's model: the figures, and every orb
 * as a cell, chapter by chapter.
 * @param {{ progress: object, nextLevelId: number, chapters: object[], orbs: Map<number, object> }} model
 * @returns {{ stars: number, maxStars: number, cleared: number, totalOrbs: number, chapter: number,
 *   totalChapters: number, chapters: { id: number, state: string, name: string, cells: string[] }[] }}
 */
export function describeOdysseyMapJourney(model) {
    const chapters = model?.chapters || [];
    const progress = model?.progress || {};
    const next = model?.orbs?.get?.(model.nextLevelId);
    const current = chapters.find((chapter) => chapter.state === 'current');
    // The chapter you are in: the one that holds the next orb; the summit once all are clear.
    const chapter = next?.chapterId ?? current?.id ?? chapters[chapters.length - 1]?.id ?? 1;
    return {
        stars: Number(progress.totalStars) || 0,
        maxStars: Number(progress.maxStars) || 0,
        cleared: Number(progress.clearedOrbs) || 0,
        totalOrbs: Number(progress.totalOrbs) || 0,
        chapter,
        totalChapters: chapters.length,
        chapters: chapters.map((entry) => ({
            id: entry.id,
            state: entry.state,
            name: entry.shortName || entry.name || `Chapter ${entry.id}`,
            cells: (entry.orbs || []).map((orb) => orb.state),
        })),
    };
}

function setText(doc, id, value) {
    const node = doc.getElementById(id);
    if (node) node.textContent = String(value);
}

/**
 * Draw the header's journey: the figures and the cell meter. Takes the navigator's model or
 * anything buildOdysseyNavigatorModel reads ({ odysseyState, levelRegistry }, e.g. the mode).
 * Quietly does nothing when the journey cannot be read, so the mode's text lines stay.
 * @param {object} source the model, or the mode
 * @param {Document} [doc]
 * @returns {ReturnType<typeof describeOdysseyMapJourney>|null}
 */
export function renderOdysseyMapHeader(source, doc = globalThis.document) {
    if (!source || !doc?.getElementById) return null;
    let journey;
    try {
        const model = source.chapters && source.progress ? source : buildOdysseyNavigatorModel(source);
        journey = describeOdysseyMapJourney(model);
    } catch (error) {
        console.warn('[Odyssey] Map header could not read the journey:', error);
        return null;
    }
    setText(doc, 'odyssey-map-stars', journey.stars);
    setText(doc, 'odyssey-map-max-stars', journey.maxStars);
    setText(doc, 'odyssey-map-cleared', journey.cleared);
    setText(doc, 'odyssey-map-total-orbs', journey.totalOrbs);
    setText(doc, 'odyssey-map-chapter', journey.chapter);
    setText(doc, 'odyssey-map-total-chapters', journey.totalChapters);

    const meter = doc.getElementById('odyssey-map-meter');
    if (meter && typeof meter.replaceChildren === 'function' && doc.createElement) {
        meter.replaceChildren(...journey.chapters.map((chapter) => {
            const group = doc.createElement('span');
            group.className = 'odyssey-map-meter__chapter';
            group.dataset.odyChapter = String(chapter.id);
            group.dataset.state = chapter.state;
            group.style.flexGrow = String(Math.max(1, chapter.cells.length));
            group.title = `Chapter ${chapter.id} · ${chapter.name}`;
            chapter.cells.forEach((state) => {
                const cell = doc.createElement('i');
                cell.dataset.state = state;
                group.appendChild(cell);
            });
            return group;
        }));
    }
    const header = doc.getElementById('odyssey-map-header');
    if (header?.dataset) {
        header.dataset.journey = 'ready';
        header.dataset.odyChapter = String(journey.chapter);
    }
    return journey;
}

let pendingHeader = null;

/**
 * The header at most once a frame, from the latest source: progress and the selection both
 * ask for it, often in the same frame (the board's set-up asks twice), and each render walks
 * every orb of the journey.
 * @param {object} source the model, or the mode
 * @param {Document} [doc]
 */
export function scheduleOdysseyMapHeader(source, doc = globalThis.document) {
    const queued = pendingHeader !== null;
    pendingHeader = { source, doc };
    if (queued) return;
    const run = () => {
        const job = pendingHeader;
        pendingHeader = null;
        if (job) renderOdysseyMapHeader(job.source, job.doc);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
}

export default createBoardInfoOverlay;
