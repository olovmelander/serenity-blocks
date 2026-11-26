import {
    clamp, dot, max, min, mix, vec2, vec3,
} from 'three/tsl';

// Tide space is shared by the light, the solver and the lens. Both the gas laid onto the
// simulation grid and its resolved filaments must sample the same moving cloud complex.
export function cloudUv(q, F) {
    const p = vec2(dot(q, F.plateAxes.xy), dot(q, F.plateAxes.zw));
    const tilt = p.yx.mul(vec2(-0.15, 0.12)).mul(F.weather.z);
    return p.add(tilt).mul(F.weather.w).add(F.weather.xy).add(0.5);
}

// The plate holds the relative strengths of the emission bands. Keep the blue hydrogen
// shadows and the warm sulfur crests distinct as the palette wheel turns.
export function cloudEmission(sample, F) {
    const c = sample.mul(sample).toVar();
    const white = min(min(c.r, c.g), c.b);
    const blue = max(c.b.sub(max(c.r, c.g)), 0.0);
    const cyan = max(min(c.g, c.b).sub(c.r), 0.0);
    const rose = max(c.r.sub(c.g), 0.0);
    const gold = max(min(c.r, c.g).sub(c.b), 0.0);
    const turned = F.gasA.mul(blue).add(F.gasB.mul(cyan)).add(F.gasC.mul(rose))
        .add(F.gold.mul(gold))
        .add(vec3(white));
    return mix(c, turned, clamp(F.plateTurn, 0, 1));
}
