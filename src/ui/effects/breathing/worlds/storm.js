/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Electric Storm — a plasma globe in a dark room.
 * Inhale: the filaments reach for the glass. Exhale: they draw back to the core.
 * Nothing flashes: every change is as slow as the breath that drives it.
 */
import {
    Fn, exp, float, length, max, min, mix, pow, smoothstep, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, gnoise, softStep, turn,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION } from '../stage/breath-motes.js';

const RADIUS = 0.62;
const FILAMENTS = 7;
const CORE = vec3(0.86, 0.92, 1.0);
const ARC = vec3(0.42, 0.52, 1.0);
const VIOLET = vec3(0.62, 0.3, 1.0);

export function createStormWorld({ u, quality }) {
    const { octaves } = quality;
    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const r = length(p).toVar();
        const charge = u.breath.mul(0.8).add(0.4).toVar();
        const inside = softStep(0, float(RADIUS).sub(r), u, 2).toVar();

        // The room: storm-blue gloom, a little brighter around the globe.
        const gloom = fbm(p.mul(1.2).add(vec2(u.time.mul(0.008), 4.0)), octaves);
        const col = vec3(0.008, 0.01, 0.028).add(vec3(0.03, 0.035, 0.09).mul(gloom))
            .add(VIOLET.mul(exp(max(r.sub(RADIUS), 0).mul(-2.6))).mul(0.1).mul(charge)).toVar();

        // Filaments: each wanders around its own bearing and grows with the breath.
        const reach = u.breath.mul(0.8).add(0.2).mul(RADIUS).toVar();
        const light = vec3(0).toVar();
        for (let i = 0; i < FILAMENTS; i++) {
            const bearing = (i / FILAMENTS) * Math.PI * 2 + i * 0.37;
            const wander = gnoise(vec2(r.mul(5.5).sub(u.time.mul(0.28)), i * 7.13 + 1)).sub(0.5).mul(2.4).mul(r.div(RADIUS))
                .add(gnoise(vec2(u.time.mul(0.07), i * 3.7)).sub(0.5).mul(1.2));
            const local = turn(p, wander.add(bearing).negate());
            const own = gnoise(vec2(u.time.mul(0.11), i * 5.9 + 2)).mul(0.3).add(0.78);
            const tip = reach.mul(own).toVar();
            const along = fadeOut(tip.mul(0.82), tip, r).mul(smoothstep(0.0, 0.02, local.x)).mul(smoothstep(0.035, 0.1, r));
            const distance = local.y.abs();
            const thread = exp(distance.mul(-140)).mul(1.25).add(exp(distance.mul(-24)).mul(0.26));
            light.addAssign(mix(ARC, CORE, exp(distance.mul(-190))).mul(thread).mul(along));
            // Where a filament meets the glass it spreads into a soft bloom.
            const touch = vec2(Math.cos(bearing), Math.sin(bearing)).mul(RADIUS);
            const near = length(p.sub(turn(touch, wander)));
            light.addAssign(VIOLET.mul(exp(near.mul(-13))).mul(pow(u.breath, 3)).mul(smoothstep(0.92, 1.0, tip.div(RADIUS))).mul(0.6));
        }
        col.addAssign(light.mul(inside).mul(charge));

        // The electrode and the gas it lights.
        col.addAssign(CORE.mul(exp(r.mul(-34))).mul(1.8).mul(charge));
        col.addAssign(ARC.mul(exp(r.mul(-7))).mul(0.3).mul(charge).mul(inside));
        col.addAssign(VIOLET.mul(fbm(p.mul(4).add(u.time.mul(0.03)), 3)).mul(inside).mul(0.05).mul(charge));

        // Glass: brighter toward the rim, with one long reflection of a window that is not there.
        const rim = pow(r.div(RADIUS).saturate(), 7).mul(inside);
        col.addAssign(vec3(0.3, 0.36, 0.7).mul(rim).mul(0.3).mul(charge.mul(0.5).add(0.5)));
        const edge = exp(r.sub(RADIUS).abs().mul(-120));
        col.addAssign(vec3(0.5, 0.58, 1.0).mul(edge).mul(0.3));
        const glare = exp(length(turn(p.sub(vec2(-0.3, 0.34)), 0.7).mul(vec2(2.6, 7.5))).mul(-2.4));
        col.addAssign(vec3(0.75, 0.8, 1.0).mul(glare).mul(inside).mul(0.16));

        // The stand it rests on.
        const drop = max(float(-RADIUS).sub(p.y), 0).toVar();
        const neck = softStep(0, min(drop, 0.2).mul(0.5).add(0.15).sub(p.x.abs()), u)
            .mul(softStep(0, float(-RADIUS + 0.03).sub(p.y), u)).mul(fadeOut(0.2, 0.21, drop));
        const stand = vec3(0.012, 0.014, 0.03).add(ARC.mul(exp(drop.mul(-9))).mul(0.14).mul(charge));
        col.assign(mix(col, stand, neck));
        // The table under it, catching a little of the globe's light.
        const table = softStep(0, drop.sub(0.2), u);
        const sheen = exp(p.x.mul(p.x).mul(-2.2)).mul(exp(drop.sub(0.2).mul(-3.2)));
        col.assign(mix(col, vec3(0.006, 0.007, 0.018).add(VIOLET.mul(sheen).mul(0.09).mul(charge)), table));
        return col;
    })();

    return {
        backdrop,
        motes: {
            motion: MOTE_MOTION.halo,
            count: 90,
            size: 0.024,
            speed: 1,
            spread: 0.75,
            depth: 1.4,
            colorA: [0.5, 0.62, 1.0],
            colorB: [0.78, 0.5, 1.0],
            gain: 0.5,
        },
        bloom: { strength: 0.62, radius: 0.72, threshold: 0.55 },
        exposure: 1.0,
    };
}
