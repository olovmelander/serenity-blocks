/**
 * @fileoverview Records, one tab per mode that keeps them: Single Player, Infinity and
 * Odyssey. Each tab leads with what its mode is about (its facts), then its list. This file
 * reads the records and builds the markup; modals.js shows the sheet and wires the tabs.
 *
 * Records can arrive from another device through Steam Cloud, so every value is rendered
 * as a number, never as markup (audit SCORE-17).
 */
import { csIcon } from '../components/cosmic-icons.js';
import { statisticsForMode } from '../../core/progression/score-statistics.js';
import { odysseyMeterHtml } from '../keystone/odyssey-meter.js';

/** The modes with records, in tab order. */
export const RECORD_MODES = ['single', 'infinity', 'odyssey'];

const MODE_NAMES = { single: 'Single Player', infinity: 'Infinity', odyssey: 'Odyssey' };

/** The main menu cards an empty tab's button plays. */
const MODE_CARDS = { single: 'single-player-card-btn', infinity: 'infinity-card-btn', odyssey: 'odyssey-card-btn' };

const MEDALS = ['gold', 'silver', 'bronze'];

const recordNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const formatNumber = (value) => recordNumber(value).toLocaleString();

/** "6:44", or "1:12:05" past an hour. */
export function formatRunLength(seconds) {
    const total = Math.max(0, Math.round(recordNumber(seconds)));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = String(total % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

/** "Today" for a record set today, so a fresh one is easy to find; the date otherwise. */
export function formatRecordDate(timestamp, now = new Date()) {
    if (!timestamp) return { text: '', today: false };
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return { text: '', today: false };
    if (date.toDateString() === now.toDateString()) return { text: 'Today', today: true };
    const text = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    return { text, today: false };
}

function plural(count, one, many = `${one}s`) {
    return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

/** What a saved game says under its score: Infinity by its run, Single Player by its climb. */
function scoreMeta(score, mode) {
    const lines = plural(recordNumber(score.lines), 'line');
    if (mode === 'infinity' && (recordNumber(score.cascade) > 0 || recordNumber(score.duration) > 0)) {
        return [
            recordNumber(score.cascade) > 0 ? `${formatNumber(score.cascade)}-chain cascade` : '',
            recordNumber(score.duration) > 0 ? formatRunLength(score.duration) : '',
            lines,
        ].filter(Boolean).join(' · ');
    }
    return `Level ${formatNumber(score.level)} · ${lines}`;
}

export function scoreRow(score, index, {
    mode = 'single', showReplay = false, canPlay = false, now,
} = {}) {
    const medal = MEDALS[index] || '';
    const points = formatNumber(score.score);
    const demoId = Number(score.demoId);
    let replay = '';
    if (showReplay) {
        replay = Number.isSafeInteger(demoId) && demoId > 0 && canPlay
            ? `<button type="button" class="play-demo-btn hs-play sb-btn" data-demo-id="${demoId}"
                    aria-label="Watch the replay of ${points}">
                    ${csIcon('play', 12, 'btn-icon-svg')}<span>Watch</span>
                </button>`
            : '<span class="hs-play hs-play--empty" aria-hidden="true"></span>';
    }
    const stamp = score.timestamp ? new Date(score.timestamp) : null;
    const iso = stamp && !Number.isNaN(stamp.getTime()) ? stamp.toISOString() : '';
    const date = formatRecordDate(score.timestamp, now);
    const dateClass = date.today ? 'hs-date hs-date--lit' : 'hs-date';
    return `
        <li class="hs-row${medal ? ` hs-row--${medal}` : ''}">
            <span class="hs-rank">${index + 1}</span>
            <div class="hs-main">
                <div class="hs-score">${points}</div>
                <div class="hs-meta">${scoreMeta(score, mode)}</div>
            </div>
            <time class="${dateClass}"${iso ? ` datetime="${iso}"` : ''}>${date.text}</time>
            ${replay}
        </li>`;
}

function factsHtml(facts) {
    return `<dl class="hs-stats-grid">${facts.map(([label, value]) => `
        <div class="hs-stat">
            <dt class="hs-stat-label">${label}</dt><dd class="hs-stat-value">${value}</dd>
        </div>`).join('')}
    </dl>`;
}

function emptyHtml(mode, text, { canPlay }) {
    const action = { single: 'Play', infinity: 'Play', odyssey: 'Begin the journey' }[mode];
    const play = canPlay
        ? `<button type="button" class="sb-btn sb-btn--primary hs-empty__play"
            data-play-card="${MODE_CARDS[mode]}">${action}</button>`
        : '';
    return `
        <div class="sb-empty hs-empty">
            <span class="sb-empty__icon" aria-hidden="true">${csIcon('trophy', 26)}</span>
            <p class="sb-empty__title">${text}</p>
            ${play}
        </div>`;
}

/**
 * Single Player or Infinity: its own facts and best games.
 * @returns {{ facts: string, list: string }}
 */
export function scoresTabHtml(mode, {
    scores, stats, canWatch = false, canStart = false, now,
}) {
    const own = statisticsForMode(stats, mode);
    if (!scores.length) {
        const text = mode === 'infinity'
            ? 'No Infinity runs yet. Your first one sets the record.'
            : 'No Single Player games yet. Your first one sets the record.';
        return { facts: '', list: emptyHtml(mode, text, { canPlay: canStart }) };
    }
    const games = own.totalGames;
    const facts = mode === 'infinity'
        ? [
            ['Best cascade', own.bestCascade ? `${formatNumber(own.bestCascade)}-chain` : '—'],
            ['Longest run', own.longestRun ? formatRunLength(own.longestRun) : '—'],
            ['Best score', formatNumber(own.highestScore)],
            ['Runs', formatNumber(games)],
        ]
        : [
            ['Best score', formatNumber(own.highestScore)],
            ['Highest level', formatNumber(own.highestLevel)],
            ['Games', formatNumber(games)],
            ['Average', games > 0 ? formatNumber(Math.round(own.totalScore / games)) : '0'],
        ];
    const showReplay = scores.some((score) => score.demoId);
    const rows = scores
        .map((score, index) => scoreRow(score, index, {
            mode, showReplay, canPlay: canWatch, now,
        }))
        .join('');
    return {
        facts: factsHtml(facts),
        list: `
            <h2 class="sb-sheet__section-title">${mode === 'infinity' ? 'Best runs' : 'Top scores'}</h2>
            <ol class="hs-leaderboard${showReplay ? ' hs-leaderboard--demos' : ''}">${rows}</ol>`,
    };
}

/**
 * The Odyssey from the save: what is cleared and starred, chapter by chapter, against the
 * journey's levels (stale or debug save entries left out, as the campaign summary does).
 */
export async function loadOdysseyRecords() {
    const [
        { getLevelRegistry },
        { readSavedOdysseyProgress },
        { getValidCompletedLevels },
        { getOdysseyCampaignSummary },
    ] = await Promise.all([
        import('../../core/odyssey/LevelRegistry.js'),
        import('../effects/breathing/breath-collection.js'),
        import('../../core/progression/theme-collection-model.js'),
        import('../../core/odyssey/odyssey-campaign-summary.js'),
    ]);
    const registry = getLevelRegistry();
    const progress = readSavedOdysseyProgress();
    const completed = getValidCompletedLevels(progress, registry.getAllLevels());
    const starsOf = (id) => Math.max(0, Math.min(3, recordNumber(completed.get(id)?.stars)));
    const summary = getOdysseyCampaignSummary(registry, {
        isLevelCompleted: (id) => completed.has(id),
        getLevelStars: starsOf,
    });
    const chapters = registry.getAllChapters().map((chapter) => {
        const levels = registry.getLevelsInChapter(chapter.id).map((level) => level.id);
        return {
            id: chapter.id,
            name: String(chapter.name || '').split(' & ')[0],
            levels,
            cleared: levels.filter((id) => completed.has(id)).length,
            stars: levels.reduce((sum, id) => sum + starsOf(id), 0),
        };
    });
    return {
        summary,
        chapters,
        completedIds: new Set(completed.keys()),
        threeStars: [...completed.keys()].filter((id) => starsOf(id) === 3).length,
        next: recordNumber(progress?.currentLevel) || 1,
    };
}

/**
 * Odyssey: stars, levels and chapters, the journey as cells, and each chapter's progress.
 * @returns {{ facts: string, list: string }}
 */
export function odysseyTabHtml(odyssey, { canStart = false } = {}) {
    const { summary, chapters } = odyssey;
    if (!summary.completedOrbs) {
        return {
            facts: '',
            list: emptyHtml('odyssey', 'No Odyssey levels cleared yet. Each one you clear lands here.', {
                canPlay: canStart,
            }),
        };
    }
    const facts = factsHtml([
        ['Stars', `${formatNumber(summary.stars)} / ${formatNumber(summary.maxStars)}`],
        ['Levels', `${formatNumber(summary.completedOrbs)} / ${formatNumber(summary.totalOrbs)}`],
        ['Chapters', `${formatNumber(summary.completedChapters)} / ${formatNumber(summary.totalChapters)}`],
        ['Three stars', formatNumber(odyssey.threeStars)],
    ]);
    const meter = odysseyMeterHtml(chapters, { completedIds: odyssey.completedIds, next: odyssey.next });
    const upNext = chapters.find((chapter) => chapter.levels.includes(odyssey.next));
    const rows = chapters.map((chapter) => {
        const complete = chapter.cleared === chapter.levels.length;
        const levels = `${formatNumber(chapter.cleared)} of ${plural(chapter.levels.length, 'level')}`;
        const stars = `${formatNumber(chapter.stars)} of ${formatNumber(chapter.levels.length * 3)} stars`;
        let status = '';
        if (complete) status = 'Complete';
        else if (chapter === upNext) status = 'Up next';
        return `
        <li class="hs-row hs-row--chapter${complete ? ' is-complete' : ''}">
            <span class="hs-rank">${formatNumber(chapter.id)}</span>
            <div class="hs-main">
                <div class="hs-score hs-score--name">${escapeHtml(chapter.name)}</div>
                <div class="hs-meta">${levels} · ${stars}</div>
            </div>
            <span class="hs-date${complete ? ' hs-date--lit' : ''}">${status}</span>
        </li>`;
    }).join('');
    return {
        facts: `${facts}<div class="hs-progress">${meter}</div>`,
        list: `
            <h2 class="sb-sheet__section-title">Chapters</h2>
            <ol class="hs-leaderboard hs-leaderboard--chapters">${rows}</ol>`,
    };
}

/** Lifetime totals across the modes that save a score, as one quiet line. */
export function allModesLine(stats) {
    const games = recordNumber(stats?.totalGames);
    if (games <= 0) return '';
    return `All modes · ${plural(games, 'game')} · ${formatNumber(stats.totalLines)} lines cleared`;
}

export function recordModeName(mode) {
    return MODE_NAMES[mode] || MODE_NAMES.single;
}
