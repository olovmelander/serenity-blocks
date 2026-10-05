/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Ocean Tide — a shoreline seen from above.
 * Inhale: the wave runs up the sand. Exhale: it slides back and leaves the beach shining.
 */
import {
    Fn, exp, float, max, mix, sin, smoothstep, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, gnoise, hash21,
} from '../stage/breath-tsl.js';

const SAND = vec3(0.62, 0.5, 0.36);
const SAND_WET = vec3(0.2, 0.17, 0.14);
const SHALLOW = vec3(0.1, 0.62, 0.58);
const DEEP = vec3(0.006, 0.07, 0.2);
const FOAM = vec3(0.92, 0.98, 1.0);

/** Lace: the bright ridges where two drifting noise fields cross. */
const lace = (point, flow) => {
    const a = float(1).sub(gnoise(point.add(flow)).mul(2).sub(1).abs());
    const b = float(1).sub(gnoise(point.mul(1.9).sub(flow.mul(1.3)).add(4.1)).mul(2).sub(1).abs());
    return smoothstep(0.84, 0.985, max(a, b.mul(0.96)));
};

export function createOceanWorld({ u, quality }) {
    const { octaves } = quality;
    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const wobble = sin(p.x.mul(2.1).add(u.time.mul(0.2))).mul(0.05)
            .add(gnoise(vec2(p.x.mul(1.4), u.time.mul(0.08))).sub(0.5).mul(0.16)).toVar();
        // The waterline travels half the frame with the breath; the highest reach marks wet sand.
        const shore = u.breath.mul(0.62).sub(0.34).add(wobble).toVar();
        const tideMark = wobble.add(0.31);
        const depth = shore.sub(p.y).toVar();
        const flow = vec2(u.time.mul(0.05), u.time.mul(0.03).add(u.breathInt.mul(0.12))).toVar();

        // Sand: warm, finely grained, with long soft ripples and a darker, glossy wet band.
        const grain = hash21(p.mul(430).floor()).sub(0.5).mul(0.06);
        const ripples = sin(p.y.mul(46).add(fbm(p.mul(vec2(2.2, 1.0)).add(3.0), 3).mul(9))).mul(0.5).add(0.5);
        const dunes = fbm(p.mul(vec2(1.3, 2.4)).add(11.0), octaves);
        const sand = SAND.mul(dunes.mul(0.34).add(0.78)).mul(ripples.mul(0.1).add(0.95)).add(grain).toVar();
        const wet = fadeOut(-0.3, 0.03, p.y.sub(tideMark)).mul(fadeOut(0.0, 0.75, p.y.sub(shore)));
        sand.assign(mix(sand, SAND_WET.add(vec3(0.05, 0.1, 0.14).mul(dunes)), wet.mul(0.82)));
        // A thin sheet of water still draining off the sand just above the waterline.
        const sheen = fadeOut(0.0, 0.16, p.y.sub(shore)).mul(u.breath.oneMinus().mul(0.5).add(0.2));
        sand.addAssign(vec3(0.3, 0.42, 0.46).mul(sheen).mul(lace(p.mul(5), flow).mul(0.5).add(0.25)));

        // Water: sand shows through the shallows; colour deepens toward open sea.
        const under = max(depth, 0).toVar();
        const body = mix(SHALLOW, DEEP, smoothstep(0.0, 1.0, under)).toVar();
        const caustic = lace(p.mul(3.4).add(vec2(0, under.mul(2))), flow);
        body.addAssign(vec3(0.2, 0.42, 0.38).mul(caustic).mul(exp(under.mul(-3.2))).mul(0.32));
        const water = mix(sand.mul(vec3(0.55, 0.85, 0.82)), body, smoothstep(0.0, 0.2, under)).toVar();

        // Foam: a bright leading edge, and lace trailing behind it in fading bands.
        const edge = exp(under.mul(-38)).mul(gnoise(vec2(p.x.mul(9), u.time.mul(0.3))).mul(0.5).add(0.75));
        // Foam thins out quickly behind the edge: a few broken ribbons, not a net.
        const ribbons = smoothstep(0.5, 0.78, fbm(p.mul(vec2(2.2, 7)).add(vec2(flow.x.mul(3), under.mul(5))), 3));
        const trail = lace(p.mul(vec2(5, 8)).add(vec2(0, under.mul(3))), flow.mul(1.6))
            .mul(exp(under.mul(-9))).mul(ribbons);
        const wash = exp(under.mul(-16)).mul(fbm(p.mul(vec2(7, 16)).add(flow.mul(4)), 3)).mul(0.6);
        water.assign(mix(water, FOAM, max(edge, max(trail.mul(0.6), wash)).saturate()));
        // Glints where the swell faces the sun.
        water.addAssign(FOAM.mul(smoothstep(0.7, 0.92, gnoise(p.mul(vec2(14, 30)).add(flow.mul(9)))))
            .mul(smoothstep(0.15, 0.7, under)).mul(0.22));

        return mix(sand, water, smoothstep(-0.004, 0.004, depth));
    })();

    return {
        backdrop,
        bloom: { strength: 0.22, radius: 0.5, threshold: 0.86 },
        exposure: 0.9,
    };
}
