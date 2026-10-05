/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Waters — a full moon over a quiet sea.
 * Inhale: the halo opens and the moon-path on the water widens and brightens. Exhale: it narrows.
 */
import {
    Fn, exp, float, length, max, min, mix, pow, smoothstep, sqrt, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, gnoise, softStep, starfield,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION } from '../stage/breath-motes.js';

const HORIZON = -0.3;
const MOONLIGHT = vec3(0.78, 0.86, 1.0);

export function createMoonlitWorld({ u, quality }) {
    const { octaves } = quality;
    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const lift = u.breath.mul(0.75).add(0.5).toVar();
        const moon = vec2(0, u.breath.mul(0.04).add(0.26));
        const radius = u.breath.mul(0.018).add(0.24).toVar();
        const toMoon = p.sub(moon).toVar();
        const dist = length(toMoon).toVar();
        const outside = max(dist.sub(radius), 0).toVar();

        const rise = p.y.sub(HORIZON).div(1.4).saturate().toVar();
        const sky = mix(vec3(0.028, 0.05, 0.12), vec3(0.005, 0.007, 0.03), pow(rise, 0.7)).toVar();
        const halo = exp(outside.mul(-2.6)).mul(0.16).add(exp(outside.mul(-13)).mul(0.5)).toVar();
        sky.addAssign(MOONLIGHT.mul(halo).mul(lift));
        // A faint ice-crystal ring that opens with the breath.
        const ring = radius.mul(2.2).add(u.breath.mul(0.16));
        sky.addAssign(vec3(0.5, 0.62, 0.95).mul(exp(dist.sub(ring).abs().mul(-20))).mul(0.045).mul(u.breath.add(0.3)));
        sky.addAssign(starfield(p, u, 0.8).mul(smoothstep(0.02, 0.3, rise)).mul(float(1).sub(halo.mul(2.2).saturate())));

        const disc = softStep(0, radius.sub(dist), u, 2);
        const maria = fbm(toMoon.div(radius).mul(1.9).add(vec2(4.2, 1.7)), octaves);
        const round = sqrt(max(float(1).sub(dist.div(radius).mul(dist.div(radius))), 0));
        const face = mix(vec3(0.5, 0.55, 0.66), vec3(1.0, 0.97, 0.88), smoothstep(0.34, 0.66, maria))
            .mul(round.mul(0.4).add(0.72)).mul(u.breath.mul(0.22).add(1.08));
        sky.assign(mix(sky, face, disc));

        // Thin cloud bands, lit where they pass near the moon.
        const drift = u.time.mul(0.014);
        const cloud = smoothstep(0.52, 0.8, fbm(vec2(p.x.mul(0.9).add(drift), p.y.mul(4.4).add(3.1)), octaves))
            .mul(smoothstep(0.0, 0.2, rise)).mul(fadeOut(0.4, 0.95, rise));
        const cloudLit = mix(vec3(0.016, 0.026, 0.06), vec3(0.5, 0.56, 0.72), exp(dist.mul(-2.4)).mul(lift.mul(0.8)));
        sky.assign(mix(sky, cloudLit, cloud.mul(0.72)));

        // Sea: wavelets compress toward the horizon; the moon-path is where they catch the light.
        const depth = max(float(HORIZON).sub(p.y), 0).toVar();
        // Past a certain depth the perspective stops stretching: tall screens keep fine wavelets.
        const far = float(1).div(min(depth, 0.55).add(0.07)).add(max(depth.sub(0.55), 0).mul(-0.6)).toVar();
        const flow = u.time.mul(0.22).add(u.breathInt.mul(0.3));
        const wx = p.x.mul(far);
        const wide = gnoise(vec2(wx.mul(5.6), far.mul(9.5).add(flow)));
        const fine = gnoise(vec2(wx.mul(13).add(3.0), far.mul(22).sub(flow.mul(0.8))));
        const glint = smoothstep(0.26, 0.5, wide.mul(fine).mul(1.7));
        const reach = depth.mul(0.44).mul(u.breath.mul(0.55).add(0.7)).add(0.05);
        const path = exp(p.x.mul(p.x).div(reach.mul(reach)).negate());
        const sea = mix(vec3(0.014, 0.028, 0.068), vec3(0.003, 0.006, 0.02), smoothstep(0.0, 0.9, depth)).toVar();
        sea.addAssign(vec3(0.05, 0.075, 0.13).mul(smoothstep(0.52, 0.8, wide)).mul(exp(depth.mul(-1.3))).mul(0.3));
        sea.addAssign(MOONLIGHT.mul(glint).mul(path).mul(lift).mul(1.5)
            .mul(fadeOut(0.5, 1.5, depth).mul(0.85).add(0.15)));
        sea.addAssign(MOONLIGHT.mul(path).mul(exp(depth.mul(-3.5))).mul(lift).mul(0.09));
        const col = mix(sea, sky, softStep(HORIZON, p.y, u)).toVar();
        col.addAssign(MOONLIGHT.mul(exp(p.y.sub(HORIZON).abs().mul(-42))).mul(lift.mul(0.05)));

        // Headlands close the bay at both sides.
        const land = fbm(vec2(p.x.mul(1.4).add(7.3), 1.9), 3).mul(0.2).sub(0.03)
            .mul(smoothstep(0.38, 1.25, p.x.abs()));
        const headland = softStep(0, float(HORIZON).add(land).sub(p.y), u).mul(softStep(HORIZON - 0.004, p.y, u));
        col.assign(mix(col, vec3(0.006, 0.01, 0.022), headland));
        return col;
    })();

    return {
        backdrop,
        motes: {
            motion: MOTE_MOTION.drift,
            count: 46,
            size: 0.022,
            speed: 0.35,
            spread: 0.55,
            depth: 1.8,
            colorA: [0.7, 0.8, 1.0],
            colorB: [1.0, 0.95, 0.85],
            gain: 0.22,
        },
        bloom: { strength: 0.5, radius: 0.8, threshold: 0.62 },
        exposure: 1.0,
    };
}
