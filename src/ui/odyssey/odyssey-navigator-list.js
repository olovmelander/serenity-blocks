/**
 * The navigator: the journey header, the chapter rail and the stage that holds the selected
 * orb's card and its chapter's route. Draws the model of odyssey-navigator-model.js into the
 * shell of LevelSelectOverlay.js and runs the selection:
 *
 * - A look at an orb (a click, a key, a controller step) shows it on the card. Pressing the
 *   orb the card already shows, or Play, sets out; Show on the map closes the navigator and
 *   travels the board there.
 * - Left and right walk the orbs across chapters, up and down (and Page Up/Down, LB/RB through
 *   the step buttons) climb the chapters: the rail reads from the bottom up, as the map does.
 * - Setting out fades the navigator away while the board travels to the orb, so the press is
 *   answered at once; a launch that does not start brings it back.
 *
 * The mode supplies state, registry and the actions; the look lives in
 * public/styles/odyssey-navigator.css (#odyssey-level-select).
 */
import { el } from './keystone-sheet.js';
import { formatOdysseyMapObjective, formatOdysseyStarCondition } from './objective-copy.js';
import { getThemeMusic } from '../../core/progression/theme-music-catalog.js';
import { getThemeMeta } from '../../themes/theme-registry.js';
import { resolveHubThemeThumbnailUrl } from '../serenity-hub/theme-thumbnail-manifest.js';
import {
    buildOdysseyNavigatorModel,
    preferredOdysseyChapterOrb,
    resolveOdysseyNavigatorKey,
    resolveOdysseyNavigatorSelection,
    resolveOdysseyOrbPress,
    stepOdysseyNavigatorOrb,
} from './odyssey-navigator-model.js';

const ROOT_ID = 'odyssey-level-select';
const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.7 5.6 6.1.8-4.4 4.3 1.1 6.1L12 16.5'
    + 'l-5.5 2.9 1.1-6.1-4.4-4.3 6.1-.8L12 2.6Z"/></svg>';
const CROWN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 18 3.2 8.2l4.6 3.6L12 5l4.2 6.8 4.6-3.6'
    + 'L19.5 18Z"/></svg>';
const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/>'
    + '<path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';
/** A focus this soon after a press came from the pointer: the click decides, not the focus. */
const POINTER_FOCUS_MS = 600;
/** The narrowest route stop (odyssey-navigator.css .odyssey-route, --route-stop-min). */
const ROUTE_STOP_MIN_PX = 104;
const SPOKEN_STATE = Object.freeze({
    cleared: 'cleared', next: 'next on your journey', open: 'open', locked: 'locked',
});
const SPOKEN_CHAPTER = Object.freeze({
    complete: 'complete', current: 'you are here', open: 'open', locked: 'locked',
});

const views = new WeakMap();
const now = () => globalThis.performance?.now?.() ?? Date.now();
const byId = (id) => document.getElementById(id);

function setText(id, text) {
    const node = byId(id);
    if (node) node.textContent = String(text ?? '');
    return node;
}

function iconUrl(themeId) {
    return themeId ? resolveHubThemeThumbnailUrl(themeId, undefined, null) : null;
}

function starRow(earned, className = '') {
    const row = el('span', className);
    for (let index = 0; index < 3; index += 1) {
        const star = el('i', index < earned ? 'is-earned' : '');
        star.innerHTML = STAR_SVG;
        row.appendChild(star);
    }
    return row;
}

function cellMeter(orbs, className) {
    const meter = el('span', className);
    meter.setAttribute('aria-hidden', 'true');
    orbs.forEach((orb) => {
        const cell = el('i');
        cell.dataset.state = orb.state;
        meter.appendChild(cell);
    });
    return meter;
}

function describeOrbForSpeech(orb) {
    const parts = [`Orb ${orb.id}`, orb.name];
    if (orb.kind) parts.push(orb.kind.label);
    parts.push(SPOKEN_STATE[orb.state]);
    if (orb.state === 'cleared') parts.push(`${orb.stars} of 3 stars`);
    return parts.join(', ');
}

function chapterOf(view, id) {
    return view.model?.chapters.find((chapter) => chapter.id === id) || null;
}

// ---- Header -----------------------------------------------------------------------------

function renderHeader(view) {
    const { progress, chapters } = view.model;
    setText('odyssey-total-stars', progress.totalStars ?? 0);
    setText('odyssey-max-stars', progress.maxStars ?? 0);
    setText('odyssey-cleared-orbs', progress.clearedOrbs);
    setText('odyssey-total-orbs', progress.totalOrbs);
    setText('odyssey-complete-chapters', chapters.filter((chapter) => chapter.state === 'complete').length);
    setText('odyssey-total-chapters', chapters.length);
    const meter = byId('odyssey-journey-meter');
    if (!meter) return;
    meter.replaceChildren(...chapters.map((chapter) => {
        const group = cellMeter(chapter.orbs, 'odyssey-journey-meter__chapter');
        group.dataset.chapter = String(chapter.id);
        group.dataset.state = chapter.state;
        group.style.flexGrow = String(Math.max(1, chapter.orbs.length));
        group.title = `Chapter ${chapter.id} · ${chapter.shortName}`;
        return group;
    }));
}

// ---- Rail -------------------------------------------------------------------------------

function renderRail(view) {
    const list = byId('odyssey-chapters');
    if (!list) return;
    const { chapters } = view.model;
    list.replaceChildren(...chapters.map((chapter, index) => {
        const item = el('li', 'odyssey-chapters__item');
        item.setAttribute('role', 'presentation');
        item.dataset.chapter = String(chapter.id);
        // The ascent line up to the chapter above: lit once that chapter is reached.
        const above = chapters[index + 1];
        if (above) item.dataset.link = above.state === 'locked' ? 'locked' : 'lit';
        const tab = el('button', 'odyssey-chapter');
        tab.type = 'button';
        tab.id = `odyssey-chapter-tab-${chapter.id}`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', 'odyssey-nav-stage');
        tab.setAttribute('aria-label', `Chapter ${chapter.id}, ${chapter.name}: ${SPOKEN_CHAPTER[chapter.state]}, `
            + `${chapter.stars} of ${chapter.maxStars} stars`);
        tab.dataset.chapter = String(chapter.id);
        tab.dataset.state = chapter.state;
        const gem = el('span', 'odyssey-chapter__gem', String(chapter.id));
        if (chapter.state === 'locked') gem.insertAdjacentHTML('beforeend', LOCK_SVG);
        const title = el('span', 'odyssey-chapter__line');
        title.appendChild(el('span', 'odyssey-chapter-name', chapter.shortName));
        if (chapter.state === 'current') title.appendChild(el('span', 'odyssey-chapter__here', 'You are here'));
        const stars = el('span', 'odyssey-chapter-stars');
        stars.innerHTML = `${chapter.stars}<small>/${chapter.maxStars}</small>${STAR_SVG}`;
        const tally = el('span', 'odyssey-chapter__line');
        tally.append(cellMeter(chapter.orbs, 'odyssey-chapter__meter'), stars);
        const body = el('span', 'odyssey-chapter__body');
        body.append(title, tally);
        tab.append(gem, body);
        item.appendChild(tab);
        return item;
    }));
}

function markChapterSelection(view) {
    const selected = String(view.chapterId);
    document.querySelectorAll(`#${ROOT_ID} .odyssey-chapter`).forEach((tab) => {
        const isSelected = tab.dataset.chapter === selected;
        tab.setAttribute('aria-selected', String(isSelected));
        tab.tabIndex = isSelected ? 0 : -1;
    });
    document.querySelectorAll(`#${ROOT_ID} .odyssey-journey-meter__chapter`).forEach((group) => {
        group.classList.toggle('is-selected', group.dataset.chapter === selected);
    });
}

// ---- Stage: the chapter, its route ------------------------------------------------------

function renderStageChapter(view, chapter) {
    const root = byId(ROOT_ID);
    if (root) root.dataset.chapter = String(chapter.id);
    const { chapters } = view.model;
    setText('odyssey-stage-eyebrow', `Chapter ${chapter.id} of ${chapters.length}`
        + `${chapter.subtitle ? ` · ${chapter.subtitle}` : ''}`);
    setText('odyssey-stage-title', chapter.name);
    const intro = setText('odyssey-stage-intro', chapter.intro);
    if (intro) intro.hidden = !chapter.intro;
    const tally = byId('odyssey-stage-tally');
    if (tally) {
        tally.innerHTML = '';
        const stars = el('span', 'odyssey-stage__tally-stars');
        stars.innerHTML = `<b>${chapter.stars}</b>/${chapter.maxStars}${STAR_SVG}`;
        const orbs = el('span', 'odyssey-stage__tally-orbs');
        orbs.innerHTML = `<b>${chapter.cleared}</b>/${chapter.orbs.length} orbs`;
        tally.append(stars, orbs);
    }
    const index = chapters.indexOf(chapter);
    document.querySelectorAll(`#${ROOT_ID} [data-navigator-step]`).forEach((button) => {
        button.disabled = !chapters[index + Number(button.dataset.navigatorStep)];
    });
    const stage = byId('odyssey-nav-stage');
    stage?.setAttribute('aria-labelledby', `odyssey-chapter-tab-${chapter.id}`);
}

function renderRouteStop(orb, next) {
    const item = el('li', 'odyssey-route__stop');
    if (next) {
        let link = 'open';
        if (next.state === 'locked') link = 'locked';
        else if (orb.state === 'cleared') link = 'lit';
        item.dataset.link = link;
    }
    const button = el('button', 'odyssey-level-btn');
    button.type = 'button';
    button.tabIndex = -1;
    button.dataset.level = String(orb.id);
    button.dataset.state = orb.state;
    if (orb.kind) button.dataset.kind = orb.kind.id;
    button.setAttribute('aria-label', describeOrbForSpeech(orb));

    const art = el('span', 'odyssey-orb__art');
    const src = iconUrl(orb.themeId);
    if (src) {
        const image = el('img', 'odyssey-orb__image');
        image.alt = '';
        image.width = 128;
        image.height = 128;
        image.decoding = 'async';
        image.loading = 'lazy';
        image.addEventListener('error', () => { image.hidden = true; }, { once: true });
        image.src = src;
        art.appendChild(image);
    }
    art.appendChild(el('span', 'odyssey-orb__ring'));
    if (orb.state === 'locked') {
        const lock = el('span', 'odyssey-orb__lock');
        lock.innerHTML = LOCK_SVG;
        art.appendChild(lock);
    }
    if (orb.kind?.id === 'boss') {
        const crown = el('span', 'odyssey-orb__badge odyssey-orb__badge--boss');
        crown.innerHTML = CROWN_SVG;
        art.appendChild(crown);
    } else if (orb.kind?.id === 'rival') {
        art.appendChild(el('span', 'odyssey-orb__badge odyssey-orb__badge--rival', 'VS'));
    }
    art.appendChild(el('span', 'odyssey-orb__number', String(orb.id)));
    if (orb.state === 'next') button.appendChild(el('span', 'odyssey-orb__flag', 'Next'));
    button.append(art, el('span', 'odyssey-orb__name', orb.name), starRow(orb.stars, 'odyssey-level-stars'));
    item.appendChild(button);
    return item;
}

/**
 * Lay the route out in balanced rows (fourteen orbs as two rows of seven, never twelve and
 * two); the last stop of each row draws no link.
 */
function layoutRoute(view) {
    const list = byId('odyssey-route');
    if (!list) return;
    const stops = Array.from(list.children);
    const width = list.clientWidth || 0;
    const fit = width > 0 ? Math.max(1, Math.floor(width / ROUTE_STOP_MIN_PX)) : stops.length;
    const columns = Math.max(1, Math.ceil(stops.length / Math.max(1, Math.ceil(stops.length / fit))));
    list.style.setProperty('--route-columns', String(columns));
    stops.forEach((stop, index) => {
        stop.toggleAttribute('data-row-end', (index + 1) % columns === 0 || index === stops.length - 1);
    });
    view.routeWidth = width;
}

function renderRoute(view, chapter) {
    const list = byId('odyssey-route');
    if (!list) return;
    list.replaceChildren(...chapter.orbs.map((orb, index) => renderRouteStop(orb, chapter.orbs[index + 1])));
    layoutRoute(view);
    if (!view.routeObserver && typeof ResizeObserver === 'function') {
        view.routeObserver = new ResizeObserver(() => {
            if ((byId('odyssey-route')?.clientWidth || 0) !== view.routeWidth) layoutRoute(view);
        });
        view.routeObserver.observe(list);
    }
}

function markOrbSelection(view) {
    const selected = String(view.orbId);
    document.querySelectorAll(`#${ROOT_ID} .odyssey-level-btn`).forEach((button) => {
        const isSelected = button.dataset.level === selected;
        if (isSelected) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
        button.tabIndex = isSelected ? 0 : -1;
    });
}

// ---- Stage: the orb card ----------------------------------------------------------------

function describeReward(orb) {
    const theme = orb.themeId ? getThemeMeta(orb.themeId) : null;
    if (!theme?.displayName) return null;
    const song = getThemeMusic(orb.themeId)?.name;
    let text = `${theme.displayName} theme`;
    if (song) text += song === theme.displayName ? ' and its song' : ` and its song, ${song}`;
    return { label: orb.state === 'cleared' ? 'Collected' : 'Reward', text };
}

function orbEyebrow(orb) {
    const parts = [`Orb ${orb.id}`];
    if (orb.kind) parts.push(orb.kind.label);
    if (orb.state === 'next') parts.push('Next');
    else if (orb.state === 'cleared') parts.push('Cleared');
    else if (orb.state === 'locked') parts.push('Locked');
    return parts.join(' · ');
}

/** Why an orb is shut: the one orb to clear, or how far ahead of the journey it lies. */
function lockNote(model, orb) {
    const ahead = orb.id - model.nextLevelId;
    if (model.orbs.get(orb.id - 1)?.unlocked || ahead <= 1) return `Locked · clear orb ${orb.id - 1} to open this one.`;
    return `Locked · ${ahead} orbs ahead of you. Your journey waits at orb ${model.nextLevelId}.`;
}

function playLabel(orb, launching) {
    if (launching) return 'Setting out';
    if (!orb.unlocked) return 'Locked';
    return orb.state === 'cleared' ? 'Play again' : 'Play';
}

/** Play a class's entrance again: the layout read between the two class changes restarts it. */
function restartEntrance(node, className) {
    if (!node) return;
    node.classList.remove(className);
    if (node.offsetWidth >= 0) node.classList.add(className);
}

function renderPostcard(view, orb) {
    const card = byId('odyssey-postcard');
    if (!card) return;
    card.dataset.state = orb.state;
    card.dataset.kind = orb.kind?.id || '';
    const src = iconUrl(orb.themeId);
    [card.querySelector('.odyssey-postcard__image'), byId(ROOT_ID)?.querySelector('.odyssey-nav__ambient')]
        .forEach((image) => {
            if (!image) return;
            image.hidden = !src;
            if (src && image.getAttribute('src') !== src) image.src = src;
        });

    setText('odyssey-postcard-eyebrow', orbEyebrow(orb));
    setText('odyssey-postcard-title', orb.name);
    const stars = byId('odyssey-postcard-stars');
    if (stars) {
        stars.replaceChildren(starRow(orb.stars, 'odyssey-postcard__star-row'));
        stars.setAttribute('aria-label', `${orb.stars} of 3 stars earned`);
    }
    setText('odyssey-postcard-description', orb.description || 'Clear the goal to move on.');
    const lock = setText('odyssey-postcard-lock', orb.unlocked ? '' : lockNote(view.model, orb));
    if (lock) lock.hidden = orb.unlocked;

    // The authored orb: charms act during play and change nothing before it starts.
    const played = orb.level;
    setText('odyssey-postcard-goal', formatOdysseyMapObjective(played.victory?.primary));
    const goals = byId('odyssey-postcard-star-goals');
    if (goals) {
        const tiers = ['one', 'two', 'three'].map((tier, index) => (played.stars?.[tier]
            ? { index, text: formatOdysseyStarCondition(played.stars[tier], index, played.victory?.bonuses) } : null))
            .filter(Boolean);
        goals.replaceChildren(...tiers.map(({ index, text }) => {
            const item = el('li', index < orb.stars ? 'is-earned' : '');
            item.innerHTML = STAR_SVG;
            item.appendChild(el('span', '', text));
            return item;
        }));
        const fact = byId('odyssey-postcard-star-goals-fact');
        if (fact) fact.hidden = tiers.length === 0;
    }
    const best = byId('odyssey-postcard-best-fact');
    if (best) {
        const score = Number(orb.completion?.bestScore) || 0;
        best.hidden = !(orb.state === 'cleared' && score > 0);
        setText('odyssey-postcard-best', `${score.toLocaleString()} points`);
    }
    const reward = describeReward(orb);
    const rewardFact = byId('odyssey-postcard-reward-fact');
    if (rewardFact) rewardFact.hidden = !reward;
    if (reward) {
        setText('odyssey-postcard-reward-label', reward.label);
        setText('odyssey-postcard-reward', reward.text);
    }

    const play = card.querySelector('[data-navigator-action="play"]');
    if (play) {
        play.disabled = !orb.unlocked;
        play.dataset.label = orb.state === 'cleared' ? 'again' : 'play';
        const label = play.querySelector('.odyssey-postcard__play-label');
        if (label) label.textContent = playLabel(orb, view.launching);
    }
    restartEntrance(card, 'is-entering');
    restartEntrance(byId(ROOT_ID)?.querySelector('.odyssey-nav__ambient'), 'is-entering');
}

// ---- Selection --------------------------------------------------------------------------

function selectOrb(view, orbId, { force = false } = {}) {
    const orb = view.model?.orbs.get(orbId);
    if (!orb) return;
    if (orb.chapterId !== view.chapterId) {
        selectChapter(view, orb.chapterId, orb.id);
        return;
    }
    if (!force && view.orbId === orb.id) return;
    view.orbId = orb.id;
    markOrbSelection(view);
    renderPostcard(view, orb);
}

function selectChapter(view, chapterId, orbId = null) {
    const chapter = chapterOf(view, chapterId) || view.model?.chapters[0];
    if (!chapter) return;
    const orb = chapter.orbs.find((candidate) => candidate.id === orbId) || preferredOdysseyChapterOrb(chapter);
    const changed = view.chapterId !== chapter.id;
    view.chapterId = chapter.id;
    if (changed) {
        renderStageChapter(view, chapter);
        renderRoute(view, chapter);
        markChapterSelection(view);
    }
    if (orb) selectOrb(view, orb.id, { force: changed });
}

function focusSelectedOrb(view, { scroll = true } = {}) {
    const button = document.querySelector(`#${ROOT_ID} .odyssey-level-btn[aria-current="true"]`);
    if (!button) return;
    button.focus({ preventScroll: true });
    if (scroll) button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

function focusSelectedChapter(view) {
    document.getElementById(`odyssey-chapter-tab-${view.chapterId}`)?.focus({ preventScroll: true });
}

function routeHasFocus() {
    const active = document.activeElement;
    return !active || active === document.body || Boolean(byId('odyssey-route')?.contains(active));
}

function stepChapter(view, step, { focus = 'auto' } = {}) {
    const { chapters } = view.model;
    const target = chapters[chapters.findIndex((chapter) => chapter.id === view.chapterId) + step];
    if (!target) return;
    const refocusOrb = focus === 'orb' || (focus === 'auto' && routeHasFocus());
    selectChapter(view, target.id);
    if (focus === 'tab') focusSelectedChapter(view);
    else if (refocusOrb) focusSelectedOrb(view);
}

function stepOrb(view, step) {
    const target = stepOdysseyNavigatorOrb(view.model, view.orbId, step);
    if (!target) return;
    selectOrb(view, target.id);
    focusSelectedOrb(view);
}

function jumpToOrb(view, orbId) {
    if (!view.model?.orbs.has(orbId)) return;
    selectOrb(view, orbId);
    focusSelectedOrb(view);
}

// ---- Actions ----------------------------------------------------------------------------

function setLaunching(view, launching) {
    view.launching = launching;
    const root = byId(ROOT_ID);
    if (!root) return;
    root.classList.toggle('is-launching', launching);
    if (launching) root.setAttribute('aria-busy', 'true');
    else root.removeAttribute('aria-busy');
    const orb = view.model?.orbs.get(view.orbId);
    const label = root.querySelector('[data-navigator-action="play"] .odyssey-postcard__play-label');
    if (orb && label) label.textContent = playLabel(orb, launching);
}

function launch(view, orbId) {
    const orb = view.model?.orbs.get(orbId);
    if (!orb?.unlocked || view.launching || typeof view.mode?._launchLevelFromNavigator !== 'function') return;
    setLaunching(view, true);
    Promise.resolve(view.mode._launchLevelFromNavigator(orb.id))
        .then((entered) => {
            if (entered === false) setLaunching(view, false);
        })
        .catch((error) => {
            console.warn(`[Odyssey] Navigator launch failed for ${orb.id}:`, error);
            setLaunching(view, false);
        });
}

function showOnMap(view, orbId) {
    const { mode } = view;
    if (!view.model?.orbs.has(orbId) || !mode) return;
    mode.closeOdysseyNavigator?.({ restoreBoardPreview: false });
    Promise.resolve(mode._focusBoardLevelForLaunch?.(orbId, { updatePreview: true, settle: true }))
        .catch((error) => console.warn(`[Odyssey] Navigator could not show orb ${orbId}:`, error));
}

// ---- Input ------------------------------------------------------------------------------

function onClick(view, event) {
    const target = event.target?.closest?.('[data-navigator-action], [data-navigator-step], .odyssey-chapter, '
        + '.odyssey-level-btn, .odyssey-journey-meter__chapter');
    if (!target || view.launching) return;
    const action = target.dataset.navigatorAction;
    if (action === 'close') view.mode?.closeOdysseyNavigator?.();
    else if (action === 'play') launch(view, view.orbId);
    else if (action === 'show') showOnMap(view, view.orbId);
    else if (target.dataset.navigatorStep) stepChapter(view, Number(target.dataset.navigatorStep));
    else if (target.dataset.chapter) selectChapter(view, Number(target.dataset.chapter));
    else if (target.dataset.level) {
        const orbId = Number(target.dataset.level);
        const press = resolveOdysseyOrbPress({
            orbId, shownOrbId: view.orbId, shownBeforePress: view.pressedSelection, viaPointer: event.detail > 0,
        });
        if (press === 'launch') launch(view, orbId);
        else selectOrb(view, orbId);
    }
}

function onFocus(view, event) {
    if (view.launching || now() - view.pointerAt < POINTER_FOCUS_MS) return;
    const orbButton = event.target?.closest?.('.odyssey-level-btn');
    if (orbButton) {
        selectOrb(view, Number(orbButton.dataset.level));
        return;
    }
    const tab = event.target?.closest?.('.odyssey-chapter');
    if (tab) selectChapter(view, Number(tab.dataset.chapter));
}

function onKey(view, event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || view.launching) return;
    if (event.target?.closest?.('input, textarea, select, [contenteditable], .odyssey-new-journey')) return;
    let on = 'other';
    if (event.target?.closest?.('.odyssey-level-btn')) on = 'orb';
    else if (event.target?.closest?.('.odyssey-chapter')) on = 'tab';
    const action = resolveOdysseyNavigatorKey(view.model, event.key, on);
    if (!action) return;
    event.preventDefault();
    if (action.orbStep) stepOrb(view, action.orbStep);
    else if (action.chapterStep) stepChapter(view, action.chapterStep, { focus: action.focus });
    else if (Number.isFinite(action.chapterId)) {
        selectChapter(view, action.chapterId);
        focusSelectedChapter(view);
    } else if (Number.isFinite(action.orbId)) jumpToOrb(view, action.orbId);
    else focusSelectedOrb(view);
}

function viewFor(root) {
    let view = views.get(root);
    if (view) return view;
    view = {
        mode: null,
        model: null,
        chapterId: null,
        orbId: null,
        launching: false,
        pointerAt: -Infinity,
        pressedSelection: null,
    };
    views.set(root, view);
    root.addEventListener('pointerdown', (event) => {
        view.pointerAt = now();
        view.pressedSelection = event.target?.closest?.('.odyssey-level-btn') ? view.orbId : null;
    }, true);
    root.addEventListener('click', (event) => onClick(view, event));
    root.addEventListener('focusin', (event) => onFocus(view, event));
    root.addEventListener('keydown', (event) => onKey(view, event));
    // Keys pressed while focus rests on the page (a chapter change took the focused orb).
    document.addEventListener('keydown', (event) => {
        if (event.target === document.body && root.isConnected && root.style.display === 'flex') onKey(view, event);
    });
    return view;
}

/**
 * Fill the navigator from the mode's progress.
 * @param {object} mode the active OdysseyMode (odysseyState, levelRegistry, selectedLevelId and the
 *   navigator actions: _launchLevelFromNavigator, closeOdysseyNavigator, _focusBoardLevelForLaunch)
 * @param {number|null} [focusChapter] a chapter to open on; otherwise the board's selected orb
 */
export function renderOdysseyNavigatorList(mode, focusChapter = null) {
    const root = byId(ROOT_ID);
    if (!root || !mode?.odysseyState || !mode.levelRegistry) return;
    const view = viewFor(root);
    view.mode = mode;
    view.model = buildOdysseyNavigatorModel(mode);
    setLaunching(view, false);
    const { chapter, orb } = resolveOdysseyNavigatorSelection(view.model, {
        chapterId: Number.isFinite(focusChapter) ? focusChapter : null,
        levelId: Number.isFinite(mode.selectedLevelId) ? mode.selectedLevelId : null,
    });
    renderHeader(view);
    renderRail(view);
    view.chapterId = null;
    view.orbId = null;
    selectChapter(view, chapter?.id ?? null, orb?.id ?? null);
}

/** Show the navigator, filled, with focus on the orb its card shows. */
export function showOdysseyNavigator(root, mode) {
    if (!root) return;
    root.style.display = 'flex';
    renderOdysseyNavigatorList(mode);
    root.scrollTop = 0;
    const stage = byId('odyssey-nav-stage');
    if (stage) stage.scrollTop = 0;
    const view = views.get(root);
    if (view) focusSelectedOrb(view, { scroll: false });
}

/** Hide the navigator; focus returns to the page so the map's keys answer again. */
export function hideOdysseyNavigator(root) {
    if (!root) return;
    if (root.contains?.(document.activeElement)) document.activeElement.blur?.();
    root.style.display = 'none';
    const view = views.get(root);
    if (view?.launching) setLaunching(view, false);
}
