import { createCampaignFinale } from './CampaignFinale.js';
import { mountOdysseyOutcome } from './odyssey-outcome-owner.js';
import { odysseyLevelThemeId } from './odyssey-orb-art.js';
import { getOdysseyCampaignSummary } from '../../core/odyssey/odyssey-campaign-summary.js';
import { canWriteLegacySimulationResults } from '../../core/game-modes/single-player-result-compatibility.js';
import { prefersOdysseyReducedMotion } from '../../core/game-modes/odyssey-physics-callbacks.js';

/**
 * Each chapter of the finale's ascent: the summary's chapter plus the world of its boss (the
 * chapter's last orb when it has none), how many orbs it holds and the stars earned there.
 * Registries without presentations or per-chapter lists fall back to the plain level list.
 */
export function describeCampaignFinaleJourney(registry, state, summary) {
    const levels = registry?.getAllLevels?.() || [];
    return (summary?.chapters || []).map((chapter) => {
        const orbs = registry?.getLevelsInChapter?.(chapter.id)
            || levels.filter((level) => level.chapter === chapter.id);
        const presented = orbs.map((level) => registry?.resolveLevelPresentation?.(level.id) || level);
        const world = presented.find((level) => level.chapterBoss) || presented[presented.length - 1] || null;
        const stars = orbs.reduce((sum, level) => sum
            + Math.max(0, Math.min(3, Number(state?.getLevelStars?.(level.id)) || 0)), 0);
        return {
            ...chapter,
            themeId: odysseyLevelThemeId(world),
            orbs: orbs.length,
            stars,
            maxStars: orbs.length * 3,
        };
    });
}

/** null keeps the ordinary completion path; false means this exact attempt was cancelled. */
export async function showOdysseyCampaignFinale(mode, results, session) {
    if (!results.campaignCompleted || !canWriteLegacySimulationResults(session?.simulationClock)) return null;
    const summary = getOdysseyCampaignSummary(mode.levelRegistry, mode.odysseyState);
    if (!summary.complete) return null;
    const { retirementGeneration } = session;
    const isCurrent = () => mode._isLevelSessionCurrent(session, retirementGeneration);
    if (!isCurrent()) return false;
    mode._cleanupOdysseyHUD();
    mode._cleanupMinimap();
    mode.deps.inputController?.clearTimers?.();
    const journey = {
        ...summary,
        chapters: describeCampaignFinaleJourney(mode.levelRegistry, mode.odysseyState, summary),
    };
    while (isCurrent()) {
        // The existing result sheet is an optional detour, with the same untimed finale on return.
        // eslint-disable-next-line no-await-in-loop
        const choice = await new Promise((resolve) => {
            let release;
            const modal = createCampaignFinale({
                summary: journey,
                themeUnlock: results.themeUnlock,
                reducedMotion: prefersOdysseyReducedMotion(mode),
                gamepadController: mode.deps.gamepadController || null,
                onChoose: (selected) => { release?.(); resolve(selected); },
            });
            release = mountOdysseyOutcome(modal, session, () => resolve(false));
        });
        if (!isCurrent() || choice === false) return false;
        if (choice !== 'details') {
            return choice === 'mastery' ? { focusLevelId: summary.nextMasteryLevelId } : 'map';
        }
        // eslint-disable-next-line no-await-in-loop
        const outcome = await mode._showDetailedLevelResults(results, session);
        if (outcome === false || !isCurrent()) return false;
    }
    return false;
}
