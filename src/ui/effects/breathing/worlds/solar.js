/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Solar Flare — a living star.
 * Inhale: the disc swells and the corona streams outward. Exhale: it draws back in.
 */
import {
    Fn, exp, float, length, max, mix, pow, smoothstep, sqrt, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, gnoise, softStep, starfield, turn,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION } from '../stage/breath-motes.js';

const EMBER = vec3(0.9, 0.16, 0.02);
const AMBER = vec3(1.0, 0.5, 0.08);
const GOLD = vec3(1.0, 0.82, 0.36);
const WHITE = vec3(1.0, 0.97, 0.86);

export function createSolarWorld({ u, quality }) {
    const { octaves } = quality;
    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const radius = u.breath.mul(0.05).add(0.33).toVar();
        const dist = length(p).toVar();
        const rim = max(dist.sub(radius), 0).toVar();
        const dir = p.div(max(dist, 1e-4)).toVar();
        const power = u.breath.mul(0.8).add(0.55).toVar();

        // Space: warm-black with a breath of dust, and stars that the glare drowns nearby.
        const col = vec3(0.008, 0.003, 0.003).add(vec3(0.03, 0.009, 0.004)
            .mul(fbm(p.mul(1.1).add(vec2(2.7, u.time.mul(0.01))), 3))).toVar();
        col.addAssign(starfield(p, u, 0.7).mul(smoothstep(0.25, 1.1, rim)));

        // Corona: streamers follow the direction from the centre, so they never show a seam.
        const reach = u.breath.mul(0.5).add(0.32).toVar();
        const swirl = turn(dir, rim.mul(0.5).sub(u.time.mul(0.012)));
        const streams = pow(gnoise(swirl.mul(3.2).add(vec2(u.time.mul(0.02), 1.3))), 2).mul(1.6)
            .add(pow(gnoise(swirl.mul(8.5).sub(vec2(0.7, u.time.mul(0.03)))), 2).mul(0.9));
        const plasma = fbm(vec2(swirl.x.mul(5), swirl.y.mul(5)).add(rim.mul(4).sub(u.time.mul(0.25))), 3);
        const corona = exp(rim.div(reach).mul(-3.2)).mul(streams.mul(0.75).add(0.2)).mul(plasma.mul(0.7).add(0.55));
        col.addAssign(mix(EMBER, AMBER, exp(rim.mul(-3))).mul(corona).mul(power).mul(0.95));
        col.addAssign(AMBER.mul(exp(rim.mul(-1.8))).mul(0.08).mul(power));
        col.addAssign(GOLD.mul(exp(rim.mul(-11))).mul(0.36).mul(power));

        // Photosphere: granulation wrapped on a sphere, darker toward the limb.
        const unit = dist.div(radius).toVar();
        const round = sqrt(max(float(1).sub(unit.mul(unit)), 0)).toVar();
        const wrap = p.div(radius).div(round.mul(0.75).add(0.55)).toVar();
        const flow = vec2(u.time.mul(0.018), u.time.mul(-0.011));
        const cells = fbm(wrap.mul(3.4).add(flow).add(fbm(wrap.mul(1.6).sub(flow), 2).mul(1.4)), octaves);
        const grain = gnoise(wrap.mul(13).add(flow.mul(4)));
        const heat = cells.mul(0.85).add(grain.mul(0.22)).add(round.mul(0.22)).add(u.breath.mul(0.1))
            .toVar();
        const surface = mix(
            mix(EMBER, AMBER, smoothstep(0.3, 0.55, heat)),
            mix(GOLD, WHITE, smoothstep(0.75, 0.98, heat)),
            smoothstep(0.5, 0.78, heat),
        ).mul(pow(round, 0.38).mul(0.9).add(0.25)).mul(u.breath.mul(0.32).add(0.92));
        const spots = fadeOut(0.2, 0.3, fbm(wrap.mul(1.5).add(vec2(8.1, 3.3)).add(flow), 3));
        const disc = softStep(0, radius.sub(dist), u, 2);
        col.assign(mix(col, surface.mul(float(1).sub(spots.mul(0.55))), disc));
        return col;
    })();

    return {
        backdrop,
        motes: {
            motion: MOTE_MOTION.halo,
            count: 150,
            size: 0.03,
            speed: 1,
            spread: 0.9,
            depth: 1.6,
            colorA: [1.0, 0.55, 0.12],
            colorB: [1.0, 0.86, 0.5],
            gain: 0.6,
        },
        bloom: { strength: 0.6, radius: 0.8, threshold: 0.6 },
        exposure: 1.0,
    };
}
