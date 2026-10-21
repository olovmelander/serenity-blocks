/**
 * The map's orb panel: the navigator's orb card, docked beside the live map. The orb's world as
 * the art (in its chapter's light, a crown on a boss, VS on a rival), what it asks for, what
 * each star needs, and what changes from the orb before it. This is the briefing a player reads
 * before pressing Play from the map, so a rule change (a taller well, a deadline, cascade
 * physics) is never a surprise on arrival. One read-only line names the charms held that help
 * here. Pure DOM by id; the mode owns selection, prefetch, the Play button and the charm bag.
 * Shell: BoardInfoOverlay.js; look: public/styles/odyssey-map.css.
 */
import { formatOdysseyMapObjective, formatOdysseyStarCondition } from './objective-copy.js';
import { getOdysseyLevelBriefing } from './odyssey-level-briefing.js';
import { odysseyCharmHelps } from '../../core/odyssey/odyssey-charm-bag.js';
import { describeOdysseyPanelCharms } from './odyssey-charm-copy.js';
import { createOdysseyCharmIconNode } from './odyssey-charm-icon-stage.js';
import { createOdysseyOrbArt, createOdysseyStarRow, odysseyLevelThemeId } from './odyssey-orb-art.js';

/** The kind of orb, as the map marks it: a rival duel, the chapter's boss, a showcase, or none. */
export function describeOdysseyOrbKind(level) {
    if (!level) return null;
    if (level.mechanics?.versus) {
        return { id: 'rival', label: `Rival duel · ${level.mechanics.versus.botName || 'Rival'}` };
    }
    // One per chapter (campaign-order resolveChapterBossIds), as the map's crown marks it.
    if (level.chapterBoss) {
        const showcase = level.victoryLapPolicy === 'showcase';
        return { id: 'boss', label: showcase ? 'Chapter boss · Showcase' : 'Chapter boss' };
    }
    if (level.victoryLapPolicy === 'showcase') return { id: 'showcase', label: 'Showcase' };
    return null;
}

/**
 * The orb's state as the navigator names it: cleared once completed, locked while shut, and
 * otherwise the orb the journey waits on (orbs open one after another).
 */
export function describeOdysseyPanelOrbState({ completion = null, unlocked = false } = {}) {
    if (completion) return 'cleared';
    return unlocked ? 'next' : 'locked';
}

/** Play's word for an orb: Locked while shut, Play again once cleared, else Play. */
export function describeOdysseyPanelPlayLabel({ completion = null, unlocked = true } = {}) {
    if (!unlocked) return 'Locked';
    return completion ? 'Play again' : 'Play';
}

/**
 * Play after a launch that did not start: no longer pressed, and its own word again for the
 * selected orb (with nothing selected the word stays).
 * @param {Document} doc
 * @param {number|null} levelId the selected orb
 * @param {{ getLevelCompletion?: (id: number) => object|null }} [state] the journey's state
 */
export function resetOdysseyPanelPlay(doc, levelId, state) {
    const playBtn = doc?.getElementById?.('level-panel-play-btn');
    if (!playBtn) return;
    playBtn.classList?.remove('clicked');
    if (!levelId) return;
    playBtn.textContent = describeOdysseyPanelPlayLabel({ completion: state?.getLevelCompletion?.(levelId) });
}

function setText(doc, id, text) {
    const node = doc.getElementById(id);
    if (node) node.textContent = text;
    return node;
}

function setData(node, name, value) {
    if (node?.dataset) node.dataset[name] = value;
}

function clearChildren(node) {
    if (typeof node.replaceChildren === 'function') node.replaceChildren();
    else node.innerHTML = '';
}

function fillList(doc, id, items) {
    const list = doc.getElementById(id);
    if (!list) return;
    clearChildren(list);
    items.forEach((text) => {
        const item = doc.createElement('li');
        item.textContent = text;
        list.appendChild(item);
    });
    list.hidden = items.length === 0;
}

/**
 * The star goals, each led by its tier's stars (one, two, three), lit in gold once earned. Where
 * no star row can be drawn (no document), the tier reads "2 ★".
 */
function fillStarGoals(doc, goals) {
    const list = doc.getElementById('level-panel-star-goals');
    if (!list) return;
    clearChildren(list);
    goals.forEach(({ tier, text, earned }) => {
        const item = doc.createElement('li');
        if (earned) item.className = 'is-earned';
        setData(item, 'tier', String(tier));
        const label = `${tier} ${tier === 1 ? 'star' : 'stars'}`;
        const stars = createOdysseyStarRow(earned ? tier : 0, {
            total: tier, className: 'level-star-goal__tier', label,
        });
        if (stars) {
            item.appendChild(stars);
        } else {
            const fallback = doc.createElement('span');
            fallback.className = 'level-star-goal__tier';
            fallback.textContent = `${tier} ★`;
            item.appendChild(fallback);
        }
        const words = doc.createElement('span');
        words.className = 'level-star-goal__text';
        words.textContent = text;
        item.appendChild(words);
        list.appendChild(item);
    });
    list.hidden = goals.length === 0;
}

/**
 * The orb's world in its rings, drawn again only when the orb, its state or its kind changes, so
 * a re-render of the same orb does not reload its artwork.
 */
function renderArt(doc, level, { state, kind }) {
    const holder = doc.getElementById('level-panel-art');
    if (!holder) return;
    const themeId = odysseyLevelThemeId(level);
    const key = [level.id, themeId, state, kind || '', level.chapter].join('|');
    if (holder.dataset?.artKey === key && holder.children?.length) return;
    const art = createOdysseyOrbArt({
        themeId, chapter: level.chapter ?? null, state, kind, number: level.id, className: 'level-panel__orb',
    });
    if (!art) return;
    if (typeof holder.replaceChildren === 'function') holder.replaceChildren(art);
    else {
        clearChildren(holder);
        holder.appendChild(art);
    }
    setData(holder, 'artKey', key);
}

/** Light the selected orb's chapter on the header's journey meter (BoardInfoOverlay.js). */
function markMeterChapter(doc, chapterId) {
    const meter = doc.getElementById('odyssey-map-meter');
    if (!meter?.children) return;
    Array.from(meter.children).forEach((group) => {
        group.classList?.toggle('is-selected', group.dataset?.odyChapter === String(chapterId));
    });
}

/** Play the panel's entrance again: the layout read between the two class changes restarts it. */
function restartEntrance(panel) {
    if (!panel?.classList || typeof panel.offsetWidth !== 'number') return;
    panel.classList.remove('is-entering');
    if (panel.offsetWidth >= 0) panel.classList.add('is-entering');
}

/**
 * The charm line: the charms held that do something on this orb, or nothing. Read-only; the
 * charms are used during the orb, never chosen here.
 * @param {Document} doc
 * @param {object} level the authored orb
 * @param {readonly { id: string, name: string, count: number }[] | null} charms the bag
 */
export function renderOdysseyPanelCharms(doc, level, charms) {
    const hint = doc.getElementById('level-panel-charm-hint');
    if (!hint) return;
    const line = describeOdysseyPanelCharms(charms, level);
    hint.textContent = line || '';
    hint.hidden = !line;
    if (!line || typeof hint.prepend !== 'function') return;
    // The helping charms' live icons ahead of the words.
    const icons = (charms || [])
        .filter((entry) => entry.count > 0 && odysseyCharmHelps(level, entry.id))
        .map((entry) => createOdysseyCharmIconNode(entry.id))
        .filter(Boolean);
    if (icons.length) hint.prepend(...icons);
}

/**
 * @param {object} options
 * @param {object} options.level the resolved presentation of the selected orb
 * @param {object|null} [options.previousLevel] the orb before it on the route
 * @param {object|null} [options.completion] the saved completion, if any
 * @param {boolean} options.unlocked whether the orb can be played now
 * @param {string} [options.chapterName]
 * @param {readonly { id: string, name: string, count: number }[] | null} [options.charms] the bag, for one
 *   read-only line naming the charms held that help here
 * @param {Document} [doc]
 */
export function renderOdysseyLevelPanel({
    level, previousLevel = null, completion = null, unlocked = false, chapterName = '', charms = null,
}, doc = globalThis.document) {
    if (!level || !doc) return;
    const stars = Math.max(0, Math.min(3, Number(completion?.stars) || 0));
    const kind = describeOdysseyOrbKind(level);
    const state = describeOdysseyPanelOrbState({ completion, unlocked });
    const artKind = kind && kind.id !== 'showcase' ? kind.id : null;

    // The chapter's light tints the card; the state and kind dress its art and its eyebrow.
    const panel = doc.getElementById('odyssey-level-panel');
    if (panel) {
        setData(panel, 'odyChapter', String(level.chapter ?? ''));
        setData(panel, 'state', state);
        setData(panel, 'kind', kind?.id || '');
    }
    renderArt(doc, level, { state, kind: artKind });
    markMeterChapter(doc, level.chapter);

    const kindNode = doc.getElementById('level-panel-kind');
    if (kindNode) {
        kindNode.textContent = kind?.label || '';
        kindNode.hidden = !kind;
        setData(kindNode, 'kind', kind?.id || '');
    }
    setText(doc, 'level-panel-number', `Orb ${level.id}`);
    setText(doc, 'level-panel-name', level.pathLabel || level.name);
    setText(doc, 'level-panel-chapter', `Chapter ${level.chapter}${chapterName ? `: ${chapterName}` : ''}`);
    const description = level.description || level.metadata?.description || 'Clear the goal to move on.';
    setText(doc, 'level-panel-description', description);

    const starsNode = doc.getElementById('level-panel-stars');
    if (starsNode) {
        const row = createOdysseyStarRow(stars, { className: 'level-panel__star-row' });
        if (row && typeof starsNode.replaceChildren === 'function') starsNode.replaceChildren(row);
        else starsNode.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
        setData(starsNode, 'earned', stars > 0 ? 'true' : 'false');
        starsNode.ariaLabel = `${stars} of 3 stars earned`;
        starsNode.setAttribute?.('aria-label', `${stars} of 3 stars earned`);
    }

    renderOdysseyPanelCharms(doc, level, charms);

    setText(doc, 'level-panel-goal', formatOdysseyMapObjective(level.victory?.primary));
    const starGoals = ['one', 'two', 'three'].map((tier, index) => (
        level.stars?.[tier] ? {
            tier: index + 1,
            text: formatOdysseyStarCondition(level.stars[tier], index, level.victory?.bonuses),
            earned: index < stars,
        } : null
    )).filter(Boolean);
    fillStarGoals(doc, starGoals);
    const starGoalsLabel = doc.getElementById('level-panel-star-goals-label');
    if (starGoalsLabel) starGoalsLabel.hidden = starGoals.length === 0;

    // What this orb asks that the orb before it did not; a fresh selection shows its rules.
    const briefing = getOdysseyLevelBriefing(level, previousLevel);
    const rules = previousLevel ? briefing.changes : briefing.rules;
    fillList(doc, 'level-panel-rules', rules);
    const rulesLabel = doc.getElementById('level-panel-rules-label');
    if (rulesLabel) {
        rulesLabel.textContent = previousLevel ? 'What changes here' : 'Rules';
        rulesLabel.hidden = rules.length === 0;
    }

    const tipNode = doc.getElementById('level-panel-tip');
    if (tipNode) {
        tipNode.textContent = level.metadata?.tip || '';
        tipNode.hidden = !level.metadata?.tip;
    }

    const lockNode = doc.getElementById('level-panel-lock');
    if (lockNode) {
        lockNode.textContent = unlocked ? '' : `Locked · clear orb ${level.id - 1} to open this one.`;
        lockNode.hidden = unlocked;
    }

    const playBtn = doc.getElementById('level-panel-play-btn');
    if (playBtn) {
        playBtn.disabled = !unlocked;
        playBtn.textContent = describeOdysseyPanelPlayLabel({ completion, unlocked });
    }

    // A new orb starts its story at the top, and its card settles in (a panel that was hidden
    // plays its entrance as it shows).
    if (panel?.dataset && panel.dataset.levelId !== String(level.id)) {
        const body = panel.querySelector?.('.level-panel__body');
        if (body) body.scrollTop = 0;
        panel.dataset.levelId = String(level.id);
        restartEntrance(panel);
    }
}
