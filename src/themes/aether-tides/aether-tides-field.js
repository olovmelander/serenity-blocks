/**
 * Aether Tides — the resting nebula.
 *
 * What the gas and the dust heal back to when nothing disturbs them: a great river of glowing gas
 * crossing the frame behind the card, with dark lanes of dust along its banks and open sky in the
 * two far corners. The fluid tears it, folds it and carries it; this is only the shape it remembers.
 *
 * A function of tide-space position (x right, y down, one unit = half the screen's height) built
 * from the one baked noise texture. Evaluated in the dye pass, never per screen pixel.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    clamp,
    dot,
    exp,
    float,
    max,
    mix,
    sin,
    smoothstep,
    uniform,
    vec2,
    vec4,
} from 'three/tsl';

/** Uniforms of the resting nebula. */
export function createFieldUniforms() {
    return {
        gasA: uniform(new THREE.Color(0.42, 0.1, 1.0)),
        gasB: uniform(new THREE.Color(0.04, 0.78, 1.0)),
        gasC: uniform(new THREE.Color(1.0, 0.1, 0.52)),
        /** The river's direction: (cos, sin) of its angle on screen (y down). */
        river: uniform(new THREE.Vector2(Math.cos(0.5), Math.sin(0.5))),
        /** The river's half-width and how far its two ends lie, tide units. */
        riverWidth: uniform(0.62),
        riverSpan: uniform(1.7),
        /** Slow slide of the noise the shape is cut from. */
        drift: uniform(new THREE.Vector2(0, 0)),
        gain: uniform(1.25),
        dust: uniform(0.9),
        /** The card: centre and half-size in tide units; the gas thins out behind it. */
        card: uniform(new THREE.Vector4(0, 0, 0.42, 0.88)),
        cardVoid: uniform(0.55),
    };
}

/**
 * @param {object} F                createFieldUniforms()
 * @param {object} tNoise           texture node of the baked noise
 * @returns {Function} (q) → vec4(rgb = glowing gas, a = dust)
 */
export function createField(F, tNoise) {
    return Fn(([q]) => {
        // River coordinates: `along` runs down the river, `across` over its banks.
        const along = dot(q, F.river).toVar();
        const across = dot(q, vec2(F.river.y.negate(), F.river.x)).toVar();
        const bend = sin(along.mul(1.25).add(0.6)).mul(0.2);
        const off = across.sub(bend).div(F.riverWidth).toVar();

        const p = q.mul(0.17).add(F.drift).toVar();
        const big = tNoise.sample(p).toVar();
        const warp = big.xy.sub(0.5).mul(0.22);
        const mid = tNoise.sample(p.mul(2.6).add(warp).add(vec2(0.37, 0.11))).toVar();

        // The gas: the river's cross-section, broken into clouds.
        const body = exp(off.mul(off).mul(-1.15));
        const cloud = smoothstep(0.3, 0.74, big.x.mul(0.6).add(mid.y.mul(0.4)));
        const wisps = smoothstep(0.52, 0.86, mid.z).mul(0.3);
        const gas = body.mul(cloud).mul(0.94).add(wisps.mul(body.mul(0.6).add(0.2))).toVar();

        // Colour turns along the river, and noise blurs the boundaries.
        const turn = clamp(along.div(F.riverSpan).mul(0.5).add(0.5).add(big.z.sub(0.5).mul(0.7)), 0.0, 1.0);
        const lower = mix(F.gasA, F.gasB, smoothstep(0.08, 0.52, turn));
        const colour = mix(lower, F.gasC, smoothstep(0.5, 0.94, turn)).toVar();
        // A second colour threads through the first.
        const thread = smoothstep(0.55, 0.85, mid.w);
        colour.assign(mix(colour, mix(F.gasB, F.gasA, turn), thread.mul(0.35)));

        // The dust: lanes along both banks, drawn as ridges of the noise.
        const bank = exp(abs(off).sub(0.95).mul(abs(off).sub(0.95)).mul(-3.2));
        const ridge = float(1.0).sub(abs(mid.x.sub(0.5)).mul(2.0));
        const lanes = smoothstep(0.6, 0.94, ridge).mul(bank.mul(0.95).add(body.mul(0.3)));
        const knots = smoothstep(0.6, 0.84, big.w).mul(bank.mul(0.9).add(body.mul(0.2)));
        const dust = max(lanes, knots);

        // Behind the card the gas thins, so the board keeps its own darkness.
        const c = abs(q.sub(F.card.xy)).sub(F.card.zw);
        const outside = max(max(c.x, c.y), 0.0);
        const calm = float(1.0).sub(F.cardVoid.mul(float(1.0).sub(smoothstep(0.0, 0.3, outside))));

        return vec4(colour.mul(gas).mul(F.gain).mul(calm), dust.mul(F.dust).mul(calm));
    });
}

/** Point the river for an aspect ratio: across a wide screen, up a tall one. */
export function aimRiver(F, aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const wide = Math.max(0, Math.min(1, (a - 0.75) / 0.65));
    // y is down: a positive angle runs from the upper left to the lower right.
    const angle = 1.45 + (0.48 - 1.45) * (wide * wide * (3 - 2 * wide));
    F.river.value.set(Math.cos(angle), Math.sin(angle));
    F.riverSpan.value = Math.hypot(a, 1) * 0.86;
    F.riverWidth.value = 0.5 + 0.14 * wide;
}
