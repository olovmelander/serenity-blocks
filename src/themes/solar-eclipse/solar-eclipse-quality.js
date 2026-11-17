/**
 * Solar Eclipse — content tiers. Every tier keeps the whole picture and every event: the corona,
 * the moon and its beads, every prominence the board raises, the ranges and the stars.
 *
 * rays        octaves of the corona's fine rays (1 or 2)
 * flow        the corona's slow outflow (puffs drifting out along the streamers)
 * fibres      the prominences' fine threads (their arches and sheets stay on every tier)
 * faces       the sunlit range's snowfields and couloirs, the volcano's gullies (else smooth)
 * mist        the valley mist's drifting banks (else an even layer)
 * stars       the faint stars a long exposure brings out (the planets are on every tier)
 * motes       motes in the air at once (a lock's flight to the limb)
 * swell       the mirror's long swell and the wind's patches (else glass; the gameplay's rings
 *             and whirls are on every tier)
 * salt        the salt crust's polygons near the lens (else an unbroken mirror)
 * clouds      the rows of bars low over the far shore
 * towers      the sunlit towers beyond the shadow (the weather's)
 * deck        the altocumulus deck, dark overhead, burning past the shadow's edge
 * lenticular  the cap over the volcano
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        rays: 1,
        flow: false,
        fibres: false,
        faces: false,
        mist: false,
        stars: false,
        motes: 8,
        swell: false,
        salt: false,
        clouds: false,
        towers: false,
        deck: false,
        lenticular: false,
    }),
    Low: Object.freeze({
        rays: 1,
        flow: false,
        fibres: true,
        faces: false,
        mist: false,
        stars: true,
        motes: 10,
        swell: true,
        salt: false,
        clouds: false,
        towers: true,
        deck: false,
        lenticular: true,
    }),
    Medium: Object.freeze({
        rays: 2,
        flow: true,
        fibres: true,
        faces: true,
        mist: false,
        stars: true,
        motes: 12,
        swell: true,
        salt: true,
        clouds: true,
        towers: true,
        deck: true,
        lenticular: true,
    }),
    High: Object.freeze({
        rays: 2,
        flow: true,
        fibres: true,
        faces: true,
        mist: true,
        stars: true,
        motes: 14,
        swell: true,
        salt: true,
        clouds: true,
        towers: true,
        deck: true,
        lenticular: true,
    }),
    Ultra: Object.freeze({
        rays: 2,
        flow: true,
        fibres: true,
        faces: true,
        mist: true,
        stars: true,
        motes: 16,
        swell: true,
        salt: true,
        clouds: true,
        towers: true,
        deck: true,
        lenticular: true,
    }),
    Extreme: Object.freeze({
        rays: 2,
        flow: true,
        fibres: true,
        faces: true,
        mist: true,
        stars: true,
        motes: 16,
        swell: true,
        salt: true,
        clouds: true,
        towers: true,
        deck: true,
        lenticular: true,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return Object.prototype.hasOwnProperty.call(QUALITY, quality) ? QUALITY[quality] : QUALITY.High;
}
