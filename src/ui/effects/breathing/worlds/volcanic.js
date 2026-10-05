/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Volcanic Fire — a flame fed by the breath, on cracked basalt.
 * Inhale: the fire leaps. Exhale: it drops back to a glowing bed.
 */
import {
    Fn, exp, float, max, mix, pow, smoothstep, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, gnoise,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION } from '../stage/breath-motes.js';

const GROUND = -0.5;
const DEEP_RED = vec3(0.55, 0.03, 0.01);
const ORANGE = vec3(1.0, 0.36, 0.04);
const YELLOW = vec3(1.0, 0.8, 0.28);
const WHITE = vec3(1.0, 0.96, 0.82);

export function createVolcanicWorld({ u, quality }) {
    const { octaves } = quality;
    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const power = u.breath.mul(0.75).add(0.45).toVar();
        const rising = u.time.mul(0.55).add(u.breathInt.mul(0.9)).toVar();

        // Night air: smoke climbing through the firelight.
        const smoke = fbm(vec2(p.x.mul(1.3), p.y.mul(0.9).sub(rising.mul(0.12))).add(4.0), 3);
        const col = vec3(0.016, 0.006, 0.006).add(vec3(0.09, 0.022, 0.012).mul(smoke)
            .mul(exp(p.x.mul(p.x).mul(-0.9))).mul(power)).toVar();

        // The flame: a tapering column whose edge is torn by noise that travels upward.
        const height = u.breath.mul(0.8).add(0.52).toVar();
        const up = p.y.sub(GROUND).div(height).toVar();
        const lift = max(up, 0).toVar();
        const sway = fbm(vec2(p.x.mul(2.4), p.y.mul(1.6).sub(rising.mul(1.5))), 3).sub(0.5).mul(0.3).mul(lift)
            .add(gnoise(vec2(p.y.mul(1.1).sub(rising.mul(0.6)), 2.3)).sub(0.5).mul(0.14).mul(lift));
        const x = p.x.add(sway);
        const width = pow(max(float(1).sub(lift), 0), 0.62).mul(u.breath.mul(0.1).add(0.34));
        const body = float(1).sub(x.abs().div(max(width, 1e-3)));
        // Noise eats the edge harder the higher it climbs, so the crown breaks into tongues.
        const tongues = fbm(vec2(x.mul(4.4), p.y.mul(2.5).sub(rising.mul(2.8))), octaves);
        const fine = fbm(vec2(x.mul(11), p.y.mul(6.5).sub(rising.mul(4.6))), 3);
        const heat = body.mul(0.95).add(tongues.sub(0.54).mul(lift.add(0.4)).mul(1.9)).add(fine.sub(0.5).mul(0.35)).saturate()
            .mul(fadeOut(0.72, 1.03, lift))
            .mul(smoothstep(-0.02, 0.05, up))
            .mul(power.mul(0.45).add(0.72))
            .toVar();
        // Hottest along the core and near the bed; the edges and the crown cool to red.
        const core = heat.mul(heat).mul(float(1).sub(lift.mul(0.5))).toVar();
        const fire = mix(
            mix(DEEP_RED, ORANGE, smoothstep(0.08, 0.4, core)),
            mix(YELLOW, WHITE, smoothstep(0.82, 1.0, core)),
            smoothstep(0.38, 0.8, core),
        );
        col.addAssign(fire.mul(smoothstep(0.0, 0.4, heat)).mul(1.05));
        // Firelight on the smoke around the column.
        col.addAssign(ORANGE.mul(exp(p.x.mul(p.x).mul(-3.2))).mul(exp(lift.mul(-1.3)))
            .mul(smoothstep(-0.1, 0.1, up)).mul(0.2)
            .mul(power));

        // Basalt, receding toward the horizon, split by cracks that glow with the fire.
        const below = max(float(GROUND).sub(p.y), 0).toVar();
        const far = float(1).div(below.add(0.12));
        const ground = vec2(p.x.mul(far).mul(0.9), far.mul(1.6));
        const seamA = float(1).sub(gnoise(ground.mul(2.1)).mul(2).sub(1).abs());
        const seamB = float(1).sub(gnoise(ground.mul(4.3).add(7.7)).mul(2).sub(1).abs());
        const cracks = smoothstep(0.86, 0.985, seamA).add(smoothstep(0.9, 0.99, seamB).mul(0.55));
        const reach = exp(p.x.mul(p.x).mul(-1.3)).mul(exp(below.mul(-1.6)));
        const rock = vec3(0.022, 0.014, 0.014).mul(fbm(ground.mul(3), 3).mul(0.9).add(0.5))
            .add(ORANGE.mul(reach).mul(0.07).mul(power));
        const lava = mix(DEEP_RED, YELLOW, cracks.mul(reach).mul(power).saturate())
            .mul(cracks).mul(reach.mul(1.6).add(0.2)).mul(power);
        const floor = rock.add(lava).toVar();
        // The fire bed: a pool of embers where the flame stands.
        floor.addAssign(mix(ORANGE, YELLOW, power.mul(0.5)).mul(exp(p.x.mul(p.x).mul(-14))).mul(exp(below.mul(-9)))
            .mul(power)
            .mul(1.2));
        return mix(col, floor, smoothstep(-0.004, 0.004, float(GROUND).sub(p.y)));
    })();

    return {
        backdrop,
        motes: {
            motion: MOTE_MOTION.rise,
            count: 220,
            size: 0.024,
            speed: 2.6,
            spread: 0.62,
            depth: 1.6,
            colorA: [1.0, 0.42, 0.06],
            colorB: [1.0, 0.8, 0.35],
            gain: 0.9,
        },
        bloom: { strength: 0.42, radius: 0.75, threshold: 0.7 },
        exposure: 1.0,
    };
}
