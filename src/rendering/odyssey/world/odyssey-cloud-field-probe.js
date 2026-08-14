/**
 * ACT II CLOUD FIELD — the WAVE 0 PRICE PROBE, and nothing more.
 *
 * See docs/ODYSSEY_ACT2_CLOUD_FIELD_PLAN_2026-08.md §5 Wave 0a. Its entire job is to answer
 * ONE question before a single line of the real sculptor exists: **what does a sky's worth of
 * opaque cloud geometry cost on Lane B?** The measured anchor is six masses / ~9k tris at
 * 0.066 ms (ch4) / 0.131 ms (ch5); the design bets ~28 masses / ~30-45k tris stays under
 * 0.50 ms at ch5. If that bet is wrong the whole plan changes shape, and it costs one session
 * to find out — so this probe deliberately reuses the RETIRED hero builder and the RETIRED
 * hero material verbatim. **Zero new shader code**, so what it prices is the mechanism
 * (triangles + rasterised silhouette + opaque draws), not a new paint stack.
 *
 * WHAT THIS IS NOT: it is not the composition, not the look, and not the silhouette grammar.
 * Wave 1 replaces every placement here with authored `odyssey-cloud-field-specs.js` roles and
 * smin-sculpted geometry. Nothing in this file should survive that wave; it exists so the wave
 * after it spends a MEASURED credit rather than an assumed one (ADR-0016).
 *
 * WHY THE PLACEMENTS STILL OBEY THE RULES. A price probe may be artistically meaningless but
 * it must not be geometrically absurd: a mass the camera ends up INSIDE fills the frame with
 * one white triangle and prices nothing (and `HERO_CLOUD_RULES.MIN_RAIL_DIST` exists precisely
 * because the heroes are opaque and have no near-fade). So the generator keeps every mass
 * inside the same clearance annulus the heroes used, and `validateHeroCloudPlacements` is run
 * over the result by the test.
 */
import { makeRng } from './odyssey-hero-clouds.js';
import { HERO_CLOUD_RULES } from './odyssey-hero-cloud-specs.js';

/** How many masses the probe places. ~4.7x the hero troupe, ~5x its triangles. */
export const PROBE_FIELD_COUNT = 28;

/**
 * Deterministically place a sky's worth of probe masses around the Act II rail.
 *
 * Placement is a golden-angle spiral around a moving anchor that walks the rail's ABOVE-WATER
 * stretch, so the masses spread across the whole act window instead of clustering where one
 * station happens to look. Radii sweep the legal annulus (MIN_RAIL_DIST..MAX_RAIL_DIST) so the
 * probe prices near masses (large on screen, silhouette-bound) and far ones (small, vertex-
 * bound) in the same pass — the two ends whose ratio the real field will have to balance.
 *
 * @param {ReadonlyArray<{x:number,y:number,z:number}>} railSamples the caller's sampled rail
 * @param {number} [count]
 * @returns {Array<{id:string,x:number,base:number,z:number,w:number,h:number,yaw:number,seed:number}>}
 */
export function buildProbeFieldSpecs(railSamples, count = PROBE_FIELD_COUNT) {
    const rail = (railSamples || []).filter((pt) => pt && Number.isFinite(pt.x));
    if (rail.length === 0) return [];
    // The sky stretch: the back half of the rail, where Act II's cameras actually look up.
    // Sampling the whole path would anchor masses over the submerged opening, where the deck
    // is CPU-gated off and nothing would be measured.
    const sky = rail.slice(Math.floor(rail.length * 0.45));
    const rnd = makeRng(4211.7);
    const specs = [];
    // Golden angle: successive masses land on maximally-different bearings, so no two sit in
    // line and the screen coverage at any one station is representative rather than lucky.
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    const { MIN_RAIL_DIST, MAX_RAIL_DIST, MIN_LOBE_Y } = HERO_CLOUD_RULES;
    for (let i = 0; i < count; i += 1) {
        const anchor = sky[Math.floor((i / count) * (sky.length - 1))];
        const bearing = i * GOLDEN;
        // Keep a real margin off both rule edges — the validator is an assertion, not a target.
        const t = (i % 7) / 6;
        const radius = (MIN_RAIL_DIST * 1.25) + (t * (MAX_RAIL_DIST * 0.85 - MIN_RAIL_DIST * 1.25));
        // Far masses are bigger, so they subtend a comparable angle and the probe does not
        // silently become "27 specks and one hero".
        const w = 340 + (radius * 0.24) + (rnd() * 160);
        // ⚠️ CLEARANCE IS AGAINST THE WHOLE RAIL, NOT THE ANCHOR. The path curves back on
        // itself through Act II, so a mass placed a legal radius from ITS anchor can sit far
        // inside the annulus of a different rail point — the first cut of this generator put
        // two masses at 432 u and 578 u against a 600 u rule and the test caught it. Push the
        // candidate directly away from its NEAREST rail point until it clears with margin;
        // bounded iterations so a pathological seed cannot spin.
        let px = anchor.x + (Math.cos(bearing) * radius);
        let pz = anchor.z + (Math.sin(bearing) * radius);
        for (let guard = 0; guard < 24; guard += 1) {
            let near = rail[0];
            let nearD = Infinity;
            rail.forEach((pt) => {
                const d = Math.hypot(px - pt.x, pz - pt.z);
                if (d < nearD) { nearD = d; near = pt; }
            });
            if (nearD >= MIN_RAIL_DIST * 1.12) break;
            const ax = px - near.x;
            const az = pz - near.z;
            const len = Math.hypot(ax, az) || 1;
            const push = (MIN_RAIL_DIST * 1.12) - nearD;
            px += (ax / len) * push;
            pz += (az / len) * push;
        }
        specs.push({
            id: `P${String(i).padStart(2, '0')}`,
            x: px,
            z: pz,
            base: MIN_LOBE_Y + 20 + (rnd() * 150),
            w,
            h: w * (0.42 + (rnd() * 0.16)),
            yaw: rnd() * Math.PI * 2,
            seed: 13.7 + (i * 7.31),
        });
    }
    return specs;
}
