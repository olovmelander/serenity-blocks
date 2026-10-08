import { createCampaignFinale } from './CampaignFinale.js';
import { mountOdysseyOutcome } from './odyssey-outcome-owner.js';
import { getOdysseyCampaignSummary } from '../../core/odyssey/odyssey-campaign-summary.js';
import { canWriteLegacySimulationResults } from '../../core/game-modes/single-player-result-compatibility.js';
import { prefersOdysseyReducedMotion } from '../../core/game-modes/odyssey-physics-callbacks.js';

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
    while (isCurrent()) {
        // The existing result sheet is an optional detour, with the same untimed finale on return.
        // eslint-disable-next-line no-await-in-loop
        const choice = await new Promise((resolve) => {
            let release;
            const modal = createCampaignFinale({
                summary,
                themeUnlock: results.themeUnlock,
                reducedMotion: prefersOdysseyReducedMotion(mode),
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
