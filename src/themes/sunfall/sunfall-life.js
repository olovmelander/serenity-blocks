/**
 * Sunfall — the moving parts of the world, each in its part's group:
 * - `roots`: strands either side of the card and the young leaves of locks (sunfall-strands.js);
 * - `water`: the shower's rain, the cataract and its spray with the one bow, the flood threads
 *   (sunfall-water.js);
 * - `beam`: dust in the sunfall; `birds`: swiftlets; `mist`: the Exhale cloud (sunfall-air-life.js).
 */
import { buildStrands } from './sunfall-strands.js';
import { buildWater } from './sunfall-water.js';
import { buildAirLife } from './sunfall-air-life.js';

export function buildSunfallLife(world) {
    const strands = buildStrands(world, {
        strands: world.plan.curtains,
        leafSlots: world.preset.leafSlots ?? 256,
    });
    world.partGroups.get('roots').add(strands.group);
    const water = buildWater(world);
    world.partGroups.get('water').add(water.group);
    const air = buildAirLife(world);
    world.partGroups.get('beam').add(air.beam);
    world.partGroups.get('birds').add(air.birds);
    world.partGroups.get('mist').add(air.mist);
    const parts = [strands, water, air];
    return {
        sprayCentre: water.sprayCentre,
        strands,
        water,
        air,
        update(snap) {
            parts.forEach((p) => p.update?.(snap));
        },
        dispose() {
            parts.forEach((p) => p.dispose?.());
        },
    };
}
