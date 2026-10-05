/**
 * Crystal Cave — what hangs in the air: glow-worms under the vault, dust that drifts
 * through the skylight's beam, the beam itself, and the glints on crystal tips.
 * All of it is instanced billboards placed in the vertex stage, additive, depth-tested.
 */
import * as THREE from 'three/webgpu';
import {
    abs, attribute, cameraFar, cameraNear, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cos, dot, exp,
    fract, length, linearDepth, max, mix, normalWorld, normalize, positionGeometry, positionWorld, pow, sin,
    smoothstep, texture, uniform, uv, varying, vec2, vec3, vec4, viewportLinearDepth,
} from 'three/tsl';

function additive(name) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false,
    });
    material.name = name;
    return material;
}

function quads(count, attributes) {
    const geometry = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute('position', plane.getAttribute('position'));
    geometry.setAttribute('uv', plane.getAttribute('uv'));
    geometry.setIndex(plane.getIndex());
    Object.entries(attributes).forEach(([name, { array, size }]) => {
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, size));
    });
    geometry.instanceCount = count;
    return geometry;
}

/** A camera-facing quad of `size` world units around `centre` (a world position). */
function billboard(centre, size) {
    const view = cameraViewMatrix.mul(vec4(centre, 1));
    return cameraProjectionMatrix.mul(vec4(view.xyz.add(vec3(positionGeometry.xy.mul(size), 0)), 1));
}

/**
 * @param {object} options
 * @param {object} options.light shared cave light
 * @param {object} options.assets parsed cavern (`glowworms`, `crystals`, `meta.skylight`)
 * @param {object} options.wave rock controls carrying the travelling wave uniforms
 * @param {object} options.quality `{ glowworms, motes, glints, shaft }` counts and switches
 */
export function createCaveAir({
    light, assets, wave, quality,
}) {
    const u = light.uniforms;
    const group = new THREE.Group();
    group.name = 'Crystal Cave — air';
    const owned = [];
    const controls = {
        /** Extra brightness of every glow-worm (events). */
        worms: uniform(0),
        shaft: uniform(1),
    };
    const eyeDistance = (centre) => length(centre.sub(cameraPosition));
    const veil = (distance) => exp(distance.mul(u.hazeDensity).mul(-0.75));
    const shell = (centre) => exp(abs(length(centre.sub(wave.waveOrigin)).sub(wave.waveRadius)).mul(-0.3))
        .mul(wave.waveStrength);

    // ---- glow-worms -----------------------------------------------------------------
    const wormCount = Math.min(assets.glowworms.count, Math.max(0, Math.floor(quality.glowworms ?? 0)));
    if (wormCount > 0) {
        const geometry = quads(wormCount, {
            iCentre: { array: assets.glowworms.positions.slice(0, wormCount * 3), size: 3 },
            iParams: { array: assets.glowworms.params.slice(0, wormCount * 4), size: 4 },
        });
        const centre = attribute('iCentre', 'vec3');
        const params = attribute('iParams', 'vec4'); // size, phase, hue, thread
        const material = additive('Crystal Cave — glow-worms');
        const distance = eyeDistance(centre);
        material.vertexNode = billboard(centre, max(params.x.mul(0.2), distance.mul(0.0034)));
        const twinkle = sin(u.time.mul(params.y.mul(0.9).add(0.35)).add(params.y.mul(60))).mul(0.3).add(0.7);
        const lift = varying(twinkle.add(controls.worms).add(shell(centre).mul(3)).mul(veil(distance)));
        const hue = varying(params.z);
        const spot = length(uv().sub(0.5).mul(2));
        material.colorNode = mix(vec3(0.3, 0.95, 1.0), vec3(0.55, 1.0, 0.7), hue).mul(2.6);
        material.opacityNode = exp(spot.mul(spot).mul(-7)).mul(lift);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'Crystal Cave — glow-worms';
        mesh.frustumCulled = false;
        owned.push(mesh);
        group.add(mesh);
    }

    // ---- the skylight's beam -----------------------------------------------------------
    const sky = assets.meta.skylight;
    const beamTop = new THREE.Vector3(...sky.position);
    const beamEnd = new THREE.Vector3(...sky.target);
    const beamAxis = beamEnd.clone().sub(beamTop);
    const beamLength = beamAxis.length();
    beamAxis.normalize();
    const beamSpread = Math.tan(sky.angle * 0.5);
    if (quality.shaft !== false) {
        const top = 1.7;
        const bottom = top + beamLength * beamSpread;
        const geometry = new THREE.CylinderGeometry(top, bottom, beamLength, 40, 1, true);
        const material = additive('Crystal Cave — skylight beam');
        material.side = THREE.DoubleSide;
        // Thickest through the middle, nothing at the silhouette: reads as lit air, not a tube.
        const view = normalize(cameraPosition.sub(positionWorld));
        const across = normalize(view.sub(vec3(beamAxis).mul(dot(view, vec3(beamAxis)))));
        const core = pow(abs(dot(normalize(normalWorld), across)), 2.4);
        const streak = texture(light.noise, vec2(uv().x.mul(3), uv().y.mul(0.35).sub(u.time.mul(0.012)))).r
            .mul(0.65).add(0.5);
        const ends = smoothstep(0, 0.12, uv().y).mul(smoothstep(1, 0.72, uv().y));
        const soft = smoothstep(0, 4, viewportLinearDepth.sub(linearDepth()).mul(cameraFar.sub(cameraNear)));
        material.colorNode = vec3(0.56, 0.78, 1.0);
        material.opacityNode = core.mul(streak).mul(ends).mul(soft).mul(0.1)
            .mul(controls.shaft)
            .mul(u.energy.mul(0.3).add(1));
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'Crystal Cave — skylight beam';
        mesh.position.copy(beamTop).addScaledVector(beamAxis, beamLength * 0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), beamAxis);
        mesh.renderOrder = 3;
        mesh.updateMatrixWorld(true);
        owned.push(mesh);
        group.add(mesh);
    }

    // ---- dust ----------------------------------------------------------------------------
    const moteCount = Math.max(0, Math.floor(quality.motes ?? 0));
    if (moteCount > 0) {
        let state = 971;
        const random = () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 4294967296;
        };
        const centres = new Float32Array(moteCount * 3);
        const params = new Float32Array(moteCount * 4);
        for (let index = 0; index < moteCount; index += 1) {
            // A third of the dust lives in and around the beam, where it is seen.
            if (index % 3 === 0) {
                const along = random() * beamLength;
                const radius = (1.7 + along * beamSpread) * 1.3 * Math.sqrt(random());
                const angle = random() * Math.PI * 2;
                centres[index * 3] = beamTop.x + beamAxis.x * along + Math.cos(angle) * radius;
                centres[index * 3 + 1] = beamTop.y + beamAxis.y * along;
                centres[index * 3 + 2] = beamTop.z + beamAxis.z * along + Math.sin(angle) * radius;
            } else {
                centres[index * 3] = (random() - 0.5) * 84;
                centres[index * 3 + 1] = -6 + random() * 30;
                centres[index * 3 + 2] = 22 - random() * 105;
            }
            params.set([0.03 + random() ** 3 * 0.13, random(), random(), random()], index * 4);
        }
        const geometry = quads(moteCount, {
            iCentre: { array: centres, size: 3 },
            iParams: { array: params, size: 4 },
        });
        const origin = attribute('iCentre', 'vec3');
        const seed = attribute('iParams', 'vec4');
        const phase = seed.y.mul(6.283);
        const drift = vec3(
            sin(u.time.mul(0.11).add(phase)).mul(1.1),
            fract(u.time.mul(seed.z.mul(0.012).add(0.006)).add(seed.w)).mul(3).sub(1.5),
            cos(u.time.mul(0.08).add(phase.mul(1.7))).mul(0.8),
        );
        const centre = origin.add(drift);
        const distance = eyeDistance(centre);
        const material = additive('Crystal Cave — drifting dust');
        material.vertexNode = billboard(centre, max(seed.x, distance.mul(0.0019)));
        // How deep the mote is inside the beam's cone.
        const along = dot(centre.sub(vec3(beamTop)), vec3(beamAxis));
        const away = length(centre.sub(vec3(beamTop)).sub(vec3(beamAxis).mul(along)));
        const inBeam = smoothstep(1, 0.35, away.div(along.mul(beamSpread).add(1.7)))
            .mul(smoothstep(0, 4, along)).mul(controls.shaft);
        const glimmer = sin(u.time.mul(seed.z.mul(2).add(0.7)).add(phase.mul(3))).mul(0.35).add(0.65);
        // Dust right in front of the lens would read as blobs: it fades out as it nears.
        const lift = varying(inBeam.mul(2.6).add(0.2).add(u.energy.mul(0.5)).mul(glimmer)
            .mul(veil(distance))
            .mul(smoothstep(5, 13, distance)));
        const side = varying(smoothstep(-14, 14, centre.x));
        const spot = length(uv().sub(0.5).mul(2));
        material.colorNode = mix(vec3(0.5, 0.95, 0.95), vec3(0.8, 0.66, 1.0), side).mul(1.4);
        material.opacityNode = exp(spot.mul(spot).mul(-6)).mul(lift).mul(0.55);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'Crystal Cave — dust';
        mesh.frustumCulled = false;
        mesh.renderOrder = 4;
        owned.push(mesh);
        group.add(mesh);
    }

    // ---- glints on crystal tips -----------------------------------------------------------
    const tips = assets.tips ?? [];
    const glintCount = Math.min(tips.length, Math.max(0, Math.floor(quality.glints ?? 0)));
    if (glintCount > 0) {
        const centres = new Float32Array(glintCount * 3);
        const params = new Float32Array(glintCount * 4);
        let state = 4409;
        const random = () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 4294967296;
        };
        for (let index = 0; index < glintCount; index += 1) {
            const tip = tips[index];
            centres.set([tip.x, tip.y, tip.z], index * 3);
            params.set([tip.size, random(), tip.family, random()], index * 4);
        }
        const geometry = quads(glintCount, {
            iCentre: { array: centres, size: 3 },
            iParams: { array: params, size: 4 },
        });
        const centre = attribute('iCentre', 'vec3');
        const seed = attribute('iParams', 'vec4'); // size, phase, family, rate
        const distance = eyeDistance(centre);
        // A facet flashes when the eye crosses its mirror direction: drive the glint by
        // where the camera is, so the cave sparkles as the view drifts.
        const sweep = cameraPosition.x.mul(seed.y.mul(1.9).add(0.6)).add(cameraPosition.y.mul(2.3))
            .add(u.time.mul(seed.w.mul(0.3).add(0.08))).add(seed.y.mul(40));
        const flash = pow(sin(sweep).mul(0.5).add(0.5), 22).add(u.energy.mul(0.35)).add(shell(centre).mul(1.5));
        const material = additive('Crystal Cave — tip glints');
        material.vertexNode = billboard(centre, max(seed.x.mul(1.1).add(0.5), distance.mul(0.011)).mul(flash.min(1.6).mul(0.6).add(0.4)));
        const lift = varying(flash.mul(veil(distance)));
        const family = varying(seed.z);
        const local = uv().sub(0.5).mul(2);
        const spot = length(local);
        const ray = (axis, other) => exp(abs(other).mul(-34)).mul(exp(abs(axis).mul(-3.4)));
        const star = ray(local.x, local.y).add(ray(local.y, local.x)).add(exp(spot.mul(spot).mul(-30)).mul(1.4));
        const tintOf = (index) => vec3(u.familyColor.element(index));
        const tint = mix(
            mix(tintOf(0), tintOf(1), smoothstep(0.5, 1.5, family)),
            mix(tintOf(2), mix(tintOf(3), tintOf(4), smoothstep(3.5, 4.5, family)), smoothstep(2.5, 3.5, family)),
            smoothstep(1.5, 2.5, family),
        );
        material.colorNode = mix(vec3(1), tint, 0.4).mul(2.4);
        material.opacityNode = star.mul(lift).mul(smoothstep(1, 0.75, spot));
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'Crystal Cave — tip glints';
        mesh.frustumCulled = false;
        mesh.renderOrder = 5;
        owned.push(mesh);
        group.add(mesh);
    }

    let disposed = false;
    return {
        group,
        controls,
        counts: { glowworms: wormCount, motes: moteCount, glints: glintCount },
        dispose() {
            if (disposed) return;
            disposed = true;
            group.removeFromParent();
            owned.forEach((mesh) => {
                mesh.geometry.dispose();
                mesh.material.dispose();
            });
            group.clear();
        },
    };
}
