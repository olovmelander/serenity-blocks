/**
 * Crystal Cave — the pool.
 *
 * Still, clear cave water: near the player you look through it to the lit bed, further
 * away it turns to a mirror (a planar reflection of the real scene). Its surface carries
 * rings — every lock, clear and falling drop is a travelling wave that bends both the
 * reflection and the bed beneath it and leaves a luminous crest. Where the water meets
 * rock or a crystal there is a thin living glow line.
 *
 * The mirror also holds the light in the air (`air.gather` along the mirrored ray): the
 * crystals' halos and the skylight's shaft lie in the water under them. Fine ripples crossing
 * the swell break the reflection into a slow shimmer and catch glints of the shaft.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, cameraFar, cameraNear, cameraPosition, clamp, cos, dot, exp, float, fwidth, int, length, linearDepth, max, mix, normalize,
    positionWorld, pow, reflect, reflector, screenUV, sin, smoothstep, texture, uniformArray, vec2, vec3, vec4,
    viewportLinearDepth, viewportSharedTexture,
} from 'three/tsl';
import { reflectedShore } from './crystal-cave-reflection.js';

/** Ring speed across the water, world units per second. */
export const RING_SPEED = 5.2;
/** A ring's crest fades as exp(-RING_DECAY · seconds). */
const RING_DECAY = 0.62;

/**
 * @param {object} options
 * @param {object} options.light shared cave light
 * @param {THREE.Scene} options.scene receives the reflector's target
 * @param {number} options.poolLevel
 * @param {number} [options.reflectionScale] 0 disables the planar reflection
 * @param {THREE.Texture} [options.reflectionAtlas] baked mineral weights for the lean tiers
 * @param {number[]} [options.eye] authored camera position used for that bake
 * @param {boolean} [options.refraction] bend the bed through the surface (needs a backdrop copy)
 * @param {number} [options.rings] ring slots
 * @param {object} [options.air] the light in the air (`createCaveAirLight`), mirrored in the water
 */
export function createCavePool({
    light, scene, poolLevel, reflectionScale = 0.4, reflectionAtlas = null, eye, refraction = true, rings = 10,
    air = null, caustics = null,
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
        // Fine ripples crossing the swell: two small trains that drift against each other,
        // faded with distance where they would only alias.
        const near = float(1).sub(smoothstep(18, 60, distance)).toVar();
        const fineA = texture(light.noise, point.xz.mul(0.31).add(vec2(drift.mul(5.0), drift.mul(-3.1))));
        const fineB = texture(light.noise, point.xz.mul(0.53).sub(vec2(drift.mul(-2.4), drift.mul(4.6))).add(0.41));
        // Low, oblique capillary fronts move through the mirror. Fade each front as
        // it falls below a pixel, so distant reflections retain the shape of the stones.
        const current = sin(u.time.mul(0.078)).mul(0.26);
        const phase = point.z.mul(3.7).add(point.x.mul(current.add(0.62)))
            .add(swellA.a.mul(6.2)).sub(u.time.mul(1.32))
            .toVar();
        const readable = float(1).sub(smoothstep(0.3, 2.2, fwidth(phase)));
        const train = sin(phase).mul(readable).mul(fineA.a.mul(0.67).add(0.25)).toVar();
        const ripple = vec2(fineA.r.sub(fineB.r), fineA.a.sub(fineB.a)).mul(0.015).mul(near)
            .add(vec2(train.mul(0.0035), train.mul(0.012)))
            .toVar();
        slope.addAssign(ripple);
        const crest = vec3(0).toVar();
        Loop({
            start: int(0), end: int(slots), type: 'int', condition: '<',
        }, ({ i }) => {
            const ring = ringNode.element(i).toVar();
            const age = u.time.sub(ring.z).toVar();
            If(ring.w.greaterThan(0).and(age.greaterThanEqual(0)).and(age.lessThan(12)), () => {
                const offset = point.xz.sub(ring.xy);
                const reach = max(length(offset), 0.001).toVar();
                const front = reach.sub(age.mul(RING_SPEED)).add(swellA.a.sub(0.5).mul(0.42)).toVar();
                const width = age.mul(0.48).add(0.97);
                const envelope = ring.w.mul(exp(age.mul(-RING_DECAY))).mul(smoothstep(0, 0.12, age))
                    .mul(exp(front.div(width).pow2().negate())).toVar();
                const ringPhase = front.mul(3.8);
                slope.addAssign(offset.div(reach).mul(sin(ringPhase).mul(envelope).mul(0.19)));
                const arc = dot(offset.div(reach), vec2(0.72, -0.69)).mul(0.5).add(0.5);
                crest.addAssign(vec3(tintNode.element(i)).mul(pow(max(cos(ringPhase), 0), 5))
                    .mul(arc.mul(0.49).add(0.23)).mul(envelope));
            });
        });
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
            below.assign(viewportSharedTexture(screenUV.add(bend).clamp(0.001, 0.999)).rgb);
            // Water scatters a little of the cave's light back on a long path.
            const murk = float(1).sub(exp(thickness.mul(-0.085)));
            below.assign(mix(below, vec3(0.005, 0.042, 0.05).mul(u.energy.mul(1.5).add(1)), murk));
            shoreline.assign(exp(thickness.mul(-2.6)).mul(smoothstep(0.0, 0.05, thickness)));
        } else {
            below.assign(vec3(0.006, 0.04, 0.047));
            if (caustics) {
                const focus = light.focusedLight(point.xz);
                const net = light.waterLight(caustics, point.xz.add(slope.mul(11)));
                below.addAssign(vec3(0.005, 0.019, 0.022).add(focus.mul(0.073)).mul(net.pow2())
                    .mul(float(1).sub(smoothstep(18, 64, distance))));
            }
        }

        // ---- what the surface mirrors -------------------------------------------------
        const mirrored = vec3(0).toVar();
        if (reflection) {
            // A slope moves the mirrored image less the further away the water is.
            const sway = slope.mul(vec2(0.5, 1.6)).div(distance.mul(0.035).add(1));
            mirrored.assign(reflection.sample(screenUV.flipX().add(sway).clamp(0.001, 0.999)).rgb);
        } else {
            const ray = reflect(view.negate(), normal).toVar();
            const sheen = light.environment(ray, float(6), light.eventLight, light.skyLight).mul(0.12);
            mirrored.assign(vec3(0.006, 0.02, 0.027).add(sheen));
            if (reflectionAtlas) {
                const reflectedEye = vec3(eye[0], 2 * poolLevel - eye[1], eye[2]);
                mirrored.addAssign(reflectedShore(reflectionAtlas, u, point, ray, reflectedEye));
            }
        }

        // The light in the air seen in the water: the halos and the shaft along the mirrored ray.
        if (air) {
            const mirrorRay = reflect(view.negate(), normal).toVar();
            const airSeen = air.gather(point, vec3(mirrorRay.x, mirrorRay.y.max(0.02), mirrorRay.z), float(70)).toVar();
            // Where a fine ripple tilts toward it, the shaft's reflection breaks into glints.
            const glint = smoothstep(0.25, 0.92, train).mul(swellB.r);
            mirrored.addAssign(airSeen.mul(glint.mul(1.25).add(0.75)));
        }

        // A living line where water meets stone, lapping slowly.
        const lap = sin(u.time.mul(0.7).add(point.x.mul(0.6)).add(point.z.mul(0.45))).mul(0.3).add(0.7);
        const rim = vec3(0.12, 0.85, 0.8).mul(shoreline).mul(lap).mul(u.energy.mul(2).add(0.55));
        const colour = below.mul(through).add(mirrored.mul(reflectance)).add(rim).add(crest.mul(0.9));
        // Far water is seen at a glancing angle through a long path: it hides its bed.
        const alpha = refraction ? float(1)
            : max(mix(float(0.74), float(1), smoothstep(0.05, 0.6, reflectance)), smoothstep(14, 40, distance));
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
        /**
         * Start a ring. `tint` is a THREE.Color (or hex); `strength` about 0.2 to 1.5. When every
         * slot is busy the faintest ring gives way (the oldest among equals), never one still
         * spreading strongly across the water.
         */
        ring(x, z, time, strength, tint) {
            let index = cursor;
            let faintest = Infinity;
            for (let offset = 0; offset < slots; offset += 1) {
                const slot = (cursor + offset) % slots;
                const ring = ringData[slot];
                const age = time - ring.z;
                const left = age >= 0 ? ring.w * Math.exp(-age * RING_DECAY) : ring.w;
                if (left < faintest) {
                    faintest = left;
                    index = slot;
                }
            }
            cursor = (index + 1) % slots;
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
