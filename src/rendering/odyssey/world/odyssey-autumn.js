/**
 * AUTUMN ON THE MOUNTAIN — chapter 4's own palette (masterpiece pass, round two, 2026-11-17).
 *
 * The lead's review of the first round: chapter 4 had its own hour but still read as chapter 3's
 * day at a glance, "the same blue sky, white cloud and green forest with slightly warmer rock". A
 * chapter needs its own palette, not only its own light. Chapter 3 is spring and summer by the sea
 * (greens, pink blossom, turquoise); the mountains are AUTUMN: the broadleaf crowns in gold, amber
 * and russet with a few deep reds, the grass and heath tawny, the conifers left dark green against
 * them.
 *
 * WHERE. Two things make a point of the land autumn, and it takes the larger:
 *   - THE HIGH BAND, always there: above `band` (world y) the massif's meadows and broadleaves
 *     have turned, so from chapter 3's shore the mountain wears a far band of gold under its snow.
 *   - THE DAY'S TURN (odyssey-day-turn.js): the season turns with the day. As the cloud's shadow
 *     crosses the valley between the island's last orb and the mountains' first, the land behind
 *     it is in autumn as well as in the afternoon's light: the shade passes over a green morning
 *     and leaves a gold afternoon. Keyed to the turn's own field, so it stands still at a parked
 *     orb, is hidden inside the shade while it changes, and walks back the way it came.
 *
 * HOW. In the materials, not in the scatter: no tree moves, no species changes, the forest's shade
 * plate, its mask and the golden hashes are untouched. A tree carries one more thing per instance,
 * its KIND (evergreen, a crown that turns gold, a blossom that turns red), packed beside its snow;
 * the forest's fragment mixes its crown and shade toward an autumn crown picked along the palette
 * by the tree's own phase, each tree at its own threshold, so the band's edge is mottled trees and
 * never a line. The ground's grass goes tawny with patches of heath, and the far forest's painted
 * canopy follows.
 *
 * Pure data and pure TSL builders (every input is a node or a number). Lever on the board:
 * `?odysseyNoAutumn=1` (the world's `autumn` option), which builds none of it.
 */
import {
    clamp, float, floor, fract, max, mix, smoothstep, vec3,
} from 'three/tsl';

export const ODYSSEY_AUTUMN = Object.freeze({
    /** The high band's foot: none below `band[0]` (world y), all of it from `band[1]` up. The sea
     * stands at 287, the meadows the rail crosses at 293-310, the massif's foot at ~370. */
    band: Object.freeze([408, 486]),
    /** A crown is weighed at its tree's foot: this much of its height above ground is taken back
     * (world units at the top of a full-grown tree), so a tree turns whole and not from its top. */
    crownReach: 20,
    /**
     * THE CROWNS, along a tree's own pick 0..1 (linear colour, authored bright against the world's
     * grade as every palette here; `role` is the forest's value role for the crown's shade). A
     * last green-gold lingers on a few, most are gold and amber, fewer russet, a handful deep red.
     */
    crowns: Object.freeze([
        Object.freeze({ at: 0.00, colour: Object.freeze([0.360, 0.385, 0.085]), role: 'workhorse' }),
        Object.freeze({ at: 0.14, colour: Object.freeze([0.600, 0.460, 0.085]), role: 'pastel' }),
        Object.freeze({ at: 0.50, colour: Object.freeze([0.610, 0.330, 0.055]), role: 'pastel' }),
        Object.freeze({ at: 0.78, colour: Object.freeze([0.480, 0.185, 0.050]), role: 'workhorse' }),
        Object.freeze({ at: 0.93, colour: Object.freeze([0.410, 0.075, 0.040]), role: 'workhorse' }),
    ]),
    /** A blossom's pick is drawn from the palette's red end only (russet to deep red). */
    blossomFrom: 0.70,
    /** Each tree turns at its own threshold of the place's autumn: [earliest, latest], and how
     * soft its own turn is (so a tree is never caught half-and-half for long). */
    threshold: Object.freeze([0.22, 0.72]),
    soft: 0.16,
    /**
     * THE GRASS: tawny where it was green, heath (a russet plum) in patches `patch` world units
     * across, and the damp hollows keep some of their green (`damp`: the share of the turn the
     * wettest ground loses).
     */
    grass: Object.freeze({
        tawny: Object.freeze([0.470, 0.345, 0.078]),
        heath: Object.freeze([0.370, 0.150, 0.090]),
        patch: 44,
        heathEdge: Object.freeze([0.56, 0.70]),
        heathShare: 0.72,
        damp: 0.45,
    }),
    /** The far forest's painted canopy (beyond the trees' draw distance): its autumn mean, and how
     * much of the canopy takes it (the conifers in it stay green). */
    canopy: Object.freeze([0.520, 0.335, 0.070]),
    canopyShare: 0.62,
});

/** What a tree does in autumn. */
export const AUTUMN_KIND = Object.freeze({ evergreen: 0, gold: 1, red: 2 });

/**
 * A species' kind: the shore's broadleaf turns gold, the pink blossom turns red; the pines, firs
 * and cypresses are evergreen, and the gold birch and red maple already wear autumn.
 * @param {string} speciesId
 * @returns {number} an {@link AUTUMN_KIND}
 */
export function autumnKindOf(speciesId) {
    if (typeof speciesId !== 'string') return AUTUMN_KIND.evergreen;
    if (speciesId.startsWith('S1-')) return AUTUMN_KIND.gold;
    if (speciesId.startsWith('S7-')) return AUTUMN_KIND.red;
    return AUTUMN_KIND.evergreen;
}

/**
 * A tree's snow (0..1) and its kind in one float lane (the crown attribute's fourth: WebGPU allows
 * eight vertex buffers and the forest uses seven). Kind k sits at 2k + snow, so the snow keeps
 * its place for an evergreen (k 0) and a turning tree, which never carries snow, reads 2 or 4.
 */
export function packSnowKind(snow, kind) {
    const s = Math.min(Math.max(Number.isFinite(snow) ? snow : 0, 0), 1);
    return (2 * (kind | 0)) + s;
}
/** @returns {{snow:number, kind:number}} */
export function unpackSnowKind(packed) {
    const kind = Math.floor((packed * 0.5) + 0.25);
    return { snow: Math.min(Math.max(packed - (2 * kind), 0), 1), kind };
}

/** The same unpacking, as nodes. */
export function autumnKindNode(packed) {
    return floor(packed.mul(0.5).add(0.25));
}
export function autumnSnowNode(packed, kind) {
    return clamp(packed.sub(kind.mul(2)), 0, 1);
}

/**
 * How far a point of the land is in autumn (0..1): the high band, or the day's turn where that
 * has reached it, whichever is more.
 * @param {object} y       float node: world height of the point (a tree's foot, the ground)
 * @param {object} turned  float node 0..1: the turn's share at the point
 */
export function autumnWeight(y, turned, cfg = ODYSSEY_AUTUMN) {
    return max(smoothstep(float(cfg.band[0]), float(cfg.band[1]), y), turned);
}

/**
 * A tree's crown and shade in autumn.
 * @param {object} p
 * @param {object} p.crown   vec3 node: its own crown colour
 * @param {object} p.shade   vec3 node: its own shade colour
 * @param {object} p.weight  float node: {@link autumnWeight} at its foot
 * @param {object} p.kind    float node: its {@link AUTUMN_KIND}
 * @param {object} p.phase   float node: the tree's own constant (any range)
 * @param {ReadonlyArray<ReadonlyArray<number>>} p.shades  the palette's shade colours, one per
 *   crown stop (the forest's shade law, computed by the caller on the CPU)
 * @returns {{crown: object, shade: object, turned: object}}
 */
export function autumnCrown({
    crown, shade, weight, kind, phase, shades,
}, cfg = ODYSSEY_AUTUMN) {
    // Two draws from the tree's own constant: when it turns, and what it turns to.
    const when = fract(phase.mul(0.7548777).add(0.37));
    const drawn = fract(phase.mul(1.3247180).add(0.11));
    const isRed = clamp(kind.sub(1), 0, 1);
    const pick = mix(drawn, drawn.mul(1 - cfg.blossomFrom).add(cfg.blossomFrom), isRed);
    const threshold = mix(float(cfg.threshold[0]), float(cfg.threshold[1]), when);
    const turned = smoothstep(threshold.sub(cfg.soft), threshold.add(cfg.soft), weight)
        .mul(clamp(kind, 0, 1));
    // Along the palette: each stop eases into the next over the first third of its own span.
    let crownTo = vec3(...cfg.crowns[0].colour);
    let shadeTo = vec3(...shades[0]);
    for (let i = 1; i < cfg.crowns.length; i += 1) {
        const from = cfg.crowns[i].at;
        const span = (cfg.crowns[i + 1]?.at ?? 1) - from;
        const step = smoothstep(float(from - (span * 0.12)), float(from + (span * 0.12)), pick);
        crownTo = mix(crownTo, vec3(...cfg.crowns[i].colour), step);
        shadeTo = mix(shadeTo, vec3(...shades[i]), step);
    }
    return {
        crown: mix(crown, crownTo, turned),
        shade: mix(shade, shadeTo, turned),
        turned,
    };
}

/**
 * The ground's grass in autumn.
 * @param {object} p
 * @param {object} p.grass   vec3 node: the grass colour as it is
 * @param {object} p.weight  float node: {@link autumnWeight} at the fragment
 * @param {object} p.patch   float node 0..1: a smooth noise at the heath's scale
 * @param {object} p.moist   float node 0..1: the ground's moisture (1 = damp)
 */
export function autumnGrass({
    grass, weight, patch, moist,
}, cfg = ODYSSEY_AUTUMN) {
    const G = cfg.grass;
    const heath = smoothstep(float(G.heathEdge[0]), float(G.heathEdge[1]), patch).mul(G.heathShare);
    const to = mix(vec3(...G.tawny), vec3(...G.heath), heath);
    return mix(grass, to, weight.mul(float(1).sub(moist.mul(G.damp))));
}
