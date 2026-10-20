/**
 * Where Wolfhour's wolves, hut and spindrift stand, shared by the theme and the playground.
 *
 * Clear of the central board at 16:9: the pack on the right-hand granite spur's crest (range 2),
 * against the misty foot of the right massif, looking left across the valley at the moon; a lone
 * wolf on the left-hand spur's crest that answers its howl; the hut low on the left-hand spur,
 * inside the mist bank in front of it (so its firelight spreads into the air); a scout that walks
 * in along the foreground ridge (range 3) from the right. Spindrift streams off the massif's two
 * summits (range 1).
 */
export const WOLFHOUR_PROPS = Object.freeze({
    pack: Object.freeze({
        range: 2, x: 640, depth: 12, scale: 1.55,
    }),
    answerer: Object.freeze({
        range: 2, x: -772, depth: 12, scale: 1.3,
    }),
    scout: Object.freeze({
        range: 3, x: 612, depth: 12, scale: 2.3,
    }),
    spindrift: Object.freeze({
        range: 1, lift: -7, depth: 20, squeeze: 0.6,
    }),
    hut: Object.freeze({
        range: 2, x: -560, lift: -30, depth: 120, scale: 1.3,
    }),
});

/**
 * The ridge under a prop that keeps its proportions: a point `dx` of the prop's own units from its
 * anchor stands `dx * size` world units away, which is `dx * size / stretch` in the stretched
 * terrain's units; the height comes back in the prop's units, relative to its anchor.
 */
function ridgeUnder(landscape, { range, x }, size) {
    const stretch = landscape.group.scale.x || 1;
    const base = landscape.crestPoint(range, x).y;
    return (dx) => (landscape.crestPoint(range, x + (dx * size) / stretch).y - base) / size;
}

/**
 * Stand the wolves, the hut, the spindrift and the spruce on the landscape (any may be missing).
 * Returns `settle()`, which rests each wolf on the ridge under it again and refits the trees; call
 * it after every landscape resize (the terrain stretches with the aspect).
 */
export function standWolfhourProps(landscape, {
    pack = null, hut = null, spindrift = null, forest = null,
} = {}) {
    const {
        pack: at, answerer: across, scout: lookout, hut: home, spindrift: wind,
    } = WOLFHOUR_PROPS;
    for (const plume of spindrift?.plumes ?? []) {
        landscape.addProp(wind.range, plume, {
            x: plume.userData.summitX, lift: wind.lift, depth: wind.depth, squeeze: wind.squeeze,
        });
    }
    if (pack) {
        pack.group.scale.set(at.scale, at.scale, 1);
        landscape.addProp(at.range, pack.group, { x: at.x, depth: at.depth });
        if (pack.answerer) {
            pack.answerer.group.scale.set(across.scale, across.scale, 1);
            landscape.addProp(across.range, pack.answerer.group, { x: across.x, depth: across.depth });
        }
        if (pack.scout) {
            pack.scout.group.scale.set(lookout.scale, lookout.scale, 1);
            landscape.addProp(lookout.range, pack.scout.group, { x: lookout.x, depth: lookout.depth });
        }
    }
    if (hut) {
        hut.group.scale.set(home.scale, home.scale, 1);
        landscape.addProp(home.range, hut.group, { x: home.x, lift: home.lift, depth: home.depth });
    }
    forest?.stand(landscape);
    const settle = () => {
        forest?.fit(landscape.group.scale.x || 1);
        if (!pack) return;
        // A narrow (portrait) screen squeezes the ridges steep: the wolves are a little smaller
        // there, and only the lead and the sitter stand on the pack's ridge (three would crowd
        // into one shape).
        const stretch = landscape.group.scale.x || 1;
        const narrow = Math.min(1, stretch);
        const shrink = 0.7 + 0.3 * narrow;
        const size = at.scale * shrink;
        landscape.setPropScale(pack.group, size);
        pack.settle(ridgeUnder(landscape, at, size), {
            spread: 0.8 + 0.2 * narrow, members: stretch < 0.6 ? 2 : pack.wolves.length,
        });
        if (pack.answerer) {
            const answerSize = across.scale * shrink;
            landscape.setPropScale(pack.answerer.group, answerSize);
            pack.answerer.settle(ridgeUnder(landscape, across, answerSize));
        }
        if (pack.scout) {
            const scoutSize = lookout.scale * shrink;
            landscape.setPropScale(pack.scout.group, scoutSize);
            pack.scout.settle(ridgeUnder(landscape, lookout, scoutSize));
        }
    };
    settle();
    return { settle };
}
