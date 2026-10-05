/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Ancient Forest — old trunks standing in morning mist, the sun low behind them.
 * Inhale: light pours between the trees and the mist glows. Exhale: the forest dims and settles.
 */
import {
    Fn, exp, max, mix, pow, smoothstep, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, gnoise, softStep,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION } from '../stage/breath-motes.js';

const SUNLIT = vec3(1.0, 0.96, 0.6);
const FOG = vec3(0.34, 0.52, 0.34);
const SHADE = vec3(0.014, 0.05, 0.036);
const BARK = vec3(0.006, 0.016, 0.012);
const SUN = [-0.16, 0.5];
/** Far to near: spacing, trunk half-width, drift, and how much of the mist still veils the row. */
const TRUNKS = [
    {
        cells: 5.4, width: 0.011, drift: 0.003, veil: 0.74, seed: 1.7, edge: 0,
    },
    {
        cells: 3.3, width: 0.02, drift: 0.006, veil: 0.46, seed: 5.3, edge: 0,
    },
    {
        cells: 1.9, width: 0.04, drift: 0.01, veil: 0.18, seed: 9.1, edge: 0,
    },
    {
        cells: 1.1, width: 0.1, drift: 0.016, veil: 0.0, seed: 13.9, edge: 1,
    },
];

/** One row of trunks: 1 inside a trunk. Each one leans, bends and flares toward its roots. */
function trunkRow(p, u, layer) {
    const x = p.x.add(u.time.mul(layer.drift)).mul(layer.cells).add(layer.seed);
    const id = x.floor();
    const centre = gnoise(vec2(id.mul(1.37), layer.seed)).sub(0.5).mul(0.46).add(0.5);
    const lean = gnoise(vec2(id.mul(2.11), layer.seed + 4)).sub(0.5).mul(0.12);
    const bend = gnoise(vec2(p.y.mul(0.9).add(id.mul(3.1)), layer.seed + 2)).sub(0.5).mul(0.07);
    const girth = gnoise(vec2(id.mul(3.3), layer.seed + 8)).mul(0.7).add(0.65).mul(layer.width * layer.cells);
    const floor = p.y.add(u.ext.y).add(u.focus);
    const flare = exp(floor.mul(-4.5)).mul(0.8).add(1);
    const offset = x.fract().sub(centre).sub(p.y.mul(lean)).sub(bend)
        .abs();
    return softStep(0, girth.mul(flare).sub(offset).div(layer.cells), u);
}

export function createForestWorld({ u, quality }) {
    const { octaves } = quality;
    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const glow = u.breath.mul(0.7).add(0.5).toVar();
        const toSun = p.sub(vec2(...SUN)).toVar();
        const sunDistance = toSun.length().toVar();
        const sunward = toSun.div(max(sunDistance, 1e-3)).toVar();

        // Mist: luminous around the sun, deep green toward the edges and the forest floor.
        const haze = fbm(vec2(p.x.mul(0.8).add(u.time.mul(0.01)), p.y.mul(1.3)).add(3.0), octaves).toVar();
        const air = mix(SHADE, FOG, exp(sunDistance.mul(-1.15)).mul(haze.mul(0.5).add(0.78)).mul(glow).saturate()).toVar();
        air.addAssign(SUNLIT.mul(exp(sunDistance.mul(-3.4))).mul(0.85).mul(glow));
        air.addAssign(vec3(0.6, 0.8, 0.4).mul(exp(sunDistance.mul(-1.5))).mul(0.2).mul(glow));

        // Shafts fan out from the sun in every direction, cut into beams by what stands in the way.
        const beams = pow(gnoise(sunward.mul(4.6).add(vec2(u.time.mul(0.01), 1.3))), 2).mul(1.9)
            .mul(gnoise(sunward.mul(13).sub(vec2(0.4, u.time.mul(0.014)))).mul(0.7).add(0.5));
        const shafts = beams.mul(exp(sunDistance.mul(-0.85))).mul(smoothstep(0.04, 0.42, sunDistance)).mul(glow).toVar();

        const col = air.toVar();
        TRUNKS.forEach((layer, index) => {
            let trunk = trunkRow(p, u, layer);
            // The nearest giants stand at the sides and leave the middle of the frame open.
            if (layer.edge) trunk = trunk.mul(smoothstep(0.5, 0.82, p.x.abs().div(u.ext.x)));
            const grain = fbm(vec2(p.x.mul(layer.cells * 11), p.y.mul(2.4)).add(layer.seed), 3);
            const body = mix(BARK.mul(grain.mul(1.4).add(0.5)), air.mul(0.62), layer.veil);
            col.assign(mix(col, body, trunk));
            // Light falls between the rows, so nearer trunks stand dark against lit air.
            if (index === 0) col.addAssign(SUNLIT.mul(shafts).mul(0.42));
            if (index === 1) col.addAssign(SUNLIT.mul(shafts).mul(0.26));
            if (index === 2) col.addAssign(SUNLIT.mul(shafts).mul(0.1));
        });

        // Canopy above: a dark ceiling of leaves, broken by light where it thins.
        const top = u.ext.y.sub(u.focus);
        const leaves = fbm(p.mul(vec2(2.4, 3.2)).add(vec2(u.time.mul(0.012), 7)), octaves);
        const canopy = smoothstep(0.42, 0.62, leaves.add(p.y.sub(top).add(0.3).mul(1.5)));
        const dapple = smoothstep(0.6, 0.8, gnoise(p.mul(vec2(13, 15)).add(vec2(u.time.mul(0.02), 2))));
        col.assign(mix(col, BARK.mul(1.5).add(vec3(0.07, 0.12, 0.035).mul(dapple).mul(glow).mul(exp(sunDistance.mul(-1.6)))), canopy));

        // Floor: ferns in silhouette, and ground mist that lifts with the breath.
        const floor = p.y.add(u.ext.y).add(u.focus).toVar();
        const lifted = exp(floor.sub(0.36).mul(floor.sub(0.36)).mul(-8));
        col.addAssign(FOG.mul(lifted).mul(haze.mul(0.6).add(0.4)).mul(glow).mul(0.3));
        const fronds = fbm(vec2(p.x.mul(6), 2.1), 4).mul(0.2).add(gnoise(vec2(p.x.mul(26), 5.5)).mul(0.05));
        const ferns = fadeOut(0.0, 0.03, floor.sub(fronds).sub(0.04));
        col.assign(mix(col, BARK.mul(0.8), ferns));
        return col.mul(u.breath.mul(0.3).add(0.8));
    })();

    return {
        backdrop,
        motes: {
            motion: MOTE_MOTION.rise,
            count: 64,
            size: 0.03,
            speed: 0.4,
            spread: 0.95,
            depth: 2.2,
            colorA: [0.95, 1.0, 0.45],
            colorB: [0.6, 1.0, 0.55],
            gain: 0.9,
        },
        bloom: { strength: 0.55, radius: 0.85, threshold: 0.6 },
        exposure: 1.0,
    };
}
