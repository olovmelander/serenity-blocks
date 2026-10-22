import { DEMO_LEGACY_SIMULATION_CLOCK } from '../demo/DemoRecorder.js';
import { canWriteLegacySimulationResults } from './single-player-result-compatibility.js';
import { getOdysseyCampaignSummary } from '../odyssey/odyssey-campaign-summary.js';
import { odysseyCharmsUsed } from '../odyssey/odyssey-charm-use.js';

/**
 * An orb's end that throws (the save, the campaign summary, the results sheet) must not leave
 * the attempt retired under a frozen well with no sheet: it is logged and the journey goes
 * back to the map.
 */
export async function settleOdysseyLevelEnd(mode, ending) {
    try {
        return await ending;
    } catch (error) {
        console.error('[Odyssey] Ending the orb failed:', error);
        try {
            await mode.returnToBoard();
        } catch (returnError) {
            console.error('[Odyssey] Returning to the map failed:', returnError);
        }
        return undefined;
    }
}

/**
 * A Finish pressed mid-cascade waits for the cascade, then finishes. Retiring the attempt
 * fences its callbacks, so the cascade's waves added their score but not their cascades or
 * depth, and an orb's third star can need them.
 * @returns {boolean} whether the finish was put off
 */
export function deferFinishPastCascade(mode, session) {
    const { gameState } = session;
    if (!gameState.isProcessingPhysics || !gameState.latestPhysicsPromise) return false;
    if (!session.finishAfterCascade) {
        session.finishAfterCascade = Promise.resolve(gameState.latestPhysicsPromise)
            .catch(() => {})
            .then(() => {
                session.finishAfterCascade = null;
                mode._finishVictoryLap();
            });
    }
    return true;
}

/** Save one retired attempt before choosing the next step of the journey. */
export async function completeOdysseyLevel(mode, results) {
    // Prevent multiple completions
    const session = mode._activeLevelSession;
    if (mode.levelCompleting || !mode._isLevelSessionActive(session)) return;
    mode.levelCompleting = true;
    if (session.simulationClock === DEMO_LEGACY_SIMULATION_CLOCK && mode.levelStartTime) {
        session.hybridEngine.updateTime(mode._elapsedLevelMs() / 1000);
    }
    const { retirementGeneration } = mode._retireLevelSession(session);
    const { gameState, hybridEngine, levelId } = session;
    const writesLegacyResults = canWriteLegacySimulationResults(session.simulationClock);

    console.log(`[Odyssey] Level ${levelId} completed!`, results);
    // The well answers the goal while the attempt drains and saves beneath it. It is cosmetic:
    // a failure here can never block or delay the save.
    const flourish = new Promise((resolve) => { resolve(mode._celebrateGoalReached?.(session)); })
        .catch(() => {});
    await mode._drainLevelSession(session);
    if (!mode._isLevelSessionCurrent(session, retirementGeneration)) return;

    // Calculate final metrics
    hybridEngine?.updateScore(session.duel?.score ?? (gameState.score || 0));
    const metrics = hybridEngine?.getMetrics() || {};
    const finalResults = {
        score: session.duel?.score ?? gameState.score,
        time: metrics.time,
        lines: metrics.lines,
        cascades: metrics.cascades,
        maxCascadeDepth: metrics.maxCascadeDepth,
        combo: metrics.maxCombo,
        tetrises: metrics.tetrises,
        ...(session.duel ? { duel: session.duel.getResult() } : {}),
        ...results,
    };

    // Calculate stars
    const stars = mode._calculateStars(finalResults, hybridEngine);
    finalResults.stars = stars;
    // The charms this attempt used: a fact on the results sheet, and the time board's exclusion.
    finalResults.charms = odysseyCharmsUsed(session);

    // Evaluate bonuses
    const bonuses = mode._evaluateBonuses(finalResults, hybridEngine);
    finalResults.bonuses = bonuses;

    if (writesLegacyResults) {
        // The campaign save and Steam boards do not yet carry a simulation
        // version. Unknown clocks fail closed alongside fixed60-v1.
        const wasComplete = getOdysseyCampaignSummary(mode.levelRegistry, mode.odysseyState).complete;
        const completion = mode.odysseyState.completeLevel(levelId, finalResults, {
            themeId: session.levelConfig?.theme?.primary,
        });
        // What the clear left in the bag, for the ceremony; the journey's first charm says how to use it.
        finalResults.charmsFound = completion?.charmsFound?.slice() || [];
        finalResults.charmsFirstFound = finalResults.charmsFound.length > 0
            && mode.odysseyState.getCharmStats?.().found === finalResults.charmsFound.length;
        // Ownership is durable before any outcome view can celebrate it. The
        // exact attempt's authored theme stays authoritative through prefetch.
        const collection = mode.deps?.themeCollection;
        if (completion?.persisted === false && collection) {
            finalResults.themeUnlock = { persisted: false, failure: 'progress' };
        }
        if (completion?.persisted === true && collection) {
            try {
                const receipt = collection.awardCompletion({
                    levelId,
                    themeId: session.levelConfig?.theme?.primary,
                    odysseyState: mode.odysseyState,
                    progressPersisted: true,
                });
                if (receipt?.persisted === true && receipt.themeIds?.length) finalResults.themeUnlock = receipt;
                else if (receipt?.persisted === false) {
                    finalResults.themeUnlock = { persisted: false, failure: 'collection' };
                }
            } catch (error) {
                // Saved orb progress allows the collection to reconcile later.
                console.warn('[Odyssey] Theme collection could not be saved:', error);
                finalResults.themeUnlock = { persisted: false, failure: 'collection' };
            }
        }
        // A finished chapter opens a breathing world and the Hale session that features it. Only
        // what this save opened is announced; a replayed orb opens nothing new.
        const breath = mode.deps?.breathCollection;
        if (completion?.persisted === true && breath) {
            try {
                const opened = breath.reconcile({ source: 'odyssey' });
                if (opened?.worlds?.length || opened?.sessions?.length) finalResults.breathUnlock = opened;
            } catch (error) {
                console.warn('[Odyssey] Breathing worlds could not be updated:', error);
            }
        }
        finalResults.campaignCompleted = !wasComplete
            && getOdysseyCampaignSummary(mode.levelRegistry, mode.odysseyState).complete;
        mode._syncSteamStats(finalResults, session).catch((err) => {
            console.warn('[Odyssey] Steam stats sync failed:', err.message);
        });
    }

    // The ceremony arrives through the showpiece's afterglow when the well played one.
    if (await flourish === true) finalResults.showpiece = true;
    if (!mode._isLevelSessionCurrent(session, retirementGeneration)) return;

    // Show results
    const choice = await mode._showLevelResults({
        ...finalResults,
        ...(!writesLegacyResults ? {
            simulationClock: session.simulationClock,
            unranked: true,
        } : {}),
    }, session);
    if (!mode._isLevelSessionCurrent(session, retirementGeneration)) return;

    const nextLevel = mode._getJourneyFlowDestination(session);
    if (choice === 'next' && nextLevel) await mode._continueJourney(nextLevel);
    else await mode.returnToBoard({ focusLevelId: choice?.focusLevelId ?? nextLevel?.id });
}
