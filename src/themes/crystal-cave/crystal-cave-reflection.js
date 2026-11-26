import {
    max, smoothstep, texture, vec2, vec3,
} from 'three/tsl';

// Tangents of the horizontal and vertical viewing angles covered by the shoreline bake.
export const POOL_VIEW = Object.freeze({ halfWidth: 1.6, height: 1.08 });

/** Re-light the baked reflection with the five live mineral colours and the sky above. */
export function reflectedShore(atlas, uniforms, point, ray, reflectedEye) {
    // The viewpoint in play drifts close to the one used to bake the image. Projecting a point
    // along the ray keeps near banks registered as the eye moves, and bends them with each ring.
    const direction = point.sub(reflectedEye).add(ray.mul(30)).toVar();
    const tangent = direction.xy.div(max(direction.z.negate(), 0.01)).toVar();
    const uv = vec2(tangent.x.div(POOL_VIEW.halfWidth * 2).add(0.5), tangent.y.div(POOL_VIEW.height)).toVar();
    const fade = smoothstep(0, 0.035, uv.x.min(uv.x.oneMinus()))
        .mul(smoothstep(0, 0.02, uv.y)).mul(smoothstep(0, 0.04, uv.y.oneMinus()));
    const left = uv.clamp(0.002, 0.998).mul(vec2(0.5, 1)).toVar();
    const cool = texture(atlas, left).rgb.toVar();
    const warm = texture(atlas, left.add(vec2(0.5, 0))).rgb.toVar();
    const weights = [cool.x, cool.y, cool.z, warm.x, warm.y];
    const colour = vec3(0).toVar();
    for (let family = 0; family < weights.length; family += 1) {
        colour.addAssign(vec3(uniforms.familyColor.element(family))
            .mul(uniforms.familyLevel.element(family)).mul(weights[family]));
    }
    return colour.mul(uniforms.stoneGlow).add(vec3(uniforms.skyTint).mul(uniforms.skyLevel).mul(warm.z))
        .mul(fade).mul(1.24);
}
