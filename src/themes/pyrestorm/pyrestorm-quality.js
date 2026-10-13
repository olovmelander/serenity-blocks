/**
 * Pyrestorm — the six content tiers. Every tier keeps the whole picture and every event; tiers
 * cut counts and detail terms, never a feature or a beat.
 *
 *   fanCols × fanRows    the land around the eye (a polar fan: fine near, coarse far)
 *   coneRings × coneSegs the volcano's own mesh
 *   plumeSteps           march steps through the eruption column (a volume)
 *   eventPuffs           puffs for the vortex ring, the surge and the shock's condensation
 *   jets / fissureJets   the crater's fountain and the fissure's curtain (incandescent spatter)
 *   bombs                event bombs, sparks and splashes (a ring buffer)
 *   motes                embers and ash at the eye
 *   bolts                lightning strands (a bolt is a channel and its branches)
 *   anvilDetail          noise octaves of the anvil's underside (2 = with mammatus lobes)
 *   landDetail           the land's fine noise (2 = with the crust's glints)
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        fanCols: 150,
        fanRows: 130,
        coneRings: 90,
        coneSegs: 200,
        plumeSteps: 12,
        eventPuffs: 100,
        jets: 500,
        fissureJets: 300,
        bombs: 256,
        motes: 160,
        bolts: 24,
        anvilDetail: 1,
        landDetail: 1,
    }),
    Low: Object.freeze({
        fanCols: 190,
        fanRows: 160,
        coneRings: 120,
        coneSegs: 260,
        plumeSteps: 16,
        eventPuffs: 120,
        jets: 800,
        fissureJets: 500,
        bombs: 384,
        motes: 260,
        bolts: 32,
        anvilDetail: 1,
        landDetail: 1,
    }),
    Medium: Object.freeze({
        fanCols: 240,
        fanRows: 200,
        coneRings: 150,
        coneSegs: 340,
        plumeSteps: 22,
        eventPuffs: 140,
        jets: 1300,
        fissureJets: 800,
        bombs: 512,
        motes: 420,
        bolts: 40,
        anvilDetail: 2,
        landDetail: 2,
    }),
    High: Object.freeze({
        fanCols: 300,
        fanRows: 250,
        coneRings: 190,
        coneSegs: 420,
        plumeSteps: 28,
        eventPuffs: 168,
        jets: 2000,
        fissureJets: 1200,
        bombs: 768,
        motes: 640,
        bolts: 48,
        anvilDetail: 2,
        landDetail: 2,
    }),
    Ultra: Object.freeze({
        fanCols: 360,
        fanRows: 300,
        coneRings: 230,
        coneSegs: 512,
        plumeSteps: 34,
        eventPuffs: 198,
        jets: 2800,
        fissureJets: 1700,
        bombs: 1024,
        motes: 900,
        bolts: 48,
        anvilDetail: 2,
        landDetail: 2,
    }),
    Extreme: Object.freeze({
        fanCols: 420,
        fanRows: 340,
        coneRings: 260,
        coneSegs: 600,
        plumeSteps: 40,
        eventPuffs: 232,
        jets: 3600,
        fissureJets: 2200,
        bombs: 1280,
        motes: 1200,
        bolts: 48,
        anvilDetail: 2,
        landDetail: 2,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(q) {
    return QUALITY[q] || QUALITY.High;
}
