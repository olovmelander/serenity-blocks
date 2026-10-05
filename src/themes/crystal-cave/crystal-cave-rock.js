/**
 * Crystal Cave — the rock.
 *
 * The cavern is unlit geometry that carries its own light: eight scalars per vertex,
 * baked with bounces in Blender — how much each mineral family, the pool and the skylight
 * reach that point, and how open it is. The shader multiplies each by the source's
 * current colour and level, so a family that flares in play flares on the stone around
 * it too, with correct soft shadows, at no lighting cost. Fine relief is lit from the
 * baked dominant direction.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, cross, dFdx, dFdy, dot, exp, float, length, max, min, mix,
    normalWorld, normalize, positionWorld, pow, sign, smoothstep, texture, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { FAMILY_COUNT } from './crystal-cave-light.js';

/**
 * @param {object} options
 * @param {object} options.light shared cave light
 * @param {THREE.BufferGeometry} options.geometry the cavern
 * @param {number[]} options.lightScale decode scale of the eight baked channels
 * @param {number} options.poolLevel
 * @param {boolean} [options.relief] light the fine relief (off on the lowest tiers)
 */
export function createCaveRock({
    light, geometry, lightScale, poolLevel, relief = true,
}) {
    const u = light.uniforms;
    const controls = {
        /** Overall strength of crystal light on rock. */
        gain: uniform(0.85),
        poolGain: uniform(0.22),
        skyGain: uniform(2.4),
        ambient: uniform(0.016),
        /** A travelling shell of light: origin, radius, strength (set by the reactions). */
        waveOrigin: uniform(new THREE.Vector3(0, poolLevel, -20)),
        waveRadius: uniform(-100),
        waveStrength: uniform(0),
        waveColor: uniform(new THREE.Color(0xffffff)),
    };

    const shade = Fn(() => {
        const point = positionWorld.toVar();
        const surface = normalize(normalWorld).toVar();
        const stored0 = attribute('aLight0', 'vec4').toVar();
        const stored1 = attribute('aLight1', 'vec4').toVar();
        // Stored as sqrt(light / scale): square to decode.
        const lit0 = stored0.mul(stored0);
        const lit1 = stored1.mul(stored1);
        const occlusion = stored1.w;
        const toLight = normalize(attribute('aLightDir', 'vec3')).toVar();

        // ---- stone -------------------------------------------------------------
        const weight = pow(abs(surface), vec3(4)).toVar();
        weight.divAssign(weight.x.add(weight.y).add(weight.z));
        const planar = (scale) => texture(light.noise, point.zy.mul(scale)).mul(weight.x)
            .add(texture(light.noise, point.xz.mul(scale)).mul(weight.y))
            .add(texture(light.noise, point.xy.mul(scale)).mul(weight.z));
        const coarse = planar(0.021).toVar();
        const fine = planar(0.115).toVar();
        const bedding = texture(light.noise, vec2(point.x.add(point.z).mul(0.004), point.y.mul(0.045)
            .add(coarse.r.mul(0.35)))).g;
        const depthBelow = max(float(poolLevel).sub(point.y), 0).toVar();
        const damp = smoothstep(poolLevel + 2.6, poolLevel + 0.1, point.y).toVar();
        const slate = mix(vec3(0.2, 0.2, 0.26), vec3(0.36, 0.33, 0.37), coarse.r);
        const warm = mix(slate, vec3(0.4, 0.31, 0.27), smoothstep(0.55, 0.85, coarse.a).mul(0.55));
        const albedo = warm.mul(bedding.mul(0.5).add(0.62)).mul(fine.g.mul(0.35).add(0.8))
            .mul(mix(float(1), float(0.5), damp)).toVar();

        // ---- relief lit from the baked direction ---------------------------------
        const height = coarse.g.mul(0.6).add(fine.r.mul(0.4)).toVar();
        const shaped = surface.toVar();
        if (relief) {
            const dpdx = dFdx(point);
            const dpdy = dFdy(point);
            const r1 = cross(dpdy, surface);
            const r2 = cross(surface, dpdx);
            const det = dot(dpdx, r1);
            const gradient = r1.mul(dFdx(height)).add(r2.mul(dFdy(height))).mul(sign(det));
            shaped.assign(normalize(surface.mul(abs(det)).sub(gradient.mul(1.35))));
        }
        const facing = clamp(dot(shaped, toLight).div(max(dot(surface, toLight), 0.3)), 0.15, 2.2);
        const directional = mix(float(1), facing, 0.78).toVar();

        // ---- light ----------------------------------------------------------------
        const crystals = vec3(0).toVar();
        const stored = [lit0.x, lit0.y, lit0.z, lit0.w, lit1.x];
        for (let family = 0; family < FAMILY_COUNT; family += 1) {
            crystals.addAssign(vec3(u.familyColor.element(family))
                .mul(stored[family].mul(lightScale[family]).mul(u.familyLevel.element(family))));
        }
        // Light that left the pool carries its moving caustic net onto the stone.
        const drift = u.time.mul(0.045);
        const net = point.xz.add(vec2(point.y.mul(0.31), point.y.mul(-0.23))).mul(0.07);
        const caustic = pow(min(
            texture(light.noise, net.add(vec2(drift, drift.mul(0.6)))).g,
            texture(light.noise, net.mul(1.31).sub(vec2(drift.mul(0.8), drift)).add(0.37)).g,
        ).mul(1.5), 3.2);
        const poolLight = vec3(0.1, 0.72, 0.78).mul(lit1.y.mul(lightScale[5]))
            .mul(caustic.mul(1.9).add(0.25)).mul(controls.poolGain);
        const skyLight = vec3(0.66, 0.82, 1.0).mul(lit1.z.mul(lightScale[6])).mul(controls.skyGain);
        // A wave of light crossing the cave.
        const shell = exp(abs(length(point.sub(controls.waveOrigin)).sub(controls.waveRadius)).mul(-0.42))
            .mul(controls.waveStrength);
        const irradiance = crystals.mul(controls.gain).mul(shell.mul(1.6).add(1))
            .add(poolLight).add(skyLight)
            .toVar();
        const lightColour = irradiance.mul(directional)
            .add(vec3(0.3, 0.38, 0.6).mul(controls.ambient).mul(occlusion));

        // ---- wet stone and mineral glitter --------------------------------------
        const view = normalize(cameraPosition.sub(point)).toVar();
        const halfway = normalize(toLight.add(view));
        const wet = mix(float(0.16), float(0.75), damp).mul(fine.a.mul(0.6).add(0.4));
        const gloss = pow(max(dot(shaped, halfway), 0), mix(float(22), float(70), damp)).mul(wet);
        const fleck = smoothstep(0.86, 0.97, texture(light.noise, point.xy.add(point.z.mul(0.7)).mul(0.9)
            .add(view.xy.mul(0.55))).b).mul(smoothstep(0.25, 1.2, length(irradiance)));
        const colour = albedo.mul(lightColour)
            .add(irradiance.mul(gloss.mul(0.55).add(fleck.mul(0.5))))
            .add(controls.waveColor.mul(shell).mul(albedo).mul(0.35)).toVar();

        // ---- under the pool: water takes the red and the caustics dance -----------
        const sunk = smoothstep(0, 0.35, depthBelow);
        const absorbed = colour.mul(exp(vec3(0.95, 0.3, 0.24).mul(depthBelow).negate()));
        const bedLight = vec3(0.05, 0.42, 0.46).mul(caustic.mul(1.4).add(0.2))
            .mul(exp(depthBelow.mul(-0.2))).mul(albedo)
            .mul(u.energy.mul(1.2).add(1));
        colour.assign(mix(colour, absorbed.add(bedLight), sunk));

        const distance = length(point.sub(cameraPosition));
        return vec4(light.haze(colour, distance, point.y), 1);
    });

    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'Crystal Cave — lit stone';
    material.fragmentNode = shade();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Crystal Cave — cavern';
    mesh.matrixAutoUpdate = false;

    let disposed = false;
    return {
        mesh,
        material,
        controls,
        dispose() {
            if (disposed) return;
            disposed = true;
            mesh.removeFromParent();
            material.dispose();
        },
    };
}
