/**
 * Sunfall — the moving parts of the world, each in its part's group:
 * - `roots`: strands either side of the card and the young leaves of locks (sunfall-strands.js);
 * - `water`: the shower's rain, the cataract and its spray with the one bow, the flood threads
 *   (sunfall-water.js);
 * - `beam`: dust in the sunfall; `birds`: swiftlets; `mist`: the Exhale cloud (sunfall-air-life.js).
 */
import { SUNFALL_LAYOUT, mulberry32 } from './sunfall-core.js';
import { buildStrands } from './sunfall-strands.js';
import { buildWater } from './sunfall-water.js';
import { buildAirLife } from './sunfall-air-life.js';

export function buildSunfallLife(world) {
    const strands = buildStrands(world, {
        strands: world.plan.curtains,
        leafSlots: world.preset.leafSlots ?? 256,
    });
    world.partGroups.get('roots').add(strands.group);
    // Lianas let down from the oculus rim into the shaft: the vine fringe, against the light.
    const rng = mulberry32(world.seed ^ 0x11a7);
    const rim = SUNFALL_LAYOUT.oculus;
    const lianas = Array.from({ length: 40 }, (_, i) => {
        const a = (i / 40) * Math.PI * 2 + (rng() - 0.5) * 0.14;
        const k = 0.97 + rng() * 0.12;
        return {
            x: rim.center[0] + Math.cos(a) * rim.radii[0] * k,
            z: rim.center[1] + Math.sin(a) * rim.radii[1] * k,
            topY: rim.underside + 4 + rng() * 10,
            length: 14 + rng() * rng() * 70,
            swayPhase: rng() * Math.PI * 2,
            side: 0,
        };
    });
    const rimLianas = buildStrands(world, {
        strands: lianas, leaves: false, width: [0.25, 0.8], name: 'sunfall-rim-lianas',
    });
    world.partGroups.get('roots').add(rimLianas.group);
    const water = buildWater(world);
    world.partGroups.get('water').add(water.group);
    const air = buildAirLife(world);
    world.partGroups.get('beam').add(air.beam);
    world.partGroups.get('birds').add(air.birds);
    world.partGroups.get('mist').add(air.mist);
    const parts = [strands, rimLianas, water, air];
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
