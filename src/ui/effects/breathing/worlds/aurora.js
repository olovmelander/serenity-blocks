/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Aurora Dreams — curtains of northern light over a snow range and a still lake.
 * Inhale: the curtains climb and brighten. Exhale: they sink back toward the ridge.
 */
import {
    Fn, exp, float, max, min, mix, pow, sin, smoothstep, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, fbm, gnoise, softStep, starfield,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION } from '../stage/breath-motes.js';

const HORIZON = -0.46;
const ROSE = vec3(0.95, 0.22, 0.5);
const GREEN = vec3(0.1, 1.0, 0.42);
const TEAL = vec3(0.06, 0.6, 0.9);
const VIOLET = vec3(0.46, 0.18, 1.0);
/** Far to near: nearer curtains are taller, brighter and drift a little faster. */
const CURTAINS = [
    {
        scale: 0.8, offset: 3.1, base: 0.2, gain: 0.55, speed: 0.7,
    },
    {
        scale: 1.15, offset: 0.0, base: 0.04, gain: 1.0, speed: 1.0,
    },
    {
        scale: 1.6, offset: 7.4, base: -0.14, gain: 0.8, speed: 1.3,
    },
];

function curtains(p, u) {
    let light = vec3(0);
    CURTAINS.forEach((layer, index) => {
        const x = p.x.div(layer.scale).add(layer.offset);
        const t = u.time.mul(layer.speed);
        // The lower hem wanders slowly and lifts a little with the breath.
        const hem = float(layer.base)
            .add(sin(x.mul(1.3).add(t.mul(0.07)).add(index * 2.1)).mul(0.13))
            .add(sin(x.mul(3.1).sub(t.mul(0.05))).mul(0.045))
            .add(gnoise(vec2(x.mul(0.9), t.mul(0.03).add(index * 7.3))).sub(0.5).mul(0.26))
            .add(u.breath.mul(0.08));
        const reach = u.breath.mul(0.6).add(0.4).mul(pow(u.ext.y, 0.8))
            .mul(gnoise(vec2(x.mul(0.6).add(3), t.mul(0.02).add(index * 3.1))).mul(0.6).add(0.7))
            .mul(layer.scale * 0.7);
        const h = max(p.y.sub(hem).div(reach), -1);
        const above = max(h, 0);
        // A bright, sharp lower hem and a long tail upward, like light falling along field lines.
        const profile = smoothstep(-0.03, 0.05, h)
            .mul(exp(above.mul(-2.4)).mul(0.8).add(exp(above.mul(-11)).mul(0.45)));
        const sway = sin(above.mul(2).add(t.mul(0.1))).mul(0.25);
        const rays = pow(gnoise(vec2(x.mul(11).add(sway), t.mul(0.06).add(index))), 1.6).mul(1.25)
            .add(gnoise(vec2(x.mul(37).add(sway.mul(2)), t.mul(0.09).add(index * 5))).sub(0.35).mul(0.55));
        const band = smoothstep(0.36, 0.66, gnoise(vec2(x.mul(0.75).add(index * 5.7), t.mul(0.025))));
        const intensity = profile.mul(max(rays, 0).mul(0.92).add(0.08)).mul(band)
            .mul(u.breath.mul(0.85).add(0.4)).mul(layer.gain);
        const body = mix(mix(GREEN, TEAL, above.mul(1.15).saturate()), VIOLET, above.mul(1.5).sub(0.5).saturate());
        // A thin rose fringe under the green, as on a strong display.
        const tint = mix(mix(body, ROSE, 0.55), body, smoothstep(-0.01, 0.05, h));
        light = light.add(tint.mul(intensity));
    });
    return light;
}

/** A range's skyline: broad massifs with sharper, ridged peaks on top. */
function ridge(x, frequency, seed, height, octaves) {
    const broad = fbm(vec2(x.mul(frequency).add(seed), 2.3), octaves);
    const peaks = float(1).sub(gnoise(vec2(x.mul(frequency * 3.1).add(seed * 1.7), 5.1)).mul(2).sub(1).abs());
    return float(HORIZON - 0.05).add(broad.mul(height)).add(peaks.mul(height * 0.42));
}

export function createAuroraWorld({ u, quality }) {
    const octaves = Math.max(3, quality.octaves - 1);
    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const below = float(1).sub(softStep(HORIZON, p.y, u));
        const depth = max(float(HORIZON).sub(p.y), 0).toVar();
        // Below the horizon the lake mirrors the sky; ripples shear the mirror more with depth.
        const ripple = sin(p.y.mul(90).add(u.time.mul(0.9))).mul(0.003)
            .add(gnoise(vec2(p.x.mul(5), p.y.mul(70).sub(u.time.mul(0.4)))).sub(0.5).mul(0.05))
            .mul(min(depth.mul(4), 1));
        const q = vec2(p.x.add(ripple.mul(below)), mix(p.y, float(HORIZON * 2).sub(p.y), below)).toVar();

        const rise = q.y.sub(HORIZON).div(1.5).saturate().toVar();
        const sky = mix(vec3(0.006, 0.022, 0.05), vec3(0.006, 0.004, 0.03), pow(rise, 0.6)).toVar();
        sky.addAssign(vec3(0.02, 0.1, 0.09).mul(exp(rise.mul(-9))).mul(u.breath.mul(0.6).add(0.3)));
        const light = curtains(q, u).toVar();
        const glow = light.x.add(light.y).add(light.z);
        sky.addAssign(starfield(q, u).mul(smoothstep(0.03, 0.35, rise)).mul(float(1).sub(glow.mul(1.2).saturate())));
        sky.addAssign(light);

        // Two snow ranges. Each peak has a lit flank and a shadowed one; the aurora is the lamp.
        const ambient = u.breath.mul(0.65).add(0.35);
        const farRidge = ridge(q.x, 1.0, 4.0, 0.3, octaves).toVar();
        const farDepth = max(farRidge.sub(q.y), 0).toVar();
        // Faces fall away from each summit at a slant, so the lit and shadowed flanks read as slopes.
        const faceX = q.x.add(farDepth.mul(0.8));
        const flank = smoothstep(-0.02, 0.02, ridge(faceX.add(0.04), 1.0, 4.0, 0.3, octaves)
            .sub(ridge(faceX, 1.0, 4.0, 0.3, octaves)));
        const strata = fbm(vec2(q.x.mul(9).add(farDepth.mul(14)), q.y.mul(30)), 3);
        const cap = float(1).sub(smoothstep(0.04, 0.3, farDepth.add(strata.sub(0.5).mul(0.16))));
        const snowLit = mix(vec3(0.02, 0.07, 0.09), vec3(0.06, 0.25, 0.23), flank).mul(ambient);
        const farSlope = mix(vec3(0.006, 0.014, 0.026), snowLit, cap)
            .add(vec3(0.05, 0.3, 0.24).mul(exp(farDepth.mul(-90))).mul(ambient).mul(0.6));
        const col = mix(farSlope, sky, softStep(0, q.y.sub(farRidge), u)).toVar();
        const nearRidge = ridge(q.x, 2.1, 11.0, 0.15, octaves).sub(0.05).toVar();
        const nearDepth = max(nearRidge.sub(q.y), 0);
        const nearSlope = vec3(0.004, 0.01, 0.018)
            .add(vec3(0.014, 0.075, 0.07).mul(exp(nearDepth.mul(-60))).mul(ambient));
        col.assign(mix(nearSlope, col, softStep(0, q.y.sub(nearRidge), u)));

        // Water: a darker, cooler mirror that deepens toward the viewer, with mist on the far shore.
        const water = col.mul(vec3(0.42, 0.6, 0.72)).mul(max(float(0.8).sub(depth.mul(0.75)), 0.12))
            .add(vec3(0.002, 0.006, 0.013));
        col.assign(mix(col, water, below));
        col.addAssign(vec3(0.05, 0.15, 0.15).mul(exp(p.y.sub(HORIZON).abs().mul(-60))).mul(ambient.mul(0.4)));

        // Pines on the near shore frame the lake at both edges.
        const edge = p.x.abs().div(u.ext.x);
        const bank = u.ext.y.negate().sub(u.focus).add(0.05).add(pow(edge, 3).mul(0.34));
        const cellX = p.x.mul(9);
        const tree = float(0).toVar();
        [-1, 0, 1].forEach((offset) => {
            const id = cellX.floor().add(offset);
            const centre = id.add(0.5).add(gnoise(vec2(id, 3.7)).sub(0.5).mul(0.7)).div(9);
            const tall = gnoise(vec2(id, 9.2)).mul(0.26).add(0.12).mul(pow(edge, 1.5).mul(1.6).add(0.25));
            const up = bank.add(tall).sub(p.y);
            const width = max(up, 0).mul(0.2).mul(up.mul(26).fract().mul(0.45).add(0.6));
            tree.assign(max(tree, softStep(0, width.sub(p.x.sub(centre).abs()), u).mul(softStep(0, up, u))));
        });
        const shore = max(tree, softStep(0, bank.sub(p.y), u));
        col.assign(mix(col, vec3(0.002, 0.006, 0.011), shore));
        return col;
    })();

    return {
        backdrop,
        motes: {
            motion: MOTE_MOTION.fall,
            count: 90,
            size: 0.026,
            speed: 0.7,
            depth: 2.4,
            colorA: [0.55, 0.8, 1.0],
            colorB: [0.6, 1.0, 0.85],
            gain: 0.3,
        },
        bloom: { strength: 0.45, radius: 0.72, threshold: 0.5 },
        exposure: 1.05,
    };
}
