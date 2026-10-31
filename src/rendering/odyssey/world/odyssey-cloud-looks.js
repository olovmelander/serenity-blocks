/**
 * ACT II CLOUD LOOKS — owner-choice variants of the sculpted cloud field (2026-10-31).
 *
 * Olov, after the Act II passes: the clouds were the weakest thing left on screen. In every frame
 * of chapters 3-5 they read as same-sized cotton balls spread evenly, each lit almost the same all
 * round, so they sat on the sky like stickers. The field is tuned against the owner's Witness
 * frames (docs/ODYSSEY_ACT2_CLOUD_FIELD_PLAN_2026-08.md §1b), so a change to the sky's character is
 * the owner's call: these looks are put side by side and one is chosen.
 *
 *   - `today`   the field as it shipped before these looks (one lever away for an A/B).
 *   - `light`   the same masses, new paint: a wrap that lets each mass turn from the sun, shade
 *               sides in the sky's own blue, whiter crowns, and edges that thin into a soft glow
 *               instead of the drawn outline.
 *   - `banks`   the `light` paint over a new layout: the satellites gather into banks, the
 *               middle distance and the horizon row grow, so the sky has a few big shapes and
 *               lanes of open blue instead of an even sprinkle; the summit's two banner masses
 *               give way to the plume that flows off the tip (odyssey-summit-spindrift.js).
 *
 * Pure data and pure functions (no three.js): the board hands the chosen layout's specs to the
 * bake worker and to `createOdysseyWorld`, and a test can read both.
 * Lever: `?odysseyCloudLook=today|light|banks`; with none, ODYSSEY_CLOUD_LOOK_DEFAULT.
 */
import { ODYSSEY_CLOUD_FIELD_SPECS } from './odyssey-cloud-field-specs.js';
import { showerCloudSpecs } from './odyssey-shower.js';

/**
 * The paint knobs a look sets. `null` keeps the shipped paint exactly (every constant in the
 * field material as it was), so `today` is the same shader text as before this module.
 *
 * - `wrap`        the wrap-diffuse width ((N·L + w) / (1 + w)); smaller turns more of a mass away
 *                 from the sun, so its shaded flank shows.
 * - `band`        the two edges of the lit/shade step on the wrapped term.
 * - `shadeSky`    how far the shade tone leans to the sky colour behind the cloud (the hue shift
 *                 the references show), against the shipped violet-grey under tone.
 * - `shadeLift`   the shade tone's brightness against the lit white (the references' 0.74-0.92).
 * - `crownWhite`  how far lit crowns lean to pure cloud white (shipped 0.38).
 * - `edgeDark`    the drawn edge on the shade side (shipped 1: the outline; 0 removes it).
 * - `rim`         the soft rim: where it starts on the rim term, its strength, and how much
 *                 white its glow keeps.
 * - `litGain`     a lift on the sunlit side only (the references' lit tops sit at luma ~245, ours
 *                 at ~220 after the grade), so the form spans shade to white as theirs does.
 * - `haze`        the share of the field's aerial haze a look keeps (1 = shipped): far clouds
 *                 stay clouds instead of fading into the sky's colour.
 *
 * MEASURED, 2026-10-31 (cloudlum: sky = clearly blue pixels, cloud = bright low-saturation ones,
 * in the upper frame): the owner's Witness frames put the cloud at 1.54-1.76x the sky with its own
 * luma spread p10/p90 171-180 / 241-247; the shipped field sat at 1.22x (ch3-4, where the sky is
 * pale) to 1.47x (ch5) with a spread of only 190-199 / 216-229. The gap is FORM inside the cloud,
 * not its outline: these knobs widen that spread on both sides.
 */
export const ODYSSEY_CLOUD_LOOKS = Object.freeze({
    today: Object.freeze({ id: 'today', paint: null, layout: 'shipped' }),
    light: Object.freeze({
        id: 'light',
        paint: Object.freeze({
            wrap: 0.30,
            band: Object.freeze([0.28, 0.62]),
            shadeSky: 0.50,
            shadeLift: 0.72,
            crownWhite: 0.85,
            edgeDark: 0,
            rim: Object.freeze({ from: 0.62, strength: 0.55, white: 0.62 }),
            litGain: 1.14,
            haze: 0.70,
            // The Witness paint (see the field material): one body in two soft tones, from how
            // high a fragment sits in its mass, how it turns to the sun, how far it faces down
            // and how deep in a fold it lies; slate shade from the sky over the face; a silver
            // sunward edge.
            style: 'witness',
            witness: Object.freeze({
                height: 0.62,
                lobe: 0.22,
                sun: 0.50,
                under: 0.42,
                fold: 0.38,
                bias: 0.0,
                tone: Object.freeze([0.36, 0.68]),
                shadeLift: 0.80,
                shadeSky: 0.45,
                litGain: 1.10,
                silver: 0.40,
                melt: Object.freeze([0.90, 0.45]),
            }),
        }),
        layout: 'shipped',
    }),
    banks: Object.freeze({ id: 'banks', paint: null, layout: 'banks' }),
});

/**
 * The look the game wears when the URL names none (2026-10-31): `banks`, the Witness paint over
 * the gathered layout, chosen from the three side by side across chapters 3-5 (docs/
 * ODYSSEY_CLOUDS_LOOKS_2026-10.md). `today` stays one lever away for an A/B.
 */
export const ODYSSEY_CLOUD_LOOK_DEFAULT = 'banks';

/** The `banks` look paints as `light`; only the layout differs. */
const BANKS_PAINT = ODYSSEY_CLOUD_LOOKS.light.paint;

/**
 * @param {string|null|undefined} name
 * @returns {{id: string, paint: object|null, layout: string}}
 */
export function resolveCloudLook(name) {
    const key = typeof name === 'string' ? name.trim().toLowerCase() : '';
    const look = ODYSSEY_CLOUD_LOOKS[key] || ODYSSEY_CLOUD_LOOKS[ODYSSEY_CLOUD_LOOK_DEFAULT];
    if (look.id === 'banks') return { ...look, paint: BANKS_PAINT };
    return look;
}

/**
 * How each role grows in the `banks` layout: [width, height]. The satellites also gather toward
 * their cluster's centre (`SATELLITE_GATHER` of the way), so four puffs become one bank with four
 * tops.
 */
const BANKS_GROWTH = Object.freeze({
    satellite: Object.freeze([1.40, 1.32]),
    overhead: Object.freeze([1.22, 1.18]),
    strata: Object.freeze([1.42, 1.32]),
    framing: Object.freeze([1.12, 1.10]),
});
const SATELLITE_GATHER = 0.45;
/** The masses in the sky opposite the sun that the shower's rain cloud replaces. */
const SHOWER_REPLACES = Object.freeze(['A09', 'A10', 'A11', 'O04']);
/**
 * A gathered cluster swallows its smallest member whole: its hull would only add hidden
 * triangles inside the bank. Dropping it pays for the LOD promotions the bigger masses earn
 * (`assignCloudFieldLod` promotes by angular size), so the field stays inside its 34k budget.
 */
const SATELLITE_DROP_SMALLEST_OF = 2;

/** The satellite clusters, by the id ranges the spec table authors them in. */
const SATELLITE_CLUSTERS = Object.freeze([
    Object.freeze(['A01', 'A02', 'A03', 'A04']),
    Object.freeze(['A05', 'A06', 'A07', 'A08']),
    Object.freeze(['A09', 'A10', 'A11', 'A12']),
    Object.freeze(['A13', 'A14']),
]);

/**
 * The widest a mass may grow and still be drawn at the detail it already has: the field promotes
 * a mass to `near` once it subtends more than 0.35 rad at its closest approach to the rail
 * (`assignCloudFieldLod` in odyssey-cloud-field.js, same distance and threshold). A grown horizon
 * cloud is held just under that, so growth never spends the near tier's triangles on a mass that
 * stays small on screen. Satellites are not held: their promotion to `mid` is what keeps a
 * gathered bank's outline round.
 */
const NEAR_SUBTENDED = 0.35;
function widthBeforeNear(spec, railSamples) {
    if (!railSamples || spec.lod === 'near') return Infinity;
    let nearest = Infinity;
    railSamples.forEach((pt) => {
        const d = Math.hypot(spec.x - pt.x, spec.base - pt.y, spec.z - pt.z);
        if (d < nearest) nearest = d;
    });
    if (!Number.isFinite(nearest)) return Infinity;
    // Already promoted by the rail at its shipped width: growing it costs nothing more.
    if (spec.w / nearest > NEAR_SUBTENDED) return Infinity;
    return Math.floor((NEAR_SUBTENDED * nearest) - 1);
}

function bankSpecs(specs, railSamples) {
    const byId = new Map(specs.map((s) => [s.id, s]));
    const centreOf = new Map();
    const dropped = new Set();
    SATELLITE_CLUSTERS.forEach((ids) => {
        const members = ids.map((id) => byId.get(id)).filter(Boolean);
        if (!members.length) return;
        const cx = members.reduce((a, s) => a + s.x, 0) / members.length;
        const cz = members.reduce((a, s) => a + s.z, 0) / members.length;
        members.forEach((s) => centreOf.set(s.id, { x: cx, z: cz }));
        if (members.length >= SATELLITE_DROP_SMALLEST_OF) {
            dropped.add(members.reduce((a, s) => (s.w < a.w ? s : a)).id);
        }
    });
    // The banner masses go: the summit's banner is now the spindrift module's plume, flowing off
    // the tip (round three), and two sculpted clouds parked in its lee read as clouds beside it.
    // The sky opposite the sun is the shower's (odyssey-shower.js): its storm masses take the place
    // of the bank and the middle-distance mass that stood there, inside the same triangle budget.
    const grown = specs.filter((s) => !dropped.has(s.id) && s.role !== 'banner' && !SHOWER_REPLACES.includes(s.id)).map((s) => {
        const centre = centreOf.get(s.id);
        if (centre) {
            const [gw, gh] = BANKS_GROWTH.satellite;
            return Object.freeze({
                ...s,
                x: Math.round(s.x + ((centre.x - s.x) * SATELLITE_GATHER)),
                z: Math.round(s.z + ((centre.z - s.z) * SATELLITE_GATHER)),
                w: Math.round(s.w * gw),
                h: Math.round(s.h * gh),
            });
        }
        if (s.role === 'banner' || /^Z\d/.test(s.id)) return s;
        const growth = BANKS_GROWTH[s.role];
        if (!growth) return s;
        const [gw, gh] = growth;
        const w = Math.min(Math.round(s.w * gw), Math.max(s.w, widthBeforeNear(s, railSamples)));
        // Height follows the width actually granted, so a held mass keeps its proportions.
        const granted = (w / s.w - 1) / (gw - 1);
        return Object.freeze({ ...s, w, h: Math.round(s.h * (1 + ((gh - 1) * granted))) });
    });
    return [...grown, ...showerCloudSpecs()];
}

/**
 * The cloud-field specs a look draws.
 * @param {{layout: string}} look from {@link resolveCloudLook}
 * @param {ReadonlyArray<object>} [specs] the shipped table (tests pass their own)
 * @param {ReadonlyArray<{x:number,y:number,z:number}>|null} [railSamples] the rail the field is
 *   built against (the same samples the bake gets), so grown masses keep their detail tier
 * @returns {ReadonlyArray<object>}
 */
export function cloudFieldSpecsForLook(look, specs = ODYSSEY_CLOUD_FIELD_SPECS, railSamples = null) {
    if (look?.layout === 'banks') return Object.freeze(bankSpecs(specs, railSamples));
    return specs;
}
