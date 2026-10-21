/**
 * @fileoverview The frame both Odyssey outcome sheets share (results, failure): the orb's world
 * as the hero in its chapter's light, the main column, an optional side column (the results'
 * leaderboard) and a footer for the actions that never scrolls away. The navigator's grammar
 * (docs/ODYSSEY_NAVIGATOR_2026-10.md); styles in public/styles/odyssey-outcome.css.
 *
 * Plain DOM properties only (className, textContent, dataset when present), so the sheets stay
 * testable against minimal element stubs.
 */

import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';
import { createOdysseyOrbArt, odysseyLevelThemeId } from './odyssey-orb-art.js';
import { el } from './keystone-sheet.js';

function setData(node, name, value) {
    if (node?.dataset) node.dataset[name] = String(value);
}

/** The chapter's short name, the part before " & ": "Deep Ocean & Liquid Worlds" → "Deep Ocean". */
function chapterShortName(chapterId) {
    const name = CHAPTER_CONFIGS.find((chapter) => chapter.id === chapterId)?.name || '';
    return name.split(/\s+&\s+/)[0].trim();
}

/**
 * The orb an outcome sheet is about, from the attempt's resolved level (LevelRegistry
 * resolveLevelPresentation): its number, name, chapter, world and kind.
 * @param {?object} level
 * @returns {?{number: ?number, name: string, chapter: ?number, chapterName: string,
 *   themeId: ?string, kind: ?('boss'|'rival'), rivalName: ?string}}
 */
export function describeOdysseyOutcomeOrb(level) {
    if (!level || typeof level !== 'object') return null;
    const number = Number.isFinite(level.id) ? level.id : null;
    const chapter = Number.isFinite(level.chapter) ? level.chapter : null;
    let kind = null;
    if (level.mechanics?.versus) kind = 'rival';
    else if (level.chapterBoss) kind = 'boss';
    return {
        number,
        name: String(level.pathLabel || level.name || ''),
        chapter,
        chapterName: chapter ? chapterShortName(chapter) : '',
        themeId: odysseyLevelThemeId(level),
        kind,
        rivalName: level.mechanics?.versus?.botName || null,
    };
}

/** "Orb 15 · Surface World · Attempt 3": where the orb lies, then the sheet's own word. */
export function describeOdysseyOutcomeEyebrow(orb, tail = '') {
    const parts = [];
    if (orb?.number) parts.push(`Orb ${orb.number}`);
    if (orb?.chapterName) parts.push(orb.chapterName);
    if (tail) parts.push(tail);
    return parts.join(' · ');
}

/**
 * Lay out an outcome sheet inside its Keystone panel.
 * @param {HTMLElement} modal the sheet's root (wears the chapter's light: data-ody-chapter)
 * @param {HTMLElement} panel the sheet's panel (createKeystoneSheet)
 * @param {{orb?: ?object, state?: string, side?: boolean}} [options]
 * @returns {{body: HTMLElement, hero: ?HTMLElement, main: HTMLElement, side: ?HTMLElement, footer: HTMLElement}}
 */
export function createOdysseyOutcomeFrame(modal, panel, { orb = null, state = 'open', side = false } = {}) {
    if (orb?.chapter) setData(modal, 'odyChapter', orb.chapter);
    const art = orb && (orb.themeId || orb.number) ? createOdysseyOrbArt({
        themeId: orb.themeId,
        chapter: orb.chapter,
        state,
        kind: orb.kind,
        number: orb.number,
        className: 'sb-ody-outcome__orb',
    }) : null;
    const body = el('div', `sb-ody-outcome${art ? ' sb-ody-outcome--art' : ''}${side ? ' sb-ody-outcome--side' : ''}`);
    let hero = null;
    if (art) {
        hero = el('div', 'sb-ody-outcome__hero');
        hero.appendChild(art);
        body.appendChild(hero);
    }
    const main = el('div', 'sb-ody-outcome__main');
    body.appendChild(main);
    const sideColumn = side ? el('div', 'sb-ody-outcome__side') : null;
    if (sideColumn) body.appendChild(sideColumn);
    panel.appendChild(body);
    // The actions stay in view however long the sheet grows (a phone, large text): the body
    // scrolls above them.
    const footer = el('div', 'sb-ody-outcome__footer');
    panel.appendChild(footer);
    return {
        body, hero, main, side: sideColumn, footer,
    };
}
