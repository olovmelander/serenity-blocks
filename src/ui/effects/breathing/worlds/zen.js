/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Zen Garden — raked sand around three stones, seen from above by moonlight.
 * Inhale: a ring of light travels outward over the furrows. Exhale: it returns to the stone.
 */
import {
    Fn, cos, dot, exp, float, length, max, mix, normalize, sin, smoothstep, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, gnoise, hash21,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION } from '../stage/breath-motes.js';

const SAND = vec3(0.34, 0.31, 0.27);
const MOON = vec3(0.72, 0.82, 1.0);
const MOSS = vec3(0.09, 0.2, 0.1);
const LIGHT = normalize(vec2(-0.55, 0.83));
/** Centre, half-size and turn of each stone. The first is the one the breath rings around. */
const STONES = [
    { centre: [0.0, 0.02], size: [0.2, 0.15], lean: 0.3 },
    { centre: [-0.92, -0.42], size: [0.12, 0.085], lean: -0.5 },
    { centre: [0.98, 0.5], size: [0.1, 0.075], lean: 0.9 },
];

/** Signed distance to a slightly irregular boulder, in hero units. */
/** Stones keep their place on a wide screen and move in on a narrow one. */
const centreOf = (stone, u) => vec2(...stone.centre).mul(vec2(u.ext.x.div(1.78).min(1).max(0.5), 1));

function stoneDistance(p, stone, u) {
    const local = p.sub(centreOf(stone, u));
    const c = Math.cos(stone.lean);
    const s = Math.sin(stone.lean);
    const turned = vec2(local.x.mul(c).sub(local.y.mul(s)), local.x.mul(s).add(local.y.mul(c)));
    const lumpy = gnoise(turned.mul(7).add(stone.lean * 9)).sub(0.5).mul(0.035);
    return length(turned.div(vec2(...stone.size))).sub(1).mul(Math.min(...stone.size)).add(lumpy);
}

export function createZenWorld({ u, quality }) {
    const { octaves } = quality;
    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const d0 = stoneDistance(p, STONES[0], u).toVar();
        const d1 = stoneDistance(p, STONES[1], u).toVar();
        const d2 = stoneDistance(p, STONES[2], u).toVar();

        // Furrows ring the stones and relax into straight lines between them. One smooth
        // union of the three distances keeps the rings whole where they meet.
        const blend = (a, b) => {
            const h = a.sub(b).div(0.5).mul(0.5).add(0.5)
                .saturate();
            return mix(a, b, h).sub(h.mul(float(1).sub(h)).mul(0.25));
        };
        const nearest = blend(blend(d0, d1.add(0.1)), d2.add(0.12)).toVar();
        const w0 = fadeOut(0.0, 0.5, d0.sub(nearest)).toVar();
        const w1 = fadeOut(0.0, 0.5, d1.add(0.1).sub(nearest)).toVar();
        const w2 = fadeOut(0.0, 0.5, d2.add(0.12).sub(nearest)).toVar();
        const rings = fadeOut(0.3, 0.62, nearest).toVar();
        const straight = float(1).sub(rings).toVar();
        const wander = fbm(p.mul(1.3).add(5.0), 3).sub(0.5).mul(0.05);
        const coordinate = mix(p.y.add(wander), nearest, rings);
        const phase = coordinate.mul(84).toVar();
        // Each furrow's slope faces away from its centre; shade it against the moon.
        const away = (stone) => normalize(p.sub(centreOf(stone, u)).add(vec2(1e-4, 0)));
        const slope = normalize(away(STONES[0]).mul(w0).add(away(STONES[1]).mul(w1)).add(away(STONES[2]).mul(w2))
            .mul(rings)
            .add(vec2(0, 1).mul(straight.add(1e-3))));
        const facing = dot(slope, LIGHT);
        const relief = cos(phase).mul(facing).toVar();
        const crest = sin(phase).mul(0.5).add(0.5);

        const grain = hash21(p.mul(520).floor()).sub(0.5).mul(0.035);
        const tone = fbm(p.mul(1.7).add(2.0), octaves).mul(0.3).add(0.82);
        const sand = SAND.mul(tone).mul(relief.mul(0.24).add(0.82)).mul(crest.mul(0.08).add(0.94)).add(grain)
            .toVar();

        // The breath: a ring of moonlight crossing the furrows, leaving them softly lit behind it.
        const radius = u.breath.mul(0.74).add(0.12).toVar();
        const ring = exp(d0.sub(radius).mul(d0.sub(radius)).div(0.0032).negate());
        const wake = fadeOut(radius.sub(0.55), radius, d0).mul(u.breath.mul(0.4).add(0.1));
        sand.addAssign(MOON.mul(ring).mul(max(relief, 0).mul(0.6).add(0.12)).mul(u.breath.mul(0.3).add(0.4)));
        sand.mulAssign(wake.mul(0.6).add(1));

        // Stones: a moonlit top, a mossy shoulder, and a soft shadow cast away from the light.
        const col = sand.toVar();
        [[d0, STONES[0]], [d1, STONES[1]], [d2, STONES[2]]].forEach(([distance, stone]) => {
            const shadowPoint = p.sub(LIGHT.mul(-0.07));
            const shadow = fadeOut(-0.02, 0.07, stoneDistance(shadowPoint, stone, u));
            col.mulAssign(float(1).sub(shadow.mul(0.6)));
            const local = p.sub(centreOf(stone, u)).div(Math.max(...stone.size));
            const dome = max(float(1).sub(dot(local, local).mul(0.75)), 0);
            const lit = dot(local, LIGHT).mul(0.5).add(0.55).mul(dome.mul(0.6).add(0.4));
            const rough = fbm(p.mul(11).add(stone.lean * 5), 3);
            const rock = mix(vec3(0.035, 0.04, 0.05), vec3(0.24, 0.27, 0.32), lit.saturate()).mul(rough.mul(0.5).add(0.72));
            const moss = smoothstep(0.52, 0.72, fbm(p.mul(6).add(stone.lean * 3 + 8), 3)).mul(fadeOut(-0.2, 0.3, dot(local, LIGHT)));
            const body = mix(rock, MOSS.mul(lit.add(0.35)), moss.mul(0.8));
            col.assign(mix(col, body, fadeOut(-0.006, 0.006, distance)));
        });
        // A cool veil of moonlight, strongest where the ring has reached.
        col.addAssign(MOON.mul(0.018).mul(u.breath.add(0.4)));
        return col;
    })();

    return {
        backdrop,
        motes: {
            motion: MOTE_MOTION.fall,
            count: 26,
            size: 0.03,
            speed: 0.5,
            depth: 1.4,
            colorA: [1.0, 0.62, 0.7],
            colorB: [1.0, 0.85, 0.82],
            gain: 0.3,
        },
        bloom: { strength: 0.3, radius: 0.6, threshold: 0.7 },
        exposure: 1.05,
    };
}
