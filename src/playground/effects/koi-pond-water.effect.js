/**
 * Playground wrapper for the production Koi Pond black-jade water.
 *
 *   ?effect=koi-pond-water&quality=High&orbit=0&t=12
 *   ?effect=koi-pond-water&quality=High&reflection=1&orbit=0&t=12
 *   ?effect=koi-pond-water&quality=Low&orbit=0&t=12
 *   ?effect=koi-pond-water&quality=High&orbit=0&t=12&forceWebGL=1
 */
import { createKoiPondWater } from '../../themes/koi-pond/rendering/koi-pond-water.js';

export const meta = {
    id: 'koi-pond-water',
    title: 'Koi Pond v2 — Black-Jade Water',
    description: 'Black-jade refraction, projected caustics, submerged koi, and selective planar reflection.',
};

export function create(context) {
    return createKoiPondWater(context);
}
