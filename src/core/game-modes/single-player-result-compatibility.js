import { DEMO_LEGACY_SIMULATION_CLOCK } from '../demo/DemoRecorder.js';

/**
 * The current local score table, Steam leaderboards, and aggregate Steam stats
 * have no simulation-clock dimension. Only legacy-clock sessions are eligible
 * until plan §5.8 gives those sinks an explicit rules/simulation version.
 * Unknown future clocks fail closed instead of contaminating legacy results.
 *
 * @param {unknown} simulationClock
 * @returns {boolean}
 */
export function canWriteLegacySimulationResults(simulationClock) {
    return simulationClock === DEMO_LEGACY_SIMULATION_CLOCK;
}

/**
 * Backward-compatible single-player name retained for existing consumers.
 * @param {unknown} simulationClock
 * @returns {boolean}
 */
export function canWriteLegacySinglePlayerResults(simulationClock) {
    return canWriteLegacySimulationResults(simulationClock);
}
