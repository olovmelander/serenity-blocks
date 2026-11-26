/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * The horizon inside the barrel. Heaped trade-wind cumulus stand in front of a high wind-sheared
 * veil; their lit edges and undersides change with the hour. The dome is tested against the
 * opaque water first so only the opening and the lip's torn edge shade these layers.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, abs, atan, clamp, dot, exp, float, floor, fract, length, max, mix, normalize, positionGeometry, sin,
    smoothstep, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { createCloudStrip } from './waves-clouds.js';
import { wavesSky } from './waves-tsl.js';

export function createSky({ tier, noise, U }) {
    const clouds = createCloudStrip();
    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    });
    material.name = 'waves-sky';
    material.colorNode = Fn(() => {
        const dir = normalize(positionGeometry).toVar();
        const { sun, light, time } = U;
        const night = smoothstep(0.35, 0.96, U.stars).toVar();
        const bearing = atan(dir.x, dir.z.negate()).toVar();
        const altitude = max(dir.y, 0);
        const alignment = clamp(dot(dir, sun), -1, 1).toVar();
        const sunRight = vec2(sun.z.negate(), sun.x).div(max(length(sun.xz), 0.001));
        const skyPos = vec2(dot(dir.xz, sunRight), dir.y.sub(sun.y)).toVar();
        const sunDist = length(skyPos).toVar();
        // The water's mirror needs a soft specular lobe. On the dome the surface of the
        // luminary is resolved independently of the glow around it.
        const skyLight = {
            ...light,
            disc: vec3(0),
            aureole: light.aureole.mul(mix(0.76, 0.34, night)),
            glare: light.glare.mul(mix(0.49, 0.16, night)),
        };
        const base = wavesSky(dir, sun, float(1), U.warm, skyLight).toVar();
        const highAir = smoothstep(0.1, 0.32, altitude).mul(smoothstep(0.045, 0.25, sunDist)).mul(0.53);
        const sky = mix(base, mix(light.beltFar, light.barFar, 0.42), highAir).toVar();
        const radius = mix(0.018, 0.023, night);
        const disc = float(1).sub(smoothstep(radius.sub(0.0013), radius.add(0.0013), sunDist));
        If(alignment.greaterThan(0.998), () => {
            const height = clamp(skyPos.y.div(radius).mul(0.5).add(0.5), 0, 1);
            const sunBody = mix(vec3(5.1, 1.85, 0.36), vec3(9.8, 6.8, 3.9), height).mul(light.disc);
            const maria = texture(noise, skyPos.mul(9.8).add(vec2(0.28, 0.73))).level(1).b;
            const moonBody = vec3(0.91, 1.03, 1.24).mul(maria.mul(0.63).add(0.79))
                .mul(float(1).sub(smoothstep(0.015, 0.024, sunDist).mul(0.32)));
            sky.assign(mix(sky, mix(sunBody, moonBody, night), disc));
        });

        // A perfect clear puts a diffraction corona in the mist round the sun. The ring is
        // a few degrees across, is partly hidden by the clouds and follows the moon at night.
        If(U.crown.greaterThan(0.001), () => {
            const crown = clamp(U.crown, 0, 1);
            const offset = sunDist.sub(crown.mul(0.026).add(0.062));
            const ring = exp(offset.mul(offset).mul(-4600)).mul(crown).mul(smoothstep(0.97, 0.998, alignment));
            const spectrum = mix(vec3(0.37, 0.8, 1), vec3(1.7, 0.58, 0.22), smoothstep(-0.012, 0.012, offset));
            sky.addAssign(spectrum.mul(ring).mul(light.sunTint));
        });

        // High streaks of ice shear across the view. Their shape has a separate clock from
        // the cumulus below, so the openings change even during a long stretch of one hour.
        const wind = U.sea.y;
        const curve = sin(bearing.mul(4.9).sub(time.mul(0.013))).mul(0.029).add(bearing.mul(0.20));
        const sheared = vec2(bearing.mul(0.65).sub(time.mul(0.0016)), altitude.sub(curve).mul(2.95));
        const high = texture(noise, sheared.add(vec2(0.67, 0.22))).toVar();
        const fire = mix(light.cloudGlow, light.cloudFire, smoothstep(0.55, 1, alignment)).toVar();
        const shade = mix(light.cloudFar, light.cloudShade, smoothstep(0.4, 1, alignment)).toVar();
        const fibre = tier.clouds >= 3
            ? texture(noise, vec2(sheared.x.mul(2.32), sheared.y.mul(3.1).add(high.b.mul(0.53)))
                .add(vec2(0.39, time.mul(0.0007)))).a
            : high.b;
        const fray = tier.clouds >= 3
            ? texture(noise, vec2(
                sheared.x.mul(5.1).add(time.mul(0.002)),
                sheared.y.mul(7.4).add(high.a.mul(1.65)).add(fibre.mul(0.19)),
            )).b
            : high.a;
        const veil = high.a.mul(0.56).add(0.24).mul(fibre.mul(0.78).add(0.09))
            .mul(fray.mul(0.84).add(0.19))
            .mul(smoothstep(0.07, 0.18, altitude))
            .mul(wind.mul(0.14).add(0.81))
            .mul(mix(1.0, 0.74, night))
            .mul(smoothstep(0.018, 0.070, sunDist))
            .toVar();
        const veilLight = mix(shade, fire.mul(vec3(1.17, 0.88, 0.96)), high.b.mul(0.33).add(0.61));
        sky.assign(mix(sky, veilLight, veil));

        // Each bank has a near face, a sunward cheek and a thin backlit edge. Coarse advection
        // bends the whole bank while fine eddies change the silhouette of each billow.
        const drift = time.mul(0.00073);
        const x = bearing.mul(0.60).add(0.46).sub(drift).toVar();
        const eddy = texture(noise, vec2(x.mul(4.4), altitude.mul(3.6)).add(vec2(0.2, time.mul(0.0009)))).toVar();
        const grain = tier.clouds >= 2
            ? texture(noise, vec2(x, altitude).mul(vec2(13.7, 12.3)).add(vec2(time.mul(0.002), 0.38))).toVar()
            : eddy;
        const warp = vec2(eddy.a.sub(0.5).mul(0.031), eddy.b.sub(0.5).mul(0.18))
            .add(grain.ba.sub(0.5).mul(vec2(0.007, 0.034)));
        const cap = texture(clouds, vec2(x, altitude.mul(3.37)).add(warp)).toVar();
        const cover = smoothstep(0.05, 0.95, cap.a.add(grain.b.sub(0.5).mul(0.24)))
            .mul(smoothstep(0.008, 0.032, altitude)).toVar();

        if (tier.clouds >= 2) {
            // The smaller, hazier bank drifts against the near one low over the water.
            const far = texture(clouds, vec2(
                bearing.mul(1.34).add(0.12).add(drift.mul(0.45)),
                altitude.mul(8.9),
            ).add(warp.mul(0.62))).toVar();
            const farLight = mix(shade.mul(0.81), fire, clamp(far.g.mul(0.65).add(0.38).sub(far.b.mul(0.6)), 0, 1));
            sky.assign(mix(sky, farLight, far.a.mul(smoothstep(0.004, 0.018, altitude)).mul(0.76)));
        }
        const side = dot(sun.xz, vec2(dir.z.negate(), dir.x));
        const cheek = cap.r.sub(0.5).mul(side).mul(2.2).add(cap.g.sub(0.5).mul(0.53));
        const rim = float(1).sub(smoothstep(0.045, 0.42, cap.b))
            .mul(smoothstep(-0.26, 0.22, cheek).mul(0.55).add(0.11));
        const edgeLight = clamp(cheek.add(rim).add(0.24).add(grain.b.sub(0.5).mul(0.41)), 0, 1);
        const shadow = mix(shade.mul(0.7), light.barFar, cap.b.mul(0.64));
        const cloud = mix(shadow, fire.mul(1.10), edgeLight);
        sky.assign(mix(sky, cloud, cover.mul(0.96)));

        // Few stars are bright. Clouds in front and the light of the moon reduce their contrast.
        If(U.stars.greaterThan(0.001), () => {
            const starAt = vec2(bearing, dir.y).mul(64.0).add(256.0);
            const cell = floor(starAt);
            const h1 = fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453));
            const h2 = fract(sin(dot(cell, vec2(269.5, 183.3))).mul(43758.5453));
            const off = fract(starAt).sub(0.5).sub(vec2(h1, h2).sub(0.5).mul(0.6));
            const bright = h2.mul(h2).mul(h2).mul(smoothstep(0.45, 0.5, h1));
            const twinkle = sin(time.mul(h1.mul(1.6).add(0.7)).add(h2.mul(40))).mul(0.21).add(0.79);
            sky.addAssign(vec3(0.8, 0.9, 1).mul(exp(dot(off, off).mul(-150)).mul(bright).mul(twinkle).mul(3.8))
                .mul(U.stars).mul(smoothstep(0.03, 0.20, dir.y))
                .mul(float(1).sub(max(cover, veil)))
                .mul(smoothstep(0.035, 0.14, sunDist)));
        });

        // The final sliver of sea beyond the water mesh. The haze closes over the finest crests.
        const below = float(1).sub(smoothstep(-0.004, 0, dir.y));
        const down = max(dir.y.negate(), 0.0015);
        const sea = dir.xz.div(down);
        const spark = texture(noise, sea.mul(vec2(0.012, 0.004)).add(vec2(0, time.mul(0.02)))).a;
        const acrossSun = abs(dot(dir.xz, sunRight));
        const road = exp(acrossSun.mul(acrossSun).mul(-67)).mul(smoothstep(0.6, 0.92, alignment));
        const sparks = smoothstep(0.62, 0.9, spark).mul(road).mul(exp(down.mul(-9)));
        const glitter = vec3(6.8, 4.6, 2).mul(light.fireTint).mul(sparks).mul(below);
        return vec4(mix(sky, base, below).add(glitter), 1);
    })();

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
    mesh.name = 'waves-sky';
    mesh.scale.setScalar(4200);
    mesh.frustumCulled = false;
    mesh.renderOrder = 40;
    return {
        mesh,
        follow(camera) {
            mesh.position.copy(camera.position);
            mesh.updateMatrixWorld();
        },
        dispose() {
            mesh.removeFromParent();
            mesh.geometry.dispose();
            material.dispose();
            clouds.dispose();
        },
    };
}
