/**
 * THE BROADLEAF GREENS (Act II leftovers, 2026-11-02) — per-tree hue and value for the lowland
 * broadleaf, the green most of the chapter 3-4 canopy wears.
 *
 * Round three (docs/ODYSSEY_ACT2_ROUND_THREE_2026-10.md §2) gave the shore broadleaf one ramp,
 * lime to a deeper blue-green, skewed to lime. From the rail the canopy still read as one lime:
 * most trees sit near the lime end, and every one of them has the same warmth. The palette is the
 * owner's call, so three are offered, chosen by `?odysseyForestGreens=`:
 *
 *   - `mosaic` (the default, recommended): lime still the majority, a share of cool blue-greens,
 *     a share of warm olive, and a wider spread of value, so neighbouring crowns separate the way
 *     a mixed broadleaf wood does from above. Its mean stays near the old one.
 *   - `today`: the round-three ramp exactly (the scatter's own colour), one lever away.
 *   - `deep`: a darker, cooler wood: deep greens and blue-greens, lime only as an accent.
 *
 * Applied where the forest's instances are filled (the renderer), so the scatter, its golden
 * bytes and the bake worker are untouched. The shade colour follows from the crown by the
 * forest's own shade law (`shadeColourFor`). Only the green broadleaf changes: the blossom,
 * maple and birch keep their own colours, and the conifers theirs.
 *
 * Pure data and functions (no three.js), so tests and the sheet harness can read them.
 */

/** The species the greens apply to. */
export const FOREST_GREENS_SPECIES = Object.freeze(['S1-shore-broadleaf']);

/**
 * Each palette: three poles (a tree lands between them by two hashes of where it stands), how
 * far toward the second and third poles a tree can go and how skewed (a higher skew keeps more
 * trees near the first pole), and the per-tree value spread (±).
 */
export const ODYSSEY_FOREST_GREENS = Object.freeze({
    mosaic: Object.freeze({
        id: 'mosaic',
        poles: Object.freeze([
            Object.freeze([0.172, 0.268, 0.078]), // sunny lime (the species' own)
            Object.freeze([0.088, 0.206, 0.100]), // cool blue-green
            Object.freeze([0.205, 0.240, 0.066]), // warm olive
        ]),
        reach: Object.freeze([0.95, 0.85]),
        skew: Object.freeze([1.5, 2.2]),
        value: 0.18,
    }),
    today: Object.freeze({ id: 'today', poles: null }),
    deep: Object.freeze({
        id: 'deep',
        poles: Object.freeze([
            Object.freeze([0.112, 0.218, 0.072]), // deep summer green
            Object.freeze([0.068, 0.176, 0.094]), // dark blue-green
            Object.freeze([0.165, 0.258, 0.075]), // lime, an accent
        ]),
        reach: Object.freeze([0.9, 0.9]),
        skew: Object.freeze([1.2, 3.0]),
        value: 0.20,
    }),
});

export const ODYSSEY_FOREST_GREENS_DEFAULT = 'mosaic';

/**
 * @param {string|null|undefined} name
 * @returns {string} a palette id; unknown or empty names give the default
 */
export function resolveForestGreens(name) {
    const key = typeof name === 'string' ? name.trim().toLowerCase() : '';
    return ODYSSEY_FOREST_GREENS[key] ? key : ODYSSEY_FOREST_GREENS_DEFAULT;
}

/** A stable 0..1 hash of a world position and a salt. */
function hashAt(x, z, salt) {
    const v = Math.sin((x * 12.9898) + (z * 78.233) + (salt * 37.719)) * 43758.5453;
    return v - Math.floor(v);
}

/**
 * The crown colour a tree wears under a palette, or null to keep the scatter's own.
 * @param {{x: number, z: number, speciesId: string}} tree a forest placement
 * @param {string} paletteId from {@link resolveForestGreens}
 * @returns {number[]|null}
 */
export function forestGreensCrown(tree, paletteId) {
    const palette = ODYSSEY_FOREST_GREENS[paletteId];
    if (!palette?.poles || !FOREST_GREENS_SPECIES.includes(tree.speciesId)) return null;
    const [a, b, c] = palette.poles;
    const tb = (hashAt(tree.x, tree.z, 1) ** palette.skew[0]) * palette.reach[0];
    const tc = (hashAt(tree.x, tree.z, 2) ** palette.skew[1]) * palette.reach[1];
    const value = 1 + ((hashAt(tree.x, tree.z, 3) - 0.5) * 2 * palette.value);
    return a.map((ch, k) => {
        const toB = ch + ((b[k] - ch) * tb);
        return Math.max(0, (toB + ((c[k] - toB) * tc)) * value);
    });
}
