/** Opaque view-fan land: mineral beds are cut by the geometry, never screen-space stripes. */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, clamp, dot, exp, float, fwidth, max, mix, normalWorld,
    normalize, positionWorld, pow, reflect, select, sin, smoothstep, texture, vec2, vec3,
} from 'three/tsl';
import {
    strataAt, paHaze, paSkyColour, paWet,
} from './painted-ages-tsl.js';
import { paLenticularShadow, paRainbow } from './painted-ages-sky.js';
import { createRockRelief } from './painted-ages-rock.js';

function createScaleDetails(u, tier, bake) {
    const positions = [];
    const colours = [];
    const cube = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const box = (x, y, z, width, height, depth, yaw, colour) => {
        const a = cube.attributes.position.array;
        const ca = Math.cos(yaw);
        const sa = Math.sin(yaw);
        for (let i = 0; i < a.length; i += 3) {
            const px = a[i] * width;
            const pz = a[i + 2] * depth;
            positions.push(x + px * ca + pz * sa, y + a[i + 1] * height, z - px * sa + pz * ca);
            colours.push(...colour);
        }
    };
    const strut = (from, to, width, height, colour) => {
        const direction = new THREE.Vector3().subVectors(to, from);
        const length = direction.length();
        direction.normalize();
        const side = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
        const up = new THREE.Vector3().crossVectors(side, direction).normalize();
        const centre = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
        const a = cube.attributes.position.array;
        for (let i = 0; i < a.length; i += 3) {
            positions.push(
                centre.x + side.x * a[i] * width + up.x * a[i + 1] * height + direction.x * a[i + 2] * length,
                centre.y + side.y * a[i] * width + up.y * a[i + 1] * height + direction.y * a[i + 2] * length,
                centre.z + side.z * a[i] * width + up.z * a[i + 1] * height + direction.z * a[i + 2] * length,
            );
            colours.push(...colour);
        }
    };
    const dx = -145;
    const dz = -420;
    const yaw = Math.atan2(dx, dz);
    let previous = null;
    // Pale timber steps, paired posts and thin handrails give a human scale cue.
    // They follow the same sampler as land and do not consume an event pool.
    for (let i = 0; i < 110; i++) {
        const t = i / 109;
        const x = -65 + dx * t;
        const z = 50 + dz * t;
        const y = bake.heightAt(x, z) + 1.7;
        const grain = 0.84 + (i % 7) * 0.04;
        box(x, y, z, 3.4, 0.28, 4.35, yaw, [0.32 * grain, 0.22 * grain, 0.13 * grain]);
        if (previous) {
            for (const side of [-1, 1]) {
                const ox = Math.cos(yaw) * side * 1.8;
                const oz = -Math.sin(yaw) * side * 1.8;
                const from = new THREE.Vector3(previous.x + ox, previous.y - 0.2, previous.z + oz);
                const to = new THREE.Vector3(x + ox, y - 0.2, z + oz);
                strut(from, to, 0.42, 0.65, [0.19, 0.12, 0.063]);
                from.y += 1.65; to.y += 1.65;
                strut(from, to, 0.15, 0.15, [0.23, 0.17, 0.10]);
            }
        }
        previous = { x, y, z };
        if (i % 3 === 0) {
            for (const side of [-1, 1]) {
                const px = x + Math.cos(yaw) * side * 1.8;
                const pz = z - Math.sin(yaw) * side * 1.8;
                box(px, y + 0.8, pz, 0.21, 1.9, 0.21, yaw, [0.13, 0.085, 0.045]);
            }
        }
    }
    cube.dispose();

    // Sparse thorn silhouettes are merged once; no per-frame transforms or allocation.
    let randomState = bake.diagnostics.seed >>> 0;
    const random = () => {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        return randomState / 4294967296;
    };
    // A few broken talus clusters give the near slopes a readable rock scale.
    // All stones share this static mesh; partially bury them in the exact ground.
    const stone = new THREE.IcosahedronGeometry(1, 0);
    const facets = stone.getAttribute('position').array;
    const stoneCount = Math.min(112, Math.floor((tier.shrubs || 0) * 0.14));
    for (let i = 0; i < stoneCount; i++) {
        const x = (i % 2 === 0 ? -1 : 1) * (155 + random() * 550);
        const z = 70 - random() * 850;
        const ground = bake.heightAt(x, z);
        if (Math.abs(bake.heightAt(x + 3, z) - bake.heightAt(x - 3, z)) > 7) continue;
        const width = 1.1 + random() * 2.8;
        const height = width * (0.32 + random() * 0.32);
        const depth = width * (0.55 + random() * 0.65);
        const angle = random() * Math.PI * 2;
        const ca = Math.cos(angle);
        const sa = Math.sin(angle);
        const warm = random();
        for (let j = 0; j < facets.length; j += 3) {
            const px = facets[j] * width;
            const py = facets[j + 1] * height;
            const pz = facets[j + 2] * depth;
            positions.push(x + px * ca + pz * sa, ground + height * 0.36 + py, z - px * sa + pz * ca);
            const weathered = 0.84 + facets[j + 1] * 0.16;
            colours.push((0.15 + warm * 0.13) * weathered, (0.14 + warm * 0.055) * weathered, 0.13 * weathered);
        }
    }
    stone.dispose();
    for (let i = 0; i < (tier.shrubs || 0); i++) {
        const distance = 120 + random() * 1150;
        const angle = (random() - 0.5) * 2.3;
        const x = Math.sin(angle) * distance;
        const z = 200 - Math.cos(angle) * distance;
        if (Math.abs(x) < 100) continue;
        const y = bake.heightAt(x, z) + 0.3;
        const height = 1.1 + random() * 1.5;
        for (let arm = 0; arm < 3; arm++) {
            const direction = arm * (Math.PI / 3);
            const width = height * (0.6 + random() * 0.4);
            const ox = Math.cos(direction) * width;
            const oz = Math.sin(direction) * width;
            positions.push(x - ox, y, z - oz, x, y + height, z, x + ox, y, z + oz);
            for (let v = 0; v < 3; v++) colours.push(0.115, 0.12, 0.059);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'painted-ages-weathered-boardwalk-and-thorns';
    material.colorNode = Fn(() => {
        const sun = max(dot(normalize(normalWorld), u.sunDir), 0);
        const lit = attribute('color', 'vec3').mul(vec3(0.32, 0.32, 0.42).add(vec3(1.1, 0.96, 0.7).mul(sun)));
        return paHaze(u, positionWorld, lit);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'painted-ages-boardwalk-and-thorns';
    mesh.frustumCulled = false;
    return { mesh, geometry, material };
}

export function createLand({
    u, tier, bake, recordTexture,
}) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(bake.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(bake.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(bake.uvs, 2));
    geometry.setAttribute('paSurface', new THREE.BufferAttribute(bake.surface, 4));
    geometry.setAttribute('paHorizon', new THREE.BufferAttribute(bake.horizon, 1));
    geometry.setIndex(new THREE.BufferAttribute(bake.indices, 1));
    geometry.computeBoundingSphere();
    const rockRelief = tier.detailOctaves > 0 ? createRockRelief() : null;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'painted-ages-mineral-hogbacks';
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const surface = attribute('paSurface', 'vec4').toVar();
        const geometricNormal = normalize(normalWorld).toVar();
        const N = geometricNormal.toVar();
        const roughVariation = float(0.65).toVar();
        const relief = float(0).toVar();
        if (rockRelief) {
            // Filtered analytic gradients remain smooth across the noise texel boundaries.
            // Mips and the pixel footprint remove subpixel detail on distant ridges.
            const rockUv = P.xz.mul(0.012).add(vec2(P.y.mul(0.003), P.y.mul(0.006)));
            const detail = texture(rockRelief, rockUv).toVar();
            const footprint = max(fwidth(rockUv.x), fwidth(rockUv.y));
            const detailWeight = float(1).sub(smoothstep(0.006, 0.035, footprint));
            const gradient = vec3(detail.g, detail.g.mul(0.25).add(detail.b.mul(0.5)), detail.b);
            const tangent = gradient.sub(N.mul(dot(gradient, N)));
            N.assign(normalize(N.sub(tangent.mul(detailWeight).mul(0.065))));
            relief.assign(detail.r.mul(detailWeight));
            roughVariation.assign(detail.a);
        }
        const horizon = attribute('paHorizon', 'float');
        const elevation = u.sunElevation.mul(Math.PI / 180);
        const shadow = smoothstep(horizon.sub(0.055), horizon.add(0.055), elevation).toVar();
        const facing = max(dot(N, u.sunDir).add(0.09).div(1.09), 0).toVar();
        const wet = paWet(u, P, smoothstep(0, 0.12, dot(N, u.sunDir)).mul(shadow)).toVar();
        const albedo = strataAt(P, u, recordTexture, wet).toVar();
        albedo.mulAssign(float(1).add(relief.mul(0.09)));
        const near = float(1).sub(smoothstep(1300, 4000, P.z.negate())).toVar();

        // Dust masks thin beds on broad dip slopes; scarp faces retain clean geology.
        const dustPatch = sin(P.x.mul(0.013).add(P.z.mul(0.008)))
            .add(sin(P.z.mul(0.022).sub(P.x.mul(0.007))).mul(0.6)).mul(0.3).add(0.5);
        const dust = surface.y.mul(smoothstep(0.1, 0.88, dustPatch)).mul(0.58)
            .mul(float(1).sub(wet.mul(0.75))).toVar();
        albedo.assign(mix(albedo, vec3(0.57, 0.43, 0.30), dust));
        const apronX = P.x.div(105);
        const apron = exp(apronX.mul(apronX).mul(apronX).mul(apronX).negate())
            .mul(smoothstep(30, 65, P.z)).mul(float(1).sub(smoothstep(155, 195, P.z)));
        albedo.assign(mix(albedo, vec3(0.59, 0.47, 0.34), apron.mul(0.86)));
        const varnish = smoothstep(
            0.42,
            0.9,
            sin(P.x.mul(0.069).add(sin(P.z.mul(0.012)).mul(1.8))).mul(0.5).add(0.5),
        )
            .mul(float(1).sub(surface.y)).mul(0.11);
        albedo.mulAssign(float(1).sub(varnish));

        // One continuous dark wash through the card, with mineral vents on its left.
        const washWidth = max(P.z.negate(), 0).mul(0.12).add(95);
        const washX = P.x.sub(sin(P.z.mul(-0.003)).mul(50)).div(washWidth);
        const wash = exp(washX.mul(washX).negate()).mul(near).mul(0.65).toVar();
        albedo.assign(mix(albedo, vec3(0.075, 0.048, 0.11), wash));
        // Gravel and damp alluvium connect the narrow moving braids to the valley floor.
        // The broad mineral wash remains visible outside this irregular river corridor.
        const riverDistance = max(P.z.negate(), 0);
        const riverCentre = sin(riverDistance.mul(0.003)).mul(50);
        const riverWidth = riverDistance.mul(0.009).add(34);
        const riverCoordinate = P.x.sub(riverCentre).div(riverWidth);
        const riverSquared = riverCoordinate.mul(riverCoordinate);
        const gravelMask = exp(riverSquared.mul(riverSquared).negate())
            .mul(float(1).sub(smoothstep(3000, 6500, riverDistance)))
            .mul(smoothstep(0.5, 0.87, geometricNormal.y));
        const gravel = mix(vec3(0.20, 0.175, 0.15), vec3(0.32, 0.29, 0.235), relief.mul(0.8).add(0.5));
        albedo.assign(mix(albedo, gravel.mul(float(1).sub(wet.mul(0.25))), gravelMask.mul(0.52)));
        const moss = surface.x.mul(surface.w).mul(float(1).sub(surface.y)).mul(0.52);
        albedo.assign(mix(albedo, vec3(0.068, 0.19, 0.045), moss));
        albedo.assign(mix(albedo, vec3(0.68, 0.52, 0.055), surface.w.mul(0.5)));
        const obsidian = smoothstep(0.19, 0.58, surface.z.add(relief.mul(0.12))).toVar();
        albedo.assign(mix(albedo, vec3(0.012, 0.015, 0.021), obsidian.mul(0.98)));
        albedo.assign(mix(albedo, vec3(0.78, 0.74, 0.65), u.tuff.mul(near).mul(surface.y).mul(0.75)));

        const direct = facing.mul(mix(0.18, 1, shadow)).mul(paLenticularShadow(u, P));
        const sunColour = mix(vec3(1.22, 1.09, 0.91), vec3(1.25, 0.59, 0.34), u.gameOver);
        const cavity = smoothstep(0.28, 0.95, surface.x).mul(near);
        const skyFill = mix(vec3(0.115, 0.145, 0.23), vec3(0.22, 0.29, 0.405), max(N.y, 0))
            .mul(float(1).sub(cavity.mul(0.48)));
        const illumination = skyFill.add(sunColour.mul(direct)).toVar();
        if (tier.bounce) {
            illumination.addAssign(vec3(0.105, 0.046, 0.028).mul(surface.x)
                .mul(float(1).sub(direct)).mul(float(1).sub(cavity.mul(0.45))));
        }
        const rgb = albedo.mul(illumination).toVar();

        // Rough stone and glassy obsidian have distinct, view-dependent GGX highlights.
        // All divisions are bounded; roughness widens with the pixel footprint.
        const V = normalize(u.eye.sub(P)).toVar();
        const H = normalize(V.add(u.sunDir)).toVar();
        const nh = clamp(dot(N, H), 0, 1).toVar();
        const nv = clamp(dot(N, V), 0.025, 1).toVar();
        const nl = clamp(dot(N, u.sunDir), 0, 1).toVar();
        const vh = clamp(dot(V, H), 0, 1).toVar();
        const roughness = clamp(mix(roughVariation.mul(0.3).add(0.57), float(0.31), wet)
            .mul(float(1).sub(obsidian.mul(0.56))).add(fwidth(nh).mul(1.5)), 0.18, 0.95).toVar();
        const alpha = roughness.mul(roughness).toVar();
        const alpha2 = alpha.mul(alpha).toVar();
        const denom = nh.mul(nh).mul(alpha2.sub(1)).add(1).toVar();
        const distribution = alpha2.div(max(denom.mul(denom).mul(Math.PI), 0.0001));
        const maskingK = roughness.add(1).mul(roughness.add(1)).mul(0.125).toVar();
        const masking = nv.div(nv.mul(float(1).sub(maskingK)).add(maskingK))
            .mul(nl.div(max(nl.mul(float(1).sub(maskingK)).add(maskingK), 0.001)));
        const fresnel = float(0.035).add(pow(float(1).sub(vh), 5).mul(0.965));
        const sheen = clamp(distribution.mul(masking).mul(fresnel).div(nv.mul(4)), 0, 1.8)
            .mul(shadow).mul(wet.mul(0.62).add(obsidian.mul(0.85)).add(0.035));
        rgb.addAssign(vec3(1.08, 1.0, 0.87).mul(sheen));
        const rim = pow(float(1).sub(nv), 4).mul(obsidian).mul(0.095);
        rgb.addAssign(paSkyColour(u, reflect(V.negate(), N)).mul(rim));
        if (tier.puddleReflection) {
            const puddle = smoothstep(0.96, 0.999, N.y).mul(wet).mul(wash).mul(0.32);
            rgb.assign(mix(rgb, paSkyColour(u, reflect(V.negate(), N)), puddle));
        }

        const shade = vec3(0.45, 0.39, 0.33).mul(illumination);
        rgb.assign(select(u.view.equal(1), shade, rgb));
        rgb.assign(paHaze(u, P, rgb, wet));
        const viewDirection = normalize(P.sub(u.eye));
        const rainSlab = smoothstep(80, 750, P.z.negate());
        rgb.addAssign(paRainbow(u, viewDirection, rainSlab, tier));
        return clamp(rgb, vec3(0), vec3(3));
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'painted-ages-land';
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    const detail = createScaleDetails(u, tier, bake);
    return {
        mesh,
        meshes: [mesh, detail.mesh],
        geometry,
        material,
        dispose() {
            geometry.dispose();
            material.dispose();
            rockRelief?.dispose();
            detail.geometry.dispose();
            detail.material.dispose();
        },
    };
}
