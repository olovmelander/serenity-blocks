/**
 * Who owns the Odyssey world between orbs. A leaf on purpose: the map input asks this at boot
 * (the gamepad controller imports it), and odyssey-world-return.js, which re-exports both, would
 * bring the whole return passage (portal gate, journey ending; ~50 KB) onto the menu's boot path.
 * tests/unit/boot-static-import-graph.test.js keeps it off.
 */

/** The retained world is scenery only while its exact campaign operation owns it. */
export function isOdysseyScenicJourney(mode) {
    const operation = mode._scenicJourneyOperation;
    return Boolean(operation && operation === mode._journeyFlowOperation
        && !operation.cancelled && !operation.mapRequested);
}

/** Shared UI ownership; chapter pauses keep their separate music and camera policy. */
export function isOdysseyWorldInterlude(mode) {
    const operation = mode._journeyFlowOperation;
    return isOdysseyScenicJourney(mode) || Boolean(mode._chapterFlowActive
        && operation && !operation.cancelled && !operation.mapRequested);
}
