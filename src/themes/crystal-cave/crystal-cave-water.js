/**
 * Crystal Cave — the pool.
 *
 * Still, clear cave water: near the player you look through it to the lit bed, further
 * away it turns to a mirror (a planar reflection of the real scene). Its surface carries
 * rings — every lock, clear and falling drop is a travelling wave that bends both the
 * reflection and the bed beneath it and leaves a luminous crest. Where the water meets
 * rock or a crystal there is a thin living glow line.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, cameraFar, cameraNear, cameraPosition, clamp, cos, dot, exp, float, length, linearDepth, max, mix, normalize,
    positionWorld, pow, reflect, reflector, screenUV, sin, smoothstep, texture, uniformArray, vec2, vec3, vec4,
    viewportLinearDepth, viewportSharedTexture,
} from 'three/tsl';

/** Ring speed across the water, world units per second. */
export const RING_SPEED = 5.2;

/**
 * @param {object} options
 * @param {object} options.light shared cave light
 * @param {THREE.Scene} options.scene receives the reflector's target
 * @param {number} options.poolLevel
 * @param {number} [options.reflectionScale] 0 disables the planar reflection
 * @param {boolean} [options.refraction] bend the bed through the surface (needs a backdrop copy)
 * @param {number} [options.rings] ring slots
 */
export function createCavePool({
    light, scene, poolLevel, reflectionScale = 0.4, refraction = true, rings = 10,
}) {
    const u = light.uniforms;
    const slots = Math.max(1, Math.floor(rings));
    const ringData = Array.from({ length: slots }, () => new THREE.Vector4(0, 0, -1000, 0));
    const ringTint = Array.from({ length: slots }, () => new THREE.Color(0x66fff0));
    const ringNode = uniformArray(ringData, 'vec4');
    const tintNode = uniformArray(ringTint, 'color');

    let reflection = null;
    if (reflectionScale > 0) {
        reflection = reflector({ resolutionScale: reflectionScale, bounces: false, samples: 0 });
        reflection.target.rotation.x = -Math.PI / 2;
        reflection.target.position.y = poolLevel;
        scene.add(reflection.target);
    }

    const shade = Fn(() => {
        const point = positionWorld.toVar();
        const toEye = cameraPosition.sub(point).toVar();
        const distance = length(toEye).toVar();
        const view = toEye.div(distance).toVar();

        // ---- the surface: a slow swell plus every live ring ------------------------
        const drift = u.time.mul(0.018);
        const swellA = texture(light.noise, point.xz.mul(0.021).add(vec2(drift, drift.mul(0.7))));
        const swellB = texture(light.noise, point.xz.mul(0.047).sub(vec2(drift.mul(1.3), drift.mul(0.4))));
        const slope = vec2(swellA.r.sub(swellB.a), swellA.a.sub(swellB.r)).mul(0.02).toVar();
        const crest = vec3(0).toVar();
        for (let index = 0; index < slots; index += 1) {
            const ring = ringNode.element(index);
            const offset = point.xz.sub(ring.xy);
            const reach = max(length(offset), 0.001);
            const age = max(u.time.sub(ring.z), 0);
            const front = reach.sub(age.mul(RING_SPEED));
            const width = age.mul(0.42).add(1.1);
            const envelope = ring.w.mul(exp(age.mul(-0.62))).mul(smoothstep(0, 0.12, age))
                .mul(exp(front.div(width).pow2().negate()));
            const phase = front.mul(2.4);
            slope.addAssign(offset.div(reach).mul(sin(phase).mul(envelope).mul(0.34)));
            crest.addAssign(vec3(tintNode.element(index)).mul(pow(max(cos(phase), 0), 3).mul(envelope)));
        }
        const normal = normalize(vec3(slope.x.negate(), 1, slope.y.negate())).toVar();

        // ---- what lies under the surface --------------------------------------------
        const grazing = clamp(float(1).sub(dot(view, normal)), 0, 0.98).toVar();
        const fresnel = float(0.02).add(float(0.98).mul(grazing.pow2().pow2().mul(grazing))).toVar();
        const reflectance = max(fresnel, 0.07).toVar();
        const through = (float(1).sub(reflectance)).toVar();
        const below = vec3(0).toVar();
        const shoreline = float(0).toVar();
        if (refraction) {
            const span = cameraFar.sub(cameraNear);
            const thickness = max(viewportLinearDepth.sub(linearDepth()).mul(span), 0).toVar();
            const bend = slope.mul(float(1.4).div(distance.mul(0.08).add(1))).mul(smoothstep(0, 1.6, thickness));
            below.assign(viewportSharedTexture(screenUV.add(bend)).rgb);
            // Water scatters a little of the cave's light back on a long path.
            const murk = float(1).sub(exp(thickness.mul(-0.085)));
            below.assign(mix(below, vec3(0.012, 0.075, 0.085).mul(u.energy.mul(1.5).add(1)), murk));
            shoreline.assign(exp(thickness.mul(-2.6)).mul(smoothstep(0.0, 0.05, thickness)));
        } else {
            below.assign(vec3(0.006, 0.04, 0.047));
        }

        // ---- what the surface mirrors -------------------------------------------------
        const mirrored = vec3(0).toVar();
        if (reflection) {
            // A slope moves the mirrored image less the further away the water is.
            const sway = slope.mul(vec2(0.5, 1.6)).div(distance.mul(0.035).add(1));
            mirrored.assign(reflection.sample(screenUV.flipX().add(sway)).rgb);
        } else {
            // No mirror on this tier: dark water, the vault's faint glow, and a path of light
            // laid toward the warm heart at the end of the hall.
            const sheen = light.environment(reflect(view.negate(), normal), float(6), light.eventLight).mul(0.5);
            const offPath = point.x.sub(3).add(slope.x.mul(60)).div(6.5);
            const path = exp(offPath.mul(offPath).negate()).mul(smoothstep(-12, -70, point.z));
            mirrored.assign(vec3(0.006, 0.026, 0.036).add(sheen).add(vec3(1.0, 0.7, 0.38).mul(path).mul(0.3)));
        }

        // A living line where water meets stone, lapping slowly.
        const lap = sin(u.time.mul(0.7).add(point.x.mul(0.6)).add(point.z.mul(0.45))).mul(0.3).add(0.7);
        const rim = vec3(0.12, 0.85, 0.8).mul(shoreline).mul(lap).mul(u.energy.mul(2).add(0.55));
        const colour = below.mul(through).add(mirrored.mul(reflectance)).add(rim).add(crest.mul(0.9));
        // Far water is seen at a glancing angle through a long path: it hides its bed.
        const alpha = refraction ? float(1)
            : max(mix(float(0.5), float(1), smoothstep(0.05, 0.6, reflectance)), smoothstep(22, 55, distance));
        // Without a mirror the far water would otherwise turn into a flat sheet of haze.
        return vec4(light.haze(colour, distance.mul(reflection ? 1 : 0.4), point.y), alpha);
    });

    const material = new THREE.MeshBasicNodeMaterial({ fog: false, transparent: true, depthWrite: false });
    material.name = 'Crystal Cave — pool';
    material.fragmentNode = shade();

    const geometry = new THREE.PlaneGeometry(170, 185);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, poolLevel, -44);
    mesh.name = 'Crystal Cave — pool';
    mesh.renderOrder = 1;
    mesh.updateMatrixWorld(true);

    let cursor = 0;
    let disposed = false;
    return {
        mesh,
        material,
        reflection,
        slots,
        /** Start a ring. `tint` is a THREE.Color (or hex); `strength` about 0.2 to 1.5. */
        ring(x, z, time, strength, tint) {
            const index = cursor;
            cursor = (cursor + 1) % slots;
            ringData[index].set(x, z, time, strength);
            if (tint !== undefined) ringTint[index].set(tint);
            return index;
        },
        reset() {
            cursor = 0;
            ringData.forEach((ring) => ring.set(0, 0, -1000, 0));
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
            reflection?.target.removeFromParent();
            reflection?.dispose();
        },
    };
}
